import AppKit
import SwiftUI

/// Routes app-quit requests to the live session screen so it can confirm
/// (and offer to save the transcript) before the app terminates.
@MainActor
final class QuitGuard {
    static let shared = QuitGuard()

    /// Set by the active InterpreterView; nil when no session is running.
    private(set) var handler: (() -> Void)?
    private var owner: UUID?

    func register(_ id: UUID, handler: @escaping () -> Void) {
        owner = id
        self.handler = handler
    }

    func unregister(_ id: UUID) {
        guard owner == id else { return }
        owner = nil
        handler = nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// With a session running, defer termination and let the session screen
    /// ask; it answers via `NSApp.reply(toApplicationShouldTerminate:)`.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let ask = QuitGuard.shared.handler else { return .terminateNow }
        ask()
        return .terminateLater
    }
}

/// Intercepts the hosting window's close (red button / ⌘W) while
/// `shouldIntercept()` is true, calling `onAttempt` instead of closing.
///
/// SwiftUI owns the window's delegate, so this installs a proxy that answers
/// `windowShouldClose` and forwards everything else to SwiftUI's delegate,
/// restoring it when the view goes away.
struct WindowCloseInterceptor: NSViewRepresentable {
    var shouldIntercept: () -> Bool
    var onAttempt: () -> Void
    var onWindow: (NSWindow) -> Void = { _ in }

    func makeCoordinator() -> CloseProxy { CloseProxy() }

    func makeNSView(context: Context) -> HostView {
        let view = HostView()
        view.onMoveToWindow = { [weak proxy = context.coordinator] window in
            guard let proxy, let window else { return }
            proxy.install(on: window)
            onWindow(window)
        }
        return view
    }

    func updateNSView(_ nsView: HostView, context: Context) {
        context.coordinator.shouldIntercept = shouldIntercept
        context.coordinator.onAttempt = onAttempt
    }

    static func dismantleNSView(_ nsView: HostView, coordinator: CloseProxy) {
        coordinator.uninstall()
    }

    final class HostView: NSView {
        var onMoveToWindow: ((NSWindow?) -> Void)?
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            onMoveToWindow?(window)
        }
    }

    final class CloseProxy: NSObject, NSWindowDelegate {
        var shouldIntercept: () -> Bool = { false }
        var onAttempt: () -> Void = {}
        private weak var window: NSWindow?
        private weak var original: NSWindowDelegate?

        func install(on window: NSWindow) {
            guard self.window !== window else { return }
            uninstall()
            self.window = window
            original = window.delegate
            window.delegate = self
        }

        func uninstall() {
            if let window, window.delegate === self { window.delegate = original }
            window = nil
        }

        func windowShouldClose(_ sender: NSWindow) -> Bool {
            if shouldIntercept() {
                onAttempt()
                return false
            }
            return original?.windowShouldClose?(sender) ?? true
        }

        override func responds(to aSelector: Selector!) -> Bool {
            super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
        }

        override func forwardingTarget(for aSelector: Selector!) -> Any? {
            original?.responds(to: aSelector) == true ? original : super.forwardingTarget(for: aSelector)
        }
    }
}
