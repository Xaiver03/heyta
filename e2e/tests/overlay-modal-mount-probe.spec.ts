import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

/**
 * §7 第 606 条那句"未判定"的**一次定死测量**（P6 开工前置）
 *
 * 读的是三样：`document.body` 子节点增量、`[aria-modal]` 计数、`[role="dialog"]` 计数。
 * 这一枚**不猜结论**：它把三个读数写进
 * `apps/web/evidence/overlay-modal-mount/probe.json`，
 * 判定（"挂载了但没激活"还是"没挂"）写在计划 §P6 与那条陷阱里，由读数支撑。
 *
 * ⚠️ 它只断言"探针真的跑到了那一帧"（基线取到、按钮点下去、内容出现在 DOM 里），
 *    不断言三个计数该是多少 —— 那正是这次要**量**的东西。
 */
test('OverlayModal 在真实浏览器里的挂载形状（三项同量）', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/probe/overlay-modal.html');
  await expect(page.getByTestId('probe-open')).toBeVisible();

  const read = (base: number) => page.evaluate(
    (b) => ({
      bodyChildDelta: document.body.childElementCount - b,
      ariaModalCount: document.querySelectorAll('[aria-modal]').length,
      roleDialogCount: document.querySelectorAll('[role="dialog"]').length,
      probeBodyInDom: document.querySelectorAll('[data-testid="probe-body"]').length,
      probeModalHostInDom: document.querySelectorAll('[data-testid="probe-modal"]').length,
    }),
    base,
  );

  const baseline = await page.evaluate(() => document.body.childElementCount);
  /**
   * 第三发：**同一次 evaluate 里点下去就立刻读**（没有任何往返）。
   * 这一发要判的是 P1 那晚 `aria-modal` 也为 0 的那一半 ——
   * 上面"同帧"那一发其实已经跨了一次 CDP 往返（≈ 一个 commit 之后），
   * 如果连它都读到 `aria-modal=1`，那 P1 的 0 只可能来自**更早**的那一刻：
   * React 还没 commit。这一发就是把那一刻抓下来。
   */
  const sync = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="probe-open"]')?.click();
    return {
      ariaModalCount: document.querySelectorAll('[aria-modal]').length,
      roleDialogCount: document.querySelectorAll('[role="dialog"]').length,
      probeBodyInDom: document.querySelectorAll('[data-testid="probe-body"]').length,
    };
  });
  console.log('commit 前那一发', JSON.stringify(sync));
  /**
   * 🔴 同帧那一发**就是本次要判的那件事**：
   * P1 那一晚读到 `[aria-modal] = 0`（§7 第 606 条），两个候选一直没分开 ——
   *   ① 测早了一帧（React 还没 commit，或 RNW 的 `active` 要等 `animationend`）；
   *   ② 那一层被宿主子树里某个条件挡住（那就是"迁过去也够不到"，P6 得换外壳）。
   * ①与②的出路完全相反，所以**必须用同一枚探针把两次读数并排放**：
   * 同帧 0 / 延帧 1 ⇒ ①成立（装置问题，组件没问题）；两帧都 0 ⇒ ②。
   */
  const immediate = await read(baseline);
  await page.waitForTimeout(1_200);
  const readings = await read(baseline);
  console.log('同帧读数', JSON.stringify(immediate));

  await writeFile(
    new URL('../../apps/web/evidence/overlay-modal-mount/probe.json', import.meta.url),
    `${JSON.stringify({ syncInClickTask: sync, immediate, settled: readings, baseline }, null, 2)}\n`,
  );
  console.log('OverlayModal 挂载读数', JSON.stringify(readings));

  expect(readings.probeBodyInDom, '探针内容都没进 DOM ⇒ 这一页没跑到那一帧，读数无意义').toBeGreaterThan(0);
});
