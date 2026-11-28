import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type { ReactNode } from 'react';

import './hta.css';

export interface RadioGroupOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface RadioGroupProps {
  /** 同组单选必须共用同一个 `name`。 */
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly RadioGroupOption[];
  /** 可见的组标题（`legend`）。 */
  readonly legend?: ReactNode;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly disabled?: boolean;
  readonly testID?: string;
}

/**
 * 单选组。**「选 1 个」只有这一种渲染件**（Radix `RadioGroup` + 统一的 `.hta-choice` 行），
 * 不要再拿按钮/选中态伪按钮冒充选项。
 *
 * `Root` 用 `asChild` 落到原生 `<fieldset>` 上，保留 `legend` 的分组语义；
 * 选项态外观走 `data-state="checked|unchecked"`（见 hta.css）。
 */
export function RadioGroup({
  name,
  value,
  onChange,
  options,
  legend,
  orientation = 'vertical',
  disabled = false,
  testID,
}: RadioGroupProps): React.JSX.Element {
  const classes = ['hta-choice-group', orientation === 'horizontal' ? 'hta-choice-group--horizontal' : '']
    .filter((part) => part !== '')
    .join(' ');
  return (
    <RadioGroupPrimitive.Root
      asChild
      className={classes}
      value={value}
      onValueChange={onChange}
      orientation={orientation}
      disabled={disabled}
      name={name}
      data-testid={testID}
    >
      <fieldset>
        {legend === undefined ? null : <legend className="hta-choice-group__legend">{legend}</legend>}
        {options.map((option) => {
          const optionDisabled = disabled || option.disabled === true;
          return (
            <label
              key={option.value}
              className={`hta-choice${optionDisabled ? ' hta-choice--disabled' : ''}`}
            >
              <RadioGroupPrimitive.Item
                className="hta-choice__control hta-choice__control--radio"
                value={option.value}
                disabled={optionDisabled}
              >
                <RadioGroupPrimitive.Indicator className="hta-choice__indicator hta-choice__indicator--radio" />
              </RadioGroupPrimitive.Item>
              <span className="hta-choice__label">{option.label}</span>
            </label>
          );
        })}
      </fieldset>
    </RadioGroupPrimitive.Root>
  );
}
