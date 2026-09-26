import SwiftUI
import TamagoShared

/// Phase 3 placeholder. Gateway configuration, Keychain token and the
/// WatchConnectivity relay come in Phase 10 (docs/DECISIONS.md D-108, D-109).
@main
struct TamagoPhoneApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 8) {
                Text("Apple Tamago")
                    .font(.title2)
                Text("Companion · protocol v\(TamagoProtocol.version)")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
