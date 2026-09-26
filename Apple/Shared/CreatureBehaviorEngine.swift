// CreatureBehaviorEngine.swift
//
// VERIFICATION: UNIT_TESTED_ONLY. Phase 4 (Stage A extension), Xcode 27.0 /
// Swift 6.4. Covered by
// Apple/Shared/Tests/TamagoSharedTests/CreatureBehaviorEngineTests.swift
// (host + watchOS 27 simulator).
//
// Implements the autonomous-life architecture recorded in docs/DECISIONS.md
// D-114: a second pure reducer, separate from CharacterStateMachine (D-103).
// CharacterStateMachine owns the *network-interaction* visual state (idle,
// listening, thinking, ...). This engine owns the creature's *world*: where
// it logically is, whether it's wandering, peeking at an edge, or fully
// offscreen, and its idle-life micro-behaviors (blink/glance). It only ever
// drives the screen while the network state is `.idle` (CharacterView
// decides that; this file knows nothing about TamagoCharacterState).
//
// Same discipline as SpriteAnimationClock/CharacterStateMachine: no timers,
// no I/O, no wall-clock reads. `advance(_:to:)` is a pure function of a
// stored checkpoint and a caller-supplied `now`; calling it twice with the
// same inputs returns the same result. Randomness is seeded and threaded
// through the state (`rngState`) rather than reaching for the system RNG, so
// every transition is replayable in a test.

import Foundation

/// A point in normalized screen space. (0,0)...(1,1) is the visible screen;
/// values outside that range are logical offscreen positions. Foundation
/// only (no CoreGraphics) so this type stays inside TamagoShared's
/// pure-Foundation boundary (Package.swift); the Watch target maps it to
/// actual points against its own screen size.
public struct Point2D: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    public static let center = Point2D(x: 0.5, y: 0.5)

    func lerp(to other: Point2D, _ t: Double) -> Point2D {
        Point2D(x: x + (other.x - x) * t, y: y + (other.y - y) * t)
    }
}

/// All four screen edges are entrances/exits (task requirement §5): nothing
/// here is more special-cased than "which edge."
public enum ScreenEdge: CaseIterable, Equatable, Sendable {
    case top, bottom, leading, trailing
}

/// What a `.moving` leg resolves to once it arrives.
public enum MoveIntent: Equatable, Sendable {
    case settle
    case peek(ScreenEdge)
    case hide(ScreenEdge)
}

/// The creature's discrete behavior phase. Position itself is continuous
/// (see `CreatureBehaviorEngine.position(for:at:)`); this is the small,
/// reusable vocabulary of *what it's doing*, composed instead of one long
/// scripted sequence (task requirement §5).
public enum CreaturePhase: Equatable, Sendable {
    /// Holding still at `destination`. The common case — "most of the time
    /// it should calmly exist."
    case resting
    /// Interpolating position from `origin` to `destination`; `intent`
    /// says what happens on arrival.
    case moving(MoveIntent)
    /// Holding at an edge, mostly offscreen, a sliver of the body inside
    /// the visible area.
    case peeking(ScreenEdge)
    /// Holding fully offscreen (invisible) at the given exit edge.
    case offscreen(ScreenEdge)
}

/// Debug-only forced transitions (task requirement §7). Drives the same
/// pure engine a real autonomous decision would, so it's testable and can
/// never desync from real behavior.
public enum CreatureDebugCommand: Equatable, Sendable {
    case rest, wander, exit, peek, returnOnscreen
}

/// The full checkpoint. Everything CreatureView needs to render one frame is
/// a function of this plus `now` (D-102's "rendering state is derived,
/// never stored," extended to the creature's world).
public struct CreatureWorldState: Equatable, Sendable {
    public var phase: CreaturePhase
    public var origin: Point2D
    public var destination: Point2D
    public var moveStartedAt: Date
    public var moveDuration: TimeInterval
    /// When autonomy may next re-evaluate (a rest timing out, a peek/hide
    /// hold expiring). Meaningless while `.moving` (arrival time governs).
    public var nextDecisionAt: Date
    /// -1...1 horizontal lean from the most recent movement, held steady
    /// between moves so a resting/peeking creature keeps its posture.
    public var facing: Double
    /// Idle eye-glance target — independent of body movement (task §3:
    /// "occasional asymmetric eye movement, looking toward different areas
    /// of the screen").
    public var lookTarget: Point2D
    public var nextLookAt: Date
    public var isBlinking: Bool
    public var nextBlinkAt: Date
    /// Peak reaction size set at the moment of the last tap; callers derive
    /// the *current* value via `CreatureBehaviorEngine.attention(for:at:)`,
    /// which decays it by elapsed time rather than storing a moving target.
    public var attention: Double
    public var lastTapAt: Date?
    /// Seeded PRNG state threaded through every transition. Two states with
    /// equal `rngState` produce byte-identical future transitions.
    public var rngState: UInt64
}

/// A small deterministic PRNG (splitmix64) so behavior is seedable and
/// replayable in tests (task §11), instead of reaching for the system RNG.
public struct SeededGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64

    public init(seed: UInt64) {
        self.state = seed == 0 ? 0x9E3779B97F4A7C15 : seed
    }

    public mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

/// The pure engine. No timers, no networking, no clock reads: `now` always
/// comes from the caller (CreatureBehaviorController, or a test).
public enum CreatureBehaviorEngine {
    // MARK: Tunables

    /// Ordinary wandering stays inset from the edges so an approach to an
    /// edge reads as deliberate.
    private static let territoryMin = 0.16
    private static let territoryMax = 0.84
    /// How far past the edge line the creature holds while "peeking": small
    /// enough that only a sliver of the body remains inside the screen.
    private static let peekOffset = 0.07
    /// How far past the edge line counts as fully offscreen: past any
    /// reasonable body radius, so nothing clips into view.
    // The 108-point placeholder can extend ~67 points after breathing,
    // attention, tilt and float on a 162-point viewport. 0.34 was only
    // 55 points, leaving an edge visible before a hidden relocation.
    private static let hideOffset = 0.45
    private static let attentionDecayPerSecond = 0.35

    // MARK: Initial state

    public static func initial(now: Date, seed: UInt64 = 0x5EED_5EED) -> CreatureWorldState {
        CreatureWorldState(
            phase: .resting,
            origin: .center,
            destination: .center,
            moveStartedAt: now,
            moveDuration: 0,
            nextDecisionAt: now.addingTimeInterval(2.0),
            facing: 0,
            lookTarget: .center,
            nextLookAt: now.addingTimeInterval(2.5),
            isBlinking: false,
            nextBlinkAt: now.addingTimeInterval(3.0),
            attention: 0,
            lastTapAt: nil,
            rngState: seed
        )
    }

    // MARK: Derived rendering values

    /// The creature's current logical position. Pure function of state and
    /// `now`; never stored.
    public static func position(for state: CreatureWorldState, at now: Date) -> Point2D {
        switch state.phase {
        case .resting, .peeking, .offscreen:
            return state.destination
        case .moving:
            return state.origin.lerp(to: state.destination, easeInOut(progress(state, at: now)))
        }
    }

    /// The current reaction size, decayed from the peak recorded at the last
    /// tap. 0 if there has never been a tap.
    public static func attention(for state: CreatureWorldState, at now: Date) -> Double {
        guard let lastTap = state.lastTapAt else { return 0 }
        let elapsed = max(0, now.timeIntervalSince(lastTap))
        return max(0, state.attention - attentionDecayPerSecond * elapsed)
    }

    private static func progress(_ state: CreatureWorldState, at now: Date) -> Double {
        guard state.moveDuration > 0 else { return 1 }
        let elapsed = now.timeIntervalSince(state.moveStartedAt)
        return min(1, max(0, elapsed / state.moveDuration))
    }

    private static func easeInOut(_ t: Double) -> Double {
        t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
    }

    // MARK: Advancing autonomous time

    /// Fast-forwards `state` to `now`, replaying every completed phase,
    /// blink, and glance transition along the way (each is its own
    /// independent schedule — task §3: "do not have every animation run on
    /// exactly the same repeating interval"). Bounded by `maxSteps` per
    /// timeline so an arbitrarily long gap (e.g. the app was backgrounded
    /// for hours) can never loop unboundedly; if the phase timeline would
    /// exceed it, the creature simply resets to a fresh calm rest, which is
    /// always a legal, safe state.
    public static func advance(_ initial: CreatureWorldState, to now: Date, maxSteps: Int = 200) -> CreatureWorldState {
        var state = initial

        var steps = 0
        while now >= phaseDueDate(state), steps < maxSteps {
            state = phaseStep(state, now: phaseDueDate(state))
            steps += 1
        }
        if steps >= maxSteps {
            state = CreatureBehaviorEngine.initial(now: now, seed: state.rngState)
        }

        steps = 0
        while now >= state.nextBlinkAt, steps < maxSteps {
            state = blinkStep(state, now: state.nextBlinkAt)
            steps += 1
        }

        steps = 0
        while now >= state.nextLookAt, steps < maxSteps {
            state = lookStep(state, now: state.nextLookAt)
            steps += 1
        }

        return state
    }

    // MARK: Touch interaction (task §6)

    /// A tap while visible makes the creature notice and approach; a tap
    /// while offscreen just brings its return forward a little. Repeated
    /// taps raise `attention` (capped at 1) without restarting a fresh
    /// random reaction each time, so it reads as "increasingly noticeable,"
    /// not jittery.
    public static func applyTap(_ state: CreatureWorldState, at point: Point2D, now: Date) -> CreatureWorldState {
        var rng = SeededGenerator(seed: state.rngState)
        var next = state
        next.attention = min(1.0, attention(for: state, at: now) + 0.4)
        next.lastTapAt = now

        switch state.phase {
        case .offscreen:
            let soon = now.addingTimeInterval(Double.random(in: 0.4...1.1, using: &rng))
            if soon < next.nextDecisionAt { next.nextDecisionAt = soon }
        case .resting, .moving, .peeking:
            let approach = clampToTerritory(point)
            next = beginMove(next, to: approach, intent: .settle, now: now, rng: &rng, quick: true)
        }
        next.rngState = rng.next()
        return next
    }

    // MARK: Debug-forced transitions (task §7, DEBUG-only caller)

    public static func debugForce(_ command: CreatureDebugCommand, from state: CreatureWorldState, now: Date) -> CreatureWorldState {
        var rng = SeededGenerator(seed: state.rngState)
        var next: CreatureWorldState

        switch command {
        case .rest:
            let here = position(for: state, at: now)
            next = state
            next.phase = .resting
            next.origin = here
            next.destination = here
            next.nextDecisionAt = now.addingTimeInterval(Double.random(in: 2...4, using: &rng))
        case .wander:
            next = beginMove(state, to: randomInteriorPoint(&rng), intent: .settle, now: now, rng: &rng)
        case .exit:
            let edge = chooseExitEdge(from: position(for: state, at: now), rng: &rng)
            next = beginMove(state, to: edgePoint(edge, offset: hideOffset, rng: &rng), intent: .hide(edge), now: now, rng: &rng)
        case .peek:
            let edge = chooseExitEdge(from: position(for: state, at: now), rng: &rng)
            next = beginMove(state, to: edgePoint(edge, offset: peekOffset, rng: &rng), intent: .peek(edge), now: now, rng: &rng)
        case .returnOnscreen:
            switch state.phase {
            case let .offscreen(edge):
                next = beginReturn(from: state, exitedFrom: edge, now: now, rng: &rng)
            default:
                next = beginMove(state, to: randomInteriorPoint(&rng), intent: .settle, now: now, rng: &rng)
            }
        }
        next.rngState = rng.next()
        return next
    }

    // MARK: Phase timeline

    private static func phaseDueDate(_ state: CreatureWorldState) -> Date {
        switch state.phase {
        case .resting, .peeking, .offscreen:
            return state.nextDecisionAt
        case .moving:
            return state.moveStartedAt.addingTimeInterval(state.moveDuration)
        }
    }

    private static func phaseStep(_ state: CreatureWorldState, now: Date) -> CreatureWorldState {
        var rng = SeededGenerator(seed: state.rngState)
        var next: CreatureWorldState
        switch state.phase {
        case .resting:
            next = beginNextMove(from: state, now: now, rng: &rng)
        case let .moving(intent):
            next = resolveArrival(state, intent: intent, now: now, rng: &rng)
        case let .peeking(edge):
            next = resolvePeekExpiry(from: state, edge: edge, now: now, rng: &rng)
        case let .offscreen(edge):
            next = beginReturn(from: state, exitedFrom: edge, now: now, rng: &rng)
        }
        next.rngState = rng.next()
        return next
    }

    private enum NextChoice { case pause, wander, peekEdge, hideDirect }

    /// From `.resting`: most often a short interior hop or another calm
    /// pause; sometimes a deliberate approach to an edge (task §1's
    /// "wander," "approach screen edges," and the two ways to leave —
    /// pausing to peek first, or crawling straight out).
    private static func beginNextMove(from state: CreatureWorldState, now: Date, rng: inout SeededGenerator) -> CreatureWorldState {
        let u = nextUnit(&rng)
        let choice: NextChoice = weightedPick([
            (0.22, .pause), (0.38, .wander), (0.25, .peekEdge), (0.15, .hideDirect),
        ], u)

        switch choice {
        case .pause:
            var next = state
            next.nextDecisionAt = now.addingTimeInterval(randomRestDuration(&rng))
            return next
        case .wander:
            return beginMove(state, to: randomInteriorPoint(&rng), intent: .settle, now: now, rng: &rng)
        case .peekEdge:
            let edge = chooseExitEdge(from: state.destination, rng: &rng)
            return beginMove(state, to: edgePoint(edge, offset: peekOffset, rng: &rng), intent: .peek(edge), now: now, rng: &rng)
        case .hideDirect:
            let edge = chooseExitEdge(from: state.destination, rng: &rng)
            return beginMove(state, to: edgePoint(edge, offset: hideOffset, rng: &rng), intent: .hide(edge), now: now, rng: &rng)
        }
    }

    private static func resolveArrival(_ state: CreatureWorldState, intent: MoveIntent, now: Date, rng: inout SeededGenerator) -> CreatureWorldState {
        var next = state
        switch intent {
        case .settle:
            next.phase = .resting
            next.origin = state.destination
            next.nextDecisionAt = now.addingTimeInterval(randomRestDuration(&rng))
        case let .peek(edge):
            next.phase = .peeking(edge)
            next.origin = state.destination
            next.nextDecisionAt = now.addingTimeInterval(randomPeekHold(&rng))
        case let .hide(edge):
            next.phase = .offscreen(edge)
            next.origin = state.destination
            // Bounded (task §2: "never leave it gone long enough that the
            // user assumes the app froze").
            next.nextDecisionAt = now.addingTimeInterval(randomOffscreenHold(&rng))
        }
        return next
    }

    /// From `.peeking`: either commit to hiding fully, or change its mind
    /// and come back in (task §2: "it may peek back in").
    private static func resolvePeekExpiry(from state: CreatureWorldState, edge: ScreenEdge, now: Date, rng: inout SeededGenerator) -> CreatureWorldState {
        if nextUnit(&rng) < 0.55 {
            return beginMove(state, to: edgePoint(edge, offset: hideOffset, rng: &rng), intent: .hide(edge), now: now, rng: &rng)
        } else {
            return beginMove(state, to: randomInteriorPoint(&rng), intent: .settle, now: now, rng: &rng)
        }
    }

    /// From `.offscreen`: pick a return edge — not always the one it left
    /// from (task §2) — and peek back in there. The one place a logical
    /// teleport is legal (task §4): the creature is invisible, so relocating
    /// its hidden position to the new edge is never seen.
    private static func beginReturn(from state: CreatureWorldState, exitedFrom edge: ScreenEdge, now: Date, rng: inout SeededGenerator) -> CreatureWorldState {
        let edges = ScreenEdge.allCases
        let returnEdge = edges[Int(nextUnit(&rng) * Double(edges.count)) % edges.count]
        var relocated = state
        relocated.origin = edgePoint(returnEdge, offset: hideOffset, rng: &rng)
        relocated.destination = relocated.origin
        return beginMove(relocated, to: edgePoint(returnEdge, offset: peekOffset, rng: &rng), intent: .peek(returnEdge), now: now, rng: &rng)
    }

    /// Starts a `.moving` leg from the creature's current position to
    /// `destination`. `quick` shortens the duration for a responsive touch
    /// reaction (task §6) without a separate movement system.
    private static func beginMove(
        _ state: CreatureWorldState, to destination: Point2D, intent: MoveIntent,
        now: Date, rng: inout SeededGenerator, quick: Bool = false
    ) -> CreatureWorldState {
        var next = state
        let origin = position(for: state, at: now)
        next.origin = origin
        next.destination = destination
        next.phase = .moving(intent)
        next.moveStartedAt = now
        next.moveDuration = quick
            ? Double.random(in: 0.3...0.6, using: &rng)
            : randomMoveDuration(distance: hypot(destination.x - origin.x, destination.y - origin.y), rng: &rng)
        if abs(destination.x - origin.x) > 0.02 {
            next.facing = destination.x > origin.x ? 1 : -1
        }
        return next
    }

    // MARK: Idle-life micro-behaviors (task §3)

    private static func blinkStep(_ state: CreatureWorldState, now: Date) -> CreatureWorldState {
        var rng = SeededGenerator(seed: state.rngState)
        var next = state
        if state.isBlinking {
            next.isBlinking = false
            next.nextBlinkAt = now.addingTimeInterval(Double.random(in: 2.5...7.0, using: &rng))
        } else {
            next.isBlinking = true
            next.nextBlinkAt = now.addingTimeInterval(0.12)
        }
        next.rngState = rng.next()
        return next
    }

    private static func lookStep(_ state: CreatureWorldState, now: Date) -> CreatureWorldState {
        var rng = SeededGenerator(seed: state.rngState)
        var next = state
        let base = position(for: state, at: now)
        next.lookTarget = Point2D(
            x: min(max(base.x + Double.random(in: -0.18...0.18, using: &rng), 0), 1),
            y: min(max(base.y + Double.random(in: -0.12...0.12, using: &rng), 0), 1)
        )
        next.nextLookAt = now.addingTimeInterval(Double.random(in: 1.4...4.2, using: &rng))
        next.rngState = rng.next()
        return next
    }

    // MARK: Geometry helpers

    private static func edgePoint(_ edge: ScreenEdge, offset: Double, rng: inout SeededGenerator) -> Point2D {
        let along = Double.random(in: territoryMin...territoryMax, using: &rng)
        switch edge {
        case .top: return Point2D(x: along, y: -offset)
        case .bottom: return Point2D(x: along, y: 1 + offset)
        case .leading: return Point2D(x: -offset, y: along)
        case .trailing: return Point2D(x: 1 + offset, y: along)
        }
    }

    private static func randomInteriorPoint(_ rng: inout SeededGenerator) -> Point2D {
        Point2D(
            x: Double.random(in: territoryMin...territoryMax, using: &rng),
            y: Double.random(in: territoryMin...territoryMax, using: &rng)
        )
    }

    /// Usually the nearest edge (a quick local exit); occasionally the
    /// farthest one, which sends the creature travelling across the whole
    /// display before it disappears (task §1: "occasionally cross the
    /// entire display and disappear through the opposite side").
    private static func chooseExitEdge(from position: Point2D, rng: inout SeededGenerator) -> ScreenEdge {
        let distances: [(ScreenEdge, Double)] = [
            (.top, position.y), (.bottom, 1 - position.y),
            (.leading, position.x), (.trailing, 1 - position.x),
        ]
        let nearest = distances.min(by: { $0.1 < $1.1 })!.0
        let farthest = distances.max(by: { $0.1 < $1.1 })!.0
        return nextUnit(&rng) < 0.7 ? nearest : farthest
    }

    private static func clampToTerritory(_ point: Point2D) -> Point2D {
        Point2D(
            x: min(max(point.x, territoryMin), territoryMax),
            y: min(max(point.y, territoryMin), territoryMax)
        )
    }

    private static func randomRestDuration(_ rng: inout SeededGenerator) -> TimeInterval {
        .random(in: 1.6...5.5, using: &rng)
    }

    private static func randomPeekHold(_ rng: inout SeededGenerator) -> TimeInterval {
        .random(in: 1.0...2.8, using: &rng)
    }

    private static func randomOffscreenHold(_ rng: inout SeededGenerator) -> TimeInterval {
        .random(in: 2.0...5.5, using: &rng)
    }

    private static func randomMoveDuration(distance: Double, rng: inout SeededGenerator) -> TimeInterval {
        max(0.45, distance * 2.0) + Double.random(in: -0.1...0.35, using: &rng)
    }

    private static func nextUnit(_ rng: inout SeededGenerator) -> Double {
        Double(rng.next() >> 11) * (1.0 / 9_007_199_254_740_992.0) // 2^53
    }

    private static func weightedPick<T>(_ options: [(weight: Double, value: T)], _ u: Double) -> T {
        let total = options.reduce(0) { $0 + $1.weight }
        var cursor = u * total
        for option in options {
            if cursor < option.weight { return option.value }
            cursor -= option.weight
        }
        return options.last!.value
    }
}
