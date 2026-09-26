import Foundation
import Testing
@testable import TamagoShared

/// Covers docs/DECISIONS.md D-103's transition table: legal transitions,
/// illegal-transition rejection, cancellation, stale-response protection, and
/// reaction states returning to idle. `reduce` is pure, so every test builds
/// its own `now` and asserts on the returned value only — no shared clock,
/// no shared mutable fixture.
@Suite("CharacterStateMachine")
struct CharacterStateMachineTests {
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    let t1 = Date(timeIntervalSince1970: 1_000_010)

    func reduce(_ state: CharacterState, _ event: CharacterEvent, now: Date? = nil) -> (CharacterState, [CharacterEffect]) {
        CharacterStateMachine.reduce(state, event: event, now: now ?? t1)
    }

    func state(_ visual: TamagoCharacterState, activeRequestID: String? = nil, followUpExpected: Bool = false) -> CharacterState {
        CharacterState(visual: visual, activeRequestID: activeRequestID, enteredAt: t0, followUpExpected: followUpExpected)
    }

    // MARK: Initial state

    @Test func initialStateIsIdleWithNothingInFlight() {
        #expect(CharacterState.initial.visual == .idle)
        #expect(CharacterState.initial.activeRequestID == nil)
        #expect(!CharacterState.initial.followUpExpected)
    }

    // MARK: userActivated (legal + illegal sources)

    @Test(arguments: [.idle, .sleeping, .disconnected, .happy, .success, .confused, .error] as [TamagoCharacterState])
    func userActivatedStartsListeningFromReadyStates(_ from: TamagoCharacterState) {
        let (next, effects) = reduce(state(from), .userActivated, now: t1)
        #expect(next.visual == .listening)
        #expect(next.activeRequestID == nil)
        #expect(next.enteredAt == t1)
        #expect(effects == [.playHaptic(.click)])
    }

    @Test(arguments: [.listening, .acknowledging, .thinking, .toolRunning, .speaking] as [TamagoCharacterState])
    func userActivatedIsIllegalWhileAlreadyInAnInteraction(_ from: TamagoCharacterState) {
        let original = state(from, activeRequestID: "req-1")
        let (next, effects) = reduce(original, .userActivated)
        #expect(next == original, "illegal transitions leave state byte-for-byte unchanged")
        #expect(effects.isEmpty)
    }

    // MARK: wake / inactivityTimeout (sleeping round trip)

    @Test func wakeReturnsSleepingToIdle() {
        let (next, effects) = reduce(state(.sleeping), .wake, now: t1)
        #expect(next.visual == .idle)
        #expect(next.enteredAt == t1)
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.idle, .listening, .thinking, .disconnected] as [TamagoCharacterState])
    func wakeIsIllegalOutsideSleeping(_ from: TamagoCharacterState) {
        let original = state(from)
        let (next, _) = reduce(original, .wake)
        #expect(next == original)
    }

    @Test func inactivityTimeoutMovesIdleToSleeping() {
        let (next, effects) = reduce(state(.idle), .inactivityTimeout, now: t1)
        #expect(next.visual == .sleeping)
        #expect(next.enteredAt == t1)
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.listening, .sleeping, .thinking, .happy] as [TamagoCharacterState])
    func inactivityTimeoutIsIllegalOutsideIdle(_ from: TamagoCharacterState) {
        let original = state(from)
        #expect(reduce(original, .inactivityTimeout).0 == original)
    }

    // MARK: transcript

    @Test func nonEmptyTranscriptMovesListeningToAcknowledgingAndSendsRequest() {
        let id = UUID(uuidString: "3F2B8C1E-9A4D-4E7B-8C2A-1D5E6F7A8B9C")!
        let (next, effects) = reduce(state(.listening), .transcript(text: "Turn Jellyfin back on.", requestId: id), now: t1)
        #expect(next.visual == .acknowledging)
        #expect(next.activeRequestID == "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c", "matches TamagoRequest's lowercasing")
        #expect(next.enteredAt == t1)
        #expect(effects.count == 1)
        guard case let .sendRequest(request) = effects[0] else {
            Issue.record("expected sendRequest"); return
        }
        #expect(request.text == "Turn Jellyfin back on.")
        #expect(request.requestId == next.activeRequestID)
    }

    @Test func emptyTranscriptCancelsToIdleWithoutSendingARequest() {
        let (next, effects) = reduce(state(.listening), .transcript(text: "", requestId: UUID()), now: t1)
        #expect(next.visual == .idle)
        #expect(next.activeRequestID == nil)
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.idle, .acknowledging, .thinking, .speaking] as [TamagoCharacterState])
    func transcriptIsIllegalOutsideListening(_ from: TamagoCharacterState) {
        let original = state(from)
        #expect(reduce(original, .transcript(text: "hello", requestId: UUID())).0 == original)
    }

    // MARK: ackBeatElapsed

    @Test func ackBeatElapsedMovesAcknowledgingToThinking() {
        let original = state(.acknowledging, activeRequestID: "req-1")
        let (next, effects) = reduce(original, .ackBeatElapsed(requestId: "req-1"), now: t1)
        #expect(next.visual == .thinking)
        #expect(next.activeRequestID == "req-1", "request ID threads through unchanged")
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.idle, .listening, .thinking, .speaking] as [TamagoCharacterState])
    func ackBeatElapsedIsIllegalOutsideAcknowledging(_ from: TamagoCharacterState) {
        let original = state(from)
        #expect(reduce(original, .ackBeatElapsed(requestId: "req-1")).0 == original)
    }

    // MARK: toolProgress

    @Test func matchingToolProgressMovesThinkingToToolRunning() {
        let original = state(.thinking, activeRequestID: "req-1")
        let (next, effects) = reduce(original, .toolProgress(requestId: "REQ-1"), now: t1)
        #expect(next.visual == .toolRunning, "matches case-insensitively, like TamagoResponse.answers(_:)")
        #expect(next.activeRequestID == "req-1")
        #expect(effects.isEmpty)
    }

    @Test func mismatchedToolProgressIsIgnored() {
        let original = state(.thinking, activeRequestID: "req-1")
        #expect(reduce(original, .toolProgress(requestId: "req-2")).0 == original)
    }

    @Test func toolProgressWithNoActiveRequestIsIgnored() {
        let original = state(.thinking, activeRequestID: nil)
        #expect(reduce(original, .toolProgress(requestId: "req-1")).0 == original)
    }

    @Test(arguments: [.idle, .acknowledging, .toolRunning, .speaking] as [TamagoCharacterState])
    func toolProgressIsIllegalOutsideThinking(_ from: TamagoCharacterState) {
        let original = state(from, activeRequestID: "req-1")
        #expect(reduce(original, .toolProgress(requestId: "req-1")).0 == original)
    }

    // MARK: response — stale-response protection

    private func response(
        requestId: String? = "req-1", status: TamagoResponseStatus = .ok,
        speechText: String = "", characterState: TamagoCharacterState = .success,
        haptic: TamagoHaptic = .success, followUpExpected: Bool = false
    ) -> TamagoResponse {
        TamagoResponse(
            requestId: requestId, status: status, text: "text", speechText: speechText,
            characterState: characterState, haptic: haptic, followUpExpected: followUpExpected, error: nil)
    }

    @Test(arguments: [.acknowledging, .thinking, .toolRunning] as [TamagoCharacterState])
    func responseWithMismatchedRequestIdIsDropped(_ from: TamagoCharacterState) {
        let original = state(from, activeRequestID: "req-1")
        let (next, effects) = reduce(original, .response(response(requestId: "req-2")))
        #expect(next == original, "a response for a different request must never overwrite this state")
        #expect(effects.isEmpty)
    }

    @Test func responseWithNoActiveRequestIsDropped() {
        let original = state(.thinking, activeRequestID: nil)
        let (next, _) = reduce(original, .response(response(requestId: "req-1")))
        #expect(next == original)
    }

    @Test func responseWithNullRequestIdIsDropped() {
        // requestId is null for errors raised before the gateway could read a
        // UUID (PROTOCOL_V1 §5) — it can never match anything in flight.
        let original = state(.thinking, activeRequestID: "req-1")
        let (next, _) = reduce(original, .response(response(requestId: nil)))
        #expect(next == original)
    }

    @Test func lateResponseAfterCancelIsDropped() {
        // "Because cancel clears activeRequestID, a late answer after a
        // cancel is also dropped" (D-103).
        let mid = state(.thinking, activeRequestID: "req-1")
        let (cancelled, _) = reduce(mid, .cancel, now: t1)
        #expect(cancelled.activeRequestID == nil)

        let (next, effects) = reduce(cancelled, .response(response(requestId: "req-1")))
        #expect(next == cancelled, "the stale response must not resurrect the old interaction")
        #expect(effects.isEmpty)
    }

    @Test func requestACancelledThenBStartedLateAIsDroppedAndBResolves() {
        // User starts A, cancels, starts B; A's answer arrives late, then B's.
        let idA = UUID(), idB = UUID()
        let a = idA.uuidString.lowercased(), b = idB.uuidString.lowercased()
        var s = state(.listening)
        (s, _) = reduce(s, .transcript(text: "first", requestId: idA))
        #expect(s.activeRequestID == a)
        (s, _) = reduce(s, .cancel)
        (s, _) = reduce(s, .userActivated)
        (s, _) = reduce(s, .transcript(text: "second", requestId: idB))
        #expect(s.activeRequestID == b)

        let beforeLateA = s
        let (afterLateA, lateEffects) = reduce(s, .response(response(requestId: a, characterState: .confused)))
        #expect(afterLateA == beforeLateA, "A's late answer must never touch B's in-flight state")
        #expect(lateEffects.isEmpty)

        let (afterB, _) = reduce(afterLateA, .response(response(requestId: b, characterState: .happy)))
        #expect(afterB.visual == .happy)
        #expect(afterB.activeRequestID == b)
    }

    @Test func delayedResponseAfterRouteRestorationIsDropped() {
        // Gateway disappears mid-request → client synthesizes gatewayUnavailable
        // → disconnected (identity cleared) → route comes back → the original
        // request's real answer finally arrives. It must be ignored.
        let id = UUID()
        let rid = id.uuidString.lowercased()
        var s = state(.listening)
        (s, _) = reduce(s, .transcript(text: "hello", requestId: id))
        let unavailable = TamagoResponse(
            requestId: rid, status: .error, text: "", speechText: "",
            characterState: .idle, haptic: .none, followUpExpected: false,
            error: TamagoErrorInfo(code: .gatewayUnavailable, message: "gone", retryable: true))
        (s, _) = reduce(s, .response(unavailable))
        #expect(s.visual == .disconnected)
        #expect(s.activeRequestID == nil)
        (s, _) = reduce(s, .routeRestored)
        #expect(s.visual == .idle)

        let before = s
        let (after, effects) = reduce(s, .response(response(requestId: rid, characterState: .happy)))
        #expect(after == before)
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.idle, .listening, .speaking, .happy, .disconnected] as [TamagoCharacterState])
    func responseIsIllegalOutsideAwaitingStates(_ from: TamagoCharacterState) {
        // Even with a *matching* ID, only acknowledging/thinking/toolRunning accept it.
        let original = state(from, activeRequestID: "req-1")
        let (next, effects) = reduce(original, .response(response(requestId: "req-1")))
        #expect(next == original)
        #expect(effects.isEmpty)
    }

    // MARK: response — accepted (not final)

    @Test(arguments: [.acknowledging, .thinking, .toolRunning] as [TamagoCharacterState])
    func acceptedResponseMovesToThinkingAndKeepsWaiting(_ from: TamagoCharacterState) {
        let original = state(from, activeRequestID: "req-1")
        let (next, effects) = reduce(original, .response(response(requestId: "req-1", status: .accepted)), now: t1)
        #expect(next.visual == .thinking)
        #expect(next.activeRequestID == "req-1")
        #expect(next.enteredAt == t1)
        #expect(effects.isEmpty)
    }

    // MARK: response — final, with speech (→ speaking)

    @Test func finalResponseWithSpeechMovesToSpeakingAndPlaysHapticAndSpeaks() {
        let original = state(.thinking, activeRequestID: "req-1")
        let r = response(requestId: "req-1", speechText: "Done.", characterState: .success, haptic: .success, followUpExpected: true)
        let (next, effects) = reduce(original, .response(r), now: t1)
        #expect(next.visual == .speaking)
        #expect(next.activeRequestID == "req-1", "kept until reactionFinished/cancel, not cleared here")
        #expect(next.followUpExpected)
        #expect(effects == [.playHaptic(.success), .speak(text: "Done.")])
    }

    @Test func speakingResolvesToTheReactionCarriedByItsResponse() {
        let original = state(.thinking, activeRequestID: "req-1")
        let r = response(requestId: "req-1", speechText: "Uh oh.", characterState: .error, haptic: .failure)
        let (speaking, _) = reduce(original, .response(r), now: t0)

        let (resolved, effects) = reduce(speaking, .speechFinished(requestId: "req-1"), now: t1)
        #expect(resolved.visual == .error, "lands on the mood from the response that started speaking")
        #expect(effects.isEmpty, "haptic already played when entering .speaking")
    }

    @Test func speechCancelledResolvesSpeakingTheSameWayAsSpeechFinished() {
        let original = state(.thinking, activeRequestID: "req-1")
        let r = response(requestId: "req-1", speechText: "Hi.", characterState: .happy)
        let (speaking, _) = reduce(original, .response(r), now: t0)
        let (resolved, _) = reduce(speaking, .speechCancelled(requestId: "req-1"), now: t1)
        #expect(resolved.visual == .happy)
    }

    @Test(arguments: [.idle, .listening, .thinking, .happy] as [TamagoCharacterState])
    func speechFinishedIsIllegalOutsideSpeaking(_ from: TamagoCharacterState) {
        let original = state(from)
        #expect(reduce(original, .speechFinished(requestId: "req-1")).0 == original)
        #expect(reduce(original, .speechCancelled(requestId: "req-1")).0 == original)
    }

    // MARK: response — final, no speech (→ reaction directly)

    @Test func finalResponseWithoutSpeechGoesStraightToReaction() {
        let original = state(.acknowledging, activeRequestID: "req-1")
        let r = response(requestId: "req-1", speechText: "", characterState: .confused, haptic: .notification, followUpExpected: true)
        let (next, effects) = reduce(original, .response(r), now: t1)
        #expect(next.visual == .confused)
        #expect(next.activeRequestID == "req-1")
        #expect(next.followUpExpected)
        #expect(effects == [.playHaptic(.notification)])
    }

    @Test func reactionCharacterStateThatIsNotAReactionStateFallsBackToIdle() {
        // Defensive: the gateway is only ever supposed to send reaction states,
        // and unknown wire values already decode as `.idle` upstream, but the
        // reducer doesn't trust that blindly.
        let original = state(.thinking, activeRequestID: "req-1")
        let r = response(requestId: "req-1", speechText: "", characterState: .listening)
        let (next, _) = reduce(original, .response(r))
        #expect(next.visual == .idle)
    }

    // MARK: reactionFinished

    @Test(arguments: [.happy, .success, .confused, .error] as [TamagoCharacterState])
    func reactionFinishedReturnsToIdleAndClearsTheRequest(_ from: TamagoCharacterState) {
        let original = state(from, activeRequestID: "req-1", followUpExpected: true)
        let (next, effects) = reduce(original, .reactionFinished(requestId: "req-1"), now: t1)
        #expect(next.visual == .idle)
        #expect(next.activeRequestID == nil)
        #expect(next.followUpExpected)
        #expect(next.enteredAt == t1)
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.idle, .listening, .thinking, .speaking, .disconnected] as [TamagoCharacterState])
    func reactionFinishedIsIllegalOutsideReactionMoods(_ from: TamagoCharacterState) {
        let original = state(from)
        #expect(reduce(original, .reactionFinished(requestId: "req-1")).0 == original)
    }

    // MARK: cancel / backgrounded — legal from every state

    @Test(arguments: TamagoCharacterState.allCases)
    func cancelAlwaysReturnsToIdleAndClearsEverything(_ from: TamagoCharacterState) {
        let original = state(from, activeRequestID: "req-1", followUpExpected: true)
        let (next, effects) = reduce(original, .cancel, now: t1)
        #expect(next.visual == .idle)
        #expect(next.activeRequestID == nil)
        #expect(!next.followUpExpected)
        #expect(next.enteredAt == t1)
        #expect(effects == [.cancelRequest, .stopSpeech])
    }

    @Test(arguments: TamagoCharacterState.allCases)
    func backgroundedBehavesExactlyLikeCancel(_ from: TamagoCharacterState) {
        let original = state(from, activeRequestID: "req-1", followUpExpected: true)
        let viaCancel = reduce(original, .cancel, now: t1)
        let viaBackground = reduce(original, .backgrounded, now: t1)
        #expect(viaCancel.0 == viaBackground.0)
        #expect(viaCancel.1 == viaBackground.1)
    }

    @Test func cancelFromSpeakingAlsoClearsThePendingReaction() {
        let original = state(.thinking, activeRequestID: "req-1")
        let r = response(requestId: "req-1", speechText: "Hi.", characterState: .happy)
        let (speaking, _) = reduce(original, .response(r), now: t0)

        let (cancelled, _) = reduce(speaking, .cancel, now: t1)
        #expect(cancelled.visual == .idle)
        // A speechFinished arriving after cancel must not resurrect .happy —
        // it's illegal from .idle, so it's simply ignored.
        #expect(reduce(cancelled, .speechFinished(requestId: "req-1")).0 == cancelled)
    }

    // MARK: routeLost / routeRestored

    @Test(arguments: [.idle, .sleeping] as [TamagoCharacterState])
    func routeLostMovesToDisconnected(_ from: TamagoCharacterState) {
        let (next, effects) = reduce(state(from), .routeLost, now: t1)
        #expect(next.visual == .disconnected)
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.listening, .thinking, .speaking, .happy, .disconnected] as [TamagoCharacterState])
    func routeLostIsIllegalOutsideIdleAndSleeping(_ from: TamagoCharacterState) {
        let original = state(from)
        #expect(reduce(original, .routeLost).0 == original)
    }

    @Test func routeRestoredMovesDisconnectedToIdle() {
        let (next, effects) = reduce(state(.disconnected), .routeRestored, now: t1)
        #expect(next.visual == .idle)
        #expect(effects.isEmpty)
    }

    @Test(arguments: [.idle, .listening, .happy] as [TamagoCharacterState])
    func routeRestoredIsIllegalOutsideDisconnected(_ from: TamagoCharacterState) {
        let original = state(from)
        #expect(reduce(original, .routeRestored).0 == original)
    }

    // MARK: End-to-end paths (request-ID threading through a full interaction)

    @Test func fullHappyPathWithSpeech() {
        var s = CharacterState.initial
        var effects: [CharacterEffect]

        (s, effects) = reduce(s, .userActivated, now: t0)
        #expect(s.visual == .listening)
        #expect(effects == [.playHaptic(.click)])

        let id = UUID()
        (s, effects) = reduce(s, .transcript(text: "ping", requestId: id), now: t0)
        #expect(s.visual == .acknowledging)
        let requestID = s.activeRequestID
        #expect(requestID == id.uuidString.lowercased())
        guard case let .sendRequest(sentRequest) = effects.first else { Issue.record("expected sendRequest"); return }
        #expect(sentRequest.requestId == requestID)

        (s, effects) = reduce(s, .ackBeatElapsed(requestId: id.uuidString), now: t0)
        #expect(s.visual == .thinking)
        #expect(effects.isEmpty)

        (s, effects) = reduce(s, .response(response(requestId: requestID, status: .accepted)), now: t0)
        #expect(s.visual == .thinking)
        #expect(effects.isEmpty)

        (s, effects) = reduce(s, .response(response(requestId: requestID, speechText: "pong", characterState: .success, haptic: .success)), now: t0)
        #expect(s.visual == .speaking)
        #expect(effects == [.playHaptic(.success), .speak(text: "pong")])

        (s, effects) = reduce(s, .speechFinished(requestId: id.uuidString), now: t0)
        #expect(s.visual == .success)
        #expect(effects.isEmpty)

        (s, effects) = reduce(s, .reactionFinished(requestId: id.uuidString), now: t1)
        #expect(s == CharacterState.initial.withEnteredAt(t1))
        #expect(effects.isEmpty)
    }

    @Test func fullPathWithoutSpeechSkipsSpeaking() {
        var s = CharacterState.initial
        (s, _) = reduce(s, .userActivated, now: t0)
        let id = UUID()
        (s, _) = reduce(s, .transcript(text: "ping", requestId: id), now: t0)
        (s, _) = reduce(s, .ackBeatElapsed(requestId: id.uuidString), now: t0)
        (s, _) = reduce(s, .response(response(requestId: s.activeRequestID, speechText: "", characterState: .confused, haptic: .notification)), now: t0)
        #expect(s.visual == .confused, "no speech means no speaking detour")
        (s, _) = reduce(s, .reactionFinished(requestId: id.uuidString), now: t1)
        #expect(s.visual == .idle)
        #expect(s.activeRequestID == nil)
    }

    // Checkpoint A: adversarial cases missing from the original suite.
    @Test func oldCompletionCannotFinishANewerInteraction() {
        // A was cancelled; B is now speaking. A's late delegate callback
        // must not finish B (the original event API carried no identity).
        let b = state(.thinking, activeRequestID: "request-b")
        let speaking = reduce(b, .response(response(requestId: "request-b", speechText: "B"))).0
        let (next, effects) = reduce(speaking, .speechFinished(requestId: "request-a"))
        #expect(next == speaking)
        #expect(effects.isEmpty)
    }

    @Test func completedIdleResponseClearsRequestIdentity() {
        for speech in ["", "Done"] {
            var s = reduce(state(.thinking, activeRequestID: "req-1"),
                           .response(response(speechText: speech, characterState: .idle))).0
            if !speech.isEmpty { s = reduce(s, .speechFinished(requestId: "req-1")).0 }
            #expect(s.visual == .idle)
            #expect(s.activeRequestID == nil)
        }
    }

    @Test func followUpSurvivesReactionCompletion() {
        let reaction = reduce(state(.thinking, activeRequestID: "req-1"),
                              .response(response(followUpExpected: true))).0
        let idle = reduce(reaction, .reactionFinished(requestId: "req-1")).0
        #expect(idle.visual == .idle)
        #expect(idle.followUpExpected)
        #expect(idle.activeRequestID == nil)
        #expect(!reduce(idle, .userActivated).0.followUpExpected)
        #expect(!reduce(idle, .backgrounded).0.followUpExpected)
    }

    @Test(arguments: ["client/gateway-unavailable.json", "client/disconnected.json"])
    func clientOfflineFixturesResolveToDisconnected(_ path: String) throws {
        let r = try JSONDecoder().decode(TamagoResponse.self, from: FixtureLoader.data(path))
        var s = reduce(state(.thinking, activeRequestID: r.requestId), .response(r)).0
        if s.visual == .speaking { s = reduce(s, .speechFinished(requestId: try #require(r.requestId))).0 }
        #expect(s.visual == .disconnected)
        #expect(s.activeRequestID == nil)
    }

    @Test func duplicateFinalResponseHasNoEffects() {
        let r = response(speechText: "done")
        let speaking = reduce(state(.thinking, activeRequestID: "req-1"), .response(r)).0
        let duplicate = reduce(speaking, .response(r))
        #expect(duplicate.0 == speaking)
        #expect(duplicate.1.isEmpty)
    }

    @Test func oldResponseCannotOverwriteNewRequestAfterBackground() {
        var s = reduce(state(.thinking, activeRequestID: "req-1"), .backgrounded).0
        s = reduce(s, .userActivated).0
        s = reduce(s, .transcript(text: "new", requestId: UUID())).0
        let stale = reduce(s, .response(response()))
        #expect(stale.0 == s)
        #expect(stale.1.isEmpty)
    }

    @Test(arguments: [CharacterEvent.ackBeatElapsed(requestId: "old"),
                      .speechFinished(requestId: "old"), .speechCancelled(requestId: "old"),
                      .reactionFinished(requestId: "old")])
    func staleCompletionsAreIgnoredInEveryState(_ event: CharacterEvent) {
        for visual in TamagoCharacterState.allCases {
            let original = state(visual, activeRequestID: "new")
            let result = reduce(original, event)
            #expect(result.0 == original)
            #expect(result.1.isEmpty)
        }
    }

    @Test func duplicateCompletionCannotResetFollowUpOrReplayReaction() {
        let speaking = reduce(state(.thinking, activeRequestID: "req-1"),
                              .response(response(speechText: "done", followUpExpected: true))).0
        let reaction = reduce(speaking, .speechFinished(requestId: "REQ-1")).0
        #expect(reduce(reaction, .speechFinished(requestId: "req-1")).0 == reaction)
        let idle = reduce(reaction, .reactionFinished(requestId: "REQ-1")).0
        #expect(reduce(idle, .reactionFinished(requestId: "req-1")).0 == idle)
        #expect(idle.followUpExpected)
    }

    @MainActor @Test func controllerKeepsReducerAsItsOnlyStateOwner() {
        let controller = CharacterInteractionController()
        let id = UUID()
        controller.apply(.userActivated, now: t0)
        controller.apply(.transcript(text: "test", requestId: id), now: t0)
        #expect(controller.state.visual == .acknowledging)
        #expect(controller.lastEffects.count == 1)
        let pending = controller.state
        controller.apply(.ackBeatElapsed(requestId: "old"), now: t1)
        #expect(controller.state == pending)
        #expect(controller.lastEffects.isEmpty)
        controller.apply(.backgrounded, now: t1)
        #expect(controller.state == CharacterState.initial.withEnteredAt(t1))
        #expect(controller.lastEffects == [.cancelRequest, .stopSpeech])
        controller.apply(.response(response(requestId: id.uuidString)), now: t1)
        #expect(controller.state == CharacterState.initial.withEnteredAt(t1))
        #expect(controller.lastEffects.isEmpty)
    }

    @Test func illegalTransitionsMatchTheEntireDecisionTable() {
        let ready: Set<TamagoCharacterState> = [.idle, .sleeping, .disconnected, .happy, .success, .confused, .error]
        let waiting: Set<TamagoCharacterState> = [.acknowledging, .thinking, .toolRunning]
        let events: [(CharacterEvent, Set<TamagoCharacterState>)] = [
            (.userActivated, ready), (.wake, [.sleeping]), (.inactivityTimeout, [.idle]),
            (.transcript(text: "test", requestId: UUID()), [.listening]),
            (.ackBeatElapsed(requestId: "req-1"), [.acknowledging]),
            (.toolProgress(requestId: "req-1"), [.thinking]),
            (.response(response()), waiting),
            (.speechFinished(requestId: "req-1"), [.speaking]),
            (.speechCancelled(requestId: "req-1"), [.speaking]),
            (.reactionFinished(requestId: "req-1"), [.happy, .success, .confused, .error]),
            (.routeLost, [.idle, .sleeping]), (.routeRestored, [.disconnected])
        ]
        for (event, allowed) in events {
            for visual in TamagoCharacterState.allCases where !allowed.contains(visual) {
                let original = state(visual, activeRequestID: "req-1", followUpExpected: true)
                let result = reduce(original, event)
                #expect(result.0 == original)
                #expect(result.1.isEmpty)
            }
        }
    }

    // MARK: Determinism

    @Test func reduceIsAPureFunction() {
        let original = state(.thinking, activeRequestID: "req-1")
        let event = CharacterEvent.response(response(requestId: "req-1", speechText: "x"))
        let a = reduce(original, event, now: t1)
        let b = reduce(original, event, now: t1)
        #expect(a.0 == b.0)
        #expect(a.1 == b.1)
    }
}

private extension CharacterState {
    func withEnteredAt(_ date: Date) -> CharacterState {
        var copy = self
        copy.enteredAt = date
        return copy
    }
}
