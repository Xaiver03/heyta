/**
 * 落地页入口。
 *
 * 与 `apps/web` 的入口一致地**先引 token 再引组件样式** ——
 * 顺序反过来会让组件样式里的 `var(--ht-*)` 在首帧解析不到值。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';
import './styles/landing.css';

import { Landing } from './Landing.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('找不到挂载点 #root');
}

createRoot(container).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
