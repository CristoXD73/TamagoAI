// AudioReplyPlayer.swift
//
// VERIFICATION: compiles for the watchOS 27 simulator (local Claude Code,
// 2026-09-27, after fixing one AVFoundation-only symbol). Nothing here has been
// heard on a Watch or in the simulator yet.
//
// D-121 / PROTOCOL_V1 §16: plays the reply audio the owner's Mac synthesized
// (AAC in MP4, mono 24 kHz) fetched from GET /v1/speech/<requestId>.
// TamagoConnection decides when; SpeechOutput (AVSpeechSynthesizer) stays the
// fallback for every failure. Same audio session rules as SpeechOutput
// (D-119): `.playback` / `.voicePrompt`, activated off the main thread only
// while playing, deactivated after. No background audio mode.
//
// The audio lives only in memory for one playback. It is never written to
// disk or logged.

import AVFAudio
import OSLog

@MainActor
final class AudioReplyPlayer: NSObject, AVAudioPlayerDelegate {
    /// Fires once when a started playback ends (finished or failed while
    /// playing). Not called by `stop()`, whose caller already leaves `.speaking`.
    var onFinished: (() -> Void)?

    private var player: AVAudioPlayer?
    private nonisolated static let log = Logger(subsystem: "ai.tamago.watch", category: "speech")

    /// Starts playback. Returns the clip's duration, or nil if the audio
    /// couldn't be decoded or started: the caller then speaks with the
    /// built-in voice instead.
    func play(_ data: Data) async -> TimeInterval? {
        stop()
        // "com.apple.m4a-audio" is AVFileType.m4a's raw value; AVFileType lives in
        // AVFoundation, which this file doesn't import (the cloud draft did not compile).
        guard let player = try? AVAudioPlayer(data: data, fileTypeHint: "com.apple.m4a-audio") else {
            Self.log.error("reply audio could not be decoded (\(data.count, privacy: .public) bytes)")
            return nil
        }
        player.delegate = self
        // Activating the session can block: never on the main thread (D-119).
        let activated = await Task.detached(priority: .userInitiated) { () -> Bool in
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playback, mode: .voicePrompt)
                try session.setActive(true)
                return true
            } catch {
                Self.log.error("audio session activation failed: \(error.localizedDescription, privacy: .public)")
                return false
            }
        }.value
        guard activated, player.prepareToPlay(), player.play() else {
            Self.deactivateSession()
            return nil
        }
        self.player = player
        Self.log.info("reply audio started (\(data.count, privacy: .public) bytes, \(player.duration, privacy: .public) s)")
        return player.duration
    }

    func stop() {
        guard let player else { return }
        self.player = nil
        player.stop()
        Self.deactivateSession()
    }

    private nonisolated static func deactivateSession() {
        Task.detached(priority: .utility) {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Self.log.info("reply audio finished (ok: \(flag, privacy: .public))")
        Self.deactivateSession()
        let finished = ObjectIdentifier(player)   // Sendable, unlike the player
        Task { @MainActor [weak self] in
            guard let self, let current = self.player, ObjectIdentifier(current) == finished else { return }
            self.player = nil
            self.onFinished?()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Self.log.error("reply audio decode error")
        Self.deactivateSession()
        let finished = ObjectIdentifier(player)   // Sendable, unlike the player
        Task { @MainActor [weak self] in
            guard let self, let current = self.player, ObjectIdentifier(current) == finished else { return }
            self.player = nil
            self.onFinished?()
        }
    }
}
