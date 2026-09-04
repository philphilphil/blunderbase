import SwiftUI

/// Your own games from this position: how often you have been here, how it went, and what
/// you played.
///
/// This is the explorer's answer in the game screen's panes, and it is deliberately the
/// *same* answer — the same fold over the same table, drawn with the same rules. So the
/// columns are the explorer's, in the explorer's order and vocabulary (move, games, the
/// win/draw/loss split, score, average drop), and the numbers are formatted by the shared
/// helpers in `Format` rather than by arithmetic written here. A percentage that rounds one
/// way on the phone and another in the browser is how one feature becomes two.
///
/// **The book is not advice.** The engine pane says what is best and Maia says what is
/// likely; this says what *you* have done, which is the only one of the three that can tell
/// you a habit is costing you games. That is why the average drop earns a column on a
/// screen this narrow: a continuation with a fine score that gives away four points a game
/// is the row worth stopping on.
///
/// A tap plays the move onto the board, one move a tap. The move this game went on with
/// simply steps the game forward, so the book at the next position takes over and the
/// reader can walk the opening row by row. Any other move opens a variation — and the pane
/// keeps showing the book it came from, with that row marked as the one on the board,
/// because the rows are what was just tapped and a pane that went blank in answer would
/// be no answer. What it cannot show is the book of the new position: the game only
/// ships entries for its own positions, and saying so is more honest than an empty box.
struct BookPane: View {
    @Bindable var store: GameStore

    var body: some View {
        ScrollView {
            if let entry = store.bookHere, let moves = entry.moves, !moves.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    header(entry)
                    ForEach(moves) { move in
                        row(move)
                    }
                    if store.isInLine {
                        lineNote
                    }
                }
            } else {
                empty(emptyText)
            }
        }
    }

    /// Why there is nothing to draw, in the reader's terms rather than the payload's.
    ///
    /// Three different absences, and only one of them is about this position. A game with no
    /// book at all is the library saying it has not seen this opening twice yet, which is a
    /// fact about the library and worth explaining once; a variation left from a position
    /// that had no book has none to keep showing; and a position the owner has reached only
    /// in this game is the ordinary case, which needs one line and no explanation.
    private var emptyText: String {
        if !store.hasBook {
            return "No opening book yet: it needs two games through the same position."
        }
        if store.isInLine {
            return "The line left the game at a position you have not been in before."
        }
        return "You have not been here in another game."
    }

    /// Under the rows while a variation is open: which position the book above belongs to.
    private var lineNote: some View {
        Text("The book of the position the line left from. Your other games from here are in the explorer.")
            .font(Theme.Font.text(11))
            .foregroundStyle(Theme.faint)
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.vertical, 8)
    }

    private func empty(_ text: String) -> some View {
        Text(text)
            .font(Theme.Font.text(13))
            .foregroundStyle(Theme.dim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Metrics.gutter)
    }

    // MARK: Header

    /// One sentence, in the strip the other panes put their section titles in.
    ///
    /// It answers the question the tab exists for — "have I been here before, and how did it
    /// go" — before any row is read. The three counts are spelled out rather than left to
    /// the bars below, because the bars are per continuation and this is the position.
    private func header(_ entry: BookEntry) -> some View {
        let split = Format.split(
            wins: entry.wins, draws: entry.draws, losses: entry.losses, games: entry.games
        )
        return HStack(spacing: 6) {
            Text(verbatim: "Been here \(split.games) \(split.games == 1 ? "time" : "times")")
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
            "\(split.games) of your games reached this position: "
            + "\(split.wins) wins, \(split.draws) draws, \(split.losses) losses"
        )
    }

    // MARK: Rows

    /// One continuation. The move you played in *this* game is marked the way the engine
    /// pane marks it — bolder, and labelled — so the row that says "this is the habit"
    /// stands out from the rows that say "this is the alternative you have also tried".
    private func row(_ move: BookMove) -> some View {
        let wasPlayed = move.uci != nil && move.uci == store.bookMove?.uci
        let onBoard = move.uci.map { store.progress(along: [$0]) == 1 } ?? false
        let split = Format.split(wins: move.wins, draws: move.draws, losses: move.losses)
        return Button {
            guard let uci = move.uci else { return }
            if wasPlayed {
                // The game's own move: go on with the game rather than opening a line that
                // is the game in disguise, so the next position's book takes over.
                if store.isInLine { store.exitLine() }
                store.step(1)
            } else {
                store.step(along: [uci])
            }
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

                Text(Format.avgDrop(move.avgWinLoss))
                    .font(Theme.Font.mono(11))
                    .foregroundStyle(Format.dropColor(move.avgWinLoss))
                    .frame(width: 42, alignment: .trailing)

                // The mark keeps its column whether or not a row wears it: there are two
                // number columns to its left, and a label that appears on one row in five
                // would shunt them sideways on exactly that row — which is the row the
                // reader is comparing the others against.
                Text(onBoard ? "on board" : (wasPlayed ? "played" : ""))
                    .font(Theme.Font.text(10))
                    .foregroundStyle(onBoard ? Theme.accent : Theme.faint)
                    .frame(width: 44, alignment: .trailing)
            }
            .lineLimit(1)
            .padding(.horizontal, Theme.Metrics.gutter)
            .frame(height: 32)
            .contentShape(Rectangle())
            .background(onBoard ? Theme.rowActive : .clear)
        }
        .buttonStyle(.plain)
    }

    /// The server sends SAN alongside the UCI and that is used when it is there. When it is
    /// not, the notation is derived against the position the entry belongs to — the game
    /// position the book is anchored on, which on a variation is not the board.
    private func san(_ move: BookMove) -> String {
        if let san = move.san { return san }
        guard let uci = move.uci else { return Format.absent }
        return SAN.san(forUCI: uci, fen: store.lineStartFEN) ?? uci
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
