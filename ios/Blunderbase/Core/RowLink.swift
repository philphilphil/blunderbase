import SwiftUI

/// A list row that pushes a screen, without the disclosure chevron.
///
/// A `NavigationLink` sitting directly in a `List` gets a `>` on its trailing edge. On these
/// rows — a game, a note — the whole row is the affordance and everyone knows a row is
/// tapped to get in, so the chevron is noise: it crowds the rows' own trailing column
/// (the result, the eval sparkline) and says nothing. The link is kept, invisible, in the
/// row's background: the row stays a real push with the back gesture and the row highlight,
/// only the indicator is gone. `EmptyView` as the label is what stops the chevron; `opacity`
/// rather than `hidden` is what keeps the link tappable.
struct RowLink<Label: View, Destination: View>: View {
    @ViewBuilder let destination: () -> Destination
    @ViewBuilder let label: () -> Label

    var body: some View {
        label()
            .background {
                NavigationLink(destination: destination) { EmptyView() }
                    .opacity(0)
            }
    }
}
