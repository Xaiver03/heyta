/**
 * 主题切换（亮色 / 暗色）
 * =======================
 *
 * 直接改 `<html data-theme>` —— tokens.css 的暗色覆盖挂在这个属性上。
 * **不做逐组件换色**：那样每个新组件都要记得处理暗色，必然漏一处。
 *
 * ⚠️ 与 `apps/web/src/lib/theme.ts` 的关系（刻意说明，不是巧合）：
 *   - **storage key 是两处共享的契约**，必须逐字一致（`heyta.theme`）。
 *     不一致的后果不是报错，而是"用户在应用里选了暗色，落地页却是亮色"，
 *     看起来像主题功能坏了。
 *   - 形状不同是**有意的**：应用那边是纯函数（它在 `useEffect` 里调用），
 *     这里是 hook（落地页只有一个消费点，hook 更短）。
 *   - 这是外壳层的平台胶水，不是业务语义，所以留在 `apps/*` 是合规的
 *     （AGENTS.md §3.5 管的是"业务上该怎么做"，主题持久化不属于它）。
 *   - `index.html` 里的同步引导脚本是**第三处**引用这个 key —— 它必须存在，
 *     否则暗色用户会看到一帧亮色。三处一致由这里的注释钉住。
 */

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/** 与 `apps/web/src/lib/theme.ts` 逐字一致 —— 见文件头。 */
export const THEME_STORAGE_KEY = 'heyta.theme';

/**
 * 初始主题：用户已选 > 系统偏好。
 *
 * **不用 `prefers-color-scheme` 覆盖用户选择** —— 用户明确选了亮色，
 * 系统入夜自动切暗色会很唐突。
 */
function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // 隐私模式下 localStorage 可能抛错。降级到系统偏好，不要崩。
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  ) {
    return 'dark';
  }
  return 'light';
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // 存不上不影响本次生效
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggleTheme };
}
