// CreatureWidgetView.swift
//
// VERIFICATION: UNVERIFIED (written in the cloud, not compiled or rendered).
//
// Layout per iPhone widget family (D-122, docs/WIDGETS.md). Sizes from the Apple HIG
// (Widgets > Specifications) for the smallest and largest current iPhones:
//
//   family                375×667 pt screen   430×932 pt screen
//   systemSmall           148×148             170×170
//   systemMedium          321×148             364×170
//   systemLarge           321×324             364×382
//   accessoryCircular      68×68               76×76
//   accessoryRectangular  153×68              172×76
//   accessoryInline       225×26              257×26
//
// Never distorted: the art keeps its own aspect ratio (≈ 0.705 wide:tall) and is
// fitted, never stretched or cropped, in every family. Sizes come from the space
// SwiftUI proposes, not hardcoded points, so every iPhone size works. Margins follow
// the HIG: 16 pt for text, 11 pt around graphics.
//
// Rendering modes (Apple: "Optimizing your widget for accented rendering mode
// and Liquid Glass"):
//   fullColor (Home Screen light/dark, StandBy, CarPlay): octopus on black.
//   accented (tinted/clear Home Screen): the system removes the background and
//     would paint any *opaque* image solid white, so the art is a cutout with a
//     transparent background, rendered `.desaturated` to keep the eyes and shading.
//   vibrant (Lock Screen, StandBy at night): brightness drives vibrancy, and the white
//     octopus with dark eyes reads well.

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

        case .systemLarge:
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
            // Inline widgets show a single line of text (images there are
            // reduced to symbols), so the name stands in for the octopus.
            Text("Tamago")

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
        case .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge: true
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
