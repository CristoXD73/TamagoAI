// TamagoProtocolV1.swift
//
// VERIFICATION: UNIT_TESTED_ONLY. Compiled with Xcode 27.0 / Swift 6.4; every
// fixture in Tests/Fixtures/protocol-v1 is decoded by
// Apple/Shared/Tests/TamagoSharedTests/ProtocolFixtureTests.swift (host + watchOS
// 27 simulator). Originally written in the cloud without a Swift
// toolchain.
//
// VERIFICATION (speechAudio, D-121): UNVERIFIED (written in the cloud, not compiled).
// VERIFICATION (longAnswer + conversation, D-127): UNVERIFIED (written in the cloud, not compiled).
//
// Mirrors docs/PROTOCOL_V1.md and Gateway/src/protocol.js. Enum raw values
// must match those files exactly. Pure Foundation, no UI or transport code.

import Foundation

public enum TamagoProtocol {
    public static let version = 1
}

// MARK: - Enums

public enum TamagoInputType: String, Codable, Sendable {
    case text
}

public enum TamagoResponseStatus: String, Codable, Sendable {
    case ok
    case accepted
    case error
}

public enum TamagoCharacterState: String, Codable, Sendable, CaseIterable {
    case sleeping
    case idle
    case listening
    case acknowledging
    case thinking
    case toolRunning
    case speaking
    case happy
    case success
    case confused
    case error
    case disconnected

    /// States a gateway may send. All others are driven locally by the Watch.
    public static let reactionStates: Set<TamagoCharacterState> = [.idle, .happy, .success, .confused, .error]

    /// Forward compatibility: an unknown value from a newer gateway decodes as
    /// `.idle` instead of failing the whole response.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TamagoCharacterState(rawValue: raw) ?? .idle
    }
}

public enum TamagoHaptic: String, Codable, Sendable, CaseIterable {
    case none
    case click
    case success
    case failure
    case notification
    case retry

    /// Unknown values decode as `.none`.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TamagoHaptic(rawValue: raw) ?? TamagoHaptic.none
    }
}

public enum TamagoErrorCode: String, Codable, Sendable {
    case invalidRequest = "invalid_request"
    case unsupportedProtocol = "unsupported_protocol"
    case authFailed = "auth_failed"
    case notFound = "not_found"
    case methodNotAllowed = "method_not_allowed"
    case payloadTooLarge = "payload_too_large"
    case internalError = "internal_error"
    case providerError = "provider_error"
    case providerUnavailable = "provider_unavailable"
    case timeout
    // Client-synthesized only; a gateway never sends these.
    case gatewayUnavailable = "gateway_unavailable"
    case disconnected
    /// Any code this client does not know yet.
    case unknown

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TamagoErrorCode(rawValue: raw) ?? .unknown
    }
}

// MARK: - Request

public struct TamagoClientInfo: Codable, Sendable, Equatable {
    public var device: String?
    public var route: String?
    public var appVersion: String?

    public init(device: String? = nil, route: String? = nil, appVersion: String? = nil) {
        self.device = device
        self.route = route
        self.appVersion = appVersion
    }
}

public struct TamagoRequest: Codable, Sendable, Equatable {
    public var protocolVersion: Int
    /// Lowercased UUID string. Generate a fresh one for every logical request,
    /// including user-initiated retries.
    public var requestId: String
    public var inputType: TamagoInputType
    public var text: String
    public var client: TamagoClientInfo?

    public init(text: String, requestId: UUID = UUID(), client: TamagoClientInfo? = nil) {
        self.protocolVersion = TamagoProtocol.version
        self.requestId = requestId.uuidString.lowercased()
        self.inputType = .text
        self.text = text
        self.client = client
    }
}

// MARK: - Response

public struct TamagoErrorInfo: Codable, Sendable, Equatable {
    public var code: TamagoErrorCode
    public var message: String
    public var retryable: Bool

    public init(code: TamagoErrorCode, message: String, retryable: Bool) {
        self.code = code
        self.message = message
        self.retryable = retryable
    }
}

/// PROTOCOL_V1 §16 (D-121): where to fetch the Mac-synthesized voice for a reply.
public struct TamagoSpeechAudio: Codable, Sendable, Equatable {
    /// Always `/v1/speech/<requestId>`, relative to the gateway's base URL.
    public var path: String
    /// `audio/mp4` (AAC, mono, 24 kHz).
    public var format: String
    /// Informational (e.g. `af_heart`).
    public var voice: String?

    public init(path: String, format: String = "audio/mp4", voice: String? = nil) {
        self.path = path
        self.format = format
        self.voice = voice
    }
}

/// D-127: this reply is a gist; the full answer is being written on the Mac and
/// will appear in the conversation (§18) as the turn with this `seq`.
public struct TamagoLongAnswer: Codable, Sendable, Equatable {
    /// `pending`, `ready` or `failed`.
    public var status: String
    public var seq: Int?

    public init(status: String, seq: Int? = nil) {
        self.status = status
        self.seq = seq
    }
}

public struct TamagoResponse: Codable, Sendable, Equatable {
    public var protocolVersion: Int
    /// Null only for errors raised before the gateway could read a request ID
    /// (malformed JSON, auth failure).
    public var requestId: String?
    public var status: TamagoResponseStatus
    public var text: String
    public var speechText: String
    public var characterState: TamagoCharacterState
    public var haptic: TamagoHaptic
    public var followUpExpected: Bool
    public var error: TamagoErrorInfo?
    /// Optional (§16): absent on old gateways, errors and nonverbal replies.
    public var speechAudio: TamagoSpeechAudio?
    /// Optional (D-127): present when the full answer comes later, on the phone.
    public var longAnswer: TamagoLongAnswer?

    /// Every response the gateway sends is decoded, not constructed (Codable
    /// synthesizes `init(from:)` for that; unaffected by this initializer).
    /// This one is for building a `TamagoResponse` in-process: the
    /// client-synthesized envelopes PROTOCOL_V1 §8 describes
    /// (`gateway_unavailable`, `disconnected`, client `timeout` — none of
    /// which ever arrive as JSON) and, in Stage A, the debug harness that
    /// previews reaction states without a gateway. `protocolVersion` is always
    /// `TamagoProtocol.version`; a response literally can't claim another one.
    public init(
        requestId: String?, status: TamagoResponseStatus, text: String, speechText: String,
        characterState: TamagoCharacterState, haptic: TamagoHaptic,
        followUpExpected: Bool = false, error: TamagoErrorInfo? = nil,
        speechAudio: TamagoSpeechAudio? = nil,
        longAnswer: TamagoLongAnswer? = nil
    ) {
        self.protocolVersion = TamagoProtocol.version
        self.requestId = requestId
        self.status = status
        self.text = text
        self.speechText = speechText
        self.characterState = characterState
        self.haptic = haptic
        self.followUpExpected = followUpExpected
        self.error = error
        self.speechAudio = speechAudio
        self.longAnswer = longAnswer
    }

    /// Stale-response guard: true only if this response belongs to `request`.
    /// Compare case-insensitively; the gateway lowercases IDs.
    public func answers(_ request: TamagoRequest) -> Bool {
        guard let requestId else { return false }
        return requestId.caseInsensitiveCompare(request.requestId) == .orderedSame
    }
}

// MARK: - Protocol info (GET /v1/protocol)

public struct TamagoProtocolInfo: Codable, Sendable {
    public var protocolVersion: Int
    public var supportedProtocolVersions: [Int]
    public var gatewayVersion: String
    public var authRequired: Bool
    /// Provider name (`mock`, `ollama`, …). Optional: older gateways omit it.
    public var provider: String?
    /// PROTOCOL_V1 §14; absent on an unpaired, loopback-only dev gateway.
    public var gatewayId: String?
    /// PROTOCOL_V1 §16; `["text", "speech-audio"]` when the Mac has a voice. Older gateways omit it.
    public var outputTypes: [String]?
    /// PROTOCOL_V1 §18 / D-127: `conversation`, `long-answers`. Older gateways omit it.
    public var features: [String]?

    public var supportsThisClient: Bool {
        supportedProtocolVersions.contains(TamagoProtocol.version)
    }
}

// MARK: - Conversation (PROTOCOL_V1 §18, D-127)

/// One exchange with Tamago, from the Watch or the phone, as the iPhone shows it.
public struct TamagoConversationTurn: Codable, Sendable, Equatable, Identifiable {
    /// Stable identity of the turn (a long answer keeps its `seq` when it's filled in).
    public var seq: Int
    /// Bumps when the turn changes (e.g. its long answer arrives).
    public var rev: Int
    public var requestId: String
    /// ISO 8601.
    public var at: String
    /// `watch` or `phone`.
    public var from: String
    /// What the owner said or typed.
    public var you: String
    /// Tamago's full reply (the long answer once it's ready).
    public var tamago: String
    /// What the Watch spoke, if anything.
    public var said: String
    public var long: TamagoLongAnswer?
    /// An error code when Tamago couldn't answer.
    public var error: String?
    /// `read_aloud` or `phone`: the owner's answer to a long-answer offer; `about` is that answer's `seq`.
    public var note: String?
    public var about: Int?

    public var id: Int { seq }
    /// The gateway writes `Date.toISOString()` (UTC, fractional seconds).
    public var date: Date? { try? Date(at, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) }
}

public struct TamagoConversationPage: Codable, Sendable, Equatable {
    public var turns: [TamagoConversationTurn]
    /// Pass as `after` next time. Smaller than what you sent means the Mac restarted: start over.
    public var latest: Int
}

// MARK: - Pairing (PROTOCOL_V1 §14)

public struct TamagoPairingRequest: Codable, Sendable, Equatable {
    public var pairingCode: String
    public var deviceName: String?

    public init(pairingCode: String, deviceName: String? = nil) {
        self.pairingCode = pairingCode
        self.deviceName = deviceName
    }
}

/// What a successful `POST /v1/pair` returns. `token` is the secret the Watch
/// stores in its Keychain and sends as the bearer token from then on.
public struct TamagoPairingGrant: Codable, Sendable, Equatable {
    public var protocolVersion: Int
    public var gatewayId: String
    public var gatewayName: String
    public var token: String

    public init(gatewayId: String, gatewayName: String, token: String) {
        self.protocolVersion = TamagoProtocol.version
        self.gatewayId = gatewayId
        self.gatewayName = gatewayName
        self.token = token
    }
}
