// GatewayReachabilityMonitor.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (start/stop and the routeLost path
// exercised manually against a real gateway process — see
// docs/HANDOFF_LOG.md). Not DEVICE_VERIFIED, and battery impact of the poll
// interval is UNVERIFIED (task §22: "document anything requiring
// physical-device energy testing").
//
// Proactive half of task §5's offline behavior: a failed *request* already
// resolves to `.disconnected` on its own (CharacterStateMachine's
// reactionMood maps a gatewayUnavailable/disconnected error there), but
// nothing without this notices the Mac is gone *before* the user tries to
// talk to it. Polls GET /v1/health at a conservative interval, only while the
// scene is active, and only calls the one event each state actually accepts:
// `.routeLost` (from `.idle`/`.sleeping`) and `.routeRestored` (from
// `.disconnected`) — CharacterStateMachine.reduce ignores it harmlessly from
// any other state, so this never needs to know the current visual state
// itself. No new UI: task §4 — this only feeds existing creature state.

import Foundation
import TamagoShared

@MainActor
final class GatewayReachabilityMonitor {
    private let connection: TamagoConnection
    private weak var controller: CharacterInteractionController?
    private let pollInterval: Duration
    private var task: Task<Void, Never>?

    /// 20s: frequent enough that "Mac just quit" reads as reasonably prompt,
    /// infrequent enough not to be a hidden high-rate timer (AGENTS.md §5).
    init(connection: TamagoConnection, controller: CharacterInteractionController, pollInterval: Duration = .seconds(20)) {
        self.connection = connection
        self.controller = controller
        self.pollInterval = pollInterval
    }

    func start() {
        stop()
        task = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                let reachable = await self.connection.checkHealth()
                guard !Task.isCancelled else { return }
                self.controller?.apply(reachable ? .routeRestored : .routeLost)
                try? await Task.sleep(for: self.pollInterval)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }
}
