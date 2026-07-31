import Foundation
import CoreAudio

/// Enumerates audio input devices and can set the system default input device.
/// `AVAudioEngine` captures from the system default input, so selecting a device
/// here makes the engine pick it up on its next start().
struct AudioInputDevice: Identifiable, Hashable {
    let id: AudioDeviceID      // UInt32, stable for the device's lifetime
    let uid: String?
    let name: String
}

enum AudioDevices {
    /// All devices that expose at least one input stream (mics + USB interfaces).
    static func inputDevices() -> [AudioInputDevice] {
        var propSize: UInt32 = 0
        var prop = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)

        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &prop, 0, nil, &propSize) == noErr else {
            return []
        }

        let count = Int(propSize) / MemoryLayout<AudioDeviceID>.size
        guard count > 0 else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &prop, 0, nil, &propSize, &ids) == noErr else {
            return []
        }

        return ids.compactMap { id -> AudioInputDevice? in
            guard hasInputStreams(id) else { return nil }
            let name = stringProperty(id, kAudioDevicePropertyDeviceNameCFString) ?? "Unknown device"
            let uid = stringProperty(id, kAudioDevicePropertyDeviceUID)
            return AudioInputDevice(id: id, uid: uid, name: name)
        }
    }

    static func defaultInputDeviceID() -> AudioDeviceID? {
        var id: AudioDeviceID = 0
        var size: UInt32 = UInt32(MemoryLayout<AudioDeviceID>.size)
        var prop = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &prop, 0, nil, &size, &id) == noErr else {
            return nil
        }
        return id
    }

    /// Resolves a (stable-across-reconnects) device UID to the current
    /// AudioDeviceID. Returns nil when the device isn't connected.
    static func deviceID(forUID uid: String) -> AudioDeviceID? {
        inputDevices().first(where: { $0.uid == uid })?.id
    }

    static func deviceName(forID id: AudioDeviceID) -> String? {
        stringProperty(id, kAudioDevicePropertyDeviceNameCFString)
    }

    /// Sets the system-wide default input device. AVAudioEngine captures from the
    /// default device, so this is how "choose your USB interface" works.
    static func setDefaultInputDevice(_ id: AudioDeviceID) {
        var id = id
        let size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var prop = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        _ = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &prop, 0, nil, size, &id)
    }

    // MARK: - helpers

    private static func hasInputStreams(_ id: AudioDeviceID) -> Bool {
        var size: UInt32 = 0
        var prop = AudioObjectPropertyAddress(
            mSelector: kAudioStreamPropertyPhysicalFormats,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain)
        let r = AudioObjectGetPropertyDataSize(id, &prop, 0, nil, &size)
        return r == noErr && size > 0
    }

    private static func stringProperty(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
        var value: CFString = "" as CFString
        var size: UInt32 = UInt32(MemoryLayout<CFString>.size)
        var prop = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(id, &prop, 0, nil, &size, &value) == noErr else { return nil }
        return value as String
    }
}
