// SpeechOutput.swift
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
import TamagoShared

@MainActor
final class SpeechOutput: NSObject, AVSpeechSynthesizerDelegate {
    /// Conservative default — see file header. Flip explicitly, don't infer.
    var isEnabled: Bool = false
    var rate: Float = AVSpeechUtteranceDefaultSpeechRate
    var pitchMultiplier: Float = 1.0
    /// Set by TamagoConnection to feed `.speechFinished` back into the
    /// reducer. Fires once per `speak(_:)` call, whether or not anything was
    /// actually spoken.
    var onFinished: (() -> Void)?

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String) {
        guard isEnabled, !text.isEmpty else {
            onFinished?()
            return
        }
        stop()
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = rate
        utterance.pitchMultiplier = pitchMultiplier
        synthesizer.speak(utterance)
    }

    func stop() {
        guard synthesizer.isSpeaking else { return }
        synthesizer.stopSpeaking(at: .immediate)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.onFinished?() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in self?.onFinished?() }
    }
}
