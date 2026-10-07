import { useRef, type ChangeEventHandler } from 'react';
import { useI18n } from '@heyta/i18n';

/** Keep the platform file chooser, with a localized, keyboard-accessible trigger. */
export function SettingsFilePicker({ accept, label, testId, disabled, selected, onChange }: {
  accept: string; label: string; testId: string; disabled: boolean;
  selected: boolean; onChange: ChangeEventHandler<HTMLInputElement>;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  return <>
    <input ref={input} hidden type="file" accept={accept} aria-label={label}
      data-testid={testId} disabled={disabled} onChange={onChange} />
    <button type="button" className="ht-btn ht-btn--ghost" disabled={disabled}
      aria-label={label} onClick={() => input.current?.click()}>
      {t(selected ? 'web.settings.file.replace' : 'web.settings.file.choose')}
    </button>
  </>;
}
