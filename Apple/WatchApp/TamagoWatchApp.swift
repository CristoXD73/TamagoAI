import SwiftUI
import TamagoShared

/// Phase 4 Stage A: the character is live (CharacterStateMachine +
/// CharacterView), and — while idle — a second, independent controller
/// (CreatureBehaviorController, D-114) gives it an autonomous world: it
/// wanders, approaches edges, and goes offscreen on its own. Voice,
/// transport, and TTS are not wired yet — nothing drives
/// CharacterInteractionController except the `#if DEBUG` preview controls
/// (docs/DECISIONS.md D-103, D-102).
@main
struct TamagoWatchApp: App {
    @State private var controller = CharacterInteractionController()
    @State private var creatureController = CreatureBehaviorController()

    var body: some Scene {
        WindowGroup {
            RootView(controller: controller, creatureController: creatureController)
        }
    }
}

private struct RootView: View {
    var controller: CharacterInteractionController
    var creatureController: CreatureBehaviorController

    @State private var selectedPage = 0
    #if DEBUG
    @State private var didApplyLaunchPreview = false
    #endif
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $selectedPage) {
            CharacterScreen(controller: controller, creatureController: creatureController, isVisible: selectedPage == 0)
                .tag(0)
            #if DEBUG
            NavigationStack {
                DebugStateControlsView(controller: controller, creatureController: creatureController)
            }
            .tag(1)
            #endif
        }
        #if DEBUG
        .onAppear {
            guard !didApplyLaunchPreview else { return }
            didApplyLaunchPreview = true
            // Screenshot/automation hook only: `SIMCTL_CHILD_TAMAGO_PREVIEW_STATE=<state>
            // xcrun simctl launch ...` jumps straight to that state on launch,
            // via the same debugGoTo(_:) the debug tab's buttons use.
            if let raw = ProcessInfo.processInfo.environment["TAMAGO_PREVIEW_STATE"],
               let target = TamagoCharacterState(rawValue: raw) {
                controller.debugGoTo(target)
            }
        }
        #endif
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
    var creatureController: CreatureBehaviorController
    var isVisible: Bool

    var body: some View {
        // D-114 / task §9: "pure black background... the Watch face should
        // feel like a tiny dark habitat," full-bleed with no chrome. The
        // state-name label is a debug aid, not production UI.
        ZStack(alignment: .bottom) {
            CharacterView(state: controller.state, creatureController: creatureController, isVisible: isVisible)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            #if DEBUG
            Text(controller.state.visual.rawValue)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)
            #endif
        }
        .background(Color.black.ignoresSafeArea())
    }
}
