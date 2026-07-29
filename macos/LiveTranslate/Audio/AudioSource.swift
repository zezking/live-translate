import Foundation

/// A swappable source of 16 kHz Int16 mono PCM (~100 ms chunks) feeding the
/// interpreter pipeline. Today: the mic (`AudioCaptureEngine`) or a browser/app
/// window (`ScreenCaptureAudioEngine`). The interpreter is agnostic to which.
protocol AudioSource: AnyObject {
    /// Receives ~100 ms Int16 mono PCM chunks.
    var onChunk: ((Data) -> Void)? { get set }
    /// Receives a rough 0...1 input level (main thread).
    var onLevel: ((Float) -> Void)? { get set }
    /// Receives a human-readable error string (async start failures, dropped stream).
    var onError: ((String) -> Void)? { get set }

    func start() throws
    func stop()
}
