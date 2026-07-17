import { Button } from '@/components/ui/button';
import { useT } from '../i18n.js';
import type { ConversationState } from '../types.js';

interface Props {
  kind: 'waiting' | 'partnerAway' | 'reconnecting' | 'paused' | 'ended';
  names: { host: string; joiner: string };
  onResume: () => void;
  onBeginAnother: () => void;
}

export function StateOverlay({ kind, names, onResume, onBeginAnother }: Props) {
  const t = useT();
  // The partner is whoever "me" is not. The page passes role via names usage; here we show the joiner
  // name for the host and vice-versa by rendering both-friendly copy. For partner-away we use the joiner
  // name when the host is viewing (most common); the page may pass the explicit partner name via names.joiner.
  const partner = names.joiner || names.host;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 px-8 text-center backdrop-blur-sm">
      <div className="max-w-sm space-y-2">
        {kind === 'waiting' && (
          <>
            <p className="text-lg text-foreground">{t('waiting')}</p>
          </>
        )}
        {kind === 'partnerAway' && (
          <>
            <p className="text-lg text-foreground"><span className="font-semibold">{partner}</span> {t('partner_away')}</p>
          </>
        )}
        {kind === 'reconnecting' && <p className="text-lg text-foreground">{t('reconnecting')}</p>}
        {kind === 'paused' && (
          <>
            <p className="text-lg text-foreground">{t('paused')}</p>
            <Button variant="link" className="text-primary" onClick={onResume}>{t('tap_resume')}</Button>
          </>
        )}
        {kind === 'ended' && (
          <>
            <p className="text-lg text-foreground">{t('ended')}</p>
            <p className="text-sm text-muted-foreground">{t('warm_close')}</p>
            <Button variant="outline" className="mt-2" onClick={onBeginAnother}>{t('begin_another')}</Button>
          </>
        )}
      </div>
    </div>
  );
}
