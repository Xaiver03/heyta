import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
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
 *
 * 内部是 Radix `Checkbox`（渲染真实 `<button role="checkbox">`），勾选态外观走
 * `data-state="checked|unchecked"`（见 hta.css）。
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
  const controlId = id ?? autoId;
  return (
    <label
      className={`hta-choice${disabled ? ' hta-choice--disabled' : ''}`}
      htmlFor={controlId}
      data-testid={testID}
    >
      <CheckboxPrimitive.Root
        id={controlId}
        className="hta-choice__control"
        checked={checked}
        onCheckedChange={(state) => onChange(state === true)}
        disabled={disabled}
        name={name}
        value={value}
      >
        <CheckboxPrimitive.Indicator className="hta-choice__indicator">✓</CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="hta-choice__label">{label}</span>
    </label>
  );
}
