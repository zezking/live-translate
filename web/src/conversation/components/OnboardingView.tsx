import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '../i18n.js';
import type { Role } from '@v2/shared';
import type { Phase, RoomData } from '../types.js';

interface Props {
  phase: Phase;
  role: Role;
  room: RoomData | null;
  names: { host: string; joiner: string };
  adminKey: string;
  onBegin: (hostName: string, partnerName: string, adminKey: string) => void;
  onJoin: () => void;
  onSetAdminKey: (v: string) => void;
  onBeginAnother: () => void;
}

export function OnboardingView(p: Props) {
  const t = useT();
  const [hostName, setHostName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [admin, setAdmin] = useState('');

  // ---- Joiner welcome (Korean) ----
  if (p.role === 'joiner') {
    return (
      <main className="flex h-full flex-col items-center justify-center px-8 text-center">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('invited').replace('{host}', p.names.host || '')}</p>
        <div className="my-6 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-xl">👤</div>
        <Button className="px-8" onClick={p.onJoin}>{t('join')}</Button>
      </main>
    );
  }

  // ---- Host waiting (QR) ----
  if (p.phase === 'waiting' && p.room) {
    return (
      <main className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-sm text-foreground">{t('show_code')} <b>{partnerName || p.names.joiner || ''}</b></p>
        <img src={p.room.qrDataUrl} alt="QR code" className="my-6 h-48 w-48 rounded-xl border border-border bg-white p-2" />
        <div className="flex flex-col items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          <p className="text-sm text-muted-foreground">{t('waiting')}</p>
        </div>
      </main>
    );
  }

  // ---- Host setup ----
  const needAdmin = !p.adminKey;
  const begin = () => p.onBegin(hostName || 'You', partnerName || 'Partner', p.adminKey || admin);
  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{needAdmin ? t('admin_password') : t('title')}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{needAdmin ? '' : t('subtitle')}</p>

      {needAdmin ? (
        <div className="space-y-3">
          <Input type="password" placeholder={t('admin_password')} value={admin} onChange={(e) => setAdmin(e.target.value)} />
          <Button className="w-full" onClick={() => p.onSetAdminKey(admin)} disabled={!admin}>{t('admin_continue')}</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hn">{t('your_name')}</Label>
            <Input id="hn" placeholder="Enze" value={hostName} onChange={(e) => setHostName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pn">{t('partner_name')}</Label>
            <Input id="pn" placeholder="아버님" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
          </div>
          <Button className="w-full" onClick={begin}>{t('begin')}</Button>
        </div>
      )}
    </main>
  );
}
