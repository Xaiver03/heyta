import * as SwitchPrimitive from '@radix-ui/react-switch';
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
 * 即时生效的开关（Radix `Switch`，渲染真实 `<button role="switch">`）。
 *
 * 只在「拨一下就生效」处用它；需要审批/提交的开关不要用 Switch 伪装。
 * 状态外观走 `data-state="checked|unchecked"`（见 hta.css），不再靠 `:checked`。
 */
export function Switch(props: SwitchProps): React.JSX.Element {
  const { checked, onChange, disabled = false, id, testID } = props;
  const autoId = useId();
  const controlId = id ?? autoId;
  const ariaLabel = props.label === undefined ? props.ariaLabel : undefined;

  return (
    <div className={`hta-switch${disabled ? ' hta-switch--disabled' : ''}`} data-testid={testID}>
      <SwitchPrimitive.Root
        id={controlId}
        className="hta-switch__control"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <SwitchPrimitive.Thumb className="hta-switch__thumb" />
      </SwitchPrimitive.Root>
      {props.label === undefined ? null : (
        <label className="hta-switch__label" htmlFor={controlId}>
          {props.label}
        </label>
      )}
    </div>
  );
}
