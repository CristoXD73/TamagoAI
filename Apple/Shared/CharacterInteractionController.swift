// CharacterInteractionController.swift
//
// VERIFICATION: UNIT_TESTED_ONLY (host + watchOS 27 simulator).
//
// D-103's "single @MainActor @Observable InteractionController" that owns
// CharacterState; views read it, nothing else stores character state. It
// applies events through CharacterStateMachine and records the effects for
// the debug UI to display. It still does not execute effects itself — that
// stays the platform layer's job (WatchApp's TamagoConnection, added once
// transport/haptics existed; see docs/HANDOFF_LOG.md) — but `onEffects` gives
// that layer a way to react to every `apply` call, not just inspect the
// latest one after the fact.

import Foundation
import Observation

@MainActor
@Observable
public final class CharacterInteractionController {
    public private(set) var state: CharacterState
    /// Effects from the most recently applied event, for the debug UI to
    /// show. Not consumed/executed by anything here.
    public private(set) var lastEffects: [CharacterEffect] = []
    /// Called synchronously, on the main actor, right after each `apply`
    /// with that call's effects (possibly empty). The platform layer sets
    /// this once to execute effects (network, haptics, speech) without every
    /// call site having to remember to. Purely a notification seam — this
    /// class still performs no I/O itself.
    public var onEffects: (([CharacterEffect]) -> Void)?

    public init(state: CharacterState = .initial) {
        self.state = state
    }

    public func apply(_ event: CharacterEvent, now: Date = .now) {
        let (next, effects) = CharacterStateMachine.reduce(state, event: event, now: now)
        state = next
        lastEffects = effects
        onEffects?(effects)
    }
}
