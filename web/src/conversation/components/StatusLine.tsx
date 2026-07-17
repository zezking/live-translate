import { useT } from '../i18n.js';
import type { ConversationState } from '../types.js';

export function StatusLine({ status, paused }: { status: ConversationState['status']; paused: boolean }) {
  const t = useT();
  const text = paused ? t('paused') : status === 'listening' ? t('listening') : status === 'reconnecting' ? t('reconnecting') : t('waiting');
  const dot = paused || status === 'reconnecting' ? 'bg-muted-foreground' : 'bg-primary';
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 text-xs text-muted-foreground">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{text}</span>
    </div>
  );
}
