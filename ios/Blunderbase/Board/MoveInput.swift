import SwiftUI

/// Making a move on the board with a finger.
///
/// The board is an analysis board, so a move played here is a question rather than a game
/// move — "what if I had taken instead" — and the interaction is built for asking that
/// quickly and taking it back just as quickly.
///
/// **Tap-to-move rather than drag.** Dragging a piece across a board that is barely wider
/// than a hand puts the piece under the finger that is aiming it, and on a phone the piece
/// is about forty points across. Tapping the piece and then the square keeps the board
/// visible the whole time and takes the same two touches. Tapping the piece again, or any
/// square it cannot reach, clears the selection.
///
/// The legal squares come from the same generator that writes the notation, so a square a
/// finger may tap is exactly a move that can be spelled.
@Observable
@MainActor
final class MoveInput {

    /// The piece waiting for a destination, if any.
    private(set) var selected: BoardSquare?
    /// Where it may go. Empty whenever nothing is selected.
    private(set) var destinations: Set<BoardSquare> = []
    /// A pawn move waiting for the reader to choose a piece.
    private(set) var promotion: PendingPromotion?

    /// A move that has been decided but not yet played, held while the picker is up.
    struct PendingPromotion: Equatable {
        let from: BoardSquare
        let to: BoardSquare
        let color: PieceColor
    }

    /// Handle a tap on a square, given the position on the board.
    ///
    /// Returns the move to play when the tap completed one, and nil when it only changed the
    /// selection. Promotions return nil and raise `promotion` instead, because the move is
    /// not fully decided until a piece is chosen.
    func tapped(_ square: BoardSquare, fen: String) -> (from: BoardSquare, to: BoardSquare)? {
        guard promotion == nil else { return nil }

        if let from = selected, destinations.contains(square) {
            clear()
            if SAN.isPromotion(from: from, to: square, fen: fen) {
                promotion = PendingPromotion(from: from, to: square, color: sideToMove(in: fen))
                return nil
            }
            return (from, square)
        }

        if square == selected {
            clear()
            return nil
        }

        let legal = SAN.legalDestinations(from: square, fen: fen)
        // Selecting a piece that cannot move would leave a highlight with nothing to do,
        // which reads as the board being stuck rather than the piece being stuck.
        guard !legal.isEmpty else {
            clear()
            return nil
        }
        selected = square
        destinations = Set(legal)
        Haptics.selectionChanged()
        return nil
    }

    /// The reader chose a piece; hand back the whole move.
    func choose(_ kind: PieceKind) -> (from: BoardSquare, to: BoardSquare, promotion: PieceKind)? {
        guard let pending = promotion else { return nil }
        promotion = nil
        return (pending.from, pending.to, kind)
    }

    func cancelPromotion() {
        promotion = nil
    }

    func clear() {
        selected = nil
        destinations = []
    }

    private func sideToMove(in fen: String) -> PieceColor {
        let fields = fen.split(separator: " ", omittingEmptySubsequences: true)
        guard fields.count >= 2 else { return .white }
        return fields[1] == "b" ? .black : .white
    }
}

/// The four pieces a pawn may become.
///
/// A row rather than a menu: the choice is one of four every time, and a menu would hide
/// three of them behind a tap. Queen is first and largest because it is the answer almost
/// always; the other three are there so that the one game where a knight mates is possible
/// to enter at all.
struct PromotionPicker: View {
    let color: PieceColor
    let onChoose: (PieceKind) -> Void
    let onCancel: () -> Void

    private static let kinds: [PieceKind] = [.queen, .rook, .bishop, .knight]

    var body: some View {
        VStack(spacing: 10) {
            Text("Promote to")
                .font(Theme.Font.text(12))
                .foregroundStyle(Theme.dim)

            HStack(spacing: 8) {
                ForEach(PromotionPicker.kinds, id: \.self) { kind in
                    Button {
                        onChoose(kind)
                    } label: {
                        PieceImage(piece: ChessPiece(kind, color))
                            .frame(width: 44, height: 44)
                            .padding(4)
                            .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(kind.rawValue)
                }
            }

            Button("Cancel", action: onCancel)
                .font(Theme.Font.text(12))
                .foregroundStyle(Theme.accent)
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card)
                .strokeBorder(Theme.edgeStrong, lineWidth: 1)
        )
        .shadow(color: Theme.void.opacity(0.6), radius: 12, y: 4)
    }
}
