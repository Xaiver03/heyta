import { useEffect, useRef, useState } from 'react';
import { useDirtyDismissGuard } from '../../lib/form/useDirtyDismissGuard.js';
import { WebModalShell } from '../../lib/dialog/WebModalShell.js';
import { Check, Palette, X } from 'lucide-react';

import { cssVar, ICON_SIZE } from '@heyta/design-system';
import { CATEGORY_SLOTS, type CategorySlot } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { categorySlotColor } from '../../lib/category-colors.js';

import { FormField } from '../../lib/form/FormField.js';

import './category-create-dialog.css';

export type CategoryCreateKind = 'project' | 'tag';

interface CategoryCreateDialogProps {
  open: boolean;
  kind: CategoryCreateKind;
  existingNames: readonly string[];
  supportsColor?: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; color?: CategorySlot }) => Promise<void>;
}

/**
 * 清单 / 标签共用的新建对话框。
 *
 * 它只拥有交互状态：实体创建仍由宿主传入的 action 完成。颜色只在宿主
 * 明确声明 domain/action 支持时显示，避免给 Tag 画出一个实际无法保存的控件。
 */
export function CategoryCreateDialog(props: CategoryCreateDialogProps): React.JSX.Element | null {
  const { open, ...formProps } = props;
  // 🔴 P6 现量抓出来的缺陷（不是测试竞态）：草稿 state 原本挂在**关掉后仍存活**的这一层，
  //   重开的那一瞬间 DOM 里还是上一份草稿（实测 `value="诊断清单"`、色槽 1 `aria-pressed=true`），
  //   清草稿的 effect 要等这次 commit 之后才跑。于是"刚点开就按 Esc / 点背景"会弹出
  //   「放弃这次的修改？」去问用户**从没输入过**的内容。
  //   根治不是"清得更早"，是**让草稿随开合重新挂载**：这一层只判开合，state 全在内层。
  if (!open) return null;
  return <CategoryDraftForm {...formProps} />;
}

interface CategoryDraftFormProps extends Omit<CategoryCreateDialogProps, 'open'> {}

function CategoryDraftForm({
  kind,
  existingNames,
  supportsColor = false,
  onClose,
  onCreate,
}: CategoryDraftFormProps): React.JSX.Element {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<CategorySlot | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /* 🔴 名称与颜色都住在本地 state，关掉即丢 ⇒ 三条通道先问一句。
     这一格不在 2026-10-27 立项时点名的四格里 —— 它是 §P1 那枚门禁现量出来的第五格。 */
  const { requestDismiss, guard: discardGuard } = useDirtyDismissGuard({
    overlay: 'modal-dirty-form',
    isDirty: () => name.trim() !== '' || color !== undefined,
    onDismiss: onClose,
  });

  // 提交中要挡住"再按一次"，这一格读的仍是最新值。
  busyRef.current = busy;

  /*
   * P6：焦点进入 / Tab 不外逃 / 关闭归还触发者 / Esc 与背景两条通道全在 `WebModalShell` 里，
   * 本组件不再手写（原来是 44 行 + 一份 `focusableSelector` 的第二答案）。
   * 原来这里还有一枚"每次打开把草稿清干净"的 effect —— **删了**：
   * 草稿现在随开合挂载（见 `CategoryCreateDialog` 那一行），不需要事后清。
   */

  const title = kind === 'project' ? t('web.categories.create.project.title') : t('web.categories.create.tag.title');
  const inputLabel = t('web.categories.create.name');
  const createLabel = kind === 'project' ? t('web.categories.create.project.submit') : t('web.categories.create.tag.submit');

  const submit = async (): Promise<void> => {
    if (busyRef.current) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      // 词条键名原先叫 `…create.empty` —— `check-empty-state` 按**段**判空态
      // （`(^|\.)empty(\.|$)`），于是这句"没填名字"的表单校验被登记成一处手写空态。
      // 改的是**名字**（它本来就不是空态），不是那条判据。
      setError(t('web.categories.create.nameRequired'));
      inputRef.current?.focus();
      return;
    }
    const duplicate = existingNames.some((item) => item.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (duplicate) {
      setError(t('web.categories.create.duplicate', { name: trimmed }));
      inputRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onCreate({ name: trimmed, ...(supportsColor && color !== undefined ? { color } : {}) });
      onClose();
    } catch {
      setError(t('web.categories.create.failed'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <WebModalShell
      overlayClass="ht-category-create-dialog"
      dialogClass="ht-category-create-dialog__dialog"
      labelledBy="ht-category-create-title"
      policy="modal-dirty-form"
      testId="category-create-dialog"
      busy={busy}
      initialFocusRef={inputRef}
      onCancel={onClose}
      onDismissAttempt={(via) => requestDismiss(via)}
      /* 确认框画在遮罩层内、面板之外：同一个层叠上下文里后来者在上，
         不用跟宿主的 z-index 比数字（§7 第 607 条）。 */
      overlayChildren={discardGuard}
    >
        <div className="ht-category-create-dialog__header">
          <h2 id="ht-category-create-title" className="ht-type-section-title">{title}</h2>
          <button
            type="button"
            className="ht-category-create-dialog__close"
            aria-label={t('web.categories.create.close')}
            onClick={() => requestDismiss('escape')}
            disabled={busy}
          >
            <X size={ICON_SIZE.sm} aria-hidden="true" />
          </button>
        </div>

        <form
          className="ht-category-create-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* 🔴 2026-10-24：改用共享 `FormField`（`stacked` 解剖 = 标签在上）。
              `label` 在上是**表单页**的正确解剖（一次录入一组新数据，见 GOV.UK 的
              question pages 与 `packages/ui` 那份约定的出处），而"设置/属性面板"
              才用 `inline`。两档之外没有第三档。
              ⚠️ 错误文案由本组件自己接住（它有 `role="alert"` 与既有的
              `ht-category-create-error`），所以这里**不**传 `error`：
              传了就有两个元素抢同一个 `aria-describedby`。 */}
          <FormField
            id="ht-category-create-name"
            label={inputLabel}
            layout="stacked"
            required
          >
            {(field) => (
              <input
                {...field}
                ref={inputRef}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error !== '') setError('');
                }}
                placeholder={t('web.categories.create.namePlaceholder')}
                aria-invalid={error === '' ? undefined : true}
                aria-describedby={error === '' ? undefined : 'ht-category-create-error'}
                disabled={busy}
              />
            )}
          </FormField>

          {supportsColor ? (
            <fieldset className="ht-category-create-dialog__colors">
              <legend className="ht-category-create-dialog__label">
                <Palette size={ICON_SIZE.xs} aria-hidden="true" />
                {t('web.categories.create.color')}
              </legend>
              <div className="ht-category-create-dialog__palette">
                {CATEGORY_SLOTS.map((slot) => (
                  <button
                    type="button"
                    key={slot}
                    className="ht-category-create-dialog__swatch"
                    aria-label={t('web.categories.create.colorSlot', { slot })}
                    aria-pressed={color === slot}
                    disabled={busy}
                    onClick={() => setColor((current) => (current === slot ? undefined : slot))}
                  >
                    <span className="ht-category-create-dialog__swatch-color" style={{ background: categorySlotColor(slot) }} aria-hidden="true">
                      {color === slot ? <Check size={ICON_SIZE.xs} aria-hidden="true" /> : null}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="ht-category-create-dialog__swatch ht-category-create-dialog__swatch--none"
                  aria-label={t('web.categories.create.colorNone')}
                  aria-pressed={color === undefined}
                  disabled={busy}
                  onClick={() => setColor(undefined)}
                >
                  <span aria-hidden="true" />
                  <span>{t('web.categories.create.colorNoneShort')}</span>
                </button>
              </div>
            </fieldset>
          ) : null}

          {error === '' ? null : (
            <p id="ht-category-create-error" className="ht-category-create-dialog__error" role="alert">
              {error}
            </p>
          )}

          <div className="ht-category-create-dialog__actions">
            <button type="button" className="ht-btn ht-btn--ghost" onClick={() => requestDismiss('escape')} disabled={busy}>
              {t('web.categories.create.cancel')}
            </button>
            <button type="submit" className="ht-btn ht-btn--primary" disabled={busy}>
              <Check size={ICON_SIZE.sm} aria-hidden="true" />
              {busy ? t('web.categories.create.creating') : createLabel}
            </button>
          </div>
        </form>
    </WebModalShell>
  );
}
