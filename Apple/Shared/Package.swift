// swift-tools-version: 6.2
// TamagoShared: pure-Foundation code shared by the Watch app, the iPhone
// companion and the complication. See docs/DECISIONS.md D-101.
//
// Sources stay at Apple/Shared/*.swift (the path AGENTS.md, PROTOCOL_V1.md and
// Gateway/src/protocol.js refer to); tests live in Tests/TamagoSharedTests.

import PackageDescription

let package = Package(
    name: "TamagoShared",
    platforms: [
        .watchOS("27.0"),
        .iOS("27.0"),
        // macOS only so `swift test` can run the pure-logic tests on the host.
        .macOS(.v15),
    ],
    products: [
        .library(name: "TamagoShared", targets: ["TamagoShared"]),
    ],
    targets: [
        .target(
            name: "TamagoShared",
            path: ".",
            exclude: ["Tests"],
            sources: [
                "TamagoProtocolV1.swift",
                "SpriteAnimationClock.swift",
                "CharacterStateMachine.swift",
                "CharacterInteractionController.swift",
                "CreatureBehaviorEngine.swift",
                "CreatureBehaviorController.swift",
                "GatewayTransport.swift",
            ]
        ),
        .testTarget(
            name: "TamagoSharedTests",
            dependencies: ["TamagoShared"],
            path: "Tests/TamagoSharedTests"
        ),
    ]
)
