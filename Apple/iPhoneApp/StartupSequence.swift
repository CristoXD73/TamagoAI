// StartupSequence.swift
//
// VERIFICATION: builds; not checked on a device. VISUAL_APPROVAL_GATE #17 (owner, 2026-09-29: "Sure ship that"), v3 per
// #19 (owner, 2026-10-01: "sure change it to that").
//
// The startup sequence: Tamago's eight universes fight for the spot, overload, cut to black, and the hero lands and
// starts to float (docs/prototypes/startup-v3). Plays once per launch over the app, then fades away; a tap skips it.
// StartupSequence.mp4 is the v3 app cut: 6.3 s, ending on the hero, with a fade.
// Sound follows the ringer switch (.ambient): a launch shouldn't make noise when the phone is on silent, and it
// never stops the owner's music.

import AVFoundation
import SwiftUI
import UIKit

struct StartupSequence: View {
    var onFinished: () -> Void
    @State private var opacity = 1.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        StartupPlayer(onEnd: finish)
            .ignoresSafeArea()
            .background(Color.black)
            .opacity(opacity)
            .contentShape(Rectangle())
            .onTapGesture(perform: finish)
            .accessibilityLabel("Tamago starting up. Tap to skip.")
            .onAppear { if reduceMotion { onFinished() } }
    }

    private func finish() {
        withAnimation(.easeOut(duration: 0.35)) { opacity = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: onFinished)
    }
}

private struct StartupPlayer: UIViewRepresentable {
    var onEnd: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onEnd: onEnd) }

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.backgroundColor = .black
        guard let url = Bundle.main.url(forResource: "StartupSequence", withExtension: "mp4") else {
            DispatchQueue.main.async(execute: onEnd)
            return view
        }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        let player = AVPlayer(url: url)
        player.preventsDisplaySleepDuringVideoPlayback = false
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspectFill
        context.coordinator.observe(player)
        player.play()
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {}

    @MainActor
    final class Coordinator {
        let onEnd: () -> Void
        private var token: NSObjectProtocol?
        init(onEnd: @escaping () -> Void) { self.onEnd = onEnd }
        func observe(_ player: AVPlayer) {
            token = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: player.currentItem,
                                                           queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if let token = self.token { NotificationCenter.default.removeObserver(token) }
                    self.token = nil
                    self.onEnd()
                }
            }
        }
    }

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
