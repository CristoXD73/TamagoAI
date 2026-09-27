// FloatingCreature.swift
//
// VERIFICATION: UNVERIFIED on hardware (built for TestFlight; the owner checks
// it on the SE 3). Owner direction, 2026-09-27 (D-119): "use a high quality
// picture of my octopus suspended in that black and give it a light floating
// up and down animation where it barely moves." That instruction is the
// Visual Approval Gate sign-off for this motion (AGENTS.md §7).
//
// The approved hero art (Assets/CharacterReference/octopus-v001/ref_hero_q34.jpg,
// unchanged; its background is pure black, so it has no visible edge on the
// OLED) drifts ±2.5 pt over ~4.8 s. Same renderer pattern as D-102: one
// pausable TimelineView at a low rate, paused whenever nobody can see it
// (other page, Always-On / reduced luminance) and still with Reduce Motion.

import SwiftUI

struct FloatingCreature: View {
    var isVisible: Bool
    /// Tamago's answer, shown small under the creature while it speaks, so it
    /// isn't lost when the Watch is muted (D-119). Plain text, no bubble.
    var caption: String?

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let amplitude: CGFloat = 2.5
    private static let period: TimeInterval = 4.8

    private var isMoving: Bool { isVisible && !isLuminanceReduced && !reduceMotion }

    var body: some View {
        ZStack(alignment: .bottom) {
            TimelineView(.animation(minimumInterval: 1.0 / 20, paused: !isMoving)) { context in
                let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: Self.period) / Self.period
                Image("Creature")
                    .resizable()
                    .scaledToFit()
                    .padding(.vertical, 12)
                    .offset(y: isMoving ? Self.amplitude * sin(phase * 2 * .pi) : 0)
                    .opacity(isLuminanceReduced ? 0.55 : 1)
                    .accessibilityLabel("Tamago, a small white octopus")
            }
            if let caption {
                Text(caption)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.9))
                    .shadow(color: .black, radius: 3)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 12)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: caption)
    }
}
