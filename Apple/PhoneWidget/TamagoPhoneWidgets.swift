// Static approved artwork; seven iPhone families, including iOS 27 portrait XL.
// The extension is embedded by TamagoPhone. See docs/WIDGETS.md.

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
            .systemSmall, .systemMedium, .systemLarge, .systemExtraLargePortrait,
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
