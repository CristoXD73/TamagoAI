// SettingsPage.swift
//
// VERIFICATION: builds; checked in the watchOS simulator only if noted in
// docs/HANDOFF_LOG.md. D-126.
//
// The one place with controls, one swipe away from Tamago: AI or listening mode
// (D-130), the waiting sign the owner picked between (dots or ripples), and
// whether the thinking sounds play.

import SwiftUI

struct SettingsPage: View {
    var listening: ListeningMode
    /// Listening needs a paired Mac; the app shows pairing instead.
    var onNeedsPairing: () -> Void = {}
    var canListen: Bool = true

    @AppStorage(WaitingSignStyle.storageKey) private var waitingSign = WaitingSignStyle.dots.rawValue
    @AppStorage(ThinkingSound.enabledKey) private var thinkingSounds = true

    var body: some View {
        List {
            Section {
                Picker("Mode", selection: Binding(
                    get: { listening.isOn ? TamagoMode.listening : .ai },
                    set: { mode in
                        switch mode {
                        case .ai: listening.stop()
                        case .listening:
                            guard canListen else { onNeedsPairing(); return }
                            Task { await listening.start() }
                        }
                    }
                )) {
                    ForEach(TamagoMode.allCases) { mode in Text(mode.title).tag(mode) }
                }
            } header: {
                Text("Mode")
            } footer: {
                Text(listening.isOn
                     ? "Listening until you switch back or hold Tamago. Everything is sent to your Mac and written out there."
                     : "AI: hold Tamago to talk. Listening: records without stopping and your Mac writes it out, fillers removed.")
            }
            Section("While Tamago thinks") {
                Picker("Waiting sign", selection: $waitingSign) {
                    ForEach(WaitingSignStyle.allCases) { style in
                        Text(style.title).tag(style.rawValue)
                    }
                }
                Toggle("Thinking sounds", isOn: $thinkingSounds)
            }
        }
        .navigationTitle("Tamago")
    }
}

enum TamagoMode: String, CaseIterable, Identifiable {
    case ai, listening
    var id: String { rawValue }
    var title: String { self == .ai ? "AI" : "Listening" }
}

extension ThinkingSound {
    static let enabledKey = "thinkingSounds"
    static var isEnabled: Bool { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }
}
