// TamagoComplication.swift
//
// VERIFICATION: compiles; rendered in the watchOS 27 simulator's face editor
// only if noted in docs/HANDOFF_LOG.md. Not DEVICE_VERIFIED.
//
// The owner's "put in the widgets" (2026-09-27): Tamago on the watch face and in
// the Smart Stack. Every family shows the approved octopus art (unchanged, on
// black; Complication/Assets.xcassets) and a tap opens the app. No face symbol:
// the creature has no smiley (CREATURE_SPEC). Live content (last reply, whether
// the Mac is reachable) needs an App Group shared with the Watch app: next step
// (D-105).

import SwiftUI
import WidgetKit

@main
struct TamagoComplication: Widget {
    static let kind = "TamagoCompanion"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: Provider()) { _ in
            ComplicationView()
                .containerBackground(for: .widget) { Color.black }
                .widgetURL(URL(string: "tamago://open"))
        }
        .configurationDisplayName("Tamago")
        .description("Your octopus, one tap away. Hold it to talk.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct Entry: TimelineEntry {
    let date: Date
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // Static art: one entry, never refreshed on a schedule (battery, AGENTS.md §5).
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}

/// The approved art. `.desaturated` keeps the white octopus white on tinted
/// faces instead of flattening it into a single-colour blob.
private struct Octopus: View {
    var body: some View {
        Image("Octopus")
            .resizable()
            .widgetAccentedRenderingMode(.desaturated)   // an Image modifier: before scaledToFit
            .scaledToFit()
            .accessibilityLabel("Tamago")
    }
}

private struct ComplicationView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                Color.black
                Octopus().padding(3)
            }
            .clipShape(Circle())
        case .accessoryCorner:
            Octopus()
                .widgetLabel("Tamago")
        case .accessoryRectangular:
            HStack(spacing: 6) {
                Octopus()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Tamago")
                        .font(.headline)
                        .widgetAccentable()
                    Text("Hold to talk")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        default:
            Text("Tamago")
        }
    }
}
