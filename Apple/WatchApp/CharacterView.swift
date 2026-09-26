// CharacterView.swift
//
// VERIFICATION: UNVERIFIED for the post-audit timeline/low-power changes.
// Prior renderer: SIMULATOR_VERIFIED_ONLY (Claude, SE 3 40 mm).
//
// The renderer decided in docs/DECISIONS.md D-102: TimelineView(.animation)
// paused whenever the app isn't truly live, computing a frame from the
// existing SpriteAnimationClock and CharacterArt. It holds no timer of its
// own; only view visibility is stored. Everything it draws is a function of
// `state` (from CharacterStateMachine, Apple/Shared) and the environment.
//
// D-114 extends this for `.idle`: instead of a small centered breathing
// loop, the character becomes CreatureIdleStage — a full-screen habitat
// driven by CreatureBehaviorController — so it can wander, approach edges,
// and go offscreen (task: "make TamagoAI feel like a living creature
// inhabiting the screen"). Every other visual state is untouched: same
// CharacterArt loop, same centered CharacterFace, same layout. This view is
// still the only place that ticks CreatureBehaviorController — one call,
// only while idle and live — so D-102's "no timer of its own" holds for the
// creature layer too.

import SwiftUI
import TamagoShared

/// Full-screen character. Reads scene phase / reduced luminance / Reduce
/// Motion at this one place, per D-102 and D-104.
struct CharacterView: View {
    let state: CharacterState
    var creatureController: CreatureBehaviorController
    var isVisible: Bool = true
    @State private var isPresented = false

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion

    var body: some View {
        let environmentIsLive = isVisible && isPresented && scenePhase == .active && !isLuminanceReduced && !accessibilityReduceMotion

        TimelineView(.animation(minimumInterval: 1.0 / 12, paused: !environmentIsLive)) { context in
            // D-102: cadence is only known once we're inside a tick; pausing
            // already covers the environment half of "live".
            let liveNow = environmentIsLive && context.cadence == .live

            if state.visual == .idle {
                // Keep observation writes outside body evaluation. Cadence
                // controls drawing fidelity; the active environment gates
                // world advancement without introducing another timer.
                Group {
                    if liveNow {
                        CreatureIdleStage(controller: creatureController, now: context.date)
                    } else {
                        // D-104: a visible static pose, even if autonomy was
                        // offscreen when the environment stopped being live.
                        let art = CharacterArt.art(for: .idle)
                        CharacterFace(expression: art.expression(at: art.sequence.lowPowerFrame))
                    }
                }
                    .onChange(of: context.date, initial: true) { _, now in
                        if environmentIsLive { creatureController.tick(now: now) }
                    }
            } else {
                let art = CharacterArt.art(for: state.visual)
                let elapsed = context.date.timeIntervalSince(state.enteredAt)
                let frame = SpriteAnimationClock.frame(in: art.sequence, elapsed: elapsed, reduceMotion: !liveNow)
                CharacterFace(expression: art.expression(at: frame))
            }
        }
        // Reserve stable space below the ripple without letting its changing
        // diameter push the label onto the 40 mm page indicator.
        .frame(height: state.visual == .listening ? 140 : nil)
        .onAppear { isPresented = true }
        .onDisappear { isPresented = false }
        .accessibilityElement()
        .accessibilityLabel(Text(state.visual.rawValue))
    }
}

/// Draws one CharacterExpression. No timers, no @State — a pure function of
/// its input, so a new expression each tick just replaces the last one
/// (D-102: "transitions between states cut on the next frame, no cross-fades").
///
/// Body silhouette is an octopus-like dome + tentacle stubs (D-114 art
/// direction: "curious, slightly alien... not human-like"), not a plain box.
struct CharacterFace: View {
    let expression: CharacterExpression

    private let bodySize: CGFloat = 108

    var body: some View {
        ZStack {
            OctopusSilhouette()
                .fill(expression.tint.gradient)
                .frame(width: bodySize, height: bodySize)
                .overlay {
                    VStack(spacing: 10) {
                        EyesView(style: expression.eyes)
                        MouthView(style: expression.mouth)
                    }
                    .offset(y: -bodySize * 0.12)
                }
                .overlay(alignment: .topTrailing) {
                    BadgeView(decoration: expression.decoration)
                        .offset(x: 10, y: -10)
                }
        }
        // Decoration must not change the VStack's measured height each tick:
        // the 163-point ripple previously pushed the label into the page dots.
        .background {
            if case let .ripple(progress) = expression.decoration {
                Circle()
                    .stroke(expression.tint.opacity(1 - progress), lineWidth: 2)
                    .frame(width: bodySize + 55 * progress, height: bodySize + 55 * progress)
            }
        }
        .scaleEffect(expression.scale)
        .rotationEffect(expression.tilt)
        .offset(y: expression.bounceY)
    }
}

private struct EyesView: View {
    let style: EyeStyle

    var body: some View {
        HStack(spacing: 20) {
            eye(pupilOffset: 1)
            eye(pupilOffset: -1)
        }
    }

    @ViewBuilder
    private func eye(pupilOffset: CGFloat) -> some View {
        switch style {
        case .open:
            Circle().fill(.white).frame(width: 11, height: 11)
                .overlay(Circle().fill(.black.opacity(0.8)).frame(width: 5, height: 5))
        case .wide:
            Circle().fill(.white).frame(width: 15, height: 15)
                .overlay(Circle().fill(.black.opacity(0.8)).frame(width: 6, height: 6))
        case .closed:
            Capsule().fill(.black.opacity(0.75)).frame(width: 12, height: 2.5)
        case .happy:
            HappyEyeArc().stroke(style: StrokeStyle(lineWidth: 3, lineCap: .round)).frame(width: 14, height: 8)
        case .x:
            XMark().stroke(style: StrokeStyle(lineWidth: 2.5, lineCap: .round)).frame(width: 12, height: 12)
        case let .lookAway(direction):
            Circle().fill(.white).frame(width: 12, height: 12)
                .overlay(
                    Circle().fill(.black.opacity(0.8)).frame(width: 5, height: 5)
                        .offset(x: direction * 3)
                )
        case .sleepy:
            Capsule().fill(.black.opacity(0.6)).frame(width: 12, height: 4)
        }
    }
}

private struct MouthView: View {
    let style: MouthStyle

    var body: some View {
        switch style {
        case .neutral:
            Capsule().fill(.black.opacity(0.7)).frame(width: 16, height: 3)
        case .smile:
            SmileArc().stroke(style: StrokeStyle(lineWidth: 3, lineCap: .round)).frame(width: 22, height: 10)
        case .bigSmile:
            SmileArc(depth: 1.4).stroke(style: StrokeStyle(lineWidth: 3.5, lineCap: .round)).frame(width: 26, height: 14)
        case let .talk(openAmount):
            Capsule().fill(.black.opacity(0.7)).frame(width: 16, height: 3 + 14 * max(0, min(1, openAmount)))
        case .frown:
            FrownArc().stroke(style: StrokeStyle(lineWidth: 3, lineCap: .round)).frame(width: 20, height: 8)
        case .o:
            Circle().stroke(lineWidth: 3).frame(width: 12, height: 12)
        case .flatLine:
            Capsule().fill(.black.opacity(0.5)).frame(width: 18, height: 2)
        }
    }
}

private struct BadgeView: View {
    let decoration: Decoration

    var body: some View {
        switch decoration {
        case .none, .ripple:
            EmptyView()
        case .sparkle:
            Image(systemName: "sparkle").foregroundStyle(.yellow)
        case .checkmark:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.white, .green)
        case .questionMark:
            Text("?").font(.headline.bold()).foregroundStyle(.orange)
        case .zzz:
            Text("z").font(.caption.bold()).foregroundStyle(.indigo)
        case let .orbitDot(angle):
            Circle().fill(.white).frame(width: 6, height: 6)
                .offset(x: -54, y: 0)
                .rotationEffect(angle, anchor: UnitPoint(x: 1.5, y: 0.5))
        }
    }
}

// MARK: - Custom paths

/// A dome-shaped mantle over a row of rounded tentacle stubs. Deliberately
/// simple (D-114: "improve the existing procedural placeholder enough to
/// establish the architecture," not final art) but reads as octopus-like
/// rather than a plain box, and is what CreatureView's future final
/// animated artwork replaces without touching behavior/expression code.
private nonisolated struct OctopusSilhouette: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let domeHeight = rect.height * 0.66
        let dome = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: domeHeight)
        path.addRoundedRect(in: dome, cornerSize: CGSize(width: rect.width * 0.5, height: domeHeight * 0.75), style: .continuous)

        // Narrower stubs with real gaps between them, alternating length,
        // so the fringe reads as separate tentacles rather than a second
        // solid band that just recreates a rounded rectangle.
        let tentacleCount = 5
        let slot = rect.width / CGFloat(tentacleCount)
        let tentacleWidth = slot * 0.55
        let tentacleTop = rect.height * 0.5
        for i in 0..<tentacleCount {
            let centerX = slot * (CGFloat(i) + 0.5)
            let isShort = i % 2 == 1
            let bottom = isShort ? rect.height * 0.86 : rect.height
            let tentacle = CGRect(
                x: centerX - tentacleWidth / 2, y: tentacleTop,
                width: tentacleWidth, height: bottom - tentacleTop
            )
            path.addRoundedRect(in: tentacle, cornerSize: CGSize(width: tentacleWidth * 0.5, height: tentacleWidth * 0.5), style: .continuous)
        }
        return path
    }
}

private nonisolated struct SmileArc: Shape {
    var depth: CGFloat = 1.0
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: 0))
        p.addQuadCurve(to: CGPoint(x: rect.width, y: 0), control: CGPoint(x: rect.width / 2, y: rect.height * depth))
        return p
    }
}

private nonisolated struct FrownArc: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: rect.height))
        p.addQuadCurve(to: CGPoint(x: rect.width, y: rect.height), control: CGPoint(x: rect.width / 2, y: -rect.height * 0.6))
        return p
    }
}

private nonisolated struct HappyEyeArc: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: rect.height))
        p.addQuadCurve(to: CGPoint(x: rect.width, y: rect.height), control: CGPoint(x: rect.width / 2, y: 0))
        return p
    }
}

private nonisolated struct XMark: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: 0))
        p.addLine(to: CGPoint(x: rect.width, y: rect.height))
        p.move(to: CGPoint(x: rect.width, y: 0))
        p.addLine(to: CGPoint(x: 0, y: rect.height))
        return p
    }
}

#Preview("Idle") {
    CharacterFace(expression: CharacterArt.art(for: .idle).expressions[0])
}

#Preview("Happy") {
    CharacterFace(expression: CharacterArt.art(for: .happy).expressions[0])
}
