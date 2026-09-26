import Foundation
import Testing
@testable import TamagoShared

/// Covers docs/DECISIONS.md D-114's autonomous-life engine. `advance` and
/// `debugForce` are pure given `now` and a seeded RNG carried in
/// `CreatureWorldState.rngState`, so every test builds its own clock and
/// asserts on the returned value only — same discipline as
/// CharacterStateMachineTests.
@Suite("CreatureBehaviorEngine")
struct CreatureBehaviorEngineTests {
    let t0 = Date(timeIntervalSince1970: 2_000_000)

    // MARK: Initial state

    @Test func initialStateIsRestingAtCenterWithNoAttention() {
        let s = CreatureBehaviorEngine.initial(now: t0)
        #expect(s.phase == .resting)
        #expect(s.destination == .center)
        #expect(CreatureBehaviorEngine.attention(for: s, at: t0) == 0)
        #expect(s.lastTapAt == nil)
    }

    // MARK: Determinism (task §11: "seeded/injectable randomness")

    @Test func seededGeneratorIsDeterministic() {
        var a = SeededGenerator(seed: 42)
        var b = SeededGenerator(seed: 42)
        for _ in 0..<20 {
            #expect(a.next() == b.next())
        }
    }

    @Test func advanceIsAPureFunction() {
        let start = CreatureBehaviorEngine.initial(now: t0, seed: 777)
        let later = t0.addingTimeInterval(37)
        let a = CreatureBehaviorEngine.advance(start, to: later)
        let b = CreatureBehaviorEngine.advance(start, to: later)
        #expect(a == b)
    }

    @Test func differentSeedsEventuallyDiverge() {
        let later = t0.addingTimeInterval(120)
        let a = CreatureBehaviorEngine.advance(CreatureBehaviorEngine.initial(now: t0, seed: 1), to: later)
        let b = CreatureBehaviorEngine.advance(CreatureBehaviorEngine.initial(now: t0, seed: 2), to: later)
        #expect(a != b, "two different seeds should not happen to pick the exact same multi-minute path")
    }

    // MARK: Exit reaches an offscreen state (task §11)

    @Test func forcedExitLeavesTheScreen() {
        let start = CreatureBehaviorEngine.initial(now: t0)
        let moving = CreatureBehaviorEngine.debugForce(.exit, from: start, now: t0)
        guard case let .moving(intent) = moving.phase, case let .hide(edge) = intent else {
            Issue.record("expected a moving(.hide) leg, got \(moving.phase)"); return
        }
        let arrival = t0.addingTimeInterval(moving.moveDuration + 0.01)
        let offscreen = CreatureBehaviorEngine.advance(moving, to: arrival)
        #expect(offscreen.phase == .offscreen(edge))

        let p = CreatureBehaviorEngine.position(for: offscreen, at: arrival)
        // Well past any reasonable body radius on every axis that matters
        // for this edge — fully outside the visible 0...1 screen.
        switch edge {
        case .top: #expect(p.y < -0.2)
        case .bottom: #expect(p.y > 1.2)
        case .leading: #expect(p.x < -0.2)
        case .trailing: #expect(p.x > 1.2)
        }
    }

    @Test func hiddenPositionClearsTransformedPlaceholderOnSmallViewport() {
        // Conservative square bounds include mantle, tentacles, maximum
        // attention/breathing scale, four-degree tilt and vertical float.
        let radians = 4.0 * Double.pi / 180
        let radius = 54.0 * 1.115 * (cos(radians) + sin(radians)) + 2.2
        for seed in UInt64(1)...64 {
            let moving = CreatureBehaviorEngine.debugForce(
                .exit, from: CreatureBehaviorEngine.initial(now: t0, seed: seed), now: t0)
            guard case let .moving(.hide(edge)) = moving.phase else {
                Issue.record("expected hide leg"); return
            }
            let p = moving.destination
            let clearance: Double
            switch edge {
            case .top: clearance = -p.y * 162
            case .bottom: clearance = (p.y - 1) * 162
            case .leading: clearance = -p.x * 162
            case .trailing: clearance = (p.x - 1) * 162
            }
            #expect(clearance > radius)
        }
    }

    @Test func longSuspensionResetsToABoundedCalmState() {
        let later = t0.addingTimeInterval(86_400)
        let state = CreatureBehaviorEngine.advance(
            CreatureBehaviorEngine.initial(now: t0), to: later)
        #expect(state.phase == .resting)
        #expect(state.destination == .center)
        #expect(state.nextDecisionAt > later)
        #expect(state.nextBlinkAt > later)
        #expect(state.nextLookAt > later)
    }

    // MARK: Return reaches a visible state (task §11)

    @Test func forcedReturnFromOffscreenEventuallyBecomesVisibleAgain() {
        var state = CreatureBehaviorEngine.debugForce(.exit, from: CreatureBehaviorEngine.initial(now: t0), now: t0)
        var now = t0
        // Ride the forced exit out to .offscreen.
        now = now.addingTimeInterval(state.moveDuration + 0.01)
        state = CreatureBehaviorEngine.advance(state, to: now)
        guard case .offscreen = state.phase else { Issue.record("expected offscreen, got \(state.phase)"); return }

        state = CreatureBehaviorEngine.debugForce(.returnOnscreen, from: state, now: now)
        guard case let .moving(intent) = state.phase, case .peek = intent else {
            Issue.record("expected a moving(.peek) leg back in, got \(state.phase)"); return
        }
        now = now.addingTimeInterval(state.moveDuration + 0.01)
        state = CreatureBehaviorEngine.advance(state, to: now)
        guard case .peeking = state.phase else { Issue.record("expected peeking after the return leg, got \(state.phase)"); return }

        // Drive time far enough forward that autonomy resolves the peek.
        // resolvePeekExpiry always lands on either .offscreen or a settle
        // leg to .resting; replay until visible (.resting), bounded so the
        // test can't hang if the design regresses.
        var iterations = 0
        while state.phase != .resting, iterations < 20 {
            now = now.addingTimeInterval(6)
            state = CreatureBehaviorEngine.advance(state, to: now)
            iterations += 1
        }
        #expect(state.phase == .resting, "the creature must be able to fully return, not get stuck peeking/offscreen forever")
        let p = CreatureBehaviorEngine.position(for: state, at: now)
        #expect((0...1).contains(p.x))
        #expect((0...1).contains(p.y))
    }

    // MARK: Peek remains partially visible (task §11)

    @Test func forcedPeekHoldsOnlyASliverOutsideTheEdge() {
        let start = CreatureBehaviorEngine.initial(now: t0)
        var state = CreatureBehaviorEngine.debugForce(.peek, from: start, now: t0)
        guard case let .moving(intent) = state.phase, case let .peek(edge) = intent else {
            Issue.record("expected a moving(.peek) leg, got \(state.phase)"); return
        }
        let arrival = t0.addingTimeInterval(state.moveDuration + 0.01)
        state = CreatureBehaviorEngine.advance(state, to: arrival)
        #expect(state.phase == .peeking(edge))

        let p = CreatureBehaviorEngine.position(for: state, at: arrival)
        // Peeking holds just past the edge line — a small offset, clearly
        // distinct from (and much smaller than) a full offscreen hide.
        switch edge {
        case .top: #expect((-0.15...0).contains(p.y))
        case .bottom: #expect((1...1.15).contains(p.y))
        case .leading: #expect((-0.15...0).contains(p.x))
        case .trailing: #expect((1...1.15).contains(p.x))
        }
    }

    // MARK: Autonomous movement stays within intended logical limits (task §11)

    @Test func autonomousWanderingNeverExceedsTerritoryOrHideBounds() {
        var state = CreatureBehaviorEngine.initial(now: t0, seed: 99)
        var now = t0
        for _ in 0..<400 {
            now = now.addingTimeInterval(1.5)
            state = CreatureBehaviorEngine.advance(state, to: now)
            let p = CreatureBehaviorEngine.position(for: state, at: now)
            #expect(p.x.isFinite && p.y.isFinite)
            // Generous bound: territory is inset well inside 0...1, and the
            // deepest legal excursion is the offscreen hide margin.
            #expect(p.x > -0.5 && p.x < 1.5)
            #expect(p.y > -0.5 && p.y < 1.5)
            if state.phase == .resting {
                #expect(p.x >= 0.15 && p.x <= 0.85)
                #expect(p.y >= 0.15 && p.y <= 0.85)
            }
        }
    }

    // MARK: Offscreen duration is bounded (task §11)

    @Test(arguments: [1, 2, 3, 4, 5] as [UInt64])
    func offscreenHoldNeverExceedsSixSeconds(_ seed: UInt64) {
        var state = CreatureBehaviorEngine.debugForce(.exit, from: CreatureBehaviorEngine.initial(now: t0, seed: seed), now: t0)
        let now = t0.addingTimeInterval(state.moveDuration + 0.01)
        state = CreatureBehaviorEngine.advance(state, to: now)
        guard case .offscreen = state.phase else { Issue.record("expected offscreen"); return }
        let enteredAt = now
        #expect(state.nextDecisionAt.timeIntervalSince(enteredAt) <= 5.5)
    }

    // MARK: Repeated interactions do not corrupt state (task §11)

    @Test func rapidRepeatedTapsStayBoundedAndNeverCorruptState() {
        var state = CreatureBehaviorEngine.initial(now: t0)
        var now = t0
        for i in 0..<50 {
            now = now.addingTimeInterval(0.05)
            state = CreatureBehaviorEngine.applyTap(state, at: Point2D(x: 0.5, y: 0.5), now: now)
            let attention = CreatureBehaviorEngine.attention(for: state, at: now)
            #expect(attention >= 0 && attention <= 1, "tap \(i) pushed attention out of bounds: \(attention)")
            let p = CreatureBehaviorEngine.position(for: state, at: now)
            #expect(p.x.isFinite && p.y.isFinite)
        }
        // Long quiet period afterward: attention must decay back toward 0,
        // not stay pinned from the rapid burst.
        let quiet = now.addingTimeInterval(30)
        #expect(CreatureBehaviorEngine.attention(for: state, at: quiet) == 0)
    }

    @Test func tapWhileOffscreenBringsReturnForwardWithoutChangingPhase() {
        var state = CreatureBehaviorEngine.debugForce(.exit, from: CreatureBehaviorEngine.initial(now: t0), now: t0)
        let now = t0.addingTimeInterval(state.moveDuration + 0.01)
        state = CreatureBehaviorEngine.advance(state, to: now)
        guard case .offscreen = state.phase else { Issue.record("expected offscreen"); return }
        let originalComeBackAt = state.nextDecisionAt

        state = CreatureBehaviorEngine.applyTap(state, at: Point2D(x: 0.5, y: 0.9), now: now)
        #expect(state.phase == .offscreen(edgeFrom(state.phase)!), "a tap while hidden must not teleport it into view")
        #expect(state.nextDecisionAt <= originalComeBackAt)
    }

    // MARK: Debug forced states work (task §11 / §7)

    @Test func debugRestFreezesInPlace() {
        let wandering = CreatureBehaviorEngine.debugForce(.wander, from: CreatureBehaviorEngine.initial(now: t0), now: t0)
        let mid = t0.addingTimeInterval(wandering.moveDuration / 2)
        let rested = CreatureBehaviorEngine.debugForce(.rest, from: wandering, now: mid)
        #expect(rested.phase == .resting)
        #expect(rested.destination == CreatureBehaviorEngine.position(for: wandering, at: mid))
    }

    @Test func debugWanderProducesASettleLeg() {
        let s = CreatureBehaviorEngine.debugForce(.wander, from: CreatureBehaviorEngine.initial(now: t0), now: t0)
        guard case let .moving(intent) = s.phase else { Issue.record("expected .moving"); return }
        #expect(intent == .settle)
    }

    @Test func debugExitProducesAHideLeg() {
        let s = CreatureBehaviorEngine.debugForce(.exit, from: CreatureBehaviorEngine.initial(now: t0), now: t0)
        guard case let .moving(intent) = s.phase, case .hide = intent else {
            Issue.record("expected .moving(.hide)"); return
        }
    }

    @Test func debugPeekProducesAPeekLeg() {
        let s = CreatureBehaviorEngine.debugForce(.peek, from: CreatureBehaviorEngine.initial(now: t0), now: t0)
        guard case let .moving(intent) = s.phase, case .peek = intent else {
            Issue.record("expected .moving(.peek)"); return
        }
    }

    @Test func debugReturnFromRestingIsANoOpishSettle() {
        // Already visible: returnOnscreen should keep it visible, not force
        // a spurious offscreen detour.
        let s = CreatureBehaviorEngine.debugForce(.returnOnscreen, from: CreatureBehaviorEngine.initial(now: t0), now: t0)
        guard case let .moving(intent) = s.phase else { Issue.record("expected .moving"); return }
        #expect(intent == .settle)
    }

    // MARK: Facing

    @Test func movementSetsFacingTowardTheDestination() {
        var state = CreatureBehaviorEngine.initial(now: t0)
        state.destination = Point2D(x: 0.2, y: 0.5)
        state.origin = Point2D(x: 0.2, y: 0.5)
        let movingRight = CreatureBehaviorEngine.applyTap(state, at: Point2D(x: 0.8, y: 0.5), now: t0)
        #expect(movingRight.facing == 1)
        let movingLeft = CreatureBehaviorEngine.applyTap(movingRight, at: Point2D(x: 0.2, y: 0.5), now: t0.addingTimeInterval(5))
        #expect(movingLeft.facing == -1)
    }
}

private func edgeFrom(_ phase: CreaturePhase) -> ScreenEdge? {
    switch phase {
    case let .offscreen(edge), let .peeking(edge): return edge
    case let .moving(.hide(edge)), let .moving(.peek(edge)): return edge
    default: return nil
    }
}
