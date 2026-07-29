import Foundation
import AVFoundation
import CoreMedia
import ScreenCaptureKit

/// Captures audio from a chosen browser/app window via ScreenCaptureKit, converts
/// to 16 kHz / Int16 / mono PCM, and emits ~100 ms chunks — the same shape as
/// `AudioCaptureEngine`, so the interpreter can't tell a mic from a YouTube tab.
///
/// On macOS 15+ the window filter scopes audio to that app, and
/// `excludesCurrentProcessAudio` keeps our own voice-over playback out of the
/// capture (no feedback loop).
///
/// Conversion note: we ask SCStream for 16 kHz mono Float32 and it honours that,
/// so we convert Float32 → Int16 directly (no resampling, no AVAudioConverter —
/// the latter returned `.inputRanDry`/0 output for reasons that resisted debugging).
final class ScreenCaptureAudioEngine: NSObject, AudioSource, SCStreamOutput, SCStreamDelegate {
    var onChunk: ((Data) -> Void)?
    var onLevel: ((Float) -> Void)?
    var onError: ((String) -> Void)?

    private(set) var isRunning = false
    private var stream: SCStream?

    private let chunkQueue = DispatchQueue(label: "app.livetranslate.audio.screencapture")
    private var accumulated = Data()
    private let chunkBytes = 3200                      // 1600 samples × 2 bytes = 100 ms @ 16 kHz

    /// Diagnostics counters (logged periodically).
    private var bufferCount = 0
    private var rejectedCount = 0
    private var chunkCount = 0
    private var lastFormatLogged = false

    /// The window to capture. Set before `start()`.
    var selectedWindow: SCWindow?

    override init() {
        super.init()
    }

    func start() throws {
        guard !isRunning else { return }
        guard let window = selectedWindow else {
            throw NSError(
                domain: "ScreenCaptureAudioEngine", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No window selected for capture"]
            )
        }
        log("starting — window \"\(window.title ?? "?")\" (\(window.owningApplication?.applicationName ?? "?"))")

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 16000
        config.channelCount = 1
        config.showsCursor = false
        if #available(macOS 15.0, *) {
            // Don't capture our own voice-over playback → no feedback loop.
            config.excludesCurrentProcessAudio = true
        }

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInitiated))
        self.stream = stream

        stream.startCapture { [weak self] error in
            guard let self else { return }
            if let error {
                self.log("✖ startCapture FAILED: \(error.localizedDescription) (\((error as NSError).code))")
                self.onError?("Audio capture failed: \(error.localizedDescription)")
                self.stop()
            } else {
                self.log("✓ startCapture succeeded")
                self.isRunning = true
            }
        }
    }

    func stop() {
        guard isRunning || stream != nil else { return }
        isRunning = false
        let active = stream
        stream = nil
        chunkQueue.sync { accumulated.removeAll(keepingCapacity: true) }
        active?.stopCapture { _ in }
        log("stopped — buffers=\(bufferCount) rejected=\(rejectedCount) chunks=\(chunkCount)")
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        bufferCount += 1
        process(sampleBuffer)
    }

    // MARK: - SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        log("✖ stream stopped: \(error.localizedDescription)")
        let msg = "Audio stream stopped: \(error.localizedDescription)"
        DispatchQueue.main.async { [weak self] in self?.onError?(msg) }
    }

    // MARK: - Conversion (direct Float32 → Int16, no AVAudioConverter)

    private func process(_ sampleBuffer: CMSampleBuffer) {
        guard let desc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdRef = CMAudioFormatDescriptionGetStreamBasicDescription(desc) else { return }
        let asbd = asbdRef.pointee

        // We configured SCStream for mono Float32 @16 kHz; require exactly that.
        guard asbd.mFormatID == kAudioFormatLinearPCM,
              asbd.mFormatFlags & UInt32(kAudioFormatFlagIsFloat) != 0,
              asbd.mChannelsPerFrame == 1, asbd.mBytesPerFrame >= 4 else {
            rejectedCount += 1
            if rejectedCount % 50 == 1 {
                log("reject buffer: fmt=\(fourCC(asbd.mFormatID)) ch=\(asbd.mChannelsPerFrame) bpframe=\(asbd.mBytesPerFrame)")
            }
            return
        }
        if !lastFormatLogged {
            log("first buffer: \(asbd.mSampleRate)Hz ch=\(asbd.mChannelsPerFrame) bytes/frame=\(asbd.mBytesPerFrame)")
            lastFormatLogged = true
        }
        if abs(asbd.mSampleRate - 16000) > 1 {
            log("⚠️ unexpected rate \(asbd.mSampleRate)Hz — output will be wrong-rate for Qwen")
        }

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { rejectedCount += 1; return }
        let totalBytes = CMBlockBufferGetDataLength(blockBuffer)
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)
        guard status == kCMBlockBufferNoErr, let dataPointer else { rejectedCount += 1; return }

        let nFloats = min(Int(totalBytes) / 4, Int(CMSampleBufferGetNumSamples(sampleBuffer)))
        guard nFloats > 0 else { rejectedCount += 1; return }

        var int16 = Data(count: nFloats * 2)
        var levelSum: Double = 0
        dataPointer.withMemoryRebound(to: Float.self, capacity: nFloats) { floatPtr in
            int16.withUnsafeMutableBytes { raw in
                guard let dst = raw.bindMemory(to: Int16.self).baseAddress else { return }
                for i in 0..<nFloats {
                    let s = max(-1.0, min(1.0, floatPtr[i]))
                    levelSum += Double(s * s)
                    dst[i] = Int16(s * 32767.0)
                }
            }
        }

        let rms = Float(sqrt(levelSum / Double(nFloats)))
        let scaled = min(1, rms * 3.2)
        DispatchQueue.main.async { [weak self] in self?.onLevel?(scaled) }

        chunkQueue.async { [weak self] in
            guard let self else { return }
            self.accumulated.append(int16)
            while self.accumulated.count >= self.chunkBytes {
                let chunk = Data(self.accumulated.prefix(self.chunkBytes))
                self.accumulated.removeFirst(self.chunkBytes)
                self.chunkCount += 1
                DispatchQueue.main.async { self.onChunk?(chunk) }
            }
        }

        if bufferCount % 100 == 0 {
            log("progress buffers=\(bufferCount) rejected=\(rejectedCount) chunks=\(chunkCount) lastFrame=\(nFloats)")
        }
    }

    private func fourCC(_ code: UInt32) -> String {
        let bytes = withUnsafeBytes(of: code.bigEndian) { Array($0) }
        return String(bytes.map { Character(UnicodeScalar($0)) })
    }

    private func log(_ msg: String) {
        LTLog.log("[sc-audio] \(msg)")
    }
}
