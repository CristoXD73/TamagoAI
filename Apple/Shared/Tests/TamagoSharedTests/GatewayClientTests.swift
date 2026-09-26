import Foundation
import Testing
@testable import TamagoShared

/// `GatewayClient` never throws (file header explains why): every case here
/// asserts on what it resolves to. Each test injects its own `StubFetch` via
/// `GatewayClient(configuration:fetch:)` — no sockets, no running gateway,
/// no shared state, so tests may run in parallel. (An earlier version mocked
/// at the `URLProtocol` level; watchOS doesn't honor custom protocol classes
/// on a session, so those tests silently hit the real network there.)
@Suite("GatewayClient")
struct GatewayClientTests {
    let baseURL = URL(string: "http://gateway.test:8787")!

    func makeClient(_ stub: StubFetch, timeout: TimeInterval = 5, expectedGatewayId: String? = nil) -> GatewayClient {
        GatewayClient(
            configuration: GatewayConfiguration(baseURL: baseURL, authToken: "test-token-0123456789",
                                                requestTimeout: timeout, expectedGatewayId: expectedGatewayId),
            fetch: stub.fetch
        )
    }

    @Test func successfulResponseDecodesAsIs() async {
        let requestId = UUID()
        let stub = StubFetch(.success(json: """
        {"protocolVersion":1,"requestId":"\(requestId.uuidString.lowercased())","status":"ok","text":"pong",
         "speechText":"","characterState":"idle","haptic":"click","followUpExpected":false}
        """))
        let client = makeClient(stub)
        let response = await client.send(TamagoRequest(text: "ping", requestId: requestId))
        #expect(response.status == .ok)
        #expect(response.text == "pong")
        #expect(response.characterState == .idle)
        #expect(response.haptic == .click)
        #expect(response.requestId == requestId.uuidString.lowercased())
    }

    @Test func errorEnvelopeFromGatewayPassesThroughUnchanged() async {
        let requestId = UUID()
        let stub = StubFetch(.success(json: """
        {"protocolVersion":1,"requestId":"\(requestId.uuidString.lowercased())","status":"error","text":"",
         "speechText":"","characterState":"idle","haptic":"none","followUpExpected":false,
         "error":{"code":"provider_unavailable","message":"offline","retryable":true}}
        """, httpStatus: 503))
        let client = makeClient(stub)
        let response = await client.send(TamagoRequest(text: "unavailable", requestId: requestId))
        #expect(response.status == .error)
        #expect(response.error?.code == .providerUnavailable)
    }

    @Test func networkFailureSynthesizesGatewayUnavailable() async {
        let stub = StubFetch(.failure(URLError(.cannotConnectToHost)))
        let client = makeClient(stub)
        let request = TamagoRequest(text: "hello")
        let response = await client.send(request)
        #expect(response.status == .error)
        #expect(response.error?.code == .gatewayUnavailable)
        #expect(response.error?.retryable == true)
        #expect(response.requestId == request.requestId)
    }

    @Test func timeoutSynthesizesTimeoutCode() async {
        let stub = StubFetch(.failure(URLError(.timedOut)))
        let client = makeClient(stub)
        let response = await client.send(TamagoRequest(text: "slow 999999"))
        #expect(response.error?.code == .timeout)
    }

    @Test func malformedJSONSynthesizesGatewayUnavailableRatherThanCrashing() async {
        let stub = StubFetch(.success(json: "{ not json"))
        let client = makeClient(stub)
        let response = await client.send(TamagoRequest(text: "hello"))
        #expect(response.status == .error)
        #expect(response.error?.code == .gatewayUnavailable)
    }

    @Test func synthesizedErrorAlwaysAnswersItsOwnRequest() async {
        let stub = StubFetch(.failure(URLError(.notConnectedToInternet)))
        let client = makeClient(stub)
        let request = TamagoRequest(text: "hello")
        let response = await client.send(request)
        #expect(response.answers(request))
    }

    // MARK: probe (GET /v1/health)

    @Test func probeReachableCarriesGatewayId() async {
        let stub = StubFetch(.success(json: #"{"status":"ok","gatewayId":"gw-1"}"#))
        #expect(await makeClient(stub).probe() == .reachable(gatewayId: "gw-1"))
    }

    @Test func probeDistinguishesNameNotFoundFromUnreachable() async {
        let stub = StubFetch(.failure(URLError(.cannotFindHost)))
        #expect(await makeClient(stub).probe() == .notFound)
        stub.next = .failure(URLError(.cannotConnectToHost))
        #expect(await makeClient(stub).probe() == .unreachable)
        stub.next = .success(json: #"{"status":"error"}"#, httpStatus: 500)
        #expect(await makeClient(stub).probe() == .unreachable)
    }

    @Test func probeFlagsADifferentGatewayThanThePairedOne() async {
        let stub = StubFetch(.success(json: #"{"status":"ok","gatewayId":"someone-else"}"#))
        let client = makeClient(stub, expectedGatewayId: "gw-1")
        #expect(await client.probe() == .wrongGateway(found: "someone-else"))
    }

    // MARK: exchange — do requests themselves prove reachability?

    @Test func gatewaySentErrorStillReachedTheGateway() async {
        let request = TamagoRequest(text: "slow 99999")
        let stub = StubFetch(.success(json: """
        {"protocolVersion":1,"requestId":"\(request.requestId)","status":"error","text":"x","speechText":"x",
         "characterState":"confused","haptic":"failure","followUpExpected":false,
         "error":{"code":"timeout","message":"slow","retryable":true}}
        """, httpStatus: 504))
        let exchange = await makeClient(stub).exchange(request)
        #expect(exchange.reachedGateway, "a gateway-sent timeout proves the Mac answered")
        #expect(exchange.response.error?.code == .timeout)
    }

    @Test func synthesizedErrorDidNotReachTheGateway() async {
        let stub = StubFetch(.failure(URLError(.timedOut)))
        let exchange = await makeClient(stub).exchange(TamagoRequest(text: "hi"))
        #expect(!exchange.reachedGateway)
        #expect(exchange.response.error?.code == .timeout)
    }

    // MARK: pair (POST /v1/pair)

    @Test func pairingSuccessReturnsTheGrantWithoutSendingAToken() async {
        let stub = StubFetch(.success(json: #"{"protocolVersion":1,"gatewayId":"gw-1","gatewayName":"Studio","token":"secret-token-abc"}"#))
        let outcome = await makeClient(stub).pair(code: "123456", deviceName: "Watch")
        #expect(outcome == .paired(TamagoPairingGrant(gatewayId: "gw-1", gatewayName: "Studio", token: "secret-token-abc")))
        #expect(stub.captured?.url?.path == "/v1/pair")
        #expect(stub.captured?.value(forHTTPHeaderField: "authorization") == nil)
    }

    @Test func pairingFailuresAreClassified() async {
        let stub = StubFetch(.success(json: #"{"protocolVersion":1,"error":{"code":"pairing_failed","message":"x"}}"#, httpStatus: 401))
        #expect(await makeClient(stub).pair(code: "000000") == .wrongCode)
        stub.next = .success(json: #"{"protocolVersion":1,"error":{"code":"pairing_closed","message":"x"}}"#, httpStatus: 410)
        #expect(await makeClient(stub).pair(code: "000000") == .closed)
        stub.next = .success(json: #"{"protocolVersion":1,"error":{"code":"pairing_unavailable","message":"x"}}"#, httpStatus: 404)
        #expect(await makeClient(stub).pair(code: "000000") == .closed)
        stub.next = .failure(URLError(.cannotFindHost))
        #expect(await makeClient(stub).pair(code: "000000") == .unreachable)
    }

    @Test func requestSendsBearerAuthorizationHeaderAndJSONBody() async {
        let stub = StubFetch(.success(json: """
        {"protocolVersion":1,"requestId":null,"status":"ok","text":"","speechText":"",
         "characterState":"idle","haptic":"none","followUpExpected":false}
        """))
        let client = makeClient(stub)
        _ = await client.send(TamagoRequest(text: "hello"))
        let captured = stub.captured
        #expect(captured?.value(forHTTPHeaderField: "authorization") == "Bearer test-token-0123456789")
        #expect(captured?.url?.path == "/v1/request")
        #expect(captured?.httpMethod == "POST")
    }
}

/// One per test: returns `next` for every request and records the last one.
final class StubFetch: @unchecked Sendable {
    enum Outcome {
        case success(json: String, httpStatus: Int = 200)
        case failure(URLError)
    }

    var next: Outcome
    private(set) var captured: URLRequest?

    init(_ next: Outcome) { self.next = next }

    var fetch: GatewayClient.Fetch {
        { [self] request in
            captured = request
            switch next {
            case let .success(json, status):
                let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
                return (Data(json.utf8), response)
            case let .failure(error):
                throw error
            }
        }
    }
}
