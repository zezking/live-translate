import SwiftUI

/// The always-on session screen: live captions (original + translation) with a
/// level meter and an End button. No push-to-talk — the audio source is treated
/// as a continuous stream.
struct InterpreterView: View {
    let interp: StreamTranslator
    var onEnded: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            LiveTranscriptView(interp: interp)
            Divider()
            controls
        }
        .task { await interp.begin() }
        .onChange(of: interp.phase) { _, phase in
            if phase == .ended { onEnded() }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            statusDot
            if interp.phase == .ready {
                Text("\(interp.sourceLabel) → \(interp.targetName)")
                    .foregroundStyle(.secondary)
                    .font(.callout)
                    .lineLimit(1)
            }
            Spacer()
            ProgressView(value: Double(interp.level))
                .progressViewStyle(.linear)
                .frame(width: 120)
                .tint(interp.level > 0.02 ? .green : .gray)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder private var statusDot: some View {
        switch interp.phase {
        case .idle: StatusDot(color: .gray, label: "Idle")
        case .connecting: StatusDot(color: .orange, label: "Connecting…")
        case .ready: StatusDot(color: .green, label: "Live")
        case .ended: StatusDot(color: .gray, label: "Ended")
        }
    }

    private var controls: some View {
        VStack(spacing: 12) {
            if let error = interp.lastError {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
            }

            Button("End session", role: .destructive) {
                Task { await interp.end() }
            }
        }
        .padding(16)
    }
}

/// Live captions as a river: finished slices scroll up and stay readable; the
/// live slice sits at the bottom. Translation prominent, original as a muted
/// reference beneath it — per slice.
struct LiveTranscriptView: View {
    let interp: StreamTranslator

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if interp.entries.isEmpty {
                        Text(hint)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    }
                    ForEach(interp.entries) { entry in
                        sliceView(entry)
                            .id(entry.id)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: interp.entries) { _, _ in scrollToBottom(proxy) }
        }
    }

    private func sliceView(_ entry: StreamTranslator.RiverEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            // Slot 1 — translation (what's read into the broadcast mic)
            CaptionLabel(text: interp.targetName)
            if entry.translation.isEmpty {
                Text("Translating…")
                    .font(.title3)
                    .italic()
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(entry.translation)
                    .font(.title3)
                    .fontWeight(.medium)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Slot 2 — original (muted reference)
            if !entry.original.isEmpty {
                CaptionLabel(text: interp.sourceName)
                Text(entry.original)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .opacity(entry.live ? 1 : 0.75)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.15)) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    private var hint: String {
        switch interp.phase {
        case .connecting: return "Connecting to Qwen…"
        case .ready: return "Listening — speak into the source."
        case .ended: return "Session ended."
        default: return ""
        }
    }
}

struct StatusDot: View {
    let color: Color
    let label: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.callout).foregroundStyle(.secondary)
        }
    }
}

/// Tiny uppercase language tag sitting above a transcript block.
struct CaptionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundStyle(.tertiary)
            .tracking(0.5)
    }
}
