import { expect } from 'vitest';
import { act } from 'react';

/**
 * 走**真路径**打开设置浮层：点头像 → 点菜单里的「设置」。
 *
 * 🔴 为什么这是一份共享的而不是各测各的：设置是浮层、**条件渲染**
 * （`App.tsx` 里 `{view === 'settings' && …}`），所以"住在设置里的控件"在
 * jsdom 里必须先走到那一层才存在。这条路径原来在三个文件里各有一份逐字相同的
 * 拷贝（`app-mount.spec.tsx`、`detail-pane-collapse.spec.tsx`，加上 H9 第三刀
 * 把语言/主题搬进设置之后需要的第四份）—— 抽取的收尾动作是**删掉旧的那几份**，
 * 不是再抄一份新的（AGENTS §3.5 那条教训）。
 *
 * ⚠️ 这里**不**往 store 里塞 `view`：那会把这一族判据声称要钉的
 * "用户点得到" 变成 "测试自己把门打开了"。
 *
 * 另有两份**故意没并进来**的：`settings-sheet-ia.spec.tsx` 用的是
 * `mousedown` + `click` 两下（它钉的就是头像菜单的开启方式），
 * `journey-ai-memory.integration.spec.tsx` 用的是自己那套 `click()/flush()` 原语。
 */
export async function openSettingsViaAvatar(el: HTMLElement): Promise<void> {
  const avatar = el.querySelector<HTMLButtonElement>('[data-testid="account-menu-avatar"]');
  expect(avatar, '找不到头像').not.toBeNull();
  await act(async () => {
    avatar!.click();
  });
  const item = document.querySelector<HTMLButtonElement>('[data-testid="account-menu-settings"]');
  expect(item, '头像菜单里没有「设置」').not.toBeNull();
  await act(async () => {
    item!.click();
  });
}
