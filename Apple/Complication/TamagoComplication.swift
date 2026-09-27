// Static approved artwork; see docs/WIDGETS.md for rendering and verification.

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

/// Transparent approved cutout. Keep grayscale detail in watch-face accented mode.
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
            // An opaque foreground background is tinted white on accented faces.
            // Keep the background only in containerBackground, where WidgetKit owns it.
            Octopus().padding(3)
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
        case .accessoryInline:
            Label("Tamago", image: "Octopus")
        default:
            Octopus()
        }
    }
}

#Preview("Circular", as: .accessoryCircular) { TamagoComplication() } timeline: { Entry(date: .now) }
#Preview("Corner", as: .accessoryCorner) { TamagoComplication() } timeline: { Entry(date: .now) }
#Preview("Rectangular", as: .accessoryRectangular) { TamagoComplication() } timeline: { Entry(date: .now) }
#Preview("Inline", as: .accessoryInline) { TamagoComplication() } timeline: { Entry(date: .now) }
