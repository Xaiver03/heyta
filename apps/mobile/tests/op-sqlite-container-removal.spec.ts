/**
 * 移动端 op-sqlite 驱动的 `removeDatabase`：这台设备上的明文到底有没有真的没了
 * ============================================================================
 *
 * ## 它防的是什么
 *
 * `DbAdapter.destroy()` 的语义是"清空内容 **+ 删掉容器**"，而移动端那个容器
 * 由 op-sqlite 的 `db.delete()` 负责。这一档以前**没有任何判据**：
 * `grep -rn removeDatabase apps/mobile --include="*.spec.*"` 现量 0 命中，
 * 也就是说"手机上清了个寂寞但报告说清干净了"这个形态是没人挡的。
 *
 * ## 为什么这四条各管一件事
 *
 * 1. **成功路径要精确等于 `{target, containerRemoved:true}`**。用 `toEqual` 而不是
 *    `toMatchObject`：后者会让"顺手带了一条 reason"通过，而界面上
 *    "这台设备没清干净"那句就是靠 reason 的**有无**说出来的（`host.ts` 读的是
 *    `containerRemoved`，`lastErasureReports()` 里两条都要给人看）。
 * 2. **`delete()` 抛错时必须降级成原因，不能向外抛**。抛出去会让整条
 *    `destroy()` 失败，于是**剩下的几类存储一条都不被清** —— 这条契约的理由
 *    写在 `packages/storage/src/sqlite/sqlite-driver.ts` 的注释里。
 * 3. **抛的不是 Error 也要能报**。op-sqlite 在 web 构建里把 `delete()` 实现成
 *    抛字符串（`src/functions.web.ts`），而移动端的 web 目标恰好走到那一份；
 *    `error instanceof Error ? … : String(error)` 那一支没有判据就会静默变成
 *    `undefined`，凭据上看起来像"失败但没有原因"。
 * 4. 🔴 **`close()` 之后必须还能删**。契约规定的顺序是"适配器先 close，再让
 *    驱动删文件"，所以走到这里时 `closed` 必然是 `true`。把它写成
 *    `assertOpen()` 后面**不会**得到报错，只会得到一条
 *    "这台设备没删干净"的**假故障** —— 那是把人引向完全相反方向的红。
 *    变异配对：在 `removeDatabase()` 第一行加 `this.assertOpen()` ⇒ 第 4 条转红。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.mock` 会被提到 import 之前执行，所以开关必须放在 `vi.hoisted` 里
 * （`task-sort.spec.ts` 的文件头写过同一件事）。
 */
const handles = vi.hoisted(() => ({
  deleteBehavior: 'ok' as 'ok' | 'error' | 'string',
  deleteCalls: 0,
  closeCalls: 0,
}));

vi.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({
    executeSync: () => ({ rows: [] }),
    close: () => {
      handles.closeCalls += 1;
    },
    delete: () => {
      handles.deleteCalls += 1;
      if (handles.deleteBehavior === 'error') throw new Error('SQLITE_BUSY: database is locked');
      if (handles.deleteBehavior === 'string') throw 'op-sqlite web build: delete unsupported';
    },
  }),
}));

// vitest 会把 `vi.mock` 提到 import 之前，所以这里用静态导入即可
// （`native-reminder-authorization.spec.ts` 用的是同一个形状）。
import { OpSqliteDriver } from '../src/db/op-sqlite-driver';

beforeEach(() => {
  handles.deleteBehavior = 'ok';
  handles.deleteCalls = 0;
  handles.closeCalls = 0;
});

describe('OpSqliteDriver.removeDatabase', () => {
  it('正常路径：删一次，且报告里**没有** reason 这个键', () => {
    const driver = new OpSqliteDriver({ name: 'heyta' });

    expect(driver.removeDatabase()).toEqual({ target: 'heyta', containerRemoved: true });
    expect(handles.deleteCalls).toBe(1);
  });

  it('删不掉时报的是原因而不是异常（抛 Error 那一支）', () => {
    handles.deleteBehavior = 'error';
    const driver = new OpSqliteDriver({ name: 'heyta' });

    let report: ReturnType<OpSqliteDriver['removeDatabase']> | undefined;
    expect(() => {
      report = driver.removeDatabase();
    }).not.toThrow();

    expect(report?.containerRemoved).toBe(false);
    expect(report?.reason, '失败必须带原因，否则凭据上就是"没清干净"却说不清为什么')
      .toMatch(/^database-delete-failed: .*SQLITE_BUSY/);
  });

  it('抛的不是 Error（op-sqlite 的 web 构建）也照样进原因', () => {
    handles.deleteBehavior = 'string';
    const driver = new OpSqliteDriver({ name: 'heyta' });

    const report = driver.removeDatabase();

    expect(report.containerRemoved).toBe(false);
    expect(report.reason, '非 Error 的抛出物不能变成 undefined').toContain('delete unsupported');
  });

  it('🔴 先 close 再删是契约规定的顺序 —— 关闭之后 removeDatabase 必须照常工作', () => {
    const driver = new OpSqliteDriver({ name: 'heyta' });
    driver.close();
    expect(handles.closeCalls).toBe(1);

    // 这一行如果被搬进 assertOpen() 的后面，得到的不是报错而是"这台设备没删干净"。
    expect(() => driver.removeDatabase()).not.toThrow();
    expect(driver.removeDatabase()).toEqual({ target: 'heyta', containerRemoved: true });
    expect(handles.deleteCalls, 'removeDatabase 不该顺手发查询').toBe(2);
  });
});
