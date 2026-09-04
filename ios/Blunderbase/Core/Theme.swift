import SwiftUI
import UIKit

/// The Blunderbase palette, lifted from `web/src/index.css`.
///
/// The web app's rule is that no component names a hex: every colour is a `--bb-*` token
/// with a semantic alias. This file is the phone's copy of that rule — it is the only
/// place in the iOS app that writes a hex, and every view reads a name from here.
///
/// Every token carries both themes, `dark:` first because dark is the design's flagship
/// look and the value the web's `:root` holds; `light:` is the same name's value under
/// `:root.light`. The light set is not a second palette but the same ramp inverted by
/// contrast rank, so a token that was the quietest label in the dark is still the quietest
/// label in the light — which is why a view never asks which theme it is in. `Color(light:
/// dark:)` at the bottom of this file resolves that per trait collection, so the tokens
/// stay `static let` and a view keeps writing `Theme.void`.
///
/// One deliberate difference from the web: the web reads its design file at 120% zoom and
/// writes every length as `px / 16` rem. iOS points are not rem, and a phone is held
/// closer than a monitor, so the sizes in `Metrics` are chosen for the phone rather than
/// converted. The colours are copied exactly.
enum Theme {

    // MARK: Surfaces

    static let void = Color(dark: 0x1D1E1F, light: 0xE7E7E4)        // app ground
    static let panel = Color(dark: 0x292A2A, light: 0xF2F2F0)       // chrome: bars, pane titles
    static let surface = Color(dark: 0x232424, light: 0xFAFAF8)     // content canvas
    static let surface2 = Color(dark: 0x212222, light: 0xF7F7F5)
    static let elevated = Color(dark: 0x303131, light: 0xF4F4F1)    // chips, inputs, buttons
    static let elevated2 = Color(dark: 0x2B2C2C, light: 0xF7F7F5)   // note cards
    static let raised = Color(dark: 0x343535, light: 0xEBEBE8)      // hover / pressed
    static let raised2 = Color(dark: 0x313232, light: 0xE8E8E5)
    static let selected = Color(dark: 0x29445B, light: 0xDBE6F2)
    static let avatar = Color(dark: 0x3A3B3B, light: 0xDCDCD8)

    // MARK: Lines

    static let hairline = Color(dark: 0x3A3C3B, light: 0xDCDCD8)    // inside a pane
    static let line = Color(dark: 0x3E4040, light: 0xD1D1CD)        // pane borders
    static let edge = Color(dark: 0x474949, light: 0xC5C5C0)
    static let edgeStrong = Color(dark: 0x555756, light: 0xB6B6B1)  // between panes
    static let edgeInput = Color(dark: 0x4D4F4E, light: 0xBCBCB7)

    // MARK: Text, most to least contrast

    static let textBright = Color(dark: 0xF8F8F4, light: 0x101010)
    static let text = Color(dark: 0xEEEEEA, light: 0x202020)
    static let text2 = Color(dark: 0xE6E6E1, light: 0x2A2A29)
    static let body = Color(dark: 0xD8D8D3, light: 0x3B3B39)
    static let body2 = Color(dark: 0xD0D0CB, light: 0x444442)
    static let body3 = Color(dark: 0xC6C6C1, light: 0x4E4E4B)
    static let muted = Color(dark: 0xB6B5B0, light: 0x5C5C59)
    static let muted2 = Color(dark: 0xAAA9A4, light: 0x656562)
    static let dim = Color(dark: 0xA3A29C, light: 0x71716E)
    static let dim2 = Color(dark: 0x9A998F, light: 0x787874)
    static let dim3 = Color(dark: 0xA0A09A, light: 0x6A6A67)
    /// The two decorative greys — rules, ticks, a disabled label. They are the one place
    /// the ramp does not invert far: the web keeps them at the same low contrast in both
    /// themes deliberately, so `faint` barely moves and `faint2` is *lighter* than it,
    /// where in the dark it is darker.
    static let faint = Color(dark: 0x8B8A82, light: 0x8A8A86)
    static let faint2 = Color(dark: 0x7C7B73, light: 0x9A9A95)

    // MARK: Accent and semantics
    //
    // The accent blue and the two purples are darkened in the light theme until they clear
    // WCAG AA on `surface`, and every `*Ink` — the text put *on* a filled semantic surface —
    // becomes plain white there, because those fills go from pale-on-dark to saturated-on-light.

    static let accent = Color(dark: 0x83B7E3, light: 0x245F9E)
    static let accentHover = Color(dark: 0x9CC7EA, light: 0x1D4E83)
    static let accentLink = Color(dark: 0xA8D0EF, light: 0x1D4E83)
    static let accentInk = Color(dark: 0x10202C, light: 0xFFFFFF)
    /// Blunder and mistake keep saturated hues in the light theme rather than being
    /// darkened for AA: on the board and the eval curve they are colour first, and a brick
    /// red and a brown were read as the wrong hues.
    static let blunder = Color(dark: 0xEE766E, light: 0xBB3E35)
    static let blunderInk = Color(dark: 0x2A0F0D, light: 0xFFFFFF)
    static let mistake = Color(dark: 0xDDA05A, light: 0x9B6819)
    static let mistakeInk = Color(dark: 0x2B1D09, light: 0xFFFFFF)
    static let inaccuracy = Color(dark: 0xCBB96A, light: 0x7D6A12)
    static let good = Color(dark: 0x78B98C, light: 0x34724A)
    static let goodInk = Color(dark: 0x10281A, light: 0xFFFFFF)
    static let info = Color(dark: 0x8FB6C9, light: 0x3A6274)
    /// Maia / analysis-line purple.
    static let brilliant = Color(dark: 0xB098D7, light: 0x7054A5)
    static let deep = Color(dark: 0xC1ADDE, light: 0x63499A)
    static let otb = Color(dark: 0xC9B89A, light: 0x7A6440)

    // MARK: Board

    /// Arrow hues are a step more saturated than the web's. The web's arrows are the panel
    /// hues at two thirds saturation, which is right on a desktop board eight hundred
    /// points wide; on a phone the squares are a third of the size and the slate board is
    /// itself a desaturated blue, so the same engine blue merged into it. The board is slate
    /// in both themes but a lighter slate in the light one, so the arrows go dark there
    /// rather than staying pale — the same hues, read the other way round. Each arrow also
    /// gets a dark halo (`arrowHalo`) so it holds on the light squares as well as the dark.
    static let arrowEngine = Color(dark: 0x4D9BE6, light: 0x3D6790)
    static let arrowMaia = Color(dark: 0xA98BE3, light: 0x79639C)
    /// Deliberately hueless: the move that was played is a statement of fact, so it stands
    /// outside both engine hues and the classification ramp. Hueless in the light theme too,
    /// which is why it flips from near-white to near-black instead of picking up a tint.
    static let arrowPlayed = Color(dark: 0xF1F1F1, light: 0x2F2F2F)
    static let arrowDeep = Color(dark: 0xB6AAC9, light: 0x6B5C8C)
    /// The thin dark edge under every arrow. Not a colour of its own, so it lifts any hue
    /// off any square without claiming a meaning; the same in both themes, because a dark
    /// edge is what separates a shape from a pale square and a slate one alike.
    static let arrowHalo = Color(red: 0.05, green: 0.06, blue: 0.07, opacity: 0.45)

    static let boardLight = Color(dark: 0xA9B2B8, light: 0xD8DDE0)
    static let boardDark = Color(dark: 0x616D75, light: 0x8F9DA5)
    /// The coordinate inks are named for the square they sit on, not for the theme, so both
    /// keep their side in the light theme and only their strength changes: the light board
    /// is paler, so the ink on a dark square goes to full white at a higher opacity.
    static let coordOnLight = Color(
        dark: Color(red: 20 / 255, green: 24 / 255, blue: 28 / 255, opacity: 0.55),
        light: Color(red: 20 / 255, green: 24 / 255, blue: 28 / 255, opacity: 0.5)
    )
    static let coordOnDark = Color(
        dark: Color(red: 251 / 255, green: 252 / 255, blue: 253 / 255, opacity: 0.45),
        light: Color(red: 1, green: 1, blue: 1, opacity: 0.8)
    )

    // MARK: Component fills

    static let track = Color(dark: 0x3A3C3B, light: 0xDEDEDA)
    static let meter = Color(dark: 0x6B6F6D, light: 0x7F8589)
    static let meter2 = Color(dark: 0x5A5E5C, light: 0x949996)
    static let rowActive = Color(dark: 0x2F3030, light: 0xE9E9E5)
    static let cell = Color(dark: 0x2B2C2C, light: 0xF2F2EF)
    static let cellStrong = Color(dark: 0x313232, light: 0xEAEAE6)
    static let evalTrack = Color(dark: 0x3A3C3B, light: 0xD7D7D3)
    /// How the two sides are drawn wherever one is shown as itself rather than as a surface
    /// — the eval bar, a games row's colour dot. Unlike a text or a surface token these do
    /// *not* swap places between the themes: white is the light one in both, which is the
    /// whole point of them being their own names.
    static let sideWhite = Color(dark: 0xE6E6E1, light: 0xFFFFFF)
    static let sideWhiteEdge = Color(dark: 0xB8B8B3, light: 0xB0B0AB)
    static let sideBlack = Color(dark: 0x232424, light: 0x3A3B3B)
    static let sideBlackEdge = Color(dark: 0x555655, light: 0x3A3B3B)
    static let graphBg = Color(dark: 0x3A3C3B, light: 0xDCDCD8)
    static let graphGrid = Color(dark: 0x4E5150, light: 0xC6C6C1)
    static let graphAxis = Color(dark: 0x616563, light: 0xA8A8A3)
    static let graphTick = Color(dark: 0x98978F, light: 0x7A7A76)
    static let chipNeutral = Color(dark: 0x2E2F2F, light: 0xEFEFEC)
    static let chipInfo = Color(dark: 0x2A3540, light: 0xE7EEF6)
    static let chipInfoEdge = Color(dark: 0x46586A, light: 0xB9CDE2)
    static let chipGood = Color(dark: 0x2B332E, light: 0xE8F0EA)
    static let chipGoodEdge = Color(dark: 0x47584D, light: 0xB6CCBC)
    static let chipOtb = Color(dark: 0x33302A, light: 0xF2EDE4)
    static let chipOtbEdge = Color(dark: 0x575047, light: 0xD6CBB4)

    /// What a thing that floats casts, alpha included (`--bb-shadow`). It is a token rather
    /// than `void` at an opacity because a shadow is black in the dark theme and a soft warm
    /// grey in the light one — the app's ground is the wrong colour to borrow for it once
    /// that ground is nearly white.
    static let shadow = Color(
        dark: Color(red: 0, green: 0, blue: 0, opacity: 0.5),
        light: Color(red: 30 / 255, green: 30 / 255, blue: 28 / 255, opacity: 0.16)
    )

    // MARK: Radii
    //
    // The web pulled its radius scale in to 3/4/5/6 design pixels so that a control is
    // rounded and a region is not. The phone keeps that distinction with slightly larger
    // numbers, because iOS controls are bigger and a 3pt radius reads as square.

    enum Radius {
        static let chip: CGFloat = 4
        static let control: CGFloat = 6
        static let card: CGFloat = 8
        static let sheet: CGFloat = 12
    }

    enum Metrics {
        /// Apple's minimum comfortable hit target.
        static let hit: CGFloat = 44
        static let rowHeight: CGFloat = 56
        static let gutter: CGFloat = 12
        static let evalBarWidth: CGFloat = 12
        static let evalStripHeight: CGFloat = 30
    }

    enum Font {
        static func mono(_ size: CGFloat, weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
            .system(size: size, weight: weight, design: .monospaced)
        }

        static func text(_ size: CGFloat, weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
            .system(size: size, weight: weight)
        }
    }
}

extension Color {
    /// `Color(hex: 0x83B7E3)` — the form every token above is written in, so the palette
    /// reads the same here as it does in `index.css`.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    /// `Color(dark: 0x1D1E1F, light: 0xE7E7E4)` — one token, both themes.
    ///
    /// The resolution is UIKit's rather than SwiftUI's: a `UIColor` built from a trait
    /// closure re-resolves itself whenever the trait collection changes, which is what lets
    /// a token stay a `static let` on an `enum`. Reading `@Environment(\.colorScheme)`
    /// instead would make every token a function of a view, and the palette would stop
    /// being a list of names.
    init(dark: UInt32, light: UInt32, opacity: Double = 1) {
        self.init(
            dark: Color(hex: dark, opacity: opacity),
            light: Color(hex: light, opacity: opacity)
        )
    }

    /// The same, for the handful of tokens whose two themes differ in alpha as well as in
    /// hue and so cannot be written as a pair of hexes.
    init(dark: Color, light: Color) {
        self.init(uiColor: UIColor { traits in
            UIColor(traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}
