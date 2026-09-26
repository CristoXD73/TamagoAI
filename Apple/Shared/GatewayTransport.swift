// GatewayTransport.swift
//
// VERIFICATION: UNIT_TESTED_ONLY (host), plus one real end-to-end run against
// the live Node gateway on the SE 3 40 mm simulator (see docs/HANDOFF_LOG.md
// for the exact command and observed result). Not yet DEVICE_VERIFIED — a
// physical Watch can't use `127.0.0.1` to reach a Mac on the LAN; it needs the
// Mac's real address (see `GatewayConfiguration`).
//
// The transport CharacterInteractionController's `.sendRequest`/`.cancelRequest`
// effects were designed for (docs/DECISIONS.md D-103) but never implemented —
// "Voice, transport, and TTS are not wired yet" per TamagoWatchApp.swift. This
// is pure Foundation (no WatchKit) so it's testable on the host; the Watch app
// layer owns turning `CharacterEffect`s into calls here (see WatchApp's
// TamagoConnection.swift, which is not part of this package because it needs
// WatchKit for haptics).
//
// Never throws: every call resolves to a `TamagoResponse`, using PROTOCOL_V1
// §8's client-synthesized error codes (`gatewayUnavailable`, `timeout`) for
// anything that isn't a real answer from the gateway, so
// `CharacterStateMachine` has exactly one path (the `.response` event) to
// react to, whether the gateway answered, errored, or was unreachable.

import Foundation

public struct GatewayConfiguration: Sendable, Equatable {
    /// The gateway's base URL, e.g. `http://127.0.0.1:8787` (works from the
    /// Watch *simulator*, which shares the host Mac's loopback interface) or
    /// `http://192.168.1.23:8787` (required on a physical Watch — it is a
    /// separate device on the LAN and cannot reach the Mac via loopback).
    public var baseURL: URL
    /// Bearer token; `nil` matches a gateway started with
    /// `TAMAGO_ALLOW_NO_AUTH=1` (loopback-only dev mode — see
    /// `Gateway/src/config.js`). Never hardcode a real token here; read it
    /// from configuration the owner supplies at runtime.
    public var authToken: String?
    public var requestTimeout: TimeInterval

    public init(baseURL: URL, authToken: String? = nil, requestTimeout: TimeInterval = 20) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.requestTimeout = requestTimeout
    }
}

/// Talks to exactly the three routes `Gateway/src/server.js` exposes.
/// One instance per configuration; safe to share across concurrent requests
/// (each `send` builds its own `URLRequest`).
public actor GatewayClient {
    private let configuration: GatewayConfiguration
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(configuration: GatewayConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    /// POSTs to `/v1/request`. Always returns a `TamagoResponse` — see the
    /// file header for why this never throws.
    public func send(_ request: TamagoRequest) async -> TamagoResponse {
        let url = configuration.baseURL.appendingPathComponent("v1/request")
        var urlRequest = URLRequest(url: url, timeoutInterval: configuration.requestTimeout)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        if let token = configuration.authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        do {
            urlRequest.httpBody = try encoder.encode(request)
        } catch {
            // Can't happen for a well-formed TamagoRequest, but never throw.
            return synthesized(for: request, code: .gatewayUnavailable, message: "Could not encode request.")
        }

        do {
            let (data, _) = try await session.data(for: urlRequest)
            return try decoder.decode(TamagoResponse.self, from: data)
        } catch let error as URLError where error.code == .timedOut {
            return synthesized(for: request, code: .timeout, message: "No answer within \(Int(configuration.requestTimeout))s.")
        } catch is URLError {
            return synthesized(for: request, code: .gatewayUnavailable, message: "Gateway is not reachable.")
        } catch is DecodingError {
            return synthesized(for: request, code: .gatewayUnavailable, message: "Gateway returned an unreadable response.")
        } catch {
            return synthesized(for: request, code: .gatewayUnavailable, message: "Gateway request failed.")
        }
    }

    /// GET `/v1/health`. Used for proactive reachability (see WatchApp's
    /// reachability monitor) — never for the actual request/response path.
    public func checkHealth() async -> Bool {
        let url = configuration.baseURL.appendingPathComponent("v1/health")
        var urlRequest = URLRequest(url: url, timeoutInterval: min(configuration.requestTimeout, 5))
        urlRequest.httpMethod = "GET"
        do {
            let (_, response) = try await session.data(for: urlRequest)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func synthesized(for request: TamagoRequest, code: TamagoErrorCode, message: String) -> TamagoResponse {
        TamagoResponse(
            requestId: request.requestId, status: .error, text: "", speechText: "",
            characterState: .idle, haptic: .none, followUpExpected: false,
            error: TamagoErrorInfo(code: code, message: message, retryable: true)
        )
    }
}
