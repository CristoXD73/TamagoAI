// TamagoConnection.swift
//
// VERIFICATION: manually run end-to-end against the live Node gateway on the
// SE 3 40 mm simulator (see docs/HANDOFF_LOG.md for the exact steps and
// observed result). Everything else here is SIMULATOR_VERIFIED_ONLY /
// UNVERIFIED per-effect as noted below. Not DEVICE_VERIFIED.
//
// The platform-layer executor CharacterInteractionController.onEffects was
// added for: turns CharacterEffect into real work (network, haptics), which
// CharacterStateMachine and CharacterInteractionController deliberately never
// do themselves (docs/DECISIONS.md D-103). One instance, attached once, in
// TamagoWatchApp.

import Foundation
import Observation
import TamagoShared

/// `@Observable` only so DEBUG-only diagnostics (task §21) can display these
/// four fields; task §4 explicitly forbids surfacing any of this as
/// permanent consumer UI, and no non-debug view reads this class's state.
@MainActor
@Observable
final class TamagoConnection {
    private(set) var lastRequestID: String?
    private(set) var lastRoundTripMS: Int?
    /// `nil` until the first health check completes.
    private(set) var isReachable: Bool?

    private let client: GatewayClient
    private let speech: SpeechOutput
    private weak var controller: CharacterInteractionController?
    private var inFlightTask: Task<Void, Never>?
    private var speechWatchdog: Task<Void, Never>?

    init(configuration: GatewayConfiguration, speech: SpeechOutput) {
        self.client = GatewayClient(configuration: configuration)
        self.speech = speech
    }

    /// Wires this connection to receive every effect the controller produces,
    /// from any call site (debug harness, scene-phase changes, a future real
    /// input path) — see CharacterInteractionController.onEffects.
    func attach(to controller: CharacterInteractionController) {
        self.controller = controller
        controller.onEffects = { [weak self] effects in
            self?.run(effects)
        }
        // See SpeechOutput's header: this fires even when speech is
        // disabled, so `.speaking` always has a way back out.
        speech.onFinished = { [weak self] in
            guard let self else { return }
            self.speechWatchdog?.cancel()
            guard let requestId = self.controller?.state.activeRequestID else { return }
            self.controller?.apply(.speechFinished(requestId: requestId))
        }
    }

    private func run(_ effects: [CharacterEffect]) {
        for effect in effects {
            switch effect {
            case let .sendRequest(request):
                inFlightTask?.cancel()
                lastRequestID = request.requestId
                let startedAt = Date()
                inFlightTask = Task { [weak self, client] in
                    let response = await client.send(request)
                    guard let self, !Task.isCancelled else { return }
                    self.lastRoundTripMS = Int(Date().timeIntervalSince(startedAt) * 1000)
                    self.controller?.apply(.response(response))
                }

            case .cancelRequest:
                inFlightTask?.cancel()
                inFlightTask = nil

            case let .playHaptic(haptic):
                // DEVICE_VERIFIED-pending: WKInterfaceDevice haptics can't be
                // felt through this session's tooling; the call itself is a
                // direct, documented WatchKit API (SIMULATOR_VERIFIED_ONLY
                // that it's reached with no crash).
                HapticPlayer.play(haptic)

            case let .speak(text):
                // UNVERIFIED audio: see SpeechOutput.swift header. Disabled
                // by default — no audio plays, but `onFinished` still fires
                // so `.speaking` isn't a dead end.
                speech.speak(text)
                // D-106's own watchdog requirement, never implemented until
                // now: if AVSpeechSynthesizer's delegate never fires (glitch,
                // interruption), don't leave `.speaking` stuck. Harmless if
                // the real completion already resolved it first — the
                // reducer's `.speechFinished` guard requires `state.visual ==
                // .speaking` and a matching requestId, so a late/duplicate
                // call here is just ignored.
                let requestId = controller?.state.activeRequestID
                let estimatedSeconds = max(2.0, Double(text.count) / 15.0) + 3.0
                speechWatchdog?.cancel()
                speechWatchdog = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(estimatedSeconds))
                    guard !Task.isCancelled, let self, let requestId else { return }
                    self.controller?.apply(.speechFinished(requestId: requestId))
                }

            case .stopSpeech:
                speechWatchdog?.cancel()
                speech.stop()

            case .updateComplicationSnapshot:
                // Declared for D-103/D-105 completeness; not emitted in
                // Stage A (see CharacterEffect's doc comment). Nothing to do.
                break
            }
        }
    }

    /// One-shot reachability probe (`GET /v1/health`). Used by
    /// `GatewayReachabilityMonitor`, not by the request/response path itself.
    func checkHealth() async -> Bool {
        let reachable = await client.checkHealth()
        isReachable = reachable
        return reachable
    }
}

extension GatewayConfiguration {
    /// `127.0.0.1` is only reachable from the Watch *simulator* (it shares
    /// the host Mac's loopback interface); a physical Watch needs the Mac's
    /// real LAN address here instead — see this file's own header and task
    /// §4 (no manual-IP requirement is implemented yet; this env-var override
    /// is the interim path, mirroring the existing `TAMAGO_PREVIEW_STATE`
    /// simctl-launch hook in TamagoWatchApp.swift).
    static func watchAppDefault() -> GatewayConfiguration {
        let env = ProcessInfo.processInfo.environment
        let fallback = URL(string: "http://127.0.0.1:8787")!
        let url = env["TAMAGO_GATEWAY_URL"].flatMap(URL.init(string:)) ?? fallback
        return GatewayConfiguration(baseURL: url, authToken: env["TAMAGO_GATEWAY_TOKEN"])
    }
}
