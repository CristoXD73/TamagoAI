// PairingScreen.swift
//
// VERIFICATION: UNVERIFIED (written in the cloud, not compiled or rendered).
//
// D-127: the phone pairs with the owner's Mac exactly like the Watch did
// (PROTOCOL_V1 §14): the Mac's address and the 6-digit code it shows. The
// gateway opens one pairing window each time it starts, so a fresh code means
// restarting Tamago on the Mac (scripts/tamago-up.sh); its dashboard shows it.

import SwiftUI

struct PairingScreen: View {
    let model: ChatModel

    @State private var address = ""
    @State private var code = ""
    @State private var isPairing = false
    @State private var failure: String?
    @FocusState private var field: Field?

    private enum Field { case address, code }

    var body: some View {
        ZStack {
            ChatTheme.background.ignoresSafeArea()
            ChatTheme.glow.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 22) {
                    IdleLoopPlayer()
                        .aspectRatio(3.0 / 4.0, contentMode: .fit)
                        .frame(maxHeight: 230)
                        .accessibilityLabel("Tamago, a small white octopus")

                    VStack(spacing: 8) {
                        Text("Meet Tamago on your phone")
                            .font(.system(.title2, design: .rounded).weight(.semibold))
                            .foregroundStyle(ChatTheme.primaryText)
                        Text("Tamago lives on your Watch and thinks on your Mac. Pair this phone with the Mac to read long answers and type to Tamago.")
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(ChatTheme.secondaryText)
                    }

                    VStack(spacing: 12) {
                        field(title: "Mac address", systemImage: "desktopcomputer") {
                            TextField("tamagoai.local", text: $address)
                                .textContentType(.URL)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($field, equals: .address)
                                .submitLabel(.next)
                                .onSubmit { field = .code }
                        }
                        field(title: "Pairing code", systemImage: "number") {
                            TextField("6 digits", text: $code)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                                .focused($field, equals: .code)
                                .onChange(of: code) { code = String(code.filter(\.isNumber).prefix(6)) }
                        }
                    }

                    if let failure {
                        Label(failure, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(ChatTheme.offline)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        Task { await pair() }
                    } label: {
                        HStack(spacing: 8) {
                            if isPairing { ProgressView().tint(.white) }
                            Text(isPairing ? "Pairing…" : "Pair")
                                .font(.headline)
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(ChatTheme.accent))
                        .opacity(code.count == 6 && !isPairing ? 1 : 0.5)
                    }
                    .disabled(code.count != 6 || isPairing)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Where's the code?")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(ChatTheme.primaryText)
                        Text("On the Mac, restart Tamago (scripts/tamago-up.sh). The dashboard at 127.0.0.1:8788 and the terminal show a 6-digit code for 10 minutes. Leave the address empty to use tamagoai.local, or type the Mac's IP address.")
                            .font(.footnote)
                            .foregroundStyle(ChatTheme.secondaryText)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(ChatTheme.surface))
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func field<Content: View>(title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(ChatTheme.secondaryText)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(ChatTheme.secondaryText)
                content()
                    .font(.body)
                    .foregroundStyle(ChatTheme.primaryText)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(ChatTheme.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(ChatTheme.hairline))
    }

    private func pair() async {
        isPairing = true
        failure = nil
        field = nil
        failure = await model.pair(address: address, code: code)
        isPairing = false
    }
}
