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

/// Live captions: the cumulative original (prominent) and its translation
/// (secondary), replacing on every delta and auto-scrolling to the latest.
struct LiveTranscriptView: View {
    let interp: StreamTranslator

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if interp.original.isEmpty && interp.translation.isEmpty {
                        Text(hint)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    } else {
                        // Both slots are always reserved so neither field shifts
                        // position as content arrives. Translation sits on top
                        // (that's what's read into the broadcast mic); original is
                        // anchored beneath as a muted reference.

                        // Slot 1 — translation (always rendered; placeholder until ready)
                        CaptionLabel(text: interp.targetName)
                        if interp.translation.isEmpty {
                            Text("Translating…")
                                .font(.title3)
                                .italic()
                                .foregroundStyle(.tertiary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text(interp.translation)
                                .font(.title3)
                                .fontWeight(.medium)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        // Slot 2 — original (reference, fixed beneath translation)
                        if !interp.original.isEmpty {
                            CaptionLabel(text: interp.sourceName)
                            Text(interp.original)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: interp.original) { _, _ in scrollToBottom(proxy) }
            .onChange(of: interp.translation) { _, _ in scrollToBottom(proxy) }
        }
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
