import Foundation
import Testing
@testable import TamagoShared

/// Decodes every fixture in Tests/Fixtures/protocol-v1/manifest.json with the
/// Swift models, and checks the Swift enums against the gateway's advertised
/// vocabulary (responses/protocol-info.json is generated from the live mock).
@Suite("Protocol v1 fixtures")
struct ProtocolFixtureTests {

    // MARK: Manifest

    @Test func manifestIsComplete() throws {
        let manifest = try FixtureLoader.manifest()
        #expect(manifest.protocolVersion == TamagoProtocol.version)
        #expect(manifest.fixtures.count == 22)
        #expect(Set(manifest.fixtures.map(\.kind)) == ["request", "response", "protocolInfo"])

        for entry in manifest.fixtures {
            let url = FixtureLoader.root.appendingPathComponent(entry.path)
            #expect(FileManager.default.fileExists(atPath: url.path), "missing fixture \(entry.path)")
        }
    }

    // MARK: Requests

    /// Requests the gateway accepts as well-formed JSON with a known schema.
    static let decodableRequests: Set<String> = [
        "requests/valid-text.json",
        "requests/valid-minimal.json",
        "requests/unsupported-protocol.json",
    ]

    @Test(arguments: FixtureLoader.entries(kind: "request"))
    func requestFixture(_ entry: FixtureLoader.Entry) throws {
        let data = try FixtureLoader.data(entry.path)
        if Self.decodableRequests.contains(entry.path) {
            let request = try JSONDecoder().decode(TamagoRequest.self, from: data)
            #expect(request.inputType == .text)
            #expect(!request.text.isEmpty)
            #expect(UUID(uuidString: request.requestId) != nil)
        } else {
            // malformed.txt (not JSON) and invalid-missing-text.json (no `text`)
            // must not produce a request model.
            #expect(throws: DecodingError.self) {
                try JSONDecoder().decode(TamagoRequest.self, from: data)
            }
        }
    }

    @Test func validTextRequestDecodesAllFields() throws {
        let request = try JSONDecoder().decode(
            TamagoRequest.self, from: FixtureLoader.data("requests/valid-text.json"))
        #expect(request.protocolVersion == 1)
        #expect(request.requestId == "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c")
        #expect(request.text == "Turn Jellyfin back on.")
        #expect(request.client == TamagoClientInfo(device: "watch", route: "direct", appVersion: "0.1.0"))
    }

    @Test func minimalRequestHasNoClient() throws {
        let request = try JSONDecoder().decode(
            TamagoRequest.self, from: FixtureLoader.data("requests/valid-minimal.json"))
        #expect(request.client == nil)
        #expect(request.protocolVersion == 1)
    }

    @Test func unsupportedProtocolRequestKeepsVersion() throws {
        let request = try JSONDecoder().decode(
            TamagoRequest.self, from: FixtureLoader.data("requests/unsupported-protocol.json"))
        #expect(request.protocolVersion == 2)
    }

    @Test func swiftEncodedRequestMatchesWireShape() throws {
        let id = UUID(uuidString: "3F2B8C1E-9A4D-4E7B-8C2A-1D5E6F7A8B9C")!
        let request = TamagoRequest(
            text: "Turn Jellyfin back on.",
            requestId: id,
            client: TamagoClientInfo(device: "watch", route: "direct", appVersion: "0.1.0"))
        #expect(request.requestId == "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c", "IDs are sent lowercased")

        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? NSDictionary
        let fixture = try JSONSerialization.jsonObject(
            with: FixtureLoader.data("requests/valid-text.json")) as? NSDictionary
        #expect(encoded != nil)
        #expect(encoded == fixture)
    }

    @Test func swiftEncodedRequestOmitsNilClient() throws {
        let request = TamagoRequest(text: "ping", requestId: UUID())
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        #expect(object?["client"] == nil)
        #expect(Set(object?.keys.map { $0 } ?? []) == ["protocolVersion", "requestId", "inputType", "text"])
    }

    // MARK: Responses

    @Test(arguments: FixtureLoader.entries(kind: "response"))
    func responseFixture(_ entry: FixtureLoader.Entry) throws {
        let response = try JSONDecoder().decode(TamagoResponse.self, from: FixtureLoader.data(entry.path))
        #expect(response.protocolVersion == TamagoProtocol.version)

        // `error` is present iff status == error (PROTOCOL_V1 §5).
        #expect((response.status == .error) == (response.error != nil))
        if let error = response.error {
            #expect(error.code != .unknown, "fixture uses a code Swift does not know")
            #expect(response.haptic == .failure, "all error envelopes use the failure haptic")
            #expect(!response.text.isEmpty)
        }

        // Text is empty only for `accepted`, and for a nonverbal `ok` reply, which
        // leaves both text and speechText empty (PROTOCOL_V1 §5.1).
        if response.status == .accepted { #expect(response.text.isEmpty) }
        if response.text.isEmpty {
            #expect(response.status == .accepted || (response.status == .ok && response.speechText.isEmpty))
        }

        // requestId is null only for errors raised before a UUID was read.
        if response.requestId == nil {
            #expect([.invalidRequest, .authFailed].contains(response.error?.code))
        } else {
            #expect(UUID(uuidString: response.requestId!) != nil)
        }

        switch entry.source {
        case "gateway":
            #expect(entry.httpStatus != nil)
            #expect(response.status != .accepted, "a V1 gateway never sends accepted over HTTP")
            #expect(TamagoCharacterState.reactionStates.contains(response.characterState))
            #expect(![.gatewayUnavailable, .disconnected].contains(response.error?.code),
                    "client-only error codes must not come from the gateway")
        case "client-synthesized":
            #expect(entry.httpStatus == nil)
        default:
            Issue.record("unknown fixture source \(entry.source)")
        }
    }

    /// Exact expectations per response fixture, so a silently changed fixture
    /// or a Swift enum raw-value typo fails here.
    static let expectedResponses: [String: (TamagoResponseStatus, TamagoCharacterState, TamagoHaptic, TamagoErrorCode?, Bool)] = [
        "responses/ok-success.json": (.ok, .idle, .click, nil, false),
        "responses/ok-happy.json": (.ok, .happy, .success, nil, false),
        "responses/ok-tool-success.json": (.ok, .success, .success, nil, false),
        "responses/ok-follow-up.json": (.ok, .confused, .notification, nil, true),
        "responses/ok-nonverbal.json": (.ok, .happy, .click, nil, false),
        "responses/error-timeout.json": (.error, .confused, .failure, .timeout, false),
        "responses/error-invalid-request-malformed.json": (.error, .confused, .failure, .invalidRequest, false),
        "responses/error-invalid-request-schema.json": (.error, .confused, .failure, .invalidRequest, false),
        "responses/error-unsupported-protocol.json": (.error, .confused, .failure, .unsupportedProtocol, false),
        "responses/error-auth-failed.json": (.error, .error, .failure, .authFailed, false),
        "responses/error-provider.json": (.error, .error, .failure, .providerError, false),
        "responses/error-provider-unavailable.json": (.error, .error, .failure, .providerUnavailable, false),
        "client/thinking-accepted.json": (.accepted, .thinking, .click, nil, false),
        "client/gateway-unavailable.json": (.error, .disconnected, .failure, .gatewayUnavailable, false),
        "client/disconnected.json": (.error, .disconnected, .failure, .disconnected, false),
        "client/timeout.json": (.error, .confused, .failure, .timeout, false),
    ]

    @Test func everyResponseFixtureHasExactExpectations() {
        let paths = Set(FixtureLoader.entries(kind: "response").map(\.path))
        #expect(paths == Set(Self.expectedResponses.keys))
    }

    @Test(arguments: FixtureLoader.entries(kind: "response"))
    func responseFixtureValues(_ entry: FixtureLoader.Entry) throws {
        let response = try JSONDecoder().decode(TamagoResponse.self, from: FixtureLoader.data(entry.path))
        let expected = try #require(Self.expectedResponses[entry.path])
        #expect(response.status == expected.0)
        #expect(response.characterState == expected.1)
        #expect(response.haptic == expected.2)
        #expect(response.error?.code == expected.3)
        #expect(response.followUpExpected == expected.4)
    }

    @Test func retryableFlagsMatchProtocolTable() throws {
        let retryable: [String: Bool] = [
            "responses/error-timeout.json": true,
            "responses/error-invalid-request-malformed.json": false,
            "responses/error-invalid-request-schema.json": false,
            "responses/error-unsupported-protocol.json": false,
            "responses/error-auth-failed.json": false,
            "responses/error-provider.json": true,
            "responses/error-provider-unavailable.json": true,
            "client/gateway-unavailable.json": true,
            "client/disconnected.json": true,
            "client/timeout.json": true,
        ]
        for (path, flag) in retryable {
            let response = try JSONDecoder().decode(TamagoResponse.self, from: FixtureLoader.data(path))
            #expect(response.error?.retryable == flag, "\(path)")
        }
    }

    @Test func toolSuccessSpeechDiffersFromText() throws {
        let response = try JSONDecoder().decode(
            TamagoResponse.self, from: FixtureLoader.data("responses/ok-tool-success.json"))
        #expect(response.text == "Jellyfin is back online.")
        #expect(response.speechText == "Done. Jellyfin is back online.")
    }

    // MARK: Protocol info + enum drift

    @Test(arguments: FixtureLoader.entries(kind: "protocolInfo"))
    func protocolInfoFixture(_ entry: FixtureLoader.Entry) throws {
        let info = try JSONDecoder().decode(TamagoProtocolInfo.self, from: FixtureLoader.data(entry.path))
        #expect(info.protocolVersion == 1)
        #expect(info.supportsThisClient)
        #expect(info.authRequired)
        #expect(!info.gatewayVersion.isEmpty)
    }

    private struct AdvertisedVocabulary: Decodable {
        let inputTypes: [String]
        let characterStates: [String]
        let reactionStates: [String]
        let haptics: [String]
        let errorCodes: [String]
    }

    @Test func swiftEnumsMatchGatewayVocabulary() throws {
        let vocab = try JSONDecoder().decode(
            AdvertisedVocabulary.self, from: FixtureLoader.data("responses/protocol-info.json"))

        #expect(vocab.inputTypes == [TamagoInputType.text.rawValue])
        #expect(vocab.characterStates == TamagoCharacterState.allCases.map(\.rawValue))
        #expect(Set(vocab.reactionStates) == Set(TamagoCharacterState.reactionStates.map(\.rawValue)))
        #expect(vocab.haptics == TamagoHaptic.allCases.map(\.rawValue))

        // Every advertised error code must be known to Swift (not `.unknown`)
        // and round-trip to the same raw value.
        for code in vocab.errorCodes {
            let decoded = try JSONDecoder().decode(TamagoErrorCode.self, from: Data("\"\(code)\"".utf8))
            #expect(decoded != .unknown, "Swift does not know error code \(code)")
            #expect(decoded.rawValue == code)
        }
    }

    // MARK: Forward compatibility (PROTOCOL_V1 §6–§8, §12)

    private func response(overriding fields: [String: Any]) throws -> TamagoResponse {
        var object = try #require(
            JSONSerialization.jsonObject(with: FixtureLoader.data("responses/error-provider.json")) as? [String: Any])
        for (key, value) in fields { object[key] = value }
        return try JSONDecoder().decode(TamagoResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }

    @Test func unknownCharacterStateDecodesAsIdle() throws {
        #expect(try response(overriding: ["characterState": "dancing"]).characterState == .idle)
    }

    @Test func unknownHapticDecodesAsNone() throws {
        #expect(try response(overriding: ["haptic": "buzz"]).haptic == TamagoHaptic.none)
    }

    @Test func unknownErrorCodeDecodesAsUnknown() throws {
        let error: [String: Any] = ["code": "quota_exceeded", "message": "x", "retryable": false]
        #expect(try response(overriding: ["error": error]).error?.code == .unknown)
    }

    @Test func unknownTopLevelFieldsAreIgnored() throws {
        let decoded = try response(overriding: ["futureField": ["nested": true], "latencyMs": 12])
        #expect(decoded.error?.code == .providerError)
    }

    @Test func unknownStatusIsADecodingError() throws {
        // `status` has no fallback in §5: a new status would be protocol v2.
        #expect(throws: DecodingError.self) { try response(overriding: ["status": "partial"]) }
    }

    // MARK: Stale-response guard

    @Test func answersMatchesOnlyTheSameRequest() throws {
        let response = try JSONDecoder().decode(
            TamagoResponse.self, from: FixtureLoader.data("responses/ok-happy.json"))
        let matching = TamagoRequest(text: "x", requestId: UUID(uuidString: "00000000-0000-4000-8000-000000000002")!)
        let other = TamagoRequest(text: "x", requestId: UUID(uuidString: "00000000-0000-4000-8000-000000000003")!)
        #expect(response.answers(matching))
        #expect(!response.answers(other))
    }

    @Test func answersIsCaseInsensitive() throws {
        var response = try JSONDecoder().decode(
            TamagoResponse.self, from: FixtureLoader.data("responses/ok-success.json"))
        response.requestId = "3F2B8C1E-9A4D-4E7B-8C2A-1D5E6F7A8B9C"
        let request = TamagoRequest(text: "x", requestId: UUID(uuidString: "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c")!)
        #expect(response.answers(request))
    }

    @Test func responseWithoutRequestIdAnswersNothing() throws {
        let response = try JSONDecoder().decode(
            TamagoResponse.self, from: FixtureLoader.data("responses/error-auth-failed.json"))
        #expect(response.requestId == nil)
        #expect(!response.answers(TamagoRequest(text: "x")))
    }
}
