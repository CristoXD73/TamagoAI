import Foundation
import Testing
@testable import TamagoShared

/// `GatewayClient` never throws (file header explains why): every case here
/// asserts on the `TamagoResponse` it resolves to. `MockURLProtocol` stubs the
/// transport so these run fast and deterministically on the host, with no
/// real socket and no dependency on a running gateway. `.serialized` because
/// every test mutates the same shared `MockURLProtocol.stub` — Swift Testing
/// runs tests within a suite in parallel by default, which would let one
/// test's stub leak into another's request.
@Suite("GatewayClient", .serialized)
struct GatewayClientTests {
    // A loopback literal, not a made-up hostname: on watchOS's URLSession
    // stack (unlike the host `swift test` run), an unresolvable hostname can
    // fail DNS before URLProtocol gets a chance to intercept, bypassing the
    // mock entirely. 127.0.0.1 needs no resolution, so interception is
    // reliable on both platforms.
    let baseURL = URL(string: "http://127.0.0.1:1")!

    func makeClient(timeout: TimeInterval = 5, expectedGatewayId: String? = nil) -> GatewayClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: config)
        return GatewayClient(
            configuration: GatewayConfiguration(baseURL: baseURL, authToken: "test-token-0123456789",
                                                requestTimeout: timeout, expectedGatewayId: expectedGatewayId),
            session: session
        )
    }

    @Test func successfulResponseDecodesAsIs() async {
        let requestId = UUID()
        MockURLProtocol.stub = .success(json: """
        {"protocolVersion":1,"requestId":"\(requestId.uuidString.lowercased())","status":"ok","text":"pong",
         "speechText":"","characterState":"idle","haptic":"click","followUpExpected":false}
        """)
        let client = makeClient()
        let response = await client.send(TamagoRequest(text: "ping", requestId: requestId))
        #expect(response.status == .ok)
        #expect(response.text == "pong")
        #expect(response.characterState == .idle)
        #expect(response.haptic == .click)
        #expect(response.requestId == requestId.uuidString.lowercased())
    }

    @Test func errorEnvelopeFromGatewayPassesThroughUnchanged() async {
        let requestId = UUID()
        MockURLProtocol.stub = .success(json: """
        {"protocolVersion":1,"requestId":"\(requestId.uuidString.lowercased())","status":"error","text":"",
         "speechText":"","characterState":"idle","haptic":"none","followUpExpected":false,
         "error":{"code":"provider_unavailable","message":"offline","retryable":true}}
        """, httpStatus: 503)
        let client = makeClient()
        let response = await client.send(TamagoRequest(text: "unavailable", requestId: requestId))
        #expect(response.status == .error)
        #expect(response.error?.code == .providerUnavailable)
    }

    @Test func networkFailureSynthesizesGatewayUnavailable() async {
        MockURLProtocol.stub = .failure(URLError(.cannotConnectToHost))
        let client = makeClient()
        let request = TamagoRequest(text: "hello")
        let response = await client.send(request)
        #expect(response.status == .error)
        #expect(response.error?.code == .gatewayUnavailable)
        #expect(response.error?.retryable == true)
        #expect(response.requestId == request.requestId)
    }

    @Test func timeoutSynthesizesTimeoutCode() async {
        MockURLProtocol.stub = .failure(URLError(.timedOut))
        let client = makeClient()
        let response = await client.send(TamagoRequest(text: "slow 999999"))
        #expect(response.error?.code == .timeout)
    }

    @Test func malformedJSONSynthesizesGatewayUnavailableRatherThanCrashing() async {
        MockURLProtocol.stub = .success(json: "{ not json")
        let client = makeClient()
        let response = await client.send(TamagoRequest(text: "hello"))
        #expect(response.status == .error)
        #expect(response.error?.code == .gatewayUnavailable)
    }

    @Test func synthesizedErrorAlwaysAnswersItsOwnRequest() async {
        MockURLProtocol.stub = .failure(URLError(.notConnectedToInternet))
        let client = makeClient()
        let request = TamagoRequest(text: "hello")
        let response = await client.send(request)
        #expect(response.answers(request))
    }

    // MARK: probe (GET /v1/health)

    @Test func probeReachableCarriesGatewayId() async {
        MockURLProtocol.stub = .success(json: #"{"status":"ok","gatewayId":"gw-1"}"#)
        #expect(await makeClient().probe() == .reachable(gatewayId: "gw-1"))
    }

    @Test func probeDistinguishesNameNotFoundFromUnreachable() async {
        MockURLProtocol.stub = .failure(URLError(.cannotFindHost))
        #expect(await makeClient().probe() == .notFound)
        MockURLProtocol.stub = .failure(URLError(.cannotConnectToHost))
        #expect(await makeClient().probe() == .unreachable)
        MockURLProtocol.stub = .success(json: #"{"status":"error"}"#, httpStatus: 500)
        #expect(await makeClient().probe() == .unreachable)
    }

    @Test func probeFlagsADifferentGatewayThanThePairedOne() async {
        MockURLProtocol.stub = .success(json: #"{"status":"ok","gatewayId":"someone-else"}"#)
        let client = makeClient(expectedGatewayId: "gw-1")
        #expect(await client.probe() == .wrongGateway(found: "someone-else"))
    }

    // MARK: exchange — do requests themselves prove reachability?

    @Test func gatewaySentErrorStillReachedTheGateway() async {
        let request = TamagoRequest(text: "slow 99999")
        MockURLProtocol.stub = .success(json: """
        {"protocolVersion":1,"requestId":"\(request.requestId)","status":"error","text":"x","speechText":"x",
         "characterState":"confused","haptic":"failure","followUpExpected":false,
         "error":{"code":"timeout","message":"slow","retryable":true}}
        """, httpStatus: 504)
        let exchange = await makeClient().exchange(request)
        #expect(exchange.reachedGateway, "a gateway-sent timeout proves the Mac answered")
        #expect(exchange.response.error?.code == .timeout)
    }

    @Test func synthesizedErrorDidNotReachTheGateway() async {
        MockURLProtocol.stub = .failure(URLError(.timedOut))
        let exchange = await makeClient().exchange(TamagoRequest(text: "hi"))
        #expect(!exchange.reachedGateway)
        #expect(exchange.response.error?.code == .timeout)
    }

    // MARK: pair (POST /v1/pair)

    @Test func pairingSuccessReturnsTheGrantWithoutSendingAToken() async {
        MockURLProtocol.stub = .success(json: #"{"protocolVersion":1,"gatewayId":"gw-1","gatewayName":"Studio","token":"secret-token-abc"}"#)
        MockURLProtocol.capturedRequest = nil
        let outcome = await makeClient().pair(code: "123456", deviceName: "Watch")
        #expect(outcome == .paired(TamagoPairingGrant(gatewayId: "gw-1", gatewayName: "Studio", token: "secret-token-abc")))
        #expect(MockURLProtocol.capturedRequest?.url?.path == "/v1/pair")
        #expect(MockURLProtocol.capturedRequest?.value(forHTTPHeaderField: "authorization") == nil)
    }

    @Test func pairingFailuresAreClassified() async {
        MockURLProtocol.stub = .success(json: #"{"protocolVersion":1,"error":{"code":"pairing_failed","message":"x"}}"#, httpStatus: 401)
        #expect(await makeClient().pair(code: "000000") == .wrongCode)
        MockURLProtocol.stub = .success(json: #"{"protocolVersion":1,"error":{"code":"pairing_closed","message":"x"}}"#, httpStatus: 410)
        #expect(await makeClient().pair(code: "000000") == .closed)
        MockURLProtocol.stub = .success(json: #"{"protocolVersion":1,"error":{"code":"pairing_unavailable","message":"x"}}"#, httpStatus: 404)
        #expect(await makeClient().pair(code: "000000") == .closed)
        MockURLProtocol.stub = .failure(URLError(.cannotFindHost))
        #expect(await makeClient().pair(code: "000000") == .unreachable)
    }

    @Test func requestSendsBearerAuthorizationHeaderAndJSONBody() async {
        MockURLProtocol.stub = .success(json: """
        {"protocolVersion":1,"requestId":null,"status":"ok","text":"","speechText":"",
         "characterState":"idle","haptic":"none","followUpExpected":false}
        """)
        MockURLProtocol.capturedRequest = nil
        let client = makeClient()
        _ = await client.send(TamagoRequest(text: "hello"))
        let captured = MockURLProtocol.capturedRequest
        #expect(captured?.value(forHTTPHeaderField: "authorization") == "Bearer test-token-0123456789")
        #expect(captured?.url?.path == "/v1/request")
        #expect(captured?.httpMethod == "POST")
    }
}

/// Stubs every request with a fixed outcome. Tests run serially within this
/// suite (default Swift Testing behavior for a plain `struct`), so a single
/// static `stub` is safe — there is no concurrent access.
private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    enum Stub {
        case success(json: String, httpStatus: Int = 200)
        case failure(URLError)
    }

    nonisolated(unsafe) static var stub: Stub = .failure(URLError(.unknown))
    nonisolated(unsafe) static var capturedRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        MockURLProtocol.capturedRequest = request
        switch MockURLProtocol.stub {
        case let .success(json, httpStatus):
            let response = HTTPURLResponse(url: request.url!, statusCode: httpStatus, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(json.utf8))
            client?.urlProtocolDidFinishLoading(self)
        case let .failure(error):
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
