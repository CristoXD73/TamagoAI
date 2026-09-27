// TamagoPhoneWidgets.swift
//
// VERIFICATION: UNVERIFIED (written in the cloud, not compiled). This folder
// is not yet an Xcode target: docs/WIDGETS.md §4 has the one-time setup on the
// Mac. Same provider pattern and build settings as Apple/Complication, which
// compiles with this project's MainActor-default isolation.
//
// iPhone widgets (D-122): the approved octopus (static, unchanged art with its
// black background removed) in every iPhone widget family. Tapping any of them
// opens the Tamago app; nothing else yet. No motion, so no Visual Approval
// Gate prototype is needed (AGENTS.md §7); the art itself is owner-approved
// (Assets/CharacterReference/octopus-v001/PROVENANCE.md).
//
// Families (Apple HIG, Widgets > Specifications, iOS dimensions):
//   Home Screen / Today View: systemSmall, systemMedium, systemLarge
//     (systemSmall also appears in StandBy and CarPlay, scaled up, background removed)
//   Lock Screen: accessoryCircular, accessoryRectangular, accessoryInline
//   systemExtraLarge is iPad-only; accessoryCorner is Apple Watch-only.

import SwiftUI
import WidgetKit

@main
struct TamagoPhoneWidgets: WidgetBundle {
    var body: some Widget {
        TamagoCreatureWidget()
    }
}

struct TamagoCreatureWidget: Widget {
    static let kind = "TamagoCreature"
    /// Opens the app. The app ignores the path for now; later widgets can deep
    /// link (e.g. tamago://widget/talk) without changing this one.
    static let openURL = URL(string: "tamago://widget/creature")!

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: CreatureProvider()) { entry in
            CreatureWidgetView(entry: entry)
                .widgetURL(Self.openURL)
        }
        .configurationDisplayName("Tamago")
        .description("Keep your octopus friend close. Tap to open Tamago.")
        // CreatureWidgetView applies HIG margins per family itself (16 pt text,
        // 11 pt around art), so the art can use the full height of each size.
        .contentMarginsDisabled()
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

struct CreatureEntry: TimelineEntry {
    let date: Date
}

/// One static entry and no refreshes: nothing on the widget changes yet, so
/// it costs no background budget. Mood/state entries come later.
struct CreatureProvider: TimelineProvider {
    func placeholder(in context: Context) -> CreatureEntry {
        CreatureEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (CreatureEntry) -> Void) {
        completion(CreatureEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CreatureEntry>) -> Void) {
        completion(Timeline(entries: [CreatureEntry(date: .now)], policy: .never))
    }
}
