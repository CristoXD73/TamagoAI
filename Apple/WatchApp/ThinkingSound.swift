// ThinkingSound.swift
//
// VERIFICATION: builds; not yet heard on a Watch. D-126.
//
// Owner, 2026-09-27: a thinking sound "as soon as you finish talking so you know
// it heard you". Six short clips in Tamago's own voice (Kokoro af_heart 0.9×,
// the owner's picks 04 05 08 11 15 20) ship in the app, so there's no network
// wait. One plays at random when the hold is released, never the same twice in a row.
//
// The reply voice waits for the clip to finish (`waitUntilDone`) instead of
// talking over it. Audio session rules as AudioReplyPlayer (D-119): activated
// off the main thread; deactivated a few seconds after the clip unless the
// reply takes the session over (`handOffSession`), so the two never fight.

import AVFAudio
import OSLog

@MainActor
final class ThinkingSound: NSObject, AVAudioPlayerDelegate {
    static let clips = ["thinking-04", "thinking-05", "thinking-08", "thinking-11", "thinking-15", "thinking-20"]

    private var player: AVAudioPlayer?
    private var last: String?
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var deactivation: Task<Void, Never>?
    private nonisolated static let log = Logger(subsystem: "ai.tamago.watch", category: "speech")

    func play() {
        let choices = Self.clips.filter { $0 != last }
        guard let name = choices.randomElement(),
              let url = Bundle.main.url(forResource: name, withExtension: "m4a"),
              let player = try? AVAudioPlayer(contentsOf: url) else { return }
        last = name
        stop()
        deactivation?.cancel()
        player.delegate = self
        self.player = player
        Task { [weak self] in
            // Activating the session can block: never on the main thread (D-119).
            let ok = await Task.detached(priority: .userInitiated) { () -> Bool in
                let session = AVAudioSession.sharedInstance()
                do {
                    try session.setCategory(.playback, mode: .voicePrompt)
                    try session.setActive(true)
                    return true
                } catch {
                    Self.log.error("thinking sound: session failed: \(error.localizedDescription, privacy: .public)")
                    return false
                }
            }.value
            guard let self, self.player === player else { return }
            if !(ok && player.prepareToPlay() && player.play()) { self.finish(player) }
        }
    }

    /// Returns when the current clip (if any) has finished.
    func waitUntilDone() async {
        guard player != nil else { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    /// The reply voice is about to use the audio session: don't switch it off under it.
    func handOffSession() {
        deactivation?.cancel()
        deactivation = nil
    }

    func stop() {
        guard let player else { return }
        player.stop()
        finish(player)
    }

    private func finish(_ finished: AVAudioPlayer) {
        guard player === finished else { return }
        player = nil
        let resumed = waiters
        waiters = []
        resumed.forEach { $0.resume() }
        deactivation = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            await Task.detached(priority: .utility) {
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }.value
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let id = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.player, ObjectIdentifier(current) == id else { return }
            self.finish(current)
        }
    }
}
