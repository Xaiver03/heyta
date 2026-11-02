/**
 * 首屏（`WelcomeScreen`）的形状（2026-10-26）
 * =========================================
 *
 * 这一屏被产品负责人连着改了四轮，每一条都是**否决上一条**：
 *
 *   1. 「把注册登录放到最底部，背景作为动效，用滚动动效展示各功能」；
 *   2. 「还是要有文字跟着动效走，不然不知道图标是什么意思」；
 *   3. 「为什么是左右相同的内容在这儿滚动」——**两列并排跑马灯**被否掉；
 *   4. 「上下是割裂的……注册登录那里背景完全黑色，整个动效都应该作为背景图」。
 *
 * 四轮下来最容易"改回去"的四件事，就是下面这组判据。它们都不会报错，
 * 只会让屏幕重新变回那个被否掉的形状。
 *
 * ⚠️ 与 `auth-screen-*.spec.ts` 同一个做法与理由：本壳没有 RN 组件测试栈
 * （引它要过 AGENTS §3.1 + §3.2 两道门），行为由 `pnpm verify:mobile-auth` 在真机验，
 * 这里只钉**结构事实**；一律先去掉注释再匹配（`codeOf`）。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
const LOCALES = resolve(HERE, '../../../packages/i18n/src/locales');

function codeOf(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const code = codeOf('screens/WelcomeScreen.tsx');

describe('底部动作区：两个出口，一直在', () => {
  it('🔴 主出口是「注册 / 登录」，次出口是「先离线使用」（ADR-0003：不联网也能开始用）', () => {
    expect(code).toMatch(/t\('mobile\.welcome\.signIn'\)/);
    expect(code).toMatch(/t\('mobile\.welcome\.offline'\)/);
    // 次出口出现**两次**是刻意的：面板升起后它仍在面板内容底部（改主意的人有路可走）。
    expect(code.match(/t\('mobile\.welcome\.offline'\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('🔴 动作区浮在背景上，不铺自己的底色（上一版那块黑底就是"上下割裂"的一半）', () => {
    const dock = /dock: \{([\s\S]*?)\n    \}/.exec(code);
    expect(dock, '找不到 dock 样式').not.toBeNull();
    // 只有不给 `backgroundColor`，背景图才能一路铺到按钮下面。
    expect(dock![1]).not.toMatch(/backgroundColor/);
  });
});

describe('文字跟着动效走（第 2 轮的否决）', () => {
  it('🔴 标题取自**当前这一张**的 titleKey，不是写死的', () => {
    expect(code).toMatch(/t\(\(SLIDES\[slide\][\s\S]{0,40}titleKey\)/);
    // 四张各有自己的标题词条，且都是**已有**的短标签（不新写文案）。
    for (const key of ['mobile.tab.tasks', 'mobile.tab.calendar', 'mobile.tab.focus', 'mobile.tab.categories']) {
      expect(code, `缺 ${key}`).toContain(key);
    }
  });
});

describe('背景就是一张连续的图（第 4 轮的否决）', () => {
  it('🔴 四张背景都是**竖版整屏**素材，不是方形卡片图', () => {
    // 方形卡片图 `cover` 铺满 9:19.5 必然出现"上半截有东西、下半截纯黑"。
    for (const name of ['bg-tasks', 'bg-calendar', 'bg-focus', 'bg-stats']) {
      expect(code, `缺 ${name}.jpg`).toContain(`onboarding/${name}.jpg`);
    }
    expect(code, '又用回方形卡片图了').not.toMatch(/onboarding\/(tasks|calendar|focus|stats)\.jpg/);
  });

  it('🔴 背景是整层 `cover`，不是"浮在中间的一块卡"', () => {
    expect(code).toMatch(/resizeMode="cover"/);
    // 上一版有个 `motif`（居中浮屏），那正是"上下两块"的来源。
    expect(code).not.toMatch(/motif:/);
  });

  it('🔴 底部渐隐**从 0 起**（第一级不是 0.06 之类），避免出现横带', () => {
    const fade = /\[\s*([0-9.,\s]+)\]\s*\.map\(\(opacity\)/.exec(code);
    expect(fade, '找不到渐隐层').not.toBeNull();
    const first = Number(fade![1].split(',')[0]);
    expect(first, `渐隐第一级是 ${String(first)}，应当从 0 开始`).toBe(0);
  });
});

describe('不要回到那两个被否掉的形状', () => {
  it('🔴 没有两列并排的跑马灯（"左右相同内容"）', () => {
    expect(code).not.toMatch(/MarqueeColumn/);
    expect(code).not.toMatch(/Animated\.loop\([\s\S]{0,80}translateY/);
  });

  it('🔴 没有**无限循环**的装饰动画（否则 uiautomator 永远等不到 idle）', () => {
    // 实测：Ken Burns 的 `Animated.loop` 让窗口不进 idle，`uiautomator dump` 直接报
    // `could not get idle state` ⇒ 设备腿每条断言都拿不到界面。
    // 换页的交叉淡入是有终点的，允许；常驻循环不允许。
    expect(code, '又加回无限循环动画了').not.toMatch(/Animated\.loop\(/);
  });

  it('🔴 认证面板是**就地升起**（embedded），不是整屏换页', () => {
    expect(code).toMatch(/<AuthScreen[\s\S]{0,200}embedded/);
    expect(code).not.toMatch(/<Screen\b/);
  });
});

describe('动效对"减少动效"要老实', () => {
  it('🔴 `reducedMotion` 时不自动轮播、不呼吸', () => {
    // 两条 effect 都必须在 reducedMotion 时**提前返回**（不是"跑快一点"）。
    const guards = code.match(/if \(reducedMotion\)/g) ?? [];
    expect(guards.length, '至少要有轮播与呼吸两处守卫').toBeGreaterThanOrEqual(2);
    expect(code).toMatch(/if \(reducedMotion\) return undefined;/);
  });
});

describe('这一屏不写字（"说明性文字彻底删掉"）', () => {
  const zh = readFileSync(join(LOCALES, 'zh-CN.ts'), 'utf8');

  it('🔴 引导句与离线说明的词条**已经不存在**（它们搬去落地页/文档中心了）', () => {
    expect(zh).not.toContain("'mobile.welcome.tagline'");
    expect(zh).not.toContain("'mobile.welcome.offlineHint'");
  });

  it('屏上只剩两枚按钮 + 跟随图的功能标题（**没有品牌标识**）', () => {
    // 词条引用数：signIn + offline + titleKey(SLIDES 里的) —— 超过这个数
    // 就说明又有说明文字被写回来了。
    const keys = [...code.matchAll(/t\('(mobile\.welcome\.[a-zA-Z.]+)'\)/g)].map((m) => m[1]);
    expect(new Set(keys)).toEqual(new Set(['mobile.welcome.signIn', 'mobile.welcome.offline']));
    // 🔴 「heyta 这几个字不需要出现在产品界面……我都是在 APP 当中点进去的」
    //    —— 这一屏是应用内部的登录入口，不是落地页。
    expect(code, '品牌标识又被放回产品界面了').not.toContain("t('common.brand')");
  });
});
