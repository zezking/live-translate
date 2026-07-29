import AVFoundation

/// Plays the 24 kHz Int16 mono PCM that Qwen streams back for voice-over.
final class PlaybackEngine: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format: AVAudioFormat   // 24000 Hz, Int16, mono
    private var started = false

    init() {
        format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func start() {
        guard !started else { return }
        do {
            engine.prepare()
            try engine.start()
            player.play()
            started = true
        } catch {
            print("[playback] start failed: \(error.localizedDescription)")
        }
    }

    func stop() {
        player.stop()
        engine.stop()
        started = false
    }

    /// Enqueue a 24 kHz Int16 mono PCM buffer for gapless playback.
    func enqueue(_ pcm: Data) {
        guard started, pcm.count >= 2 else { return }
        let frameCount = AVAudioFrameCount(pcm.count / 2)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
        buffer.frameLength = frameCount
        pcm.withUnsafeBytes { raw in
            guard let dst = buffer.int16ChannelData?[0],
                  let src = raw.baseAddress?.assumingMemoryBound(to: Int16.self) else { return }
            dst.update(from: src, count: Int(frameCount))
        }
        player.scheduleBuffer(buffer, completionHandler: nil)
    }
}
