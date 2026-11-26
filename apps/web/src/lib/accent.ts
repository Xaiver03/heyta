/**
 * 强调色（accent）—— 设备本地偏好（Web）
 * ======================================
 *
 * 补的是外观格 #56 的「自定义主题编辑」：此前只有亮暗 + 表面配色（warm / mist）+ 字号，
 * 用户无法改**主色**。这里给主色（primary）一族做一层可选的覆盖。
 *
 * ## 🔴 三条纪律
 *
 * 1. **设备属性、零 op**（[ADR-0085](../../../../docs/adr/0085-appearance-is-device-local-and-never-an-op.md)）：
 *    "我这台机器长什么样"不是数据变更，所以这里一行 `dispatch(` 都没有，只写 `localStorage`。
 * 2. **走设计 token，不发明色值**：每个强调色都引用 tokens.css 里**已有的原色阶**
 *    （`--ht-emerald-600` 等），hover / active / subtle 由 `color-mix()` 从同一个基色派生。
 *    渲染层仍然只消费 `--ht-color-primary*` 语义变量，组件代码零改动。
 * 3. **`default` = 清空覆盖**：不写任何 inline 变量，基准那套 token 一个字符都不变。
 *
 * ⚠️ `--ht-color-on-primary`（主按钮文字色）**按强调色逐个指定**，不是算出来的：
 *    琥珀/翠绿/天蓝的主色偏亮，白字压上去过不了 AA，必须用深色字。判据在
 *    `apps/web/tests/accent.spec.ts`（逐档算对比度）。
 */

/** 存储键。🔴 只导出给判据用；产品代码走 `loadAccent` / `saveAccent`。 */
export const ACCENT_STORAGE_KEY = 'heyta.accent';

export const ACCENTS = ['default', 'emerald', 'sky', 'amber'] as const;
export type Accent = (typeof ACCENTS)[number];

/** 非默认强调色到「基色 token」与「主按钮文字 token」的映射（逐档手定，见文件头）。 */
const ACCENT_TOKENS: Record<
  Exclude<Accent, 'default'>,
  { lightBase: string; darkBase: string; onColor: string }
> = {
  // 翠绿 / 天蓝 / 琥珀的主色在亮色下也偏亮，白字不达标 ⇒ 深色字。
  emerald: { lightBase: '--ht-emerald-600', darkBase: '--ht-emerald-400', onColor: '--ht-slate-950' },
  sky: { lightBase: '--ht-sky-600', darkBase: '--ht-sky-400', onColor: '--ht-slate-950' },
  amber: { lightBase: '--ht-amber-600', darkBase: '--ht-amber-400', onColor: '--ht-slate-950' },
};

/** 覆盖的语义变量名（`applyAccent('default')` 要把它们全部删掉）。 */
const ACCENT_VARS = [
  '--ht-color-primary',
  '--ht-color-primary-hover',
  '--ht-color-primary-active',
  '--ht-color-primary-subtle',
  '--ht-color-primary-subtle-hover',
  '--ht-color-on-primary',
] as const;

export type AccentTheme = 'light' | 'dark';

/**
 * 一个强调色在给定明暗下应该写成哪 6 个变量值。
 *
 * 纯函数：不碰 DOM、不读存储。`default` 返回空对象（= 不覆盖任何东西）。
 */
export function accentVariables(accent: Accent, theme: AccentTheme): Record<string, string> {
  if (accent === 'default') return {};
  const spec = ACCENT_TOKENS[accent];
  const base = `var(${theme === 'dark' ? spec.darkBase : spec.lightBase})`;
  // 亮色下 hover/active 往**深**走，暗色下往**浅**走 —— 与 tokens.css 的
  // blue-600 → 700 → 800（亮）/ blue-400 → 300 → 200（暗）同一条方向。
  const toward = theme === 'dark' ? 'var(--ht-white)' : 'var(--ht-slate-950)';
  // subtle 底：亮色往白里兑，暗色往深底（ink-900）里兑。
  const subtleBase = theme === 'dark' ? 'var(--ht-ink-900)' : 'var(--ht-white)';
  return {
    '--ht-color-primary': base,
    '--ht-color-primary-hover': `color-mix(in srgb, ${base} 88%, ${toward})`,
    '--ht-color-primary-active': `color-mix(in srgb, ${base} 76%, ${toward})`,
    '--ht-color-primary-subtle': `color-mix(in srgb, ${base} 10%, ${subtleBase})`,
    '--ht-color-primary-subtle-hover': `color-mix(in srgb, ${base} 18%, ${subtleBase})`,
    '--ht-color-on-primary': `var(${spec.onColor})`,
  };
}

/** 读强调色；认不出（脏值 / 旧版本 / 已删掉的档）一律回落 `default`。 */
export function loadAccent(): Accent {
  try {
    const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (raw !== null && (ACCENTS as readonly string[]).includes(raw)) {
      return raw as Accent;
    }
  } catch {
    // 隐私模式：读不到就当没设过。
  }
  return 'default';
}

/** 记下用户选的强调色。写不上不致命（隐私模式）。 */
export function saveAccent(accent: Accent): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // 存不上不影响本次生效。
  }
}

/**
 * 把强调色应用到 `<html>` 的 inline 变量上（幂等）。
 *
 * 🔴 与 `applyTheme` / `applyThemePreset` 同一契约：**只应用、不写盘**。
 * `default` 会先删掉 6 个变量，把控制权交回 tokens.css（基准色）。
 */
export function applyAccent(accent: Accent, theme: AccentTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const name of ACCENT_VARS) root.style.removeProperty(name);
  const vars = accentVariables(accent, theme);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}
