import SwiftUI

/// The always-on session screen: live captions (original + translation) with a
/// level meter and an End button. No push-to-talk — the audio source is treated
/// as a continuous stream.
struct InterpreterView: View {
    let interp: StreamTranslator
    var onEnded: () -> Void = {}
    @Environment(AppSettings.self) private var settings

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            StickyNoteView(
                text: Binding(get: { settings.stickyNote }, set: { settings.stickyNote = $0 }),
                colorHex: Binding(get: { settings.stickyNoteHex }, set: { settings.stickyNoteHex = $0 }),
                opacity: Binding(get: { settings.stickyNoteOpacity }, set: { settings.stickyNoteOpacity = $0 })
            )
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

/// Live captions as a two-column ledger: the source original (muted, left)
/// beside the translation (prominent, right), one row per slice. A shared row
/// plus a fixed vertical divider keeps the original↔translation pairing
/// glanceable, and sticky column headers replace the per-slice labels.
struct LiveTranscriptView: View {
    let interp: StreamTranslator

    /// Fraction of the transcript width given to the source (left) column;
    /// the translation (right, read aloud) takes the rest.
    private static let sourceFraction: CGFloat = 0.4
    private let edgePadding: CGFloat = 20

    var body: some View {
        GeometryReader { geo in
            let sourceWidth = geo.size.width * Self.sourceFraction
            VStack(spacing: 0) {
                columnHeader(sourceWidth: sourceWidth)
                Divider()
                transcriptBody(sourceWidth: sourceWidth)
            }
        }
    }

    /// ENGLISH | 中文 — one header for the whole list, aligned over the columns.
    private func columnHeader(sourceWidth: CGFloat) -> some View {
        HStack(spacing: 0) {
            CaptionLabel(text: interp.sourceName)
                .padding(.leading, edgePadding)
                .padding(.trailing, edgePadding)
                .frame(width: sourceWidth, alignment: .leading)
            Divider()
            CaptionLabel(text: interp.targetName)
                .padding(.leading, edgePadding)
                .padding(.trailing, edgePadding)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
    }

    private func transcriptBody(sourceWidth: CGFloat) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if interp.entries.isEmpty {
                        Text(hint)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    }
                    ForEach(interp.entries) { entry in
                        sliceRow(entry, sourceWidth: sourceWidth)
                            .id(entry.id)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                        rowSeparator
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: interp.entries) { _, _ in scrollToBottom(proxy) }
        }
    }

    /// One slice: original left, translation right, top-aligned so the pairing
    /// reads across. History fades slightly; the live slice gets a soft highlight.
    private func sliceRow(_ entry: StreamTranslator.RiverEntry, sourceWidth: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 0) {
            // Left — source original (muted reference)
            Group {
                if entry.original.isEmpty {
                    Text(" ")
                } else {
                    Text(entry.original)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
            .padding(.leading, edgePadding)
            .padding(.trailing, edgePadding)
            .frame(width: sourceWidth, alignment: .leading)

            Divider()

            // Right — translation (read into the broadcast mic; prominent)
            Group {
                if entry.translation.isEmpty {
                    Text("Translating…")
                        .font(.title3)
                        .italic()
                        .foregroundStyle(.tertiary)
                } else {
                    Text(entry.translation)
                        .font(.title3)
                        .fontWeight(.medium)
                        .textSelection(.enabled)
                }
            }
            .padding(.leading, edgePadding)
            .padding(.trailing, edgePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
        .background(entry.live ? Color.primary.opacity(0.045) : Color.clear)
        .opacity(entry.live ? 1 : 0.75)
    }

    /// Hairline between committed rows (softer than the column Divider).
    private var rowSeparator: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.06))
            .frame(height: 1)
            .padding(.leading, edgePadding)
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

/// Tiny uppercase language tag naming a transcript column.
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
