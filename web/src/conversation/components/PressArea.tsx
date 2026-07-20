interface Props {
  label: string;
  /** Pair-position color (hex). */
  color: string;
  held: boolean;
  disabled: boolean;
  onDown: () => void;
  onUp: () => void;
}

export function PressArea({ label, color, held, disabled, onDown, onUp }: Props) {
  return (
    <button
      type="button"
      data-held={held}
      disabled={disabled}
      aria-label={label}
      className="flex flex-1 items-center justify-center rounded-2xl border-2 bg-card px-4 text-base font-semibold transition-colors select-none touch-none"
      style={
        held
          ? { background: color, borderColor: color, color: '#fff' }
          : { borderColor: color, color, opacity: disabled ? 0.35 : 1 }
      }
      onPointerDown={(e) => {
        e.preventDefault();
        if (disabled) return;
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // jsdom / older browsers
        }
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      🎤 {label}
    </button>
  );
}
