// ListeningMode.swift
//
// VERIFICATION: UNVERIFIED on hardware. Background recording and battery life need the owner's Watch; the
// simulator only proves it compiles, records from the Mac's microphone, rotates chunks and uploads them.
//
// D-130, owner 2026-09-29: "an always listening mode … keeps the audio, sends it to the Mac, and then all the
// filler words get taken out and properly transcribed … the Watch doesn't stop listening until you stop it or the
// Watch dies."
//
// How:
// - One AVAudioRecorder at a time, 16 kHz mono AAC (the same format as hold-to-talk, about 1 KB/s).
// - A chunk ends after 45 s at the first quiet moment, or at 90 s regardless. The next recorder starts before the
//   old one stops, so nothing is lost between chunks, and cutting in a pause means words aren't split in two.
// - Finished chunks wait in Application Support/listening/queue and go to the Mac oldest first
//   (POST /v1/listen/chunk, PROTOCOL_V1 §19). A chunk is deleted from the Watch only after the Mac says it stored
//   it. Offline, they wait (up to QUEUE_CAP_BYTES, about 3 days of audio) and retry with backoff.
// - Keeps recording after the owner leaves the app or lowers the wrist, because the app is genuinely recording:
//   UIBackgroundModes `audio` (watchOS takes this key; WKBackgroundModes has no audio value). That is the purpose
//   the mode exists for; AGENTS.md §2 forbids only *fake* background work. watchOS shows its microphone indicator.
// - Apple (Frameworks Engineer, developer.apple.com/forums/thread/750432): "Recording cannot be resumed when the
//   app is in the background on watchOS. It must be a user-initiated event while the app is in the foreground.
//   (Recording can then continue once the app moves to the background.)" So after an interruption (a call, Siri)
//   or a restart by watchOS, the chunk is closed and a notification asks the owner to tap; opening Tamago resumes.

import AVFAudio
import Foundation
import UserNotifications
import Observation
import OSLog
import TamagoShared
import WatchKit

@MainActor
@Observable
final class ListeningMode {
    enum Phase: Equatable {
        case off
        case listening
        /// A call or Siri has the microphone; recording resumes when it's over.
        case interrupted
        case unavailable(String)
    }

    private(set) var phase: Phase = .off
    /// When this listening session started (survives an app relaunch).
    private(set) var since: Date?
    /// Chunks recorded but not yet stored on the Mac.
    private(set) var waiting = 0
    /// Chunks the Mac has stored this session.
    private(set) var sent = 0
    /// nil until the first upload attempt.
    private(set) var macReachable: Bool?

    /// The owner's choice, kept across launches: listening mode is on until they turn it off.
    var isOn: Bool { defaults.bool(forKey: Keys.wanted) }

    /// Set by the app: the paired Mac's client, or nil when unpaired.
    @ObservationIgnored var client: () -> GatewayClient? = { nil }

    private enum Keys {
        static let wanted = "listening.wanted"
        static let session = "listening.session"
        static let nextSeq = "listening.nextSeq"
        static let since = "listening.since"
        static let pendingEnd = "listening.pendingEnd"
    }

    static var minChunk: TimeInterval { debugChunkSeconds ?? 45 }
    static var maxChunk: TimeInterval { (debugChunkSeconds ?? 45) * 2 }
    /// `SIMCTL_CHILD_TAMAGO_DEBUG_LISTEN_CHUNK=8`: short chunks for simulator runs. Always nil in Release.
    private static var debugChunkSeconds: TimeInterval? {
        #if DEBUG
        ProcessInfo.processInfo.environment["TAMAGO_DEBUG_LISTEN_CHUNK"].flatMap(TimeInterval.init)
        #else
        nil
        #endif
    }
    /// Average power below this counts as a pause (dBFS; speech on the Watch mic sits well above it).
    static let quietDB: Float = -42
    static let queueCapBytes = 300 * 1024 * 1024

    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var chunkStartedAt: Date?
    @ObservationIgnored private var chunkSeq = 0
    @ObservationIgnored private var meterTask: Task<Void, Never>?
    @ObservationIgnored private var uploadTask: Task<Void, Never>?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    private static let log = Logger(subsystem: "ai.tamago.watch", category: "listening")

    private static var baseDir: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("listening")
    }
    private static var queueDir: URL { baseDir.appendingPathComponent("queue") }
    private static var recordingDir: URL { baseDir.appendingPathComponent("recording") }

    init() {
        for dir in [Self.queueDir, Self.recordingDir] {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        since = defaults.object(forKey: Keys.since) as? Date
        adoptOrphans()
        refreshWaiting()
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let began = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
            MainActor.assumeIsolated { self?.interruption(began: began) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.restartSoon("media services reset") }
        })
    }

    // MARK: The owner's switch

    /// Turns listening on. Returns false (and says why in `phase`) if the microphone can't be used.
    @discardableResult
    func start() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .denied:
            phase = .unavailable("Microphone is off for Tamago in Settings.")
            return false
        case .undetermined:
            guard await AVAudioApplication.requestRecordPermission() else {
                phase = .unavailable("Tamago needs the microphone to listen.")
                return false
            }
        default:
            break
        }
        // For the one thing that needs the owner: "tap to keep listening" after a call or Siri (header).
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [Self.resumeNote])
        if defaults.string(forKey: Keys.session) == nil {
            defaults.set(UUID().uuidString.lowercased(), forKey: Keys.session)
            defaults.set(0, forKey: Keys.nextSeq)
            defaults.set(Date.now, forKey: Keys.since)
            sent = 0
        }
        since = defaults.object(forKey: Keys.since) as? Date
        defaults.set(true, forKey: Keys.wanted)
        guard await activateSession(), beginChunk() else {
            phase = .unavailable("The microphone didn't start.")
            return false
        }
        phase = .listening
        WKInterfaceDevice.current().play(.start)
        startMeter()
        Self.log.info("listening on")
        return true
    }

    /// Turns listening off: the last chunk is queued, and the Mac is told the session ended once it has everything.
    func stop() {
        defaults.set(false, forKey: Keys.wanted)
        meterTask?.cancel()
        meterTask = nil
        finishChunk()
        if let session = defaults.string(forKey: Keys.session) {
            defaults.set(session, forKey: Keys.pendingEnd)
        }
        defaults.removeObject(forKey: Keys.session)
        defaults.removeObject(forKey: Keys.since)
        since = nil
        phase = .off
        Task.detached(priority: .utility) {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        WKInterfaceDevice.current().play(.stop)
        Self.log.info("listening off")
        pump()
    }

    /// Tamago came to the front: pick listening back up if watchOS had ended the app, and send anything waiting.
    func appBecameActive() {
        if isOn, phase != .listening {
            Task { await start() }
        }
        pump()
    }

    // MARK: Recording

    #if DEBUG
    /// `SIMCTL_CHILD_TAMAGO_DEBUG_LISTEN_FILE=/path/speech.m4a`: simulator runs use this file as every chunk.
    private static var debugFile: URL? {
        ProcessInfo.processInfo.environment["TAMAGO_DEBUG_LISTEN_FILE"].map { URL(fileURLWithPath: $0) }
    }
    @ObservationIgnored private var debugChunk: URL?

    private func debugClose(_ url: URL) {
        try? FileManager.default.moveItem(at: url, to: Self.queueDir.appendingPathComponent(url.lastPathComponent))
        refreshWaiting()
        pump()
    }
    #endif

    private func activateSession() async -> Bool {
        await Task.detached(priority: .userInitiated) { () -> Bool in
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.record, mode: .default)
                try session.setActive(true)
                return true
            } catch {
                return false
            }
        }.value
    }

    private static let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ]

    /// Starts the next chunk's recorder. The previous one (if any) keeps running until this one is recording.
    @discardableResult
    private func beginChunk() -> Bool {
        guard let session = defaults.string(forKey: Keys.session) else { return false }
        let seq = defaults.integer(forKey: Keys.nextSeq)
        let startedAt = Date.now
        let name = "\(session)_\(seq)_\(Int64(startedAt.timeIntervalSince1970 * 1000)).m4a"
        let url = Self.recordingDir.appendingPathComponent(name)
        #if DEBUG
        if let file = Self.debugFile {
            // Simulator hook: the Mac mini has no microphone, so each "chunk" is a copy of this file.
            if let old = debugChunk { debugClose(old) }
            guard (try? FileManager.default.copyItem(at: file, to: url)) != nil else { return false }
            debugChunk = url
            chunkStartedAt = startedAt
            chunkSeq = seq
            defaults.set(seq + 1, forKey: Keys.nextSeq)
            return true
        }
        #endif
        guard let next = try? AVAudioRecorder(url: url, settings: Self.settings) else { return false }
        next.isMeteringEnabled = true
        guard next.record() else {
            try? FileManager.default.removeItem(at: url)
            return false
        }
        let previous = recorder
        recorder = next
        chunkStartedAt = startedAt
        chunkSeq = seq
        defaults.set(seq + 1, forKey: Keys.nextSeq)
        if let previous { close(previous) }
        return true
    }

    /// Ends the current chunk without starting another.
    private func finishChunk() {
        #if DEBUG
        if let chunk = debugChunk { debugChunk = nil; chunkStartedAt = nil; debugClose(chunk); return }
        #endif
        guard let current = recorder else { return }
        recorder = nil
        chunkStartedAt = nil
        close(current)
    }

    private func close(_ r: AVAudioRecorder) {
        r.stop()
        let target = Self.queueDir.appendingPathComponent(r.url.lastPathComponent)
        do {
            try FileManager.default.moveItem(at: r.url, to: target)
        } catch {
            Self.log.error("couldn't queue a chunk: \(error.localizedDescription, privacy: .public)")
        }
        trimQueue()
        refreshWaiting()
        pump()
    }

    private func startMeter() {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                self?.tick()
            }
        }
    }

    private func tick() {
        guard phase == .listening else { return }
        #if DEBUG
        if debugChunk != nil, let startedAt = chunkStartedAt {
            if Date.now.timeIntervalSince(startedAt) >= Self.minChunk { beginChunk() }
            return
        }
        #endif
        guard let r = recorder, r.isRecording, let startedAt = chunkStartedAt else {
            // The system stopped the recorder without telling us (route change, a crash in media services).
            finishChunk()
            restartSoon("recorder stopped")
            return
        }
        let age = Date.now.timeIntervalSince(startedAt)
        guard age >= Self.minChunk else { return }
        r.updateMeters()
        if age >= Self.maxChunk || r.averagePower(forChannel: 0) < Self.quietDB {
            if !beginChunk() {
                // Two recorders at once refused: stop, then start, and accept a few milliseconds of gap.
                finishChunk()
                if !beginChunk() { restartSoon("next chunk didn't start") }
            }
        }
    }

    private func interruption(began: Bool) {
        guard isOn else { return }
        if began {
            finishChunk()
            phase = .interrupted
            Self.log.info("interrupted")
        } else {
            restartSoon("interruption ended")
        }
    }

    private static let resumeNote = "listening.resume"

    private var inForeground: Bool { WKApplication.shared().applicationState == .active }

    private func restartSoon(_ why: String) {
        guard isOn else { return }
        // watchOS won't start the microphone from the background (header): ask the owner, resume on open.
        guard inForeground else {
            finishChunk()
            phase = .interrupted
            askToResume()
            return
        }
        Self.log.info("restarting: \(why, privacy: .public)")
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self, self.isOn else { return }
            finishChunk()
            if await self.activateSession(), self.beginChunk() {
                self.phase = .listening
                self.startMeter()
            } else {
                self.phase = .interrupted
                try? await Task.sleep(for: .seconds(5))
                self.restartSoon("retry")
            }
        }
    }

    private func askToResume() {
        let content = UNMutableNotificationContent()
        content.title = "Tamago stopped listening"
        content.body = "Something else took the microphone. Tap to keep listening."
        content.sound = .default
        let request = UNNotificationRequest(identifier: Self.resumeNote, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
        Self.log.info("asked the owner to resume")
    }

    // MARK: Sending to the Mac

    private struct Queued {
        let url: URL
        let session: String
        let seq: Int
        let startedAt: Date
    }

    private func queued() -> [Queued] {
        let files = (try? FileManager.default.contentsOfDirectory(at: Self.queueDir, includingPropertiesForKeys: nil)) ?? []
        return files.compactMap { url -> Queued? in
            let parts = url.deletingPathExtension().lastPathComponent.split(separator: "_")
            guard parts.count == 3, let seq = Int(parts[1]), let ms = Int64(parts[2]) else { return nil }
            return Queued(url: url, session: String(parts[0]), seq: seq, startedAt: Date(timeIntervalSince1970: Double(ms) / 1000))
        }
        .sorted { ($0.startedAt, $0.seq) < ($1.startedAt, $1.seq) }
    }

    private func refreshWaiting() {
        waiting = queued().count
    }

    /// Sends everything waiting, oldest first; one sender at a time.
    private func pump() {
        guard uploadTask == nil else { return }
        uploadTask = Task { [weak self] in
            await self?.drain()
            self?.uploadTask = nil
        }
    }

    private func drain() async {
        var backoff: Double = 5
        while !Task.isCancelled {
            guard let next = queued().first else { break }
            guard let client = client() else { macReachable = false; break }
            guard let data = try? Data(contentsOf: next.url), !data.isEmpty else {
                try? FileManager.default.removeItem(at: next.url)
                refreshWaiting()
                continue
            }
            if await client.uploadListenChunk(data, session: next.session, seq: next.seq, startedAt: next.startedAt) {
                try? FileManager.default.removeItem(at: next.url)
                if next.session == defaults.string(forKey: Keys.session) { sent += 1 }
                macReachable = true
                backoff = 5
                refreshWaiting()
            } else {
                macReachable = false
                try? await Task.sleep(for: .seconds(backoff))
                backoff = min(backoff * 2, 120)
                // Nothing new to record and nobody waiting on it: stop retrying until Tamago is opened again.
                if !isOn && backoff >= 120 { break }
            }
        }
        if let ended = defaults.string(forKey: Keys.pendingEnd), !queued().contains(where: { $0.session == ended }),
           let client = client(), await client.endListening(session: ended) {
            defaults.removeObject(forKey: Keys.pendingEnd)
        }
    }

    /// Past the cap, the oldest audio goes first: better to lose the start of a very long offline stretch than to
    /// stop listening.
    private func trimQueue() {
        var files = queued()
        var total = files.reduce(0) { $0 + ((try? $1.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        while total > Self.queueCapBytes, let oldest = files.first {
            total -= (try? oldest.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            try? FileManager.default.removeItem(at: oldest.url)
            files.removeFirst()
            Self.log.error("queue full: dropped the oldest chunk")
        }
    }

    /// Chunks left in `recording/` by an app that was ended mid-chunk: queue them (the Mac keeps even a damaged one).
    private func adoptOrphans() {
        let files = (try? FileManager.default.contentsOfDirectory(at: Self.recordingDir, includingPropertiesForKeys: nil)) ?? []
        for url in files {
            try? FileManager.default.moveItem(at: url, to: Self.queueDir.appendingPathComponent(url.lastPathComponent))
        }
    }
}
