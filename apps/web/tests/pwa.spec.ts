/**
 * Windows（PWA widget）的宿主侧：协议解析、点击日志上限、manifest 生成物。
 *
 * ## 这些测试盯的缺陷，全部是"在开发机上完全看不见"的那一类
 *
 * 本机没有 Windows，组件只在 Edge 里渲染。所以能自动化的必须自动化到底：
 *
 * | 缺陷 | 症状 |
 * |---|---|
 * | `targetIsDone` 被当成字符串 `'false'` | 点一下"完成"，**再点一下还是完成** —— 取消永远不生效 |
 * | manifest 的 tag 与 `widgetTag()` 不一致 | `updateByTag` 静默什么都不做，组件永远不刷新 |
 * | `ms_ac_template` 指向不存在的文件 | 组件渲染成空白，**没有任何报错** |
 * | 初始数据不是占位态 | 用户还没打开应用就看到"今天没有任务" —— **这是撒谎** |
 * | 点击日志上限丢的是最新的 | 用户最后一次点击被丢掉（必须丢最旧的） |
 *
 * 🔴 第一条尤其重要：它是四端都会踩的同一个坑
 * （Swift 那边是 `NSNumber` 桥接、Kotlin 那边是 `Boolean(x)`），
 * 而 Adaptive Card 的绑定**确实**会把未解析的 `${targetIsDone}` 当字符串传过来。
 */

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADAPTIVE_CARD_KINDS } from '@heyta/widget-core';
import { describe, expect, it } from 'vitest';

import {
  SW_CLICK_LOG_MAX,
  appendClick,
  isRecordStale,
  kindFromTag,
  parsePageMessage,
  parseWidgetClick,
  widgetTag,
} from '../src/pwa/sw-core.js';
import type { WidgetDataRecord } from '../src/pwa/sw-core.js';
import type { RawWidgetClick } from '../src/pwa/sw-core.js';
import { clicksToQueue } from '../src/pwa/widget-drain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');
const NOW = 1_790_000_000_000;

describe('tag ↔ kind 映射', () => {
  it.each(ADAPTIVE_CARD_KINDS)('%s 的 tag 能往返', (kind) => {
    expect(kindFromTag(widgetTag(kind))).toBe(kind);
  });

  it('未知 tag 返回 null（而不是猜一个）', () => {
    expect(kindFromTag('heyta-tomorrow')).toBeNull();
    expect(kindFromTag('other-today')).toBeNull();
    expect(kindFromTag('')).toBeNull();
    // 前缀对但为空 —— `'heyta-'` 不是一个 kind
    expect(kindFromTag('heyta-')).toBeNull();
  });
});

describe('🔴 widgetclick 的 data 必须严格校验', () => {
  it('正常的一条', () => {
    expect(parseWidgetClick({ taskId: 't_rent', targetIsDone: true }, NOW)).toEqual({
      taskId: 't_rent',
      targetIsDone: true,
      at: NOW,
    });
  });

  it('🔴 字符串 "false" 必须被拒绝 —— 这是最危险的那一个', () => {
    // Adaptive Card 的绑定在模板没解析到字段时会把字面量字符串传过来。
    // 如果这里用 `Boolean(x)` 一把梭，`Boolean('false') === true`，
    // 于是"取消完成"变成"标记完成"，而且**看起来一切正常**。
    expect(parseWidgetClick({ taskId: 't1', targetIsDone: 'false' }, NOW)).toBeNull();
    expect(parseWidgetClick({ taskId: 't1', targetIsDone: 'true' }, NOW)).toBeNull();
    // 未解析的模板字面量原样到达
    expect(parseWidgetClick({ taskId: '${taskId}', targetIsDone: '${targetIsDone}' }, NOW)).toBeNull();
  });

  it('数字 0/1 也必须被拒绝（JSON 里它们不是布尔）', () => {
    expect(parseWidgetClick({ taskId: 't1', targetIsDone: 0 }, NOW)).toBeNull();
    expect(parseWidgetClick({ taskId: 't1', targetIsDone: 1 }, NOW)).toBeNull();
  });

  it('taskId 必须是非空字符串', () => {
    expect(parseWidgetClick({ targetIsDone: true }, NOW)).toBeNull();
    expect(parseWidgetClick({ taskId: '', targetIsDone: true }, NOW)).toBeNull();
    expect(parseWidgetClick({ taskId: 42, targetIsDone: true }, NOW)).toBeNull();
    expect(parseWidgetClick({ taskId: null, targetIsDone: true }, NOW)).toBeNull();
  });

  it('非对象一律拒绝', () => {
    for (const bad of [null, undefined, 'x', 1, true, []]) {
      expect(parseWidgetClick(bad, NOW)).toBeNull();
    }
  });
});

describe('点击日志上限：丢最旧的，保住最后一次点击', () => {
  function click(n: number): RawWidgetClick {
    return { taskId: `t${n}`, targetIsDone: true, at: NOW + n };
  }

  it('未超限时原样追加，dropped = 0', () => {
    const { log, dropped } = appendClick([click(1)], click(2));
    expect(dropped).toBe(0);
    expect(log.map((c) => c.taskId)).toEqual(['t1', 't2']);
  });

  it('超限时丢**头部**（最旧的），并如实报告条数', () => {
    const full = Array.from({ length: SW_CLICK_LOG_MAX }, (_, i) => click(i));
    const { log, dropped } = appendClick(full, click(9999));

    expect(dropped).toBe(1);
    expect(log).toHaveLength(SW_CLICK_LOG_MAX);
    // 最新的那条**在**（丢头部而不是丢尾部）
    expect(log[log.length - 1]!.taskId).toBe('t9999');
    // 最旧的那条被丢了
    expect(log[0]!.taskId).toBe('t1');
  });

  it('🔴 反复点同一个任务时，丢弃之后 last-wins 的结论不变', () => {
    // 这正是"未折叠的原始日志丢头部是安全的"那个论证的实证：
    // 同一个 taskId 的多次点击，只有最后一次有效。
    const log: RawWidgetClick[] = [];
    let acc: RawWidgetClick[] = [];
    for (let i = 0; i < SW_CLICK_LOG_MAX + 20; i += 1) {
      // 每 3 次里有一次点 t_stable，值在 true/false 之间来回
      const entry =
        i % 3 === 0
          ? { taskId: 't_stable', targetIsDone: i % 2 === 0, at: NOW + i }
          : { taskId: `t${i}`, targetIsDone: true, at: NOW + i };
      log.push(entry);
      acc = appendClick(acc, entry).log;
    }

    // 整条日志里 t_stable 的最后一次点击
    const lastInLog = [...log].reverse().find((c) => c.taskId === 't_stable')!;
    // 裁剪后的日志里 t_stable 的最后一次点击
    const lastInTrimmed = [...acc].reverse().find((c) => c.taskId === 't_stable')!;

    expect(lastInTrimmed.targetIsDone).toBe(lastInLog.targetIsDone);
    // 而且合并后的队列就是这个结论
    const queue = clicksToQueue(acc);
    expect(queue.intents.find((i) => i.taskId === 't_stable')!.targetIsDone).toBe(
      lastInLog.targetIsDone,
    );
  });

  it('clicksToQueue 是 last-wins 且每个任务只留一条', () => {
    const queue = clicksToQueue([
      { taskId: 'a', targetIsDone: true, at: 1 },
      { taskId: 'b', targetIsDone: true, at: 2 },
      { taskId: 'a', targetIsDone: false, at: 3 },
    ]);
    // 数组位置决定优先级：a 在最后一条，值为 false
    expect(queue.intents).toEqual([
      { taskId: 'b', targetIsDone: true, at: 2 },
      { taskId: 'a', targetIsDone: false, at: 3 },
    ]);
  });
});

describe('页面 → service worker 消息协议', () => {
  it('drain', () => {
    expect(parsePageMessage({ type: 'heyta:widget-drain' })).toEqual({ type: 'heyta:widget-drain' });
  });

  const DATA_MSG = {
    type: 'heyta:widget-data',
    kind: 'today',
    data: { count: 3 },
    dayStr: '2026-09-27',
    validUntil: NOW,
  };

  it('widget-data 必须带 data 字段', () => {
    expect(parsePageMessage(DATA_MSG)).toEqual(DATA_MSG);

    // 🔴 `undefined` / `null` / 标量都必须拒绝 —— 它们都会让 `updateByTag`
    //    把组件清成**空白**，而没有任何报错。只判 `'data' in msg` 不够：
    //    `{ data: undefined }` 也满足它。
    expect(parsePageMessage({ ...DATA_MSG, data: undefined })).toBeNull();
    expect(parsePageMessage({ ...DATA_MSG, data: null })).toBeNull();
    expect(parsePageMessage({ ...DATA_MSG, data: 'x' })).toBeNull();
    expect(parsePageMessage({ ...DATA_MSG, data: 7 })).toBeNull();
  });

  it('🔴 widget-data 必须带期限 —— 没有期限的数据在 Windows 上永远不会过期', () => {
    // 这条断言盯的是"三天没开机的电脑上组件还显示三天前的任务"。
    // 少一个字段不会有任何报错，只会让那个缺陷**不可能被修**。
    expect(parsePageMessage({ type: 'heyta:widget-data', kind: 'today', data: {} })).toBeNull();
    expect(
      parsePageMessage({ type: 'heyta:widget-data', kind: 'today', data: {}, dayStr: 'x' }),
    ).toBeNull();
    expect(
      parsePageMessage({
        type: 'heyta:widget-data',
        kind: 'today',
        data: {},
        dayStr: 'x',
        validUntil: Number.NaN,
      }),
    ).toBeNull();
  });

  it('未知 kind 一律拒绝（不能把数据推给不存在的组件）', () => {
    expect(parsePageMessage({ type: 'heyta:widget-data', kind: 'tomorrow', data: {} })).toBeNull();
    expect(parsePageMessage({ type: 'heyta:widget-refresh', kind: '' })).toBeNull();
    expect(parsePageMessage({ type: 'heyta:widget-refresh' })).toBeNull();
  });

  it('refresh', () => {
    expect(parsePageMessage({ type: 'heyta:widget-refresh', kind: 'focus' })).toEqual({
      type: 'heyta:widget-refresh',
      kind: 'focus',
    });
  });

  it('requeue 只放行合法的意图（页面的边界上同样不信）', () => {
    const parsed = parsePageMessage({
      type: 'heyta:widget-requeue',
      intents: [
        { taskId: 'a', targetIsDone: false, at: 5 },
        { taskId: '', targetIsDone: true, at: 6 }, // 坏
        { taskId: 'b', targetIsDone: 'yes', at: 7 }, // 坏
      ],
    });
    expect(parsed).toEqual({
      type: 'heyta:widget-requeue',
      intents: [{ taskId: 'a', targetIsDone: false, at: 5 }],
    });
  });

  it('非对象 / 未知 type 一律返回 null', () => {
    for (const bad of [null, undefined, 'x', 7, [], {}]) {
      expect(parsePageMessage(bad)).toBeNull();
    }
    expect(parsePageMessage({ type: 'something-else' })).toBeNull();
  });
});

describe('生成物：manifest 与它引用的文件', () => {
  const manifest = JSON.parse(
    readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'),
  ) as {
    name: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
    widgets: {
      name: string;
      description: string;
      tag: string;
      ms_ac_template: string;
      data: string;
      type: string;
      update: number;
    }[];
  };

  it('四款组件都在，且顺序与契约一致', () => {
    expect(manifest.widgets).toHaveLength(4);
    expect(manifest.widgets.map((w) => w.tag)).toEqual(ADAPTIVE_CARD_KINDS.map(widgetTag));
  });

  it('🔴 tag 与 sw-core 的 widgetTag() 逐字符相同', () => {
    // 不一致的表现是 `updateByTag` 静默什么都不做 —— 组件永远停在旧数据上，
    // 而且**没有任何报错**。所以这条断言不能省。
    for (const widget of manifest.widgets) {
      const kind = kindFromTag(widget.tag);
      expect(kind, `manifest 里的 tag ${widget.tag} 不被 sw-core 认识`).not.toBeNull();
      expect(widget.tag).toBe(widgetTag(kind!));
    }
  });

  it('每款组件引用的模板与数据文件都真实存在', () => {
    for (const widget of manifest.widgets) {
      for (const rel of [widget.ms_ac_template, widget.data]) {
        const path = join(PUBLIC, rel.replace(/^\//, ''));
        expect(existsSync(path), `${widget.tag} 引用的 ${rel} 不存在 —— 组件会渲染成空白`).toBe(
          true,
        );
      }
    }
  });

  it('模板是合法 Adaptive Card JSON', () => {
    for (const widget of manifest.widgets) {
      const template = JSON.parse(
        readFileSync(join(PUBLIC, widget.ms_ac_template.replace(/^\//, '')), 'utf8'),
      ) as { type: string; version: string; body: unknown[] };
      expect(template.type).toBe('AdaptiveCard');
      expect(template.version).toBe('1.5');
      expect(Array.isArray(template.body)).toBe(true);
      expect(widget.type).toBe('adaptivecard');
    }
  });

  it('🔴 初始数据必须是**占位态**，不能是"今天没有任务"', () => {
    // 用户还没打开过应用时我们**不知道**今天有没有任务。
    // 显示"今天没有任务"是撒谎 —— 用户看到它就不会去做那件事。
    for (const widget of manifest.widgets) {
      const data = JSON.parse(
        readFileSync(join(PUBLIC, widget.data.replace(/^\//, '')), 'utf8'),
      ) as { kind: string; showPlaceholder?: boolean };
      const kind = kindFromTag(widget.tag)!;
      // 数据文件的 kind 必须与 tag 一致（推错款 = 字段全对不上）
      expect(data.kind).toBe(kind);
      expect(data.showPlaceholder, `${widget.tag} 的初始数据不是占位态`).toBe(true);
    }
  });

  it('图标文件都存在', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(join(PUBLIC, icon.src.replace(/^\//, ''))), `${icon.src} 不存在`).toBe(true);
    }
  });
});

describe('🔴 缓存的过期判定（Windows 上唯一"应用不在也能跑"的判定点）', () => {
  const record: WidgetDataRecord = {
    kind: 'today',
    data: { kind: 'today' },
    dayStr: '2026-09-27',
    validUntil: NOW,
    pushedAt: NOW - 1000,
  };

  it('恰好到点就算过期（与原生三端同一条判据 now >= validUntil）', () => {
    expect(isRecordStale(record, NOW - 1)).toBe(false);
    expect(isRecordStale(record, NOW)).toBe(true);
    expect(isRecordStale(record, NOW + 1)).toBe(true);
  });

  it('没有期限 / 坏期限一律当成过期（宁可显示"打开 Heyta"，也不显示旧任务）', () => {
    expect(isRecordStale({ ...record, validUntil: Number.NaN }, NOW)).toBe(true);
    expect(isRecordStale({ ...record, validUntil: Number.POSITIVE_INFINITY }, NOW)).toBe(true);
  });

  it('🔴 跨零点：午夜前发布的数据，午夜后必须过期', () => {
    // 这是"当日任务"在 Windows 上唯一会出错的时刻，而它每天都会发生。
    // 组件宿主按 `update` 间隔重取 `data` URL，SW 拦下来判一次 ——
    // 判错了就是"新的一天里还显示昨天的任务"。
    const beforeMidnight = 1_790_000_000_000;
    const afterMidnight = beforeMidnight + 1;
    const today: WidgetDataRecord = { ...record, validUntil: beforeMidnight };
    expect(isRecordStale(today, beforeMidnight - 1)).toBe(false);
    expect(isRecordStale(today, afterMidnight)).toBe(true);
  });
});
