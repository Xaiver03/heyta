/**
 * 还原确认面板的那几个数字必须来自**重放**，不来自文件自己的声明
 * ================================================================
 *
 * `apps/mobile` 的测试通道是源码级的（node 环境，无 RTL / 无 jsdom，理由见
 * `subtask-entry.spec.ts` 文件头），设备上的真行为由 `pnpm verify:mobile-*` 那一族负责。
 * 所以这里钉的是"这一端到底接了哪个函数"，而不是"数字算得对不对"——
 * 算法本身由 `packages/app-host/tests/import-dump.spec.ts` 的
 * 「预告数字来自重放，不来自文件的声明」那条负责。
 *
 * 🔴 为什么这一条不能只停在共享层：批次 E 的 route (B) 把恢复产物改成"只交 op-log"
 * 的信封（实体由客户端 reducer 物化）。共享层因此有了 `previewRestore()`，
 * 而**共享层有这组代码 ≠ 每个宿主都在用它**。原来这一格写的是
 * `document.counts.entities?.TASK?.total ?? 0`：ops-only 产物没有那一格，
 * `?? 0` 会让面板说"0 条记录、0 条已删除"，而按下去真的会导进含墓碑的若干条 ——
 * 那不是"少显示一点信息"，那是界面在说谎（确认面板的语义就是"按下去会发生什么"）。
 *
 * 每条负向断言都配了同趟的正向对照（同一个 needle 在本文件其他位置必然命中），
 * 否则"没命中"可能只是探针根本没读到文件 —— 那正是这类判据最容易假绿的地方。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 🔴 路径相对本文件解析：vitest 的工作目录是 `apps/mobile`，写仓库相对路径会 ENOENT。
const SCREEN = new URL('../src/screens/ExportScreen.tsx', import.meta.url);

/** 读源码并**去掉注释**：注释里提到 `previewRestore` 不算接上了。 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\S\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const screen = (): string => stripComments(readFileSync(SCREEN, 'utf8'));

/** `restorePreviewVars` 的函数体（从声明到下一个顶层声明之前）。 */
const varsBody = (): string => {
  const src = screen();
  const start = src.indexOf('function restorePreviewVars');
  expect(start, '源码里找不到 `function restorePreviewVars`').toBeGreaterThan(-1);
  const end = src.indexOf('\nfunction ', start + 1);
  const stop = end === -1 ? src.length : end;
  const body = src.slice(start, stop);
  // 分母哨兵：这一格必须真的截到一段有内容的函数体，而不是空串（空串会让下面的
  // "没有 counts"变成恒真）。
  expect(body.length, 'restorePreviewVars 的函数体截出来是空的').toBeGreaterThan(80);
  return body;
};

describe('还原确认面板的数字来源', () => {
  it('🔴 走 previewRestore（重放），不读文件自己声明的 counts', () => {
    const body = varsBody();
    expect(body, '确认面板又回到读文件声明的计数了').toContain('previewRestore(');
    expect(body, '函数体里不许出现 counts —— ops-only 产物那一格是缺省的，`?? 0` 就是说谎').not.toContain(
      'counts',
    );
    // 正向对照：`counts` 这个词在本文件**别处**确实存在（导出侧那一格是真的从
    // doc.counts 取的），所以上面那条"没有"是探针读到了文件之后的判断，不是没读到。
    expect(screen(), '正向对照失效：本文件里连一处 counts 都没有，探针可能没读到源码').toContain(
      'doc.counts',
    );
  });

  it('🔴 那句文案的参数由 restorePreviewVars 提供，而不是直接把预览对象摊开', () => {
    const src = screen();
    const call = src.indexOf("t('mobile.restore.previewCounts'");
    expect(call, '找不到确认面板那句文案的调用点').toBeGreaterThan(-1);
    const region = src.slice(call, call + 220);
    expect(region, 'previewCounts 的参数没接 restorePreviewVars( ⇒ 面板显示的是文件声明的那一份').toContain(
      'restorePreviewVars(',
    );
    // 同一段里不许同时出现 `...restorePreview`（那是解析出来的文档对象本身）。
    expect(region, '参数又把整份预览文档摊开了（缺省格会变 0）').not.toContain('...restorePreview)');
    // 正向对照：`restorePreview` 这个状态变量在本文件里确实存在并且被传给 vars。
    expect(src).toContain('restorePreviewVars(restorePreview)');
  });

  it('确认面板那六个数字一个都不许少（少一格就是文案里出现 undefined）', () => {
    const body = varsBody();
    for (const key of ['tasks', 'projects', 'tags', 'entities', 'deleted', 'ops']) {
      expect(body, `确认面板少了 ${key} 这一格`).toMatch(new RegExp(`\\b${key}:`));
    }
  });
});
