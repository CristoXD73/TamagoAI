// HapticPlayer.swift
//
// VERIFICATION: SIMULATOR_VERIFIED_ONLY that the call is reached with no
// crash (the simulator does not produce felt haptic output, so the actual
// sensation is UNVERIFIED, DEVICE_VERIFIED-pending).
//
// The one native-API executor for CharacterEffect.playHaptic. TamagoHaptic
// (Apple/Shared/TamagoProtocolV1.swift) is already the project's semantic
// haptic vocabulary — driven by protocol responses, not invented per-feature —
// so this is a direct 1:1 map onto WKHapticType rather than a second
// abstraction layered on top of it.

import WatchKit
import TamagoShared

enum HapticPlayer {
    @MainActor static func play(_ haptic: TamagoHaptic) {
        guard let type = wkHapticType(for: haptic) else { return }
        WKInterfaceDevice.current().play(type)
    }

    private static func wkHapticType(for haptic: TamagoHaptic) -> WKHapticType? {
        switch haptic {
        case .none: return nil
        case .click: return .click
        case .success: return .success
        case .failure: return .failure
        case .notification: return .notification
        case .retry: return .retry
        }
    }
}
