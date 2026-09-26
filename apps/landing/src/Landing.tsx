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
 *   7. 价格          两栏对等对比（免费的自建 / 收费的托管）
 *   8. 自建          分栏（终端 + 步骤）
 *   9. 收尾 CTA      居中宣言
 *  10. 页脚
 *
 * ⚠️ 价格排在自建**之前**：叙述是「只有一件事收费 → 而免费的那条路就在下面」。
 *    反过来放的话，读者先在自建那节读完一整段终端流程，才看到原来还有收费档，
 *    而那时他已经不知道自己在选什么了。导航里的顺序与此一致。
 *
 * 主题：**亮色为主，可切暗色**。切换只改 `<html data-theme>`，
 * 组件零改动 —— 这是设计系统"组件只消费语义变量"的直接收益。
 *
 * 文案迁移的统一取舍（全落地页一致，各文件的数组都照此办理）
 * ------------------------------------------------------------
 * 数据表里的文案**在组件内用 `useMemo(() => [...], [t])` 现构造**，
 * 而不是把词条 key 存进数据、在渲染处再 `t(key)`。
 *
 * 为什么选前者：
 *   1. **渲染处零改动。** 原来写 `{item.title}` 的地方还是 `{item.title}` ——
 *      改成 `t(item.titleKey)` 会把"取值"这件小事扩散到每一个 map 里，
 *      而 map 里混进翻译调用之后，就很难一眼看出数据形状有没有变。
 *   2. **React 的 `key` 不必改。** 原来用 `key={item.title}`（本身就是文案）；
 *      存 key 的话得另加一个与语言无关的 id 字段，那是为翻译付的结构税。
 *   3. `t` 的引用随 `locale` 稳定（`useI18n` 内部 useMemo 只依赖 locale），
 *      所以数组只在**真正切语言**时重建一次，不是每次渲染。
 *
 * 反过来说，`const` 数组从模块级挪进组件是**必要**的：模块级拿不到 hook，
 * 而在模块级读一个全局"当前语言"会让模块单例绑定到第一次执行时的语言 ——
 * 那种 bug 在切语言后才出现，且看起来像"某些文案没更新"。
 */

import { lazy, Suspense } from 'react';

import { useI18n } from '@heyta/i18n';

import { Nav } from './components/Nav.js';
import { Hero, Facts } from './components/Hero.js';
import { Capabilities } from './components/Capabilities.js';
import { Showcase } from './components/Showcase.js';
import { Deferred } from './components/Deferred.js';
import { SceneBoundary } from './components/SceneBoundary.js';
import { SyncFallback } from './components/SyncFallback.js';
import { Privacy } from './components/Privacy.js';
import { Pricing } from './components/Pricing.js';
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
  const { t } = useI18n();

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">
        {t('landing.skipLink')}
      </a>

      <Nav theme={theme} onToggleTheme={toggleTheme} />

      <main id="main">
        <Hero />
        <Facts />
        <Capabilities />
        <Showcase />
        {/* 快滚到这一节才去取 three.js 那个 chunk，并创建 WebGL 上下文 */}
        <Deferred>
          {/*
            🔴 `SceneBoundary` 必须在 `Deferred` **里面**、包住 `Suspense`。
            两层失败要分开看：
              - `Deferred` 自己不会抛，把它留在外面，3D 那一节炸了之后
                外面的占位块还在，页面高度不会塌；
              - `Suspense` 的 children 抛错、以及 **lazy chunk 加载失败**
                （131 kB 的 three 分片在弱网下 404/超时是真会发生的）
                都会冒泡到最近的 boundary。没有它，这两种情况都会
                卸载整棵树 —— 整页白屏，不是"少一节"。
          */}
          <SceneBoundary fallback={<SyncFallback />}>
            <Suspense fallback={null}>
              <SyncScene />
            </Suspense>
          </SceneBoundary>
        </Deferred>
        <Privacy />
        <Pricing />
        <SelfHost />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
