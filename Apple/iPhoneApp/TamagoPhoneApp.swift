// VERIFICATION: UNVERIFIED (D-127 chat root written in the cloud, not compiled).

import SwiftUI
import TamagoShared

/// The iPhone side is where Tamago's words land (D-127), not a second Tamago:
/// the creature lives on the Watch and thinks on the Mac. Unpaired, it shows how
/// to pair with the Mac; paired, the conversation (PROTOCOL_V1 §18).
@main
struct TamagoPhoneApp: App {
    @State private var model = ChatModel()
    /// The startup sequence plays once per launch (VISUAL_APPROVAL_GATE #17).
    @State private var showStartup = true
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if model.isPaired {
                    ChatView(model: model)
                } else {
                    PairingScreen(model: model)
                }
            }
            .overlay {
                if showStartup { StartupSequence { showStartup = false } }
            }
            .preferredColorScheme(.dark)
            // Read the conversation only while the app is in front (no background work).
            .onChange(of: scenePhase, initial: true) { _, phase in
                if phase == .active { model.start() } else { model.stop() }
            }
            .onOpenURL { _ in }   // widget taps (tamago://widget/…) just open the app for now
        }
    }
}
