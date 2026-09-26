// GatewayTransport.swift
//
// VERIFICATION: UNIT_TESTED_ONLY (host), plus real end-to-end runs against the
// live Node gateway from the SE 3 40 mm simulator (docs/HANDOFF_LOG.md). Not
// DEVICE_VERIFIED.
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
    case unreachable
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
        if let token = configuration.authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        guard let body = try? encoder.encode(request) else {
            return GatewayExchange(response: synthesized(for: request, code: .gatewayUnavailable, message: "Could not encode request."), reachedGateway: false)
        }
        urlRequest.httpBody = body

        let data: Data
        do {
            data = try await fetch(urlRequest).0
        } catch let error as URLError where error.code == .timedOut {
            return GatewayExchange(response: synthesized(for: request, code: .timeout, message: "No answer within \(Int(configuration.requestTimeout))s."), reachedGateway: false)
        } catch {
            return GatewayExchange(response: synthesized(for: request, code: .gatewayUnavailable, message: "Gateway is not reachable."), reachedGateway: false)
        }
        guard let response = try? decoder.decode(TamagoResponse.self, from: data) else {
            // Something answered, but not in protocol v1 — treat as unusable.
            return GatewayExchange(response: synthesized(for: request, code: .gatewayUnavailable, message: "Gateway returned an unreadable response."), reachedGateway: false)
        }
        return GatewayExchange(response: response, reachedGateway: true)
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
            return .unreachable
        }
        switch (response as? HTTPURLResponse)?.statusCode {
        case 200:
            guard let grant = try? decoder.decode(TamagoPairingGrant.self, from: data) else { return .unreachable }
            return .paired(grant)
        case 401: return .wrongCode
        case 404, 410: return .closed
        default: return .unreachable
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

    private func synthesized(for request: TamagoRequest, code: TamagoErrorCode, message: String) -> TamagoResponse {
        TamagoResponse(
            requestId: request.requestId, status: .error, text: "", speechText: "",
            characterState: .idle, haptic: .none, followUpExpected: false,
            error: TamagoErrorInfo(code: code, message: message, retryable: true)
        )
    }
}
