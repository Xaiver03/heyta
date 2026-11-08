/**
 * 「这个按键目标该不该让路」（R19 以及所有全局快捷键）
 * ==================================================
 *
 * ## 为什么单独立一枚
 *
 * 全局快捷键里最容易写错、又最不容易被测到的一格：**在输入框里抢键**。
 * 表现不是报错，而是"我刚打的字被整段撤掉了" —— 用户会以为是输入法或系统坏了。
 *
 * 而它的判据**不是**"焦点在哪"，是"目标是不是一个可编辑控件"：
 * 焦点可以停在 body 上、可以停在按钮上，那些地方 ⌘Z 该由我们处理。
 *
 * ## 🕳️ 一个真实的坑：`contentEditable` 是字符串
 *
 * `element.contentEditable` 返回 `'true' | 'false' | 'inherit' | 'plaintext-only'`，
 * 而 `element.isContentEditable` 才是布尔。用前者做 `if (el.contentEditable)` 判断
 * 的话 `'false'` 是**真值** ⇒ 所有元素都被当成可编辑 ⇒ 快捷键全局失效，
 * 且没有任何报错。这里两个都读，且只认 `=== 'true'` 与 `plaintext-only`。
 *
 * ## 射程
 *
 * 只覆盖标准 HTML 元素。React Native Web 的 `TextInput` 最终渲染成
 * `<input>`/`<textarea>`，所以它自然被覆盖 —— 这正是本仓最常遇到的那一个。
 */

/** 让路的标签名（大写的 `tagName` 形状）。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** 这些 `type` 的 `<input>` **不是**文本编辑（勾选框里按 ⌘Z 该撤销任务，不是撤销勾选）。 */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'file',
  'color',
  'range',
]);

/**
 * 这个事件目标是不是一个"用户正在打字/编辑"的地方。
 *
 * @param target `KeyboardEvent.target`（可能是 null、可能是 Document）
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof Element)) return false;

  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;

  if (tag === 'INPUT') {
    const type = (target.getAttribute('type') ?? 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }

  // 富文本编辑器（含 RNW 的 multiline、以及各种 contenteditable 容器）。
  const editable = target.getAttribute('contenteditable');
  if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
  // `isContentEditable` 会把"父级可编辑"也算进来（`contenteditable` 是继承的）。
  return (target as HTMLElement).isContentEditable === true;
}
