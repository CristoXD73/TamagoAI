// CreatureExpression.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (SE 3 40 mm).
//
// Turns a CreatureWorldState (behavior/position, Apple/Shared,
// docs/DECISIONS.md D-114) into one CharacterExpression — the existing
// draw-parameter type CharacterFace already knows how to render (Stage A,
// D-102). This is the "expression" layer item 10 asks to keep separate from
// behavior/state, world position, and the renderer itself.
//
// Everything here is a pure function of world state + `now`. Breathing and
// the tiny vertical float read `now` directly at different, unrelated
// frequencies so they never lock into the same beat (task §3); blink, look
// direction, and the tap reaction come from CreatureWorldState's own stored,
// testable fields.

import SwiftUI
import TamagoShared

enum CreatureExpression {
    private static let tint: Color = .mint

    static func make(for world: CreatureWorldState, position: Point2D, attention: Double, now: Date) -> CharacterExpression {
        let t = now.timeIntervalSinceReferenceDate
        let breathe = sin(t * 0.55) * 0.035
        let float = sin(t * 0.9 + 1.3) * 2.2

        // Less body wobble while actively swimming somewhere; more settled
        // stillness while at rest (task §3: "brief pauses where it becomes
        // almost completely still").
        let isSettled = world.phase == .resting
        let restfulness = isSettled ? 1.0 : 0.45

        let eyeStyle: EyeStyle
        if world.isBlinking {
            eyeStyle = .closed
        } else if attention > 0.55 {
            eyeStyle = .wide
        } else {
            let lookAmount = CGFloat(min(max((world.lookTarget.x - position.x) * 4, -1), 1))
            eyeStyle = abs(lookAmount) > 0.12 ? .lookAway(lookAmount) : .open
        }

        let mouth: MouthStyle = attention > 0.45 ? .smile : .neutral
        let decoration: Decoration = attention > 0.6 ? .sparkle : .none

        return CharacterExpression(
            eyes: eyeStyle,
            mouth: mouth,
            bounceY: float * restfulness,
            scale: 1.0 + breathe * restfulness + attention * 0.08,
            tilt: .degrees(world.facing * 4 * restfulness),
            tint: tint,
            decoration: decoration
        )
    }
}
