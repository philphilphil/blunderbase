import SwiftUI

/// One position's book: how often the owner has been here, how it went, and what they
/// played — the table both the game's Book pane and the Explorer tab draw.
///
/// It is one view rather than two because it is one answer: the explorer's fold over the
/// owner's games, in the explorer's columns and vocabulary (move, games, the win/draw/loss
/// split, score, average drop), formatted by the shared helpers in `Format` rather than by
/// arithmetic written here. A percentage that rounds one way in the game and another in
/// the explorer is how one feature becomes two.
///
/// The table knows nothing about where the board came from. It is handed the position, so
/// it can spell a move whose SAN the server left out, and the move the game went on with,
/// so that row can wear its mark; what a tap *does* is the caller's — the game pane steps
/// or plays, the explorer only plays.
struct BookTable: View {
    let entry: BookEntry
    /// The position the entry is about, for spelling a continuation the server sent as UCI.
    let fen: String
    /// The continuation the game on screen actually went on with, if there is a game.
    var playedUci: String?
    /// Whether the engine may speak: the average drop is its reading, and goes with it.
    var engineHidden: Bool = false
    /// A tapped continuation, and whether it is the one the game played.
    let onTap: (BookMove, Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(entry.moves ?? []) { move in
                row(move)
            }
        }
    }

    // MARK: Header

    /// One sentence, in the strip the other panes put their section titles in.
    ///
    /// It answers the question the table exists for — "have I been here before, and how did
    /// it go" — before any row is read. The three counts are spelled out rather than left to
    /// the bars below, because the bars are per continuation and this is the position.
    private var header: some View {
        let split = Format.split(
            wins: entry.wins, draws: entry.draws, losses: entry.losses, games: entry.games
        )
        return HStack(spacing: 6) {
            // A count is a quantity, and the plural rule lives in the catalog with the
            // translation, which is what makes "1 time / 2 times" say the right thing in
            // a language whose plural is not an s.
            Text("Been here \(split.games) times")
                .font(Theme.Font.text(12, weight: .medium))
                .foregroundStyle(Theme.info)

            Text(verbatim: "· \(split.wins) / \(split.draws) / \(split.losses)")
                .font(Theme.Font.mono(11))
                .foregroundStyle(Theme.body2)

            Spacer(minLength: 4)

            Text(Format.scorePercent(entry.score))
                .font(Theme.Font.mono(11, weight: .medium))
                .foregroundStyle(Format.scoreColor(entry.score))
        }
        .lineLimit(1)
        .padding(.horizontal, Theme.Metrics.gutter)
        .frame(height: 30)
        .frame(maxWidth: .infinity)
        .background(Theme.panel)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(split.games) of your games reached this position: \(split.wins) wins, \(split.draws) draws, \(split.losses) losses"
        )
    }

    // MARK: Rows

    /// One continuation. The move played in *this* game is marked the way the engine pane
    /// marks it — bolder, and labelled — so the row that says "this is the habit" stands out
    /// from the rows that say "this is the alternative you have also tried".
    private func row(_ move: BookMove) -> some View {
        let wasPlayed = move.uci != nil && move.uci == playedUci
        let split = Format.split(wins: move.wins, draws: move.draws, losses: move.losses)
        return Button {
            onTap(move, wasPlayed)
        } label: {
            HStack(spacing: 6) {
                Text(san(move))
                    .font(Theme.Font.mono(13, weight: wasPlayed ? .semibold : .regular))
                    .foregroundStyle(wasPlayed ? Theme.text : Theme.body)
                    .frame(width: 52, alignment: .leading)

                Text(verbatim: "\(move.games ?? 0)")
                    .font(Theme.Font.mono(12))
                    .foregroundStyle(Theme.dim)
                    .frame(width: 26, alignment: .trailing)

                SplitBar(split: split)
                    .frame(height: 18)

                Text(Format.scorePercent(move.score))
                    .font(Theme.Font.mono(11))
                    .foregroundStyle(Format.scoreColor(move.score))
                    .frame(width: 42, alignment: .trailing)

                // The average drop is the engine's reading of the owner's other games, so
                // it goes quiet with the engine; the column stays so the rows line up.
                Text(engineHidden ? "" : Format.avgDrop(move.avgWinLoss))
                    .font(Theme.Font.mono(11))
                    .foregroundStyle(Format.dropColor(move.avgWinLoss))
                    .frame(width: 42, alignment: .trailing)

                // The mark keeps its column whether or not a row wears it: there are two
                // number columns to its left, and a label that appears on one row in five
                // would shunt them sideways on exactly that row — which is the row the
                // reader is comparing the others against. With no game on screen the
                // column is empty on every row, and stays for the same reason.
                Text(wasPlayed ? "played" : "")
                    .font(Theme.Font.text(10))
                    .foregroundStyle(Theme.faint)
                    .frame(width: 44, alignment: .trailing)
            }
            .lineLimit(1)
            .padding(.horizontal, Theme.Metrics.gutter)
            .frame(height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The server sends SAN alongside the UCI and that is used when it is there. When it is
    /// not, the notation is derived against the board, which is the position every entry in
    /// this table belongs to.
    private func san(_ move: BookMove) -> String {
        if let san = move.san { return san }
        guard let uci = move.uci else { return Format.absent }
        return SAN.san(forUCI: uci, fen: fen) ?? uci
    }
}

/// The win / draw / loss bar, thin enough to sit in a 32pt row.
///
/// The explorer's bar prints its percentages inside the segments; there is nowhere near the
/// width for that here, so this is the same three colours as a capsule and the numbers live
/// in the header and the score column instead. Green, grey, red is the *owner's* result and
/// not a side's — it means "this went well for you", which is why the loss segment is
/// blunder red rather than Black's ink.
private struct SplitBar: View {
    let split: Format.Split

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.track).frame(height: 5)
                HStack(spacing: 0) {
                    segment(Theme.good, split.winPercent, in: geometry.size.width)
                    segment(Theme.faint, split.drawPercent, in: geometry.size.width)
                    segment(Theme.blunder, split.lossPercent, in: geometry.size.width)
                }
                .frame(height: 5)
                .clipShape(Capsule())
            }
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .accessibilityElement()
        .accessibilityLabel("\(split.wins) wins, \(split.draws) draws, \(split.losses) losses")
    }

    private func segment(_ color: Color, _ percent: Double, in width: CGFloat) -> some View {
        color.frame(width: width * percent / 100)
    }
}
