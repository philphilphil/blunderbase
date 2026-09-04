import SwiftUI

/// Two answers to the same question: what the engine plays in this position, and what a
/// human of your strength plays.
///
/// The comparison is the point. Blunderbase's framing is that the engine says what is best
/// and Maia says what is likely, so the engine's line is the standard and Maia's
/// distribution is what you are measured against — a move most players at your level get
/// wrong is worth more attention than one only Stockfish sees, and that reading only works
/// once you know what the right move was.
///
/// Tapping a line plays its next move onto the board — one move a tap, so the reader walks
/// the variation position by position rather than being dropped at the end of it — and
/// "back to game" undoes all of it in one tap.
///
/// While a variation is open, Maia's half of this pane goes quiet: it is the server's
/// answer about a position in the *game*, and the board is no longer on one. The stored
/// engine lines stay, because they are the lines of the position the variation left from
/// and the reader is in the middle of playing one of them; the part already on the board
/// is drawn brighter so a row reads as "here is where you are, here is what comes next".
/// The live engine follows the board wherever it goes, which is most of why it is worth
/// having.
struct EnginePane: View {
    @Bindable var store: GameStore
    @Bindable var live: LiveEngineStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                engineSection

                if !store.isInLine, store.positionMove != nil {
                    Divider().overlay(Theme.hairline)
                    maiaSection
                }
            }
        }
    }

    private func empty(_ text: String) -> some View {
        Text(text)
            .font(Theme.Font.text(13))
            .foregroundStyle(Theme.dim)
            .padding(Theme.Metrics.gutter)
    }

    // MARK: Maia

    private var maiaSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Humans")
                    .font(Theme.Font.text(12, weight: .medium))
                    .foregroundStyle(Theme.brilliant)

                Spacer(minLength: 4)

                if store.availableMaiaElos.count > 1 {
                    Picker("Level", selection: Binding(
                        get: { store.maiaElo ?? store.availableMaiaElos.last ?? 1500 },
                        set: { store.maiaElo = $0; Haptics.selectionChanged() }
                    )) {
                        ForEach(store.availableMaiaElos, id: \.self) { elo in
                            Text(verbatim: "\(elo)").tag(elo)
                        }
                    }
                    .pickerStyle(.menu)
                    .font(Theme.Font.mono(12))
                    .tint(Theme.brilliant)
                } else if let elo = store.maiaElo {
                    Text(verbatim: "\(elo)")
                        .font(Theme.Font.mono(12))
                        .foregroundStyle(Theme.dim)
                }
            }
            .padding(.horizontal, Theme.Metrics.gutter)
            .frame(height: 30)
            .background(Theme.panel)

            if store.maiaMoves.isEmpty {
                empty("No Maia reading at this position.")
            } else {
                ForEach(Array(store.maiaMoves.prefix(5).enumerated()), id: \.offset) { _, move in
                    maiaRow(move)
                }
            }
        }
    }

    /// One of Maia's guesses, with a bar for how often it picks it.
    ///
    /// The move actually played is tinted with the engine's verdict on it, so the row where
    /// "what most people play" and "what you played" coincide carries its own judgement —
    /// which is the single most useful line in this pane.
    private func maiaRow(_ move: MaiaMove) -> some View {
        let wasPlayed = move.uci == store.positionMove?.uci
        let verdict = store.positionMove?.classification
        return Button {
            play([move.uci])
        } label: {
            HStack(spacing: 8) {
                Text(move.san ?? move.uci)
                    .font(Theme.Font.mono(13, weight: wasPlayed ? .semibold : .regular))
                    .foregroundStyle(wasPlayed ? (verdict?.color ?? Theme.text) : Theme.body)
                    .frame(width: 56, alignment: .leading)

                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.track).frame(height: 5)
                        Capsule()
                            .fill(Theme.brilliant.opacity(0.75))
                            .frame(width: geometry.size.width * CGFloat(move.p ?? 0), height: 5)
                    }
                    .frame(maxHeight: .infinity, alignment: .center)
                }
                .frame(height: 18)

                Text(percent(move.p))
                    .font(Theme.Font.mono(12))
                    .foregroundStyle(Theme.dim)
                    .frame(width: 40, alignment: .trailing)

                if wasPlayed {
                    Text("played")
                        .font(Theme.Font.text(10))
                        .foregroundStyle(Theme.faint)
                }
            }
            .padding(.horizontal, Theme.Metrics.gutter)
            .frame(height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Engine

    private var engineSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Engine")
                    .font(Theme.Font.text(12, weight: .medium))
                    .foregroundStyle(Theme.arrowEngine)

                Spacer(minLength: 4)

                Text(engineSubtitle)
                    .font(Theme.Font.mono(11))
                    .foregroundStyle(live.isOn ? Theme.body2 : Theme.faint)
                    .lineLimit(1)

                // The switch is small and unlabelled because the row it sits in already
                // says what it turns on, and a "Live" label beside a switch beside the word
                // "Engine" is three words for one idea.
                // Scaled down to sit in a 30pt strip, but given a full-size frame so the
                // hit area stays what a thumb expects rather than shrinking with the art.
                Toggle("Live analysis", isOn: liveBinding)
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .tint(Theme.accent)
                    .scaleEffect(0.72)
                    .frame(width: Theme.Metrics.hit, height: 30)
                    .contentShape(Rectangle())
            }
            .padding(.leading, Theme.Metrics.gutter)
            .padding(.trailing, 6)
            .frame(height: 30)
            .background(Theme.panel)

            if live.isOn {
                liveBody
            } else if !store.engineLines.isEmpty {
                ForEach(Array(store.engineLines.prefix(4).enumerated()), id: \.offset) { _, line in
                    engineRow(line)
                }
                playedRow
            } else if store.isInLine {
                // The stored pass never saw this position, and saying "no lines" would read
                // as the engine having nothing to say about it rather than never being asked.
                empty("This position is off the game. Turn on the live engine to read it.")
            } else if store.positionMove == nil {
                empty("The game ends here.")
            } else if store.detail?.runs.isEmpty == true {
                empty("This game has not been analysed yet.")
            } else {
                empty("No engine lines at this position.")
            }
        }
    }

    /// What the header says to the right of the title.
    ///
    /// Off, it describes the stored pass, which is what the rows below it came from. On, it
    /// describes the live search — and names the machine, because a board served by a
    /// desktop's engine over the runner link is the interesting case and the reader cannot
    /// otherwise tell it from a board on the server.
    private var engineSubtitle: String {
        guard live.isOn else {
            guard let run = store.detail?.runs.first else { return "" }
            return runLabel(run)
        }
        switch live.phase {
        case .off: return ""
        case .opening: return "starting…"
        case .failed(let message), .ended(let message): return message
        case .running:
            var parts: [String] = []
            if let depth = live.snapshot?.depth { parts.append("d\(depth)") }
            if let nps = live.snapshot?.nps { parts.append(Format.nodesPerSecond(nps)) }
            if let where_ = live.analysedOn { parts.append(where_) }
            return parts.joined(separator: " · ")
        }
    }

    private var liveBinding: Binding<Bool> {
        Binding(
            get: { live.isOn },
            set: { live.isOn = $0; Haptics.selectionChanged() }
        )
    }

    @ViewBuilder
    private var liveBody: some View {
        switch live.phase {
        case .failed(let message), .ended(let message):
            // A refusal is a sentence the server wrote, and it is always more specific than
            // anything this app could say on its behalf.
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .font(Theme.Font.text(12))
                    .foregroundStyle(Theme.mistake)
                Button("Try again") { live.isOn = false; live.isOn = true }
                    .font(Theme.Font.text(12, weight: .medium))
                    .foregroundStyle(Theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Metrics.gutter)

        case .opening:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(Theme.accent)
                Text("Opening an analysis board")
                    .font(Theme.Font.text(12))
                    .foregroundStyle(Theme.dim)
            }
            .padding(Theme.Metrics.gutter)

        case .off, .running:
            if let snapshot = live.snapshot, !snapshot.lines.isEmpty {
                ForEach(snapshot.lines.prefix(4)) { line in
                    liveRow(line, from: snapshot.fen)
                }
            } else {
                Text("Thinking…")
                    .font(Theme.Font.text(12))
                    .foregroundStyle(Theme.dim)
                    .padding(Theme.Metrics.gutter)
            }
        }
    }

    /// One live line. Deliberately the same shape as a stored one, so switching the toggle
    /// changes the numbers and not the layout — the eye stays where it was.
    ///
    /// The notation is rendered against `fen` — the position the *frame* is about, which the
    /// store carries on the snapshot — and not against the board. The two are the same
    /// position whenever a frame is on screen, and using the frame's own is what keeps that
    /// true: a variation numbered from one position and played out from another reads as a
    /// perfectly ordinary line and is wrong by a move.
    private func liveRow(_ line: LiveLine, from fen: String) -> some View {
        Button {
            // One move, from wherever the board is. A live line is about the position on
            // the board right now, so the next tap reads the engine's fresh lines for the
            // new position rather than continuing an old one.
            if let first = line.pv.first { store.play(uci: first) }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Format.score(cp: line.cp, mate: line.mate) ?? Format.absent)
                    .font(Theme.Font.mono(13, weight: .medium))
                    .foregroundStyle(liveScoreColor(line))
                    .frame(width: 52, alignment: .leading)

                // The wire carries UCI only, so the notation is made here.
                Text(SAN.line(line.pv, from: fen, limit: 8))
                    .font(Theme.Font.mono(12))
                    .foregroundStyle(Theme.body2)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func liveScoreColor(_ line: LiveLine) -> Color {
        if let mate = line.mate { return mate >= 0 ? Theme.good : Theme.blunder }
        guard let cp = line.cp else { return Theme.dim }
        if cp > 50 { return Theme.good }
        if cp < -50 { return Theme.blunder }
        return Theme.body2
    }

    /// One stored line. The moves of it already on the board are drawn bright and the rest
    /// in the pane's usual ink, and the row being walked is tinted like the current move in
    /// the move list — the same "you are here" the rest of the screen uses.
    private func engineRow(_ line: BestLine) -> some View {
        let pv = line.pv ?? []
        let tokens = lineTokens(line)
        let done = store.progress(along: pv)
        let played = tokens.prefix(done).joined(separator: " ")
        let rest = tokens.dropFirst(done).joined(separator: " ")
        return Button {
            store.step(along: pv)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Format.score(cp: line.cp, mate: line.mate) ?? Format.absent)
                    .font(Theme.Font.mono(13, weight: .medium))
                    .foregroundStyle(scoreColor(line))
                    .frame(width: 52, alignment: .leading)

                (Text(played).foregroundStyle(Theme.text)
                    + Text(played.isEmpty || rest.isEmpty ? rest : " " + rest).foregroundStyle(Theme.body2))
                    .font(Theme.Font.mono(12, weight: done > 0 ? .medium : .regular))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(done > 0 ? Theme.rowActive : .clear)
    }

    /// The move that was actually played, as a last row under the engine's own.
    ///
    /// It only earns a row when it is not already the engine's first choice — otherwise it
    /// says nothing the top line has not.
    @ViewBuilder
    private var playedRow: some View {
        if let move = store.positionMove,
           let san = move.san,
           move.uci != store.engineLines.first?.moveUci {
            Divider().overlay(Theme.hairline).padding(.leading, Theme.Metrics.gutter)
            HStack(spacing: 8) {
                Text(Format.winLoss(move.winLoss))
                    .font(Theme.Font.mono(13, weight: .medium))
                    .foregroundStyle(move.classification.color)
                    .frame(width: 52, alignment: .leading)

                Text(san)
                    .font(Theme.Font.mono(12, weight: .medium))
                    .foregroundStyle(Theme.body)

                if move.isFlagged {
                    Text(move.classification.glyph)
                        .font(Theme.Font.mono(11, weight: .bold))
                        .foregroundStyle(move.classification.color)
                }

                Spacer(minLength: 0)

                Text("played")
                    .font(Theme.Font.text(10))
                    .foregroundStyle(Theme.faint)
            }
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.vertical, 7)
        }
    }

    // MARK: Helpers

    /// Tapping a Maia move plays it onto the board.
    ///
    /// It used to draw arrows instead. Arrows answer "which move", and that is worth one
    /// tap at most; the question a reader actually has about a variation is what the
    /// position *looks* like three moves in, and no number of arrows answers that. Playing
    /// it is also reversible in one tap now that there is a way back to the game, which is
    /// what made a preview the safer choice before.
    private func play(_ pv: [String]) {
        guard let first = pv.first else { return }
        store.play(uci: first)
    }

    private func percent(_ p: Double?) -> String {
        guard let p else { return Format.absent }
        return "\(Int((p * 100).rounded()))%"
    }

    /// A principal variation as a reader would write it, one token per move: numbered from
    /// the position the line starts in, with Black's first move after an ellipsis when the
    /// line starts on Black's turn. Tokens rather than one string so the row can draw the
    /// moves already played differently from the ones still to come.
    ///
    /// The server sends SAN alongside the UCI for a stored line, and that is used when it is
    /// there. When it is not, the notation is derived by replaying the line from the
    /// position it belongs to — which is the position the line *left the game from*, not
    /// the board, since on a variation the two differ and a line numbered from the wrong one
    /// reads as a perfectly ordinary line that is off by a move.
    private func lineTokens(_ line: BestLine) -> [String] {
        var sans = Array((line.san ?? []).prefix(8))
        if sans.isEmpty {
            let pv = Array((line.pv ?? []).prefix(8))
            let snapshots = Replay.snapshots(
                from: pv.enumerated().map { ReplayMove(ply: $0.offset + 1, uci: $0.element) },
                startingFEN: store.lineStartFEN
            )
            sans = zip(pv, snapshots).compactMap { uci, before in SAN.san(forUCI: uci, fen: before.fen) }
            if sans.isEmpty, let only = line.moveSan ?? line.moveUci { sans = [only] }
        }
        var out: [String] = []
        var ply = store.cursor + 1
        for san in sans {
            if ply % 2 == 1 {
                out.append("\((ply + 1) / 2). \(san)")
            } else if out.isEmpty {
                out.append("\((ply + 1) / 2)… \(san)")
            } else {
                out.append(san)
            }
            ply += 1
        }
        return out
    }

    /// The engine's score is written from White's side in the pane, matching the eval bar,
    /// so a positive number always means the same thing on this screen.
    private func scoreColor(_ line: BestLine) -> Color {
        if let mate = line.mate { return mate >= 0 ? Theme.good : Theme.blunder }
        guard let cp = line.cp else { return Theme.dim }
        if cp > 50 { return Theme.good }
        if cp < -50 { return Theme.blunder }
        return Theme.body2
    }

    private func runLabel(_ run: RunSummary) -> String {
        var parts: [String] = []
        if let tier = run.tier { parts.append(tier) }
        if let depth = run.depth { parts.append("d\(depth)") }
        if let engine = run.engine { parts.append(engine) }
        return parts.joined(separator: " · ")
    }
}
