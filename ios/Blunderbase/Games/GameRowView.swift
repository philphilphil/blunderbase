import SwiftUI

/// One game in the library, as two lines.
///
/// The web's row is thirteen columns wide and folds into a two-line card below `md`
/// (`web/src/routes/games/components/columns.ts`). The phone starts from that card rather
/// than from the table, and keeps its shape exactly: **names and result on top, everything
/// that qualifies the game underneath**. Matching it is not tidiness — the same library is
/// read in both places, and a row that put the date where the browser puts the result would
/// have to be re-learned on every switch.
///
/// Two things are said by weight rather than by a label, because a label would cost a column
/// each:
///
/// - **Which side the owner had** is the semibold name. There is no "you" marker; the bold
///   name *is* the marker, and a reference game the owner did not play simply has neither
///   name emphasised, which is the truth about it.
/// - **How badly it went** is the colour of the worst moment's drop, on the severity ramp
///   the whole app shares. The number is the same one the browser shows in the ACPL column.
///
/// The flag chips count the *worst moments the card carries* — three at most, because that
/// is what `GET /games?cards=true` sends. They are not a census of the game's mistakes and
/// must never be read as one, which is why they are glyph-and-count rather than a total.
struct GameRowView: View {
    let card: GameCard

    /// The stamp on the right. Small enough to be a texture in the row rather than a chart
    /// competing with the text, and wide enough that a swing has somewhere to happen.
    private static let sparklineSize = CGSize(width: 46, height: 22)

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                players
                qualifiers
            }
            Sparkline(points: card.evalCurve ?? [], flagged: flaggedPlies)
                .frame(width: GameRowView.sparklineSize.width, height: GameRowView.sparklineSize.height)
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.vertical, 9)
        .frame(minHeight: 64)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    // MARK: Line one — who played, and how it ended

    private var players: some View {
        HStack(spacing: 6) {
            name(card.game.white, emphasised: card.game.ownerIsWhite == true)
            rating(card.game.whiteRating)
            name(card.game.black, emphasised: card.game.ownerIsWhite == false)
            rating(card.game.blackRating)
            Spacer(minLength: 4)
            Text(Format.result(card.game.result))
                .font(Theme.Font.mono(13, weight: .medium))
                .foregroundStyle(Format.outcomeColor(card.game.outcome))
                .fixedSize()
        }
    }

    /// Names are set in the text face and truncate; they are the only elastic thing in the
    /// line, so they are what gives way when two long handles meet a narrow screen.
    private func name(_ value: String?, emphasised: Bool) -> some View {
        Text(value ?? Format.absent)
            .font(Theme.Font.text(14, weight: emphasised ? .semibold : .regular))
            .foregroundStyle(emphasised ? Theme.textBright : Theme.body2)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    /// Ratings never truncate. A rating with a digit missing is worse than no rating, and
    /// four characters is a price worth paying to keep it honest.
    private func rating(_ value: Int?) -> some View {
        Text(value.map(String.init) ?? Format.absent)
            .font(Theme.Font.mono(11))
            .foregroundStyle(Theme.faint)
            .fixedSize()
    }

    // MARK: Line two — what kind of game it was, and what went wrong

    private var qualifiers: some View {
        HStack(spacing: 6) {
            Text(Format.date(card.game.playedAt))
                .font(Theme.Font.mono(11))
                .foregroundStyle(Theme.dim)
            separator
            Text(Format.timeControl(card.game.timeControl))
                .font(Theme.Font.mono(11))
                .foregroundStyle(Theme.faint)
            separator
            Text(Format.moveCount(plyCount: card.game.plyCount))
                .font(Theme.Font.mono(11))
                .foregroundStyle(Theme.faint)

            Spacer(minLength: 4)

            tier
            Text(Format.winLoss(worstDrop))
                .font(Theme.Font.mono(11, weight: .medium))
                .foregroundStyle(Format.severityColor(worstDrop))
                .fixedSize()
            flags
        }
        .lineLimit(1)
    }

    private var separator: some View {
        Text("·")
            .font(Theme.Font.mono(11))
            .foregroundStyle(Theme.faint2)
    }

    /// Which pass has run over the game, said as quietly as the fact deserves.
    ///
    /// Both markers are corner-of-the-row information: the reader is scanning for games,
    /// not for work to queue, and an unanalysed row is still a game they played. The web
    /// paints a badge; here it is a word at nine points, and nothing at all on the common
    /// case of a quick pass having finished.
    @ViewBuilder
    private var tier: some View {
        if card.analyzed != true {
            marker("unanalysed", color: Theme.faint2)
        } else if card.deep == true {
            marker("deep", color: Theme.deep)
        }
    }

    private func marker(_ text: String, color: Color) -> some View {
        Text(text)
            .font(Theme.Font.text(9, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(Theme.chipNeutral, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
            .fixedSize()
    }

    private var flags: some View {
        HStack(spacing: 3) {
            ForEach(flagCounts, id: \.glyph) { flag in
                HStack(spacing: 1) {
                    Text(flag.glyph)
                    Text(verbatim: "\(flag.count)")
                }
                .font(Theme.Font.mono(10, weight: .semibold))
                .foregroundStyle(flag.color)
                .fixedSize()
            }
        }
    }

    // MARK: Derived

    /// The worst moment's cost. The card's moments arrive worst first, so this is the head
    /// of the list rather than a scan — and it is nil, not zero, on a game nothing was
    /// flagged in.
    private var worstDrop: Double? {
        card.worstMoments?.first?.winLoss
    }

    private var flaggedPlies: [Int] {
        (card.worstMoments ?? []).filter(\.classification.isFlagged).map(\.ply)
    }

    /// One chip per classification present, worst first — `??1 ?2 ?!5`. The order is the
    /// severity order the whole app sorts by, so a blunder is always the leftmost thing in
    /// the group whatever else the game contained.
    private var flagCounts: [FlagCount] {
        var counts: [Classification: Int] = [:]
        for moment in card.worstMoments ?? [] {
            guard let classification = moment.classification, classification.isFlagged else { continue }
            counts[classification, default: 0] += 1
        }
        return counts
            .map { FlagCount(classification: $0.key, count: $0.value) }
            .sorted { $0.classification.severity > $1.classification.severity }
    }

    private struct FlagCount {
        let classification: Classification
        let count: Int

        var glyph: String { classification.glyph }
        var color: Color { classification.color }
    }

    /// Spoken as a sentence rather than as the row's fragments, because VoiceOver reads the
    /// combined children in layout order and "phib 1834 Hikaru 2812 1–0" is not a sentence.
    private var accessibilityLabel: String {
        var parts: [String] = []
        parts.append("\(card.game.white ?? "White") versus \(card.game.black ?? "Black")")
        if let result = card.game.result { parts.append(Format.result(result)) }
        if let played = card.game.playedAt { parts.append(Format.date(played)) }
        if let drop = worstDrop {
            parts.append("worst move cost \(Int(drop.rounded())) percent")
        }
        if card.analyzed != true { parts.append("not analysed") }
        return parts.joined(separator: ", ")
    }
}

#Preview("Rows") {
    VStack(spacing: 0) {
        ForEach(GameRowPreview.cards) { card in
            GameRowView(card: card)
        }
    }
    .background(Theme.void)
}

/// Fixtures decoded through the app's own decoder rather than built by hand: `GameCard`
/// composes `GameSummary` out of the same JSON object and has no memberwise initialiser, so
/// JSON is the only honest way to make one — and it doubles as a sample of the wire shape.
enum GameRowPreview {
    static let json = """
    [
      {"id": 1, "source": "lichess", "played_at": "2026-08-22T18:04:00Z", "color": "white",
       "result": "1-0", "outcome": "win", "white": "phib", "black": "Hikaru",
       "white_rating": 1712, "black_rating": 2812, "time_control": "600+0", "ply_count": 71,
       "speed": "rapid", "analyzed": true,
       "worst_moments": [{"ply": 34, "san": "Bxf6", "win_loss": 58, "classification": "blunder"},
                         {"ply": 40, "san": "Rd1", "win_loss": 19, "classification": "mistake"}],
       "eval_curve": [{"ply": 0, "win": 50}, {"ply": 10, "win": 62}, {"ply": 20, "win": 71},
                      {"ply": 34, "win": 22}, {"ply": 50, "win": 40}, {"ply": 71, "win": 96}]},
      {"id": 2, "source": "chesscom", "played_at": "2025-12-07T09:00:00Z", "color": "black",
       "result": "0-1", "outcome": "win", "white": "aVeryLongOpponentHandle", "black": "phib",
       "white_rating": 1690, "black_rating": 1701, "time_control": "180+2", "ply_count": 44,
       "speed": "blitz", "analyzed": true, "deep": true,
       "worst_moments": [{"ply": 12, "san": "h6", "win_loss": 9, "classification": "inaccuracy"}],
       "eval_curve": [{"ply": 0, "win": 50}, {"ply": 20, "win": 44}, {"ply": 44, "win": 4}]},
      {"id": 3, "source": "pgn", "played_at": "2026-09-01T12:00:00Z", "color": "white",
       "result": "1/2-1/2", "outcome": "draw", "white": "phib", "black": "Kramnik",
       "time_control": "5400+30", "ply_count": 96}
    ]
    """

    static let cards: [GameCard] =
        (try? APIClient.makeDecoder().decode([GameCard].self, from: Data(json.utf8))) ?? []
}
