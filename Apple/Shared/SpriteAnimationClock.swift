// SpriteAnimationClock.swift
//
// VERIFICATION: UNIT_TESTED_ONLY. Compiled with Xcode 27.0 / Swift 6.4 and
// covered by Apple/Shared/Tests/TamagoSharedTests/SpriteAnimationClockTests.swift
// (host + watchOS 27 simulator). Not yet driven by a real renderer.
//
// Adapted from WatchPet — https://github.com/lkuczborski/WatchPet
//   file:   WatchPet/Views/PetAvatarView.swift (private enum CodexSpriteAnimation
//           and the SpriteFrame / AnimationFrame / AnimationSequence structs)
//   commit: d52a77a1d15374b1443a46e26ddba11920d3b894
//   Copyright (c) 2026 Łukasz Kuczborski — MIT License (full text in
//   THIRD_PARTY_NOTICES.md at the repository root).
//
// Changes from upstream:
//   - Removed every Codex-specific piece: CodexAvatarState, the 8x9 Codex
//     sprite-sheet row layout, and the state -> row mapping. Which frames a
//     character state plays is now data supplied by the app.
//   - Made the timing engine public and pure (Foundation only, no SwiftUI),
//     so it can be unit-tested and driven by any renderer (TimelineView,
//     SpriteKit, ...) chosen in docs/DECISIONS.md.
//   - Added `isFinished` / `hasLoop` helpers and a `lowPowerFrame` for the
//     reduced-luminance / reduce-motion pose.
//   - (Phase 3, local Xcode) Non-finite elapsed times are treated as the start
//     and loop phase is computed in Double: `Int(elapsed * 1000)` trapped on
//     NaN/infinity and overflowed 32-bit Int (arm64_32 Watch) after ~24.8 days.
//
// It uses no art assets. WatchPet's pets come from the Codex app bundle and
// must NOT be redistributed with this project.

import Foundation

/// One cell in a sprite sheet (or one image in a frame list).
public struct SpriteFrame: Hashable, Sendable {
    public let row: Int
    public let column: Int

    public init(row: Int, column: Int) {
        self.row = row
        self.column = column
    }
}

/// A frame shown for `durationMs` milliseconds.
public struct AnimationFrame: Hashable, Sendable {
    public let spriteFrame: SpriteFrame
    public let durationMs: Int

    public init(_ spriteFrame: SpriteFrame, durationMs: Int) {
        self.spriteFrame = spriteFrame
        self.durationMs = max(durationMs, 1)
    }
}

/// Plays `intro` once, then repeats `loop` forever. An empty loop holds the
/// final intro frame (useful for one-shot reactions that settle into a pose).
public struct AnimationSequence: Hashable, Sendable {
    public let intro: [AnimationFrame]
    public let loop: [AnimationFrame]
    /// Pose to show when motion must stop: Reduce Motion, reduced luminance,
    /// or app inactive. Defaults to the first frame of the sequence.
    public let lowPowerFrame: SpriteFrame

    public init(intro: [AnimationFrame] = [], loop: [AnimationFrame], lowPowerFrame: SpriteFrame? = nil) {
        self.intro = intro
        self.loop = loop
        self.lowPowerFrame = lowPowerFrame
            ?? intro.first?.spriteFrame
            ?? loop.first?.spriteFrame
            ?? SpriteFrame(row: 0, column: 0)
    }

    public var introDurationMs: Int { Self.totalDuration(intro) }
    public var loopDurationMs: Int { Self.totalDuration(loop) }
    public var hasLoop: Bool { !loop.isEmpty }

    static func totalDuration(_ frames: [AnimationFrame]) -> Int {
        frames.reduce(0) { $0 + $1.durationMs }
    }
}

public enum SpriteAnimationClock {
    /// The frame to display `elapsed` seconds after the sequence started.
    /// Deterministic: no hidden timers or state, so a renderer can call it from
    /// whatever cadence watchOS currently allows.
    public static func frame(
        in sequence: AnimationSequence,
        elapsed: TimeInterval,
        reduceMotion: Bool
    ) -> SpriteFrame {
        if reduceMotion {
            return sequence.lowPowerFrame
        }

        let elapsedMs = milliseconds(elapsed)
        let introDuration = sequence.introDurationMs
        if elapsedMs < Double(introDuration) {
            return frame(in: sequence.intro, elapsedMs: Int(elapsedMs))
        }

        guard sequence.hasLoop else {
            return sequence.intro.last?.spriteFrame ?? sequence.lowPowerFrame
        }

        let loopElapsed = (elapsedMs - Double(introDuration))
            .truncatingRemainder(dividingBy: Double(max(sequence.loopDurationMs, 1)))
        return frame(in: sequence.loop, elapsedMs: Int(loopElapsed))
    }

    /// True once a sequence without a loop has played its intro completely.
    /// State machines can use this to return a transient state to idle.
    public static func isFinished(_ sequence: AnimationSequence, elapsed: TimeInterval) -> Bool {
        !sequence.hasLoop && elapsed.isFinite && milliseconds(elapsed) >= Double(sequence.introDurationMs)
    }

    /// Convenience: a row of `count` frames of equal duration, with an optional
    /// longer final frame (the upstream pattern for "hold on the last pose").
    public static func row(_ row: Int, count: Int, durationMs: Int, finalDurationMs: Int? = nil) -> [AnimationFrame] {
        (0..<max(count, 0)).map { column in
            let isLast = column == count - 1
            return AnimationFrame(
                SpriteFrame(row: row, column: column),
                durationMs: isLast ? (finalDurationMs ?? durationMs) : durationMs
            )
        }
    }

    /// Convenience: a row with an explicit duration per column.
    public static func row(_ row: Int, durationsMs: [Int]) -> [AnimationFrame] {
        durationsMs.enumerated().map { column, duration in
            AnimationFrame(SpriteFrame(row: row, column: column), durationMs: duration)
        }
    }

    /// Whole milliseconds since the start. Negative and non-finite values
    /// (NaN, ±infinity) count as the start, so a bad time value can't trap.
    private static func milliseconds(_ elapsed: TimeInterval) -> Double {
        guard elapsed.isFinite, elapsed > 0 else { return 0 }
        return (elapsed * 1000).rounded(.towardZero)
    }

    private static func frame(in frames: [AnimationFrame], elapsedMs: Int) -> SpriteFrame {
        var cursor = 0
        for frame in frames {
            cursor += frame.durationMs
            if elapsedMs < cursor {
                return frame.spriteFrame
            }
        }
        return frames.last?.spriteFrame ?? SpriteFrame(row: 0, column: 0)
    }
}
