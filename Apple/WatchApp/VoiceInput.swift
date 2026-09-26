// VoiceInput.swift
//
// VERIFICATION: see docs/DECISIONS.md D-116 for exactly what was observed in
// the simulator. Actual *dictation* is UNVERIFIED — the simulator has no
// speech input; only the system input sheet and the text path it returns
// were exercised there.
//
// D-106's V1 voice input: the system text-input controller in `.plain` mode
// ("text from dictation + suggestions"), which goes straight to dictation on
// a device. Public, non-deprecated WatchKit API, called programmatically so
// the talk trigger can be "hold anywhere" (CREATURE_SPEC §4) rather than a
// visible text field. It covers the creature while it's up — accepted for V1
// by D-106. No custom microphone pipeline: Speech.framework doesn't exist in
// the watchOS 27 SDK, and raw audio capture would need protocol v2.

import WatchKit

enum VoiceInput {
    /// Presents system dictation. `completion` gets the trimmed text, or `nil`
    /// if the user cancelled. Returns `false` if there was no interface
    /// controller to present from (the caller must then cancel listening).
    @MainActor
    static func present(completion: @escaping @MainActor (String?) -> Void) -> Bool {
        let app = WKApplication.shared()
        guard let controller = app.visibleInterfaceController ?? app.rootInterfaceController else { return false }
        controller.presentTextInputController(withSuggestions: debugSuggestions, allowedInputMode: .plain) { results in
            let text = (results?.first as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            Task { @MainActor in completion(text?.isEmpty == false ? text : nil) }
        }
        return true
    }

    /// `nil` in Release, and in DEBUG unless launched with
    /// `SIMCTL_CHILD_TAMAGO_DEBUG_SUGGESTIONS="ping,state happy"`. The
    /// simulator has no dictation and its keystroke injection doesn't reach
    /// the Scribble canvas, so tapping a suggestion is how a simulator run
    /// exercises the real system sheet → returned text → request path.
    private static var debugSuggestions: [String]? {
        #if DEBUG
        ProcessInfo.processInfo.environment["TAMAGO_DEBUG_SUGGESTIONS"]?
            .split(separator: ",").map { String($0) }
        #else
        nil
        #endif
    }
}
