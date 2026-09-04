#!/usr/bin/env swift
//
// extract-pieces.swift — turns chessground's cburnett stylesheet into an asset catalog.
//
// The web app draws its pieces with `@lichess-org/chessground`, whose piece sets ship as
// one CSS file per set with every piece inlined as a base64 SVG data URI. The phone wants
// the same twelve images, and wants them as files in the app bundle rather than as a build
// step: `node_modules` is not present in a Docker build, on a fresh clone before `pnpm
// install`, or on a CI runner that only builds the iOS target. So this script is run by
// hand when the piece set changes, and its output is committed.
//
//   swift ios/scripts/extract-pieces.swift
//
// Pieces are cburnett, by Colin M.L. Burnett, CC BY-SA 3.0. The licence is why the set is
// named in the app's About screen and in ios/README.md rather than silently vendored.

import Foundation

// MARK: Paths

let repositoryRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // scripts
    .deletingLastPathComponent()  // ios
    .deletingLastPathComponent()  // repository root

let cssPath = repositoryRoot
    .appendingPathComponent("web/node_modules/@lichess-org/chessground/assets/chessground.cburnett.css")
let outputRoot = repositoryRoot
    .appendingPathComponent("ios/Blunderbase/Resources/Assets.xcassets")
let piecesRoot = outputRoot.appendingPathComponent("Pieces")

// MARK: Naming

/// chessground names a piece `.pawn.white`; the app names the same image `piece-wp`, which
/// is the form `PieceImage` builds from a `ChessPiece` (colour letter, then kind letter).
let kindLetters = [
    "pawn": "p", "knight": "n", "bishop": "b", "rook": "r", "queen": "q", "king": "k",
]
let colorLetters = ["white": "w", "black": "b"]

// MARK: Extract

guard let css = try? String(contentsOf: cssPath, encoding: .utf8) else {
    FileHandle.standardError.write(
        Data(
            """
            Could not read \(cssPath.path)
            Run `pnpm install` in web/ first — this script reads the checked-out chessground package.

            """.utf8))
    exit(1)
}

// `.cg-wrap piece.pawn.white { background-image: url('data:image/svg+xml;base64,…') }`
let pattern = #"piece\.(\w+)\.(\w+)\s*\{[^}]*?base64,([A-Za-z0-9+/=]+)"#
guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) else {
    FileHandle.standardError.write(Data("Bad pattern\n".utf8))
    exit(1)
}

let range = NSRange(css.startIndex..<css.endIndex, in: css)
let matches = regex.matches(in: css, range: range)

var written: [String] = []

for match in matches {
    guard let kindRange = Range(match.range(at: 1), in: css),
        let colorRange = Range(match.range(at: 2), in: css),
        let dataRange = Range(match.range(at: 3), in: css),
        let kind = kindLetters[String(css[kindRange])],
        let color = colorLetters[String(css[colorRange])],
        let decoded = Data(base64Encoded: String(css[dataRange])),
        var svg = String(data: decoded, encoding: .utf8)
    else { continue }

    // cburnett's SVGs declare width/height but no viewBox. Xcode will render them, but a
    // vector asset without a viewBox has no intrinsic coordinate system to scale against,
    // so it can come out fixed at 45pt in a 44pt square. Adding the viewBox the width and
    // height already imply is the whole fix and changes nothing about the artwork.
    if !svg.contains("viewBox"), let insertion = svg.range(of: "<svg") {
        svg.replaceSubrange(insertion, with: #"<svg viewBox="0 0 45 45""#)
    }

    let name = "piece-\(color)\(kind)"
    let imageset = piecesRoot.appendingPathComponent("\(name).imageset")
    try? FileManager.default.createDirectory(at: imageset, withIntermediateDirectories: true)

    let contents = """
        {
          "images" : [
            {
              "filename" : "\(name).svg",
              "idiom" : "universal"
            }
          ],
          "info" : {
            "author" : "xcode",
            "version" : 1
          },
          "properties" : {
            "preserves-vector-representation" : true,
            "template-rendering-intent" : "original"
          }
        }

        """

    do {
        try svg.write(to: imageset.appendingPathComponent("\(name).svg"), atomically: true, encoding: .utf8)
        try contents.write(to: imageset.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
        written.append(name)
    } catch {
        FileHandle.standardError.write(Data("Could not write \(name): \(error)\n".utf8))
        exit(1)
    }
}

// MARK: Catalog scaffolding

/// A folder in an asset catalog is only a folder to Xcode if it has a `Contents.json`.
/// Neither of these declares `provides-namespace`, so the asset names stay flat and a
/// piece is `Image("piece-wp")` rather than `Image("Pieces/piece-wp")`.
let scaffold = """
    {
      "info" : {
        "author" : "xcode",
        "version" : 1
      }
    }

    """
for folder in [outputRoot, piecesRoot] {
    let contents = folder.appendingPathComponent("Contents.json")
    if !FileManager.default.fileExists(atPath: contents.path) {
        try? scaffold.write(to: contents, atomically: true, encoding: .utf8)
    }
}

print("Wrote \(written.count) imagesets to \(piecesRoot.path)")
for name in written.sorted() { print("  \(name)") }
if written.count != 12 {
    FileHandle.standardError.write(Data("Expected 12 pieces, got \(written.count)\n".utf8))
    exit(1)
}
