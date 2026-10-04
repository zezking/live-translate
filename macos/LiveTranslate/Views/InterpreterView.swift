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
/// plus a vertical rule keeps the original↔translation pairing glanceable,
/// and a single column header replaces the per-slice labels.
///
/// Columns are laid out by `LedgerColumns` (a fixed 40/60 split, row height =
/// tallest cell). The rule is an overlay on the source cell — never a
/// `Divider()` inside an HStack, which turns vertical and greedily eats all
/// available height (it blew the header up to half the window and broke rows).
struct LiveTranscriptView: View {
    let interp: StreamTranslator

    private let edgePadding: CGFloat = 20

    var body: some View {
        VStack(spacing: 0) {
            columnHeader
            Divider()
            transcriptBody
        }
    }

    /// ENGLISH | 中文 — one header for the whole list, aligned over the columns.
    private var columnHeader: some View {
        LedgerColumns {
            sourceCell(CaptionLabel(text: interp.sourceName), verticalPadding: 8)
            translationCell(CaptionLabel(text: interp.targetName), verticalPadding: 8)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var transcriptBody: some View {
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
                        sliceRow(entry)
                            .id(entry.id)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                        rowSeparator
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
            }
            .frame(maxHeight: .infinity)
            .onChange(of: interp.entries) { _, _ in scrollToBottom(proxy) }
        }
    }

    /// One slice: original left, translation right, top-aligned so the pairing
    /// reads across. History fades slightly; the live slice gets a soft highlight.
    private func sliceRow(_ entry: StreamTranslator.RiverEntry) -> some View {
        LedgerColumns {
            // Left — source original (muted reference)
            sourceCell(
                Group {
                    if entry.original.isEmpty {
                        Text(" ")
                    } else {
                        Text(entry.original)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                },
                verticalPadding: 10
            )

            // Right — translation (read into the broadcast mic; prominent)
            translationCell(
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
                },
                verticalPadding: 10
            )
        }
        .background(entry.live ? Color.primary.opacity(0.045) : Color.clear)
        .opacity(entry.live ? 1 : 0.75)
    }

    // MARK: Column cells — shared by header and rows so the rule lines up.

    /// Source (English) cell, with the column rule on its trailing edge.
    /// `maxHeight: .infinity` lets it stretch to the row height LedgerColumns
    /// proposes, so the rule spans the full row.
    private func sourceCell<Content: View>(_ content: Content, verticalPadding: CGFloat) -> some View {
        content
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, edgePadding)
            .padding(.vertical, verticalPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .overlay(alignment: .trailing) {
                Rectangle()
                    .fill(Color.primary.opacity(0.12))
                    .frame(width: 1)
            }
    }

    /// Translation (中文) cell.
    private func translationCell<Content: View>(_ content: Content, verticalPadding: CGFloat) -> some View {
        content
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, edgePadding)
            .padding(.vertical, verticalPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Hairline between committed rows (softer than the column rule).
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

/// Two-column row layout: the first subview gets `sourceFraction` of the
/// width, the second the rest. Height is the taller cell's natural height
/// (never greedy), and both cells are then placed at that height so
/// backgrounds/rules span the full row.
struct LedgerColumns: Layout {
    var sourceFraction: CGFloat = 0.4

    private func widths(_ total: CGFloat) -> (CGFloat, CGFloat) {
        let left = (total * sourceFraction).rounded()
        return (left, max(total - left, 0))
    }

    private func rowHeight(_ subviews: Subviews, _ w: (CGFloat, CGFloat)) -> CGFloat {
        guard subviews.count == 2 else { return 0 }
        let a = subviews[0].sizeThatFits(ProposedViewSize(width: w.0, height: nil)).height
        let b = subviews[1].sizeThatFits(ProposedViewSize(width: w.1, height: nil)).height
        return max(a, b)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let total = proposal.width ?? 600
        return CGSize(width: total, height: rowHeight(subviews, widths(total)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        let w = widths(bounds.width)
        let h = bounds.height
        subviews[0].place(at: bounds.origin, anchor: .topLeading,
                          proposal: ProposedViewSize(width: w.0, height: h))
        subviews[1].place(at: CGPoint(x: bounds.minX + w.0, y: bounds.minY), anchor: .topLeading,
                          proposal: ProposedViewSize(width: w.1, height: h))
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
