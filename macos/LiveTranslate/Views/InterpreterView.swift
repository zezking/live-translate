import SwiftUI

/// The always-on session screen: live captions (original + translation) with a
/// level meter and an End button. No push-to-talk — the audio source is treated
/// as a continuous stream.
struct InterpreterView: View {
    let interp: StreamTranslator
    var onEnded: () -> Void = {}
    @Environment(AppSettings.self) private var settings
    @State private var exportText: String?
    @State private var saveError: String?
    /// The exit awaiting confirmation (End button, window close, or app quit).
    @State private var exitRequest: SessionExit?
    /// Set when a save was started from the exit prompt: a successful save
    /// then completes that exit; cancelling or failing keeps the session running.
    @State private var exitAfterSave: SessionExit?
    @State private var hostWindow: NSWindow?
    @State private var guardID = UUID()

    /// Ways a running session can be left. Ending returns to setup and
    /// discards the transcript; closing/quitting also stops the session.
    enum SessionExit {
        case end, closeWindow, quitApp

        var title: String {
            switch self {
            case .end: "Save the transcript before ending?"
            case .closeWindow: "A session is in progress. Close the window?"
            case .quitApp: "A session is in progress. Quit Live Translate?"
            }
        }

        var verb: String {
            switch self {
            case .end: "End"
            case .closeWindow: "Close"
            case .quitApp: "Quit"
            }
        }
    }

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
        .background(
            WindowCloseInterceptor(
                shouldIntercept: { interp.phase != .ended },
                onAttempt: { requestExit(.closeWindow) },
                onWindow: { hostWindow = $0 }
            )
        )
        .onAppear {
            QuitGuard.shared.register(guardID) { requestExit(.quitApp) }
        }
        .onDisappear {
            QuitGuard.shared.unregister(guardID)
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

            if let saveError {
                Text(saveError)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }

            HStack(spacing: 12) {
                // Ending the session returns to setup and discards the
                // transcript, so saving happens before End (here or via the
                // End prompt).
                Button("Save transcript…") { startSave(then: nil) }
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(!interp.hasTranscript)

                Button("End session", role: .destructive) {
                    if interp.hasTranscript {
                        requestExit(.end)
                    } else {
                        perform(.end)
                    }
                }
            }
        }
        .padding(16)
        .confirmationDialog(
            exitRequest?.title ?? "",
            isPresented: Binding(
                get: { exitRequest != nil },
                set: { shown in
                    // Dismissed without a choice (e.g. Esc): treat as Cancel.
                    // Deferred so a button's own handling runs first.
                    if !shown {
                        DispatchQueue.main.async {
                            if let pending = exitRequest {
                                exitRequest = nil
                                cancel(pending)
                            }
                        }
                    }
                }
            ),
            presenting: exitRequest
        ) { exit in
            if interp.hasTranscript {
                Button("Save Transcript & \(exit.verb)…") { choose { startSave(then: exit) } }
            }
            Button(exit == .end ? "End Without Saving"
                   : interp.hasTranscript ? "\(exit.verb) Without Saving" : exit.verb,
                   role: .destructive) { choose { perform(exit) } }
            Button("Cancel", role: .cancel) { choose { cancel(exit) } }
        } message: { exit in
            Text(exit == .end ? "Ending the session discards the transcript."
                 : "This ends the live session\(interp.hasTranscript ? " and discards the transcript" : "").")
        }
        .fileExporter(
            isPresented: Binding(get: { exportText != nil }, set: { if !$0 { exportText = nil } }),
            item: exportText ?? "",
            contentTypes: [.plainText],
            defaultFilename: interp.transcriptFilename
        ) { result in
            let pending = exitAfterSave
            exitAfterSave = nil
            switch result {
            case .success:
                if let pending { perform(pending) }
            case .failure(let error):
                saveError = "Couldn’t save transcript: \(error.localizedDescription)"
                if let pending { cancel(pending) }
            }
        } onCancellation: {
            if let pending = exitAfterSave { cancel(pending) }
            exitAfterSave = nil
        }
    }

    // MARK: Exit flow

    private func requestExit(_ exit: SessionExit) {
        // Already asking or saving: a repeated close/quit just waits on that
        // prompt — but a quit must still be answered, so decline this one.
        guard exitRequest == nil, exitAfterSave == nil else {
            if exit == .quitApp { NSApp.reply(toApplicationShouldTerminate: false) }
            return
        }
        exitRequest = exit
    }

    /// Runs a prompt button's action after clearing the request, so the
    /// dismissal handler doesn't also treat it as a cancel.
    private func choose(_ action: () -> Void) {
        exitRequest = nil
        action()
    }

    private func startSave(then exit: SessionExit?) {
        saveError = nil
        exitAfterSave = exit
        exportText = interp.transcriptText()
    }

    /// Stop the session cleanly, then finish the exit.
    private func perform(_ exit: SessionExit) {
        let window = hostWindow
        Task {
            await interp.end()
            switch exit {
            case .end: break
            case .closeWindow: window?.performClose(nil)
            case .quitApp: NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
    }

    private func cancel(_ exit: SessionExit) {
        if exit == .quitApp { NSApp.reply(toApplicationShouldTerminate: false) }
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
