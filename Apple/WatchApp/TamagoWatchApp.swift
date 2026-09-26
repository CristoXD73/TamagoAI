import SwiftUI
import TamagoShared

/// Phase 3 placeholder. The character view, state machine and debug controls
/// are Sonnet's Stage A (docs/DECISIONS.md D-102, D-103).
@main
struct TamagoWatchApp: App {
    var body: some Scene {
        WindowGroup {
            PlaceholderView()
        }
    }
}

private struct PlaceholderView: View {
    var body: some View {
        VStack(spacing: 4) {
            Text("Tamago")
                .font(.headline)
            Text("protocol v\(TamagoProtocol.version) · \(TamagoCharacterState.idle.rawValue)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}
