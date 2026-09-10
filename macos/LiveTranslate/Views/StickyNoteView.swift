import SwiftUI

/// A tap-to-edit "sticky note" pinned above the transcript river on the
/// interpreter screen — typically this week's sermon text (e.g. "Daniel 7:18–28").
/// It renders outside the scrolling river, so it never moves. Click it to type
/// or paste a new note; "Done" persists it via `AppSettings` (UserDefaults).
/// When empty, a placeholder invites the user to add one.
struct StickyNoteView: View {
    @Binding var text: String
    /// Paper colour (sRGB hex "RRGGBB") and paper opacity (0–1).
    @Binding var colorHex: String
    @Binding var opacity: Double

    @State private var editing = false
    @State private var draft = ""
    /// Measured height of the note text; drives the ScrollView's height so a
    /// long paste scrolls *inside* the note instead of bleeding out of it.
    @State private var textHeight: CGFloat = maxHeight
    @FocusState private var editorFocused: Bool

    /// Hard cap for the displayed note. The transcript below always keeps
    /// its space, no matter how much text is pasted.
    private static let maxHeight: CGFloat = 160

    /// Paper as picked, with the user's transparency applied over the dark
    /// backdrop; ink flips dark/cream based on the composited brightness so
    /// the text stays readable at any colour/opacity.
    private var paper: Color { Color(hex: colorHex).opacity(opacity) }
    private var ink: Color {
        let composited = Color(hex: colorHex).relativeLuminance * opacity
        return composited > 0.45 ? Self.darkInk : Self.creamInk
    }
    private static let darkInk = Color(red: 0.24, green: 0.19, blue: 0.03)
    private static let creamInk = Color(red: 0.94, green: 0.89, blue: 0.66)

    /// Stickies-style fixed palette (dimmed for the dark UI) + binary
    /// translucency — same UX as the native macOS Stickies app, which has
    /// named colours and a Translucent toggle rather than a picker/slider.
    private struct PaperPreset { let name: String; let hex: String }
    private static let paperPresets: [PaperPreset] = [
        .init(name: "Yellow", hex: "594F21"),
        .init(name: "Blue",   hex: "24455E"),
        .init(name: "Green",  hex: "1F4A38"),
        .init(name: "Pink",   hex: "5C2E42"),
        .init(name: "Purple", hex: "452A5C"),
        .init(name: "Gray",   hex: "3A3A3C"),
    ]
    private static let translucentOpacity = 0.85

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
        .background(RoundedRectangle(cornerRadius: 8).fill(paper))
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
                    .foregroundStyle(ink.opacity(0.5))
            } else {
                ScrollView {
                    Text(text)
                        .font(.callout)
                        .fontWeight(.medium)
                        .foregroundStyle(ink)
                        // No .textSelection here: selectable text swallows
                        // macOS click gestures, which killed tap-to-edit.
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(noteHeightReader)
                }
                .scrollIndicators(.visible)
                .overlay(alignment: .bottom) {
                    // Fade at the bottom edge signals more content below —
                    // independent of how the system scrollbar contrasts
                    // against the paper.
                    if textHeight > Self.maxHeight {
                        LinearGradient(
                            colors: [paper.opacity(0), paper],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: 14)
                        .allowsHitTesting(false)
                    }
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
                .foregroundStyle(ink)
                .tint(ink)
                .focused($editorFocused)
                .frame(minHeight: 48, maxHeight: 120)
                .scrollContentBackground(.hidden)

            HStack(spacing: 8) {
                ForEach(Self.paperPresets, id: \.hex) { preset in
                    paperSwatch(preset)
                }
                Spacer()
                Toggle("Translucent", isOn: Binding(
                    get: { opacity < 1.0 },
                    set: { opacity = $0 ? Self.translucentOpacity : 1.0 }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
                .font(.caption)
            }

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

    /// One Stickies-style colour chip; the active colour gets an ink ring.
    private func paperSwatch(_ preset: PaperPreset) -> some View {
        let selected = colorHex.caseInsensitiveCompare(preset.hex) == .orderedSame
        return RoundedRectangle(cornerRadius: 5)
            .fill(Color(hex: preset.hex))
            .frame(width: 18, height: 18)
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .strokeBorder(selected ? ink : .clear, lineWidth: 1.5)
            )
            .contentShape(Rectangle())
            .onTapGesture { colorHex = preset.hex }
            .help(preset.name)
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
    StickyNoteView(text: .constant("Daniel 7:18–28"), colorHex: .constant("594F21"), opacity: .constant(1))
        .padding()
}

#Preview("Empty") {
    StickyNoteView(text: .constant(""), colorHex: .constant("594F21"), opacity: .constant(1))
        .padding()
}
