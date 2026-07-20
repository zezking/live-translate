import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '../i18n.js';
import { LANGUAGES } from '../languages.js';

interface Props {
  adminKey: string;
  onSetAdminKey: (v: string) => void;
  onBegin: (languages: [string, string]) => void;
}

export function SetupView({ adminKey, onSetAdminKey, onBegin }: Props) {
  const t = useT();
  const [admin, setAdmin] = useState('');
  const [langA, setLangA] = useState('en');
  const [langB, setLangB] = useState('ko');

  if (!adminKey) {
    return (
      <main className="mx-auto flex h-full max-w-sm flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">{t('admin_password')}</h1>
        <div className="mt-6 space-y-3">
          <Input
            type="password"
            placeholder={t('admin_password')}
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
          />
          <Button className="w-full" onClick={() => onSetAdminKey(admin)} disabled={!admin}>
            {t('admin_continue')}
          </Button>
        </div>
      </main>
    );
  }

  const same = langA === langB;
  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t('setup_subtitle')}</p>
      <div className="space-y-4">
        <select
          aria-label="language A"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground"
          value={langA}
          onChange={(e) => setLangA(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.native}</option>
          ))}
        </select>
        <select
          aria-label="language B"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground"
          value={langB}
          onChange={(e) => setLangB(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.native}</option>
          ))}
        </select>
        <Button className="w-full" disabled={same} onClick={() => onBegin([langA, langB])}>
          {t('begin')}
        </Button>
      </div>
    </main>
  );
}
