// Family-specific layouts using the approved transparent cutout.
// Verification and Apple rendering guidance: docs/WIDGETS.md.

import SwiftUI
import WidgetKit

struct CreatureWidgetView: View {
    let entry: CreatureEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .containerBackground(for: .widget) {
                // Removable (default): StandBy, CarPlay and tinted/clear Home
                // Screens drop it, and the cutout still floats on their background.
                if family.isSystem { Color.black } else { Color.clear }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Tamago, your octopus friend")
            .accessibilityHint("Opens Tamago")
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .systemSmall:
            CreatureArt()
                .padding(11)

        case .systemMedium:
            HStack(spacing: 14) {
                CreatureArt()
                    .padding(.vertical, 11)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tamago")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                        .widgetAccentable()
                    Text("Your octopus friend")
                        .font(.subheadline)
                        .foregroundStyle(Color.white.opacity(0.7))
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 16)
            .padding(.trailing, 16)

        case .systemLarge, .systemExtraLargePortrait:
            VStack(spacing: 8) {
                CreatureArt()
                    .padding(.top, 16)
                    .padding(.horizontal, 16)
                HStack {
                    Text("Tamago")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .widgetAccentable()
                    Spacer(minLength: 0)
                }
                .padding([.horizontal, .bottom], 16)
            }

        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                CreatureArt()
                    .padding(7)
            }

        case .accessoryRectangular:
            HStack(spacing: 6) {
                CreatureArt()
                VStack(alignment: .leading, spacing: 0) {
                    Text("Tamago")
                        .font(.headline)
                        .widgetAccentable()
                    Text("Tap to open")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }

        case .accessoryInline:
            // WidgetKit reduces inline artwork to a small monochrome symbol.
            Label("Tamago", image: "CreatureCutout")

        default:
            CreatureArt()
                .padding(11)
        }
    }
}

/// The approved octopus, fitted to whatever space it's offered: never
/// stretched, never cropped. `CreatureCutout` is `ref_hero_q34.jpg` with
/// only its black background made transparent (tools/widget-art/make_cutout.py).
struct CreatureArt: View {
    /// Width ÷ height of CreatureCutout.png (488 × 692 px). Passing it
    /// explicitly lets stacks size the art from their height alone.
    static let aspectRatio: CGFloat = 488.0 / 692.0

    var body: some View {
        Image("CreatureCutout")
            .resizable()
            .interpolation(.high)
            .widgetAccentedRenderingMode(.desaturated)
            .aspectRatio(Self.aspectRatio, contentMode: .fit)
    }
}

private extension WidgetFamily {
    var isSystem: Bool {
        switch self {
        case .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .systemExtraLargePortrait: true
        default: false
        }
    }
}

#Preview("Small", as: .systemSmall) { TamagoCreatureWidget() } timeline: { CreatureEntry(date: .now) }
#Preview("Medium", as: .systemMedium) { TamagoCreatureWidget() } timeline: { CreatureEntry(date: .now) }
#Preview("Large", as: .systemLarge) { TamagoCreatureWidget() } timeline: { CreatureEntry(date: .now) }
#Preview("Circular", as: .accessoryCircular) { TamagoCreatureWidget() } timeline: { CreatureEntry(date: .now) }
#Preview("Rectangular", as: .accessoryRectangular) { TamagoCreatureWidget() } timeline: { CreatureEntry(date: .now) }
#Preview("Inline", as: .accessoryInline) { TamagoCreatureWidget() } timeline: { CreatureEntry(date: .now) }

#Preview("Extra Large Portrait", as: .systemExtraLargePortrait) { TamagoCreatureWidget() } timeline: { CreatureEntry(date: .now) }
