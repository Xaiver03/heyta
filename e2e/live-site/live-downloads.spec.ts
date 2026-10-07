/**
 * 线上 `/download` 的直链集合 = 桶里 `latest.json` 的正式通道集合。
 * ================================================================
 *
 * ## 为什么这条只能长在线上
 *
 * [ADR-0058](../../docs/adr/0058-download-page-and-manifest-single-source.md) §5 里写明了一笔代价：
 * 清单快照（`apps/landing/src/site/release-manifest.json`）与分发桶之间**没有自动载体** ——
 * `pnpm check` 里那四臂（A–D）全是离线结构判据，网络的比较刻意不进链。
 * 失效形态是"**忘了在发布后刷新快照 ⇒ 页面描述上一轮**"，而它不会自己变红。
 *
 * 离线那两层都拦不住它：`downloads.spec.tsx` 与 `landing/download.spec.ts` 读的**都是同一份快照**，
 * 所以快照整体过期时它们一起跟着错 —— 两个人对同一张假地图，永远一致。
 * 唯一能发现"页面与桶不一致"的，是**同时读两边**的这一条，而它只能在发布之后跑。
 * 它住在 `playwright.live-site.config.ts` 那一族里，也就是发布脚本第 9 步每次都会跑。
 *
 * ## 判据的形状
 *
 * 1. **正向锚点先立**：八张卡渲染了、页眉有字、批次号读得到 —— 否则下面那条集合相等
 *    会在"SPA 没渲染 / 被兜底成一张壳"时无条件成立（AGENTS §7 元规则 2）。
 * 2. **集合相等，不是子集**：桶里有而页面没有 = 漏发（这一条抓的就是那笔代价）；
 *    页面有而桶里没有 = 页面上有个点了会 404 的按钮。两个方向都必须是红的。
 * 3. **预发布通道的字节不算产物**：判据与页面走同一条规则（`\d+\.\d+\.\d+`），
 *    所以"桶里多一枚 `0.0.0-dev`"不该让这条红。
 *
 * ## 能红与能绿分别有证
 *
 * `HEYTA_LIVE_MANIFEST_URL` 是**只给这条判据用的真相旋钮**（默认 = 桶）。
 * 两个方向各造一次假清单（多一枚 / 少一枚）跑一次，见
 * `docs/runbooks/deployment.md` 里那条"线上验收怎么变异复验"。
 */
import { expect, test } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';
const BUCKET = 'heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com';
const TRUTH_URL =
  process.env['HEYTA_LIVE_MANIFEST_URL'] ??
  `https://${BUCKET}/app-releases/heyta/latest/latest.json`;
const ROW_IDS = ['web', 'macos', 'ios', 'android', 'windows', 'linux', 'harmony', 'selfhost'];
/** 注册表里 `via: 'file'` 的那几行；行 id 与清单 key 同名（臂 C 钉住登记）。 */
const FILE_ROWS = ['macos', 'android', 'windows', 'linux'];

interface Truth {
  readonly version: string;
  readonly files: Record<string, {name: string; url: string; version?: string; size: number}>;
  readonly channels?: Record<string, {url: string}>;
}

/** 与 `src/site/downloads.ts` 同一条：带预发布后缀的通道不算产物。 */
function stable(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function publishedRows(truth: Truth): string[] {
  return FILE_ROWS.filter((id) => {
    const file = truth.files[id];
    return file !== undefined && stable(file.version ?? truth.version);
  });
}

test('线上 /download 的直链集合等于桶里 latest.json 的正式通道集合', async ({page, request}) => {
  const fetched = await request.get(TRUTH_URL);
  expect(fetched.status(), `读不到判据的真相源：${TRUTH_URL}`).toBe(200);
  const truth = (await fetched.json()) as Truth;

  await page.goto(`${ORIGIN}/download/`);
  // 正向锚点：SPA 真渲染了（落地页是客户端渲染的，`curl` 只看得到 7 KB 的壳）。
  await expect(page.locator('.dl-card'), '线上 /download 没渲染出卡片').toHaveCount(ROW_IDS.length);
  await expect(page.locator('.dl-body'), '正文容器是空的').not.toBeEmpty();

  const expected = publishedRows(truth);
  const expectedHrefs = expected.map((id) => truth.files[id]!.url).sort();
  const actualHrefs = (await page.locator(`a[href*="${BUCKET}"]`).evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).href),
  )).sort();

  if (expected.length === 0) {
    // 桶里一枚正式产物都没有：页面就该一条直链都没有。
    // ⚠️ 这一支今天走不到（四端都在）。留着是为了"清空之后"那一轮仍然有判据，
    //    而不是变成一条恒绿的相等比较。
    expect(actualHrefs, '桶里是空的，页面上却画出了直链').toEqual([]);
    return;
  }

  // 集合相等（两个方向都在这一条里：漏发与多发都会红）。
  expect(actualHrefs, `页面直链与桶里的正式产物不一致（期望 ${expected.join(',')}）`).toEqual(
    expectedHrefs,
  );

  // 每一端各自核对：按钮在**它自己那张卡**里，而不是整页凑数。
  for (const id of expected) {
    const card = page.locator(`#dl-${id}`);
    await expect(card.locator('a.lp-btn'), `${id} 在桶里有产物，卡里却没有按钮`).toHaveCount(1);
    await expect(
      card.locator('.dl-meta__name'),
      `${id} 卡里没有那枚文件的真名`,
    ).toHaveText(truth.files[id]!.name);
  }

  // 没有产物的一端：只许有原因，不许有出口。
  for (const id of FILE_ROWS.filter((row) => !expected.includes(row))) {
    await expect(page.locator(`#dl-${id} a.lp-btn`), `${id} 没有产物却画了按钮`).toHaveCount(0);
    await expect(page.locator(`#dl-${id} .dl-gap`), `${id} 没写差在哪一步`).toBeVisible();
  }
  if (truth.channels?.ios === undefined) {
    await expect(page.locator('#dl-ios a.lp-btn'), '清单没有 ios 通道，页面上却有了 TestFlight 入口')
      .toHaveCount(0);
  }

  // 页面自己声明的批次号 = 清单批次号（访客核对的是"哪一轮"）。
  await expect(page.locator('.dl-verify')).toContainText(truth.version);
});
