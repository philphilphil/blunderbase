import SwiftUI
import UIKit
import XCTest
@testable import Blunderbase

/// The palette is two palettes now, and the thing that can break silently is the wiring
/// rather than any single hex: a token written as one value still compiles, still looks
/// right in the dark, and is only wrong on somebody else's phone. So these tests resolve
/// tokens against both trait collections and check the pairs the light theme is *supposed*
/// to move — and the two that it is supposed to leave alone.
///
/// The values come from `web/src/index.css`: `:root` for dark, `:root.light` for light.
/// Pinning a handful of them here is what would catch a copy that drifted from the web's.
final class ThemeTests: XCTestCase {

    // MARK: The mechanism

    func testATokenResolvesToADifferentColourInEachTheme() {
        XCTAssertEqual(hex(Theme.void, .dark), 0x1D1E1F)
        XCTAssertEqual(hex(Theme.void, .light), 0xE7E7E4)
        XCTAssertEqual(hex(Theme.surface, .dark), 0x232424)
        XCTAssertEqual(hex(Theme.surface, .light), 0xFAFAF8)
    }

    func testTheAccentIsDarkenedForTheLightGround() {
        XCTAssertEqual(hex(Theme.accent, .dark), 0x83B7E3)
        XCTAssertEqual(hex(Theme.accent, .light), 0x245F9E)
    }

    /// The ramp is inverted by contrast rank, not by hue: the brightest text token in the
    /// dark is the darkest in the light, and the quiet body text sits between the two in
    /// both. A token copied from the wrong end of the CSS ramp shows up here.
    func testTheTextRampInvertsByContrastRank() {
        XCTAssertGreaterThan(luminance(Theme.textBright, .dark), luminance(Theme.body, .dark))
        XCTAssertLessThan(luminance(Theme.textBright, .light), luminance(Theme.body, .light))
        XCTAssertLessThan(luminance(Theme.text, .light), luminance(Theme.void, .light))
    }

    /// The board is slate in both themes, and both squares move — the light board is a
    /// paler slate rather than the same one. The pair keeps its order either way.
    func testBoardSquaresHaveTheirOwnLightPair() {
        XCTAssertEqual(hex(Theme.boardLight, .dark), 0xA9B2B8)
        XCTAssertEqual(hex(Theme.boardLight, .light), 0xD8DDE0)
        XCTAssertEqual(hex(Theme.boardDark, .dark), 0x616D75)
        XCTAssertEqual(hex(Theme.boardDark, .light), 0x8F9DA5)
        XCTAssertGreaterThan(luminance(Theme.boardLight, .light), luminance(Theme.boardDark, .light))
    }

    /// The played-move arrow is the hueless one, so it is also the one that flips furthest:
    /// near-white on a dark board, near-black on a light one.
    func testThePlayedArrowFlipsRatherThanTakingATint() {
        XCTAssertEqual(hex(Theme.arrowPlayed, .dark), 0xF1F1F1)
        XCTAssertEqual(hex(Theme.arrowPlayed, .light), 0x2F2F2F)
    }

    /// Ink is the text put *on* a filled semantic surface. In the dark those fills are pale
    /// and the ink is near-black; in the light they are saturated and the ink is white. Get
    /// this one backwards and a blunder badge is unreadable in exactly one theme.
    func testSemanticInksBecomeWhiteInTheLightTheme() {
        XCTAssertEqual(hex(Theme.blunderInk, .dark), 0x2A0F0D)
        XCTAssertEqual(hex(Theme.blunderInk, .light), 0xFFFFFF)
        XCTAssertEqual(hex(Theme.accentInk, .light), 0xFFFFFF)
        XCTAssertEqual(hex(Theme.goodInk, .light), 0xFFFFFF)
    }

    // MARK: What must *not* move

    /// The two sides are drawn as themselves, not as surfaces: White is the lighter of the
    /// pair in both themes. If these ever inverted with the ramp, the eval bar would say
    /// Black was winning.
    func testTheTwoSidesDoNotSwapWithTheTheme() {
        XCTAssertGreaterThan(luminance(Theme.sideWhite, .dark), luminance(Theme.sideBlack, .dark))
        XCTAssertGreaterThan(luminance(Theme.sideWhite, .light), luminance(Theme.sideBlack, .light))
    }

    /// A pair whose two themes differ in alpha rather than only in hue — the coordinate on
    /// a dark square goes to full white at a higher opacity, because the light board's dark
    /// square is paler than the dark board's.
    func testCoordinateInkChangesItsOpacityNotItsSide() {
        XCTAssertEqual(alpha(Theme.coordOnDark, .dark), 0.45, accuracy: 0.01)
        XCTAssertEqual(alpha(Theme.coordOnDark, .light), 0.8, accuracy: 0.01)
    }

    // MARK: The preference

    func testAppearanceMapsOntoAColorScheme() {
        XCTAssertNil(Preferences.Appearance.system.colorScheme)
        XCTAssertEqual(Preferences.Appearance.dark.colorScheme, .dark)
        XCTAssertEqual(Preferences.Appearance.light.colorScheme, .light)
    }

    /// Unset and unparseable both mean "follow the phone" — the default is `system` rather
    /// than the first case, which is what a plain `?? .allCases[0]` would have given.
    func testAnUnreadableStoredAppearanceFallsBackToSystem() {
        let defaults = UserDefaults.standard
        let previous = defaults.string(forKey: Preferences.Key.appearance)
        defer {
            if let previous {
                defaults.set(previous, forKey: Preferences.Key.appearance)
            } else {
                defaults.removeObject(forKey: Preferences.Key.appearance)
            }
        }

        defaults.removeObject(forKey: Preferences.Key.appearance)
        XCTAssertEqual(Preferences.appearance, .system)

        defaults.set("sepia", forKey: Preferences.Key.appearance)
        XCTAssertEqual(Preferences.appearance, .system)

        defaults.set("light", forKey: Preferences.Key.appearance)
        XCTAssertEqual(Preferences.appearance, .light)
    }

    // MARK: Resolution

    /// What the token is on a phone whose interface style is `style`. The tokens are dynamic
    /// `UIColor`s under the SwiftUI `Color`, so this is the same resolution UIKit does when
    /// it draws them, rather than a re-implementation of the rule under test.
    private func components(
        _ color: Color,
        _ style: UIUserInterfaceStyle
    ) -> (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) {
        let resolved = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        resolved.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (r, g, b, a)
    }

    private func hex(_ color: Color, _ style: UIUserInterfaceStyle) -> UInt32 {
        let c = components(color, style)
        let channel = { (value: CGFloat) in UInt32((value * 255).rounded()) }
        return channel(c.r) << 16 | channel(c.g) << 8 | channel(c.b)
    }

    /// Rough perceived brightness — enough to say which of two tokens is the lighter one,
    /// which is all these tests ask of it.
    private func luminance(_ color: Color, _ style: UIUserInterfaceStyle) -> CGFloat {
        let c = components(color, style)
        return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    }

    private func alpha(_ color: Color, _ style: UIUserInterfaceStyle) -> CGFloat {
        components(color, style).a
    }
}
