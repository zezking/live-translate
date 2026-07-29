import SwiftUI
import AppKit

struct OnboardingView: View {
    @Environment(KeychainStore.self) private var keychain
    @State private var entry = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "waveform")
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(.linearGradient(colors: [.blue, .indigo], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 96, height: 96)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))

            VStack(spacing: 6) {
                Text("Live Translate")
                    .font(.largeTitle).bold()
                Text("Enter your Alibaba DashScope API key to enable live translation. It’s stored in your Mac’s Keychain and never leaves this device.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal)
            }

            SecureField("DashScope API Key", text: $entry)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))

            if let error {
                Text(error).foregroundStyle(.red).font(.callout)
            }

            HStack {
                Button("Get a key") {
                    if let url = URL(string: "https://bailian.console.aliyun.com/?apiKey=1") {
                        NSWorkspace.shared.open(url)
                    }
                }
                Spacer()
                Button("Continue") { submit() }
                    .buttonStyle(.borderedProminent)
                    .disabled(entry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(36)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func submit() {
        let key = entry.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { error = "Key can’t be empty."; return }
        keychain.setKey(key)
    }
}
