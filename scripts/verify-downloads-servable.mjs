#!/usr/bin/env node
/**
 * `verify:downloads-servable` —— 落地页要给的每一枚产物，**匿名 GET 真的下得到吗**。
 * ============================================================================
 *
 * ## 它补的是哪个洞
 *
 * 落地页的下载行是**清单驱动**的（`release-manifest.json` → `downloads.ts` → `DownloadPage`），
 * 而清单的 `url` 直接变成访客点的那个按钮。可是**此前没有任何一层验证过那个 URL 真的能下**：
 *
 *   · `gen-downloads.mjs --check`（= `verify:downloads-live`）只把桶里的 `latest.json`
 *     与本仓库那份快照**逐字比一遍** —— 它比的是**元数据**，不是**可取性**；
 *   · `upload-dist.sh` 的回读**原来用 HEAD**，而 HEAD 对这份桶是**会骗人的**：
 *     2026-10-16 实测同一个 URL `HEAD → 200` / `GET → 403`（腾讯云默认域名禁发 APK）。
 *     那条回读已在同一天改成**范围 GET**，但它只管**刚上传的那一批**，
 *     管不到"页面上正在展示的那一批"。
 *
 * ⇒ 于是出现了一个**没有任何门禁覆盖**的形状：**页面给了一个点了下不动的按钮**。
 *   而本仓库对这件事的立场是明文的（`Pricing.tsx` 与 `check-payment-entry.mjs` 同一条）：
 *   **一个点了没反应的按钮，比没有按钮更坏。**
 *
 * ## 为什么用**范围 GET**（`Range: bytes=0-0`），不用 HEAD
 *
 * 见上：这个桶上 HEAD 与 GET **会给出不同答案**。只取一个字节既证明了"匿名真的读得到正文"，
 * 又几乎不花流量；`Content-Range` 里还带着对象总大小，可以顺手与清单里的 `size` 对账。
 *
 * ## 用法
 *
 *   node scripts/verify-downloads-servable.mjs                  # 读仓库快照，逐条探
 *   node scripts/verify-downloads-servable.mjs --manifest <p>   # 换一份清单（自检用）
 *   node scripts/verify-downloads-servable.mjs --self-test      # 证明它**真的会红**
 *
 * ⚠️ 它是 `verify:*` 而不是 `check:*`：**要联网**。按本仓的分工，
 *    `check:*` 那一族必须离线可跑，联网的一律归 `verify:*`。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const SNAPSHOT = join(ROOT, 'apps/landing/src/site/release-manifest.json');

/**
 * 探一枚产物。返回 `{ ok, detail }` —— **永不抛**（网络抖动不该变成一个崩掉的判据，
 * 它应当变成一条**红的读数**）。
 */
export async function probeOne(url, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
    });
    if (res.status !== 200 && res.status !== 206) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    // 206 时 `Content-Range` 是 `bytes 0-0/<总长>`；整行按 `/` 切，**不能**取 `$2`
    // （那是 `bytes`，会切出空的 —— 这个坑 2026-10-16 在 `upload-dist.sh` 里踩过一次）。
    const range = res.headers.get('content-range');
    const total = range === null ? undefined : Number(range.split('/').pop());
    return { ok: true, detail: `HTTP ${res.status}`, total };
  } catch (error) {
    return { ok: false, detail: `${error?.name ?? 'Error'}` };
  }
}

/** 把一份清单展开成要探的 `{ platform, name, url, size }` 列表。 */
export function entriesOf(manifest) {
  return Object.entries(manifest?.files ?? {}).map(([platform, file]) => ({
    platform,
    name: String(file?.name ?? ''),
    url: String(file?.url ?? ''),
    size: typeof file?.size === 'number' ? file.size : undefined,
  }));
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--manifest');
  const manifestPath = at === -1 ? SNAPSHOT : argv[at + 1];

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`🔴 读不到清单：${manifestPath}\n   ${String(error)}`);
    process.exit(1);
  }

  const entries = entriesOf(manifest);
  if (entries.length === 0) {
    // 🔴 不许静默通过：读不到任何条目时，"全部可取"是一个**空真的**结论。
    console.error('🔴 清单里一条产物都没有 —— 这条判据正在变成一条空规则。');
    process.exit(1);
  }

  const problems = [];
  for (const entry of entries) {
    const { ok, detail, total } = await probeOne(entry.url);
    const sizeNote = entry.size === undefined || total === undefined ? '' : `（清单 ${entry.size} / 远端 ${total}）`;
    if (!ok) {
      problems.push(`「${entry.platform}」匿名 GET 拿不到：${detail}   ${entry.name}${sizeNote}`);
      continue;
    }
    console.log(`  ✅ ${entry.platform.padEnd(8)} ${detail}  ${entry.name}${sizeNote}`);
  }

  if (problems.length > 0) {
    console.error(`\n🔴 页面会给出 ${problems.length} 枚**点了下不动**的产物：`);
    for (const p of problems) console.error(`   · ${p}`);
    console.error(
      '\n   ⇒ 落地页的下载行是清单驱动的，所以这一条**就是访客会撞上的那一堵墙**。\n' +
        '      要么把产物放到能公开读的地方（自定义域名 / 换渠道），\n' +
        '      要么把那一端从清单里拿掉（`via` 改成给原因不给按钮的那一档）。\n' +
        '      ⚠️ 不要拿 HEAD 复核：这个桶上 HEAD 与 GET 会给不同答案。',
    );
    process.exit(1);
  }
  console.log(`\n✅ ${entries.length} 枚产物全部匿名可取。`);
}

/* ── 自检：证明这条判据**真的会红** ──────────────────────────────────── */

async function selfTest() {
  const cases = [
    ['一个不存在的对象必须判红', 'https://example.invalid/nope.bin', false],
    // ⚠️ 这一臂原来用的是 `data:` URL —— 而 Node 的 fetch 对它是**成功返回 200** 的，
    // 于是臂自己错了（不是被测代码错了）。换一个**真的会 reject** 的输入。
    ['一个根本不是 URL 的输入会抛，也必须判红而不是崩', 'not-a-url', false],
  ];
  let failures = 0;
  for (const [label, url, expectOk] of cases) {
    const { ok, detail } = await probeOne(url);
    const hit = ok === expectOk;
    console.log(`${hit ? '✅' : '❌'} ${label}（ok=${String(ok)}, ${detail}）`);
    if (!hit) failures += 1;
  }
  // 清单读不出东西时必须响亮失败（"空真的"也是空转）
  const empty = entriesOf({ files: {} });
  const hitEmpty = empty.length === 0;
  console.log(`${hitEmpty ? '✅' : '❌'} 空清单会被识别（真正的判断在 main 里 exit 1）`);
  if (!hitEmpty) failures += 1;
  console.log(`\n臂数 3（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) await selfTest();
else await main();
