import SwiftUI

struct RootView: View {
    @Environment(KeychainStore.self) private var keychain

    var body: some View {
        if keychain.hasKey {
            SessionSetupView()
        } else {
            OnboardingView()
        }
    }
}
