import SwiftUI

struct InterpreterView: View {
    let interp: DuoInterpreter
    var onEnded: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            TranscriptRiverView(interp: interp)
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
            if interp.phase == .ready, let direction = interp.activeDirection {
                Text("Speaking \(direction == .a ? interp.sourceName : interp.targetName)")
                    .foregroundStyle(.secondary)
                    .font(.callout)
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
        let ready = interp.phase == .ready
        return VStack(spacing: 12) {
            HStack(spacing: 14) {
                HoldButton(
                    title: "\(interp.sourceName) → \(interp.targetName)",
                    systemImage: "mic.fill",
                    tint: .blue,
                    disabled: !ready
                ) { interp.press(.a) } onRelease: { interp.release() }

                HoldButton(
                    title: "\(interp.targetName) → \(interp.sourceName)",
                    systemImage: "mic.fill",
                    tint: .green,
                    disabled: !ready
                ) { interp.press(.b) } onRelease: { interp.release() }
            }

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

struct TranscriptRiverView: View {
    let interp: DuoInterpreter

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(interp.turns) { turn in
                        TurnRow(turn: turn)
                    }
                    if interp.turns.isEmpty {
                        Text(hint)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: interp.turns.last?.id) { _, _ in
                if let last = interp.turns.last {
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var hint: String {
        switch interp.phase {
        case .connecting: return "Connecting to Qwen…"
        case .ready: return "Hold a button below and speak."
        case .ended: return "Session ended."
        default: return ""
        }
    }
}

struct TurnRow: View {
    let turn: Turn

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(Language.name(for: turn.lang))
                .font(.caption)
                .fontWeight(.bold)
                .foregroundStyle(turn.isActive ? .primary : .secondary)
            if !turn.original.isEmpty {
                Text(turn.original)
                    .font(.body)
                    .textSelection(.enabled)
            }
            if !turn.translation.isEmpty {
                Text(turn.translation)
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct HoldButton: View {
    let title: String
    let systemImage: String
    let tint: Color
    let disabled: Bool
    let onPress: () -> Void
    let onRelease: () -> Void
    @State private var held = false

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(held ? tint.opacity(0.92) : tint.opacity(0.12))
            )
            .foregroundStyle(held ? Color.white : tint)
            .opacity(disabled ? 0.35 : 1)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !held, !disabled else { return }
                        held = true
                        onPress()
                    }
                    .onEnded { _ in
                        guard held else { return }
                        held = false
                        onRelease()
                    }
            )
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
