// ChatView.swift
//
// VERIFICATION: UNVERIFIED (written in the cloud, not compiled or rendered).
//
// D-127: where Tamago's words land on the phone. Everything said to Tamago, on
// the Watch or here, shows as one conversation; a long answer the Watch offered
// ("check your phone") fills in under its short spoken version. The creature
// itself stays on the Watch: here it's only the approved idle loop (Visual
// Approval Gate #12) in the empty state and a still avatar. The typing dots and
// the "writing" shimmer are interface motion, not character motion.

import SwiftUI
import TamagoShared

struct ChatView: View {
    @Bindable var model: ChatModel
    @FocusState private var composerFocused: Bool
    @State private var confirmClear = false

    var body: some View {
        ZStack(alignment: .top) {
            ChatTheme.background.ignoresSafeArea()
            ChatTheme.glow.ignoresSafeArea()

            ScrollViewReader { proxy in
                ScrollView {
                    if model.isEmpty {
                        EmptyChat { suggestion in Task { await model.send(suggestion) } }
                            .padding(.top, 24)
                    } else {
                        // One snapshot per render: rows never index into a list that has since changed
                        // (the conversation empties when the Mac restarts; that crashed, 2026-09-28).
                        let turns = model.turns
                        LazyVStack(alignment: .leading, spacing: 18) {
                            ForEach(Array(turns.enumerated()), id: \.element.seq) { index, turn in
                                if let label = Self.timeLabel(for: index, in: turns) {
                                    TimeDivider(label: label)
                                }
                                TurnView(turn: turn)
                                    .id("turn-\(turn.seq)")
                            }
                            ForEach(model.outgoing) { message in
                                OutgoingView(message: message,
                                             retry: { Task { await model.retry(message) } },
                                             discard: { model.discard(message) })
                                    .id("out-\(message.id)")
                            }
                            if model.isWaitingForReply {
                                TypingIndicator().id("typing")
                            }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 8)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await model.refresh() }
                .onChange(of: model.turns) { scrollToBottom(proxy) }
                .onChange(of: model.outgoing) { scrollToBottom(proxy) }
                .onChange(of: composerFocused) { if composerFocused { scrollToBottom(proxy) } }
                .onAppear { scrollToBottom(proxy, animated: false) }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            ChatHeader(model: model, confirmClear: $confirmClear)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // No typing into a dead link: say what's wrong and how to fix it instead (owner, 2026-09-29).
            if model.isOffline {
                OfflinePanel(model: model)
            } else {
                Composer(model: model, focused: $composerFocused)
            }
        }
        .confirmationDialog("Clear the conversation on your Mac?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear", role: .destructive) { Task { await model.clearConversation() } }
        } message: {
            Text("Tamago's memories stay. Only this chat history goes.")
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        guard !model.isEmpty else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) }
        } else {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    /// A quiet time label before the first turn and after a gap of 10+ minutes.
    private static func timeLabel(for index: Int, in turns: [TamagoConversationTurn]) -> String? {
        guard turns.indices.contains(index), let date = turns[index].date else { return nil }
        if index > 0, let previous = turns[index - 1].date, date.timeIntervalSince(previous) < 600 { return nil }
        let calendar = Calendar.current
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDateInToday(date) { return "Today \(time)" }
        if calendar.isDateInYesterday(date) { return "Yesterday \(time)" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Header

private struct ChatHeader: View {
    let model: ChatModel
    @Binding var confirmClear: Bool

    var body: some View {
        HStack(spacing: 12) {
            TamagoAvatar(size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text("Tamago")
                    .font(.headline)
                    .foregroundStyle(ChatTheme.primaryText)
                HStack(spacing: 6) {
                    Circle().fill(statusColor).frame(width: 7, height: 7)
                    Text(statusText)
                        .font(.caption)
                        .foregroundStyle(ChatTheme.secondaryText)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 8)
            Menu {
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                Button("Clear conversation", systemImage: "trash", role: .destructive) { confirmClear = true }
                Divider()
                Button("Unpair from \(model.gatewayName ?? "Mac")", systemImage: "link.badge.plus") { model.unpair() }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(ChatTheme.primaryText)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(ChatTheme.surface))
            }
            .accessibilityLabel("More")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial.opacity(0.9))
        .overlay(alignment: .bottom) { ChatTheme.hairline.frame(height: 0.5) }
    }

    private var statusColor: Color {
        switch model.link {
        case .online: ChatTheme.online
        case .offline: ChatTheme.offline
        case .connecting, .unpaired: ChatTheme.secondaryText
        }
    }

    private var statusText: String {
        switch model.link {
        case .online: "Connected to your Mac"
        case let .offline(reason): reason
        case .connecting: "Connecting…"
        case .unpaired: "Not paired"
        }
    }
}

// MARK: - Turns

/// One exchange: the owner's words, then Tamago's (or a note about a long answer).
private struct TurnView: View {
    let turn: TamagoConversationTurn

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !turn.you.isEmpty {
                OwnerBubble(text: turn.you, fromWatch: turn.from == "watch")
            }
            if let note = turn.note {
                NoteLine(text: note == "read_aloud" ? "Read aloud on your Watch" : "Saved here for you", systemImage: note == "read_aloud" ? "applewatch.radiowaves.left.and.right" : "iphone")
            } else if let error = turn.error {
                TamagoRow {
                    Label(Self.describe(error), systemImage: "exclamationmark.triangle")
                        .font(.subheadline)
                        .foregroundStyle(ChatTheme.danger)
                }
            } else if !turn.tamago.isEmpty {
                TamagoRow {
                    VStack(alignment: .leading, spacing: 10) {
                        if turn.long?.status == "ready" {
                            FullAnswerTag()
                        }
                        MarkdownText(turn.tamago)
                        switch turn.long?.status ?? "" {
                        case "pending": WritingIndicator()
                        case "failed":
                            Text("Couldn't finish the full answer. Ask again anytime.")
                                .font(.footnote)
                                .foregroundStyle(ChatTheme.secondaryText)
                        default: EmptyView()
                        }
                    }
                }
            }
        }
    }

    static func describe(_ code: String) -> String {
        switch code {
        case "timeout": "Tamago took too long to think. Try again?"
        case "provider_unavailable": "Tamago's brain isn't running on the Mac."
        default: "Tamago couldn't answer that one."
        }
    }
}

private struct OwnerBubble: View {
    let text: String
    var fromWatch = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if fromWatch {
                Label("Said on your Watch", systemImage: "applewatch")
                    .font(.caption2)
                    .foregroundStyle(ChatTheme.secondaryText)
                    .labelStyle(.titleAndIcon)
            }
            Text(text)
                .font(.body)
                .foregroundStyle(.white)
                .padding(.horizontal, 15)
                .padding(.vertical, 10)
                .background(ChatTheme.accent, in: RoundedRectangle(cornerRadius: ChatTheme.bubbleRadius, style: .continuous))
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 48)
    }
}

/// Tamago's words: no bubble, just text beside the avatar (easier to read long answers).
private struct TamagoRow<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            TamagoAvatar(size: 28)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 3)
        }
        .padding(.trailing, 12)
    }
}

/// Renders the light markdown Tamago's long answers use (bold, italics, lists as lines).
private struct MarkdownText: View {
    let source: String
    init(_ source: String) { self.source = source }

    var body: some View {
        Text(attributed)
            .font(.body)
            .foregroundStyle(ChatTheme.primaryText)
            .lineSpacing(4)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var attributed: AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
    }
}

private struct FullAnswerTag: View {
    var body: some View {
        Label("Full answer", systemImage: "text.alignleft")
            .font(.caption.weight(.semibold))
            .foregroundStyle(ChatTheme.secondaryText)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(Capsule().fill(ChatTheme.surface))
    }
}

private struct NoteLine: View {
    let text: String
    let systemImage: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(ChatTheme.secondaryText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
    }
}

private struct TimeDivider: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.caption2.weight(.medium))
            .foregroundStyle(ChatTheme.secondaryText)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
    }
}

private struct OutgoingView: View {
    let message: ChatModel.Outgoing
    let retry: () -> Void
    let discard: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            OwnerBubble(text: message.text)
                .opacity(message.failed ? 0.55 : 1)
            if message.failed {
                HStack(spacing: 14) {
                    Button("Retry", action: retry)
                    Button("Delete", role: .destructive, action: discard)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(ChatTheme.offline)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }
}

// MARK: - Waiting signs (interface motion only)

private struct TypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TamagoRow {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                HStack(spacing: 5) {
                    ForEach(0..<3) { i in
                        Circle()
                            .fill(ChatTheme.secondaryText)
                            .frame(width: 7, height: 7)
                            .opacity(reduceMotion ? 0.7 : 0.35 + 0.65 * max(0, sin((t * 4) - Double(i) * 0.7)))
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .accessibilityLabel("Tamago is thinking")
    }
}

private struct WritingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
            let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
            Label("Writing the full answer…", systemImage: "sparkles")
                .font(.footnote.weight(.medium))
                .foregroundStyle(ChatTheme.secondaryText)
                .overlay {
                    if !reduceMotion {
                        LinearGradient(colors: [.clear, .white.opacity(0.55), .clear],
                                       startPoint: UnitPoint(x: phase * 2 - 0.6, y: 0.5),
                                       endPoint: UnitPoint(x: phase * 2 - 0.1, y: 0.5))
                            .mask {
                                Label("Writing the full answer…", systemImage: "sparkles")
                                    .font(.footnote.weight(.medium))
                            }
                    }
                }
        }
        .accessibilityLabel("Tamago is writing the full answer")
    }
}

// MARK: - Empty state

private struct EmptyChat: View {
    let onSuggestion: (String) -> Void

    private static let suggestions = [
        "What can you do?",
        "Tell me something strange about octopuses",
        "How do I make sourdough?",
    ]

    var body: some View {
        VStack(spacing: 18) {
            IdleLoopPlayer()
                .aspectRatio(3.0 / 4.0, contentMode: .fit)
                .frame(maxHeight: 250)
                .accessibilityLabel("Tamago, a small white octopus")
            VStack(spacing: 8) {
                Text("Hi, I'm Tamago.")
                    .font(.system(.title, design: .rounded).weight(.semibold))
                    .foregroundStyle(ChatTheme.primaryText)
                Text("Hold me on your Watch to talk. When an answer is too long to say out loud, it lands here. You can type to me too.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(ChatTheme.secondaryText)
                    .padding(.horizontal, 28)
            }
            VStack(spacing: 10) {
                ForEach(Self.suggestions, id: \.self) { suggestion in
                    Button { onSuggestion(suggestion) } label: {
                        Text(suggestion)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(ChatTheme.primaryText)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .frame(maxWidth: 320)
                            .background(Capsule().fill(ChatTheme.surface))
                            .overlay(Capsule().strokeBorder(ChatTheme.hairline))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
    }
}

// MARK: - Offline

private struct OfflinePanel: View {
    let model: ChatModel
    @State private var checking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "wifi.exclamationmark")
                    .foregroundStyle(ChatTheme.offline)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ChatTheme.primaryText)
            }
            if let help = model.offlineHelp {
                Text(help)
                    .font(.footnote)
                    .foregroundStyle(ChatTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Button {
                    checking = true
                    Task { await model.refresh(); checking = false }
                } label: {
                    Label(checking ? "Checking…" : "Try again", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(checking)
                Button {
                    model.unpair()
                } label: {
                    Label("Pair again", systemImage: "link")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(model.needsRepair ? Color(red: 0.36, green: 0.4, blue: 0.97) : ChatTheme.surface)
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(16)
        .background(.ultraThinMaterial.opacity(0.9))
        .overlay(alignment: .top) { ChatTheme.hairline.frame(height: 0.5) }
    }

    private var title: String {
        if case let .offline(reason) = model.link { return "\(reason). Messages can't be sent right now." }
        return "Messages can't be sent right now."
    }
}

// MARK: - Composer

private struct Composer: View {
    @Bindable var model: ChatModel
    var focused: FocusState<Bool>.Binding

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message Tamago", text: $model.draft, axis: .vertical)
                .lineLimit(1...6)
                .font(.body)
                .foregroundStyle(ChatTheme.primaryText)
                .tint(Color(red: 0.45, green: 0.6, blue: 1))
                .focused(focused)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous).fill(ChatTheme.surface)
                )
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(ChatTheme.hairline))

            Button {
                Task { await model.send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background {
                        if model.canSend {
                            Circle().fill(ChatTheme.accent)
                        } else {
                            Circle().fill(ChatTheme.surface)
                        }
                    }
            }
            .disabled(!model.canSend)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(.ultraThinMaterial.opacity(0.9))
        .overlay(alignment: .top) { ChatTheme.hairline.frame(height: 0.5) }
    }
}
