# iPhone widgets (D-122)

**Status: UNVERIFIED.** Written in the cloud, without Xcode. The sources, art and this setup guide are
in the repo, but the Xcode target doesn't exist yet (the project file is only edited on the Mac, per
CLAUDE.md). §4 is the one-time setup for the agent on the Mac.

**Scope (owner, 2026-09-27):** put our octopus in every iPhone widget size, and have a tap open the app.
Nothing else yet. Later passes can add mood, the last reply, or a talk button.

![Layout mock of every family at Apple's point sizes](widgets/layout-mock.png)

*The image above is a layout mock drawn with Python at the HIG point sizes, not a SwiftUI render.*

## 1. Sizes (Apple HIG, Widgets > Specifications > iOS dimensions)

| Screen (portrait, pt) | Small | Medium | Large | Circular | Rectangular | Inline |
|---|---|---|---|---|---|---|
| 430×932 | 170×170 | 364×170 | 364×382 | 76×76 | 172×76 | 257×26 |
| 428×926 | 170×170 | 364×170 | 364×382 | 76×76 | 172×76 | 257×26 |
| 414×896 | 169×169 | 360×169 | 360×379 | 76×76 | 160×72 | 248×26 |
| 414×736 | 159×159 | 348×157 | 348×357 | 76×76 | 170×76 | 248×26 |
| 393×852 | 158×158 | 338×158 | 338×354 | 72×72 | 160×72 | 234×26 |
| 390×844 | 158×158 | 338×158 | 338×354 | 72×72 | 160×72 | 234×26 |
| 375×812 | 155×155 | 329×155 | 329×345 | 72×72 | 157×72 | 225×26 |
| 375×667 | 148×148 | 321×148 | 321×324 | 68×68 | 153×68 | 225×26 |
| 360×780 | 155×155 | 329×155 | 329×345 | 72×72 | 157×72 | 225×26 |

**Which families iPhone supports:**

- Home Screen / Today View: **small, medium, large**. Small also appears in **StandBy** and **CarPlay**,
  scaled up with the background removed.
- Lock Screen: **accessory circular, rectangular, inline**.
- Not on iPhone: **extra large** (iPad, Mac and Vision Pro) and **accessory corner** (Apple Watch only).

So the widget ships exactly those six families.

## 2. Keeping the octopus undistorted

- **Aspect ratio:** the art is portrait (488 × 692 px, width:height ≈ 0.705) and every widget family has
  a different shape.
  - The art is always *fitted* (`.aspectRatio(0.705, contentMode: .fit)`), never stretched or cropped,
    and it's sized from the space SwiftUI offers rather than fixed points. The same code is right on
    every iPhone in the table.
  - **Square families** (small, circular): the octopus is centered and limited by height.
  - **Wide families** (medium, rectangular): the octopus sits on the left at full height and the name
    fills the rest.
  - **Large:** the octopus fills most of the widget, with the name below.
- **Margins** (HIG): 16 pt around text and 11 pt around graphics. Default content margins are turned off
  (`contentMarginsDisabled`), so each family can use these exact values.
- **The black background had to go.** On tinted and clear Home Screens (iOS 18+ / Liquid Glass), the
  system removes the widget background and paints any *opaque* image a single solid white. The JPG art,
  black background included, would become a white rectangle.
  - `CreatureCutout.png` is the approved `ref_hero_q34.jpg` with **only its black background made
    transparent**. The octopus's own pixels are untouched.
  - How the background was found: near-black regions connected to the image edge, plus three pure-black
    pockets trapped between tentacles. The eyes are dark but not pure black, and they stay opaque.
  - Reproducible with `tools/widget-art/make_cutout.py`.
- **Rendering modes:**

  | Mode | Where | What Tamago shows |
  |---|---|---|
  | full color | Home Screen light/dark, StandBy, CarPlay | octopus on black (the black background is removable) |
  | accented | tinted / clear Home Screen | the cutout, `.desaturated` (keeps eyes and shading) on the system glass |
  | vibrant | Lock Screen, StandBy at night | brightness drives vibrancy: the white body is bright, the eyes stay dark |

- **Resolution:** the source art is 692 px tall. The art in the large widget is ~320 pt tall, so ~960 px at @3x. It's scaled
  up about 1.4× there. It will look slightly soft; a larger master from the art pipeline fixes that later.

## 3. What's in the repo

| Path | What |
|---|---|
| `Apple/PhoneWidget/TamagoPhoneWidgets.swift` | `@main` widget bundle, the widget configuration (6 families, `widgetURL`), a static timeline (one entry, `.never`) |
| `Apple/PhoneWidget/CreatureWidgetView.swift` | layout per family, container background, accessibility label, Xcode previews for all 6 |
| `Apple/PhoneWidget/Assets.xcassets/CreatureCutout.imageset` | the cutout PNG |
| `Apple/PhoneWidget/Info.plist` | `NSExtensionPointIdentifier = com.apple.widgetkit-extension` (same as the complication) |
| `tools/widget-art/make_cutout.py` | regenerates the cutout from the approved art (Python + Pillow + NumPy) |

- **Tap:** tapping any size opens the app. `widgetURL` is `tamago://widget/creature`. The iPhone app doesn't
  need a URL scheme for widget taps and currently ignores the URL. It can route on it later with
  `.onOpenURL`.
- **Nothing else changed:** `TamagoPhone`, the Watch app, the complication, the gateway and the protocol are
  untouched.

## 4. One-time Xcode setup (agent on the Mac)

1. **Create the target.** Open `Apple/AppleTamago.xcodeproj`, then File ▸ New ▸ Target ▸ iOS ▸ **Widget
   Extension**.
   - Product name `TamagoPhoneWidget`.
   - **Uncheck** Include Live Activity, Include Control and Include Configuration App Intent.
   - Embed in **TamagoPhone**. When asked, don't activate the new scheme (or do; it's harmless).
2. **Swap in the repo's folder.** Delete the template folder Xcode generated (`TamagoPhoneWidget/`: move it to
   the Trash). Then add the existing **`Apple/PhoneWidget`** folder to the new target as a *synchronized
   folder*: drag it into the project navigator and choose "Create folders". Target membership:
   TamagoPhoneWidget only.
3. **Keep Info.plist out of the resources.** In the synchronized folder's target membership exceptions, exclude
   `Info.plist`, as the complication does.
4. **Build settings for TamagoPhoneWidget** (mirror `TamagoComplication`):
   - Base configuration: `Tamago.xcconfig`
   - `PRODUCT_BUNDLE_IDENTIFIER = $(TAMAGO_BUNDLE_PREFIX).widget`
   - `INFOPLIST_FILE = PhoneWidget/Info.plist`, `GENERATE_INFOPLIST_FILE = YES`,
     `INFOPLIST_KEY_CFBundleDisplayName = Tamago`
   - `IPHONEOS_DEPLOYMENT_TARGET = 27.0`, `SDKROOT = iphoneos`, `TARGETED_DEVICE_FAMILY = 1`,
     `SKIP_INSTALL = YES`
   - `SWIFT_VERSION = 6.0`, `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`,
     `SWIFT_APPROACHABLE_CONCURRENCY = YES`
   - `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` equal to TamagoPhone's (App Store validation needs
     them to match)
   - `LD_RUNPATH_SEARCH_PATHS = $(inherited) @executable_path/Frameworks @executable_path/../../Frameworks`
   - Signing: Automatic, team from `Local.xcconfig` (never commit it).
5. **Check it builds:**
   ```sh
   cd Apple && xcodebuild build -project AppleTamago.xcodeproj -scheme TamagoPhone \
     -destination 'generic/platform=iOS Simulator' -derivedDataPath ../.build/DerivedData
   ```
   Then make sure nothing else broke: the `TamagoWatch` scheme test and
   `swift test --scratch-path ../../.build/spm` in `Apple/Shared`.
6. **Look at it.**
   - Canvas: the six `#Preview`s in `CreatureWidgetView.swift`.
   - iPhone simulator, Home Screen: add small, medium and large. Try Customize ▸ Dark, Tinted and Clear.
   - Lock Screen: add circular, rectangular and inline.
   - StandBy: optional. It needs a device on charge in landscape.
   - Tap each widget: the app must open.
7. **TestFlight:** the extension brings a new bundle ID (`<prefix>.widget`). Automatic signing, locally or in Xcode
   Cloud, registers it. Watch for the first archive's signing step.

## 5. Not done, on purpose

- No state in the widget yet: no mood, no last reply, no App Group. Later that's D-105's snapshot, shared
  through an App Group.
- No Control Center control and no Live Activity. These are separate widget kinds, easy to add to the same
  bundle later.
- No motion. Widgets can't run free animation, and any creature motion still needs the Visual Approval Gate.

## Sources

- Apple HIG, Widgets (families, contexts, rendering modes, margins, StandBy, the iOS dimensions table):
  https://developer.apple.com/design/human-interface-guidelines/widgets
- Optimizing your widget for accented rendering mode and Liquid Glass ("tints opaque images with a single
  white color"; use `desaturated` for images):
  https://developer.apple.com/documentation/widgetkit/optimizing-your-widget-for-accented-rendering-mode-and-liquid-glass
- `widgetAccentedRenderingMode(_:)` (iOS 18+):
  https://developer.apple.com/documentation/swiftui/image/widgetaccentedrenderingmode(_:)
- Preparing widgets for additional contexts and appearances (rendering-mode switch, removable backgrounds,
  StandBy/CarPlay use systemSmall):
  https://developer.apple.com/documentation/widgetkit/preparing-widgets-for-additional-contexts-and-appearances
- `contentMarginsDisabled()`:
  https://developer.apple.com/documentation/swiftui/widgetconfiguration/contentmarginsdisabled()
- `showsWidgetContainerBackground`:
  https://developer.apple.com/documentation/swiftui/environmentvalues/showswidgetcontainerbackground
