import { useEffect, useRef } from 'react';
import type { Role } from '@v2/shared';
import type { Turn } from '../types.js';

interface Props {
  turns: Turn[];
  role: Role;
  names: { host: string; joiner: string };
}

function RiverTurn({ turn, role, names }: { turn: Turn; role: Role; names: Props['names'] }) {
  const isMe = turn.speaker === role;
  const labelColor = turn.speaker === 'host' ? 'text-primary' : 'text-[#3a7a5a]';
  const label = names[turn.speaker] || turn.speaker;
  const main = isMe ? turn.original : turn.translation || turn.original;
  const sub = isMe ? '' : turn.original;
  return (
    <div data-active={turn.active ? 'true' : 'false'} className={turn.active ? 'mt-3' : 'mt-2 opacity-90'}>
      <div className={`text-xs font-bold tracking-wide ${labelColor} ${turn.active ? 'text-sm' : ''}`}>{label}</div>
      <div className={`text-foreground ${turn.active ? 'text-base' : 'text-[15px]'} leading-relaxed`}>{main}</div>
      {sub ? <div className="mt-0.5 ml-1 text-xs text-muted-foreground leading-relaxed">{sub}</div> : null}
    </div>
  );
}

export function RiverTranscript({ turns, role, names }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4" aria-label="conversation transcript">
      {turns.map((t) => (
        <RiverTurn key={t.id} turn={t} role={role} names={names} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
