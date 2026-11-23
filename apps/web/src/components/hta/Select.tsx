import { useId } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { ChevronDown } from 'lucide-react';

import { FormField, type FormFieldLayout } from '../../lib/form/FormField.js';
import './hta.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  /** 省略则用 `useId()`；与 `label` 的 `htmlFor` 关联。 */
  readonly id?: string;
  readonly label: string;
  /** `stacked`（表单页，默认）| `inline`（设置面板）。只这两档。 */
  readonly layout?: FormFieldLayout;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  /** 作为空值占位项（`disabled`，不可选），用于「请选择」。 */
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly name?: string;
  readonly testID?: string;
}

/**
 * 原生 `<select>` + `.ht-input-field__select` 外壳 + `FormField` 标签。
 *
 * 不引第三方 Select：外观与高度统一由 `form.css` 的 `.ht-input-field*` 承担，
 * 标签/错误/aria 关联由 `FormField` 的 render prop 摊到真正的 `<select>` 上。
 */
export function Select({
  id,
  label,
  layout = 'stacked',
  hint,
  error,
  required = false,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  name,
  testID,
}: SelectProps): React.JSX.Element {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <FormField
      id={fieldId}
      label={label}
      layout={layout}
      hint={hint}
      error={error}
      required={required}
      testID={testID}
    >
      {(field) => (
        <div className="ht-input-field__select">
          <select
            {...field}
            value={value}
            name={name}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          >
            {placeholder === undefined ? null : (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown size={ICON_SIZE.xs} aria-hidden="true" />
        </div>
      )}
    </FormField>
  );
}
