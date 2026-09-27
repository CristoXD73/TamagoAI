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
    var onTalk: () -> Void

    @State private var pairingStatus: String?

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
            diagnostics

            Section {
                Button("Talk (same path as hold-to-talk)", action: onTalk)
                ForEach(liveGatewayCommands, id: \.self) { command in
                    Button("Send to gateway: \(command)") {
                        sendToGateway(command)
                    }
                }
            } header: {
                Text("Live gateway")
            } footer: {
                Text("Real HTTP round trips to the gateway in Diagnostics, not the previews below.")
            }

            pairing
            speechAndSound

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
                Text(creatureController.state.phase.debugDescription).font(.caption2).foregroundStyle(.secondary)
            } header: {
                Text("Creature world")
            }
        }
        .navigationTitle("Debug")
    }

    // MARK: Diagnostics — everything an owner needs on hardware, nothing on the creature screen

    private var diagnostics: some View {
        Section {
            LabeledContent("Creature", value: connection.semanticState.rawValue)
            LabeledContent("Visual", value: controller.state.visual.rawValue)
            LabeledContent("Link", value: connection.transport.phase.rawValue)
            LabeledContent("Discovery", value: probeDescription)
            LabeledContent("Paired", value: credentialDescription)
            Text(connection.gatewayURL.absoluteString).font(.caption2)
            LabeledContent("Provider", value: connection.providerName ?? "—")
            LabeledContent("Round trip", value: connection.lastRoundTripMS.map { "\($0) ms" } ?? "—")
            if let id = connection.lastRequestID {
                Text("req \(id)").font(.caption2).foregroundStyle(.secondary)
            }
            LabeledContent("Speech", value: connection.speech.isEnabled ? "on" : "off")
            LabeledContent("Dictation", value: connection.voiceInputPresented.map { $0 ? "presented" : "unavailable" } ?? "—")
            if let error = connection.lastTransportError {
                Text(error).font(.caption2).foregroundStyle(.orange)
            }
            LabeledContent("Stage", value: stageDescription)
        } header: {
            Text("Diagnostics")
        }
    }

    private var probeDescription: String {
        switch connection.lastProbe {
        case nil: "—"
        case .reachable: "found"
        case .notFound: "not found"
        case .unreachable: "not answering"
        case .wrongGateway: "other gateway"
        }
    }

    private var credentialDescription: String {
        switch connection.credential {
        case .developerOverride: "dev override"
        case let .paired(name, _): name
        case .unpaired: "no"
        }
    }

    private var stageDescription: String {
        let metrics = StageMetrics.shared
        guard let size = metrics.stageSize else { return "—" }
        let mark = metrics.isFullScreen == true ? "✓" : "✗"
        return "\(Int(size.width))×\(Int(size.height)) \(mark)"
    }

    // MARK: Pairing

    private var pairing: some View {
        Section {
            TextFieldLink("Pair with code", prompt: Text("123 456")) { code in
                Task {
                    pairingStatus = "Pairing…"
                    pairingStatus = switch await connection.pair(code: code) {
                    case let .paired(grant): "Paired with \(grant.gatewayName)"
                    case .wrongCode: "Wrong code"
                    case .closed: "Pairing closed"
                    case let .unreachable(reason): reason
                    }
                }
            }
            if let pairingStatus { Text(pairingStatus).font(.caption2) }
            Button("Unpair", role: .destructive) { connection.unpair() }
        } header: {
            Text("Pairing")
        }
    }

    // MARK: Speech and sound — owner testing on hardware

    @ViewBuilder
    private var speechAndSound: some View {
        @Bindable var speech = connection.speech
        @Bindable var sounds = connection.sounds
        Section {
            Button("Speak: \"Hello. I'm Tamago.\"") {
                speech.speak("Hello. I'm Tamago.", force: true)
            }
            Button("Stop speech") { speech.stop() }
            Toggle("Speech enabled", isOn: $speech.isEnabled)
            // watchOS renders a Stepper's label as its large central value;
            // a small explicit label keeps the row usable on a 40 mm screen.
            Stepper(value: $speech.rate, in: 0.3...0.6, step: 0.05) {
                Text("Rate \(speech.rate, format: .number.precision(.fractionLength(2)))").font(.footnote)
            }
            Stepper(value: $speech.pitchMultiplier, in: 0.8...1.3, step: 0.05) {
                Text("Pitch \(speech.pitchMultiplier, format: .number.precision(.fractionLength(2)))").font(.footnote)
            }
        } header: {
            Text("Speech")
        } footer: {
            Text("The test phrase plays once even with speech off. Answers are only spoken when enabled.")
        }
        Section {
            Toggle("Sounds enabled", isOn: $sounds.isEnabled)
            ForEach(CreatureSoundCue.allCases, id: \.self) { cue in
                Button("Play \(cue.rawValue)") { sounds.play(cue, force: true) }
            }
            if let last = sounds.lastPlayed {
                Text("\(last.cue.rawValue): \(last.source)").font(.caption2)
            }
        } header: {
            Text("Creature sounds")
        } footer: {
            Text("No approved sound assets exist. These are DEVELOPMENT PLACEHOLDER tones and never ship.")
        }
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
