import SwiftUI

/// The first screen anyone sees, and the only one that is ever the whole app.
///
/// It is not a sheet. There is nothing behind it to go back to — until a server is named and
/// a password accepted there is no library, no notes and no game — and presenting it as
/// something dismissable would offer a way out that does not exist.
///
/// The screen has one job at a time and takes it from `Session.state`, which is why there is
/// no local notion of "signing in": a spinner is `.checking`, an error is `.failed`, and this
/// view never decides which. The one piece of state it does keep is
/// `isEditingServer` — see its own comment.
///
/// The tone is deliberate. Somebody typing their own server's address into a phone app is
/// halfway through a setup they already understand, so the copy says what this app is
/// (a reader for a Blunderbase they host) and then gets out of the way. No marketing, no
/// illustration, no onboarding carousel.
struct ConnectView: View {
    @Environment(Session.self) private var session

    @State private var address = ""
    @State private var password = ""
    /// Whether the address field is showing over a server that is already stored.
    ///
    /// `Session` has no "forget the server" verb — the URL is `private(set)` and `signOut()`
    /// keeps it — so "Use a different server" cannot clear the session back to
    /// `.needsServer`. It does not need to: `connect(to:)` replaces the stored address
    /// outright, so showing the field is the whole of the escape hatch, and the flag is what
    /// remembers that it was asked for.
    @State private var isEditingServer = false

    @FocusState private var focus: Field?

    private enum Field { case address, password }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            mark
            Spacer().frame(height: 28)
            form
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.void)
        .onAppear {
            if let stored = session.serverURL, address.isEmpty {
                address = stored.host() ?? stored.absoluteString
            }
        }
    }

    /// The mark, then the name.
    ///
    /// `Image("AppIcon")` does not resolve at runtime — an app icon is not a fetchable asset
    /// — so the same artwork ships once more as the `Logo` imageset. It is the icon's
    /// artwork rather than the bare pawn from `docs/design/brand/logo.png` on purpose: the
    /// pawn is black on transparent and vanishes on the dark ground, while the icon carries
    /// its own off-white tile and reads on either theme. Drawn at icon proportions, with the
    /// continuous corner the home screen gives it, so it is recognisably the thing the
    /// reader just tapped.
    private var mark: some View {
        VStack(spacing: 12) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Theme.hairline, lineWidth: 0.5)
                )
                .accessibilityHidden(true)
            Text("Blunderbase")
                .font(Theme.Font.text(22, weight: .semibold))
                .foregroundStyle(Theme.textBright)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var form: some View {
        switch session.state {
        case .needsServer:
            serverForm
        case .checking:
            checking
        case .needsSetup:
            needsSetup
        case .signedOut:
            if isEditingServer {
                serverForm
            } else {
                passwordForm
            }
        case .signedIn:
            // The root view swaps this screen out on `.signedIn`; showing a spinner rather
            // than nothing covers the frame between the state changing and that happening.
            checking
        case .failed(let message):
            failed(message)
        }
    }

    // MARK: Naming a server

    private var serverForm: some View {
        VStack(spacing: 14) {
            Text("This app reads a Blunderbase you host. Enter its address to get started.")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
                .multilineTextAlignment(.center)

            TextField("blunderbase.example.org", text: $address)
                .textFieldStyle(.plain)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.URL)
                .submitLabel(.go)
                .focused($focus, equals: .address)
                .onSubmit(connect)
                .modifier(FieldStyle())

            Button("Connect", action: connect)
                .buttonStyle(PrimaryButton(isEnabled: canConnect))
                .disabled(!canConnect)
        }
    }

    private var canConnect: Bool {
        !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }

    private func connect() {
        guard canConnect else { return }
        focus = nil
        isEditingServer = false
        let typed = address
        Task { await session.connect(to: typed) }
    }

    // MARK: Signing in

    private var passwordForm: some View {
        VStack(spacing: 14) {
            if let host = session.serverURL?.host() {
                Text(host)
                    .font(Theme.Font.mono(12))
                    .foregroundStyle(Theme.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            SecureField("Password", text: $password)
                .textFieldStyle(.plain)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($focus, equals: .password)
                .onSubmit(signIn)
                .modifier(FieldStyle())

            Button("Sign in", action: signIn)
                .buttonStyle(PrimaryButton(isEnabled: canSignIn))
                .disabled(!canSignIn)

            Button("Use a different server") {
                password = ""
                isEditingServer = true
                focus = .address
            }
            .buttonStyle(QuietButton())
        }
    }

    private var canSignIn: Bool {
        !password.isEmpty && !isBusy
    }

    private func signIn() {
        guard canSignIn else { return }
        focus = nil
        let typed = password
        Task {
            await session.signIn(password: typed)
            // Only cleared once the attempt is over, so a wrong password can be corrected
            // rather than retyped.
            if session.isSignedIn { password = "" }
        }
    }

    // MARK: The other three states

    private var checking: some View {
        ProgressView()
            .tint(Theme.accent)
            .frame(height: 120)
    }

    /// A server with no password cannot be fixed from here: the first password is chosen in
    /// the browser, where the setup form lives. Offering a password field would be offering
    /// to do something this app cannot do.
    private var needsSetup: some View {
        VStack(spacing: 14) {
            Text("This Blunderbase has not been set up yet.")
                .font(Theme.Font.text(14))
                .foregroundStyle(Theme.body)
                .multilineTextAlignment(.center)
            Text("Open it in a browser and choose a password there, then come back.")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
                .multilineTextAlignment(.center)
            Button("Check again") {
                Task { await session.refresh() }
            }
            .buttonStyle(PrimaryButton(isEnabled: !isBusy))
            .disabled(isBusy)

            Button("Use a different server") {
                isEditingServer = true
                focus = .address
            }
            .buttonStyle(QuietButton())
        }
    }

    /// A failure says what went wrong and offers the two ways out: the same server again, or
    /// a different one. Which of them is right depends on whether the address was wrong or
    /// the network was, and the app cannot tell — but the person can.
    @ViewBuilder
    private func failed(_ message: String) -> some View {
        if isEditingServer {
            VStack(spacing: 14) {
                Text(message)
                    .font(Theme.Font.text(13))
                    .foregroundStyle(Theme.blunder)
                    .multilineTextAlignment(.center)
                serverForm
            }
        } else {
            VStack(spacing: 14) {
                Text(message)
                    .font(Theme.Font.text(14))
                    .foregroundStyle(Theme.blunder)
                    .multilineTextAlignment(.center)

                Button("Try again") {
                    Task {
                        if session.hasServer {
                            await session.refresh()
                        } else {
                            await session.connect(to: address)
                        }
                    }
                }
                .buttonStyle(PrimaryButton(isEnabled: !isBusy))
                .disabled(isBusy)

                Button(session.hasServer ? "Use a different server" : "Enter an address") {
                    isEditingServer = true
                    focus = .address
                }
                .buttonStyle(QuietButton())
            }
        }
    }

    private var isBusy: Bool {
        session.state == .checking
    }
}

/// The one field style in the app: a filled input on the elevated ground, with the edge the
/// design gives every input. Tall enough to be a comfortable target on its own.
private struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(Theme.Font.text(15))
            .foregroundStyle(Theme.text)
            .tint(Theme.accent)
            .padding(.horizontal, 12)
            .frame(height: Theme.Metrics.hit)
            .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Theme.Radius.control))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.control)
                    .strokeBorder(Theme.edgeInput, lineWidth: 0.5)
            )
    }
}

/// The screen's one committing action. Disabled is drawn rather than dimmed by the system,
/// so the accent's ink stays legible on the muted fill instead of going grey on grey.
private struct PrimaryButton: ButtonStyle {
    let isEnabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Font.text(15, weight: .semibold))
            .foregroundStyle(isEnabled ? Theme.accentInk : Theme.faint)
            .frame(maxWidth: .infinity)
            .frame(height: Theme.Metrics.hit)
            .background(
                isEnabled ? Theme.accent : Theme.elevated,
                in: RoundedRectangle(cornerRadius: Theme.Radius.control)
            )
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// The secondary way out. Text only: it is a change of mind, not an action, and giving it a
/// fill would make the screen ask two questions at once.
private struct QuietButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Font.text(13))
            .foregroundStyle(Theme.accentLink)
            .frame(maxWidth: .infinity)
            .frame(height: Theme.Metrics.hit)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

#Preview("Connect") {
    ConnectView()
        .environment(Session())
}
