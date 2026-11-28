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
 * 单选组。**「选 1 个」只有这一种渲染件**（原生 radio + 统一的 `.hta-choice` 行），
 * 不要再拿按钮/选中态伪按钮冒充选项。
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
    <fieldset className={classes} data-testid={testID}>
      {legend === undefined ? null : <legend className="hta-choice-group__legend">{legend}</legend>}
      {options.map((option) => {
        const optionDisabled = disabled || option.disabled === true;
        return (
          <label
            key={option.value}
            className={`hta-choice${optionDisabled ? ' hta-choice--disabled' : ''}`}
          >
            <input
              className="hta-choice__control"
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={optionDisabled}
              onChange={() => onChange(option.value)}
            />
            <span className="hta-choice__label">{option.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
