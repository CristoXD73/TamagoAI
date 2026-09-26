// ConnectionModel.swift
//
// VERIFICATION: UNIT_TESTED_ONLY (ConnectionModelTests). Pure: no clock, no
// I/O. docs/DECISIONS.md D-116.
//
// Three small, deterministic pieces the Watch's platform layer drives:
// - TransportState: the Mac link's phase and its probe backoff. Event-driven
//   first (scene activation, request outcomes); polling only while the Mac
//   is missing, backing off, never while connected.
// - CreatureSemanticState: the eight names the product talks about, derived
//   from the canonical visual state (D-103) plus the link — not a second
//   state machine, and not visible UI.
// - CreatureSoundCue: the nonverbal vocabulary and which transitions may
//   use it (CREATURE_SPEC §9.3).

import Foundation

public struct TransportState: Equatable, Sendable {
    public enum Phase: String, Sendable, CaseIterable {
        /// Never reached the gateway yet (not found, or not answering).
        case searching
        /// First contact in flight.
        case connecting
        case connected
        /// Was connected, lost it, retrying quickly.
        case reconnecting
        /// `offlineAfterFailures` consecutive failures; retrying slowly.
        case offline
    }

    public enum Event: Equatable, Sendable {
        case probeStarted
        case reachable
        case unreachable
    }

    public static let offlineAfterFailures = 3
    /// Seconds to wait before the next probe after N consecutive failures —
    /// D-107's schedule (5 s → 15 s → 60 s cap). A connected link isn't
    /// polled at all (D-116): the next request, or the next time the app
    /// becomes active, is the check.
    public static let backoffSeconds: [TimeInterval] = [5, 15, 60]

    public private(set) var phase: Phase = .searching
    public private(set) var consecutiveFailures = 0
    public private(set) var hasEverConnected = false

    public init() {}

    public mutating func apply(_ event: Event) {
        switch event {
        case .probeStarted:
            if phase == .searching, consecutiveFailures == 0 { phase = .connecting }
        case .reachable:
            phase = .connected
            consecutiveFailures = 0
            hasEverConnected = true
        case .unreachable:
            consecutiveFailures += 1
            if consecutiveFailures >= Self.offlineAfterFailures {
                phase = .offline
            } else {
                phase = hasEverConnected ? .reconnecting : .searching
            }
        }
    }

    /// `nil` while connected (no polling). Otherwise the backoff delay,
    /// `0` before the very first probe.
    public var nextProbeDelay: TimeInterval? {
        if phase == .connected { return nil }
        guard consecutiveFailures > 0 else { return 0 }
        return Self.backoffSeconds[min(consecutiveFailures - 1, Self.backoffSeconds.count - 1)]
    }
}

/// The product's semantic creature states. Derived, never stored: the
/// creature will embody these through owner-approved motion later; today they
/// exist for correctness, tests and DEBUG diagnostics only.
public enum CreatureSemanticState: String, Sendable, CaseIterable {
    case idle, listening, sending, thinking, receiving, speaking, offline, recovering

    public static func derive(visual: TamagoCharacterState, link: TransportState.Phase) -> CreatureSemanticState {
        switch visual {
        case .listening: return .listening
        case .acknowledging: return .sending
        case .thinking, .toolRunning: return .thinking
        case .speaking: return .speaking
        // An answer arrived and the creature is reacting to it.
        case .happy, .success, .confused, .error: return .receiving
        case .disconnected: return isRetrying(link) ? .recovering : .offline
        case .idle, .sleeping:
            switch link {
            case .offline: return .offline
            case .reconnecting: return .recovering
            case .searching, .connecting, .connected: return .idle
            }
        }
    }

    private static func isRetrying(_ link: TransportState.Phase) -> Bool {
        link == .reconnecting || link == .connecting
    }
}

/// The nonverbal vocabulary. Six names so final assets can drop in by name;
/// only three are wired to transitions, because CREATURE_SPEC §9.3 (owner
/// decision, D-009) lists sounds only for listening, acknowledging and
/// success — and forbids idle-life sounds outright ("none: idle life: no
/// idle sounds, ever"). `thinking`, `uncertain` and `sleepy` exist for
/// explicit, owner-approved uses later; nothing plays them automatically.
public enum CreatureSoundCue: String, Sendable, CaseIterable {
    case acknowledge, curious, thinking, pleased, uncertain, sleepy

    public static func cue(from old: TamagoCharacterState, to new: TamagoCharacterState) -> CreatureSoundCue? {
        guard old != new else { return nil }
        switch new {
        case .listening: return .curious        // spec: soft bloop — listening begins
        case .acknowledging: return .acknowledge // spec: tiny pop — acknowledging bubble
        case .happy, .success: return .pleased   // spec: rising burble — success bloom
        default: return nil
        }
    }
}
