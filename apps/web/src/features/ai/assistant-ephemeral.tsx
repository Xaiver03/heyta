/**
 * 助手面板的**未决状态**：住在挂载点之上，不跟着面板一起被重挂载。
 *
 * ## 为什么必须是 React 的状态，而不是模块级变量
 *
 * AI 面住在右栏（`.ht-app__detail`）。那一栏在 ≤1023px 是 `display:none`，
 * 而 `App.tsx` 量的就是它**实际有没有宽度**（真源是 CSS，JS 里不许抄那个数字）。
 * 于是量到 0 ⇒ 面板退回中间列 ⇒ **DOM 父节点换了 = 子树重挂载**。
 * 触发这件事不需要人拖窗口：`e2e/tests/ai-assistant.spec.ts` 里那张 `fullPage`
 * 截图就会让 Chromium 在捕获期间把右栏算成 `display:none`（探针现量
 * `{"mounted":true,"w":0,"disp":"none"}`）。
 *
 * 重挂载对用户做了两件坏事：把**已经摆在眼前的出境披露**连同用户打了一半的那句
 * 一起收回初始态 —— 等于替用户悄悄取消了一次同意请求；以及让"正在跑"这个指示
 * 归零，用户于是可以再点一次发送。
 *
 * 试过并把它们**否证**掉的两条：
 * · portal 合并挂载点 —— 换 portal 的容器同样重挂载子树（探针数到 4 次挂载）；
 * · 模块级 ephemeral —— `vitest` 那四个套件 16 failed，同一进程里反复挂载的
 *   用例互相串状态。**所以这份状态必须由一次挂载拥有它**，不能住在模块上。
 *   下面那个 `owner` 绑定（见下一节）同时挡住了另一种串法：**跨账号**。
 *
 * ## 🔴 账号绑定：换账号不许带走一个字
 *
 * `assistant-history.ts` 文件头第 3 条把落盘的会话绑在账号上（记录里的账号与
 * 当前凭据不相等就当没有）。这份未决状态里躺着**用户还没发出去的原话**，
 * 同一道绑定一条都不能少 —— 而它比盘上那份更危险：它活在一次页面生命周期里，
 * 登出/换号**不重新加载页面**。
 *
 * 规则是**每次读写都查**，而不是只在挂载时查一次：
 * · 读：`owner` 与当前账号不符 ⇒ 渲染成空（不额外渲染出别人的一个字）；
 * · 写：`owner` 不符 ⇒ **整份作废再落**，不许只改一个字段（否则别人的
 *   `pending` 会留在这份状态里，下一位读者就看得见）。
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** 助手面板的会话阶段（原来住在面板里，搬上来才能跨重挂载存活）。 */
export type AssistantPhase = 'idle' | 'disclose' | 'running';

/** 未决状态本体。`owner` = `undefined` 表示**还没有人写过**。 */
export interface AssistantEphemeralState {
  owner: string | null | undefined;
  draft: string;
  pending: string | undefined;
  phase: AssistantPhase;
}

const EMPTY: Omit<AssistantEphemeralState, 'owner'> = {
  draft: '',
  pending: undefined,
  phase: 'idle',
};

export interface AssistantEphemeral extends AssistantEphemeralState {
  /**
   * 落一个字段。
   *
   * 🔴 `account` 是**调用方当下的账号**（面板在挂载时算一次并固定下来）：
   * 与 `owner` 不符时整份重置后再落，符合时原地改。
   */
  write(account: string | null, patch: Partial<typeof EMPTY>): void;
}

const AssistantEphemeralContext = createContext<AssistantEphemeral | null>(null);

export function AssistantEphemeralProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [state, setState] = useState<AssistantEphemeralState>({ ...EMPTY, owner: undefined });

  const value = useMemo<AssistantEphemeral>(
    () => ({
      ...state,
      write(account: string | null, patch: Partial<typeof EMPTY>): void {
        setState((previous) => {
          if (previous.owner !== account) return { ...EMPTY, owner: account, ...patch };
          return { ...previous, ...patch };
        });
      },
    }),
    [state],
  );

  return <AssistantEphemeralContext.Provider value={value} children={children} />;
}

/**
 * 取那份未决状态。
 *
 * 🔴 没有 Provider 就**抛错**，不静默回退到面板自己的 `useState`：
 * 回退会让"忘了接线"读起来像"这条本来就不需要跨挂载"，而它的表现是
 * 用户在某个窗口宽度下被悄悄取消一次同意请求 —— 没人会把它和接线联系起来。
 * 共享层的 `HeytaUiProvider` 是同一条立场。
 */
export function useAssistantEphemeral(): AssistantEphemeral {
  const value = useContext(AssistantEphemeralContext);
  if (value === null) {
    throw new Error('AssistantPanel 必须包在 <AssistantEphemeralProvider> 里');
  }
  return value;
}
