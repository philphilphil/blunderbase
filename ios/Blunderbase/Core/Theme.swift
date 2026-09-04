import SwiftUI

/// The Blunderbase palette, lifted from `web/src/index.css`.
///
/// The web app's rule is that no component names a hex: every colour is a `--bb-*` token
/// with a semantic alias. This file is the phone's copy of that rule — it is the only
/// place in the iOS app that writes a hex, and every view reads a name from here. The
/// values are the dark theme, which is Blunderbase's default and the only theme the POC
/// ships; a light set would be added here and nowhere else.
///
/// One deliberate difference from the web: the web reads its design file at 120% zoom and
/// writes every length as `px / 16` rem. iOS points are not rem, and a phone is held
/// closer than a monitor, so the sizes in `Metrics` are chosen for the phone rather than
/// converted. The colours are copied exactly.
enum Theme {

    // MARK: Surfaces

    static let void = Color(hex: 0x1D1E1F)        // app ground
    static let panel = Color(hex: 0x292A2A)       // chrome: bars, pane titles
    static let surface = Color(hex: 0x232424)     // content canvas
    static let surface2 = Color(hex: 0x212222)
    static let elevated = Color(hex: 0x303131)    // chips, inputs, buttons
    static let elevated2 = Color(hex: 0x2B2C2C)   // note cards
    static let raised = Color(hex: 0x343535)      // hover / pressed
    static let raised2 = Color(hex: 0x313232)
    static let selected = Color(hex: 0x29445B)
    static let avatar = Color(hex: 0x3A3B3B)

    // MARK: Lines

    static let hairline = Color(hex: 0x3A3C3B)    // inside a pane
    static let line = Color(hex: 0x3E4040)        // pane borders
    static let edge = Color(hex: 0x474949)
    static let edgeStrong = Color(hex: 0x555756)  // between panes
    static let edgeInput = Color(hex: 0x4D4F4E)

    // MARK: Text, most to least contrast

    static let textBright = Color(hex: 0xF8F8F4)
    static let text = Color(hex: 0xEEEEEA)
    static let text2 = Color(hex: 0xE6E6E1)
    static let body = Color(hex: 0xD8D8D3)
    static let body2 = Color(hex: 0xD0D0CB)
    static let body3 = Color(hex: 0xC6C6C1)
    static let muted = Color(hex: 0xB6B5B0)
    static let muted2 = Color(hex: 0xAAA9A4)
    static let dim = Color(hex: 0xA3A29C)
    static let dim2 = Color(hex: 0x9A998F)
    static let dim3 = Color(hex: 0xA0A09A)
    static let faint = Color(hex: 0x8B8A82)
    static let faint2 = Color(hex: 0x7C7B73)

    // MARK: Accent and semantics

    static let accent = Color(hex: 0x83B7E3)
    static let accentHover = Color(hex: 0x9CC7EA)
    static let accentLink = Color(hex: 0xA8D0EF)
    static let accentInk = Color(hex: 0x10202C)
    static let blunder = Color(hex: 0xEE766E)
    static let blunderInk = Color(hex: 0x2A0F0D)
    static let mistake = Color(hex: 0xDDA05A)
    static let mistakeInk = Color(hex: 0x2B1D09)
    static let inaccuracy = Color(hex: 0xCBB96A)
    static let good = Color(hex: 0x78B98C)
    static let goodInk = Color(hex: 0x10281A)
    static let info = Color(hex: 0x8FB6C9)
    static let brilliant = Color(hex: 0xB098D7)   // Maia / analysis-line purple
    static let deep = Color(hex: 0xC1ADDE)
    static let otb = Color(hex: 0xC9B89A)

    // MARK: Board

    /// Arrow hues are a step more saturated than the web's. The web's arrows are the panel
    /// hues at two thirds saturation, which is right on a desktop board eight hundred
    /// points wide; on a phone the squares are a third of the size and the slate board is
    /// itself a desaturated blue, so the same engine blue merged into it. Each arrow also
    /// gets a dark halo (`arrowHalo`) so it holds on the light squares as well as the dark.
    static let arrowEngine = Color(hex: 0x4D9BE6)
    static let arrowMaia = Color(hex: 0xA98BE3)
    /// Deliberately hueless: the move that was played is a statement of fact, so it stands
    /// outside both engine hues and the classification ramp.
    static let arrowPlayed = Color(hex: 0xF1F1F1)
    static let arrowDeep = Color(hex: 0xB6AAC9)
    /// The thin dark edge under every arrow. Not a colour of its own, so it lifts any hue
    /// off any square without claiming a meaning.
    static let arrowHalo = Color(red: 0.05, green: 0.06, blue: 0.07, opacity: 0.45)

    static let boardLight = Color(hex: 0xA9B2B8)
    static let boardDark = Color(hex: 0x616D75)
    static let coordOnLight = Color(red: 20 / 255, green: 24 / 255, blue: 28 / 255, opacity: 0.55)
    static let coordOnDark = Color(red: 251 / 255, green: 252 / 255, blue: 253 / 255, opacity: 0.45)

    // MARK: Component fills

    static let track = Color(hex: 0x3A3C3B)
    static let meter = Color(hex: 0x6B6F6D)
    static let meter2 = Color(hex: 0x5A5E5C)
    static let rowActive = Color(hex: 0x2F3030)
    static let cell = Color(hex: 0x2B2C2C)
    static let cellStrong = Color(hex: 0x313232)
    static let evalTrack = Color(hex: 0x3A3C3B)
    static let sideWhite = Color(hex: 0xE6E6E1)
    static let sideWhiteEdge = Color(hex: 0xB8B8B3)
    static let sideBlack = Color(hex: 0x232424)
    static let sideBlackEdge = Color(hex: 0x555655)
    static let graphBg = Color(hex: 0x3A3C3B)
    static let graphGrid = Color(hex: 0x4E5150)
    static let graphAxis = Color(hex: 0x616563)
    static let graphTick = Color(hex: 0x98978F)
    static let chipNeutral = Color(hex: 0x2E2F2F)
    static let chipInfo = Color(hex: 0x2A3540)
    static let chipInfoEdge = Color(hex: 0x46586A)
    static let chipGood = Color(hex: 0x2B332E)
    static let chipGoodEdge = Color(hex: 0x47584D)
    static let chipOtb = Color(hex: 0x33302A)
    static let chipOtbEdge = Color(hex: 0x575047)

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
}
