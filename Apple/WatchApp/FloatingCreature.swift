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
// The 10 s loop plays as a silent looping video (IdleLoop.mp4: H.264, 300×400,
// composited on black, no audio track), decoded by the Watch's video hardware.
// It also hides the system clock: watchOS hides the time while a video is on
// screen, and the owner asked for no clock ("we are working towards a charm").
// Paused and replaced by the first frame (idle-000.jpg) whenever nobody can see
// it (other page, Always-On / reduced luminance) and with Reduce Motion.

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
    @State private var loop = IdleLoop()

    private var isMoving: Bool { isVisible && !isLuminanceReduced && !reduceMotion }

    var body: some View {
        ZStack(alignment: .bottom) {
            ZStack {
                IdleLoop.poster.map { Image(uiImage: $0).resizable().scaledToFit() }
                if isMoving, let player = loop.player {
                    VideoPlayer(player: player)
                        .aspectRatio(3.0 / 4.0, contentMode: .fit)
                        .allowsHitTesting(false)   // the creature's gestures stay the owner's
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
        .onChange(of: isMoving, initial: true) { _, moving in loop.setPlaying(moving) }
    }
}

/// The idle loop: one muted AVQueuePlayer for the app's lifetime. watchOS has no
/// AVPlayerLooper, so two copies of the clip stay queued and a fresh one is
/// appended each time one ends: no seek, so no visible seam.
@MainActor
final class IdleLoop {
    static let poster: UIImage? = Bundle.main.path(forResource: "idle-000", ofType: "jpg").flatMap(UIImage.init(contentsOfFile:))

    let player: AVQueuePlayer?
    private let url: URL?
    private var observer: NSObjectProtocol?

    init() {
        url = Bundle.main.url(forResource: "IdleLoop", withExtension: "mp4")
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
