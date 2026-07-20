import { useEffect, useRef } from 'react';
import type { Turn } from '../types.js';
import { nativeName } from '../languages.js';

interface Props {
  turns: Turn[];
  languages: [string, string];
}

function RiverTurn({ turn, languages }: { turn: Turn; languages: [string, string] }) {
  const posClass = turn.lang === languages[0] ? 'text-primary' : 'text-[#3a7a5a]';
  return (
    <div data-active={turn.active ? 'true' : 'false'} className={turn.active ? 'mt-3' : 'mt-2 opacity-90'}>
      <div className={`text-xs font-bold tracking-wide ${posClass} ${turn.active ? 'text-sm' : ''}`}>
        {nativeName(turn.lang)}
      </div>
      <div className={`text-foreground ${turn.active ? 'text-base' : 'text-[15px]'} leading-relaxed`}>
        {turn.original}
      </div>
      {turn.translation ? (
        <div className="mt-0.5 ml-1 text-xs text-muted-foreground leading-relaxed">{turn.translation}</div>
      ) : null}
    </div>
  );
}

export function RiverTranscript({ turns, languages }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4" aria-label="conversation transcript">
      {turns.map((t) => (
        <RiverTurn key={t.id} turn={t} languages={languages} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
