// IdleLoopPlayer.swift
//
// VERIFICATION: builds; checked in the iOS simulator only if noted in
// docs/HANDOFF_LOG.md. Not DEVICE_VERIFIED.
//
// Tamago's 10 s idle loop (D-124; owner direction 2026-09-27) as a silent,
// endlessly looping video on black: IdleLoop.mp4 (H.264, 600×800, no audio
// track, so it never interrupts the owner's music). Stills on Reduce Motion.

import AVFoundation
import SwiftUI
import UIKit

struct IdleLoopPlayer: UIViewRepresentable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.backgroundColor = .black
        guard let url = Bundle.main.url(forResource: "IdleLoop", withExtension: "mp4") else { return view }
        let player = AVQueuePlayer()
        player.isMuted = true
        player.preventsDisplaySleepDuringVideoPlayback = false
        context.coordinator.looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {
        guard let player = view.playerLayer.player else { return }
        if reduceMotion {
            player.pause()
            player.seek(to: .zero)
        } else {
            player.play()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var looper: AVPlayerLooper?
    }

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
