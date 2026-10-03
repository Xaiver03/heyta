/**
 * 批次 E2 —— 宿主侧的销毁注册表与**真宿主**取证
 * =================================================
 *
 * 两件事分开测，因为它们会分别坏：
 *
 *   · **注册表本身**（`local-erasure.ts`）坏的样子是"忘了注册"—— 而忘了不会报错，
 *     只会让明文留着。所以第一组判据钉的是"没注册必须响"。
 *   · **宿主真的接上了**才是 E2 的交付。第二组直接跑 `openAppHost()`
 *     （node-host / 移动端 / 桌面端共用的那条启动路径），写一条真任务、
 *     销毁、再看磁盘上的文件在不在 —— 这是计划 §10.2 点名要的"逐宿主凭据"里
 *     非 Web 那一档。
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { eraseLocalData, hasLocalEraser, lastErasureReports, registerLocalEraser } from '../src/local-erasure.js';
import { openAppHost, type AppHost } from '../src/host.js';

const report = (target: string, containerRemoved = true) => ({
  target,
  containerRemoved,
  storesCleared: 4,
});

describe('本机销毁注册表', () => {
  afterEach(() => {
    // 注册表是模块级全局；不清就等于把上一用例的宿主 leak 给下一用例。
    registerLocalEraser(undefined);
  });

  it('🔴 没注册时 eraseLocalData **抛错**，不是静默返回空数组', async () => {
    // 这条路径的原始缺陷就是"信号收到了、本机什么都没少、什么都不报"。
    // 做成静默返回 = 把那个缺陷搬进新代码：SyncClient 会拿到 []
    // 然后理直气壮地把 message 写成"已清除"。
    expect(hasLocalEraser()).toBe(false);
    await expect(eraseLocalData()).rejects.toThrow(/明文仍在/);
  });

  it('注册后把销毁器的逐类报告原样交回，并留作凭据', async () => {
    const eraser = vi.fn(async () => [report('IndexedDB:heyta'), report('opfs:.heyta-web')]);
    const previous = registerLocalEraser(eraser);

    expect(previous, '第一次注册不该有"被替换者"').toBeUndefined();
    expect(hasLocalEraser()).toBe(true);

    const reports = await eraseLocalData();
    expect(reports).toHaveLength(2);
    expect(lastErasureReports()).toEqual(reports);
  });

  it('注册返回**被替换掉的那一个**；注销后凭据清零', async () => {
    const first = vi.fn(async () => [report('a')]);
    const second = vi.fn(async () => [report('b')]);

    registerLocalEraser(first);
    const replaced = registerLocalEraser(second);
    // 注册表是全局的，"谁覆盖了谁"是排查"销毁器怎么没生效"时唯一能看到的信息。
    expect(replaced).toBe(first);

    await eraseLocalData();
    expect(second).toHaveBeenCalledTimes(1);
    expect(lastErasureReports()).toHaveLength(1);

    expect(registerLocalEraser(undefined)).toBe(second);
    expect(hasLocalEraser()).toBe(false);
    expect(lastErasureReports()).toEqual([]);
  });

  it('🔴 销毁器整体抛错：向外抛（不吞），且**不留下上一轮的凭据**', async () => {
    registerLocalEraser(async () => [report('一次成功的销毁')]);
    await eraseLocalData();
    expect(lastErasureReports()).toHaveLength(1);

    registerLocalEraser(async () => {
      throw new Error('宿主代码坏了');
    });
    await expect(eraseLocalData()).rejects.toThrow('宿主代码坏了');

    // 这条钉的是取证的诚实性：如果这里还留着上一条那份报告，
    // 一次**失败**的销毁会被后面读成"清过了"。
    expect(lastErasureReports()).toEqual([]);
  });

  it('某一类失败由销毁器**报进数组**，不抛 —— 抛了剩下的几类就不做了', async () => {
    // OPFS 不可用（隐私模式）不该让 localStorage 与 Service Worker 缓存跟着不清。
    registerLocalEraser(async () => [
      report('IndexedDB:heyta', true),
      { target: 'opfs:.heyta-web', containerRemoved: false, reason: '没有 getDirectory', storesCleared: 0 },
    ]);

    const reports = await eraseLocalData();
    expect(reports).toHaveLength(2);
    expect(reports[1]?.containerRemoved).toBe(false);
    expect(reports[1]?.reason).toContain('getDirectory');
  });
});

describe('openAppHost：非 Web 宿主的真销毁凭据（§10.2）', () => {
  let dir: string;
  let dbPath: string;
  let host: AppHost | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'heyta-erase-'));
    dbPath = join(dir, 'heyta.db');
  });

  afterEach(() => {
    host?.close();
    host = undefined;
    registerLocalEraser(undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  const driverFor = (path: string) => () => new NodeSqliteDriver(path);

  it('启动就自动装了兜底销毁器（宿主没注册时也不会留洞）', async () => {
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    expect(hasLocalEraser(), 'openAppHost 之后仍没人能清本机 = E2 的原始洞').toBe(true);
  });

  it('🔴 写一条真任务 → eraseLocalData() → **库文件从磁盘上消失**，重开读到空', async () => {
    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });

    const actions = createTaskActions(host);
    await actions.create('这条明文必须跟着账号一起没');
    expect(Object.keys(host.getState().tasks), '前置：任务真落库了').toHaveLength(1);
    expect(existsSync(dbPath)).toBe(true);

    const reports = await eraseLocalData();

    expect(reports.length, '至少要有一类存储的凭据').toBeGreaterThanOrEqual(1);
    expect(reports[0]!.containerRemoved, JSON.stringify(reports)).toBe(true);
    // target 必须是**这条宿主的真实路径**：同一台机器上两份库时要能分清是谁。
    expect(reports[0]!.target).toBe(dbPath);
    // 数目录，不看单个文件：防"改名/挪走"这类看起来没了的形态。
    expect(readdirSync(dir), `销毁后残留：${readdirSync(dir).join(', ')}`).toEqual([]);

    host.close();
    host = undefined;
    const reopened = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });
    host = reopened;
    expect(createTaskActions(reopened).listTasks()).toEqual([]);
  });

  it('🔴 宿主已经注册了更丰富的销毁器时，兜底那条**不许覆盖它**', async () => {
    // Web 就是这个形状：它清的是 IndexedDB + OPFS + localStorage + SW 缓存四类，
    // 而适配器自己只知道一个库。兜底那条要是把这条盖掉，"注销后还有 3 类留着"
    // 就藏在一次成功销毁的报告底下。
    const eraser = vi.fn(async () => [report('web:全部四类')]);
    registerLocalEraser(eraser);

    host = await openAppHost({ dbPath, driverFactory: driverFor(dbPath) });

    await eraseLocalData();

    expect(eraser).toHaveBeenCalledTimes(1);
    expect(existsSync(dbPath), '宿主自己的销毁器被兜底那条顶掉了').toBe(true);
  });
});
