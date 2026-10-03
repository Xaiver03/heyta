#!/usr/bin/env node
/**
 * 共享 UI 产物的**自洽**判据：产物自己说它挂在哪儿，我们就核对它在那儿能不能跑。
 * ==============================================================================
 *
 * ## 这条门禁替代的是什么
 *
 * 原先这件事靠三处注释提醒人：`--base=/app/` 不能省（`docs/runbooks/deployment.md:471`）、
 * nginx 站点文件里各钉一遍、以及只有 Windows 那条验收会查一次"引用是否存在"。
 * 两种事故都真实发生过，而且**都不是被这三处拦住的**：
 *
 * | 日期 | 形态 | 为什么没被发现 |
 * |---|---|---|
 * | 2026-09-30 | 产物按 `--base=/app/` 打（引 `/app/assets/…`），文件却在 dist 根下 | "本地 vs 远端" sha256 对账比的是同一份**错的**产物，照样通过（§7 第 82 条） |
 * | 更早 | 忘了传 `--base`，产物引 `/assets/…`，挂在 `/app/` 下 | 症状是"样式表 MIME 是 text/html"+ 一片空白，构建与测试全绿 |
 *
 * 两条的共同点：**没有任何一层知道"这份产物要挂在什么路径下"**。
 * 所以这里不信任命令行、不信任默认值、也不信任写这个脚本的人 ——
 * **挂载路径从产物自身反推**（`index.html` 里那个模块脚本的前缀），
 * 再与"我打算把它放在哪儿"逐字比。不一致就是红，红得看懂：它会把两侧都打出来。
 *
 * ## 为什么还查 manifest / sw.js / widgets 数据
 *
 * 这三样都在 `public/` 里，Vite **原样拷贝**、不加工。它们一旦指错，
 * 症状分别是一个装出来的 PWA 入口是落地页、`sw.js` 拿到 HTML 而注册被拒、
 * 以及 Windows 小组件永远停在静态占位态 —— 三个都**不报错**。
 * 尤其最后一项：service worker 是按路径前缀决定拦不拦的
 * （`apps/web/src/pwa/sw-core.ts` 的 `kindFromWidgetDataPath`），
 * 前缀对不上就是静默不拦。所以这里必须真的去**取一次那个 URL 对应的文件**。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/check-web-artifact.mjs --mount /            # pnpm check：默认挂载形态
 * node scripts/check-web-artifact.mjs --mount /app/        # 打进服务端镜像 / rsync 上线前
 * node scripts/check-web-artifact.mjs --dist <dir> --mount /app/   # 指别的产物目录
 * ```
 *
 * ⚠️ 它只读产物，不构建。产物不存在时报"请先构建"，不静默跳过 ——
 * 一条永远绿的空判据比没有判据更糟。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fail = (title, detail) => {
  console.error(`\n❌ ${title}\n${detail}`);
  process.exit(1);
};

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};

const distArg = argOf('dist');
const mountArg = argOf('mount');
if (mountArg === undefined) {
  fail(
    '缺少 --mount',
    '  这条判据的全部意义在于核对"产物声明的挂载路径"与"你要挂载的路径"是否一致，\n' +
      '  所以挂载路径必须由调用方给出来，不许有默认值 —— 默认值就是那条"永远绿的空判据"。',
  );
}

/** 首尾都必须有斜杠；`/` 本身合法（根路径部署 —— dev/preview 与 `pnpm check` 用的就是这一档）。 */
const normalize = (p) => {
  // ⚠️ 不要写成 `/^\/.*\/$/`：实测它把合法值 `/` 判成"形状不对"（单个字符喂不满两个斜杠位）。
  if (!/^\/(?:.*\/)?$/.test(p)) {
    fail('--mount 形状不对', `  收到 ${JSON.stringify(p)}，要的是首尾都带斜杠的路径，例如 /app/ 或 /`);
  }
  return p;
};
const MOUNT = normalize(mountArg);
const DIST = resolve(ROOT, distArg ?? 'apps/web/dist');

if (!existsSync(join(DIST, 'index.html'))) {
  fail(
    `找不到产物：${DIST}/index.html`,
    '  先构建：HEYTA_WEB_BASE=' + MOUNT + ' pnpm --filter @heyta/web build',
  );
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');

// ── 1. 从产物自身反推它按什么挂载路径打的 ──────────────────────────────
/**
 * 判据只用**构建期生成的**那条引用（`<script type="module" src="…/assets/…">`）。
 * `public/` 里的引用（manifest、图标）是人手写的，不反映 base；
 * 只有 Vite 生成的资产 URL 才等于"这份产物以为自己在哪儿"。
 */
const genRefs = [...html.matchAll(/(?:src|href)="(\/[^"]*assets\/[^"]+)"/g)].map((m) => m[1]);
if (genRefs.length === 0) {
  fail(
    '产物里没有一条指向 `assets/` 的引用',
    '  意味着我无法反推挂载路径 —— 这不是一条可以放过的情况：\n' +
      `  ${DIST}/index.html 里 href/src 的完整清单：\n` +
      [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => `    ${m[1]}`).join('\n'),
  );
}
const inferred = genRefs[0].slice(0, genRefs[0].lastIndexOf('assets/'));
const assetBases = new Set(genRefs.map((r) => r.slice(0, r.lastIndexOf('assets/'))));
if (assetBases.size > 1) {
  fail(
    '产物内部对"自己挂在哪儿"给出了不一致的答案',
    [...assetBases].map((b) => `    ${JSON.stringify(b)}`).join('\n'),
  );
}
if (inferred !== MOUNT) {
  fail(
    '产物与挂载路径不一致',
    [
      `  产物声明它挂在：${JSON.stringify(inferred)}（从 index.html 的 ${String(genRefs.length)} 条 assets 引用反推）`,
      `  而你要把它放在：${JSON.stringify(MOUNT)}`,
      '',
      '  两种已知成因（都真出过事）：',
      '    · 构建时没带 --base=/app/ 或 HEYTA_WEB_BASE=/app/ ⇒ 产物引用 /assets/…，挂在 /app/ 下会拿回落地页 HTML；',
      '    · 产物按 /app/ 打却被放在 dist 根下 ⇒ 页面 ERR_FILE_NOT_FOUND、整片空白，而哈希对账照样通过。',
      '',
      `  修法：HEYTA_WEB_BASE=${MOUNT} pnpm --filter @heyta/web build`,
    ].join('\n'),
  );
}

// ── 2. index.html 的每个本地引用都要真的在产物里 ───────────────────────
const allRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => u.startsWith('/') && !u.startsWith('//'));
const strip = (u) => (u.includes('?') ? u.slice(0, u.indexOf('?')) : u);
const missingRefs = allRefs.filter((u) => !existsSync(join(DIST, strip(u).slice(MOUNT.length))));
if (missingRefs.length > 0) {
  fail(
    `index.html 有 ${String(missingRefs.length)} 个本地引用在产物里不存在`,
    missingRefs.map((u) => `    ${u}`).join('\n'),
  );
}

// ── 3. PWA 三件套：manifest、sw.js、以及 manifest 真正引用的每个文件 ────
/** manifest 与 sw.js 都由 Vite 按 base 重写引用，所以它们落在挂载根上。 */
for (const required of ['manifest.webmanifest', 'sw.js']) {
  if (!existsSync(join(DIST, required))) {
    fail(`产物缺少 ${required}`, `  它应当出现在 ${DIST} 根下（挂载 ${MOUNT} 时浏览器会去 ${MOUNT}${required}）。`);
  }
}
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));

/** manifest 里的 URL 一律相对 manifest 自身解析 —— 这既是它的正确性来源，也是这里能这么算的理由。 */
const manifestUrl = `https://artifact.invalid${MOUNT}manifest.webmanifest`;
const resolveAgainstManifest = (u) => new URL(u, manifestUrl).pathname;

/**
 * 🔴 `id` / `start_url` / `scope` 不许是根绝对：那是 2026-09-30 那次的直接成因
 * （挂在 `/app/` 下而 `start_url: '/'` ⇒ 装出来的 PWA 入口是落地页）。
 * `apps/web/tests/pwa.spec.ts` 也钉了这一条，两处不是重复：
 * 那一处钉的是**生成脚本的输出**，这一处钉的是**这次构建的产物**。
 */
for (const key of ['id', 'start_url', 'scope']) {
  const value = manifest[key];
  if (typeof value === 'string' && value.startsWith('/')) {
    fail(`manifest.${key} 是根绝对地址`, `  值：${JSON.stringify(value)} —— 必须相对 manifest 自身解析（见 gen-pwa.mjs 的注释）。`);
  }
}

const manifestFiles = [
  ...(Array.isArray(manifest.icons) ? manifest.icons.map((i) => i.src) : []),
  ...(Array.isArray(manifest.widgets)
    ? manifest.widgets.flatMap((w) => [w.ms_ac_template, w.data, ...(w.icons ?? []).map((i) => i.src)])
    : []),
];
const missingManifestFiles = manifestFiles
  .filter((u) => typeof u === 'string')
  .map((u) => ({ given: u, path: resolveAgainstManifest(u) }))
  .filter(({ path }) => !existsSync(join(DIST, path.slice(MOUNT.length))));
if (missingManifestFiles.length > 0) {
  fail(
    `manifest 引用了 ${String(missingManifestFiles.length)} 个产物里不存在的文件`,
    missingManifestFiles.map((f) => `    ${f.given} → ${f.path}`).join('\n'),
  );
}

// ── 4. manifest 声明的数据 URL，必须落在 SW 真会拦的那个前缀里 ──────────
/**
 * service worker 的拦截是按**路径前缀**判的（`apps/web/src/pwa/sw-core.ts` 的
 * `kindFromWidgetDataPath`），而那个前缀由 `sw.js` **自己的地址**推出来。
 *
 * ⇒ 真正的耦合不是"数据文件在不在"（上面第 3 步已经逐个取过了），而是
 * **manifest 让宿主去取的那个 URL，SW 认不认得**。
 * 两者错开的形态很具体：manifest 里写回根绝对的 `/widgets/x.data.json`、
 * 或者把 `sw.js` 放到比 manifest 深一层的位置。
 * 错开的后果是**静默不拦** —— 组件永远显示静态占位态，没有任何一处会报错。
 */
const widgetDir = new URL('widgets/', `https://artifact.invalid${MOUNT}sw.js`).pathname;
const widgetData = (Array.isArray(manifest.widgets) ? manifest.widgets : []).map((w) => w.data);
if (widgetData.length === 0) {
  fail('manifest 里一个组件都没有', `  数到 0 条 data —— 生成脚本改坏了，还是产物被截断了？`);
}
const outOfScope = widgetData
  .filter((u) => typeof u === 'string')
  .map((u) => ({ given: u, path: resolveAgainstManifest(u) }))
  .filter(({ path }) => !path.startsWith(widgetDir));
if (outOfScope.length > 0) {
  fail(
    `${String(outOfScope.length)} 个组件数据 URL 落在 SW 拦不到的前缀里`,
    [
      `  SW 的前缀（由 ${MOUNT}sw.js 反推）：${widgetDir}`,
      ...outOfScope.map((f) => `    ${f.given} → 实际 ${f.path}`),
      '',
      '  后果是静默不拦：组件永远吃 manifest 里那份静态占位态，' +
        '而"应用不在也能由 SW 决定显示什么"这条判定点整个失效。',
    ].join('\n'),
  );
}

console.log(
  `✅ 产物自洽：挂载 ${MOUNT} 与产物声明一致；` +
    `index.html 的 ${String(allRefs.length)} 个本地引用、manifest 的 ${String(manifestFiles.length)} 个文件全部存在；` +
    `${String(widgetData.length)} 个组件数据 URL 都落在 SW 前缀 ${widgetDir} 内`,
);
