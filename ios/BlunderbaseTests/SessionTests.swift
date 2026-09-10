import XCTest
@testable import Blunderbase

/// The one server the app knows by name: the public demo.
///
/// It is what the App Store reviewer connects to, so the address has to survive the same
/// normalisation a typed one does and be recognised once stored — otherwise the reviewer
/// signs out and meets a password field for a server that has no password.
@MainActor
final class SessionTests: XCTestCase {

    func testTheDemoAddressIsAServerAddress() {
        XCTAssertEqual(
            Session.normalisedURL(from: Session.demoURL.absoluteString),
            Session.demoURL,
            "the demo goes through the same door as a typed address and comes out unchanged"
        )
    }

    func testTheDemoIsRecognisedOnceStored() async throws {
        let suite = "SessionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let session = Session(defaults: defaults)
        XCTAssertFalse(session.isDemoServer)

        // The connect stores the address before the network answers, which is what the
        // property reads; a demo that is unreachable right now is still the demo.
        await session.connectToDemo()
        XCTAssertEqual(session.serverURL, Session.demoURL)
        XCTAssertTrue(session.isDemoServer)
        XCTAssertEqual(defaults.string(forKey: Session.serverURLKey), Session.demoURL.absoluteString)
    }
}
