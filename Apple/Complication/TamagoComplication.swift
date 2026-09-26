import SwiftUI
import WidgetKit
import TamagoShared

/// Phase 3 placeholder: a static face that opens the app. The mood snapshot
/// shared through an App Group comes in Phase 6 (docs/DECISIONS.md D-105).
@main
struct TamagoComplication: Widget {
    static let kind = "TamagoCompanion"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: Provider()) { _ in
            ComplicationView()
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "tamago://open"))
        }
        .configurationDisplayName("Tamago")
        .description("Your companion at a glance.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct Entry: TimelineEntry {
    let date: Date
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // One entry, no scheduled refresh: the app reloads the timeline when
        // the mood changes (D-105).
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}

private struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("Tamago")
        case .accessoryRectangular:
            VStack(alignment: .leading) {
                Text("Tamago").font(.headline)
                Text(TamagoCharacterState.idle.rawValue)
            }
        default:
            Image(systemName: "face.smiling")
                .font(.title2)
                .widgetAccentable()
        }
    }
}
