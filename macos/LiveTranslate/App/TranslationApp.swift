import SwiftUI

@main
struct LiveTranslateApp: App {
    @State private var keychain = KeychainStore()
    @State private var settings = AppSettings()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(keychain)
                .environment(settings)
                .frame(minWidth: 860, minHeight: 560)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1040, height: 720)
    }
}
