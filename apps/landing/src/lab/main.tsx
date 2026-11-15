/**
 * 试验台入口。
 *
 * 与 `apps/landing/src/main.tsx` 一样**先引 token 再引样式** ——
 * 顺序反过来会让首帧解析不到 `var(--ht-*)`。
 *
 * 🔴 这里不引 `landing.css`：试验台要的是设计系统本身，
 * 而不是落地页的版式；混进来会让人分不清"这个手感是 token 给的还是页面的"。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@heyta/design-system/tokens.css';
import '@heyta/design-system/reset.css';
import './lab.css';

import { MotionLab } from './MotionLab.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('找不到挂载点 #root');
}

createRoot(container).render(
  <StrictMode>
    <MotionLab />
  </StrictMode>,
);
