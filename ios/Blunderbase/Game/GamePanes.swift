import SwiftUI

/// The four panes under the board, and the bar that switches between them.
///
/// These used to live in a sheet that was dragged up over the board. A phone screen turned
/// out to have room for both, and a sheet that is always up is not a sheet — it is a pane
/// with a dimming layer and a gesture that can dismiss it by accident. So the panes sit
/// directly under the transport now, always visible, and the reader resizes them by
/// dragging the grabber instead of summoning them.
///
/// The four tabs are the web's four mobile tabs, in the same order and meaning the same
/// thing: Moves is the game, Eval is its shape, Engine is the advice, Notes is what you
/// wrote down. The order is fixed because this is a control the thumb learns, and a tab
/// that moves is a tab that gets mis-tapped.
struct GamePanes: View {
    @Bindable var store: GameStore
    @Bindable var live: LiveEngineStore
    @Binding var pane: Pane
    let isReadOnly: Bool

    enum Pane: String, CaseIterable, Identifiable {
        case moves = "Moves"
        case eval = "Eval"
        case engine = "Engine"
        case notes = "Notes"
        var id: String { rawValue }
    }

    /// The shortest the panes are allowed to be: the tab bar plus about one row.
    ///
    /// Not zero. Collapsing them to nothing would make the tab bar a control with no
    /// visible effect, and the reader would have to drag blind to find out what is in a
    /// pane. One row is enough to see that a pane has content and what kind.
    static let minimumHeight: CGFloat = 92

    var body: some View {
        VStack(spacing: 0) {
            Picker("Pane", selection: $pane) {
                ForEach(Pane.allCases) { pane in
                    Text(pane.rawValue).tag(pane)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.bottom, 8)
            .onChange(of: pane) { _, _ in Haptics.selectionChanged() }

            Divider().overlay(Theme.hairline)

            Group {
                switch pane {
                case .moves: MovesPane(store: store)
                case .eval: EvalPane(store: store)
                case .engine: EnginePane(store: store, live: live)
                case .notes: NotesPane(store: store, isReadOnly: isReadOnly)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(Theme.surface)
    }
}

/// The bar between the board and the panes: a grabber to drag, and a chevron to toggle.
///
/// Two ways to do the same thing, because they answer different intents. Dragging is for
/// "a bit more room"; the chevron is for "get out of the way, I am reading the move list",
/// which is a single tap and should not require a measured gesture. The whole bar is the
/// drag target rather than just the capsule, since a 4pt handle is not a hit area.
struct PaneHandle: View {
    let isExpanded: Bool
    let onDrag: (CGFloat) -> Void
    let onDragEnded: () -> Void
    let onToggle: () -> Void

    var body: some View {
        ZStack {
            Capsule()
                .fill(Theme.edgeStrong)
                .frame(width: 36, height: 4)

            HStack {
                Spacer()
                Button(action: onToggle) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.dim)
                        .frame(width: 44, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isExpanded ? "Shrink the panels" : "Expand the panels")
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 26)
        .background(Theme.surface)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 2)
                .onChanged { onDrag($0.translation.height) }
                .onEnded { _ in onDragEnded() }
        )
        .accessibilityElement()
        .accessibilityLabel("Panel height")
        .accessibilityHint("Drag to resize the panels")
    }
}
