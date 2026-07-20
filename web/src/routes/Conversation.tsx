import { useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/auth-context';
import { I18nProvider } from '@/conversation/i18n';
import { useConversation } from '@/conversation/use-conversation';
import { SetupView } from '@/conversation/components/SetupView';
import { RiverTranscript } from '@/conversation/components/RiverTranscript';
import { StatusLine } from '@/conversation/components/StatusLine';
import { StateOverlay } from '@/conversation/components/StateOverlay';
import { ControlsSheet } from '@/conversation/components/ControlsSheet';
import { PressArea } from '@/conversation/components/PressArea';
import { ErrorLine } from '@/conversation/components/ErrorLine';
import { pttLabel, colorFor } from '@/conversation/languages';

function ConversationInner() {
  const { adminKey, setAdminKey } = useAuth();
  const conv = useConversation({ adminKey });
  const { state } = conv;
  const [sheetOpen, setSheetOpen] = useState(false);

  const overlay =
    state.paused ? 'paused'
    : state.status === 'ended' ? 'ended'
    : state.status === 'reconnecting' ? 'reconnecting'
    : null;

  return (
    <I18nProvider locale="en">
      <div className="relative flex h-full flex-col bg-background">
        {state.phase === 'setup' || state.phase === 'connecting' ? (
          state.phase === 'setup' ? (
            <SetupView adminKey={adminKey} onSetAdminKey={setAdminKey} onBegin={(langs) => void conv.begin(langs)} />
          ) : (
            <main className="flex h-full items-center justify-center text-sm text-muted-foreground">Connecting…</main>
          )
        ) : (
          <>
            <header className="flex items-center justify-between">
              <StatusLine status={state.status} paused={state.paused} activeDirection={state.activeDirection} />
              <div className="flex items-center gap-3 px-4 pt-3 text-muted-foreground">
                <button aria-label="controls" className="text-lg leading-none" onClick={() => setSheetOpen(true)}>⋯</button>
              </div>
            </header>
            <RiverTranscript turns={state.turns} languages={state.languages ?? ['en', 'ko']} />
            <div className="flex h-[34vh] min-h-44 flex-col gap-2 px-4 pb-4">
              {([0, 1] as const).map((i) => {
                const lang = (state.languages ?? ['en', 'ko'])[i];
                return (
                  <PressArea
                    key={lang}
                    label={pttLabel(lang)}
                    color={colorFor(i)}
                    held={state.activeDirection === lang}
                    disabled={state.activeDirection !== null && state.activeDirection !== lang}
                    onDown={() => conv.press(lang)}
                    onUp={conv.release}
                  />
                );
              })}
            </div>
          </>
        )}

        {state.error && <ErrorLine message={state.error} onDismiss={conv.clearError} />}

        {overlay && state.phase !== 'ended' && (
          <StateOverlay kind={overlay} onResume={conv.resume} onBeginAnother={() => window.location.reload()} />
        )}
        {state.phase === 'ended' && (
          <StateOverlay kind="ended" onResume={conv.resume} onBeginAnother={() => window.location.reload()} />
        )}

        <ControlsSheet
          open={sheetOpen}
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
