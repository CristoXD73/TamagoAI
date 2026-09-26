import SwiftUI
import TamagoShared

/// Phase 4 Stage A: the character is live (CharacterStateMachine +
/// CharacterView). Voice, transport, and TTS are not wired yet — nothing
/// drives the controller except the `#if DEBUG` preview controls
/// (docs/DECISIONS.md D-103, D-102).
@main
struct TamagoWatchApp: App {
    @State private var controller = CharacterInteractionController()

    var body: some Scene {
        WindowGroup {
            RootView(controller: controller)
        }
    }
}

private struct RootView: View {
    var controller: CharacterInteractionController

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView {
            CharacterScreen(controller: controller)
            #if DEBUG
            NavigationStack {
                DebugStateControlsView(controller: controller)
            }
            #endif
        }
        // D-104: `.background` cancels back to idle (no request/speech to
        // cancel yet in Stage A, but this alone already satisfies "leaving/
        // re-entering the app does not corrupt state" — relaunch never
        // resumes a transient state like `.thinking`). `.inactive` is left
        // alone; CharacterView already pauses/shows the low-power pose for it.
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background {
                controller.apply(.backgrounded)
            }
        }
    }
}

private struct CharacterScreen: View {
    var controller: CharacterInteractionController

    var body: some View {
        VStack(spacing: 6) {
            CharacterView(state: controller.state)
            Text(controller.state.visual.rawValue)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        #if DEBUG
        .onAppear {
            // Screenshot/automation hook only: `SIMCTL_CHILD_TAMAGO_PREVIEW_STATE=<state>
            // xcrun simctl launch ...` jumps straight to that state on launch,
            // via the same debugGoTo(_:) the debug tab's buttons use.
            if let raw = ProcessInfo.processInfo.environment["TAMAGO_PREVIEW_STATE"],
               let target = TamagoCharacterState(rawValue: raw) {
                controller.debugGoTo(target)
            }
        }
        #endif
    }
}
