import { Switch } from '@/components/ui/switch';
import { BottomSheet } from './BottomSheet.js';
import { useT } from '../i18n.js';
import type { Role } from '@v2/shared';
import type { ConversationConfig } from '../types.js';

interface Props {
  open: boolean;
  role: Role;
  config: ConversationConfig;
  devices: MediaDeviceInfo[];
  /** Currently selected mic deviceId — controlled by the page so the picker doesn't snap back. */
  selectedDeviceId: string;
  paused: boolean;
  onClose: () => void;
  onVoiceOver: (v: boolean) => void;
  onVoiceClone: (v: boolean) => void;
  onMic: (deviceId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

export function ControlsSheet(p: Props) {
  const t = useT();
  const isHost = p.role === 'host';
  return (
    <BottomSheet open={p.open} onClose={p.onClose}>
      <div className="space-y-1">
        {isHost && (
          <>
            <Row label={`🔊 ${t('voice_over')}`}>
              <Switch checked={p.config.voiceOver} onCheckedChange={p.onVoiceOver} aria-label={t('voice_over')} />
            </Row>
            {p.config.voiceOver && (
              <Row label={t('voice_clone')} inset>
                <Switch checked={p.config.voiceClone} onCheckedChange={p.onVoiceClone} aria-label={t('voice_clone')} />
              </Row>
            )}
          </>
        )}

        <Row label={`🎤 ${t('mic')}`}>
          <select
            className="bg-transparent text-sm text-muted-foreground"
            value={p.selectedDeviceId}
            onChange={(e) => p.onMic(e.target.value)}
          >
            {p.devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('mic')} ${i + 1}`}</option>
            ))}
          </select>
        </Row>

        <button
          className="flex w-full items-center justify-between py-2 text-sm text-foreground"
          onClick={p.paused ? p.onResume : p.onPause}
          aria-label={p.paused ? t('resume') : t('pause')}
        >
          <span>{p.paused ? t('resume') : t('pause')}</span>
        </button>

        {isHost && (
          <div className="border-t border-border pt-2">
            <button className="w-full py-2 text-left text-sm text-primary" onClick={p.onEnd}>{t('end')}</button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function Row({ label, inset, children }: { label: string; inset?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between py-2 ${inset ? 'pl-4' : ''}`}>
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}
