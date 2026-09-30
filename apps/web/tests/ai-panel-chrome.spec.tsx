/**
 * AI 面板的**外壳**只有一个实现
 * ================================
 *
 * `ai` 面板族的第一刀把「面板头部」从 5 个面板的 14 处手抄 JSX 收成
 * `@heyta/ui` 的 `AiPanelHead`（web 侧经 `AiPanelHeadHost` 适配器挂 Provider）。
 *
 * 这一组断言钉的是**收编不会退回去**：
 *
 *   1. 面板里**不许**再出现手写的 `ht-ai__head`（旧实现已删，CSS 规则也删了）；
 *   2. 每个面板都必须从适配器取头部；
 *   3. **关闭按钮必须带可访问名** —— `closeLabel` 与 `onClose` 成对；
 *   4. 共享组件必须登记进 `check-ui-provider` 的锚点清单
 *      （漏登记 = 没有门禁盯着"宿主挂了 Provider 吗"）。
 *
 * ⚠️ 与所有源码级断言一样，挡的是"复制粘贴忘改"，不是"故意绕过"；
 * 真正的行为判据在各面板自己的 spec 里（它们全都按 `data-testid` 定位关闭按钮）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const AI_DIR = resolve(HERE, '../src/features/ai');

import { AiPanelHost } from '../src/features/ai/AiPanelHost.js';

const PANELS = ['AiBreakdown', 'AiCapture', 'AiDuration', 'AiPrioritize', 'AiToolRun'] as const;

function panelSource(name: (typeof PANELS)[number]): string {
  return readFileSync(join(AI_DIR, `${name}.tsx`), 'utf8');
}

describe('AI 面板头部：共享实现，不许退回手抄', () => {
  it('面板里没有再手写 `ht-ai__head`', () => {
    const offenders = PANELS.filter((name) => panelSource(name).includes('ht-ai__head'));
    expect(
      offenders,
      '这些面板还在手写面板头部 —— 共享实现是 `AiPanelHead`（web 走 `AiPanelHeadHost`）：',
    ).toEqual([]);
  });

  it('旧 CSS 规则也删了（不留"看起来还在用"的死规则）', () => {
    const css = readFileSync(resolve(HERE, '../src/styles/app.css'), 'utf8');
    expect(css).not.toContain('.ht-ai__head');
  });

  it('每个面板都从适配器取头部', () => {
    const offenders = PANELS.filter(
      (name) => !panelSource(name).includes("from './AiPanelHeadHost.js'"),
    );
    expect(offenders, '这些面板没有走共享头部适配器：').toEqual([]);
  });

  it('🔴 关闭按钮必须带可访问名：`closeLabel` 与 `onClose` 成对出现', () => {
    const offenders = PANELS.filter((name) => {
      const src = panelSource(name);
      const onClose = (src.match(/onClose=\{/gu) ?? []).length;
      const closeLabel = (src.match(/closeLabel=\{/gu) ?? []).length;
      return onClose !== closeLabel;
    });
    expect(
      offenders,
      '这些面板里 `onClose` 与 `closeLabel` 不成对 —— 没有可访问名的关闭按钮对读屏用户等于不存在：',
    ).toEqual([]);
  });

  it('共享组件登记进了 `check-ui-provider` 的锚点清单', () => {
    const gate = readFileSync(resolve(ROOT, 'scripts/check-ui-provider.mjs'), 'utf8');
    expect(gate).toContain("'AiPanelHead'");
  });

  it('适配器自己挂 Provider（否则共享组件在 web 上会抛"必须在 Provider 内"）', () => {
    const host = readFileSync(join(AI_DIR, 'AiPanelHeadHost.tsx'), 'utf8');
    expect(host).toContain('HeytaUiProvider');
    expect(host).toContain('AiPanelHead');
  });
});

/**
 * 🔴 面板容器必须**说得出自己是什么**
 * ====================================
 *
 * 实测（2026-09-29）：全仓 **19 个** `ht-ai__panel` 容器里有 **6 个**没有
 * `role` / `aria-label` —— 正好是**加载态 4 个**与**工具调用的失败/结果 2 个**。
 * 也就是说：读屏用户走到"工具调用失败"那一屏时，听到的只有一句
 * "没能完成：…"，**没有任何东西告诉他这是一个对话框、在说什么**。
 *
 * ⚠️ 这个数**一开始数错了**：第一遍用"单行 `<div className=…`"去扫，只找到 10 个
 * —— 而披露/提案那几个容器是**多行**写的。教训与仓库里其它"人工清单"一样：
 * **数是数出来的，不是估出来的**（下面的"数一遍"那条断言就是为了让这个数
 * 在改动后立刻失配、逼人数清楚）。
 *
 * 四个 AI 面板的失败/提案屏都有这一对属性 —— 又是"第 5 个入口漏了一维"
 * （与披露块、失败文案同一个形状）。所以这里把规则**写成断言**，
 * 而不是再靠人记住：容器必须有 `role` + `aria-label` + `data-testid` 三件套。
 *
 * ⚠️ 收编之后（`AiPanel` 那一刀）这些容器**不再写在面板文件里**，所以判据
 * 分两层：面板源码里必须是 `<AiPanelHost label= testID= role=>` 四件套；
 * 而"渲染出来真的带 role / aria-label / data-testid"由下面的 DOM 断言盯着
 * （源码级断言证明不了 RNW 真的把属性落到了 DOM 上）。
 */
describe('AI 面板容器：一个共享实现 + 三件套', () => {
  it('面板里没有再手写 `ht-ai__panel`', () => {
    const offenders = PANELS.filter((name) => panelSource(name).includes('ht-ai__panel'));
    expect(
      offenders,
      '这些面板还在手写面板容器 —— 共享实现是 `AiPanel`（web 走 `AiPanelHost`）：',
    ).toEqual([]);
  });

  it('旧 CSS 规则也删了', () => {
    const css = readFileSync(resolve(HERE, '../src/styles/app.css'), 'utf8');
    expect(css).not.toContain('.ht-ai__panel');
  });

  it('🔴 每个 `<AiPanelHost` 都必须给全 label / testID / role（三者都必填）', () => {
    const offenders: string[] = [];
    for (const name of PANELS) {
      const src = panelSource(name);
      for (const m of src.matchAll(/<AiPanelHost\s+([\s\S]*?)\n\s*>/gu)) {
        const props = m[1] ?? '';
        const has = (k: string): boolean => props.includes(`${k}=`);
        const tid = /testID="([^"]+)"/u.exec(props)?.[1] ?? '(没有 testID)';
        const missing = ['label', 'testID', 'role'].filter((k) => !has(k));
        if (missing.length > 0) offenders.push(`${name} ${tid} 缺 ${missing.join('/')}`);
      }
    }
    expect(offenders, '这些容器的三件套不全 —— `role` 与 `label` 都是必填（没有默认值）：').toEqual([]);
  });

  it('加载态用 `status`、其余用 `dialog`', () => {
    const wrong: string[] = [];
    for (const name of PANELS) {
      const src = panelSource(name);
      for (const m of src.matchAll(/<AiPanelHost\s+([\s\S]*?)\n\s*>/gu)) {
        const props = m[1] ?? '';
        const tid = /testID="([^"]+)"/u.exec(props)?.[1] ?? '?';
        const role = /role="([^"]+)"/u.exec(props)?.[1];
        const want = tid.endsWith('-loading') ? 'status' : 'dialog';
        if (role !== want) wrong.push(`${name} ${tid} 是 ${String(role)}，应当是 ${want}`);
      }
    }
    expect(wrong, '角色用错了（加载态没有可操作内容，不该是 dialog）：').toEqual([]);
  });

  it('容器数还是 19（加了一屏就回来看一眼）', () => {
    const found = PANELS.flatMap((name) => [...panelSource(name).matchAll(/<AiPanelHost/gu)]).length;
    expect(found).toBe(19);
  });
});

describe('🔴 渲染出来的容器真的带三件套（源码级断言证明不了这件事）', () => {
  it('role / aria-label / data-testid 都落到 DOM 上，且字号继承基座是 xs', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        <AiPanelHost label="工具调用失败" testID="probe-panel" role="dialog">
          <span>裸文本</span>
        </AiPanelHost>,
      );
    });

    const el = container.querySelector('[data-testid="probe-panel"]');
    expect(el, '容器没渲染出来').not.toBeNull();
    // ① RNW 有没有真的把 role / aria-label 落下来 —— 这决定了读屏能不能念出它。
    expect(el?.getAttribute('role')).toBe('dialog');
    expect(el?.getAttribute('aria-label')).toBe('工具调用失败');
    /*
      ② **字号继承基座**：web 的 `.ht-ai__panel` 原来靠 `font-size: xs` 继承给
      面板里的裸文本（例如加载态那句"正在等待…"）。收编成共享组件后这条继承
      必须仍然成立 —— 否则面板里的裸文本会掉回浏览器默认的 16px，
      而**没有任何其它断言会红**（那些文本没有自己的字号规则）。
    */
    expect(getComputedStyle(el as Element).fontSize).toBe('12px');

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
