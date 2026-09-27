// WaitingSign.swift
//
// VERIFICATION: builds; checked in the watchOS simulator only if noted in
// docs/HANDOFF_LOG.md. D-126, Visual Approval Gate #13.
//
// Owner, 2026-09-27, from the preview page: "B and D keep both and we will make
// it so you can pick". Shown from the moment the hold is released until the
// answer starts. B: three dots under the tentacles. D: two ripples spreading
// from the head. The choice lives in @AppStorage and is set on SettingsPage.

import SwiftUI

enum WaitingSignStyle: String, CaseIterable, Identifiable {
    case dots
    case ripples

    static let storageKey = "waitingSign"
    var id: String { rawValue }
    var title: String { self == .dots ? "Dots" : "Ripples" }
}

struct WaitingSign: View {
    var style: WaitingSignStyle

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            switch style {
            case .dots: dots(t)
            case .ripples: ripples(t)
            }
        }
        .allowsHitTesting(false)
        .accessibilityLabel("Tamago is thinking")
    }

    /// B: 1.2 s cycle, each dot 0.2 s after the last; brightens and lifts 3 pt at 40 %.
    private func dots(_ t: TimeInterval) -> some View {
        VStack {
            Spacer()
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { i in
                    let p = reduceMotion ? 0.4 : (t - Double(i) * 0.2).truncatingRemainder(dividingBy: 1.2) / 1.2
                    let lift = max(0, 1 - abs(p - 0.4) / 0.4)
                    Circle()
                        .fill(Color(white: 0.95))
                        .frame(width: 6, height: 6)
                        .opacity(0.25 + 0.75 * lift)
                        .offset(y: -3 * lift)
                }
            }
            .padding(.bottom, 10)
        }
    }

    /// D: two rings 1 s apart, each 2 s from 0.7× to 1.7× while fading out, centred on the head.
    private func ripples(_ t: TimeInterval) -> some View {
        GeometryReader { geo in
            let head = CGPoint(x: geo.size.width / 2, y: geo.size.height * 0.30)
            ZStack {
                ForEach(0..<2, id: \.self) { i in
                    let p = reduceMotion ? 0.3 : ((t + Double(i)).truncatingRemainder(dividingBy: 2.0)) / 2.0
                    Circle()
                        .stroke(Color(red: 0.50, green: 0.78, blue: 0.85), lineWidth: 1.2)
                        .frame(width: 60, height: 60)
                        .scaleEffect(0.7 + p)
                        .opacity(0.8 * (1 - p))
                        .position(head)
                }
            }
        }
    }
}
