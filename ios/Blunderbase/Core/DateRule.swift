import SwiftUI

/// A day, as a rule across a list.
///
/// The games list and the notes list are both in time order, and both used to say the date
/// on every row — the same "5 Sep" three or four times per screen. The web's notes screen
/// settled this (`docs/design/README.md`, 2026-09-02): time cuts the list into date rules
/// that cost a line rather than a column, and the rows keep the room. A rule is a mono day
/// label over a hairline, on the app ground rather than the rows' surface, so the list
/// reads as bands of a day each.
struct DateRule: View {
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(Theme.Font.mono(11))
                .foregroundStyle(Theme.faint)
                .lineLimit(1)
                .fixedSize()
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.void)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A list cut into days, newest first as the list already is.
///
/// The label is what a person says about the day — "Today", "Yesterday", then the date with
/// the year only when it is not this one — and items with no date at all go under one
/// "Undated" rule at the end rather than being dropped, because a note without a date is
/// still a note. Consecutive items on the same day share a group; the input is assumed to
/// be sorted already, which both lists are by the server.
struct DayGroup<Item>: Identifiable {
    let label: String
    var items: [Item]
    var id: String { label }

    static func cut(
        _ items: [Item],
        date: (Item) -> Date?,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [DayGroup<Item>] {
        var groups: [DayGroup<Item>] = []
        for item in items {
            let label = dayLabel(date(item), now: now, calendar: calendar)
            if let last = groups.indices.last, groups[last].label == label {
                groups[last].items.append(item)
            } else {
                groups.append(DayGroup(label: label, items: [item]))
            }
        }
        return groups
    }

    static func dayLabel(_ date: Date?, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date else { return String(localized: "Undated") }
        if calendar.isDate(date, inSameDayAs: now) { return String(localized: "Today") }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return String(localized: "Yesterday")
        }
        return Format.dayName(date, now: now, calendar: calendar)
    }
}
