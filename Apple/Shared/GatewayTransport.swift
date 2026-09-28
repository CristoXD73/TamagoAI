// GatewayTransport.swift
//
// VERIFICATION: UNIT_TESTED_ONLY (host), plus real end-to-end runs against the
// live Node gateway from the SE 3 40 mm simulator (docs/HANDOFF_LOG.md). Not
// DEVICE_VERIFIED.
//
// VERIFICATION (speechAudio(path:), D-121): UNVERIFIED (written in the cloud, not compiled).
// VERIFICATION (conversation(after:), clearConversation(), D-127): UNVERIFIED (cloud, not compiled).
//
// Executes CharacterStateMachine's `.sendRequest`/`.cancelRequest` effects
// (D-103, D-115) and the pairing/reachability calls (D-116). Pure Foundation,
// URLSession only — deliberately: Apple TN3135 classes Network.framework,
// NWBrowser/NetService (Bonjour), NWPathMonitor and URLSession stream/WebSocket
// tasks as low-level networking, which a physical Watch blocks for ordinary
// apps (the simulator never does, so it can't catch this). Plain URLSession
// HTTP, including `.local` name resolution through the system resolver, is
// the high-level networking every watchOS app may use.
//
// Never throws: every call resolves to a value, using PROTOCOL_V1 §8's
// client-synthesized error codes for anything that isn't a real gateway
// answer, so CharacterStateMachine has one path (`.response`) for all outcomes.

import Foundation

public struct GatewayConfiguration: Sendable, Equatable {
    /// Where a paired Watch looks by default. The gateway publishes this mDNS
    /// hostname itself (Gateway/src/advertise.js), so nobody types an address.
    public static let wellKnownBaseURL = URL(string: "http://tamagoai.local:8787")!

    public var baseURL: URL
    /// Bearer token from pairing (Keychain on the Watch) or a developer
    /// override; `nil` only for a loopback `TAMAGO_ALLOW_NO_AUTH=1` dev gateway.
    public var authToken: String?
    public var requestTimeout: TimeInterval
    /// The gateway this Watch paired with. A different TamagoAI gateway
    /// answering the same name reads as `.wrongGateway`, not as "connected".
    /// This is a correctness check, not authentication: gatewayId is public.
    public var expectedGatewayId: String?

    /// D-107: gateway timeout 20 s + 5 s.
    /// A Mac address typed on the Watch, for networks where `tamagoai.local`
    /// can't be resolved from the Watch. Accepts `192.168.0.74`,
    /// `192.168.0.74:9000` or a full `http://…` URL; the port defaults to 8787.
    public static func manualBaseURL(from input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(" ") else { return nil }
        guard var parts = URLComponents(string: trimmed.contains("://") ? trimmed : "http://\(trimmed)"),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host, !host.isEmpty else { return nil }
        parts.scheme = scheme
        parts.port = parts.port ?? 8787
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    public init(baseURL: URL, authToken: String? = nil, requestTimeout: TimeInterval = 25, expectedGatewayId: String? = nil) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.requestTimeout = requestTimeout
        self.expectedGatewayId = expectedGatewayId
    }
}

/// One `GET /v1/health` result, distinguishing *why* a gateway isn't usable.
public enum GatewayProbe: Equatable, Sendable {
    case reachable(gatewayId: String?)
    /// The hostname didn't resolve — no TamagoAI Mac is publishing
    /// `tamagoai.local` on this network (or the Mac is asleep/off).
    case notFound
    /// Resolved but not answering, refused, timed out, or no network.
    case unreachable
    /// A TamagoAI gateway answered, but not the one this Watch paired with.
    case wrongGateway(found: String?)
}

public enum PairingOutcome: Equatable, Sendable {
    case paired(TamagoPairingGrant)
    case wrongCode
    /// No pairing window open: expired, already used, too many wrong codes,
    /// or the gateway doesn't pair (loopback dev mode).
    case closed
    /// With a short, human-readable reason ("Name not found: tamagoai.local"),
    /// so a failure on a real Watch says *which* step failed.
    case unreachable(String)
}

/// A request's response plus whether it actually came from the gateway —
/// a gateway-sent `timeout` still proves the Mac is there; a synthesized one
/// doesn't. TamagoConnection uses this so requests themselves establish
/// reachability instead of needing a separate poll.
public struct GatewayExchange: Equatable, Sendable {
    public var response: TamagoResponse
    public var reachedGateway: Bool
}

public actor GatewayClient {
    private let configuration: GatewayConfiguration
    /// How a request is performed. Production: a URLSession. Tests inject a
    /// stub here — watchOS doesn't honor custom `URLProtocol` classes on a
    /// session, so protocol-level mocking only ever worked on the host.
    public typealias Fetch = @Sendable (URLRequest) async throws -> (Data, URLResponse)
    private let fetch: Fetch
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(configuration: GatewayConfiguration, session: URLSession = GatewayClient.defaultSession) {
        self.init(configuration: configuration, fetch: { try await session.data(for: $0) })
    }

    public init(configuration: GatewayConfiguration, fetch: @escaping Fetch) {
        self.configuration = configuration
        self.fetch = fetch
    }

    /// D-107: ephemeral, no cookies or cache, fail fast rather than wait for
    /// connectivity, request 25 s / resource 30 s.
    public static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    /// POSTs to `/v1/request`. Always returns a `TamagoResponse`.
    public func send(_ request: TamagoRequest) async -> TamagoResponse {
        await exchange(request).response
    }

    public func exchange(_ request: TamagoRequest) async -> GatewayExchange {
        var urlRequest = URLRequest(url: configuration.baseURL.appendingPathComponent("v1/request"),
                                    timeoutInterval: configuration.requestTimeout)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        guard let body = try? encoder.encode(request) else {
            return GatewayExchange(response: synthesized(for: request.requestId, code: .gatewayUnavailable, message: "Could not encode request."), reachedGateway: false)
        }
        urlRequest.httpBody = body
        return await perform(urlRequest, requestId: request.requestId)
    }

    /// POST `/v1/audio` (PROTOCOL_V1 §15): hold-to-talk. The Mac transcribes
    /// the recording on-device and answers exactly like `/v1/request`.
    public func exchangeAudio(_ audio: Data, contentType: String = "audio/mp4", requestId: String) async -> GatewayExchange {
        var urlRequest = URLRequest(url: configuration.baseURL.appendingPathComponent("v1/audio"),
                                    timeoutInterval: configuration.requestTimeout)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue(contentType, forHTTPHeaderField: "content-type")
        urlRequest.setValue(requestId, forHTTPHeaderField: "x-tamago-request-id")
        urlRequest.setValue(String(TamagoProtocol.version), forHTTPHeaderField: "x-tamago-protocol-version")
        urlRequest.httpBody = audio
        return await perform(urlRequest, requestId: requestId)
    }

    private func perform(_ request: URLRequest, requestId: String) async -> GatewayExchange {
        var urlRequest = request
        if let token = configuration.authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        let data: Data
        do {
            data = try await fetch(urlRequest).0
        } catch let error as URLError where error.code == .timedOut {
            return GatewayExchange(response: synthesized(for: requestId, code: .timeout, message: "No answer within \(Int(configuration.requestTimeout))s."), reachedGateway: false)
        } catch {
            return GatewayExchange(response: synthesized(for: requestId, code: .gatewayUnavailable, message: "Gateway is not reachable."), reachedGateway: false)
        }
        guard let response = try? decoder.decode(TamagoResponse.self, from: data) else {
            // Something answered, but not in protocol v1 — treat as unusable.
            return GatewayExchange(response: synthesized(for: requestId, code: .gatewayUnavailable, message: "Gateway returned an unreadable response."), reachedGateway: false)
        }
        return GatewayExchange(response: response, reachedGateway: true)
    }

    /// GET `/v1/speech/<id>` (PROTOCOL_V1 §16): the Mac-synthesized voice for a
    /// reply. Returns nil on anything but a 200 audio answer within `timeout`
    /// (the ~2.5 s budget), so the caller falls back to the built-in voice.
    /// Only paths of the documented shape are fetched: the gateway can't point
    /// the Watch anywhere else.
    public func speechAudio(path: String, timeout: TimeInterval = 2.5) async -> Data? {
        let prefix = "/v1/speech/"
        guard path.hasPrefix(prefix) else { return nil }
        let id = String(path.dropFirst(prefix.count))
        guard UUID(uuidString: id) != nil else { return nil }
        var urlRequest = URLRequest(url: configuration.baseURL.appendingPathComponent("v1/speech").appendingPathComponent(id),
                                    timeoutInterval: timeout)
        urlRequest.httpMethod = "GET"
        if let token = configuration.authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        guard let (data, response) = try? await fetch(urlRequest),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              (http.value(forHTTPHeaderField: "content-type") ?? "").lowercased().hasPrefix("audio/"),
              !data.isEmpty else { return nil }
        return data
    }

    /// GET `/v1/conversation?after=` (PROTOCOL_V1 §18): what the iPhone shows.
    /// nil when the Mac can't be reached or answers anything but a page.
    public func conversation(after: Int = 0, timeout: TimeInterval = 10) async -> TamagoConversationPage? {
        var components = URLComponents(url: configuration.baseURL.appendingPathComponent("v1/conversation"),
                                       resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "after", value: String(max(0, after)))]
        guard let url = components?.url else { return nil }
        var urlRequest = URLRequest(url: url, timeoutInterval: timeout)
        urlRequest.httpMethod = "GET"
        if let token = configuration.authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        guard let (data, response) = try? await fetch(urlRequest),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? decoder.decode(TamagoConversationPage.self, from: data)
    }

    /// DELETE `/v1/conversation`: the owner clears it from the phone. True when the Mac confirmed.
    public func clearConversation() async -> Bool {
        var urlRequest = URLRequest(url: configuration.baseURL.appendingPathComponent("v1/conversation"), timeoutInterval: 10)
        urlRequest.httpMethod = "DELETE"
        if let token = configuration.authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        guard let (_, response) = try? await fetch(urlRequest) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    /// GET `/v1/health`, classified. Never used on the request path itself.
    public func probe() async -> GatewayProbe {
        var urlRequest = URLRequest(url: configuration.baseURL.appendingPathComponent("v1/health"),
                                    timeoutInterval: 3) // D-107 probe timeout
        urlRequest.httpMethod = "GET"
        let data: Data
        let response: URLResponse
        do {
            let result = try await fetch(urlRequest)
            data = result.0
            response = result.1
        } catch let error as URLError where error.code == .cannotFindHost || error.code == .dnsLookupFailed {
            return .notFound
        } catch {
            return .unreachable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return .unreachable }
        let found = (try? decoder.decode(HealthBody.self, from: data))?.gatewayId
        if let expected = configuration.expectedGatewayId, found != expected {
            return .wrongGateway(found: found)
        }
        return .reachable(gatewayId: found)
    }

    /// POST `/v1/pair` (PROTOCOL_V1 §14). No bearer token: this is how one is obtained.
    public func pair(code: String, deviceName: String? = nil) async -> PairingOutcome {
        var urlRequest = URLRequest(url: configuration.baseURL.appendingPathComponent("v1/pair"),
                                    timeoutInterval: min(configuration.requestTimeout, 10))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        urlRequest.httpBody = try? encoder.encode(TamagoPairingRequest(pairingCode: code, deviceName: deviceName))
        let data: Data
        let response: URLResponse
        do {
            let result = try await fetch(urlRequest)
            data = result.0
            response = result.1
        } catch {
            return .unreachable(Self.describe(error, host: configuration.baseURL.host))
        }
        let status = (response as? HTTPURLResponse)?.statusCode
        switch status {
        case 200:
            guard let grant = try? decoder.decode(TamagoPairingGrant.self, from: data) else {
                return .unreachable("Unreadable answer from \(configuration.baseURL.host ?? "the Mac")")
            }
            return .paired(grant)
        case 401: return .wrongCode
        case 404, 410: return .closed
        default: return .unreachable("Unexpected answer (HTTP \(status.map(String.init) ?? "none"))")
        }
    }

    /// Short reason for a transport failure, naming the host that was tried.
    public static func describe(_ error: Error, host: String?) -> String {
        let target = host ?? "the Mac"
        guard let urlError = error as? URLError else {
            let ns = error as NSError
            return "Network error \(ns.domain) \(ns.code)"
        }
        switch urlError.code {
        case .cannotFindHost, .dnsLookupFailed: return "Name not found: \(target)"
        case .cannotConnectToHost: return "Connection refused by \(target)"
        case .timedOut: return "No answer from \(target)"
        case .notConnectedToInternet: return "The Watch has no network connection"
        case .networkConnectionLost: return "Connection to \(target) dropped"
        case .appTransportSecurityRequiresSecureConnection: return "Blocked by App Transport Security"
        default: return "Network error \(urlError.code.rawValue) reaching \(target)"
        }
    }

    /// GET `/v1/protocol`, for diagnostics (provider name, gatewayId).
    public func protocolInfo() async -> TamagoProtocolInfo? {
        let url = configuration.baseURL.appendingPathComponent("v1/protocol")
        guard let (data, _) = try? await fetch(URLRequest(url: url, timeoutInterval: 5)) else { return nil }
        return try? decoder.decode(TamagoProtocolInfo.self, from: data)
    }

    private struct HealthBody: Decodable {
        var gatewayId: String?
    }

    private func synthesized(for requestId: String, code: TamagoErrorCode, message: String) -> TamagoResponse {
        TamagoResponse(
            requestId: requestId, status: .error, text: "", speechText: "",
            characterState: .idle, haptic: .none, followUpExpected: false,
            error: TamagoErrorInfo(code: code, message: message, retryable: true)
        )
    }
}
