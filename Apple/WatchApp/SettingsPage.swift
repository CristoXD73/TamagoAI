// SettingsPage.swift
//
// VERIFICATION: builds; checked in the watchOS simulator only if noted in
// docs/HANDOFF_LOG.md. D-126.
//
// The one place with controls, one swipe away from Tamago: the waiting sign the
// owner picked between (dots or ripples), and whether the thinking sounds play.

import SwiftUI

struct SettingsPage: View {
    @AppStorage(WaitingSignStyle.storageKey) private var waitingSign = WaitingSignStyle.dots.rawValue
    @AppStorage(ThinkingSound.enabledKey) private var thinkingSounds = true

    var body: some View {
        List {
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

extension ThinkingSound {
    static let enabledKey = "thinkingSounds"
    static var isEnabled: Bool { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }
}
