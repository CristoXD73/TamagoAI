// TamagoConnection.swift
//
// VERIFICATION: end-to-end against the live Node gateway from the SE 3 40 mm
// simulator (docs/HANDOFF_LOG.md). SIMULATOR_VERIFIED_ONLY; not
// DEVICE_VERIFIED. docs/DECISIONS.md D-115 (transport) and D-116 (pairing,
// discovery, reachability, voice input, sound).
//
// The platform-layer executor for CharacterEffect (network, haptics, speech,
// sound) — CharacterStateMachine never performs effects itself (D-103). Also
// owns the Mac link: which gateway, with what credential, and whether it's
// there. It never adds UI; everything here reaches the creature only through
// the reducer's existing events (.routeLost/.routeRestored/.response).
//
// VERIFICATION (Mac voice playback, D-121): UNVERIFIED (written in the cloud,
// not compiled). The rest of this file keeps its label above.

import Foundation
import Observation
import OSLog
import Security
import TamagoShared
import WatchKit

@MainActor
@Observable
final class TamagoConnection {
    enum Credential: Equatable {
        /// `TAMAGO_GATEWAY_URL` set at launch (simctl) — development only.
        case developerOverride
        case paired(gatewayName: String, gatewayId: String)
        case unpaired
    }

    enum TalkOutcome: Equatable { case listening, needsPairing, notNow, inputUnavailable }

    private(set) var credential: Credential
    private(set) var gatewayURL: URL
    private(set) var transport = TransportState()
    private(set) var lastProbe: GatewayProbe?
    private(set) var lastRequestID: String?
    private(set) var lastRoundTripMS: Int?
    private(set) var lastTransportError: String?
    private(set) var providerName: String?
    private(set) var voiceInputPresented: Bool?

    let speech: SpeechOutput
    let sounds: CreatureSoundPlayer

    var canTalk: Bool { credential != .unpaired }
    var semanticState: CreatureSemanticState {
        .derive(visual: controller?.state.visual ?? .idle, link: transport.phase)
    }

    @ObservationIgnored private var client: GatewayClient
    @ObservationIgnored private weak var controller: CharacterInteractionController?
    @ObservationIgnored private var inFlightTask: Task<Void, Never>?
    @ObservationIgnored private var speechWatchdog: Task<Void, Never>?
    /// D-121: the Mac-synthesized voice. SpeechOutput stays the fallback.
    @ObservationIgnored private let replyAudio = AudioReplyPlayer()
    /// D-126: "Right…", "One sec." as soon as the hold is released.
    @ObservationIgnored private let thinkingSound = ThinkingSound()
    /// `speechAudio` of the response about to be applied, keyed by request ID,
    /// so `.speak` can find it without CharacterStateMachine knowing about it.
    @ObservationIgnored private var pendingSpeechAudio: (requestId: String, audio: TamagoSpeechAudio)?
    @ObservationIgnored private var speechFetch: Task<Void, Never>?
    /// Tamago's latest answer, shown under the creature while it speaks and a
    /// little after (D-119), then cleared.
    private(set) var caption: String?
    @ObservationIgnored private var captionClear: Task<Void, Never>?
    /// D-120 hold-to-talk: recording while the owner holds the creature.
    @ObservationIgnored private let recorder = VoiceRecorder()
    @ObservationIgnored private var holding = false
    @ObservationIgnored private var recording = false
    /// The clip to send instead of text for the request with this ID.
    @ObservationIgnored private var pendingAudio: (requestId: String, data: Data)?
    @ObservationIgnored private var probeTask: Task<Void, Never>?
    @ObservationIgnored private var beat: Task<Void, Never>?
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var lastVisual: TamagoCharacterState = .idle

    private static let log = Logger(subsystem: "ai.tamago.watch", category: "transport")

    init(speech: SpeechOutput, sounds: CreatureSoundPlayer) {
        let (configuration, credential) = Self.resolveSettings()
        self.client = GatewayClient(configuration: configuration)
        self.gatewayURL = configuration.baseURL
        self.credential = credential
        self.speech = speech
        self.sounds = sounds
    }

    /// Developer override, then the Keychain pairing, else unpaired at the
    /// well-known name. A paired Watch never needs an address typed.
    static func resolveSettings() -> (GatewayConfiguration, Credential) {
        let env = ProcessInfo.processInfo.environment
        if let raw = env["TAMAGO_GATEWAY_URL"], let url = URL(string: raw) {
            return (GatewayConfiguration(baseURL: url, authToken: env["TAMAGO_GATEWAY_TOKEN"]), .developerOverride)
        }
        if let record = PairingStore.load() {
            return (GatewayConfiguration(baseURL: record.baseURL, authToken: record.token, expectedGatewayId: record.gatewayId),
                    .paired(gatewayName: record.gatewayName, gatewayId: record.gatewayId))
        }
        return (GatewayConfiguration(baseURL: GatewayConfiguration.wellKnownBaseURL), .unpaired)
    }

    func attach(to controller: CharacterInteractionController) {
        self.controller = controller
        lastVisual = controller.state.visual
        controller.onEffects = { [weak self] effects in
            self?.run(effects)
        }
        // See SpeechOutput's header: this fires even when speech is
        // disabled, so `.speaking` always has a way back out.
        speech.onFinished = { [weak self] in self?.finishSpeaking() }
        replyAudio.onFinished = { [weak self] in self?.finishSpeaking() }
        // No paired brain: the creature is offline, not broken (task §5).
        if !canTalk { controller.apply(.routeLost) }
    }

    // MARK: Scene lifecycle — the only thing that starts link checks

    /// One probe per activation, then only what the backoff asks for.
    func sceneBecameActive() {
        isActive = true
        scheduleProbe(after: 0)
    }

    /// Nothing runs for the link while the display isn't live (task §22).
    func sceneBecameInactive() {
        isActive = false
        probeTask?.cancel()
        probeTask = nil
    }

    // MARK: Talk trigger (D-106 / D-116)

    /// The same path for the "hold anywhere" gesture and the DEBUG button.
    func beginTalking() -> TalkOutcome {
        guard let controller else { return .notNow }
        guard canTalk else { return .needsPairing }
        controller.apply(.userActivated)
        guard controller.state.visual == .listening else { return .notNow }
        let presented = VoiceInput.present { [weak controller] text in
            // Empty/cancelled → the reducer treats it as a cancel (D-103).
            controller?.apply(.transcript(text: text ?? "", requestId: UUID()))
        }
        voiceInputPresented = presented
        guard presented else {
            controller.apply(.cancel)
            return .inputUnavailable
        }
        return .listening
    }

    /// Hold started (≥ 0.45 s, CREATURE_SPEC §4): record until `endHold()`.
    /// Falls back to the system input sheet when the microphone isn't usable.
    func beginHold() async -> TalkOutcome {
        holding = true
        guard let controller else { return .notNow }
        guard canTalk else { return .needsPairing }
        controller.apply(.userActivated)
        guard controller.state.visual == .listening else { return .notNow }
        switch await recorder.start() {
        case .recording:
            recording = true
            WKInterfaceDevice.current().play(.start)
            // Released while the microphone was still starting up.
            if !holding { endHold() }
            return .listening
        case .askedForPermission:
            controller.apply(.cancel)
            return .notNow
        case .unavailable:
            controller.apply(.cancel)
            return beginTalking()
        }
    }

    /// Hold released: send what was recorded (too short = cancelled).
    func endHold() {
        holding = false
        guard recording else { return }
        recording = false
        guard let audio = recorder.stop() else {
            controller?.apply(.cancel)
            return
        }
        let id = UUID()
        pendingAudio = (id.uuidString.lowercased(), audio)
        // The reducer only knows transcripts; the text is a placeholder, the
        // request goes out as audio (see `.sendRequest`) and the Mac transcribes.
        controller?.apply(.transcript(text: "(voice)", requestId: id))
        if ThinkingSound.isEnabled { thinkingSound.play() }
    }

    // MARK: Pairing (D-116)

    /// Pairs with the Mac at `address` if given (typed on the pairing screen,
    /// for networks where `tamagoai.local` doesn't resolve from the Watch),
    /// otherwise at the well-known name. The address is kept with the pairing.
    func pair(code: String, address: URL? = nil) async -> PairingOutcome {
        let url = address ?? (credential == .developerOverride ? gatewayURL : GatewayConfiguration.wellKnownBaseURL)
        let outcome = await GatewayClient(configuration: GatewayConfiguration(baseURL: url))
            .pair(code: code, deviceName: WKInterfaceDevice.current().name)
        guard case let .paired(grant) = outcome else { return outcome }

        let status = PairingStore.save(PairingRecord(
            baseURL: url, token: grant.token, gatewayId: grant.gatewayId,
            gatewayName: grant.gatewayName, pairedAt: .now))
        reconfigure(GatewayConfiguration(baseURL: url, authToken: grant.token, expectedGatewayId: grant.gatewayId),
                    credential: .paired(gatewayName: grant.gatewayName, gatewayId: grant.gatewayId))
        if status != errSecSuccess {
            lastTransportError = "Paired for this session only: Keychain save failed (\(status))."
        }
        return outcome
    }

    private func showCaption(_ text: String) {
        caption = text
        captionClear?.cancel()
        let seconds = max(3.0, Double(text.count) / 12.0) + 1.5
        captionClear = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.caption = nil
        }
    }

    func unpair() {
        PairingStore.clear()
        reconfigure(GatewayConfiguration(baseURL: GatewayConfiguration.wellKnownBaseURL), credential: .unpaired)
        controller?.apply(.routeLost)
    }

    private func reconfigure(_ configuration: GatewayConfiguration, credential: Credential) {
        client = GatewayClient(configuration: configuration)
        gatewayURL = configuration.baseURL
        self.credential = credential
        transport = TransportState()
        lastProbe = nil
        providerName = nil
        lastTransportError = nil
        scheduleProbe(after: 0)
    }

    // MARK: Effects

    private func run(_ effects: [CharacterEffect]) {
        handleTransition()
        for effect in effects {
            switch effect {
            case let .sendRequest(request):
                inFlightTask?.cancel()
                lastRequestID = request.requestId
                let startedAt = Date()
                Self.log.debug("request \(request.requestId, privacy: .public) sent")
                let audio = pendingAudio?.requestId == request.requestId.lowercased() ? pendingAudio?.data : nil
                pendingAudio = nil
                inFlightTask = Task { [weak self, client] in
                    let exchange = if let audio {
                        await client.exchangeAudio(audio, requestId: request.requestId)
                    } else {
                        await client.exchange(request)
                    }
                    guard let self, !Task.isCancelled else { return }
                    let ms = Int(Date().timeIntervalSince(startedAt) * 1000)
                    self.lastRoundTripMS = ms
                    let code = exchange.response.error?.code.rawValue ?? "ok"
                    Self.log.debug("request \(request.requestId, privacy: .public) answered in \(ms) ms: \(code, privacy: .public) (reached gateway: \(exchange.reachedGateway))")
                    self.lastTransportError = exchange.response.error.map { "\(exchange.reachedGateway ? "gateway" : "transport"): \($0.code.rawValue)" }
                    // D-121: remembered before `apply`, which emits `.speak` synchronously.
                    if let audio = exchange.response.speechAudio, let id = exchange.response.requestId {
                        self.pendingSpeechAudio = (id.lowercased(), audio)
                    } else {
                        self.pendingSpeechAudio = nil
                    }
                    // A stale answer is dropped by the reducer's requestId guard (D-103);
                    // cancelling this task is the first line, the guard is the real one.
                    self.controller?.apply(.response(exchange.response))
                    // The request itself is the reachability check — no poll needed.
                    self.recordLink(reachable: exchange.reachedGateway)
                }

            case .cancelRequest:
                inFlightTask?.cancel()
                inFlightTask = nil

            case let .playHaptic(haptic):
                HapticPlayer.play(haptic)

            case let .speak(text):
                showCaption(text)
                let requestId = controller?.state.activeRequestID
                let estimatedSeconds = max(2.0, Double(text.count) / 15.0) + 3.0
                let audio = pendingSpeechAudio.flatMap { $0.requestId == requestId?.lowercased() ? $0.audio : nil }
                pendingSpeechAudio = nil
                speechFetch?.cancel()
                if let audio, let requestId, speech.isEnabled {
                    // D-121: try the Mac's voice within the fetch budget; any
                    // failure falls back to the built-in voice below.
                    armSpeechWatchdog(seconds: Self.speechFetchBudget + estimatedSeconds, requestId: requestId)
                    thinkingSound.handOffSession()
                    speechFetch = Task { [weak self, client] in
                        let data = await client.speechAudio(path: audio.path, timeout: Self.speechFetchBudget)
                        // Never talk over the thinking sound (D-126); it's at most ~1.7 s.
                        await self?.thinkingSound.waitUntilDone()
                        guard let self, !Task.isCancelled,
                              self.controller?.state.activeRequestID == requestId else { return }
                        if let data, let duration = await self.replyAudio.play(data) {
                            // Stopped or superseded while the session was activating.
                            guard !Task.isCancelled, self.controller?.state.activeRequestID == requestId else {
                                self.replyAudio.stop()
                                return
                            }
                            self.armSpeechWatchdog(seconds: duration + 3.0, requestId: requestId)
                        } else if !Task.isCancelled {
                            Self.log.debug("speech audio unavailable; built-in voice")
                            self.speech.speak(text)
                        }
                    }
                } else {
                    thinkingSound.handOffSession()
                    armSpeechWatchdog(seconds: estimatedSeconds + 2.0, requestId: requestId)
                    speechFetch = Task { [weak self] in
                        await self?.thinkingSound.waitUntilDone()   // D-126
                        guard let self, !Task.isCancelled else { return }
                        self.speech.speak(text)
                    }
                }

            case .stopSpeech:
                speechWatchdog?.cancel()
                speechFetch?.cancel()
                speechFetch = nil
                replyAudio.stop()
                thinkingSound.stop()
                speech.stop()

            case .updateComplicationSnapshot:
                break
            }
        }
    }

    /// ~2.5 s: how long the Watch waits for the Mac's voice (PROTOCOL_V1 §16).
    private static let speechFetchBudget: TimeInterval = 2.5

    /// D-106's watchdog: if neither player reports back, don't leave
    /// `.speaking` stuck. A late/duplicate call is harmless — the reducer
    /// requires `.speaking` + a matching ID.
    private func armSpeechWatchdog(seconds: TimeInterval, requestId: String?) {
        speechWatchdog?.cancel()
        speechWatchdog = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self, let requestId else { return }
            self.controller?.apply(.speechFinished(requestId: requestId))
        }
    }

    /// Either voice finished (see SpeechOutput's header: this fires even when
    /// speech is disabled, so `.speaking` always has a way back out).
    private func finishSpeaking() {
        speechWatchdog?.cancel()
        guard let requestId = controller?.state.activeRequestID else { return }
        controller?.apply(.speechFinished(requestId: requestId))
    }

    /// Runs after every `apply`: sound cues for the transition, and the two
    /// timed beats D-103 assigns to the caller because the reducer reads no
    /// clock — `ackBeatElapsed` (~0.6 s: acknowledging → thinking) and
    /// `reactionFinished` (≤ 2.5 s hold: reaction → idle). Nothing supplied
    /// either before this, so a slow answer never showed `thinking` and every
    /// answer left the creature stuck in its reaction mood.
    private func handleTransition() {
        guard let state = controller?.state else { return }
        let visual = state.visual
        defer { lastVisual = visual }
        guard visual != lastVisual else { return }
        if let cue = CreatureSoundCue.cue(from: lastVisual, to: visual) {
            sounds.play(cue)
        }
        beat?.cancel()
        beat = nil
        guard let requestId = state.activeRequestID else { return }
        let event: CharacterEvent
        let seconds: Double
        if visual == .acknowledging {
            (event, seconds) = (.ackBeatElapsed(requestId: requestId), 0.6)
        } else if CharacterStateMachine.reactionMoods.contains(visual) {
            (event, seconds) = (.reactionFinished(requestId: requestId), 2.5)
        } else {
            return
        }
        // A stale beat is harmless: the reducer checks state + requestId.
        beat = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.controller?.apply(event)
        }
    }

    // MARK: Link

    private func recordLink(reachable: Bool) {
        transport.apply(reachable ? .reachable : .unreachable)
        // Each is ignored by the reducer outside the one state it applies to.
        controller?.apply(reachable ? .routeRestored : .routeLost)
        if let delay = transport.nextProbeDelay, delay > 0 {
            scheduleProbe(after: delay)
        } else if transport.phase == .connected {
            probeTask?.cancel()
            probeTask = nil
        }
    }

    private func scheduleProbe(after seconds: TimeInterval) {
        probeTask?.cancel()
        probeTask = nil
        guard isActive, canTalk else { return }
        probeTask = Task { [weak self] in
            if seconds > 0 { try? await Task.sleep(for: .seconds(seconds)) }
            guard !Task.isCancelled, let self else { return }
            await self.runProbe()
        }
    }

    private func runProbe() async {
        transport.apply(.probeStarted)
        let result = await client.probe()
        guard !Task.isCancelled else { return }
        lastProbe = result
        switch result {
        case .reachable:
            lastTransportError = nil
            if providerName == nil { providerName = await client.protocolInfo()?.provider }
            recordLink(reachable: true)
        case .notFound:
            lastTransportError = "tamagoai.local not found on this network"
            recordLink(reachable: false)
        case .unreachable:
            lastTransportError = "gateway not answering"
            recordLink(reachable: false)
        case let .wrongGateway(found):
            lastTransportError = "a different gateway answered (\(found ?? "no id"))"
            recordLink(reachable: false)
        }
    }
}
