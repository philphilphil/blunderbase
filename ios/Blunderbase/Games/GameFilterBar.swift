import SwiftUI

/// The filters, as a line of chips under the search field.
///
/// The web has a filter *panel* — a column of labelled controls that is always open beside
/// the table. A phone has no column to spare, so the same filters become a row that scrolls
/// sideways, and the trade is deliberate: a chip can say what it is set to but not what it
/// could be set to, so every chip reads as its current value ("Wins", "Blitz, Rapid") rather
/// than as its name once it is on. Off, it reads as its name. That is what lets somebody
/// glance at the bar and know what they are looking at without opening anything.
///
/// The bar owns no state. Every chip calls `store.apply { … }`, which changes the query and
/// reloads from the top — because a filter applied to page four of the old results is not a
/// filter, it is a bug. `GamesStore.query` is read-only from out here for the same reason.
struct GameFilterBar: View {
    let store: GamesStore

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                outcomeChip
                blundersChip
                analysedChip
                speedChip
                sourceChip
                if store.hasFilters { clearChip }
            }
            .padding(.horizontal, Theme.Metrics.gutter)
        }
        .frame(height: 44)
        .background(Theme.panel)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line).frame(height: 0.5)
        }
    }

    // MARK: The chips

    /// Four values in one control. A menu rather than a segmented picker: segments would
    /// eat the width of the whole bar to show three options that are off most of the time.
    ///
    /// Every menu here is buttons-with-checkmarks rather than a `Picker`, because the
    /// selection these menus edit is optional ("no filter") and an optional `Picker` tag has
    /// to match the binding's type exactly or the selection silently never sticks. A button
    /// says what it sets.
    private var outcomeChip: some View {
        Menu {
            ForEach(GameFilterBar.outcomes, id: \.label) { outcome in
                menuItem(outcome.label, isOn: store.query.outcome == outcome.value) { query in
                    query.outcome = outcome.value
                }
            }
        } label: {
            chip(outcomeLabel, isActive: store.query.outcome != nil, hasMenu: true)
        }
        .accessibilityLabel("Filter by result")
    }

    private var outcomeLabel: String {
        switch store.query.outcome {
        case "win": return "Wins"
        case "loss": return "Losses"
        case "draw": return "Draws"
        default: return "Result"
        }
    }

    /// A two-state filter, so a button rather than a menu: the whole interaction is the
    /// answer, and asking somebody to open a menu to pick "on" is a tap wasted.
    private var blundersChip: some View {
        toggleChip(
            "Blunders",
            isOn: store.query.hasBlunders == true,
            accessibility: "Only games with blunders"
        ) { query in
            query.hasBlunders = query.hasBlunders == true ? nil : true
        }
    }

    private var analysedChip: some View {
        toggleChip(
            "Analysed",
            isOn: store.query.analyzed == true,
            accessibility: "Only analysed games"
        ) { query in
            query.analyzed = query.analyzed == true ? nil : true
        }
    }

    /// Speeds are additive on the wire — `speed=blitz&speed=rapid` keeps both — so this is
    /// a menu of independent toggles rather than a picker. The label collapses to a count
    /// past two, because "Bullet, Blitz, Rapid, Classical" is wider than the screen.
    private var speedChip: some View {
        Menu {
            ForEach(GameFilterBar.speeds, id: \.rawValue) { speed in
                menuItem(speed.label, isOn: store.query.speeds.contains(speed)) { query in
                    if let index = query.speeds.firstIndex(of: speed) {
                        query.speeds.remove(at: index)
                    } else {
                        query.speeds.append(speed)
                    }
                }
            }
            if !store.query.speeds.isEmpty {
                Divider()
                menuItem("Any speed", isOn: false) { $0.speeds = [] }
            }
        } label: {
            chip(speedLabel, isActive: !store.query.speeds.isEmpty, hasMenu: true)
        }
        .accessibilityLabel("Filter by time control")
    }

    private var speedLabel: String {
        switch store.query.speeds.count {
        case 0: return "Speed"
        case 1: return store.query.speeds[0].label
        case 2: return store.query.speeds.map(\.label).joined(separator: ", ")
        default: return "\(store.query.speeds.count) speeds"
        }
    }

    private var sourceChip: some View {
        Menu {
            menuItem("Any source", isOn: store.query.source == nil) { $0.source = nil }
            ForEach(GameFilterBar.sources, id: \.rawValue) { source in
                menuItem(source.label, isOn: store.query.source == source) { $0.source = source }
            }
        } label: {
            chip(store.query.source?.label ?? "Source", isActive: store.query.source != nil, hasMenu: true)
        }
        .accessibilityLabel("Filter by where the game came from")
    }

    /// Only present when there is something to clear, so the bar never carries a control
    /// that would do nothing. It clears the search text too — that is a filter like any
    /// other, and leaving it behind would make "Clear" a lie.
    private var clearChip: some View {
        Button {
            Haptics.selectionChanged()
            Task { await store.clearFilters() }
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "xmark")
                    .font(Theme.Font.text(9, weight: .bold))
                Text("Clear")
            }
            .modifier(ChipStyle(isActive: false))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear all filters")
    }

    // MARK: Chip plumbing

    private func toggleChip(
        _ title: String,
        isOn: Bool,
        accessibility: String,
        _ mutate: @escaping (inout GameQuery) -> Void
    ) -> some View {
        Button {
            change(mutate)
        } label: {
            chip(title, isActive: isOn, hasMenu: false)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
        .accessibilityValue(isOn ? "on" : "off")
    }

    private func chip(_ title: String, isActive: Bool, hasMenu: Bool) -> some View {
        HStack(spacing: 3) {
            Text(title)
            if hasMenu {
                Image(systemName: "chevron.down")
                    .font(Theme.Font.text(8, weight: .semibold))
                    .opacity(0.7)
            }
        }
        .modifier(ChipStyle(isActive: isActive))
    }

    /// One row of a menu, with the tick that says it is the value in force.
    private func menuItem(
        _ title: String,
        isOn: Bool,
        _ mutate: @escaping (inout GameQuery) -> Void
    ) -> some View {
        Button {
            change(mutate)
        } label: {
            if isOn {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }

    private func change(_ mutate: @escaping (inout GameQuery) -> Void) {
        Haptics.selectionChanged()
        Task { await store.apply(mutate) }
    }

    private struct OutcomeOption {
        let label: String
        let value: String?
    }

    /// The owner's side of the result, which is what `outcome` means on the wire — a loss
    /// is a loss whichever colour they had.
    private static let outcomes: [OutcomeOption] = [
        OutcomeOption(label: "All results", value: nil),
        OutcomeOption(label: "Wins", value: "win"),
        OutcomeOption(label: "Losses", value: "loss"),
        OutcomeOption(label: "Draws", value: "draw"),
    ]

    /// `.unknown` is this app's word for a value it could not read, not one the server
    /// knows, so neither list offers it as something to filter by.
    private static let speeds: [Speed] = [.bullet, .blitz, .rapid, .classical, .correspondence]
    private static let sources: [Source] = [.lichess, .chesscom, .fics, .pgn, .manual, .masters]
}

/// One chip's look, and its hit target.
///
/// The pill draws at 30pt because that is the height the design's chips are, but a 30pt
/// target is under Apple's minimum, so the padding that brings the row to 44 is part of the
/// tappable shape rather than spacing around it. Separating the two is the whole reason
/// this is a modifier and not a `background` call at each site.
private struct ChipStyle: ViewModifier {
    let isActive: Bool

    func body(content: Content) -> some View {
        content
            .font(Theme.Font.text(12, weight: .medium))
            .foregroundStyle(isActive ? Theme.accentInk : Theme.body2)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(isActive ? Theme.accent : Theme.elevated, in: Capsule())
            .overlay(
                Capsule().strokeBorder(isActive ? Color.clear : Theme.edgeInput, lineWidth: 0.5)
            )
            .padding(.vertical, 7)
            .contentShape(Rectangle())
    }
}

#Preview("Filter bar") {
    VStack(spacing: 0) {
        GameFilterBar(store: GamesStore())
        Spacer()
    }
    .background(Theme.void)
}
