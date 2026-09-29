// VERIFICATION (speech-audio tests, D-121): UNVERIFIED (written in the cloud, not compiled).
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
        #expect(await makeClient(stub).pair(code: "000000") == .unreachable("Name not found: gateway.test"))
        stub.next = .failure(URLError(.cannotConnectToHost))
        #expect(await makeClient(stub).pair(code: "000000") == .unreachable("Connection refused by gateway.test"))
        stub.next = .success(json: "{}", httpStatus: 500)
        #expect(await makeClient(stub).pair(code: "000000") == .unreachable("Unexpected answer (HTTP 500)"))
    }

    @Test func audioIsPostedWithIdentityHeadersAndAnsweredLikeARequest() async throws {
        let rid = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c"
        let stub = StubFetch(.success(json: #"{"protocolVersion":1,"requestId":"\#(rid)","status":"ok","text":"Pixel","speechText":"Pixel","characterState":"idle","haptic":"none","followUpExpected":false,"transcript":"What's my dog's name?"}"#))
        let audio = Data([0x00, 0x01, 0x02])
        let exchange = await makeClient(stub).exchangeAudio(audio, requestId: rid)
        #expect(exchange.reachedGateway)
        #expect(exchange.response.speechText == "Pixel")
        let sent = try #require(stub.captured)
        #expect(sent.url?.path == "/v1/audio")
        #expect(sent.httpMethod == "POST")
        #expect(sent.value(forHTTPHeaderField: "content-type") == "audio/mp4")
        #expect(sent.value(forHTTPHeaderField: "x-tamago-request-id") == rid)
        #expect(sent.value(forHTTPHeaderField: "x-tamago-protocol-version") == "1")
        #expect(sent.value(forHTTPHeaderField: "authorization") == "Bearer test-token-0123456789")
        #expect(sent.httpBody == audio)

        stub.next = .failure(URLError(.cannotConnectToHost))
        let down = await makeClient(stub).exchangeAudio(audio, requestId: rid)
        #expect(!down.reachedGateway)
        #expect(down.response.error?.code == .gatewayUnavailable)
        #expect(down.response.requestId == rid)
    }

    @Test func manualAddressBecomesAGatewayURL() {
        #expect(GatewayConfiguration.manualBaseURL(from: "192.168.0.74")?.absoluteString == "http://192.168.0.74:8787")
        #expect(GatewayConfiguration.manualBaseURL(from: " 192.168.0.74:9000 ")?.absoluteString == "http://192.168.0.74:9000")
        #expect(GatewayConfiguration.manualBaseURL(from: "http://studio.local:8787/v1/health")?.absoluteString == "http://studio.local:8787")
        #expect(GatewayConfiguration.manualBaseURL(from: "HTTP://Mac.local")?.absoluteString == "http://Mac.local:8787")
        #expect(GatewayConfiguration.manualBaseURL(from: "") == nil)
        #expect(GatewayConfiguration.manualBaseURL(from: "my mac") == nil)
        #expect(GatewayConfiguration.manualBaseURL(from: "ftp://192.168.0.74") == nil)
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
        case bytes(Data, httpStatus: Int = 200, contentType: String)
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
            case let .bytes(data, status, contentType):
                let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                               headerFields: ["content-type": contentType])!
                return (data, response)
            }
        }
    }
}

// MARK: - Speech audio (PROTOCOL_V1 §16, D-121)

@Suite("GatewayClient speech audio")
struct GatewayClientSpeechAudioTests {
    let baseURL = URL(string: "http://gateway.test:8787")!
    let id = "00000000-0000-4000-8000-000000000012"

    func makeClient(_ stub: StubFetch) -> GatewayClient {
        GatewayClient(configuration: GatewayConfiguration(baseURL: baseURL, authToken: "test-token-0123456789"),
                      fetch: stub.fetch)
    }

    @Test func fetchesAudioWithBearerAndBudget() async {
        let stub = StubFetch(.bytes(Data("m4a".utf8), contentType: "audio/mp4"))
        let data = await makeClient(stub).speechAudio(path: "/v1/speech/\(id)")
        #expect(data == Data("m4a".utf8))
        #expect(stub.captured?.url?.absoluteString == "http://gateway.test:8787/v1/speech/\(id)")
        #expect(stub.captured?.httpMethod == "GET")
        #expect(stub.captured?.value(forHTTPHeaderField: "authorization") == "Bearer test-token-0123456789")
        #expect(stub.captured?.timeoutInterval == 2.5)
    }

    @Test func notReadyOrMissingMeansNil() async {
        for status in [404, 503, 401] {
            let stub = StubFetch(.success(json: #"{"status":"error"}"#, httpStatus: status))
            #expect(await makeClient(stub).speechAudio(path: "/v1/speech/\(id)") == nil)
        }
    }

    @Test func nonAudioOrEmptyBodyMeansNil() async {
        let json = StubFetch(.bytes(Data("{}".utf8), contentType: "application/json"))
        #expect(await makeClient(json).speechAudio(path: "/v1/speech/\(id)") == nil)
        let empty = StubFetch(.bytes(Data(), contentType: "audio/mp4"))
        #expect(await makeClient(empty).speechAudio(path: "/v1/speech/\(id)") == nil)
    }

    @Test func timeoutMeansNil() async {
        let stub = StubFetch(.failure(URLError(.timedOut)))
        #expect(await makeClient(stub).speechAudio(path: "/v1/speech/\(id)") == nil)
    }

    @Test func refusesPathsOfAnyOtherShapeWithoutFetching() async {
        for path in ["/v1/request", "https://elsewhere.test/v1/speech/\(id)", "/v1/speech/../health", "/v1/speech/not-a-uuid", ""] {
            let stub = StubFetch(.bytes(Data("m4a".utf8), contentType: "audio/mp4"))
            #expect(await makeClient(stub).speechAudio(path: path) == nil, "\(path)")
            #expect(stub.captured == nil, "\(path)")
        }
    }

    @Test func responseDecodesOptionalSpeechAudio() throws {
        let with = """
        {"protocolVersion":1,"requestId":"\(id)","status":"ok","text":"pong","speechText":"pong",
         "characterState":"idle","haptic":"click","followUpExpected":false,
         "speechAudio":{"path":"/v1/speech/\(id)","format":"audio/mp4","voice":"af_heart"}}
        """
        let decoded = try JSONDecoder().decode(TamagoResponse.self, from: Data(with.utf8))
        #expect(decoded.speechAudio == TamagoSpeechAudio(path: "/v1/speech/\(id)", format: "audio/mp4", voice: "af_heart"))
        let without = """
        {"protocolVersion":1,"requestId":"\(id)","status":"ok","text":"pong","speechText":"pong",
         "characterState":"idle","haptic":"click","followUpExpected":false}
        """
        #expect(try JSONDecoder().decode(TamagoResponse.self, from: Data(without.utf8)).speechAudio == nil)
    }
}

// MARK: - Conversation (PROTOCOL_V1 §18, D-127)
// VERIFICATION: UNVERIFIED (written in the cloud, not compiled).

@Suite("GatewayClient conversation")
struct GatewayClientConversationTests {
    let baseURL = URL(string: "http://gateway.test:8787")!

    func makeClient(_ stub: StubFetch) -> GatewayClient {
        GatewayClient(configuration: GatewayConfiguration(baseURL: baseURL, authToken: "test-token-0123456789"),
                      fetch: stub.fetch)
    }

    static let page = """
    {"protocolVersion":1,"latest":7,"turns":[
     {"seq":3,"rev":7,"requestId":"00000000-0000-4000-8000-000000000001","at":"2026-09-27T14:02:03.456Z",
      "from":"watch","you":"How do I make sourdough?","tamago":"Here is the whole thing:\\n\\n1. Feed it.",
      "said":"Sourdough needs a starter. That one's long. Check your phone, or should I say it all?",
      "long":{"status":"ready"}},
     {"seq":6,"rev":6,"requestId":"00000000-0000-4000-8000-000000000002","at":"2026-09-27T14:02:30.000Z",
      "from":"watch","you":"Say it all.","tamago":"","said":"Here is the whole thing: Feed it.","note":"read_aloud","about":3},
     {"seq":7,"rev":7,"requestId":"00000000-0000-4000-8000-000000000003","at":"2026-09-27T14:03:00.000Z",
      "from":"phone","you":"ping","tamago":"","said":"","error":"provider_unavailable"}
    ]}
    """

    @Test func decodesAPageWithBearerAndAfter() async throws {
        let stub = StubFetch(.success(json: Self.page))
        let page = try #require(await makeClient(stub).conversation(after: 2))
        #expect(stub.captured?.url?.absoluteString == "http://gateway.test:8787/v1/conversation?after=2")
        #expect(stub.captured?.httpMethod == "GET")
        #expect(stub.captured?.value(forHTTPHeaderField: "authorization") == "Bearer test-token-0123456789")
        #expect(page.latest == 7)
        #expect(page.turns.map(\.seq) == [3, 6, 7])
        let long = page.turns[0]
        #expect(long.from == "watch")
        #expect(long.long == TamagoLongAnswer(status: "ready"))
        #expect(long.tamago.hasPrefix("Here is the whole thing:"))
        #expect(long.date != nil)
        #expect(page.turns[1].note == "read_aloud")
        #expect(page.turns[1].about == 3)
        #expect(page.turns[2].error == "provider_unavailable")
    }

    @Test func negativeAfterIsSentAsZero() async {
        let stub = StubFetch(.success(json: #"{"protocolVersion":1,"latest":0,"turns":[]}"#))
        _ = await makeClient(stub).conversation(after: -5)
        #expect(stub.captured?.url?.query == "after=0")
    }

    @Test func anythingButAPageIsNil() async {
        for status in [401, 404, 500] {
            let stub = StubFetch(.success(json: #"{"status":"error"}"#, httpStatus: status))
            #expect(await makeClient(stub).conversation() == nil)
        }
        #expect(await makeClient(StubFetch(.success(json: "{ nope"))).conversation() == nil)
        #expect(await makeClient(StubFetch(.failure(URLError(.cannotConnectToHost)))).conversation() == nil)
    }

    @Test func clearIsADeleteThatNeeds200() async {
        let ok = StubFetch(.success(json: #"{"protocolVersion":1,"latest":7,"turns":[],"cleared":true}"#))
        #expect(await makeClient(ok).clearConversation())
        #expect(ok.captured?.httpMethod == "DELETE")
        #expect(ok.captured?.url?.path == "/v1/conversation")
        let denied = StubFetch(.success(json: #"{"status":"error"}"#, httpStatus: 401))
        #expect(await makeClient(denied).clearConversation() == false)
    }

    @Test func responseDecodesOptionalLongAnswer() throws {
        let json = """
        {"protocolVersion":1,"requestId":"00000000-0000-4000-8000-000000000001","status":"ok",
         "text":"Sourdough needs a starter.","speechText":"Sourdough needs a starter. That one's long.",
         "characterState":"idle","haptic":"click","followUpExpected":true,"longAnswer":{"status":"pending","seq":3}}
        """
        let r = try JSONDecoder().decode(TamagoResponse.self, from: Data(json.utf8))
        #expect(r.longAnswer == TamagoLongAnswer(status: "pending", seq: 3))
        #expect(r.followUpExpected)
    }
}

// MARK: - Listening mode (PROTOCOL_V1 §19, D-130)

@Suite("GatewayClient listening")
struct GatewayClientListeningTests {
    let baseURL = URL(string: "http://gateway.test:8787")!
    let session = "6f1c2a90-1b2c-4d3e-8f40-123456789abc"

    func makeClient(_ stub: StubFetch) -> GatewayClient {
        GatewayClient(configuration: GatewayConfiguration(baseURL: baseURL, authToken: "test-token-0123456789"), fetch: stub.fetch)
    }

    @Test func chunkUploadCarriesSessionSequenceAndStartTime() async throws {
        let stub = StubFetch(.success(json: #"{"protocolVersion":1,"status":"ok","session":"x","seq":3,"stored":true}"#))
        let ok = await makeClient(stub).uploadListenChunk(Data([1, 2, 3]), session: session, seq: 3,
                                                          startedAt: Date(timeIntervalSince1970: 1_790_000_000))
        #expect(ok)
        let request = try #require(stub.captured)
        #expect(request.url?.path == "/v1/listen/chunk")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "x-tamago-listen-session") == session)
        #expect(request.value(forHTTPHeaderField: "x-tamago-listen-seq") == "3")
        #expect(request.value(forHTTPHeaderField: "x-tamago-listen-started-at") == "1790000000000")
        #expect(request.value(forHTTPHeaderField: "authorization") == "Bearer test-token-0123456789")
        #expect(request.value(forHTTPHeaderField: "content-type") == "audio/mp4")
        #expect(request.httpBody == Data([1, 2, 3]))
    }

    @Test func anythingButAStoredChunkIsAFailureToRetry() async {
        let offline = StubFetch(.failure(URLError(.cannotConnectToHost)))
        #expect(await makeClient(offline).uploadListenChunk(Data([1]), session: session, seq: 0, startedAt: .now) == false)
        let refused = StubFetch(.success(json: #"{"protocolVersion":1,"status":"error","error":{"code":"auth_failed"}}"#, httpStatus: 401))
        #expect(await makeClient(refused).uploadListenChunk(Data([1]), session: session, seq: 0, startedAt: .now) == false)
    }

    @Test func endSendsTheSession() async throws {
        let stub = StubFetch(.success(json: #"{"protocolVersion":1,"status":"ok","session":"x","chunks":2}"#))
        #expect(await makeClient(stub).endListening(session: session))
        let request = try #require(stub.captured)
        #expect(request.url?.path == "/v1/listen/end")
        let body = try #require(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] })
        #expect(body["session"] == session)
    }
}
