import SwiftUI
import CoreAudio

struct SessionSetupView: View {
    @Environment(KeychainStore.self) private var keychain
    @Environment(AppSettings.self) private var settings

    @State private var interp: DuoInterpreter?
    @State private var started = false

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
                    DevicePicker()
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
                    .disabled(settings.sourceLanguage == settings.targetLanguage)
            }
            .padding(16)
        }
        .navigationSubtitle("Interpreter mode")
    }

    private func start() {
        let model = DuoInterpreter(
            apiKey: keychain.apiKey,
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
            voiceOver: settings.voiceOver,
            voiceClone: true
        )
        interp = model
        started = true
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
