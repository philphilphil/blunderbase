import SwiftUI

/// What you wrote down about this game, and the box to write more.
///
/// The composer sits **under** the list rather than inside it, which is the one rule the
/// web's notes track states outright: switching what you are looking at must never move
/// the box somebody is typing in. On a phone the same rule matters more, because the
/// keyboard is already covering half the screen and a box that jumps is a lost sentence.
///
/// A note hangs where the board is. That is stated rather than chosen — the composer says
/// "on 18… gxf6" and saving pins it to that ply — because a picker for it would be a
/// control nobody would touch and a source of notes filed against the wrong move.
struct NotesPane: View {
    @Bindable var store: GameStore
    let isReadOnly: Bool

    @State private var draft: String = ""
    @State private var isSaving = false
    @State private var failed = false
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            list
            if !isReadOnly {
                Divider().overlay(Theme.hairline)
                composer
            }
        }
    }

    // MARK: List

    @ViewBuilder
    private var list: some View {
        if store.notesForGame.isEmpty {
            VStack(spacing: 6) {
                Text("No notes on this game.")
                    .font(Theme.Font.text(13))
                    .foregroundStyle(Theme.dim)
                if !isReadOnly {
                    Text("Write one below and it hangs on the move you are looking at.")
                        .font(Theme.Font.text(12))
                        .foregroundStyle(Theme.faint)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(Theme.Metrics.gutter)
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(store.notesForGame) { note in
                        row(note)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func row(_ note: NoteResponse) -> some View {
        Button {
            if let ply = note.ply { store.seek(to: ply) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(anchor(note))
                        .font(Theme.Font.mono(11, weight: .medium))
                        .foregroundStyle(Theme.accent)

                    Spacer(minLength: 4)

                    ForEach(note.tags ?? [], id: \.self) { tag in
                        Text(tag)
                            .font(Theme.Font.text(10))
                            .foregroundStyle(Theme.muted2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Theme.chipNeutral, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
                    }
                }
                Text(note.text)
                    .font(Theme.Font.text(13))
                    .foregroundStyle(Theme.body)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(store.cursor == note.ply ? Theme.rowActive : .clear)
    }

    /// Where a note hangs, said in a reader's terms. A note on the whole game says so
    /// rather than showing a ply of zero.
    private func anchor(_ note: NoteResponse) -> String {
        guard let ply = note.ply, ply > 0 else { return "on the game" }
        let san = store.moves.first { $0.ply == ply }?.san
        return "on \(Format.move(ply: ply, san: san))"
    }

    // MARK: Composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(composerAnchor)
                    .font(Theme.Font.mono(11, weight: .medium))
                    .foregroundStyle(Theme.accent)
                Spacer(minLength: 4)
                if failed {
                    Text("could not save")
                        .font(Theme.Font.text(11))
                        .foregroundStyle(Theme.blunder)
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField("Write a note", text: $draft, axis: .vertical)
                    .font(Theme.Font.text(14))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1...4)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 7)
                    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Radius.control)
                            .strokeBorder(composerFocused ? Theme.accent.opacity(0.6) : Theme.edgeInput, lineWidth: 1)
                    )
                    .focused($composerFocused)

                Button {
                    save()
                } label: {
                    if isSaving {
                        ProgressView().controlSize(.small).tint(Theme.accentInk)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .semibold))
                    }
                }
                .buttonStyle(.plain)
                .frame(width: 36, height: 36)
                .foregroundStyle(canSave ? Theme.accentInk : Theme.faint2)
                .background(canSave ? Theme.accent : Theme.elevated, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
                .disabled(!canSave)
            }
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.vertical, 8)
        .background(Theme.panel)
    }

    private var composerAnchor: String {
        guard store.cursor > 0, let move = store.playedMove else { return "on the game" }
        return "on \(Format.move(ply: move.ply, san: move.san))"
    }

    private var canSave: Bool {
        !isSaving && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func save() {
        let text = draft
        isSaving = true
        failed = false
        Task {
            let ok = await store.saveNote(text: text, tags: [])
            isSaving = false
            if ok {
                draft = ""
                composerFocused = false
            } else {
                failed = true
            }
        }
    }
}
