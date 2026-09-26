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
    var creatureController: CreatureBehaviorController
    var connection: TamagoConnection

    private let previewStates: [TamagoCharacterState] = [
        .idle, .listening, .acknowledging, .thinking, .toolRunning, .speaking,
        .happy, .success, .confused, .error, .disconnected, .sleeping,
    ]

    /// Text sent verbatim to the real gateway's mock provider (see
    /// `Gateway/src/providers/mock.js`) — chosen so the reaction is
    /// unambiguous proof a real HTTP round trip happened, not the synthetic
    /// `debugRespond` path every other button below uses.
    private let liveGatewayCommands = ["ping", "state happy", "state confused", "tool wifi"]

    var body: some View {
        List {
            Section {
                ForEach(liveGatewayCommands, id: \.self) { command in
                    Button("Send to gateway: \(command)") {
                        sendToGateway(command)
                    }
                }
            } header: {
                Text("Live gateway (task §2/§6 proof)")
            } footer: {
                Text("Requires a running gateway (`cd Gateway && TAMAGO_ALLOW_NO_AUTH=1 npm start`) reachable at TAMAGO_GATEWAY_URL (default http://127.0.0.1:8787, works from the simulator only). Goes through the real HTTP round trip, not the previews below.")
            }

            Section {
                ForEach(previewStates, id: \.self) { target in
                    Button(target.rawValue) {
                        controller.debugGoTo(target)
                    }
                }
            } header: {
                Text("Preview state")
            }

            // D-114: forces the autonomous-life engine through each named
            // phase via the same pure CreatureBehaviorEngine a real decision
            // would use — never bypassing it.
            Section {
                Button("Force idle") { creatureController.debugForce(.rest) }
                Button("Force wander") { creatureController.debugForce(.wander) }
                Button("Force peek") { creatureController.debugForce(.peek) }
                Button("Force exit (offscreen)") { creatureController.debugForce(.exit) }
                Button("Force return") { creatureController.debugForce(.returnOnscreen) }
            } header: {
                Text("Creature behavior")
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
                Text(creatureController.state.phase.debugDescription).font(.caption2).foregroundStyle(.secondary)
            } header: {
                Text("Current state")
            }

            Section {
                LabeledContent("Gateway") {
                    switch connection.isReachable {
                    case .some(true): Text("reachable").foregroundStyle(.green)
                    case .some(false): Text("unreachable").foregroundStyle(.red)
                    case .none: Text("unknown").foregroundStyle(.secondary)
                    }
                }
                if let ms = connection.lastRoundTripMS {
                    LabeledContent("Last round trip", value: "\(ms) ms")
                }
                if let id = connection.lastRequestID {
                    Text(id).font(.caption2).foregroundStyle(.secondary)
                }
            } header: {
                Text("Transport diagnostics (task §21)")
            }
        }
        .navigationTitle("Debug")
    }

    /// Drives the *real* reducer path a live voice interaction will one day
    /// use (`.userActivated` then `.transcript`), not `debugGoTo`'s synthetic
    /// `debugRespond` shortcut — so the resulting `.sendRequest` effect goes
    /// out over `TamagoConnection` to whatever gateway `TAMAGO_GATEWAY_URL`
    /// points at, and the reaction that comes back is the mock provider's
    /// real answer.
    private func sendToGateway(_ text: String) {
        let now = Date()
        controller.apply(.cancel, now: now)
        controller.apply(.userActivated, now: now)
        controller.apply(.transcript(text: text, requestId: UUID()), now: now)
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

extension CreaturePhase {
    var debugDescription: String {
        switch self {
        case .resting: return "resting"
        case .moving(.settle): return "moving(settle)"
        case let .moving(.peek(edge)): return "moving(peek \(edge.debugName))"
        case let .moving(.hide(edge)): return "moving(hide \(edge.debugName))"
        case let .peeking(edge): return "peeking(\(edge.debugName))"
        case let .offscreen(edge): return "offscreen(\(edge.debugName))"
        }
    }
}

private extension ScreenEdge {
    // A plain method rather than `CustomStringConvertible` conformance,
    // which would be a cross-module retroactive conformance on a public
    // TamagoShared type — avoided to keep this a debug-only, zero-warning
    // addition.
    var debugName: String {
        switch self {
        case .top: "top"
        case .bottom: "bottom"
        case .leading: "leading"
        case .trailing: "trailing"
        }
    }
}
#endif
