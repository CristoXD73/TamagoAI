// ListeningBadge.swift
//
// VERIFICATION: builds; seen in the watchOS simulator only if noted in docs/HANDOFF_LOG.md. D-130.
//
// Under Tamago while listening mode is on: a small red dot and how long it has been listening, and a quiet note
// when the Mac can't be reached (the audio waits on the Watch). Nothing else: a charm, not a dashboard.

import SwiftUI

struct ListeningBadge: View {
    var listening: ListeningMode

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(spacing: 1) {
                HStack(spacing: 5) {
                    Circle()
                        .fill(dotColor)
                        .frame(width: 7, height: 7)
                        .opacity(listening.phase == .listening && Int(context.date.timeIntervalSince1970) % 2 == 0 ? 0.45 : 1)
                    Text(title(at: context.date))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.85))
                }
                if let note {
                    Text(note)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.55))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(.black.opacity(0.55), in: Capsule())
        }
        .accessibilityElement(children: .combine)
        .allowsHitTesting(false)
    }

    private var dotColor: Color {
        switch listening.phase {
        case .listening: .red
        case .interrupted: .orange
        default: .gray
        }
    }

    private func title(at now: Date) -> String {
        switch listening.phase {
        case .interrupted: return "Paused"
        case .unavailable: return "Can't listen"
        default:
            guard let since = listening.since else { return "Listening" }
            let s = max(0, Int(now.timeIntervalSince(since)))
            return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
        }
    }

    private var note: String? {
        if case let .unavailable(why) = listening.phase { return why }
        if listening.macReachable == false, listening.waiting > 0 { return "Mac away · \(listening.waiting) saved" }
        return nil
    }
}
