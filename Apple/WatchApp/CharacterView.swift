// CharacterView.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (SE 3 40 mm, watchOS 27.0 simulator).
//
// The renderer decided in docs/DECISIONS.md D-102: TimelineView(.animation)
// paused whenever the app isn't truly live, computing a frame from the
// existing SpriteAnimationClock and CharacterArt. It holds no timer of its
// own and stores no state — everything it draws is a pure function of
// `state` (from CharacterStateMachine, Apple/Shared) and the environment.

import SwiftUI
import TamagoShared

/// Full-screen character. Reads scene phase / reduced luminance / Reduce
/// Motion at this one place, per D-102 and D-104.
struct CharacterView: View {
    let state: CharacterState

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion

    var body: some View {
        let art = CharacterArt.art(for: state.visual)
        let environmentIsLive = scenePhase == .active && !isLuminanceReduced && !accessibilityReduceMotion

        TimelineView(.animation(minimumInterval: 1.0 / 12, paused: !environmentIsLive)) { context in
            // D-102: cadence is only known once we're inside a tick; pausing
            // already covers the environment half of "live".
            let liveNow = environmentIsLive && context.cadence == .live
            let elapsed = context.date.timeIntervalSince(state.enteredAt)
            let frame = SpriteAnimationClock.frame(in: art.sequence, elapsed: elapsed, reduceMotion: !liveNow)
            CharacterFace(expression: art.expression(at: frame))
        }
        .accessibilityElement()
        .accessibilityLabel(Text(state.visual.rawValue))
    }
}

/// Draws one CharacterExpression. No timers, no @State — a pure function of
/// its input, so a new expression each tick just replaces the last one
/// (D-102: "transitions between states cut on the next frame, no cross-fades").
struct CharacterFace: View {
    let expression: CharacterExpression

    private let bodySize: CGFloat = 108

    var body: some View {
        ZStack {
            if case let .ripple(progress) = expression.decoration {
                Circle()
                    .stroke(expression.tint.opacity(1 - progress), lineWidth: 2)
                    .frame(width: bodySize + 55 * progress, height: bodySize + 55 * progress)
            }

            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .fill(expression.tint.gradient)
                .frame(width: bodySize, height: bodySize)
                .overlay {
                    VStack(spacing: 10) {
                        EyesView(style: expression.eyes)
                        MouthView(style: expression.mouth)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    BadgeView(decoration: expression.decoration)
                        .offset(x: 10, y: -10)
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
