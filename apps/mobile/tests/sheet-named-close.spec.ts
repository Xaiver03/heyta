/**
 * 浮层原语的两条能力（G2 / G4）—— 结构尺
 * ========================================
 *
 * 为什么这两条用源码形状判而不是渲染判：`packages/ui` 的测试面**不渲染 RN 组件**
 * （`overlay-*` 那几枚都是模型尺），而这两条要钉的恰好就是"原语的接口与分支在不在"：
 *
 *   · **G2 具名文字出口**：关闭那格必须能显示**看得见的字**。缺它的后果不是不好看，
 *     是"一个匿名 × 承担了一句有后果的话"（冲突面板关掉 = 这批冲突还没处理）。
 *     `PrivacyConsentSheet.tsx` 文件头记着同一族的另一条缺口（`modal-deferrable`
 *     那一格还没有进 `OverlayModalClass`），那条**不在**本文件射程内。
 *   · **G4 单档面板不逼宿主交两份把手文案**：`expand` / `collapse` 必须是可选的。
 *     它们是必填的那阵子，实测后果是宿主拿**关闭**那句去占位，
 *     于是无障碍树里出现两句同样的话，其中一句的名字在说"展开"。
 *     必填项逼出来的假文案，比缺一项更糟。
 *
 * ⚠️ 这条尺能被什么绕过：把 `closeText` 声明成必填、或者把渲染分支改成
 * 只画 × —— 两种都会让这里的断言红。它**不**证明视觉长什么样；
 * 那要真机/浏览器看图（`docs/agents/ui-acceptance.md`）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHELL = resolve(__dirname, '../../../packages/ui/src/overlay/BottomSheet.tsx');
const CONFLICT = resolve(__dirname, '../src/screens/ConflictSheet.tsx');

describe('G2 具名文字出口', () => {
  const sheet = readFileSync(SHELL, 'utf8');

  it('原语的文案表上有 `closeText`，而且是**可选**的（不给就还是那枚 ×）', () => {
    expect(sheet).toMatch(/readonly closeText\?: string;/u);
  });

  it('渲染分支两档都在：给了字就画字，没给才画图标', () => {
    expect(sheet).toMatch(/labels\.closeText !== undefined \?/u);
    // 图标那一支没有被删掉 —— 大多数面板仍然要的是那枚 ×。
    expect(sheet).toMatch(/data=\{X\}/u);
  });

  it('🔴 无障碍名跟着换：有可见文字时用它，不叠成两句', () => {
    expect(sheet).toMatch(/accessibilityLabel=\{labels\.closeText \?\? labels\.close\}/u);
  });

  it('有一枚真消费者（冲突面板），它交出的是自己的那句话', () => {
    const conflict = readFileSync(CONFLICT, 'utf8');
    expect(conflict).toMatch(/closeText: t\('mobile\.conflict\.close'\)/u);
    // ⚠️ 属性里必须是"字面量紧跟 `t(`"这一种形状 —— `check:ui-language` 只认它。
  });
});

describe('G4 单档面板不逼假文案', () => {
  const sheet = readFileSync(SHELL, 'utf8');

  it('把手的两枚文案都是可选的', () => {
    expect(sheet).toMatch(/readonly expand\?: string;/u);
    expect(sheet).toMatch(/readonly collapse\?: string;/u);
  });

  it('单档时把手**不挂手势**（拖了没反应的那一档）', () => {
    expect(sheet).toMatch(/accessible=\{draggable\}/u);
    expect(sheet).toMatch(/accessibilityRole=\{draggable \? 'button' : undefined\}/u);
  });

  it('冲突面板确实只交一枚 close（它只开一档 large，没有把手可念）', () => {
    const conflict = readFileSync(CONFLICT, 'utf8');
    expect(conflict).toMatch(/detents=\{\['large'\]\}/u);
    expect(conflict).not.toMatch(/expand: t\('mobile\.conflict\.close'\)/u);
  });
});
