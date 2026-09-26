// CharacterArt.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (SE 3 40 mm).
//
// Per-state placeholder animation data (docs/DECISIONS.md D-102). Every
// state gets its own row-0 loop of CharacterExpression frames, timed by the
// existing SpriteAnimationClock (Apple/Shared) — nothing here starts its own
// timer. `SpriteAnimationClock.row(...)` builds the frame list; `StateArt`
// maps a resulting SpriteFrame back to the expression to draw.

import SwiftUI
import TamagoShared

enum CharacterArt {
    struct StateArt {
        let sequence: AnimationSequence
        let expressions: [CharacterExpression]

        func expression(at frame: SpriteFrame) -> CharacterExpression {
            expressions.indices.contains(frame.column) ? expressions[frame.column] : expressions[0]
        }
    }

    static func art(for state: TamagoCharacterState) -> StateArt {
        switch state {
        case .idle: return idle
        case .sleeping: return sleeping
        case .listening: return listening
        case .acknowledging: return acknowledging
        case .thinking: return thinking
        case .toolRunning: return toolRunning
        case .speaking: return speaking
        case .happy: return happy
        case .success: return success
        case .confused: return confused
        case .error: return error
        case .disconnected: return disconnected
        }
    }

    // MARK: idle — gentle breathing with an occasional blink

    private static let idle = loop(
        [
            CharacterExpression(eyes: .open, mouth: .neutral, scale: 1.00, tint: .mint),
            CharacterExpression(eyes: .open, mouth: .neutral, scale: 1.04, tint: .mint),
            CharacterExpression(eyes: .closed, mouth: .neutral, scale: 1.02, tint: .mint),
            CharacterExpression(eyes: .open, mouth: .neutral, scale: 1.00, tint: .mint),
        ],
        durationsMs: [900, 900, 160, 900])

    // MARK: sleeping — slow deep breathing, eyes shut, "Z"

    private static let sleeping = loop(
        [
            CharacterExpression(eyes: .sleepy, mouth: .flatLine, bounceY: 0, scale: 0.97, tint: .indigo, decoration: .zzz),
            CharacterExpression(eyes: .sleepy, mouth: .flatLine, bounceY: -2, scale: 1.00, tint: .indigo, decoration: .zzz),
        ],
        frameMs: 1400)

    // MARK: listening — wide-eyed, expanding ripple

    private static let listening = loop(
        [
            CharacterExpression(eyes: .wide, mouth: .o, tint: .cyan, decoration: .ripple(0.0)),
            CharacterExpression(eyes: .wide, mouth: .o, tint: .cyan, decoration: .ripple(0.33)),
            CharacterExpression(eyes: .wide, mouth: .o, tint: .cyan, decoration: .ripple(0.66)),
            CharacterExpression(eyes: .wide, mouth: .o, tint: .cyan, decoration: .ripple(1.0)),
        ],
        frameMs: 180)

    // MARK: acknowledging — a quick "heard you" nod

    private static let acknowledging = loop(
        [
            CharacterExpression(eyes: .open, mouth: .smile, tilt: .degrees(-8), tint: .yellow),
            CharacterExpression(eyes: .open, mouth: .smile, tilt: .degrees(8), tint: .yellow),
        ],
        frameMs: 160)

    // MARK: thinking — eyes look around, a dot orbits the head

    private static let thinking = loop(
        [
            CharacterExpression(eyes: .lookAway(-1), mouth: .neutral, tint: .purple, decoration: .orbitDot(.degrees(0))),
            CharacterExpression(eyes: .open, mouth: .neutral, tint: .purple, decoration: .orbitDot(.degrees(90))),
            CharacterExpression(eyes: .lookAway(1), mouth: .neutral, tint: .purple, decoration: .orbitDot(.degrees(180))),
            CharacterExpression(eyes: .open, mouth: .neutral, tint: .purple, decoration: .orbitDot(.degrees(270))),
        ],
        frameMs: 380)

    // MARK: toolRunning — like thinking, faster orbit, distinct tint

    private static let toolRunning = loop(
        (0..<8).map { i in
            CharacterExpression(eyes: .open, mouth: .neutral, tint: .orange, decoration: .orbitDot(.degrees(Double(i) * 45)))
        },
        frameMs: 110)

    // MARK: speaking — mouth flaps like talking

    private static let speaking = loop(
        [
            CharacterExpression(eyes: .open, mouth: .talk(0.15), bounceY: 0, tint: .teal),
            CharacterExpression(eyes: .open, mouth: .talk(0.9), bounceY: -1, tint: .teal),
            CharacterExpression(eyes: .open, mouth: .talk(0.35), bounceY: 0, tint: .teal),
            CharacterExpression(eyes: .open, mouth: .talk(1.0), bounceY: -1, tint: .teal),
        ],
        frameMs: 130)

    // MARK: happy — bouncy big smile, sparkle

    private static let happy = loop(
        [
            CharacterExpression(eyes: .happy, mouth: .bigSmile, bounceY: 0, scale: 1.0, tint: .pink, decoration: .sparkle),
            CharacterExpression(eyes: .happy, mouth: .bigSmile, bounceY: -6, scale: 1.05, tint: .pink, decoration: .sparkle),
        ],
        frameMs: 220)

    // MARK: success — a satisfied smile with a checkmark badge

    private static let success = loop(
        [
            CharacterExpression(eyes: .happy, mouth: .smile, scale: 1.00, tint: .green, decoration: .checkmark),
            CharacterExpression(eyes: .happy, mouth: .smile, scale: 1.12, tint: .green, decoration: .checkmark),
            CharacterExpression(eyes: .happy, mouth: .smile, scale: 1.00, tint: .green, decoration: .checkmark),
        ],
        durationsMs: [180, 180, 900])

    // MARK: confused — rocking tilt, a raised "?"

    private static let confused = loop(
        [
            CharacterExpression(eyes: .open, mouth: .o, tilt: .degrees(-10), tint: .orange, decoration: .questionMark),
            CharacterExpression(eyes: .open, mouth: .o, tilt: .degrees(0), tint: .orange, decoration: .questionMark),
            CharacterExpression(eyes: .open, mouth: .o, tilt: .degrees(10), tint: .orange, decoration: .questionMark),
            CharacterExpression(eyes: .open, mouth: .o, tilt: .degrees(0), tint: .orange, decoration: .questionMark),
        ],
        frameMs: 320)

    // MARK: error — X eyes, frown, a fast shake

    private static let error = loop(
        [
            CharacterExpression(eyes: .x, mouth: .frown, tilt: .degrees(-5), tint: .red),
            CharacterExpression(eyes: .x, mouth: .frown, tilt: .degrees(5), tint: .red),
        ],
        frameMs: 90)

    // MARK: disconnected — flat, still, dim

    private static let disconnected = loop(
        [
            CharacterExpression(eyes: .closed, mouth: .flatLine, scale: 0.98, tint: .gray),
        ],
        frameMs: 1000)

    // MARK: helpers

    private static func loop(_ expressions: [CharacterExpression], frameMs: Int) -> StateArt {
        let frames = SpriteAnimationClock.row(0, count: expressions.count, durationMs: frameMs)
        return StateArt(sequence: AnimationSequence(loop: frames), expressions: expressions)
    }

    private static func loop(_ expressions: [CharacterExpression], durationsMs: [Int]) -> StateArt {
        let frames = SpriteAnimationClock.row(0, durationsMs: durationsMs)
        return StateArt(sequence: AnimationSequence(loop: frames), expressions: expressions)
    }
}
