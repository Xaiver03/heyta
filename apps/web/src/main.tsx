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

const container = document.getElementById('root');
if (container === null) {
  // 显式抛错而不是静默失败：根节点丢失时白屏最难排查
  throw new Error('找不到 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
