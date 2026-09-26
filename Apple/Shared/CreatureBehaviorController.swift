// CreatureBehaviorController.swift
//
// VERIFICATION: UNVERIFIED for controller/UI integration after the audit.
// Pure engine rules are UNIT_TESTED_ONLY; see CreatureBehaviorEngineTests.
//
// The creature-world counterpart to CharacterInteractionController: a single
// @MainActor @Observable owner of CreatureWorldState (docs/DECISIONS.md
// D-114). CharacterView reads it; nothing else stores creature-world
// state. It applies CreatureBehaviorEngine's pure functions and holds no
// timer — CharacterView drives `tick(now:)` from the TimelineView tick
// it already has for D-102's animation, only while the network state is
// `.idle` and the environment is live.

import Foundation
import Observation

@MainActor
@Observable
public final class CreatureBehaviorController {
    public private(set) var state: CreatureWorldState

    public init(now: Date = .now, seed: UInt64 = 0x5EED_5EED) {
        self.state = CreatureBehaviorEngine.initial(now: now, seed: seed)
    }

    public func tick(now: Date) {
        let next = CreatureBehaviorEngine.advance(state, to: now)
        if next != state { state = next }
    }

    public func tap(at point: Point2D, now: Date = .now) {
        state = CreatureBehaviorEngine.applyTap(state, at: point, now: now)
    }

    #if DEBUG
    public func debugForce(_ command: CreatureDebugCommand, now: Date = .now) {
        state = CreatureBehaviorEngine.debugForce(command, from: state, now: now)
    }
    #endif

    public func position(at now: Date) -> Point2D {
        CreatureBehaviorEngine.position(for: state, at: now)
    }

    public func attention(at now: Date) -> Double {
        CreatureBehaviorEngine.attention(for: state, at: now)
    }
}
