/**
 * 移动端认证屏的**形状**（2026-10-26 第二版）
 * ================================
 *
 * 第一版钉的是"分段控件 + 常驻动作区 + 失败滚回顶部"。第二版把前两件换掉了：
 * 产品负责人的要求是**多端统一**，而统一的方向是"两端渲染同一份 `AuthForm`"
 * —— 既然表单本体（含主按钮与「其他登录方式」的折叠）归共享层，
 * 壳就不该再自己造一套分段控件与页脚动作区，否则"统一"只是换了个地方分叉。
 *
 * 现在这一组钉两件事：
 *   1. **壳没有回到"自己画布局"**（AppBar / 分段控件 / 页脚主按钮都不许回来）；
 *   2. **壳仍然提供共享表单不会提供的那一半**：入场动效、失败滚回顶部。
 *
 * ## 为什么是源码级断言
 *
 * 与 `auth-screen-password.spec.ts` 同一个理由（那边文件头写全了）：
 * 本壳没有 RN 组件测试栈，行为由 `pnpm verify:mobile-auth` 在真机验。
 *
 * ⚠️ 判据一律先去掉注释再匹配（`codeOf`）：把一句调用注释掉来糊过判据，
 * 是这个仓库记过的第一种假绿（§7 第 50 条）。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** 去掉块注释与行注释，只留会被执行的东西。 */
function codeOf(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const code = codeOf('screens/AuthScreen.tsx');

describe('没有回到"壳自己画布局"', () => {
  it('🔴 不用 `AppBar`，也不自己再写一个标题', () => {
    // `AuthForm` 自带标题 + 副标题 + 关闭按钮。再叠一条 AppBar 就是同一个标题
    // 印两遍、两个退出动作（X 与返回箭头）—— 这正是重排前"一屏看不出主路"的一种。
    expect(code).not.toMatch(/<AppBar\b/);
    expect(code).not.toMatch(/<Screen\b/);
  });

  it('🔴 不许把分段控件或页脚主按钮加回来', () => {
    // 主按钮与「登录 / 注册」的切换都在共享层。壳里再造一套 = 两端又会分叉，
    // 而这一次分叉会被"两端看起来都还行"掩盖很久。
    expect(code).not.toMatch(/AUTH_MODE_SEGMENTS/);
    expect(code).not.toMatch(/primaryAction/);
  });

  it('🔴 三个共享层入口都开着：折叠、逐步披露、状态句', () => {
    // 「其他登录方式」折叠：两端必须是**同一种**形态（Web 是居中分隔线）。
    // 不给 `otherWaysToggle` 就会退化成"三个按钮与主路平铺"的旧形状。
    expect(code).toMatch(/otherWaysToggle:/);
    expect(code).toMatch(/advancedToggle:/);
    expect(code).toMatch(/status=\{formStatus\(\)\}/);
  });

  it('自托管与粘贴令牌只在壳显式允许时出现', () => {
    const at = code.indexOf('...(allowServerSelection');
    expect(at, '找不到 allowServerSelection 的服务端地址分组').toBeGreaterThanOrEqual(0);
    const group = code.slice(at, at + 900);
    expect(group).toMatch(/serverUrl:/);
    expect(group).toMatch(/paste:/);
  });
});

describe('动效（重排前这一屏一点都没有）', () => {
  it('🔴 时长读 token，壳里不出现裸 ms', () => {
    expect(code).toMatch(/tokens\['duration\.normal'\]/);
    // `duration: <数字>` 就是裸毫秒。真实读数在 token 表里，壳不该有第二份。
    expect(code).not.toMatch(/duration:\s*\d/);
  });

  it('🔴 `reducedMotion` 时一帧都不动（不是"动画短一点"）', () => {
    expect(code).toMatch(/if \(reducedMotion\) \{/);
    expect(code).toMatch(/entry\.setValue\(1\)/);
  });

  it('只有入场一处，没有循环动效', () => {
    expect(code).toMatch(/translateY: entry\.interpolate/);
    // 循环 = 注意力钩子。认证屏不该有。
    expect(code).not.toMatch(/Animated\.loop/);
    expect(code).not.toMatch(/iterationCount/);
  });
});

describe('失败要看得见', () => {
  it('🔴 失败时把正文滚回顶部', () => {
    expect(code).toMatch(/scrollTo\(\{ y: 0/);
    expect(code).toMatch(/failedKey/);
  });

  it('状态句带读屏播报', () => {
    expect(code).toMatch(/accessibilityLiveRegion=/);
  });
});
