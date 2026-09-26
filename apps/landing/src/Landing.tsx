/**
 * 落地页根组件
 * ==============
 *
 * 版面顺序（每个区块用**不同的布局族**，避免"八段长得一样"）：
 *   1. 英雄区        非对称分栏（左文右 3D 景）
 *   2. 事实条        四栏等分
 *   3. 能力          非对称 bento 网格
 *   4. 真实界面展厅   滚动固定的横向切换
 *   5. 同步          全宽 3D 画布（WebGL）
 *   6. 隐私          滚动驱动的逐字加密
 *   7. 自建          分栏（终端 + 步骤）
 *   8. 收尾 CTA      居中宣言
 *   9. 页脚
 *
 * 主题：**亮色为主，可切暗色**。切换只改 `<html data-theme>`，
 * 组件零改动 —— 这是设计系统"组件只消费语义变量"的直接收益。
 */

import { lazy, Suspense } from 'react';

import { Nav } from './components/Nav.js';
import { Hero, Facts } from './components/Hero.js';
import { Capabilities } from './components/Capabilities.js';
import { Showcase } from './components/Showcase.js';
import { Deferred } from './components/Deferred.js';
import { Privacy } from './components/Privacy.js';
import { SelfHost } from './components/SelfHost.js';
import { FinalCta } from './components/FinalCta.js';
import { Footer } from './components/Footer.js';
import { useTheme } from './lib/theme.js';

/**
 * WebGL 那一节**动态导入**。
 *
 * 它是唯一依赖 `three` 的模块，而 `three` 打包后是 131 kB gzip 的独立 chunk。
 * 静态导入会让首屏白白下载它；动态导入把它变成一个按需 chunk，
 * 再由 `<Deferred>` 决定"什么时候真的去取"。
 *
 * 用 `lazy` + 显式映射而不是 `lazy(() => import(...))`：后者要求模块
 * **默认导出**，而这里全部用命名导出（仓库统一风格）。
 */
const SyncScene = lazy(async () => {
  const module = await import('./components/SyncScene.js');
  return { default: module.SyncScene };
});

export function Landing(): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        跳到主要内容
      </a>

      <Nav theme={theme} onToggleTheme={toggleTheme} />

      <main id="main">
        <Hero />
        <Facts />
        <Capabilities />
        <Showcase />
        {/* 快滚到这一节才去取 three.js 那个 chunk，并创建 WebGL 上下文 */}
        <Deferred>
          <Suspense fallback={null}>
            <SyncScene />
          </Suspense>
        </Deferred>
        <Privacy />
        <SelfHost />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
