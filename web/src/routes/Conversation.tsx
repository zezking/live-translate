import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/auth-context';
import { I18nProvider } from '@/conversation/i18n';
import { useConversation } from '@/conversation/use-conversation';
import { OnboardingView } from '@/conversation/components/OnboardingView';
import { RiverTranscript } from '@/conversation/components/RiverTranscript';
import { StatusLine } from '@/conversation/components/StatusLine';
import { StateOverlay } from '@/conversation/components/StateOverlay';
import { ControlsSheet } from '@/conversation/components/ControlsSheet';
import { ErrorLine } from '@/conversation/components/ErrorLine';

function ConversationInner() {
  const { adminKey, setAdminKey } = useAuth();
  const conv = useConversation({ adminKey });
  const { state } = conv;
  const [sheetOpen, setSheetOpen] = useState(false);
  const locale = state.role === 'joiner' ? 'ko' : 'en';

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const overlay =
    state.paused ? 'paused'
    : state.status === 'ended' ? 'ended'
    : state.status === 'reconnecting' ? 'reconnecting'
    : state.status === 'partnerAway' ? 'partnerAway'
    : state.phase === 'waiting' && state.role === 'host' ? null // host waiting is the QR onboarding screen
    : null;

  return (
    <I18nProvider locale={locale}>
      <div className="relative flex h-full flex-col bg-background">
        {state.phase === 'onboarding' || (state.phase === 'waiting' && state.role === 'host') ? (
          <OnboardingView
            phase={state.phase}
            role={state.role}
            room={state.room}
            names={state.names}
            adminKey={adminKey}
            onBegin={(hn, pn) => void conv.createRoom(hn, pn)}
            onJoin={() => void conv.joinRoom()}
            onSetAdminKey={setAdminKey}
            onBeginAnother={() => window.location.reload()}
          />
        ) : (
          <>
            <header className="flex items-center justify-between">
              <StatusLine status={state.status} paused={state.paused} />
              <div className="flex items-center gap-3 px-4 pt-3 text-muted-foreground">
                <span aria-label="voice-over">🔊</span>
                <button aria-label="controls" className="text-lg leading-none" onClick={() => setSheetOpen(true)}>⋯</button>
              </div>
            </header>
            <RiverTranscript turns={state.turns} role={state.role} names={state.names} />
          </>
        )}

        {overlay && state.phase !== 'onboarding' && (
          <StateOverlay
            kind={overlay as 'waiting' | 'partnerAway' | 'reconnecting' | 'paused' | 'ended'}
            partnerName={state.role === 'host' ? state.names.joiner : state.names.host}
            onResume={conv.resume}
            onBeginAnother={() => window.location.reload()}
          />
        )}

        {state.error && <ErrorLine message={state.error} onDismiss={conv.clearError} />}

        <ControlsSheet
          open={sheetOpen}
          role={state.role}
          config={state.config}
          devices={conv.devices}
          selectedDeviceId={conv.selectedDeviceId}
          paused={state.paused}
          onClose={() => setSheetOpen(false)}
          onVoiceOver={conv.setVoiceOver}
          onVoiceClone={conv.setVoiceClone}
          onMic={(id) => void conv.setMicDevice(id)}
          onPause={conv.pause}
          onResume={conv.resume}
          onEnd={() => void conv.endConversation()}
        />
      </div>
    </I18nProvider>
  );
}

export function Conversation() {
  return (
    <AuthProvider>
      <ConversationInner />
    </AuthProvider>
  );
}
