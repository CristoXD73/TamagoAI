// VoiceRecorder.swift
//
// VERIFICATION: UNVERIFIED on hardware. Simulator runs use the DEBUG file
// hook below instead of the microphone (no Mac permission prompt), so the
// upload → transcribe → answer path is SIMULATOR_VERIFIED_ONLY; real capture
// needs the owner's Watch.
//
// D-120: hold-to-talk. While the owner holds the creature, record 16 kHz mono
// AAC (≈1 KB/s); on release the clip goes to the Mac (POST /v1/audio), which
// transcribes it on-device. Public AVFAudio API; no audio leaves the home LAN.
// If the microphone is unavailable, TamagoConnection falls back to the system
// input sheet (VoiceInput).

import AVFAudio
import Foundation
import OSLog

@MainActor
final class VoiceRecorder {
    enum StartResult: Equatable {
        case recording
        /// The system just asked for microphone access; that interrupted the
        /// hold, so the owner holds again.
        case askedForPermission
        case unavailable
    }

    static let maxSeconds: TimeInterval = 15
    /// Shorter than this is a slip, not speech.
    static let minSeconds: TimeInterval = 0.35

    private var recorder: AVAudioRecorder?
    private var startedAt: Date?
    private static let log = Logger(subsystem: "ai.tamago.watch", category: "voice")

    func start() async -> StartResult {
        #if DEBUG
        if Self.debugFile != nil { startedAt = .now; return .recording }
        #endif
        switch AVAudioApplication.shared.recordPermission {
        case .denied:
            return .unavailable
        case .undetermined:
            _ = await AVAudioApplication.requestRecordPermission()
            return .askedForPermission
        default:
            break
        }
        // Activation can block; keep it off the main thread (same as SpeechOutput).
        let active = await Task.detached(priority: .userInitiated) { () -> Bool in
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playAndRecord, mode: .default)
                try session.setActive(true)
                return true
            } catch {
                return false
            }
        }.value
        guard active else {
            Self.log.error("audio session could not be activated for recording")
            return .unavailable
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("utterance-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            guard recorder.record(forDuration: Self.maxSeconds) else { return .unavailable }
            self.recorder = recorder
            startedAt = .now
            Self.log.info("recording started")
            return .recording
        } catch {
            Self.log.error("recorder failed: \(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
    }

    /// Stops and returns the recording, or `nil` if it was too short to be speech.
    func stop() -> Data? {
        let duration = startedAt.map { Date.now.timeIntervalSince($0) } ?? 0
        startedAt = nil
        #if DEBUG
        if let debugFile = Self.debugFile {
            return duration >= Self.minSeconds ? try? Data(contentsOf: debugFile) : nil
        }
        #endif
        guard let recorder else { return nil }
        recorder.stop()
        self.recorder = nil
        Task.detached(priority: .utility) {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        defer { try? FileManager.default.removeItem(at: recorder.url) }
        Self.log.info("recording stopped after \(duration, format: .fixed(precision: 1)) s")
        guard duration >= Self.minSeconds else { return nil }
        return try? Data(contentsOf: recorder.url)
    }

    #if DEBUG
    /// `SIMCTL_CHILD_TAMAGO_DEBUG_AUDIO_FILE=/path/q.m4a`: simulator runs send
    /// this file instead of touching the microphone.
    private static var debugFile: URL? {
        ProcessInfo.processInfo.environment["TAMAGO_DEBUG_AUDIO_FILE"].map { URL(fileURLWithPath: $0) }
    }
    #endif
}
