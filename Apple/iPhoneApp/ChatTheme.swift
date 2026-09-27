// ChatTheme.swift
//
// VERIFICATION: UNVERIFIED (written in the cloud, not compiled or rendered).
//
// D-127: the phone chat's look. Calm and dark like the creature's black stage,
// in the spirit of modern assistant apps (the owner pointed at Meta's Muse):
// Tamago's words are clean text beside a small avatar, the owner's are soft
// gradient bubbles, and a pill composer sits at the bottom. No Meta branding.

import SwiftUI

enum ChatTheme {
    static let background = Color(red: 0.035, green: 0.04, blue: 0.055)
    static let surface = Color.white.opacity(0.06)
    static let hairline = Color.white.opacity(0.09)
    static let primaryText = Color.white.opacity(0.94)
    static let secondaryText = Color.white.opacity(0.58)
    static let online = Color(red: 0.35, green: 0.85, blue: 0.6)
    static let offline = Color(red: 1.0, green: 0.62, blue: 0.3)
    static let danger = Color(red: 1.0, green: 0.45, blue: 0.45)

    /// The owner's bubbles and the send button: deep sea blue into violet.
    static let accent = LinearGradient(
        colors: [Color(red: 0.16, green: 0.47, blue: 0.98), Color(red: 0.49, green: 0.33, blue: 0.97)],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    /// A faint glow behind the top of the screen, like light from the surface.
    static let glow = RadialGradient(
        colors: [Color(red: 0.2, green: 0.45, blue: 0.9).opacity(0.22), .clear],
        center: .top, startRadius: 10, endRadius: 420)

    static let bubbleRadius: CGFloat = 22
}

/// Tamago's face: the approved octopus (cutout of ref_hero_q34.jpg, see
/// Assets/CharacterReference/octopus-v001/PROVENANCE.md) in a dark circle.
struct TamagoAvatar: View {
    var size: CGFloat = 28

    var body: some View {
        Image("TamagoAvatar")
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .padding(size * 0.14)
            .frame(width: size, height: size)
            .background(Circle().fill(Color.black))
            .overlay(Circle().strokeBorder(ChatTheme.accent.opacity(0.7), lineWidth: max(1, size / 28)))
            .accessibilityHidden(true)
    }
}
