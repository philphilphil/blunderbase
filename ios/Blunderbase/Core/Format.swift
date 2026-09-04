import Foundation
import SwiftUI

/// How Blunderbase writes numbers and names.
///
/// The web app keeps these rules in `web/src/routes/games/format.ts`, and the phone copies
/// them rather than inventing its own: a game that reads "22 Aug · −58% · ??1" in the
/// browser must read the same on the phone, or the two screens quietly disagree about the
/// same row. Every function here is pure and total — a missing field formats as a dash,
/// never as an empty string, so a column never collapses.
enum Format {

    /// The dash used wherever a value is absent. An en dash, not a hyphen: it is a gap in
    /// the data, not a minus sign.
    static let absent = "–"

    // MARK: Dates

    private static let dayMonth: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "d MMM"
        return f
    }()

    private static let dayMonthYear: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "d MMM yy"
        return f
    }()

    /// `22 Aug` inside the current year, `7 Dec 16` outside it.
    ///
    /// The year is the part a reader only needs when it is surprising, and a games list is
    /// mostly this year, so spending four characters on it in every row buys nothing.
    static func date(_ date: Date?, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date else { return absent }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return sameYear ? dayMonth.string(from: date) : dayMonthYear.string(from: date)
    }

    // MARK: Result and outcome

    /// `1–0`, `0–1`, `½–½`, `*`. Real typography: an en dash between the scores and a
    /// vulgar fraction for the draw, because `1/2-1/2` is four glyphs of noise in a column
    /// that is read at a glance.
    static func result(_ raw: String?) -> String {
        switch raw {
        case "1-0": return "1–0"
        case "0-1": return "0–1"
        case "1/2-1/2": return "½–½"
        case "*": return "*"
        case let other?: return other
        case nil: return absent
        }
    }

    /// Green for a win, red for a loss, grey for a draw or an unfinished game.
    static func outcomeColor(_ outcome: String?) -> Color {
        switch outcome {
        case "win": return Theme.good
        case "loss": return Theme.blunder
        case "draw": return Theme.dim
        default: return Theme.dim2
        }
    }

    // MARK: Clocks and time controls

    /// `10+0` from the PGN's `600+0`, and `OTB 90+30` for the over-the-board forms that
    /// arrive already in minutes. Seconds are what the server stores and minutes are what
    /// a player says, so the conversion happens here rather than on screen.
    static func timeControl(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return absent }
        if raw == "-" { return "correspondence" }
        let parts = raw.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false)
        guard let base = parts.first, let seconds = Int(base) else { return raw }
        let increment = parts.count > 1 ? String(parts[1]) : "0"
        let minutes = seconds % 60 == 0 ? String(seconds / 60) : String(format: "%.1f", Double(seconds) / 60)
        return "\(minutes)+\(increment)"
    }

    /// A remaining clock as `4:12`, or `1:04:12` once it passes an hour.
    static func clock(_ seconds: Double?) -> String {
        guard let seconds, seconds >= 0 else { return absent }
        let total = Int(seconds.rounded())
        let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60)
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }

    /// The web turns a clock under twenty seconds red. Time trouble is a fact about the
    /// game worth seeing while stepping through it, not a detail to hunt for.
    static let timeTroubleSeconds: Double = 20

    static func clockColor(_ seconds: Double?) -> Color {
        guard let seconds else { return Theme.dim2 }
        return seconds < timeTroubleSeconds ? Theme.mistake : Theme.body2
    }

    // MARK: Severity

    /// `−58%` — how much win percentage a move gave away, with a real minus sign.
    ///
    /// The value arrives as a positive loss (`win_loss`), and it is written negative
    /// because a reader scanning the column is looking for what a move cost.
    static func winLoss(_ value: Double?) -> String {
        guard let value, value > 0 else { return absent }
        return "−\(Int(value.rounded()))%"
    }

    /// The severity ramp the whole app shares: at least 30 reads as a blunder, 15 a
    /// mistake, 7 an inaccuracy, and anything smaller is not worth colouring.
    ///
    /// These are display thresholds, deliberately coarser than the server's own
    /// classification cuts (5/10/15 by default). The server decides what a move *is*; this
    /// decides how loud the number looks in a list where the classification is not shown.
    static func severityColor(_ winLoss: Double?) -> Color {
        guard let winLoss else { return Theme.dim2 }
        switch winLoss {
        case 30...: return Theme.blunder
        case 15..<30: return Theme.mistake
        case 7..<15: return Theme.inaccuracy
        default: return Theme.dim
        }
    }

    // MARK: Evaluation

    /// The engine's own number, as a player says it: `+1.4`, `−0.6`, `M3`, `−M2`.
    ///
    /// Centipawns and mate distance are two different scales sharing one column, so the
    /// mate form drops the decimal entirely rather than pretending to be a pawn count.
    static func score(cp: Int?, mate: Int?) -> String? {
        if let mate {
            return mate >= 0 ? "M\(mate)" : "−M\(abs(mate))"
        }
        guard let cp else { return nil }
        let pawns = Double(cp) / 100
        let magnitude = String(format: "%.1f", abs(pawns))
        if cp > 0 { return "+\(magnitude)" }
        if cp < 0 { return "−\(magnitude)" }
        return "0.0"
    }

    /// A win percentage as a whole number: `62%`.
    static func winPercent(_ value: Double?) -> String {
        guard let value else { return absent }
        return "\(Int(value.rounded()))%"
    }

    // MARK: Moves

    /// `18.` for White and `18…` for Black — the ellipsis is what tells a reader which side
    /// moved without spending a column on it.
    static func moveNumber(ply: Int) -> String {
        let number = (ply + 1) / 2
        return ply % 2 == 1 ? "\(number)." : "\(number)…"
    }

    /// `18. Bxf6` or `18… gxf6`, the form a note or a ticker quotes a move in.
    static func move(ply: Int, san: String?) -> String {
        guard let san else { return moveNumber(ply: ply) }
        return "\(moveNumber(ply: ply)) \(san)"
    }

    /// Whole moves from a half-move count, which is what a games list means by "moves".
    static func moveCount(plyCount: Int?) -> String {
        guard let plyCount else { return absent }
        return "\((plyCount + 1) / 2)"
    }

    // MARK: Engine throughput

    /// `1.2M/s`, `840k/s` — how fast the engine is searching.
    ///
    /// Abbreviated rather than grouped, because this number changes several times a second
    /// and the reader is watching whether it is *moving*, not reading its value. Nine digits
    /// twitching in a narrow column is noise; two significant figures and a suffix is the
    /// same information at a glance.
    static func nodesPerSecond(_ nps: Int?) -> String {
        guard let nps, nps > 0 else { return absent }
        return "\(abbreviated(nps))/s"
    }

    /// `4.7M`, `312k` — how many positions the engine has looked at.
    static func nodes(_ nodes: Int?) -> String {
        guard let nodes, nodes > 0 else { return absent }
        return abbreviated(nodes)
    }

    private static func abbreviated(_ value: Int) -> String {
        switch value {
        case 1_000_000_000...:
            return String(format: "%.1fB", Double(value) / 1_000_000_000)
        case 1_000_000...:
            return String(format: "%.1fM", Double(value) / 1_000_000)
        case 1_000...:
            return "\(value / 1_000)k"
        default:
            return "\(value)"
        }
    }

    // MARK: Counts

    /// A note on the one number trap in this app.
    ///
    /// `Text("\(someInt)")` in SwiftUI is not Swift's string interpolation — the argument is
    /// a `LocalizedStringKey`, so the integer is run through the viewer's locale and a rating
    /// of 1712 is drawn as `1.712` in Germany and `1,712` in Britain. A rating, an Elo, a
    /// ply and a move number are all identifiers rather than quantities and must never be
    /// grouped. Write those as `Text(verbatim: "\(value)")`.
    ///
    /// `count` below is the deliberate exception: a library total *is* a quantity, it is read
    /// rather than matched, and grouping is what makes six digits legible.

    /// `1,284` — a thousands separator, because a library count is read, not calculated.
    static func count(_ value: Int) -> String {
        value.formatted(.number.grouping(.automatic))
    }
}
