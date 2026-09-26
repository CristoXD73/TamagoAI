// CreatureIdleStage.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (SE 3 40 mm).
//
// The idle-only "habitat" layer (docs/DECISIONS.md D-114). Renders the
// octopus body at CreatureBehaviorController's logical position and lets
// the container's `.clipped()` do all peek/hide visibility work
// geometrically — a position near/past an edge naturally shows only a
// sliver or nothing, instead of a decoration flag per phase (task §5:
// reusable, not one giant scripted sequence).
//
// This view never ticks the controller itself (no timer of its own, D-102):
// CharacterView already runs one TimelineView for the whole character and
// passes this view its tick's `now`; CharacterView is the one call site
// that advances CreatureBehaviorController, exactly once per frame, only
// while state.visual is .idle or .disconnected (D-116) and the environment is live.

import SwiftUI
import TamagoShared

struct CreatureIdleStage: View {
    var controller: CreatureBehaviorController
    let now: Date

    var body: some View {
        GeometryReader { geo in
            let world = controller.state
            let position = CreatureBehaviorEngine.position(for: world, at: now)
            let attention = CreatureBehaviorEngine.attention(for: world, at: now)
            let expression = CreatureExpression.make(for: world, position: position, attention: attention, now: now)

            ZStack {
                Color.black
                CharacterFace(expression: expression)
                    .scaleEffect(x: world.facing < 0 ? -1 : 1, y: 1)
                    .position(x: position.x * geo.size.width, y: position.y * geo.size.height)
            }
            .contentShape(Rectangle())
            .onTapGesture { location in
                guard geo.size.width > 0, geo.size.height > 0 else { return }
                controller.tap(at: Point2D(x: location.x / geo.size.width, y: location.y / geo.size.height))
            }
        }
        .clipped()
        .accessibilityElement()
        .accessibilityLabel(Text("idle"))
    }
}
