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
