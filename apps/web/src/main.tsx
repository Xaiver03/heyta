/**
 * 应用入口。
 *
 * **引入顺序有讲究**：tokens 必须在 reset 之前 ——
 * reset 里的每条规则都消费 var(--ht-*)，token 未定义时那一条会整体失效
 * （而失败方式是静默的：属性被丢弃，不报错）。
 */
import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { ErrorScreen } from './features/shell/ErrorScreen.js';
import { initOpLog } from './features/tasks/store.js';

const container = document.getElementById('root');
if (container === null) {
  // 显式抛错而不是静默失败：根节点丢失时白屏最难排查
  throw new Error('找不到 #root 挂载点');
}

const root = createRoot(container);

/**
 * 🔴 必须先完成 op-log 初始化（含**崩溃恢复**）再渲染。
 *
 * 顺序不能换：如果先渲染，用户可能在恢复完成前就发起写入，
 * 而那些待重放的 op 会与新的写入竞争同一个 seq 区间。
 * 且 recover() 必须早于任何同步，否则"已落盘未应用"的 op 永不生效。
 */
initOpLog()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    // 存储不可用时**不能白屏** —— 必须明确告诉用户数据层没起来。
    // 用 ErrorScreen 而不是裸 inline 样式：错误屏同样要受设计系统管。
    const message = error instanceof Error ? error.message : String(error);
    root.render(
      <StrictMode>
        <ErrorScreen
          title="无法初始化本地存储"
          message={message}
          // 「IndexedDB」是浏览器内部的接口名，对用户没有行动价值 ——
          // 换成用户能理解的「浏览器的本地数据库」，并直接给出下一步。
          hint="浏览器可能禁用了本地数据库（无痕模式常见）。关掉无痕模式或换一个浏览器再试。"
        />
      </StrictMode>,
    );
  });
