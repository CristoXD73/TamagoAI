import SwiftUI
import TamagoShared
#if DEBUG
import WatchKit
#endif

/// The character is live (CharacterStateMachine + CharacterView); while idle,
/// CreatureBehaviorController (D-114) gives it an autonomous world. The Mac
/// link, pairing, voice input, speech and sound run through TamagoConnection
/// (D-115, D-116). Hold anywhere on the creature to talk.
@main
struct TamagoWatchApp: App {
    @State private var controller = CharacterInteractionController()
    @State private var creatureController = CreatureBehaviorController()
    @State private var connection = TamagoConnection(speech: SpeechOutput(), sounds: CreatureSoundPlayer())
    /// D-130: records without stopping and sends it to the Mac, instead of answering.
    @State private var listening = ListeningMode()

    var body: some Scene {
        WindowGroup {
            RootView(controller: controller, creatureController: creatureController, connection: connection, listening: listening)
        }
        // Owner, 2026-09-27: "remove the clock from the main view … we are working
        // towards a charm, not a watch AI." Hides the system time over the app.
        .persistentSystemOverlays(.hidden)
    }
}

private struct RootView: View {
    var controller: CharacterInteractionController
    var creatureController: CreatureBehaviorController
    var connection: TamagoConnection
    var listening: ListeningMode

    @State private var selectedPage = 0
    @State private var confirmStopListening = false
    @State private var showPairing = false
    @State private var didOfferPairing = false
    #if DEBUG
    @State private var didApplyLaunchPreview = false
    #endif
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $selectedPage) {
            CharacterScreen(controller: controller, creatureController: creatureController,
                            isVisible: selectedPage == 0, caption: connection.caption, listening: listening,
                            onHoldStart: holdStarted, onHoldEnd: { connection.endHold() })
                // The clock sits in the navigation bar area: hide it on Tamago's own page.
                .toolbar(.hidden, for: .navigationBar)
                .tag(0)
            // D-126: the waiting sign and thinking sounds, one swipe away.
            NavigationStack {
                SettingsPage(listening: listening, onNeedsPairing: { showPairing = true }, canListen: connection.canTalk)
            }
                .tag(1)
            #if DEBUG
            NavigationStack {
                DebugStateControlsView(controller: controller, creatureController: creatureController,
                                       connection: connection, onTalk: talk)
            }
            .tag(2)
            #endif
        }
        // D-130: in listening mode, holding Tamago offers to stop instead of talking to it.
        .confirmationDialog("Stop listening?", isPresented: $confirmStopListening) {
            Button("Stop listening", role: .destructive) { listening.stop() }
            Button("Keep listening", role: .cancel) {}
        }
        .sheet(isPresented: $showPairing) {
            PairingView(connection: connection)
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
            // Same pair(code:) path as the pairing sheet, minus typing — the
            // simulator can't type into the Scribble canvas (see VoiceInput).
            if let code = ProcessInfo.processInfo.environment["TAMAGO_DEBUG_PAIRING_CODE"] {
                didOfferPairing = true
                Task {
                    _ = await connection.pair(code: code)
                    if ProcessInfo.processInfo.environment["TAMAGO_DEBUG_LISTEN"] == "1" { await listening.start() }
                }
            } else if ProcessInfo.processInfo.environment["TAMAGO_DEBUG_LISTEN"] == "1" {
                // Same switch as the Settings page's Mode picker (D-130); TAMAGO_DEBUG_LISTEN_STOP_AFTER=<s>
                // then flips it back, as the owner's "Stop listening" would.
                Task {
                    await listening.start()
                    if let s = ProcessInfo.processInfo.environment["TAMAGO_DEBUG_LISTEN_STOP_AFTER"].flatMap(Double.init) {
                        try? await Task.sleep(for: .seconds(s))
                        listening.stop()
                    }
                }
            }
        }
        #endif
        .onAppear {
            // Wires every CharacterEffect (from any call site) to real
            // execution. One-time: RootView's identity is stable for the app's lifetime.
            connection.attach(to: controller)
            listening.client = { [connection] in connection.pairedClient }
            if scenePhase == .active { becameActive() }
        }
        // D-104: `.background` cancels back to idle. Link checks run only
        // while active (task §22; D-116).
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                becameActive()
            } else {
                connection.sceneBecameInactive()
            }
            if newPhase == .background {
                controller.apply(.backgrounded)
            }
        }
    }

    private func becameActive() {
        connection.sceneBecameActive()
        // Picks listening back up if watchOS ended the app while it was on, and sends anything still waiting.
        listening.appBecameActive()
        // First-run pairing: offered once per launch while unpaired.
        if !connection.canTalk, !didOfferPairing {
            didOfferPairing = true
            showPairing = true
        }
    }

    private func holdStarted() {
        if listening.isOn {
            confirmStopListening = true
            return
        }
        Task {
            if await connection.beginHold() == .needsPairing { showPairing = true }
        }
    }

    private func talk() {
        if connection.beginTalking() == .needsPairing {
            showPairing = true
        }
    }
}

private struct CharacterScreen: View {
    var controller: CharacterInteractionController
    var creatureController: CreatureBehaviorController
    var isVisible: Bool
    var caption: String?
    var listening: ListeningMode
    var onHoldStart: () -> Void
    var onHoldEnd: () -> Void

    /// From the release of the hold until the answer starts (D-126).
    private static let waitingStates: Set<TamagoCharacterState> = [.acknowledging, .thinking, .toolRunning]

    var body: some View {
        // D-114: "pure black background... a tiny dark habitat," full-bleed
        // with no chrome. The state-name label is a debug aid, not production UI.
        //
        // FULL-SCREEN INVARIANT (AGENTS.md §5, D-115 addendum): the stage must
        // equal the whole display — 162×197 pt on the SE 3 40 mm. A previous
        // regression measured 158×131 pt because `.ignoresSafeArea()` was on
        // the *background* only, leaving the content inside the safe area.
        // `.ignoresSafeArea()` belongs on this ZStack. DEBUG builds measure the
        // stage and show ✓/✗ in the diagnostics panel (StageMetrics).
        ZStack(alignment: .top) {
            // D-119 (owner direction): the approved art, gently floating. The
            // procedural CharacterView (D-114) stays in the repo but off screen.
            FloatingCreature(isVisible: isVisible, caption: caption,
                             isWaiting: Self.waitingStates.contains(controller.state.visual))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                #if DEBUG
                .background(GeometryReader { geo in
                    Color.clear
                        .onAppear { StageMetrics.shared.record(geo.size) }
                        .onChange(of: geo.size) { _, size in StageMetrics.shared.record(size) }
                })
                #endif
            if listening.isOn {
                ListeningBadge(listening: listening)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 10)
            }
            #if DEBUG
            Text(controller.state.visual.rawValue)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            #endif
        }
        .background(Color.black)
        .ignoresSafeArea()
        // CREATURE_SPEC §4: "press and hold ≥ 0.45 s anywhere" is the talk
        // trigger. A plain tap still belongs to the creature (approach/attention).
        // D-120: hold to talk, release to send (recording while held).
        .onLongPressGesture(minimumDuration: 0.45, maximumDistance: 40, perform: onHoldStart,
                            onPressingChanged: { pressing in if !pressing { onHoldEnd() } })
    }
}

#if DEBUG
/// DEBUG-only regression guard for the full-screen invariant above.
@MainActor
@Observable
final class StageMetrics {
    static let shared = StageMetrics()
    private(set) var stageSize: CGSize?
    let screenSize = WKInterfaceDevice.current().screenBounds.size

    var isFullScreen: Bool? {
        guard let stageSize, stageSize.width > 0 else { return nil }
        return stageSize.width >= screenSize.width - 0.5 && stageSize.height >= screenSize.height - 0.5
    }

    func record(_ size: CGSize) {
        stageSize = size
        if isFullScreen == false {
            print("STAGE REGRESSION: creature stage \(size) is smaller than the screen \(screenSize). See AGENTS.md §5.")
        }
    }
}
#endif
