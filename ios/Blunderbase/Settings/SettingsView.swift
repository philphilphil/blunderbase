import SwiftUI

/// What this app is pointed at, how the board behaves, and who made the pieces.
///
/// A settings screen for a one-owner, one-server app is mostly a *statement* rather than a
/// set of controls: the server, whether it will accept writes, and which Maia levels it has
/// are facts about the deployment that this app cannot change, and showing them is how
/// somebody confirms they are on the instance they think they are on. The only thing here
/// that is genuinely a preference is the Board section.
///
/// The Maia levels are worth the row they take. Which ratings a deployment asks the human
/// model at is a deployment-time choice, and it decides what every Maia reading in the app
/// means — a comparison against a 1500 is a different claim from one against a 1900.
struct SettingsView: View {
    @Environment(Session.self) private var session

    /// Board preferences.
    ///
    /// `@AppStorage` here because these are switches bound to a view; everywhere else the
    /// same three are read through `Preferences`, which owns the key strings. Two of them
    /// are read when a game opens — the board's side and whether the arrows start up — and
    /// the third is read at each tap, so haptics stop on the next one rather than the next
    /// launch. Changing a key means changing `Preferences.Key` and these three lines
    /// together; that is the whole reason the strings live in one type.
    @AppStorage(Preferences.Key.ownerAtBottom) private var ownerAtBottom = true
    @AppStorage(Preferences.Key.showHints) private var showHints = true
    @AppStorage(Preferences.Key.haptics) private var haptics = true

    /// The theme. The same key is read by `BlunderbaseApp`, which is where the choice is
    /// applied to the window; this screen only writes it.
    @AppStorage(Preferences.Key.appearance) private var appearance = Preferences.Appearance.system

    @State private var isConfirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                serverSection
                appearanceSection
                boardSection
                aboutSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.void)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: Server

    private var serverSection: some View {
        Section {
            row("Server", value: serverLabel)
            if session.isReadOnly {
                row("Access", value: "Read-only")
            }
            row("Maia levels", value: maiaLevels)
            row("Target Elo", value: String(session.maiaTargetElo))

            Button("Sign out") {
                isConfirmingSignOut = true
            }
            .font(Theme.Font.text(15))
            .foregroundStyle(Theme.blunder)
            .frame(minHeight: Theme.Metrics.hit)
            .confirmationDialog(
                "Sign out of this Blunderbase?",
                isPresented: $isConfirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    Task { await session.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The address is kept, so signing back in only needs the password.")
            }
        } header: {
            sectionHeader("Server")
        }
        .listRowBackground(Theme.surface)
    }

    private var serverLabel: String {
        guard let url = session.serverURL else { return "Not connected" }
        return url.host() ?? url.absoluteString
    }

    /// Every rating this deployment asks Maia at, lowest first. A deployment with none
    /// configured says so rather than showing an empty row: "which levels does this server
    /// have" has "none" as a real answer.
    private var maiaLevels: String {
        session.maiaElos.isEmpty
            ? "None"
            : session.maiaElos.sorted().map(String.init).joined(separator: ", ")
    }

    // MARK: Appearance

    /// Three states rather than a switch, for the same reason the web app's titlebar toggle
    /// has three: "follow the phone" is a different answer from "dark", and a two-state
    /// switch cannot say it. A segmented control shows all three at once, which is the
    /// point — the reader can see that following the phone is an option without opening
    /// anything.
    private var appearanceSection: some View {
        Section {
            Picker("Appearance", selection: $appearance) {
                ForEach(Preferences.Appearance.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(minHeight: 34)
        } header: {
            sectionHeader("Appearance")
        } footer: {
            Text("System follows the phone's own setting. Dark is the design's own look.")
                .font(Theme.Font.text(11))
                .foregroundStyle(Theme.faint)
        }
        .listRowBackground(Theme.surface)
    }

    // MARK: Board

    private var boardSection: some View {
        Section {
            toggle("Owner at the bottom", isOn: $ownerAtBottom)
            toggle("Show hints", isOn: $showHints)
            toggle("Haptics", isOn: $haptics)
        } header: {
            sectionHeader("Board")
        } footer: {
            Text("Hints are the engine and Maia arrows over the board.")
                .font(Theme.Font.text(11))
                .foregroundStyle(Theme.faint)
        }
        .listRowBackground(Theme.surface)
    }

    // MARK: About

    private var aboutSection: some View {
        Section {
            row("Version", value: SettingsView.version)
            Text("Chess rules and PGN by chesskit-swift, MIT licence.")
                .font(Theme.Font.text(12))
                .foregroundStyle(Theme.dim)
            Text("Pieces: cburnett by Colin M. L. Burnett, CC BY-SA 3.0.")
                .font(Theme.Font.text(12))
                .foregroundStyle(Theme.dim)
        } header: {
            sectionHeader("About")
        }
        .listRowBackground(Theme.surface)
    }

    /// `1.2.0 (34)` — the marketing version with the build behind it, because a TestFlight
    /// build's number is the only thing that distinguishes two copies of the same version.
    private static let version: String = {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String
        let build = info?["CFBundleVersion"] as? String
        switch (short, build) {
        case let (short?, build?): return "\(short) (\(build))"
        case let (short?, nil): return short
        default: return Format.absent
        }
    }()

    // MARK: Row shapes

    private func row(_ label: String, value: String) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(Theme.Font.text(15))
                .foregroundStyle(Theme.body)
            Spacer(minLength: 8)
            Text(value)
                .font(Theme.Font.mono(13))
                .foregroundStyle(Theme.dim)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(minHeight: 34)
        .accessibilityElement(children: .combine)
    }

    private func toggle(_ label: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            Text(label)
                .font(Theme.Font.text(15))
                .foregroundStyle(Theme.body)
        }
        .tint(Theme.accent)
        .frame(minHeight: 34)
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(Theme.Font.text(11, weight: .semibold))
            .foregroundStyle(Theme.faint)
            .textCase(.uppercase)
    }
}

#Preview("Settings") {
    SettingsView()
        .environment(Session())
}
