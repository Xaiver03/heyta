/**
 * 「已放弃」的出口（ADR-0083 §4.3）
 * =================================
 *
 * ## 这一族钉的是"只进不出"
 *
 * 放弃把任务从**所有**默认出口里摘掉了（隐藏由动作层的分裂出口负责，
 * 见 ADR-0048 的 I5）。如果界面上没有任何地方能把它找回来，那"放弃"实际
 * 上就是一次**没有删除按钮的删除** —— 用户以为它是可逆的，而它不可逆
 * （除非改本地数据库）。所以那条 ADR 把"状态"与"出口"绑成同批交付。
 *
 * ## 为什么还是源码级
 *
 * 本壳没有组件测试栈（理由见 `packages/ui/vitest.config.ts` 文件头）。
 * 而这里要防的两件事恰好都是**接线**：入口行在不在、点了有没有一张屏接着。
 * "点了没反应"是本仓点名的那类缺陷（AGENTS §7）：不报错、界面也不难看。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROFILE = 'apps/mobile/src/screens/ProfileScreen.tsx';
const SCREEN_FILE = 'apps/mobile/src/screens/AbandonedScreen.tsx';

const profile = (): string => readFileSync(join(REPO, PROFILE), 'utf8');
const screen = (): string =>
  readFileSync(join(REPO, SCREEN_FILE), 'utf8').replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('「已放弃」入口', () => {
  it('🔴 入口行**存在**，且有稳定的 testID（设备脚本要指它）', () => {
    expect(profile()).toMatch(/testID: 'profile-entry-abandoned'/);
  });

  it('🔴 点了**真的有一张屏接着**：push 的栈键与渲染分支必须同名', () => {
    const src = profile();
    // 反向断言的用处：只测"有 push"的话，删掉 `if (abandonedOpen) return <AbandonedScreen/>`
    // 那一支仍然是绿的 —— 而那正是"行在、点了没反应"的形状。
    expect(src).toMatch(/navigation\.push\('profile:abandoned'\)/);
    expect(src).toMatch(/navigation\.stack\.at\(-1\)\?\.key === 'profile:abandoned'/);
    expect(src).toMatch(/if \(abandonedOpen\)[\s\S]*?<AbandonedScreen/);
    expect(src).toMatch(/import \{ AbandonedScreen \} from '\.\/AbandonedScreen'/);
  });

  it('入口也出现在设置面的「数据」那一节（与回收站同一档）', () => {
    expect(profile()).toMatch(/'profile-entry-abandoned'\]\.includes/);
  });

  it('词条在 zh 里含中文、在 en 里不含，两边都有值', () => {
    const zh = readFileSync(join(REPO, 'packages/i18n/src/locales/zh-CN.ts'), 'utf8');
    const en = readFileSync(join(REPO, 'packages/i18n/src/locales/en.ts'), 'utf8');
    const value = (src: string, key: string): string =>
      new RegExp(`'${key}':\\s*'([^']*)'`).exec(src)?.[1] ?? '';
    for (const key of ['mobile.abandoned.entry', 'mobile.abandoned.title', 'mobile.abandoned.hint']) {
      expect(value(zh, key), `${key} 在 zh 里缺失`).not.toBe('');
      expect(value(en, key), `${key} 在 en 里缺失`).not.toBe('');
      expect(/[一-鿿]/.test(value(zh, key)), `${key} 的 zh 值不含中文`).toBe(true);
      expect(/[一-鿿]/.test(value(en, key)), `${key} 的 en 值含中文`).toBe(false);
    }
  });
});

describe('取数只走分裂出口（I5）', () => {
  it('🔴 读 `listAbandonedTasks()`，不是 `listTasks()` 再自己 filter', () => {
    const src = screen();
    expect(src).toMatch(/\.listAbandonedTasks\(\)/);
    // 反向：自己过滤 = 第二份"什么算已放弃"的裁决。它的症状不是报错，
    // 而是动作层改了定义之后两端各给一个答案。
    expect(src, '界面里自己按 abandonedAt 过滤了一份列表').not.toMatch(/abandonedAt\s*!==\s*undefined/);
    expect(src, '拿 listTasks() 再筛 = 第二份裁决').not.toMatch(/\.listTasks\(\)/);
  });

  it('恢复走 `setAbandoned(id, false)`，失败要说出来（不许静默）', () => {
    const src = screen();
    expect(src).toMatch(/setAbandoned\(\s*id,\s*false\s*\)/);
    expect(src).toMatch(/\.catch\(/);
    expect(src).toMatch(/setError\(/);
  });

  it('这一屏不给删除：一个目的地只允许一个动作', () => {
    // 删除属于那条任务自己的行菜单 / 详情；放在这里会让用户先在这里
    // 学会"已放弃的任务可以删"，再回到回收站找那个已经找不回的按钮。
    expect(screen(), '这一屏出现了删除动作').not.toMatch(/\.remove\(|\.purge\(/);
  });

  it('本地库打不开时报错，而不是画一个空列表', () => {
    // 空列表在这里是一句关于用户数据的断言（"没有被放弃的任务"），
    // 而打不开库的时候我们并不知道这句话是不是真的。
    expect(screen()).toMatch(/catch\(\(cause: unknown\)[\s\S]{0,160}setError/);
  });
});
