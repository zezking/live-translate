import { useT } from '../i18n.js';
import { nativeName } from '../languages.js';
import type { ConversationState } from '../types.js';

interface Props {
  status: ConversationState['status'];
  paused: boolean;
  activeDirection: string | null;
}

export function StatusLine({ status, paused, activeDirection }: Props) {
  const t = useT();
  const text = paused
    ? t('paused')
    : activeDirection
      ? `${t('listening')} (${nativeName(activeDirection)})`
      : status === 'reconnecting'
        ? t('reconnecting')
        : status === 'connecting'
          ? t('connecting')
          : t('hold_to_talk');
  const dot = paused || status === 'reconnecting' ? 'bg-muted-foreground' : 'bg-primary';
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 text-xs text-muted-foreground">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>{text}</span>
    </div>
  );
}
