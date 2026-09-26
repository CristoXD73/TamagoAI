import Foundation
import Testing

/// Locates the shared protocol fixtures in the repository checkout.
///
/// The fixtures are the cross-language contract (the gateway generates and
/// drift-checks them), so the tests read them in place rather than keeping a
/// copy that could go stale. This works on the host and in the simulator,
/// which can read the host file system; it will not work on a physical device.
enum FixtureLoader {
    /// `<repo>/Tests/Fixtures/protocol-v1`, derived from this file's location:
    /// `<repo>/Apple/Shared/Tests/TamagoSharedTests/FixtureLoader.swift`.
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // TamagoSharedTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // Shared
        .deletingLastPathComponent()  // Apple
        .deletingLastPathComponent()  // <repo>
        .appendingPathComponent("Tests/Fixtures/protocol-v1", isDirectory: true)

    struct Manifest: Decodable {
        let protocolVersion: Int
        let fixtures: [Entry]
    }

    struct Entry: Decodable, Sendable, CustomTestStringConvertible {
        let path: String
        let kind: String
        let source: String
        let httpStatus: Int?

        var testDescription: String { path }
    }

    static func data(_ relativePath: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(relativePath))
    }

    static func manifest() throws -> Manifest {
        try JSONDecoder().decode(Manifest.self, from: data("manifest.json"))
    }

    /// Manifest entries for parameterized tests. A missing or unreadable
    /// manifest yields no arguments; `ProtocolFixtureTests.manifestIsComplete`
    /// fails loudly in that case.
    static var entries: [Entry] {
        (try? manifest().fixtures) ?? []
    }

    static func entries(kind: String) -> [Entry] {
        entries.filter { $0.kind == kind }
    }
}
