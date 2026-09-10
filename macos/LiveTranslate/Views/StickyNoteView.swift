import SwiftUI

/// A tap-to-edit "sticky note" pinned above the transcript river on the
/// interpreter screen — typically this week's sermon text (e.g. "Daniel 7:18–28").
/// It renders outside the scrolling river, so it never moves. Click it to type
/// or paste a new note; "Done" persists it via `AppSettings` (UserDefaults).
/// When empty, a placeholder invites the user to add one.
struct StickyNoteView: View {
    @Binding var text: String

    @State private var editing = false
    @State private var draft = ""
    /// Measured height of the note text; drives the ScrollView's height so a
    /// long paste scrolls *inside* the note instead of bleeding out of it.
    @State private var textHeight: CGFloat = maxHeight
    @FocusState private var editorFocused: Bool

    /// Hard cap for the displayed note. The transcript below always keeps
    /// its space, no matter how much text is pasted.
    private static let maxHeight: CGFloat = 160

    // Opaque Post-it palette: solid paper with dark ink, readable in both
    // light and dark mode.
    private static let paper = Color(red: 1.0, green: 0.96, blue: 0.72)
    private static let ink = Color(red: 0.24, green: 0.19, blue: 0.03)

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "pin.fill")
                .font(.caption2)
                .foregroundStyle(.orange)
                .padding(.top, 4)

            if editing {
                editor
            } else {
                display
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Self.paper))
        .padding(.horizontal, 16)
        .padding(.top, 10)
    }

    // MARK: - Display mode

    private var display: some View {
        Group {
            if trimmed.isEmpty {
                Text("Add a sticky note — e.g. “Daniel 7:18–28”")
                    .font(.callout)
                    .italic()
                    .foregroundStyle(Self.ink.opacity(0.5))
            } else {
                ScrollView {
                    Text(text)
                        .font(.callout)
                        .fontWeight(.medium)
                        .foregroundStyle(Self.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(noteHeightReader)
                }
                .frame(height: min(textHeight, Self.maxHeight))
                .onPreferenceChange(NoteHeightKey.self) { textHeight = $0 }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { beginEditing() }
        .help("Click to edit the sticky note")
    }

    // MARK: - Edit mode

    private var editor: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: $draft)
                .font(.callout)
                .foregroundStyle(Self.ink)
                .tint(Self.ink)
                .focused($editorFocused)
                .frame(minHeight: 48, maxHeight: 120)
                .scrollContentBackground(.hidden)

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { endEditing(save: false) }
                    .keyboardShortcut(.cancelAction)
                Button("Done") { endEditing(save: true) }
                    .keyboardShortcut(.defaultAction)
            }
            .font(.callout)
        }
    }

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var noteHeightReader: some View {
        GeometryReader { geo in
            Color.clear.preference(key: NoteHeightKey.self, value: geo.size.height)
        }
    }

    private func beginEditing() {
        draft = text
        editing = true
        // Focus once the editor is in the hierarchy.
        Task { @MainActor in
            editorFocused = true
        }
    }

    private func endEditing(save: Bool) {
        if save { text = draft }
        editing = false
    }
}

/// Reports the wrapped text's full height up to the view.
private struct NoteHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

#Preview("With note") {
    StickyNoteView(text: .constant("Daniel 7:18–28"))
}

#Preview("Empty") {
    StickyNoteView(text: .constant(""))
}
