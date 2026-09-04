import SwiftUI

/// The game as a move table, paired the way a scoresheet pairs it.
///
/// Every move is a button, so the table is the game's index as well as its record. The row
/// under the cursor is tinted rather than outlined, because an outline on a row this short
/// reads as a text field.
///
/// Two things are carried over from the web deliberately: a flagged move wears its glyph
/// inline instead of in a separate column, so the criticism sits on the move it is about;
/// and the clock turns amber under twenty seconds, which is how time trouble becomes
/// visible while reading rather than something you go and check.
struct MovesPane: View {
    @Bindable var store: GameStore

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(pairs, id: \.number) { pair in
                        row(pair)
                            .id(pair.number)
                    }

                    if store.isInLine {
                        // The variation is shown after the game rather than spliced into it.
                        // Inline is what the desktop does, where a row has width to spare; on
                        // a phone it would push the game's own moves around every time a line
                        // grows, and the thing a reader is trying to keep hold of is the game.
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Your line")
                                .font(Theme.Font.text(11, weight: .medium))
                                .foregroundStyle(Theme.brilliant)
                            Text(store.lineText)
                                .font(Theme.Font.mono(13))
                                .foregroundStyle(Theme.body)
                                .multilineTextAlignment(.leading)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Theme.Metrics.gutter)
                        .padding(.vertical, 8)
                        .background(Theme.elevated2)
                    }

                    if store.replayIsTruncated {
                        // The replay stopped before the move list did, so the board below
                        // this point is not the game. Said here because this is the only
                        // pane where the missing tail is visible as an absence.
                        Label(
                            "The replay stopped here. The rest of this game could not be played out.",
                            systemImage: "exclamationmark.triangle"
                        )
                        .font(Theme.Font.text(11))
                        .foregroundStyle(Theme.mistake)
                        .padding(.horizontal, Theme.Metrics.gutter)
                        .padding(.vertical, 8)
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: store.cursor) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(currentPairNumber, anchor: .center)
                }
            }
            .onAppear {
                proxy.scrollTo(currentPairNumber, anchor: .center)
            }
        }
    }

    private func row(_ pair: MovePair) -> some View {
        HStack(spacing: 0) {
            Text(verbatim: "\(pair.number).")
                .font(Theme.Font.mono(13))
                .foregroundStyle(Theme.faint)
                .frame(width: 34, alignment: .trailing)
                .padding(.trailing, 8)

            moveCell(pair.white)
            moveCell(pair.black)
        }
        .frame(height: 32)
        .background(isCurrent(pair) ? Theme.rowActive : .clear)
    }

    @ViewBuilder
    private func moveCell(_ move: MoveRow?) -> some View {
        if let move {
            Button {
                store.seek(to: move.ply)
            } label: {
                HStack(spacing: 4) {
                    Text(move.san ?? "…")
                        .font(Theme.Font.mono(14, weight: store.cursor == move.ply ? .semibold : .regular))
                        .foregroundStyle(store.cursor == move.ply ? Theme.textBright : Theme.body)

                    if move.isFlagged {
                        Text(move.classification.glyph)
                            .font(Theme.Font.mono(12, weight: .bold))
                            .foregroundStyle(move.classification.color)
                    }

                    if store.notedPlies.contains(move.ply) {
                        Image(systemName: "text.quote")
                            .font(.system(size: 9))
                            .foregroundStyle(Theme.accent)
                    }

                    Spacer(minLength: 0)

                    if let clock = move.clock {
                        Text(Format.clock(clock))
                            .font(Theme.Font.mono(11))
                            .foregroundStyle(Format.clockColor(clock))
                    }
                }
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            Color.clear.frame(maxWidth: .infinity)
        }
    }

    private func isCurrent(_ pair: MovePair) -> Bool {
        pair.number == currentPairNumber && store.cursor > 0
    }

    private var currentPairNumber: Int {
        max(1, (store.cursor + 1) / 2)
    }

    /// White and Black's moves for one whole move, built from the ply stream.
    ///
    /// The ply is the truth here, not the position in the array: a game that starts from a
    /// position, or one whose move list the server trimmed to a window, has a first ply
    /// that is not 1, and pairing by array index would silently shift every row.
    private var pairs: [MovePair] {
        var byNumber: [Int: MovePair] = [:]
        for move in store.moves {
            let number = (move.ply + 1) / 2
            var pair = byNumber[number] ?? MovePair(number: number, white: nil, black: nil)
            if move.ply % 2 == 1 { pair.white = move } else { pair.black = move }
            byNumber[number] = pair
        }
        return byNumber.values.sorted { $0.number < $1.number }
    }

    private struct MovePair {
        let number: Int
        var white: MoveRow?
        var black: MoveRow?
    }
}
