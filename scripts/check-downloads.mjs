#!/usr/bin/env node
/**
 * 下载面的两条结构性门禁：直链只能来自清单，清单只能装登记过的端
 * ================================================================
 *
 * ## 为什么这一条必须是门禁，而不是测试
 *
 * `tests/downloads.spec.tsx` 能证明**渲染出来的东西**对：空清单出不了链接、
 * 满清单出的链接逐字等于清单。但它看不见的是另一种失效 ——
 *
 * > 有人直接在组件里粘一条 `https://…myqcloud.com/…`。
 *
 * 那种写法在测试里**照样绿**：它渲染出的 href 与清单里的可能一模一样，也可能根本不在清单上，
 * 而"页面有没有链接"这件事不再是清单的函数。发布脚本删掉一个产物，页面却还挂着那条链接，
 * 于是访客拿到一个 404 —— 而这一族的每一道门都还是绿的。
 *
 * 所以这里管的是**源码形状**，测试管的是**行为**，两者不重叠。
 * 同族的既有判据：`check:legal-tools`（文档表格 ↔ 目录对账）、`check:server-copy`（生成物 ↔ 真源）。
 *
 * ## 四臂（`--self-test` 逐臂证明会红；臂数由它自己打印）
 *
 *   A  手写直链：`apps/landing/src` 里除清单快照外，任何文件出现分发桶域名 ⇒ 红。
 *   B  通道白名单：`channels` 里的 host 不在官方域名表内 ⇒ 红（那一处**是**手写的，所以必须有闸门）。
 *   C  未登记的产物/通道：清单里的键在下载面注册表里没有对应行 ⇒ 红。
 *   D  同轮性：`files.<平台>.name` 必须等于 `heyta-<version>-<平台>.<ext>` ⇒ 红
 *      （防的是 `latest/` 里混进上一轮字节：URL 与版本号都好看，但那不是同一个构建）。
 *
 * ## 为什么 D 不由 `upload-dist.sh` 自己保证
 *
 * 它写 `latest.json` 时两条都成立 —— 但这一页读的是**提交进仓库的那份快照**，
 * 而快照一旦落后于桶（下一次发布忘了跑 `gen:downloads`），D 是唯一还能看出不对的判据。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HEYTA_CHECK_ROOT ?? join(HERE, '..');
const LANDING_SRC = join(ROOT, 'apps/landing/src');
const MANIFEST_PATH = join(ROOT, 'apps/landing/src/site/release-manifest.json');

/** 🔴 与 `src/site/downloads.ts` 的 `OFFICIAL_STORE_HOSTS` 必须是同一份 —— 由臂 B 的自检保证。 */
const OFFICIAL_STORE_HOSTS = ['testflight.apple.com', 'apps.apple.com', 'play.google.com'];

/** 清单快照是唯一允许出现分发桶域名的文件。 */
const MANIFEST_BASENAME = 'release-manifest.json';

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'dist-types'].includes(entry.name)) continue;
      out.push(...collectFiles(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function readRegisteredRows(root) {
  // 注册表住在 TS 里，而这个脚本要在**没有构建产物**的干净检出上能跑
  // （`pnpm check` 的门禁段跑在 `pnpm build` 之后，但 `--self-test` 拿的是临时树）。
  // 用 Node 自带的类型擦除直接读源文件，与 `gen-entries.mjs` 同一个手法。
  const source = readFileSync(join(root, 'apps/landing/src/site/downloads.ts'), 'utf8');
  const manifestKeys = [...source.matchAll(/manifestKey:\s*'([a-z]+)'/g)].map((m) => m[1]);
  const storeIds = [...source.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
  const storeVia = /via:\s*'store'/.test(source);
  return { manifestKeys, storeIds, storeVia };
}

function manifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

export function checkLanding(root) {
  const problems = [];
  const srcDir = join(root, 'apps/landing/src');
  const files = collectFiles(srcDir);
  const bucket = 'myqcloud.com';

  // 臂 A
  for (const file of files) {
    if (relative(srcDir, file).endsWith(MANIFEST_BASENAME)) continue;
    const text = readFileSync(file, 'utf8');
    if (text.includes(bucket)) {
      problems.push(`A 手写直链：${relative(root, file)} 里出现了分发桶域名`);
    }
  }

  const raw = JSON.parse(readFileSync(join(root, 'apps/landing/src/site', MANIFEST_BASENAME), 'utf8'));
  const registered = readRegisteredRows(root);

  // 臂 B
  for (const [key, channel] of Object.entries(raw.channels ?? {})) {
    let host = '';
    try {
      host = new URL(channel.url).host;
    } catch {
      problems.push(`B 通道 ${key} 的 url 读不出地址`);
      continue;
    }
    if (!OFFICIAL_STORE_HOSTS.includes(host)) {
      problems.push(`B 通道 ${key} 的 ${host} 不在官方域名白名单`);
    }
  }

  // 臂 C
  for (const key of Object.keys(raw.files ?? {})) {
    if (!registered.manifestKeys.includes(key)) {
      problems.push(`C 清单里的产物 ${key} 没有登记在下载面注册表`);
    }
  }
  for (const key of Object.keys(raw.channels ?? {})) {
    if (!registered.storeIds.includes(key) || !registered.storeVia) {
      problems.push(`C 清单里的通道 ${key} 不是注册表中标成商店的一行`);
    }
  }

  // 臂 D
  for (const [platform, file] of Object.entries(raw.files ?? {})) {
    // 版本挂在**文件**上：合并后的清单里各端可以来自不同轮（见 downloads.ts 的 ReleaseFile）。
    const own = typeof file.version === 'string' && file.version !== '' ? file.version : raw.version;
    const expected = `heyta-${own}-${platform}.`;
    if (typeof file.name !== 'string' || !file.name.startsWith(expected)) {
      problems.push(`D ${platform} 的文件名 ${file.name} 不属于它自己声明的版本 ${own}`);
    }
    if (typeof file.url === 'string' && !file.url.endsWith(`/${file.name}`)) {
      problems.push(`D ${platform} 的 url 指向的不是它自己声明的文件`);
    }
  }

  return { problems, filesChecked: files.length };
}

/* ── 自检：四臂各自必须能红，另有一条阳性对照 ───────────────────────────── */

function fixtureTree(mutate) {
  const dir = join(HERE, `.check-downloads-fixture.${process.pid}.${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'apps/landing/src/site'), { recursive: true });
  mkdirSync(join(dir, 'apps/landing/src/pages'), { recursive: true });
  // 注册表源文件按原样带过去（臂 C 是从它读登记集合的，抄一份假的就等于自检在测自己）。
  writeFileSync(
    join(dir, 'apps/landing/src/site/downloads.ts'),
    readFileSync(join(ROOT, 'apps/landing/src/site/downloads.ts'), 'utf8'),
  );
  const good = {
    version: '1.0.0',
    releasedAt: '2026-10-07T00:00:00+00:00',
    files: {
      macos: {
        name: 'heyta-1.0.0-macos.dmg',
        url: 'https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/app-releases/heyta/latest/heyta-1.0.0-macos.dmg',
        versionedUrl: 'x',
        sha256: 'b'.repeat(64),
        size: 2362276,
      },
    },
    channels: {
      ios: { url: 'https://testflight.apple.com/join/AAAAbbbb', name: 'TestFlight', addedAt: '2026-10-07T00:00:00+00:00' },
    },
  };
  const doc = mutate(structuredClone(good));
  writeFileSync(join(dir, 'apps/landing/src/site/release-manifest.json'), JSON.stringify(doc, null, 2));
  writeFileSync(join(dir, 'apps/landing/src/pages/DownloadPage.tsx'), '// 干净的组件\n');
  return dir;
}

const ARMS = [
  ['A 手写直链', (doc) => doc, (dir) =>
    writeFileSync(join(dir, 'apps/landing/src/pages/DownloadPage.tsx'),
      'const href = "https://heyta-dist-1380503169.cos.ap-guangzhou.myqcloud.com/a.bin";\n')],
  ['B 通道白名单', (doc) => { doc.channels.ios.url = 'https://download.example.com/ios'; return doc; }],
  ['C 未登记产物', (doc) => { doc.files.watchos = { ...doc.files.macos, name: 'heyta-1.0.0-watchos.bin', url: `${'https://x/'}heyta-1.0.0-watchos.bin` }; return doc; }],
  ['D 同轮性', (doc) => { doc.files.macos.name = 'heyta-0.9.0-macos.dmg'; return doc; }],
];

function selfTest() {
  let arms = 0;
  let failures = 0;
  for (const [label, mutate, extra] of ARMS) {
    arms += 1;
    const dir = fixtureTree(mutate);
    let red = false;
    try {
      if (extra) extra(dir);
      const { problems } = checkLanding(dir);
      red = problems.some((p) => p.startsWith(label[0]));
      if (!red) console.log(`❌ 臂 ${label} 没有报红：${problems.join(' / ') || '(无问题)'}`);
      else console.log(`✅ 臂 ${label} 报红：${problems.find((p) => p.startsWith(label[0]))}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (!red) failures += 1;
  }
  // 阳性对照：一份完全合法的清单必须一个字都不报。
  const clean = fixtureTree((doc) => doc);
  try {
    const { problems } = checkLanding(clean);
    if (problems.length > 0) {
      console.log(`❌ 阳性对照失败：合法清单被报红 ${problems.length} 条\n  ${problems.join('\n  ')}`);
      failures += 1;
    } else {
      console.log('✅ 阳性对照：合法清单零报红');
    }
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
  console.log(`\n臂数 ${arms}（由本脚本自己打印），失败 ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();
else {
  if (!existsSync(MANIFEST_PATH)) {
    console.error('🔴 找不到发布清单快照（apps/landing/src/site/release-manifest.json）');
    process.exit(1);
  }
  const { problems, filesChecked } = checkLanding(ROOT);
  const m = manifest();
  const ready = Object.keys(m.files ?? {}).length;
  if (problems.length > 0) {
    console.error(`🔴 下载面门禁红了（${problems.length} 条）：\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    `✅ 下载面：扫了 ${filesChecked} 个文件、清单版本 ${m.version} 带 ${ready} 个产物、通道 ${Object.keys(m.channels ?? {}).length} 枚，手写直链 0 处`,
  );
}
