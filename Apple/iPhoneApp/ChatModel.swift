// ChatModel.swift
//
// VERIFICATION: UNVERIFIED (written in the cloud, not compiled or run).
//
// D-127: the iPhone is where Tamago's words land. The brain stays on the Mac;
// the Watch stays the creature. This model pairs the phone with the same Mac
// (PROTOCOL_V1 §14), reads the conversation (§18) while the app is in front,
// and sends typed messages as ordinary requests (`client.device = "phone"`).
// Long answers the Watch offered ("check your phone") arrive here as the same
// turn filling in. Nothing is stored on the phone except the pairing.

import Foundation
import Observation
import Security
import TamagoShared

@MainActor
@Observable
final class ChatModel {
    enum Link: Equatable {
        case unpaired
        case connecting
        case online
        case offline(String)
    }

    /// A typed message on its way to the Mac (replaced by its turn once the Mac records it).
    struct Outgoing: Identifiable, Equatable {
        let id: String          // the request ID
        let text: String
        let sentAt: Date
        var failed = false
    }

    private(set) var turns: [TamagoConversationTurn] = []
    private(set) var outgoing: [Outgoing] = []
    private(set) var link: Link = .unpaired
    private(set) var gatewayName: String?
    /// While offline: what to do about it (owner, 2026-09-29: sending into the void made it look like a slow Mac).
    private(set) var offlineHelp: String?
    /// The Mac answers but refuses this phone: only pairing again fixes it.
    private(set) var needsRepair = false
    var draft = ""

    @ObservationIgnored private var client: GatewayClient?
    @ObservationIgnored private var latest = 0
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    init() {
        if let record = PairingStore.load() { configure(record) }
    }

    var isPaired: Bool { client != nil }
    var isEmpty: Bool { turns.isEmpty && outgoing.isEmpty }
    /// A typed message is waiting for its answer (show Tamago "typing").
    var isWaitingForReply: Bool { outgoing.contains { !$0.failed } }
    /// Only while the Mac is actually answering: a message typed into a dead link would sit there looking "slow".
    var canSend: Bool { isPaired && link == .online && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var isOffline: Bool { if case .offline = link { true } else { false } }

    // MARK: Pairing

    /// Pairs with the Mac. Returns nil on success, else a short reason to show.
    func pair(address: String, code: String) async -> String? {
        guard let url = Self.baseURL(from: address) else { return "That address doesn't look right." }
        let digits = code.filter(\.isNumber)
        guard digits.count == 6 else { return "The code has 6 digits." }
        let probe = GatewayClient(configuration: GatewayConfiguration(baseURL: url))
        switch await probe.pair(code: digits, deviceName: "iPhone") {
        case let .paired(grant):
            let record = PairingRecord(baseURL: url, token: grant.token, gatewayId: grant.gatewayId,
                                       gatewayName: grant.gatewayName, pairedAt: .now)
            let status = PairingStore.save(record)
            guard status == errSecSuccess else { return "Couldn't save the pairing (\(status))." }
            configure(record)
            turns = []
            latest = 0
            start()
            return nil
        case .wrongCode:
            return "That code didn't match. Check the Mac and try again."
        case .closed:
            return "That code is used up or expired. Press New pairing code on the Mac's dashboard."
        case let .unreachable(reason):
            return reason
        }
    }

    func unpair() {
        stop()
        PairingStore.clear()
        client = nil
        gatewayName = nil
        turns = []
        outgoing = []
        latest = 0
        link = .unpaired
        offlineHelp = nil
        needsRepair = false
    }

    /// "tamagoai.local", "192.168.0.74", "http://mac.local:8787" → a gateway base URL (http, port 8787 by default).
    nonisolated static func baseURL(from raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return GatewayConfiguration.wellKnownBaseURL }
        if !s.contains("://") { s = "http://" + s }
        guard var components = URLComponents(string: s), let host = components.host, !host.isEmpty,
              components.scheme == "http" || components.scheme == "https" else { return nil }
        if components.port == nil { components.port = 8787 }
        components.path = ""
        components.query = nil
        return components.url
    }

    private func configure(_ record: PairingRecord) {
        client = GatewayClient(configuration: GatewayConfiguration(
            baseURL: record.baseURL, authToken: record.token, requestTimeout: 30, expectedGatewayId: record.gatewayId))
        gatewayName = record.gatewayName
        link = .connecting
    }

    // MARK: Conversation

    /// Polls while the app is in front: quickly while something is on its way, gently otherwise.
    func start() {
        guard client != nil, pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                let busy = self.isWaitingForReply || self.turns.contains { $0.long?.status == "pending" }
                try? await Task.sleep(for: .seconds(busy ? 1.5 : 4))
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        guard let client else { return }
        guard let page = await client.conversation(after: latest) else {
            await diagnose(client)
            return
        }
        link = .online
        offlineHelp = nil
        needsRepair = false
        if page.latest < latest {
            // The Mac restarted (the conversation lives in its memory): start over from what it has.
            turns = []
            latest = 0
            if let full = await client.conversation(after: 0) { merge(full) }
            return
        }
        merge(page)
    }

    /// Why the conversation didn't load, in words the owner can act on.
    private func diagnose(_ client: GatewayClient) async {
        let mac = gatewayName ?? "your Mac"
        let network = "This phone has to be on the same Wi-Fi as the Mac. If it is, turn on Settings › Privacy & Security › Local Network › Tamago."
        switch await client.probe() {
        case .reachable:
            // Tamago answers, but not to this phone's token: its pairing was reset or replaced.
            link = .offline("\(mac) doesn't recognise this phone")
            offlineHelp = "Pair again with a new code from the dashboard on the Mac."
            needsRepair = true
        case .wrongGateway:
            link = .offline("A different Tamago answered")
            offlineHelp = "Pair again with the Mac you want."
            needsRepair = true
        case .notFound:
            link = .offline("Can't find \(mac) on this network")
            offlineHelp = network
            needsRepair = false
        case .unreachable:
            link = .offline("Can't reach \(mac)")
            offlineHelp = "\(network) Also check Tamago is running on the Mac."
            needsRepair = false
        }
    }

    private func merge(_ page: TamagoConversationPage) {
        for turn in page.turns {
            if let i = turns.firstIndex(where: { $0.seq == turn.seq }) {
                turns[i] = turn
            } else {
                turns.append(turn)
            }
        }
        turns.sort { $0.seq < $1.seq }
        latest = max(latest, page.latest)
        outgoing.removeAll { message in turns.contains { $0.requestId.caseInsensitiveCompare(message.id) == .orderedSame } }
    }

    func send(_ text: String? = nil) async {
        let message = (text ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, let client, link == .online else { return }
        if text == nil { draft = "" }
        let request = TamagoRequest(text: String(message.prefix(2000)),
                                    client: TamagoClientInfo(device: "phone", route: "direct", appVersion: Self.appVersion))
        outgoing.append(Outgoing(id: request.requestId, text: message, sentAt: .now))
        let exchange = await client.exchange(request)
        if exchange.reachedGateway {
            link = .online
        } else {
            if let i = outgoing.firstIndex(where: { $0.id == request.requestId }) { outgoing[i].failed = true }
            await diagnose(client)
        }
        await refresh()
    }

    func retry(_ message: Outgoing) async {
        outgoing.removeAll { $0.id == message.id }
        await send(message.text)
    }

    func discard(_ message: Outgoing) {
        outgoing.removeAll { $0.id == message.id }
    }

    /// Clears the conversation on the Mac (and here).
    func clearConversation() async {
        guard let client else { return }
        if await client.clearConversation() {
            turns = []
            outgoing = []
        }
    }

    private static let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
}
