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
    @FocusState private var editorFocused: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "pin.fill")
                .font(.caption2)
                .foregroundStyle(.yellow)
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
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.yellow.opacity(0.12)))
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
                    .foregroundStyle(.tertiary)
            } else {
                Text(text)
                    .font(.callout)
                    .fontWeight(.medium)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
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

#Preview("With note") {
    StickyNoteView(text: .constant("Daniel 7:18–28"))
}

#Preview("Empty") {
    StickyNoteView(text: .constant(""))
}
