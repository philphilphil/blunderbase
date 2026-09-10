import SwiftUI

/// A section is a heading over a rule.
///
/// The web's `components/shell/Section.tsx`, on the phone: a small capitalised label, an
/// optional control on the right, and a strong rule under both. A region is bounded by that
/// rule and by a change of surface, never by a rounded box — the boxes are what made every
/// screen read as a template, and taking them away is most of what makes a screen read as
/// this app. Every tab that has sections uses this one, so the heads line up from tab to tab.
struct SectionHead<Control: View>: View {
    let title: Text
    @ViewBuilder let control: () -> Control

    init(_ title: LocalizedStringKey, @ViewBuilder control: @escaping () -> Control) {
        self.title = Text(title)
        self.control = control
    }

    init(text: Text, @ViewBuilder control: @escaping () -> Control) {
        self.title = text
        self.control = control
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            title
                .font(Theme.Font.text(11, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .textCase(.uppercase)
                .kerning(0.6)
            Spacer(minLength: 4)
            control()
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.top, 18)
        .padding(.bottom, 6)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.edgeStrong)
                .frame(height: 0.5)
                .padding(.horizontal, Theme.Metrics.gutter)
        }
    }
}

extension SectionHead where Control == EmptyView {
    init(_ title: LocalizedStringKey) {
        self.init(title) { EmptyView() }
    }
}

/// A window control as text: `All · 1y · 90d · 30d`, the one in force on a raised ground.
///
/// The system segmented picker is a pill of pills, and at 180 points it is the widest thing
/// in a section head. The web draws the same choice as bare words in the head's own line and
/// so does this — a choice between four short words does not need a frame each.
struct TextSegments<Option: Hashable>: View {
    let options: [Option]
    let label: (Option) -> String
    @Binding var selection: Option

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                let isOn = option == selection
                Button {
                    guard !isOn else { return }
                    selection = option
                    Haptics.selectionChanged()
                } label: {
                    Text(label(option))
                        .font(Theme.Font.text(12, weight: isOn ? .semibold : .regular))
                        .foregroundStyle(isOn ? Theme.text : Theme.dim)
                        .padding(.horizontal, 7)
                        .frame(height: 22)
                        .background(
                            isOn ? Theme.elevated : Color.clear,
                            in: RoundedRectangle(cornerRadius: Theme.Radius.chip)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isOn ? .isSelected : [])
            }
        }
    }
}

/// The line under a large title: the two or three numbers that say how big the thing on
/// this tab is, in mono, `4,200 games · 11,060 blunders`. The same shape on every tab, so a
/// tab is recognised by its title and its numbers before anything under them has loaded.
struct TitleLine: View {
    let text: Text

    init(_ text: Text) { self.text = text }

    var body: some View {
        text
            .font(Theme.Font.mono(12))
            .foregroundStyle(Theme.dim)
            .lineLimit(1)
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.top, 2)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
