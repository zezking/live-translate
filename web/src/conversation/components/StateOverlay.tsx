import { Button } from '@/components/ui/button';
import { useT } from '../i18n.js';

interface Props {
  kind: 'waiting' | 'partnerAway' | 'reconnecting' | 'paused' | 'ended';
  /** Display name of the other party — the page computes it role-aware (host sees joiner, joiner sees host). */
  partnerName: string;
  onResume: () => void;
  onBeginAnother: () => void;
}

export function StateOverlay({ kind, partnerName, onResume, onBeginAnother }: Props) {
  const t = useT();
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
            <p className="text-lg text-foreground"><span className="font-semibold">{partnerName}</span> {t('partner_away')}</p>
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
