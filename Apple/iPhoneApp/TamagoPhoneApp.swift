import SwiftUI
import TamagoShared

/// The iPhone side is a doorway, not a second Tamago: the creature lives on the
/// Watch and thinks on the Mac (D-108 keeps the relay for later). The approved
/// art (unchanged) on black, and one line on how to meet it.
@main
struct TamagoPhoneApp: App {
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                VStack(spacing: 20) {
                    Image("Octopus")
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 360)
                        .accessibilityLabel("Tamago, a small white octopus")
                    Text("TamagoAI")
                        .font(.title.weight(.semibold))
                        .foregroundStyle(.white)
                    Text("Tamago lives on your Apple Watch.\nOpen it there and hold it to talk.")
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.7))
                }
                .padding(24)
            }
            .preferredColorScheme(.dark)
        }
    }
}
