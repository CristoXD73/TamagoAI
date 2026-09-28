// FloatingCreature.swift
//
// VERIFICATION: builds; checked in the watchOS simulator only if noted in
// docs/HANDOFF_LOG.md. Not DEVICE_VERIFIED.
//
// Owner direction, 2026-09-27 ("heres an idle animation … make sure to change
// our mascot for this"): Tamago is the front-facing 2D idle loop Codex made
// (docs/prototypes/idle-front-v1, D-124). That instruction is the Visual
// Approval Gate sign-off for this motion (AGENTS.md §7). It replaces D-119's
// floating still of the hero art.
//
// The 10 s loop is 200 JPEG frames (20 fps, 300×400 px, composited on black) in
// WatchApp/IdleLoop, drawn by one pausable TimelineView. Frames loop exactly (the
// renderer's t=0 and t=10 s match), so there's no seam; one frame is decoded at a
// time, so memory stays flat. Paused on the first frame whenever nobody can see it
// (other page, Always-On / reduced luminance) and with Reduce Motion.
//
// The clock: watchOS hides the time while a video plays on screen, and the owner
// asked for no clock ("we are working towards a charm"). Playing the octopus
// itself as video (build 4–5) showed the system player starting up on launch and
// hitched each time the 10 s clip rolled over (owner, 2026-09-27). So the octopus
// is frames again, and a practically invisible 2 pt video of black (ClockHider.mp4,
// 3 KB) keeps the clock away.

import AVFoundation
import AVKit
import SwiftUI
import UIKit

struct FloatingCreature: View {
    var isVisible: Bool
    /// Tamago's answer, shown small under the creature while it speaks, so it
    /// isn't lost when the Watch is muted (D-119). Plain text, no bubble.
    var caption: String?
    /// Waiting for the answer: show the owner's chosen waiting sign (D-126).
    var isWaiting = false

    @AppStorage(WaitingSignStyle.storageKey) private var waitingSign = WaitingSignStyle.dots.rawValue
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var clock = ClockHider()

    private var isMoving: Bool { isVisible && !isLuminanceReduced && !reduceMotion }

    var body: some View {
        ZStack(alignment: .bottom) {
            ZStack {
                TimelineView(.animation(minimumInterval: 1.0 / IdleLoop.fps, paused: !isMoving)) { context in
                    if let image = IdleLoop.image(isMoving ? IdleLoop.frameIndex(at: context.date) : 0) {
                        Image(uiImage: image).resizable().scaledToFit()
                    }
                }
                if isMoving, let player = clock.player {
                    // Not for looking at: its presence is what hides the clock. 2 pt, all but transparent.
                    VideoPlayer(player: player)
                        .frame(width: 2, height: 2)
                        .opacity(0.02)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .opacity(isLuminanceReduced ? 0.55 : 1)
            .accessibilityElement()
            .accessibilityLabel("Tamago, a small white octopus")
            if isWaiting && !isLuminanceReduced {
                WaitingSign(style: WaitingSignStyle(rawValue: waitingSign) ?? .dots)
                    .transition(.opacity)
            }
            if let caption {
                Text(caption)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.9))
                    .shadow(color: .black, radius: 3)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 12)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: caption)
        .animation(.easeInOut(duration: 0.4), value: isWaiting)
        .onChange(of: isMoving, initial: true) { _, moving in clock.setPlaying(moving) }
    }
}

/// The idle loop's frames in the app bundle (`idle-000.jpg` … `idle-199.jpg`).
enum IdleLoop {
    static let fps: Double = 20
    static let frameCount = 200

    static func frameIndex(at date: Date) -> Int {
        Int((date.timeIntervalSinceReferenceDate * fps).rounded(.down)) % frameCount
    }

    /// Decodes one frame from disk. Not cached: 200 decoded frames would be ~90 MB.
    static func image(_ index: Int) -> UIImage? {
        Bundle.main.path(forResource: String(format: "idle-%03d", index), ofType: "jpg").flatMap(UIImage.init(contentsOfFile:))
    }
}

/// The clock hider: a 3 KB black clip looping on a muted AVQueuePlayer (watchOS has no
/// AVPlayerLooper, so two copies stay queued and one is appended as each ends).
@MainActor
final class ClockHider {

    let player: AVQueuePlayer?
    private let url: URL?
    private var observer: NSObjectProtocol?

    init() {
        url = Bundle.main.url(forResource: "ClockHider", withExtension: "mp4")
        guard let url else {
            player = nil
            return
        }
        let player = AVQueuePlayer(items: [AVPlayerItem(url: url), AVPlayerItem(url: url)])
        player.isMuted = true
        player.actionAtItemEnd = .advance
        self.player = player
        observer = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                          object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.topUp() }
        }
    }

    /// Keeps two clips queued. Any item ending triggers a check, never more than a top-up.
    private func topUp() {
        guard let player, let url else { return }
        while player.items().count < 2 { player.insert(AVPlayerItem(url: url), after: nil) }
    }

    func setPlaying(_ playing: Bool) {
        if playing { player?.play() } else { player?.pause() }
    }
}
