/**
 * e2e 专属垫片：给**尚未落地**的生产者一个"存在、但一调用就炸"的占位
 * ====================================================================
 *
 * ## 为什么需要它
 *
 * 在 `feat/activity-colors` 这一支上，Web 应用**整页白屏**，原因是模块图里有
 * 五个**静态导入**指向还不存在的导出（消费者已经提交、生产者只在别人的在飞工作树里）：
 *
 * | 导入方（已提交） | 缺的导出 | 包 |
 * |---|---|---|
 * | `apps/web/src/main.tsx` | `StorageError` | `@heyta/storage` |
 * | `apps/web/src/features/quadrant/QuadrantBoard.tsx` | `planQuadrantDrop` | `@heyta/domain` |
 * | `apps/web/src/features/settings/preference-copy.ts` | `clockText` / `roundedDaysText` | `@heyta/domain` |
 * | `apps/web/src/features/sync/ConflictDialog.tsx` | `summarizeConflictPayload` | `@heyta/sync-client` |
 *
 * 浏览器给的原文是一句毫无商量余地的
 * `does not provide an export named 'summarizeConflictPayload'`，
 * 然后 `<body>` 是空的 —— ES 模块的静态导入是**全有或全无**：
 * 一个名字不存在，整张图就不求值。于是 `openApp()` 里那句
 * "等添加任务的输入框出现"必然超时，**`e2e/` 整套都跑不了**。
 *
 * ⚠️ 这份清单是**穷举**出来的，不是撞一个补一个：拿 `apps/web/src` 里所有
 * `import { … } from '@heyta/*'` 与各包 `dist/index.js` 的**实际导出**去对账。
 * 撞一个补一个的话，页面会以"换一个名字再白屏一次"的方式一轮一轮地回来
 * （实测：修好 `summarizeConflictPayload` 之后是 `planQuadrantDrop`，
 * 再之后是 `clockText` —— 三次白屏、三种报错、同一个成因）。
 *
 * ## 为什么不在产品代码里补
 *
 * 那几个生产者是**别人正在写的东西**（实测主检出里
 * `packages/sync-client/src/client.ts` 有 +496 行未提交改动，
 * `packages/storage/src/errors.ts` 还是未跟踪文件）。替他们写一版、提交进这一支，
 * 换来的是一次**必然的**合并冲突 和 两个版本的同一语义 —— 而这次的任务
 * 只是"让 e2e 通道能跑"。所以垫片**只活在 e2e 的测试进程里**：
 * 它拦截 dev server 送给浏览器的那几个模块，把缺的名字接在文件末尾。
 * 产品代码、`packages/*`、主检出，一个字节都不动。
 *
 * ## 三条纪律（缺一条就会变成"用假实现把红刷成绿"）
 *
 * 1. 🔴 **调用即抛。** 垫片只满足"这个名字存在"，绝不实现任何行为。
 *    任何真的走到这些代码的用例都会**大声失败**，而不是悄悄拿到一个假结果。
 * 2. 🔴 **生产者落地后自动失效。** 先取回原始文件，**文件里已经有那个名字就什么都不加**。
 *    于是它不会遮蔽真实现（遮蔽才是这类垫片最危险的形态），
 *    而且可以一直留着直到有人顺手删掉 —— 不会因为"忘了删"而骗人。
 * 3. 🔴 **生效时打日志。** 悄悄生效的垫片 = 悄悄降级的验收。生效一次就打一行
 *    `[e2e 垫片]`，跑测试的人看得见"这一轮是在生产者缺席的情况下跑的"。
 *
 * ⚠️ 完整的来龙去脉与"什么时候该删掉它"写在
 * `docs/plans/activity-categories-and-colors.md` §8.6。
 */

import type { Page } from '@playwright/test';

interface Shim {
  /** 缺的那个导出名。**同时**是"生产者是否已落地"的判据。 */
  name: string;
  /** 占位实现：只为让模块图求值成功，一调用就炸。 */
  code: string;
}

/** 函数占位：**调用即抛**。 */
function fn(name: string): Shim {
  return {
    name,
    code: `export function ${name}() {
  throw new Error('[e2e 垫片] ${name} 尚未落地（消费者已提交、生产者仍在别人的在飞工作树里）');
}`,
  };
}

/**
 * 按**包**分组，一个包一条拦截器。
 *
 * 🔴 不能一个名字注册一条路由：同一 URL 上多条路由只有**一条**会生效
 * （后注册的优先），于是后注册的那个名字会把前一个的名字吃掉 ——
 * 症状是"垫片明明写了，浏览器还说缺另一个名字"。
 * 实测踩过：`planQuadrantDrop` / `clockText` / `roundedDaysText` 三条同包路由，
 * 只有最后一条真的加上了。
 */
const SHIMS: ReadonlyArray<{ pkg: string; names: readonly Shim[] }> = [
  {
    pkg: 'storage',
    names: [
      {
        name: 'StorageError',
        // ⚠️ 类必须是**真的类**：`main.tsx` 用它做 `instanceof` 判断。
        // 而 `instanceof` 只走原型链、不碰构造函数 —— 所以可以让"读 `failure`"炸掉，
        // 从而不会把"这不是一个存储错误"变成静默的 false。
        code: `export class StorageError extends Error {
  get failure() {
    throw new Error('[e2e 垫片] StorageError 尚未落地');
  }
}`,
      },
    ],
  },
  {
    pkg: 'domain',
    names: [
      // 象限拖放的投放计划（一次拖放 = 一条 op，计划由领域层算）。
      fn('planQuadrantDrop'),
      // 下面两个只在**偏好依据的句子**里用到（设置页的"我了解到的你"）。
      // 出厂的记忆是空的，正常旅程里走不到 —— 走到了就大声失败。
      fn('clockText'),
      fn('roundedDaysText'),
    ],
  },
  { pkg: 'sync-client', names: [fn('summarizeConflictPayload')] },
];

/** 这一轮真的生效过的垫片（给报告用，避免"悄悄生效"）。 */
export const ACTIVE_SHIMS: string[] = [];

/**
 * 装上垫片。必须在 `page.goto()` **之前**调用 —— 拦截的是首次加载的那批请求。
 */
export async function installMissingProducerShims(page: Page): Promise<void> {
  for (const shim of SHIMS) {
    // ⚠️ 用**正则**而不是 glob：dev server 会给模块 URL 挂查询串
    // （`?t=…` / `?v=…`），glob 的 `**/index.js` 匹配不到 `index.js?t=1`，
    // 于是垫片**静默不生效**、症状与"这个模块不需要垫片"逐字相同。
    const pattern = new RegExp(`/packages/${shim.pkg}/dist/index\\.js(\\?.*)?$`);

    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      const body = await response.text();

      // 纪律 2：生产者已落地 → 那一个名字一个字都不加（也就不会遮蔽真实现）。
      const missing = shim.names.filter((n) => !body.includes(n.name));
      if (missing.length === 0) {
        await route.fulfill({ response, body });
        return;
      }

      // 纪律 3：生效就说出来。
      for (const n of missing) ACTIVE_SHIMS.push(`${shim.pkg}#${n.name}`);
      console.warn(
        `[e2e 垫片] ${shim.pkg} 缺 ${missing.map((n) => n.name).join(' / ')}，已接上"调用即抛"的占位`,
      );
      await route.fulfill({
        response,
        body: `${body}\n${missing.map((n) => n.code).join('\n')}\n`,
      });
    });
  }
}
