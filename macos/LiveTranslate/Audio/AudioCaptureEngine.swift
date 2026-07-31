import AVFoundation

/// Captures audio from the system default input device (mic or USB interface),
/// resamples to 16 kHz / Int16 / mono PCM, and emits ~100 ms chunks — exactly
/// the format Qwen's realtime endpoint expects (`input_audio_buffer.append`).
final class AudioCaptureEngine: AudioSource, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let targetFormat: AVAudioFormat
    private var converter: AVAudioConverter?
    private let chunkQueue = DispatchQueue(label: "app.livetranslate.audio.chunk")
    private var accumulated = Data()
    private let chunkBytes = 3200   // 1600 samples × 2 bytes = 100 ms @ 16 kHz
    private(set) var isRunning = false

    /// Receives 100 ms Int16 mono PCM chunks.
    var onChunk: ((Data) -> Void)?
    /// Receives a rough 0...1 input level (for the meter), on the main thread.
    var onLevel: ((Float) -> Void)?
    /// Unused for the mic path (kept to satisfy `AudioSource`); start() throws on failure.
    var onError: ((String) -> Void)?

    init() {
        targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16000,
            channels: 1,
            interleaved: true
        )!
    }

    func start() throws {
        guard !isRunning else { return }
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        converter = AVAudioConverter(from: inFormat, to: targetFormat)

        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buffer, _ in
            self?.process(buffer)
        }

        engine.prepare()
        try engine.start()
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        converter = nil
        chunkQueue.sync { accumulated.removeAll(keepingCapacity: true) }
        isRunning = false
    }

    // MARK: -

    private func process(_ input: AVAudioPCMBuffer) {
        guard let converter else { return }

        // Report input level from the raw capture buffer.
        if let level = rms(input) {
            DispatchQueue.main.async { [weak self] in self?.onLevel?(level) }
        }

        let ratio = targetFormat.sampleRate / input.format.sampleRate
        let capacity = AVAudioFrameCount((Double(input.frameLength) * ratio).rounded(.up)) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }

        // Keep the converter alive across tap buffers: report `.noDataNow` once the
        // current buffer is consumed. Returning `.endOfStream` here would terminate the
        // converter permanently — every subsequent convert() would yield zero frames.
        var fed = false
        var convError: NSError?
        let status = converter.convert(to: out, error: &convError) { _, outState in
            if fed {
                outState.pointee = .noDataNow
                return nil
            }
            fed = true
            outState.pointee = .haveData
            return input
        }
        guard status != .error, out.frameLength > 0 else { return }

        guard let channel = out.int16ChannelData?[0] else { return }
        let bytes = Data(bytes: channel, count: Int(out.frameLength) * MemoryLayout<Int16>.size)

        chunkQueue.async { [weak self] in
            guard let self else { return }
            self.accumulated.append(bytes)
            while self.accumulated.count >= self.chunkBytes {
                let chunk = Data(self.accumulated.prefix(self.chunkBytes))
                self.accumulated.removeFirst(self.chunkBytes)
                DispatchQueue.main.async { self.onChunk?(chunk) }
            }
        }
    }

    private func rms(_ buffer: AVAudioPCMBuffer) -> Float? {
        guard let channel = buffer.floatChannelData?[0] else { return nil }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return nil }
        var sum: Float = 0
        for i in 0..<n {
            let s = channel[i]
            sum += s * s
        }
        let v = sqrt(sum / Float(n))
        return min(1, v * 3.2)   // rough scale so speech lights the meter
    }
}
