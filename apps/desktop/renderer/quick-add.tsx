/**
 * 快速添加面板（R6 判据②的那一页）
 * ================================
 *
 * 🔴 这一页**没有任何业务逻辑**（AGENTS.md §3.5）。它只做三件事：
 *   1. 收一句话；
 *   2. 经 `window.heytaDesktop.request({ method: 'addTask', title })` 递回主进程 ——
 *      落库走的是**既有那一条 op 写入口**：
 *      `ipc-contract.ts` 的 `case 'addTask'` → `host.addTask` →
 *      `packages/app-host/src/actions.ts` 的 `createTaskActions().create` →
 *      `dispatchCreate` 发**一条** `OpType.Create` ⇒ op-log。
 *      这里不写数据库、不拼 op、也不解释任何字段：不带 `projectId` 就是收集箱，
 *      而那件事由共享层决定，不由这一页决定。
 *   3. 把结果如实说出来（`已添加：…` / `没存进去：…`）。
 *
 * ⚠️ 与 `main.tsx` 一样**不引 `@heyta/i18n`**，理由写在那个文件头里
 * （桌面端引第二份 React 崩过一次）。
 */

import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 🔴 设计 token 必须引，否则 `var(--ht-*)` 全部静默失效
 * （症状是样式消失、不报错，`check:design` 也照样绿 —— 见 `main.tsx` 同一段注释）。
 */
import '@heyta/design-system/tokens.css';

const L = {
  placeholder: '记一句话，回车就存下来',
  /**
   * 落点写进提示里，而不是让用户猜。
   * ⚠️ 「收集箱」这个词与 `packages/i18n` 的 `web.rowMenu.inbox` 同一含义
   *（无清单归属时的默认落点），这里只是把它说给人听，归属仍由共享层决定。
   */
  hint: '回车存入收集箱 · Esc 关闭',
  added: (title: string): string => `已添加：${title}`,
  failed: (reason: string): string => `没存进去：${reason}`,
} as const;

function QuickAdd(): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 提交一条。
   *
   * 🔴 成功后**不清空也不关面板**（只清输入框），因为这一页的存在理由就是
   * "连着记几条"：每次都要重新按键唤出，比滴答的界面慢一步。
   * ⚠️ 标题的 trim 与空值拒绝都在共享层（`dispatchCreate` 里那句
   * "任务标题不能为空"），所以这里**不自己判空** —— 判了就是第二份标准，
   * 而两份标准迟早给出两个答案。
   */
  const submit = useCallback((): void => {
    const trimmed = title;
    if (trimmed.trim() === '') {
      // 空格标题递过去会被共享层拒掉；这里先不说谎，也不替它决定"那就不发"。
      // 什么都不做 = 输入框保持原样，用户知道自己还没写完。
      return;
    }
    window.heytaDesktop
      .request({ method: 'addTask', title: trimmed })
      .then(() => {
        setAdded(trimmed);
        setError(null);
        setTitle('');
        inputRef.current?.focus();
      })
      .catch((cause: unknown) => {
        setError(String(cause));
      });
  }, [title]);

  return (
    /**
     * 所有尺寸/颜色走 token，与 `main.tsx` 同一条纪律
     * （`check:design` 的 SCAN_ROOTS 包含 `apps/desktop/renderer`）。
     */
    <main
      data-testid="quick-add-root"
      style={{
        fontFamily: 'system-ui, sans-serif',
        fontSize: 'var(--ht-font-size-base)',
        padding: 'var(--ht-space-4)',
        background: 'var(--ht-color-background)',
        color: 'var(--ht-color-foreground)',
      }}
    >
      <input
        ref={inputRef}
        data-testid="quick-add-input"
        autoFocus
        placeholder={L.placeholder}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            /**
             * 面板没有标题栏（`frame: false`），所以 Esc 是它**唯一**的关闭出口。
             * ⚠️ 这条不是便利而是必需：没有出口的话，一个不抢前台的浮窗
             *    会变成"关不掉的窗口"。
             */
            window.close();
          }
        }}
        style={{
          width: '100%',
          fontSize: 'var(--ht-font-size-md)',
          padding: 'var(--ht-space-2)',
          border: 'var(--ht-border-width-thin) solid var(--ht-color-border)',
          borderRadius: 'var(--ht-radius-button)',
        }}
      />

      <p data-testid="quick-add-hint" style={{ margin: 'var(--ht-space-2) 0 0', color: 'var(--ht-color-foreground-muted)' }}>
        {L.hint}
      </p>

      {error !== null ? (
        <p data-testid="quick-add-error" style={{ margin: 'var(--ht-space-2) 0 0', color: 'var(--ht-color-danger-strong)' }}>
          🔴 {L.failed(error)}
        </p>
      ) : null}

      {added !== null ? (
        <p data-testid="quick-add-receipt" style={{ margin: 'var(--ht-space-2) 0 0', color: 'var(--ht-color-foreground-muted)' }}>
          {L.added(added)}
        </p>
      ) : null}
    </main>
  );
}

const container = document.getElementById('root');
if (container === null) {
  // `quick-add.html` 里写死了这个 id；缺了就是那份文件被改坏了。
  throw new Error('renderer/quick-add.html 缺少 #root');
}

createRoot(container).render(<QuickAdd />);
