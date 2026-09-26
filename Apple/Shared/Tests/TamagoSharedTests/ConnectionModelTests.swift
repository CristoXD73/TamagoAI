import Foundation
import Testing
@testable import TamagoShared

@Suite("ConnectionModel")
struct ConnectionModelTests {
    // MARK: TransportState — phases

    @Test func firstContactGoesSearchingToConnectingToConnected() {
        var t = TransportState()
        #expect(t.phase == .searching)
        #expect(t.nextProbeDelay == 0, "probe immediately on first activation")
        t.apply(.probeStarted)
        #expect(t.phase == .connecting)
        t.apply(.reachable)
        #expect(t.phase == .connected)
    }

    @Test func connectedLinkIsNeverPolled() {
        var t = TransportState()
        t.apply(.reachable)
        #expect(t.nextProbeDelay == nil)
        t.apply(.probeStarted)
        #expect(t.phase == .connected, "an activation probe doesn't flip a live link")
    }

    @Test func losingTheMacReconnectsThenGoesOfflineThenRecovers() {
        var t = TransportState()
        t.apply(.reachable)
        t.apply(.unreachable)
        #expect(t.phase == .reconnecting)
        t.apply(.unreachable)
        #expect(t.phase == .reconnecting)
        t.apply(.unreachable)
        #expect(t.phase == .offline)
        t.apply(.reachable)
        #expect(t.phase == .connected)
        #expect(t.consecutiveFailures == 0)
    }

    @Test func neverFoundStaysSearchingUntilOffline() {
        var t = TransportState()
        t.apply(.probeStarted)
        t.apply(.unreachable)
        #expect(t.phase == .searching)
        t.apply(.unreachable)
        t.apply(.unreachable)
        #expect(t.phase == .offline)
    }

    @Test func backoffGrowsAndIsCapped() {
        var t = TransportState()
        var delays: [TimeInterval] = []
        for _ in 0..<9 {
            t.apply(.unreachable)
            delays.append(t.nextProbeDelay ?? -1)
        }
        #expect(delays == [5, 15, 60, 60, 60, 60, 60, 60, 60], "D-107's schedule")
    }

    // MARK: CreatureSemanticState

    @Test func interactionStatesMapDirectly() {
        #expect(CreatureSemanticState.derive(visual: .listening, link: .connected) == .listening)
        #expect(CreatureSemanticState.derive(visual: .acknowledging, link: .connected) == .sending)
        #expect(CreatureSemanticState.derive(visual: .thinking, link: .connected) == .thinking)
        #expect(CreatureSemanticState.derive(visual: .toolRunning, link: .connected) == .thinking)
        #expect(CreatureSemanticState.derive(visual: .speaking, link: .connected) == .speaking)
        for mood in [TamagoCharacterState.happy, .success, .confused, .error] {
            #expect(CreatureSemanticState.derive(visual: mood, link: .connected) == .receiving)
        }
    }

    @Test func linkShapesIdleAndDisconnected() {
        #expect(CreatureSemanticState.derive(visual: .idle, link: .connected) == .idle)
        #expect(CreatureSemanticState.derive(visual: .idle, link: .searching) == .idle)
        #expect(CreatureSemanticState.derive(visual: .idle, link: .reconnecting) == .recovering)
        #expect(CreatureSemanticState.derive(visual: .idle, link: .offline) == .offline)
        #expect(CreatureSemanticState.derive(visual: .disconnected, link: .offline) == .offline)
        #expect(CreatureSemanticState.derive(visual: .disconnected, link: .reconnecting) == .recovering)
        #expect(CreatureSemanticState.derive(visual: .sleeping, link: .connected) == .idle)
    }

    @Test func everySemanticStateIsReachable() {
        var seen = Set<CreatureSemanticState>()
        for visual in TamagoCharacterState.allCases {
            for link in TransportState.Phase.allCases {
                seen.insert(CreatureSemanticState.derive(visual: visual, link: link))
            }
        }
        #expect(seen == Set(CreatureSemanticState.allCases))
    }

    // MARK: CreatureSoundCue — spec §9.3 only

    @Test func onlySpecSanctionedTransitionsMakeSound() {
        #expect(CreatureSoundCue.cue(from: .idle, to: .listening) == .curious)
        #expect(CreatureSoundCue.cue(from: .listening, to: .acknowledging) == .acknowledge)
        #expect(CreatureSoundCue.cue(from: .thinking, to: .happy) == .pleased)
        #expect(CreatureSoundCue.cue(from: .speaking, to: .success) == .pleased)
        #expect(CreatureSoundCue.cue(from: .thinking, to: .confused) == nil)
        #expect(CreatureSoundCue.cue(from: .acknowledging, to: .thinking) == nil)
        #expect(CreatureSoundCue.cue(from: .happy, to: .idle) == nil, "no idle-life sounds, ever")
        #expect(CreatureSoundCue.cue(from: .idle, to: .sleeping) == nil, "no idle-life sounds, ever")
        #expect(CreatureSoundCue.cue(from: .listening, to: .listening) == nil)
    }
}
