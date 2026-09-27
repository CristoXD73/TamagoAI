// SpeechOutput.swift
//
// D-119 (owner, 2026-09-27): answers are spoken by default. The owner heard
// nothing on the first physical-Watch run because this was off. Audio plays
// in a `.playback` / `.voicePrompt` session, activated only while speaking.
//
// VERIFICATION: compiles and runs against the watchOS 27 SDK
// (AVSpeechSynthesizer has been part of AVFAudio on watchOS since watchOS 6;
// confirmed by successful compilation and simulator launch in this session —
// see docs/HANDOFF_LOG.md). The actual AUDIBLE result — whether it plays, at
// what volume/routing, and whether the voice/rate/pitch reads as intentional
// rather than "Siri with an octopus skin" — is UNVERIFIED: this session has
// no way to hear Watch simulator audio output. `isEnabled` therefore defaults
// to `false`. Do not flip it on as "done" without an owner listening on a
// real device or at least the simulator's actual audio output.
//
// Executes CharacterEffect.speak/.stopSpeech (see TamagoConnection). Kept
// swappable per task §7: nothing outside this file knows it's
// AVSpeechSynthesizer specifically.
//
// `onFinished` matters even while disabled: CharacterStateMachine only leaves
// `.speaking` on a `.speechFinished`/`.speechCancelled` event (D-103). A
// gateway response with non-empty `speechText` enters `.speaking`
// unconditionally — found live, end-to-end, via the debug harness's "state
// happy" gateway button — so with speech disabled and no completion signal,
// the creature would sit in `.speaking` forever (violates task §5: never
// freeze on I/O, and speech-not-actually-happening is exactly that). Calling
// `onFinished` synchronously in that case, instead of only from the real
// delegate callback, keeps the reducer's contract satisfied either way.

import AVFAudio
import Observation
import OSLog
import TamagoShared

@MainActor
@Observable
final class SpeechOutput: NSObject, AVSpeechSynthesizerDelegate {
    /// On by owner decision (D-119). Audibility on the SE 3: UNVERIFIED until heard.
    var isEnabled: Bool = true
    var rate: Float = AVSpeechUtteranceDefaultSpeechRate
    var pitchMultiplier: Float = 1.0
    /// Set by TamagoConnection to feed `.speechFinished` back into the
    /// reducer. Fires once per `speak(_:)` call, whether or not anything was
    /// actually spoken.
    @ObservationIgnored var onFinished: (() -> Void)?

    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
    private nonisolated static let log = Logger(subsystem: "ai.tamago.watch", category: "speech")

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// `force` is for the DEBUG "Hello. I'm Tamago." test only: a deliberate,
    /// one-off utterance through this same path, without turning speech on.
    func speak(_ text: String, force: Bool = false) {
        guard isEnabled || force, !text.isEmpty else {
            onFinished?()
            return
        }
        stop()
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = rate
        utterance.pitchMultiplier = pitchMultiplier
        // Activating the session can block; the runtime flags it as a hang
        // risk on the main thread (seen in the simulator log). Do it off-main,
        // then speak.
        Task { [synthesizer] in
            await Task.detached(priority: .userInitiated) {
                let session = AVAudioSession.sharedInstance()
                do {
                    try session.setCategory(.playback, mode: .voicePrompt)
                    try session.setActive(true)
                } catch {
                    Self.log.error("audio session activation failed: \(error.localizedDescription, privacy: .public)")
                }
            }.value
            synthesizer.speak(utterance)
        }
    }

    private nonisolated static func deactivateSession() {
        Task.detached(priority: .utility) {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    func stop() {
        guard synthesizer.isSpeaking else { return }
        synthesizer.stopSpeaking(at: .immediate)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Self.log.info("speech started (\(utterance.speechString.count, privacy: .public) chars)")
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Self.log.info("speech finished")
        Self.deactivateSession()
        Task { @MainActor [weak self] in self?.onFinished?() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Self.log.info("speech cancelled")
        Self.deactivateSession()
        Task { @MainActor [weak self] in self?.onFinished?() }
    }
}
