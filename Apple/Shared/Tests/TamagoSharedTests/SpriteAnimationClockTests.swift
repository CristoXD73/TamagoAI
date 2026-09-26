import Foundation
import Testing
@testable import TamagoShared

/// Durations are multiples of 125 ms so every boundary (0.125 s, 0.375 s, …)
/// is exactly representable as a Double and the tests don't depend on
/// floating-point rounding.
@Suite("SpriteAnimationClock")
struct SpriteAnimationClockTests {
    let a = SpriteFrame(row: 0, column: 0)
    let b = SpriteFrame(row: 0, column: 1)
    let c = SpriteFrame(row: 1, column: 0)
    let d = SpriteFrame(row: 1, column: 1)

    /// intro: a 125 ms, b 250 ms (375 ms) → loop: c 125 ms, d 125 ms (250 ms)
    var introAndLoop: AnimationSequence {
        AnimationSequence(
            intro: [AnimationFrame(a, durationMs: 125), AnimationFrame(b, durationMs: 250)],
            loop: [AnimationFrame(c, durationMs: 125), AnimationFrame(d, durationMs: 125)])
    }

    func frame(_ sequence: AnimationSequence, _ elapsed: TimeInterval, reduceMotion: Bool = false) -> SpriteFrame {
        SpriteAnimationClock.frame(in: sequence, elapsed: elapsed, reduceMotion: reduceMotion)
    }

    // MARK: Progression and boundaries

    @Test func introFramesProgressAtExactBoundaries() {
        let s = introAndLoop
        #expect(frame(s, 0) == a)
        #expect(frame(s, 0.1) == a)
        #expect(frame(s, 0.125) == b, "a frame ends exactly at its duration")
        #expect(frame(s, 0.25) == b)
        #expect(frame(s, 0.374) == b)
    }

    @Test func loopStartsWhenIntroEnds() {
        let s = introAndLoop
        #expect(frame(s, 0.375) == c)
        #expect(frame(s, 0.49) == c)
        #expect(frame(s, 0.5) == d)
        #expect(frame(s, 0.624) == d)
    }

    @Test func loopWrapsAndNeverReplaysIntro() {
        let s = introAndLoop
        #expect(frame(s, 0.625) == c, "first wrap")
        #expect(frame(s, 0.75) == d)
        #expect(frame(s, 0.875) == c, "second wrap")
        for cycle in 1...50 {
            let start = 0.375 + Double(cycle) * 0.25
            #expect(frame(s, start) == c)
            #expect(frame(s, start + 0.125) == d)
        }
    }

    @Test func loopIsPeriodic() {
        let s = introAndLoop
        for step in 0..<200 {
            let t = 0.375 + Double(step) * 0.005
            #expect(frame(s, t) == frame(s, t + 0.25))
            #expect(frame(s, t) == frame(s, t + 25.0))
        }
    }

    @Test func loopOnlySequenceStartsInLoop() {
        let s = AnimationSequence(loop: [AnimationFrame(c, durationMs: 125), AnimationFrame(d, durationMs: 125)])
        #expect(s.introDurationMs == 0)
        #expect(frame(s, 0) == c)
        #expect(frame(s, 0.125) == d)
        #expect(frame(s, 0.25) == c)
    }

    @Test func singleFrameLoopAlwaysShowsThatFrame() {
        let s = AnimationSequence(loop: [AnimationFrame(d, durationMs: 500)])
        for t in stride(from: 0.0, through: 10.0, by: 0.37) {
            #expect(frame(s, t) == d)
        }
    }

    // MARK: One-shot (loop-less) sequences

    @Test func loopLessSequenceHoldsFinalIntroFrame() {
        let s = AnimationSequence(intro: [AnimationFrame(a, durationMs: 125), AnimationFrame(b, durationMs: 125)], loop: [])
        #expect(!s.hasLoop)
        #expect(frame(s, 0) == a)
        #expect(frame(s, 0.125) == b)
        #expect(frame(s, 0.25) == b, "holds after the intro ends")
        #expect(frame(s, 3600) == b)
    }

    @Test func isFinishedOnlyForLoopLessSequencesAfterIntro() {
        let oneShot = AnimationSequence(intro: [AnimationFrame(a, durationMs: 125), AnimationFrame(b, durationMs: 250)], loop: [])
        #expect(!SpriteAnimationClock.isFinished(oneShot, elapsed: 0))
        #expect(!SpriteAnimationClock.isFinished(oneShot, elapsed: 0.374))
        #expect(SpriteAnimationClock.isFinished(oneShot, elapsed: 0.375))
        #expect(SpriteAnimationClock.isFinished(oneShot, elapsed: 100))
        #expect(!SpriteAnimationClock.isFinished(oneShot, elapsed: -1))

        #expect(!SpriteAnimationClock.isFinished(introAndLoop, elapsed: 0))
        #expect(!SpriteAnimationClock.isFinished(introAndLoop, elapsed: 1_000_000))
    }

    // MARK: Reduce motion / low power

    @Test func reduceMotionShowsLowPowerFrameAtAnyTime() {
        let s = introAndLoop
        #expect(s.lowPowerFrame == a, "defaults to the first intro frame")
        for t in [0, 0.2, 0.5, 99.9] {
            #expect(frame(s, t, reduceMotion: true) == a)
        }
    }

    @Test func lowPowerFrameDefaults() {
        #expect(AnimationSequence(loop: [AnimationFrame(c, durationMs: 1)]).lowPowerFrame == c,
                "no intro: first loop frame")
        #expect(AnimationSequence(loop: []).lowPowerFrame == SpriteFrame(row: 0, column: 0),
                "empty: origin cell")
        let custom = SpriteFrame(row: 7, column: 3)
        #expect(AnimationSequence(intro: [AnimationFrame(a, durationMs: 1)], loop: [], lowPowerFrame: custom).lowPowerFrame == custom)
    }

    // MARK: Invalid and edge inputs

    @Test func emptySequenceFallsBackToLowPowerFrame() {
        let s = AnimationSequence(loop: [])
        #expect(frame(s, 0) == SpriteFrame(row: 0, column: 0))
        #expect(frame(s, 5) == SpriteFrame(row: 0, column: 0))
        #expect(SpriteAnimationClock.isFinished(s, elapsed: 0))

        let custom = SpriteFrame(row: 2, column: 2)
        #expect(frame(AnimationSequence(loop: [], lowPowerFrame: custom), 1) == custom)
    }

    @Test func negativeElapsedShowsFirstFrame() {
        #expect(frame(introAndLoop, -0.5) == a)
        #expect(frame(introAndLoop, -1_000_000) == a)
    }

    @Test func nonFiniteElapsedIsTreatedAsStart() {
        // Int(Double.nan) / Int(.infinity) trap; the clock must not crash a
        // renderer that hands it a bad time interval.
        #expect(frame(introAndLoop, .nan) == a)
        #expect(frame(introAndLoop, .infinity) == a)
        #expect(frame(introAndLoop, -.infinity) == a)
        #expect(!SpriteAnimationClock.isFinished(introAndLoop, elapsed: .nan))
    }

    @Test func veryLongElapsedDoesNotOverflow() {
        // 30 days is past Int32.max milliseconds (~24.8 days), the Int width
        // on arm64_32 Apple Watch hardware.
        let thirtyDays: TimeInterval = 30 * 24 * 60 * 60
        // (2_592_000_000 - 375) % 250 == 125 → second loop frame.
        #expect(frame(introAndLoop, thirtyDays) == d)
        #expect(frame(introAndLoop, thirtyDays + 0.125) == c)
        #expect(frame(introAndLoop, 1e15) == frame(introAndLoop, 1e15))
    }

    @Test func nonPositiveDurationsClampToOneMillisecond() {
        #expect(AnimationFrame(a, durationMs: 0).durationMs == 1)
        #expect(AnimationFrame(a, durationMs: -40).durationMs == 1)

        let s = AnimationSequence(loop: [AnimationFrame(a, durationMs: 0), AnimationFrame(b, durationMs: -5)])
        #expect(s.loopDurationMs == 2)
        #expect(frame(s, 0) == a)
        #expect(frame(s, 0.001) == b)
        #expect(frame(s, 0.002) == a)
    }

    // MARK: Determinism

    @Test func sameInputsGiveSameFrame() {
        let s = introAndLoop
        for step in 0..<500 {
            let t = Double(step) * 0.0173
            #expect(frame(s, t) == frame(s, t))
        }
    }

    @Test func frameSequenceOverTimeIsExact() {
        // Sample every 125 ms for two seconds.
        let observed = (0..<16).map { frame(introAndLoop, Double($0) * 0.125) }
        #expect(observed == [a, b, b, c, d, c, d, c, d, c, d, c, d, c, d, c])
    }

    // MARK: Row helpers

    @Test func rowHelperBuildsEqualFramesWithOptionalFinalHold() {
        let frames = SpriteAnimationClock.row(3, count: 4, durationMs: 120, finalDurationMs: 600)
        #expect(frames.map(\.spriteFrame) == (0..<4).map { SpriteFrame(row: 3, column: $0) })
        #expect(frames.map(\.durationMs) == [120, 120, 120, 600])

        #expect(SpriteAnimationClock.row(0, count: 2, durationMs: 90).map(\.durationMs) == [90, 90])
        #expect(SpriteAnimationClock.row(0, count: 1, durationMs: 90, finalDurationMs: 300).map(\.durationMs) == [300])
    }

    @Test func rowHelperWithNonPositiveCountIsEmpty() {
        #expect(SpriteAnimationClock.row(0, count: 0, durationMs: 100).isEmpty)
        #expect(SpriteAnimationClock.row(0, count: -3, durationMs: 100).isEmpty)
    }

    @Test func rowHelperWithExplicitDurations() {
        let frames = SpriteAnimationClock.row(2, durationsMs: [100, 0, 250])
        #expect(frames.map(\.spriteFrame) == [SpriteFrame(row: 2, column: 0), SpriteFrame(row: 2, column: 1), SpriteFrame(row: 2, column: 2)])
        #expect(frames.map(\.durationMs) == [100, 1, 250])
        #expect(SpriteAnimationClock.row(2, durationsMs: []).isEmpty)
    }

    @Test func durationsSumCorrectly() {
        #expect(introAndLoop.introDurationMs == 375)
        #expect(introAndLoop.loopDurationMs == 250)
        #expect(introAndLoop.hasLoop)
    }
}
