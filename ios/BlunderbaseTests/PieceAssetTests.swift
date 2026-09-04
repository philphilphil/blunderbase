import XCTest
import UIKit
import SwiftUI
@testable import Blunderbase

/// That the twelve pieces are actually in the app.
///
/// This is the one failure in the board layer that no other test can see. The pieces are
/// SVGs generated into an asset catalog by a script, referenced by a name built from two
/// letters, and a mismatch between the two — a renamed imageset, a `Contents.json` Xcode
/// quietly rejects, a script that was never re-run after a rename — costs nothing at
/// compile time and produces a board of empty squares at runtime. `Image(_:)` has no
/// failure to observe: a missing asset draws nothing at all.
///
/// So the check goes through `UIImage(named:in:)` against the app bundle, which does report
/// a miss, and asserts on the thing the catalog is for: that the name resolves, and that
/// what comes back has size and survives being drawn.
final class PieceAssetTests: XCTestCase {

    /// The app's bundle, found through a class that ships in the app.
    ///
    /// Not `Bundle.main` and not a class declared here: the tests are hosted by the app, so
    /// `.main` happens to be right today and would silently become the test runner if the
    /// host were ever dropped, while a class declared in this file resolves to the *test*
    /// bundle, where no piece has ever lived. Asking a real app type is the version that
    /// stays true either way.
    private var bundle: Bundle { Bundle(for: Session.self) }

    func testEveryPieceHasAnAsset() {
        for color in PieceColor.allCases {
            for kind in PieceKind.allCases {
                let name = PieceImage.assetName(for: ChessPiece(kind, color))
                let image = UIImage(named: name, in: bundle, compatibleWith: nil)
                XCTAssertNotNil(image, "missing asset \(name)")
                XCTAssertGreaterThan(image?.size.width ?? 0, 0, "\(name) has no size")
                XCTAssertGreaterThan(image?.size.height ?? 0, 0, "\(name) has no size")
            }
        }
    }

    func testTheAssetNamesAreTheTwelveTheScriptWrites() {
        let names = PieceColor.allCases.flatMap { color in
            PieceKind.allCases.map { PieceImage.assetName(for: ChessPiece($0, color)) }
        }
        XCTAssertEqual(Set(names).count, 12, "two pieces map to the same asset name")
        XCTAssertEqual(
            Set(names),
            ["piece-wp", "piece-wn", "piece-wb", "piece-wr", "piece-wq", "piece-wk",
             "piece-bp", "piece-bn", "piece-bb", "piece-br", "piece-bq", "piece-bk"]
        )
    }

    /// A vector imageset that Xcode accepted still has to *draw* something. An SVG that
    /// failed to parse can come back as a valid-looking image of blank pixels, which is
    /// exactly what a board of empty squares looks like.
    func testAPieceDrawsSomethingRatherThanBlankPixels() throws {
        let name = PieceImage.assetName(for: ChessPiece(.knight, .white))
        let image = try XCTUnwrap(UIImage(named: name, in: bundle, compatibleWith: nil))

        let side = 64
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        let drawn = renderer.image { context in
            // A mid grey ground, so both the white fill and the black outline of a cburnett
            // piece differ from it. On white or black, half the piece would be invisible.
            UIColor(white: 0.5, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: side, height: side))
            image.draw(in: CGRect(x: 0, y: 0, width: side, height: side))
        }

        let cgImage = try XCTUnwrap(drawn.cgImage)
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let space = CGColorSpaceCreateDeviceRGB()
        let context = try XCTUnwrap(CGContext(
            data: &pixels,
            width: side, height: side,
            bitsPerComponent: 8, bytesPerRow: side * 4,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))

        let differing = stride(from: 0, to: pixels.count, by: 4).count { index in
            abs(Int(pixels[index]) - 128) > 40
        }
        XCTAssertGreaterThan(
            differing, side * side / 20,
            "the knight drew almost nothing over the ground — the SVG probably did not parse"
        )
    }
}
