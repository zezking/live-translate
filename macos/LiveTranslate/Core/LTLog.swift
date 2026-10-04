import Foundation

/// Lightweight file logger: appends lines to /tmp/lt.log so diagnostics survive
/// even when the app is launched via `open` (no terminal, and stdout is swallowed
/// by the Xcode debug-dylib stub executor). Read with: `tail -f /tmp/lt.log`.
enum LTLog {
    private static let url = URL(fileURLWithPath: "/tmp/lt.log")
    private static let queue = DispatchQueue(label: "app.livetranslate.log")

    static func log(_ message: String) {
        let line = "[\(Self.time())] \(message)\n"
        queue.async {
            guard let data = line.data(using: .utf8) else { return }
            if FileManager.default.fileExists(atPath: Self.url.path) {
                if let handle = try? FileHandle(forWritingTo: Self.url) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    try? handle.close()
                }
            } else {
                try? data.write(to: Self.url)
            }
        }
    }

    private static func time() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: Date())
    }
}

/// Logs main-thread stalls: a background timer pings the main queue every
/// 100 ms and records how late the ping ran. Anything over 100 ms means the UI
/// (and the main-thread audio hop) was blocked.
final class MainThreadWatchdog: @unchecked Sendable {
    private let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "app.livetranslate.watchdog"))

    func start() {
        timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
        timer.setEventHandler {
            let sent = DispatchTime.now()
            DispatchQueue.main.async {
                let ms = Double(DispatchTime.now().uptimeNanoseconds - sent.uptimeNanoseconds) / 1_000_000
                if ms > 100 { LTLog.log("[watchdog] main thread stalled \(Int(ms)) ms") }
            }
        }
        timer.resume()
    }

    func stop() { timer.cancel() }
}
