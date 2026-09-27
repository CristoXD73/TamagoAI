// PairingView.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY (pairing against a live LAN-mode
// gateway, see docs/HANDOFF_LOG.md). Not DEVICE_VERIFIED.
//
// First-run setup, not creature UI (D-116): shown as a sheet only when the
// Watch has no pairing — on first activation, or when someone tries to talk
// to an unpaired Tamago. Plain system controls; no character art, nothing
// permanent on the creature screen. Its placement is pending owner review.

import SwiftUI
import TamagoShared

struct PairingView: View {
    var connection: TamagoConnection
    @Environment(\.dismiss) private var dismiss
    @State private var status: String?
    @State private var isPairing = false
    /// Set when the owner types the Mac's address: some networks (or the
    /// Watch's route through the iPhone) can't resolve `tamagoai.local`.
    @State private var address: URL?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Pair with your Mac").font(.headline)
                Text("Start the TamagoAI gateway on your Mac. Enter the 6-digit code it shows.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextFieldLink("Enter code", prompt: Text("123 456")) { code in
                    Task { await pair(code) }
                }
                .disabled(isPairing)
                TextFieldLink(address.map { "Mac: \($0.host ?? "")" } ?? "Use Mac address", prompt: Text("192.168.0.74")) { input in
                    address = GatewayConfiguration.manualBaseURL(from: input)
                    status = address == nil ? "That address doesn't look right." : "Now enter the code."
                }
                .font(.footnote)
                .disabled(isPairing)
                if let status {
                    Text(status).font(.footnote)
                }
                Button("Not now", role: .cancel) { dismiss() }
            }
        }
    }

    private func pair(_ code: String) async {
        isPairing = true
        status = "Pairing…"
        let outcome = await connection.pair(code: code, address: address)
        isPairing = false
        switch outcome {
        case let .paired(grant):
            status = "Paired with \(grant.gatewayName)."
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        case .wrongCode:
            status = "That code didn't match. Check the Mac and try again."
        case .closed:
            status = "The Mac isn't accepting pairing. Restart the gateway for a new code."
        case let .unreachable(reason):
            status = "Couldn't reach your Mac. \(reason)."
        }
    }
}
