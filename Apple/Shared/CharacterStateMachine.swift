// CharacterStateMachine.swift
//
// VERIFICATION: UNIT_TESTED_ONLY. Phase 4 (Stage A), Xcode 27.0 / Swift 6.4.
// Covered by Apple/Shared/Tests/TamagoSharedTests/CharacterStateMachineTests.swift
// (host + watchOS 27 simulator).
//
// Implements the canonical state machine decided in docs/DECISIONS.md D-103:
// one pure reducer, no competing UI booleans, stale-response protection lives
// here (not in views or transports). The reducer does no I/O and reads no
// clock; the caller passes `now` in with each event.

import Foundation

/// The one piece of state that decides what the character looks like and
/// whether a network response is still relevant. `visual` is the wire enum
/// itself (D-103: "the existing wire enum is the canonical visual state").
public struct CharacterState: Equatable, Sendable {
    public var visual: TamagoCharacterState
    /// The lowercased request ID this state is waiting on, if any. `nil`
    /// whenever there is nothing in flight to be stale-checked against.
    public var activeRequestID: String?
    /// When the reducer produced this state. Renderers (D-102) measure
    /// animation timing as `now - enteredAt`, so every legal transition
    /// refreshes it (including a same-state transition, e.g. `cancel` while
    /// already idle, which is harmless for a looping idle animation).
    public var enteredAt: Date
    /// Copied from the most recent final response (PROTOCOL_V1 §5). Not acted
    /// on by Stage A's debug UI; carried for the "tap to answer" affordance a
    /// later phase builds on top of this reducer.
    public var followUpExpected: Bool

    /// Where `.speaking` lands once speech ends, captured from the response
    /// that started it. Not a competing source of truth: it is derived once
    /// (when entering `.speaking`) and consumed exactly once (leaving it), and
    /// nothing outside the reducer reads or sets it. Internal on purpose —
    /// `TagamoShared`'s public initializer below never exposes it, so callers
    /// can't fake a pending reaction; it can only be produced by `reduce`.
    var pendingReaction: TamagoCharacterState?

    public init(visual: TamagoCharacterState, activeRequestID: String?, enteredAt: Date, followUpExpected: Bool) {
        self.visual = visual
        self.activeRequestID = activeRequestID
        self.enteredAt = enteredAt
        self.followUpExpected = followUpExpected
        self.pendingReaction = nil
    }

    /// `idle`, nothing in flight. What the app starts in and returns to.
    public static let initial = CharacterState(visual: .idle, activeRequestID: nil, enteredAt: .distantPast, followUpExpected: false)
}

/// Inputs to the reducer. Carries only the data a transition needs; never a
/// timestamp (that's `reduce`'s `now:` parameter) and never a full
/// `TamagoRequest` for matching (see `CharacterState.activeRequestID`).
public enum CharacterEvent: Sendable, Equatable {
    /// Deliberate "start listening" trigger (Crown press, tap on the character).
    case userActivated
    /// Any user input that should wake the character without starting capture
    /// (e.g. a tap or wrist raise while `.sleeping`).
    case wake
    case inactivityTimeout
    /// System dictation returned. Empty text is treated like a cancel. A new,
    /// caller-generated ID becomes `activeRequestID` and is used to build the
    /// `TamagoRequest` in the `sendRequest` effect.
    case transcript(text: String, requestId: UUID)
    case ackBeatElapsed
    /// Progress on the in-flight request (future: gateway tool progress).
    case toolProgress(requestId: String)
    /// A transport response. Dropped unless the current state accepts it
    /// *and* its `requestId` matches `activeRequestID` — the stale-response guard.
    case response(TamagoResponse)
    case speechFinished
    case speechCancelled
    /// The reaction's hold/animation has finished (`SpriteAnimationClock.isFinished`
    /// or a ~2.5 s hold, decided by the caller — the reducer reads no clock).
    case reactionFinished
    /// Crown/back/tap-to-stop, or any other user-initiated cancel.
    case cancel
    /// Scene phase → `.background` (D-104).
    case backgrounded
    case routeLost
    case routeRestored
}

/// Side effects the reducer asks the caller to perform. The reducer never
/// performs them itself.
public enum CharacterEffect: Sendable, Equatable {
    case sendRequest(TamagoRequest)
    case cancelRequest
    case speak(text: String)
    case stopSpeech
    case playHaptic(TamagoHaptic)
    /// Declared for D-103/D-105 completeness; **not emitted in Stage A**
    /// (complication work is out of scope until Phase 6, which also adds the
    /// App Group the widget reads from).
    case updateComplicationSnapshot(TamagoCharacterState)
}

/// The canonical, pure reducer. No timers, no networking, no UI state.
public enum CharacterStateMachine {
    /// Visual states `userActivated` may fire from, and what `reactionFinished`
    /// returns to `idle` from. Distinct from `TamagoCharacterState.reactionStates`
    /// (the *wire* vocabulary a gateway may send, which also includes `idle`).
    public static let reactionMoods: Set<TamagoCharacterState> = [.happy, .success, .confused, .error]

    private static let awaitingResponseMoods: Set<TamagoCharacterState> = [.acknowledging, .thinking, .toolRunning]

    /// Applies one event to one state. Returns the (possibly unchanged) next
    /// state and the effects to perform. An event with no legal transition
    /// from the current state is ignored: same state, no effects, and a debug
    /// print naming the dropped event so illegal transitions aren't silent
    /// during development.
    public static func reduce(_ state: CharacterState, event: CharacterEvent, now: Date) -> (CharacterState, [CharacterEffect]) {
        switch event {
        case .userActivated:
            guard canActivate(state.visual) else { return ignored(state, event) }
            return (CharacterState(visual: .listening, activeRequestID: nil, enteredAt: now, followUpExpected: false),
                    [.playHaptic(.click)])

        case .wake:
            guard state.visual == .sleeping else { return ignored(state, event) }
            return (idle(now: now), [])

        case .inactivityTimeout:
            guard state.visual == .idle else { return ignored(state, event) }
            return (with(state, visual: .sleeping, now: now), [])

        case let .transcript(text, requestId):
            guard state.visual == .listening else { return ignored(state, event) }
            guard !text.isEmpty else { return (idle(now: now), []) }
            let request = TamagoRequest(text: text, requestId: requestId)
            var next = with(state, visual: .acknowledging, now: now)
            next.activeRequestID = request.requestId
            return (next, [.sendRequest(request)])

        case .ackBeatElapsed:
            guard state.visual == .acknowledging else { return ignored(state, event) }
            return (with(state, visual: .thinking, now: now), [])

        case let .toolProgress(requestId):
            guard state.visual == .thinking, matches(requestId, state.activeRequestID) else { return ignored(state, event) }
            return (with(state, visual: .toolRunning, now: now), [])

        case let .response(response):
            guard awaitingResponseMoods.contains(state.visual),
                  matches(response.requestId, state.activeRequestID)
            else { return ignored(state, event) }
            return handle(response, from: state, now: now)

        case .speechFinished, .speechCancelled:
            guard state.visual == .speaking else { return ignored(state, event) }
            var next = with(state, visual: state.pendingReaction ?? .idle, now: now)
            next.pendingReaction = nil
            return (next, [])

        case .reactionFinished:
            guard reactionMoods.contains(state.visual) else { return ignored(state, event) }
            return (idle(now: now), [])

        case .cancel, .backgrounded:
            // Legal from any state, including a no-op from `.idle`.
            return (idle(now: now), [.cancelRequest, .stopSpeech])

        case .routeLost:
            guard state.visual == .idle || state.visual == .sleeping else { return ignored(state, event) }
            return (with(state, visual: .disconnected, now: now), [])

        case .routeRestored:
            guard state.visual == .disconnected else { return ignored(state, event) }
            return (idle(now: now), [])
        }
    }

    // MARK: - Transition helpers

    private static func canActivate(_ visual: TamagoCharacterState) -> Bool {
        visual == .idle || visual == .sleeping || visual == .disconnected || reactionMoods.contains(visual)
    }

    private static func handle(_ response: TamagoResponse, from state: CharacterState, now: Date) -> (CharacterState, [CharacterEffect]) {
        guard response.status != .accepted else {
            return (with(state, visual: .thinking, now: now), [])
        }

        // Final (ok or error): PROTOCOL_V1 §5.
        var next = with(state, visual: state.visual, now: now)
        next.followUpExpected = response.followUpExpected
        let mood = reactionMood(for: response)
        if response.speechText.isEmpty {
            next.visual = mood
            next.pendingReaction = nil
            return (next, [.playHaptic(response.haptic)])
        } else {
            next.visual = .speaking
            next.pendingReaction = mood
            return (next, [.playHaptic(response.haptic), .speak(text: response.speechText)])
        }
    }

    /// `reaction(r)` from D-103: `r.characterState` if it's a reaction state,
    /// else `idle`. In practice the gateway only ever sends reaction states
    /// (enforced server-side) and unknown values already decode as `.idle`
    /// (TamagoCharacterState's forward-compatible `init(from:)`), so this is a
    /// defensive fallback, not the common path.
    private static func reactionMood(for response: TamagoResponse) -> TamagoCharacterState {
        TamagoCharacterState.reactionStates.contains(response.characterState) ? response.characterState : .idle
    }

    private static func matches(_ candidate: String?, _ active: String?) -> Bool {
        guard let candidate, let active else { return false }
        return candidate.caseInsensitiveCompare(active) == .orderedSame
    }

    private static func idle(now: Date) -> CharacterState {
        CharacterState(visual: .idle, activeRequestID: nil, enteredAt: now, followUpExpected: false)
    }

    private static func with(_ state: CharacterState, visual: TamagoCharacterState, now: Date) -> CharacterState {
        var next = state
        next.visual = visual
        next.enteredAt = now
        return next
    }

    private static func ignored(_ state: CharacterState, _ event: CharacterEvent) -> (CharacterState, [CharacterEffect]) {
        #if DEBUG
        print("CharacterStateMachine: ignored \(event) while in \(state.visual)")
        #endif
        return (state, [])
    }
}
