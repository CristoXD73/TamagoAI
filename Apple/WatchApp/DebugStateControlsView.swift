// DebugStateControlsView.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (SE 3 40 mm).
//
// Development-only mechanism (Phase 4 Stage A) to preview every character
// animation before voice/networking exist. `#if DEBUG`-gated: it does not
// compile into a Release build, so it can never become production
// architecture by accident.
//
// It never bypasses CharacterStateMachine. `debugGoTo` only ever calls the
// controller's real `apply(_:)`, composing whatever *legal* event sequence
// reaches the requested preview state — the same reducer a real interaction
// would drive, exercised end to end on-device.

#if DEBUG
import SwiftUI
import TamagoShared

struct DebugStateControlsView: View {
    var controller: CharacterInteractionController

    private let previewStates: [TamagoCharacterState] = [
        .idle, .listening, .acknowledging, .thinking, .toolRunning, .speaking,
        .happy, .success, .confused, .error, .disconnected, .sleeping,
    ]

    var body: some View {
        List {
            Section {
                ForEach(previewStates, id: \.self) { target in
                    Button(target.rawValue) {
                        controller.debugGoTo(target)
                    }
                }
            } header: {
                Text("Preview state")
            }

            Section {
                Button("reactionFinished") {
                    if let id = controller.state.activeRequestID {
                        controller.apply(.reactionFinished(requestId: id))
                    }
                }
                Button("cancel") { controller.apply(.cancel) }
            } header: {
                Text("Manual events")
            }

            Section {
                Text(controller.state.visual.rawValue).bold()
                if let id = controller.state.activeRequestID {
                    Text(id).font(.caption2).foregroundStyle(.secondary)
                }
            } header: {
                Text("Current state")
            }
        }
        .navigationTitle("Debug")
    }
}

extension CharacterInteractionController {
    /// Drives the real reducer from wherever it currently is to `target`,
    /// always starting from a clean `cancel` (legal from any state).
    func debugGoTo(_ target: TamagoCharacterState) {
        let now = Date()
        apply(.cancel, now: now)

        switch target {
        case .idle:
            break
        case .sleeping:
            apply(.inactivityTimeout, now: now)
        case .disconnected:
            apply(.routeLost, now: now)
        case .listening:
            apply(.userActivated, now: now)
        case .acknowledging:
            apply(.userActivated, now: now)
            apply(.transcript(text: "Preview request.", requestId: UUID()), now: now)
        case .thinking:
            debugGoTo(.acknowledging)
            if let id = state.activeRequestID {
                apply(.ackBeatElapsed(requestId: id), now: Date())
            }
        case .toolRunning:
            debugGoTo(.thinking)
            if let requestId = state.activeRequestID {
                apply(.toolProgress(requestId: requestId), now: Date())
            }
        case .speaking:
            debugGoTo(.thinking)
            debugRespond(speechText: "This is a preview of the speaking animation.", characterState: .success, haptic: .success)
        case .happy:
            debugGoTo(.thinking)
            debugRespond(speechText: "", characterState: .happy, haptic: .success)
        case .success:
            debugGoTo(.thinking)
            debugRespond(speechText: "", characterState: .success, haptic: .success)
        case .confused:
            debugGoTo(.thinking)
            debugRespond(speechText: "", characterState: .confused, haptic: .notification)
        case .error:
            debugGoTo(.thinking)
            debugRespond(speechText: "", characterState: .error, haptic: .failure)
        }
    }

    private func debugRespond(speechText: String, characterState: TamagoCharacterState, haptic: TamagoHaptic) {
        guard let requestId = state.activeRequestID else { return }
        let response = TamagoResponse(
            requestId: requestId, status: .ok, text: "Preview.", speechText: speechText,
            characterState: characterState, haptic: haptic, followUpExpected: false, error: nil)
        apply(.response(response))
    }
}
#endif
