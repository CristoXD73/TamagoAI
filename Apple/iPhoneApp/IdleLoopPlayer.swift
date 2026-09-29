// IdleLoopPlayer.swift
//
// VERIFICATION: builds; checked in the iOS simulator only if noted in
// docs/HANDOFF_LOG.md. Not DEVICE_VERIFIED.
//
// Tamago's 10 s idle loop (D-124; owner direction 2026-09-27) as a silent,
// endlessly looping video: IdleLoop.mov, HEVC with alpha (600×800, no audio
// track, so it never interrupts the owner's music). Transparent, so the octopus
// floats on the chat's gradient instead of sitting in a black box (the H.264
// version on black did, 2026-09-28). Stills on Reduce Motion.
//
// The colour in IdleLoop.mov is premultiplied by alpha, which is what Core
// Animation expects; straight colour gave white, speckled edges (owner,
// 2026-09-28). Re-encode only with scripts/encode-phone-idle.sh.

import AVFoundation
import SwiftUI
import UIKit

struct IdleLoopPlayer: UIViewRepresentable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.backgroundColor = .clear
        view.isOpaque = false
        guard let url = Bundle.main.url(forResource: "IdleLoop", withExtension: "mov") else { return view }
        let player = AVQueuePlayer()
        player.isMuted = true
        player.preventsDisplaySleepDuringVideoPlayback = false
        context.coordinator.looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        view.playerLayer.backgroundColor = UIColor.clear.cgColor
        // BGRA keeps the HEVC alpha channel; the default pixel format drops it to black.
        view.playerLayer.pixelBufferAttributes = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
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
