import { STRINGS, useT, type StringKey } from '../i18n.js';

interface Props {
  /** Machine key ('mic_blocked', 'unauthorized') or a raw error string. */
  message: string;
  onDismiss: () => void;
}

/** Dismissible one-line error surface, floating above the bottom safe area. Tap to dismiss. */
export function ErrorLine({ message, onDismiss }: Props) {
  const t = useT();
  const text = message in STRINGS.en ? t(message as StringKey) : message;
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="absolute inset-x-0 bottom-10 z-30 mx-auto w-fit max-w-sm rounded-full bg-secondary px-4 py-1.5 text-center text-sm text-primary"
    >
      {text}
    </button>
  );
}
