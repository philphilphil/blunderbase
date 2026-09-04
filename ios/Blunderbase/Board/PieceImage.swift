import SwiftUI

/// One piece, as an image.
///
/// The set is cburnett — the same pieces the web app draws, so a position looks the same
/// on both screens. They are vendored as SVG imagesets by `ios/scripts/extract-pieces.swift`
/// rather than pulled from `node_modules` at build time, because an iOS build must not
/// depend on the web app's install step.
///
/// cburnett is by Colin M.L. Burnett, CC BY-SA 3.0.
struct PieceImage: View {
    let piece: ChessPiece

    var body: some View {
        Image(Self.assetName(for: piece))
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            // The pieces are decoration for the position, which is described elsewhere.
            .accessibilityHidden(true)
    }

    /// `piece-wp`, `piece-bn`, … — the names the extraction script writes into the catalog.
    /// Built from the colour and kind letters rather than a twelve-case switch so the two
    /// halves cannot drift apart. `nonisolated` because it is a pure string map and a test
    /// should not have to hop to the main actor to check that all twelve names exist.
    nonisolated static func assetName(for piece: ChessPiece) -> String {
        "piece-\(piece.color.letter)\(piece.kind.letter)"
    }
}

#Preview("All twelve") {
    VStack(spacing: 0) {
        ForEach(PieceColor.allCases, id: \.self) { color in
            HStack(spacing: 0) {
                ForEach(PieceKind.allCases, id: \.self) { kind in
                    PieceImage(piece: ChessPiece(kind, color))
                        .frame(width: 48, height: 48)
                }
            }
        }
    }
    .padding()
    .background(Theme.boardLight)
}
