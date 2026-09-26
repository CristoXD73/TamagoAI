// CreatureSoundPlayer.swift
//
// VERIFICATION: compiles and runs on the watchOS 27 simulator; AUDIBLE result
// UNVERIFIED (this environment can't hear Watch audio). Off by default.
//
// Playback for CreatureSoundCue (Apple/Shared/ConnectionModel.swift).
// CREATURE_SPEC §9: sound is off by default, respects silent mode, ≤ 6
// samples, each < 400 ms, quiet, never during idle life.
//
// Final assets: drop `creature_<cue>.caf` (or .m4a/.wav) into the Watch
// target and they're used automatically — no code change.
//
// **No approved assets exist yet.** In DEBUG builds only, a missing asset
// falls back to a generated DEVELOPMENT PLACEHOLDER tone (a short, quiet,
// softly-enveloped sine) so the plumbing can be heard on hardware. These are
// not the creature's voice and never ship: Release builds with no asset play
// nothing.

import AVFAudio
import Observation
import TamagoShared

@MainActor
@Observable
final class CreatureSoundPlayer {
    /// Off by default (spec §9.1). Flip explicitly; never infer.
    var isEnabled = false
    private(set) var lastPlayed: (cue: CreatureSoundCue, source: String)?

    /// "Uncommon": at most one cue per this interval, however busy the state is.
    @ObservationIgnored private let minimumInterval: TimeInterval = 1.5
    @ObservationIgnored private var lastPlayedAt: Date?
    @ObservationIgnored private var player: AVAudioPlayer?

    func play(_ cue: CreatureSoundCue, force: Bool = false) {
        guard isEnabled || force else { return }
        if !force, let last = lastPlayedAt, Date().timeIntervalSince(last) < minimumInterval { return }

        let next: AVAudioPlayer?
        let source: String
        if let url = assetURL(for: cue) {
            next = try? AVAudioPlayer(contentsOf: url)
            source = url.lastPathComponent
        } else {
            #if DEBUG
            next = try? AVAudioPlayer(data: Self.placeholderWAV(for: cue))
            source = "DEVELOPMENT PLACEHOLDER tone"
            #else
            return
            #endif
        }
        guard let next else { return }
        next.volume = 0.35
        next.prepareToPlay()
        // AVAudioPlayer.play() returns immediately — never blocks animation or networking.
        next.play()
        player = next
        lastPlayedAt = Date()
        lastPlayed = (cue, source)
    }

    private func assetURL(for cue: CreatureSoundCue) -> URL? {
        for ext in ["caf", "m4a", "wav"] {
            if let url = Bundle.main.url(forResource: "creature_\(cue.rawValue)", withExtension: ext) { return url }
        }
        return nil
    }

    #if DEBUG
    /// Start/end frequency (Hz) and duration (s) per cue — distinct enough to
    /// tell apart while testing, deliberately soft and short.
    private static func shape(for cue: CreatureSoundCue) -> (Double, Double, Double) {
        switch cue {
        case .curious: (440, 620, 0.18)
        case .acknowledge: (740, 740, 0.07)
        case .pleased: (520, 880, 0.22)
        case .thinking: (330, 350, 0.20)
        case .uncertain: (500, 400, 0.18)
        case .sleepy: (300, 220, 0.25)
        }
    }

    static func placeholderWAV(for cue: CreatureSoundCue) -> Data {
        let (f0, f1, seconds) = shape(for: cue)
        let rate = 22_050.0
        let count = Int(rate * seconds)
        var samples = [Int16](repeating: 0, count: count)
        var phase = 0.0
        for i in 0..<count {
            let t = Double(i) / Double(count)
            let freq = f0 + (f1 - f0) * t
            phase += 2 * .pi * freq / rate
            // Raised-cosine envelope: no click at start or end.
            let envelope = 0.5 - 0.5 * cos(2 * .pi * t)
            samples[i] = Int16(sin(phase) * envelope * 0.25 * Double(Int16.max))
        }
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        let byteCount = UInt32(count * 2)
        data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36) + byteCount)
        data.append(contentsOf: Array("WAVEfmt ".utf8)); append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(UInt32(rate)); append(UInt32(rate) * 2); append(UInt16(2)); append(UInt16(16))
        data.append(contentsOf: Array("data".utf8)); append(byteCount)
        for s in samples { append(s) }
        return data
    }
    #endif
}
