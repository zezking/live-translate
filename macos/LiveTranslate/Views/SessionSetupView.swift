import SwiftUI
import CoreAudio
import ScreenCaptureKit
import AppKit

struct SessionSetupView: View {
    @Environment(KeychainStore.self) private var keychain
    @Environment(AppSettings.self) private var settings

    @State private var interp: StreamTranslator?
    @State private var started = false
    @State private var browserWindow: SCWindow?

    var body: some View {
        Group {
            if let interp, started {
                InterpreterView(interp: interp) {
                    started = false
                    self.interp = nil
                }
            } else {
                setup
            }
        }
    }

    private var setup: some View {
        VStack(spacing: 0) {
            Form {
                Section("Languages") {
                    Picker("You speak", selection: bind(\.sourceLanguage)) {
                        ForEach(Language.all) { Text($0.name).tag($0.code) }
                    }
                    Picker("Translate to", selection: bind(\.targetLanguage)) {
                        ForEach(Language.all) { Text($0.name).tag($0.code) }
                    }
                }
                Section("Voice") {
                    Toggle("Translated voice-over", isOn: bind(\.voiceOver))
                    if settings.voiceOver {
                        Text("Uses Qwen voice cloning to match the speaker’s timbre.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Section("Input") {
                    Picker("Source", selection: bindInputMode()) {
                        ForEach(InputMode.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    switch settings.inputMode {
                    case .mic:
                        DevicePicker()
                    case .browser:
                        BrowserSourcePicker(selectedWindow: $browserWindow)
                    }
                }
                if settings.sourceLanguage == settings.targetLanguage {
                    Text("Pick two different languages.")
                        .foregroundStyle(.orange)
                        .font(.callout)
                }
            }
            .formStyle(.grouped)

            Divider()
            HStack {
                Button("Sign out", role: .destructive) { keychain.clearKey() }
                Spacer()
                Button("Start interpreter") { start() }
                    .buttonStyle(.borderedProminent)
                    .disabled(settings.sourceLanguage == settings.targetLanguage || (settings.inputMode == .browser && browserWindow == nil))
            }
            .padding(16)
        }
        .navigationSubtitle("Interpreter mode")
    }

    private func start() {
        let source: AudioSource
        var label = "Microphone"
        switch settings.inputMode {
        case .mic:
            source = AudioCaptureEngine()
        case .browser:
            let engine = ScreenCaptureAudioEngine()
            engine.selectedWindow = browserWindow
            source = engine
            label = browserWindow?.owningApplication?.applicationName ?? "Browser"
        }
        let model = StreamTranslator(
            apiKey: keychain.apiKey,
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
            voiceOver: settings.voiceOver,
            voiceClone: true,
            source: source,
            sourceLabel: label
        )
        interp = model
        started = true
    }

    private func bindInputMode() -> Binding<InputMode> {
        Binding(get: { settings.inputMode }, set: { settings.inputMode = $0 })
    }

    private func bind(_ keyPath: ReferenceWritableKeyPath<AppSettings, String>) -> Binding<String> {
        Binding(get: { settings[keyPath: keyPath] }, set: { settings[keyPath: keyPath] = $0 })
    }

    private func bind(_ keyPath: ReferenceWritableKeyPath<AppSettings, Bool>) -> Binding<Bool> {
        Binding(get: { settings[keyPath: keyPath] }, set: { settings[keyPath: keyPath] = $0 })
    }
}

/// Lists audio input devices and sets the chosen one as the system default
/// (which AVAudioEngine captures from).
struct DevicePicker: View {
    @State private var devices: [AudioInputDevice] = []
    @State private var selected: AudioDeviceID = 0

    var body: some View {
        HStack {
            Picker("Input device", selection: $selected) {
                ForEach(devices) { Text($0.name).tag($0.id) }
            }
            .onChange(of: selected) { _, newValue in
                AudioDevices.setDefaultInputDevice(newValue)
            }
            Button("Refresh") { reload() }
        }
        .onAppear { reload() }
    }

    private func reload() {
        devices = AudioDevices.inputDevices()
        selected = AudioDevices.defaultInputDeviceID() ?? (devices.first?.id ?? 0)
    }
}

/// Lists on-screen browser/app windows (via ScreenCaptureKit) and lets the user
/// pick one to capture audio from. Requires the Screen Recording TCC permission.
struct BrowserSourcePicker: View {
    @Binding var selectedWindow: SCWindow?

    @State private var windows: [SCWindow] = []
    @State private var status: LoadState = .idle
    @State private var selectionTitle: String?

    private enum LoadState { case idle, loading, ready, denied, failed }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Menu {
                    ForEach(windows, id: \.windowID) { win in
                        Button(label(win)) { choose(win) }
                    }
                    if windows.isEmpty {
                        Button(status == .loading ? "Loading…" : "No windows — retry") { load() }
                            .disabled(true)
                    }
                } label: {
                    Label(selectionTitle ?? "Pick a window…", systemImage: "rectangle.on.rectangle")
                        .lineLimit(1)
                }
                Button("Refresh") { load() }
            }

            switch status {
            case .denied:
                VStack(alignment: .leading, spacing: 2) {
                    Text("Screen Recording permission required.")
                        .font(.caption).foregroundStyle(.orange)
                    Text("After enabling it, quit (⌘Q) and reopen the app, then Refresh.")
                        .font(.caption2).foregroundStyle(.secondary)
                    Button("Open System Settings") { openPrivacyPane() }
                        .font(.caption)
                }
            case .failed:
                Text("Couldn't list windows. Try Refresh.")
                    .font(.caption).foregroundStyle(.orange)
            default:
                EmptyView()
            }
        }
        .onAppear { if selectionTitle == nil { load() } }
    }

    private func choose(_ win: SCWindow) {
        selectedWindow = win
        selectionTitle = label(win)
    }

    private func label(_ win: SCWindow) -> String {
        let app = win.owningApplication?.applicationName ?? "App"
        let title = win.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? app : "\(app) — \(title)"
    }

    private func load() {
        status = .loading
        Task {
            let preflight = CGPreflightScreenCaptureAccess()
            LTLog.log("[sc-pick] preflight screenCaptureAccess=\(preflight)")
            if !preflight {
                let requested = CGRequestScreenCaptureAccess()
                LTLog.log("[sc-pick] requested access -> \(requested)")
            }
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(
                    false, onScreenWindowsOnly: true)
                LTLog.log("[sc-pick] shareable content OK: \(content.windows.count) windows, \(content.applications.count) apps")
                let usable = content.windows.filter { win in
                    let app = win.owningApplication?.applicationName ?? ""
                    let title = win.title ?? ""
                    return !app.isEmpty && !title.isEmpty
                }.sorted(by: {
                    let a = $0.owningApplication?.applicationName ?? ""
                    let b = $1.owningApplication?.applicationName ?? ""
                    return a.localizedCaseInsensitiveCompare(b) == .orderedAscending
                })
                await MainActor.run {
                    self.windows = usable
                    self.status = usable.isEmpty ? .failed : .ready
                }
            } catch {
                let ns = error as NSError
                LTLog.log("[sc-pick] shareable content FAILED: \(error.localizedDescription) domain=\(ns.domain) code=\(ns.code)")
                await MainActor.run { self.status = .denied }
            }
        }
    }


    private func openPrivacyPane() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }
}
