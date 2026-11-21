import { useId, type ReactNode } from 'react';

import './hta.css';

interface SwitchBaseProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly testID?: string;
}

/** 有可见 label 时用 label；没有可见 label 时必须给 `ariaLabel`。 */
export type SwitchProps = SwitchBaseProps &
  (
    | { readonly label: ReactNode; readonly ariaLabel?: undefined }
    | { readonly label?: undefined; readonly ariaLabel: string }
  );

/**
 * 即时生效的开关（`role="switch"`）。
 *
 * 只在「拨一下就生效」处用它；需要审批/提交的开关不要用 Switch 伪装。
 */
export function Switch(props: SwitchProps): React.JSX.Element {
  const { checked, onChange, disabled = false, id, testID } = props;
  const autoId = useId();
  const inputId = id ?? autoId;
  const ariaLabel = props.label === undefined ? props.ariaLabel : undefined;

  return (
    <label
      className={`hta-switch${disabled ? ' hta-switch--disabled' : ''}`}
      htmlFor={inputId}
      data-testid={testID}
    >
      <input
        id={inputId}
        className="hta-switch__control"
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {props.label === undefined ? null : <span className="hta-switch__label">{props.label}</span>}
    </label>
  );
}
