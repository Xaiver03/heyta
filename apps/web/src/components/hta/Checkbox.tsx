import { useId, type ReactNode } from 'react';

import './hta.css';

export interface CheckboxProps {
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly name?: string;
  readonly value?: string;
  readonly id?: string;
  readonly testID?: string;
}

/**
 * 复选（可多选）。label 是**选项名**，不走 `FormField`（那不是字段解剖）。
 */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  name,
  value,
  id,
  testID,
}: CheckboxProps): React.JSX.Element {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label
      className={`hta-choice${disabled ? ' hta-choice--disabled' : ''}`}
      htmlFor={inputId}
      data-testid={testID}
    >
      <input
        id={inputId}
        className="hta-choice__control"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="hta-choice__label">{label}</span>
    </label>
  );
}
