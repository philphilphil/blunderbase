import SwiftUI
import Observation

/// Everything you have written down, newest first.
///
/// The game screen's notes pane answers "what did I say about *this* game". This answers the
/// other half of the same question — "what have I been saying" — and it is a separate tab
/// rather than a filter on the games list because that is how the notes are actually used:
/// as a running log to reread before a session, not as a property of a particular game.
///
/// A row leads with **where the note hangs**, not with the note. That is the opposite of
/// what a message list does, and it is deliberate: a note out of its game is a sentence
/// without a subject, and by the time you are reading the fourth one you have lost track of
/// which game you are in. The anchor is one accent-coloured line above the text, and the
/// text is capped at three lines so a long note cannot push the next anchor off the screen.
struct NotesListView: View {
    @Environment(Session.self) private var session
    @State private var store = NotesStore()

    var body: some View {
        NavigationStack {
            content
                .background(Theme.void)
                .navigationTitle("Notes")
                .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            guard let endpoints = session.endpoints else { return }
            store.attach(endpoints: endpoints, session: session)
            if store.state == .idle { await store.load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle, .loading:
            ProgressView()
                .tint(Theme.accent)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.void)
        case .failed(let message):
            Placeholder(
                symbol: "exclamationmark.triangle",
                tint: Theme.mistake,
                title: message,
                detail: nil,
                actionTitle: "Try again"
            ) {
                Task { await store.load() }
            }
        case .loaded:
            if store.notes.isEmpty {
                Placeholder(
                    symbol: "note.text",
                    tint: Theme.dim,
                    title: "Nothing written down yet",
                    detail: "Notes you write on a move show up here, newest first.",
                    actionTitle: nil,
                    action: nil
                )
            } else {
                list
            }
        }
    }

    private var list: some View {
        List {
            ForEach(store.notes) { note in
                row(note)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
        .refreshable { await store.refresh() }
    }

    /// A note that names a game is a link into it; one that does not is just text.
    ///
    /// The `summary` handed to the detail screen is nil on purpose: a note carries a
    /// `GameBrief`, which is a label rather than a `GameSummary`, and inventing a summary out
    /// of it would put half-filled player rows on screen until the real game loaded.
    @ViewBuilder
    private func row(_ note: NoteResponse) -> some View {
        if let gameID = note.gameID, let endpoints = session.endpoints {
            NavigationLink {
                GameDetailView(gameID: gameID, summary: nil, endpoints: endpoints)
            } label: {
                NoteRow(note: note)
            }
            .buttonStyle(.plain)
        } else {
            NoteRow(note: note)
        }
    }
}

/// One note: where it hangs, what it says, what it was tagged.
private struct NoteRow: View {
    let note: NoteResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let anchor {
                Text(anchor)
                    .font(Theme.Font.mono(11, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .lineLimit(1)
            }
            Text(note.text)
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.body)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            if let tags = note.tags, !tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(tags, id: \.self) { tag in
                        Text(tag)
                            .font(Theme.Font.text(10))
                            .foregroundStyle(Theme.muted2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Theme.chipNeutral, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
                    }
                }
            }
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated2)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// "phib – Hikaru · 18… gxf6", with either half omitted rather than faked.
    ///
    /// The move label comes from the server (`MoveBrief.label`) when it is there, because
    /// the backend spells it once so every client spells it the same; `Format.move` is the
    /// fallback for a brief that carries a ply and a san but no label.
    private var anchor: String? {
        var parts: [String] = []
        if let game = note.game, let players = NoteRow.players(of: game) {
            parts.append(players)
        }
        if let move = moveLabel {
            parts.append(move)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var moveLabel: String? {
        if let label = note.move?.label, !label.isEmpty { return label }
        // Both of these are half-move *counts* — the brief's ply is the note's, which the
        // backend builds the label from — so the move they name is the one before, and
        // `Format.move` wants a 0-based move ply.
        guard let count = note.move?.ply ?? note.ply, count > 0 else { return nil }
        return Format.move(ply: count - 1, san: note.move?.san)
    }

    private static func players(of game: GameBrief) -> String? {
        switch (game.white, game.black) {
        case let (white?, black?): return "\(white) – \(black)"
        case let (white?, nil): return white
        case let (nil, black?): return black
        case (nil, nil): return nil
        }
    }
}

/// The notes tab's own small store.
///
/// It is here rather than in a file of its own because it is one call with no filter and no
/// paging: `GET /notes?limit=50` is the whole feature. The fifty is not a page — there is no
/// "load more" — it is a deliberate ceiling on a log that is meant to be reread, not
/// archived. Anything older is found through search in the web app.
@Observable
@MainActor
final class NotesStore {

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    static let limit = 50

    private(set) var notes: [NoteResponse] = []
    private(set) var state: LoadState = .idle

    @ObservationIgnored private var endpoints: Endpoints?
    /// Weak, and only so a 401 here signs the whole app out rather than leaving this tab
    /// showing an error next to a games list that still looks signed in.
    @ObservationIgnored private weak var session: Session?

    func attach(endpoints: Endpoints, session: Session?) {
        self.session = session
        guard self.endpoints == nil else { return }
        self.endpoints = endpoints
    }

    func load() async {
        await fetch(showingSpinner: true)
    }

    /// Pull-to-refresh keeps the rows on screen while it works: its own spinner already says
    /// something is happening, and blanking the list to redraw the same notes reads as a bug.
    func refresh() async {
        await fetch(showingSpinner: false)
    }

    private func fetch(showingSpinner: Bool) async {
        guard let endpoints else { return }
        if showingSpinner { state = .loading }
        do {
            notes = try await endpoints.notes(limit: NotesStore.limit)
            state = .loaded
        } catch {
            session?.handle(error)
            notes = []
            state = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }
}
