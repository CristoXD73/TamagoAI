// CharacterExpression.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (SE 3 40 mm).
//
// Stage A placeholder character (docs/DECISIONS.md D-102). No art assets
// exist yet, so a frame is a small set of procedural draw parameters instead
// of an asset-catalog image; CharacterView still drives it with the exact
// TimelineView + SpriteAnimationClock timing D-102 decided. Swapping in real
// per-frame images later only touches CharacterArt/CharacterView, not the
// state machine or the clock. Original design — no upstream art or code.

import SwiftUI

/// How the eyes are drawn for one frame.
enum EyeStyle: Equatable {
    case open
    case wide
    case closed
    /// Upward "^" arcs (happy/success).
    case happy
    /// Crossed-out (error).
    case x
    /// Pupil looks to one side. -1 = full left, 1 = full right (thinking).
    case lookAway(CGFloat)
    /// Half-closed lid (sleeping/disconnected/sleepy blink).
    case sleepy
}

/// How the mouth is drawn for one frame.
enum MouthStyle: Equatable {
    case neutral
    case smile
    case bigSmile
    /// Talking; 0 = closed, 1 = fully open (speaking).
    case talk(CGFloat)
    case frown
    /// Small round "o" (confused/surprised).
    case o
    case flatLine
}

/// A small badge drawn near the character, or none.
enum Decoration: Equatable {
    case none
    case sparkle
    case checkmark
    case questionMark
    case zzz
    /// A dot orbiting the head (thinking/toolRunning).
    case orbitDot(Angle)
    /// An expanding listening ripple, 0...1.
    case ripple(CGFloat)
}

/// Everything CharacterView needs to draw one frame.
struct CharacterExpression: Equatable {
    var eyes: EyeStyle
    var mouth: MouthStyle
    /// Vertical offset in points; negative = up (bounce/breathing).
    var bounceY: CGFloat = 0
    /// Body scale; 1 = rest.
    var scale: CGFloat = 1
    /// Head/body tilt.
    var tilt: Angle = .zero
    var tint: Color
    var decoration: Decoration = .none
}
