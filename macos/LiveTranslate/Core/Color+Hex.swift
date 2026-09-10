import SwiftUI
import AppKit

/// Hex ("RRGGBB") round-tripping for sticky-note paper colour persistence.
extension Color {
    /// Init from "RRGGBB" (case-insensitive, optional "#"). Falls back to the
    /// default muted khaki when the string is malformed.
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var v: UInt64 = 0
        if s.count == 6, Scanner(string: s).scanHexInt64(&v) {
            self.init(
                red: Double((v >> 16) & 0xFF) / 255.0,
                green: Double((v >> 8) & 0xFF) / 255.0,
                blue: Double(v & 0xFF) / 255.0
            )
        } else {
            self.init(red: 0.35, green: 0.31, blue: 0.13)
        }
    }

    /// sRGB hex "RRGGBB".
    var hex: String {
        guard let c = NSColor(self).usingColorSpace(.sRGB) else { return "594F21" }
        return String(
            format: "%02X%02X%02X",
            Int(round(c.redComponent * 255)),
            Int(round(c.greenComponent * 255)),
            Int(round(c.blueComponent * 255))
        )
    }

    /// Perceptual-ish brightness (0–1) in sRGB — good enough to pick
    /// dark vs light ink for readable note text.
    var relativeLuminance: Double {
        guard let c = NSColor(self).usingColorSpace(.sRGB) else { return 0.5 }
        return 0.2126 * Double(c.redComponent)
             + 0.7152 * Double(c.greenComponent)
             + 0.0722 * Double(c.blueComponent)
    }
}
