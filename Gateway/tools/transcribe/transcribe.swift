// transcribe <audio-file> [locale]
//
// On-device speech-to-text for POST /v1/audio (PROTOCOL_V1 §15, D-120), using
// Apple's SpeechAnalyzer/SpeechTranscriber (macOS 26+). Prints the transcript
// on stdout; exit 1 with a reason on stderr. No network, no npm dependency:
// the gateway runs this compiled helper (`npm run build:transcriber`).
//
// VERIFICATION: run on the owner's Mac (macOS 27, en_CA model installed):
// `say`-generated "What's my dog's name?" → exact transcript in ~1.4 s, no
// permission prompt. Real Watch recordings: UNVERIFIED.

import AVFAudio
import Foundation
import Speech

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(Data("usage: transcribe <audio-file> [locale]\n".utf8))
    exit(2)
}
let locale = Locale(identifier: args.count > 2 ? args[2] : "en_CA")

do {
    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[1]))
    let collect = Task { () -> String in
        var text = ""
        for try await result in transcriber.results { text += String(result.text.characters) }
        return text
    }
    if let end = try await analyzer.analyzeSequence(from: file) {
        try await analyzer.finalizeAndFinish(through: end)
    } else {
        await analyzer.cancelAndFinishNow()
    }
    print(try await collect.value.trimmingCharacters(in: .whitespacesAndNewlines))
} catch {
    FileHandle.standardError.write(Data("transcribe failed: \(error)\n".utf8))
    exit(1)
}
