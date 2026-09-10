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
/// **A tap plays the move and the pane moves with it.** One move a tap, and the book that
/// comes back is the book of the position that move led to, so the reader clicks down a line
/// row by row and reads their own history of every position on the way. The move this game
/// went on with steps the game forward rather than opening a variation that is the game in
/// disguise; anything else is a variation, and its book is asked for one position at a time
/// (`GameStore.loadBookForBoard`), which is what `.task` below is for.
struct BookPane: View {
    @Bindable var store: GameStore

    var body: some View {
        ScrollView {
            if let entry = store.bookHere, let moves = entry.moves, !moves.isEmpty {
                BookTable(
                    entry: entry,
                    fen: store.snapshot.fen,
                    playedUci: store.positionMove?.uci,
                    engineHidden: store.engineHidden
                ) { move, wasPlayed in
                    guard let uci = move.uci else { return }
                    if wasPlayed {
                        // The game's own move: go on with the game rather than opening a
                        // line that is the game in disguise, so the next position's book
                        // comes from the payload rather than from a request.
                        store.step(1)
                    } else {
                        // One move onto the board, from wherever the board is — not
                        // `step(along:)`, which starts a fresh line from the game whenever
                        // the board has gone another way, and would make the second tap of
                        // a walk undo the first.
                        store.play(uci: uci)
                    }
                }
            } else if store.isLoadingBook {
                waiting
            } else {
                empty(emptyText)
            }
        }
        // The board's position is the id, so the book is asked for once per position and
        // again when the reader plays on. On the game line the store answers from the
        // payload and never leaves the phone.
        .task(id: store.snapshot.fen) {
            await store.loadBookForBoard()
        }
    }

    /// Why there is nothing to draw, in the reader's terms rather than the payload's.
    ///
    /// Two different absences, and only one of them is about this position. A game with no
    /// book anywhere along it is the library saying it has not seen this opening twice yet,
    /// which is a fact about the library and worth explaining once; a position the owner has
    /// reached only in this game is the ordinary case, which needs one line and no
    /// explanation.
    private var emptyText: String {
        if !store.hasBook, !store.isInLine {
            return String(localized: "No opening book yet: it needs two games through the same position.")
        }
        return String(localized: "You have not been here in another game.")
    }

    /// While a position off the game line is being looked up.
    ///
    /// It matters that this is not the empty text: "you have not been here" followed a
    /// moment later by five rows is the pane contradicting itself, and on a slow connection
    /// that is the only sentence a reader would ever see.
    private var waiting: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small).tint(Theme.accent)
            Text("Looking this position up")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Metrics.gutter)
    }

    private func empty(_ text: String) -> some View {
        Text(text)
            .font(Theme.Font.text(13))
            .foregroundStyle(Theme.dim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Metrics.gutter)
    }
}
