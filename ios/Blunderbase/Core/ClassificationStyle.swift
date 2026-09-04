import SwiftUI

/// How a move's classification looks, everywhere it appears.
///
/// The classification itself is the server's judgement and arrives on the move; this is
/// only its appearance, kept apart from the model so that the board glyph, the move-list
/// badge, the ticker and the flagged list cannot drift into three different reds.
///
/// The glyphs are the ones a chess reader already knows from annotated games — `??`, `?`,
/// `?!` — rather than words or icons, because they are shorter than any label and mean
/// exactly this.
extension Classification {

    /// The annotation symbol. Empty for the classes that are not a criticism: a move being
    /// the engine's own choice is worth a colour in a list, not a mark on the board.
    var glyph: String {
        switch self {
        case .blunder: return "??"
        case .mistake: return "?"
        case .inaccuracy: return "?!"
        case .best, .good, .unknown: return ""
        }
    }

    var color: Color {
        switch self {
        case .blunder: return Theme.blunder
        case .mistake: return Theme.mistake
        case .inaccuracy: return Theme.inaccuracy
        case .best: return Theme.good
        case .good: return Theme.dim
        case .unknown: return Theme.dim2
        }
    }

    /// The text colour to put *on* `color` when it is used as a fill.
    ///
    /// `.unknown` is the odd one: it has no glyph, so nothing is ever actually drawn in this
    /// ink, and it used to be `Theme.void` — which was black in a dark-only app and became
    /// the near-white app ground the moment the light theme existed. The ground is never a
    /// foreground colour, so it is the quietest grey instead, which is what an unjudged move
    /// is worth in either theme.
    var ink: Color {
        switch self {
        case .blunder: return Theme.blunderInk
        case .mistake: return Theme.mistakeInk
        case .inaccuracy: return Theme.mistakeInk
        case .best, .good: return Theme.goodInk
        case .unknown: return Theme.faint
        }
    }

    /// Whether the move is a criticism — the three classes that earn a glyph, a badge and a
    /// row in the flagged list.
    var isFlagged: Bool {
        switch self {
        case .blunder, .mistake, .inaccuracy: return true
        case .best, .good, .unknown: return false
        }
    }

    /// A word for the classification, for accessibility labels and the flagged list.
    var name: String {
        switch self {
        case .blunder: return "Blunder"
        case .mistake: return "Mistake"
        case .inaccuracy: return "Inaccuracy"
        case .best: return "Best"
        case .good: return "Good"
        case .unknown: return "Unclassified"
        }
    }
}

/// The same appearance, read straight off an optional.
///
/// A move's classification is absent far more often than it is present — the server only
/// classifies a move it judged, so every unanalysed game and every good move carries a nil.
/// Unwrapping that at each of the dozen call sites would put a `?? .unknown` in the middle
/// of every view; putting it here once means a view can write `move.classification.glyph`
/// and get the right nothing.
extension Optional where Wrapped == Classification {
    var glyph: String { self?.glyph ?? "" }
    var color: Color { self?.color ?? Theme.dim2 }
    var ink: Color { self?.ink ?? Theme.faint }
    var isFlagged: Bool { self?.isFlagged ?? false }
    var name: String { self?.name ?? "Unclassified" }
}
