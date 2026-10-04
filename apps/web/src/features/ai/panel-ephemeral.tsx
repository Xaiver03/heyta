/**
 * AI 面板的**未决状态**：住在挂载点之上，不跟着面板一起被重挂载。
 *
 * ## 为什么必须是 React 的状态，而不是模块级变量
 *
 * 两个 AI 面板（单步工具 `AiToolRun` 与对话助手 `AssistantPanel`）住在右栏
 * （`.ht-app__detail`）。那一栏在 ≤1023px 是 `display:none`，而 `App.tsx` 量的
 * 是它**实际有没有宽度**（真源是 CSS，JS 里再抄一个数字就是一份会漂的抄件）。
 * 于是量到 0 ⇒ 面板退回中间列 ⇒ **DOM 父节点换了 = 子树重挂载**。
 * 触发这件事不需要人拖窗口：`e2e/tests/ai-assistant.spec.ts` 里那张 `fullPage`
 * 截图就会让 Chromium 在捕获期间把右栏算成 `display:none`（探针现量
 * `{"mounted":true,"w":0,"disp":"none"}`）。
 *
 * 重挂载对用户做了两件坏事：把**已经摆在眼前的出境披露**连同用户打了一半的那句
 * 一起收回初始态 —— 等于替他悄悄取消了一次同意请求；以及让"正在跑"这个指示
 * 归零，用户于是可以再点一次发送。
 *
 * 试过并把它们**否证**掉的两条：
 * · portal 合并挂载点 —— 换 portal 的容器同样重挂载子树（探针数到 4 次挂载）；
 * · 模块级 ephemeral —— `vitest` 那四个套件 16 failed，同一进程里反复挂载的
 *   用例互相串状态。**所以这份状态必须由一次挂载拥有它**，不能住在模块上。
 *   下面那个 `owner` 绑定（见下一节）同时挡住了另一种串法：**跨账号**。
 *
 * ## 为什么是一份泛型存储，而不是每个面板各写一份
 *
 * 两个面板要跨重挂载留下的东西**不是同一组字段**（助手：草稿 + 等披露的那一句 +
 * 阶段；单步：输入 + 阶段 + 结果 + 提案确认结果），但**规则逐字相同**：
 * 按 key 存一份、每次读写都查账号、Provider 由一次挂载拥有。
 * 抄两份的代价本仓库量过两次（§3.5：任务 op 构造与同步接线各有一份抄件，
 * 两份都漂了）—— 而这里漂了的不是"字段名"，是**账号绑定那一步**，
 * 它一旦只在一份里存在，另一份就是跨账号泄漏用户原话的那条路。
 *
 * ## 🔴 账号绑定：换账号不许带走一个字
 *
 * `assistant-history.ts` 文件头第 3 条把落盘的会话绑在账号上（记录里的账号与
 * 当前凭据不相等就当没有）。这份未决状态里躺着**用户还没发出去的原话**，
 * 同一道绑定一条都不能少 —— 而它比盘上那份更危险：它活在一次页面生命周期里，
 * 登出/换号**不重新加载页面**。
 *
 * 规则是**每次读写都查**，而不是只在挂载时查一次：
 * · 读：`owner` 与当前账号不符 ⇒ 渲染成初始值（不额外渲染出别人的一个字）；
 * · 写：`owner` 不符 ⇒ **整份作废再落**，不许只改一个字段（否则别人的
 *   未决那一条会留在这份状态里，下一位读者就看得见）。
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import { loadCredentials } from '../sync/credential-storage.js';

/**
 * 这段会话属于哪个账号 —— 用的是凭据里那个邮箱**标签**（`credential-storage` 里
 * 明确写着它不是秘密）。落盘记录绑它，读的时候不相等就当没有。
 *
 * 🔴 两个面板共用这一枚函数，而不是各写一份：账号绑定是这份状态的**安全判据**，
 * 抄一份漂一份的代价本仓库量过两次（AGENTS §3.5）。
 * ⚠️ 调用方一律在**挂载时**取一次并固定（`useState(currentAccount)`），
 * 不在 render 体里调 —— 那是每次渲染多读一遍盘，而且会让"身份"中途换人。
 */
export function currentAccount(): string | null {
  return loadCredentials()?.email ?? null;
}

/** 一个面板的未决状态：`owner` = `undefined` 表示**还没有人写过**。 */
interface Entry {
  owner: string | null | undefined;
  value: Record<string, unknown>;
}

/** 泛型边界只有这一处（`value` 在存储里按 `Record` 存，读写各转一次）。 */
interface PanelEphemeral<T extends object> {
  /** 这份状态属于哪个账号（`undefined` = 还没人写过）。 */
  readonly owner: string | null | undefined;
  /** 账号不符时拿到的是**初始值**（见文件头那条"读也查"）。 */
  readonly value: T;
  /**
   * 落一个补丁。
   *
   * 🔴 `account` 是**调用方当下的账号**（面板挂载时算一次并固定下来）：
   * 与 `owner` 不符时整份重置后再落，符合时原地改。
   */
  write(account: string | null, patch: Partial<T>): void;
}

const PanelEphemeralContext = createContext<
  | {
      entries: Record<string, Entry>;
      setEntries: (next: (previous: Record<string, Entry>) => Record<string, Entry>) => void;
    }
  | null
>(null);

export function PanelEphemeralProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const value = { entries, setEntries };
  return <PanelEphemeralContext.Provider value={value} children={children} />;
}

/**
 * 取某个面板的未决状态。
 *
 * 🔴 没有 Provider 就**抛错**，不静默回退到面板自己的 `useState`：
 * 回退会让"忘了接线"读起来像"这条本来就不需要跨挂载"，而它的表现是
 * 用户在某个窗口宽度下被悄悄取消一次同意请求 —— 没人会把它和接线联系起来。
 * 共享层的 `HeytaUiProvider` 是同一条立场。
 */
export function usePanelEphemeral<T extends object>(
  key: string,
  account: string | null,
  initial: T,
): PanelEphemeral<T> {
  const store = useContext(PanelEphemeralContext);
  if (store === null) {
    throw new Error(`AI 面板必须包在 <PanelEphemeralProvider> 里（key=${key}）`);
  }
  const entry = store.entries[key];
  const write = useCallback(
    (nextAccount: string | null, patch: Partial<T>): void => {
      store.setEntries((previous) => {
        const before = previous[key];
        const merged =
          before === undefined || before.owner !== nextAccount
            ? { ...initial, ...patch }
            : { ...before.value, ...patch };
        return { ...previous, [key]: { owner: nextAccount, value: merged as Record<string, unknown> } };
      });
    },
    // `store.setEntries` 是 React 的 setState（稳定标识）；`initial` 必须是常量，
    // 所以调用方一律传**模块级**的那一份，不在 render 里现造对象字面量。
    [key, store, initial],
  );
  // 🔴 读侧也查账号（不是只在写的时候查）：换号不重新加载页面，
  // 而这一份里躺着上一位用户**还没发出去的原话**。
  const visible = entry !== undefined && entry.owner === account ? entry.value : initial;
  return {
    owner: entry?.owner,
    value: visible as T,
    write,
  };
}
