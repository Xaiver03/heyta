/**
 * 披露的**结构化形态** —— 界面中英双语的地基
 * ============================================
 *
 * `describeDestination()` / `describeRetention()` 返回的是**中文句子**，而它们会被
 * 三个壳渲染。界面要双语之后，"怎么说"必须归壳，所以披露有了结构化版本
 * （`destinationDisclosure` / `retentionDisclosure`），旧的中文函数**建立在它之上**。
 *
 * 这组测试钉的是三件事，都不是"字符串长什么样"：
 *
 *   1. **映射正确**：每个目的地对应哪个 kind。
 *   2. **不许漂移**：同一份 `buildDisclosure` 里，结构化结论与兼容文本必须**互相印证**
 *      （它们同源，所以这不该失败 —— 但如果哪天有人绕过其中一条，这里会红）。
 *   3. 🔴 **不许把托管说轻**：`heyta-cloud` 的结构化 kind **不能**被归成
 *      `local` 或 `third-party-endpoint`。这条是 ADR-0006 §3.2 第 5 条在**结构层面**
 *      的守卫 —— 有人想靠"改个分类"来软化那句话时，它会先红，
 *      而不是等到用户已经在英文界面上读到一个更温和的说法。
 */

import { describe, expect, it } from 'vitest';

import {
  buildDisclosure,
  describeDestination,
  describeRetention,
  destinationDisclosure,
  previewDisclosure,
  retentionDisclosure,
  type EgressDestination,
} from '../src/index.js';

/** 全部目的地。新增一个必须同时更新这里 —— 下面的表驱动测试会因此失败。 */
const ALL_DESTINATIONS: readonly EgressDestination[] = ['none', 'user-endpoint', 'heyta-cloud'];

describe('destinationDisclosure：目的地 → 性质', () => {
  it('三种目的地各自的 kind', () => {
    expect(destinationDisclosure('none').kind).toBe('local');
    expect(destinationDisclosure('user-endpoint').kind).toBe('third-party-endpoint');
    expect(destinationDisclosure('heyta-cloud').kind).toBe('heyta-cloud-managed');
  });

  it('表驱动：每个目的地都有结论，没有漏网的', () => {
    for (const destination of ALL_DESTINATIONS) {
      expect(destinationDisclosure(destination).kind).toBeTruthy();
    }
  });

  it('🔴 托管**不许**被归成本地或第三方端点（ADR-0006 §3.2 第 5 条）', () => {
    const kind = destinationDisclosure('heyta-cloud').kind;
    expect(kind).not.toBe('local');
    expect(kind).not.toBe('third-party-endpoint');
  });

  it('本地的 kind 与"要授权"的结论一致：本地不需要出境授权', () => {
    const d = buildDisclosure({ feature: 'capture', destination: 'none', fields: ['title'] });
    expect(d.destinationDisclosure.kind).toBe('local');
    expect(d.requiresConsent).toBe(false);
  });
});

describe('retentionDisclosure：保留策略 → 性质', () => {
  it('三种目的地各自的 kind', () => {
    expect(retentionDisclosure('none').kind).toBe('not-applicable');
    expect(retentionDisclosure('user-endpoint').kind).toBe('third-party-decides');
    expect(retentionDisclosure('heyta-cloud').kind).toBe('undecided');
  });

  it('🔴 `undecided` 与兼容层的 `undefined` 必须同时成立', () => {
    // 这两个是同一个事实的两个投影。只改一边 = 一边说"没定"、另一边编了数字。
    expect(retentionDisclosure('heyta-cloud').kind).toBe('undecided');
    expect(describeRetention('heyta-cloud')).toBeUndefined();
  });

  it('`undecided` 只属于托管 —— 别把"没出境"也说成"没定案"', () => {
    expect(retentionDisclosure('none').kind).toBe('not-applicable');
    expect(retentionDisclosure('user-endpoint').kind).toBe('third-party-decides');
  });
});

describe('两条路径同源：结构化结论与兼容文本必须互相印证', () => {
  it('buildDisclosure 同时带上两者，且文本就是旧函数逐字的输出', () => {
    for (const destination of ALL_DESTINATIONS) {
      const d = buildDisclosure({ feature: 'breakdown', destination, fields: ['title', 'note'] });
      expect(d.destinationText).toBe(describeDestination(destination));
      expect(d.retentionText).toBe(describeRetention(destination));
      // 文本非空 —— 空白披露等于没披露。
      expect(d.destinationText.length).toBeGreaterThan(0);
    }
    // 上面那条 `describeRetention` 对托管返回 undefined，所以托管的文本可以是空，
    // 但**结构化的 kind 不允许为空**：
    expect(
      buildDisclosure({ feature: 'breakdown', destination: 'heyta-cloud', fields: ['title'] })
        .retentionDisclosure.kind,
    ).toBe('undecided');
  });
});

describe('previewDisclosure 的关闭态', () => {
  it('关闭态等于"目的地是本地"的那一份披露，而不是一份空文本', () => {
    const preview = previewDisclosure({ mode: 'off' }, { feature: 'capture', fields: ['title'] });
    const none = buildDisclosure({ feature: 'capture', destination: 'none', fields: ['title'] });

    expect(preview.destination).toBe('none');
    expect(preview.requiresConsent).toBe(false);
    // 🔴 这里以前是 `destinationText: ''`：界面拿到只会渲染空白，
    // 而且空字符串与任何结构化结论都不可能"互相印证"。现在两份披露逐字段相同。
    expect(preview.destinationText).toBe(none.destinationText);
    expect(preview.destinationDisclosure).toEqual(none.destinationDisclosure);
    expect(preview.retentionDisclosure).toEqual(none.retentionDisclosure);
  });
});