// CharacterInteractionController.swift
//
// VERIFICATION: UNIT_TESTED_ONLY (host + watchOS 27 simulator).
//
// D-103's "single @MainActor @Observable InteractionController" that owns
// CharacterState; views read it, nothing else stores character state. Stage A
// scope only: it applies events through CharacterStateMachine and records the
// effects for the debug UI to display. It does not execute effects (no
// transport, speech, or haptics exist yet — those are wired in later phases;
// see docs/HANDOFF_LOG.md for the exact next task).

import Foundation
import Observation

@MainActor
@Observable
public final class CharacterInteractionController {
    public private(set) var state: CharacterState
    /// Effects from the most recently applied event, for the debug UI to
    /// show. Not consumed/executed by anything in Stage A.
    public private(set) var lastEffects: [CharacterEffect] = []

    public init(state: CharacterState = .initial) {
        self.state = state
    }

    public func apply(_ event: CharacterEvent, now: Date = .now) {
        let (next, effects) = CharacterStateMachine.reduce(state, event: event, now: now)
        state = next
        lastEffects = effects
    }
}
