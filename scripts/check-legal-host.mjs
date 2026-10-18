/**
 * 条款链接的**主机名事实源**对账
 * ==============================
 *
 * 钉的是一件很具体、又很不显眼的事：`@heyta/app-host` 在运行时判断
 * "用户连的这台服务端是不是 heyta 官方托管实例"，靠的是一份**写死的域名**
 * （`OFFICIAL_SITE_ORIGIN`），而域名的权威在 `@heyta/legal` 的 `OPERATOR.hostedDomain`。
 *
 * 为什么两边不能直接 import：`@heyta/legal` 是九份对外文本的全量 AST（六千余行），
 * 移动端 bundle 只为读一个域名把它整个拖进来是纯粹的负担。
 * 所以这里用仓库既有的取向：**三份拷贝 + 一道会红的对账**。
 *
 * | 拷贝 | 谁在用 | 判错会怎样 |
 * |---|---|---|
 * | `@heyta/legal` 的 `OPERATOR.hostedDomain` | 真源（条款文本里印的那个域名） | —— |
 * | `app-host` 的 `OFFICIAL_SITE_ORIGIN` | 客户端决定"勾选框旁边那个链接点开落到哪" | 官方实例被判成第三方 ⇒ 链接落到 `<baseUrl>/privacy.html`，生产没配 `PRIVACY_*` ⇒ 404 |
 * | `server/src/legal.generated.ts` 的 `OFFICIAL_HOSTED_DOMAIN` | 服务端决定"这条同意记录能不能写上 heyta 的版本号" | 🔴 更糟的一类：写进**数据库**的一句假话（给运营者自己的文本盖上了 heyta 的版本，三年后它会被当成证据读） |
 *
 * 🔴 **第三份为什么必须进来，即使 `check:server-legal` 已经对过它**：那条门禁对的是
 * "生成物 = `@heyta/legal` 的当前产物"，它**永远看不到 app-host 那份**。
 * 也就是说客户端与服务端在这件事上**各认各的**时，两条门禁会**同时绿** ——
 * 而那时会出现"用户点开的是 A 的文本、留痕里写的是 B 的版本"，
 * 这正是同意留痕唯一要防的失效。只有这道三方对账能抓住它。
 *
 * 判错的代价不对称，两边都要写出来：
 *   - 漂移成"app-host 还指着旧域名" ⇒ 官方实例被判成第三方，链接落到
 *     `<baseUrl>/privacy.html`，而生产没配 `PRIVACY_*` ⇒ 用户点开 404；
 *   - 漂移成"legal 改了、app-host 没改" 的反方向 ⇒ 新域名被判成第三方，同上。
 *
 * ⚠️ 它**只**对账主机名。`site.docs.account.s4` 那一节的句子、`privacy.ts` 里
 * 提到托管域的地方各是散文，由 `pnpm check:legal-copy` 与中英对账管，不归这条。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

/**
 * 从源码里抠出一个字符串的值。
 *
 * 三种形状都要认：`export const NAME = '…'`（app-host 那份）、
 * 对象属性 `name: '…'`（`OPERATOR` 里那份）、
 * `export const NAME = "…"`（服务端那份**生成物**，`JSON.stringify` 出来的双引号）。
 * 不做完整 TS 解析 —— 这条对账只认这几个**已经写死**的形状，形状变了它会报"找不到常量"而不是悄悄通过。
 */
function stringConstant(file, name) {
  const src = readFileSync(`${ROOT}/${file}`, 'utf8');
  const match = new RegExp(`${name}\\s*(?::|=)\\s*('([^']*)'|"([^"]*)")`).exec(src);
  if (match === null) throw new Error(`在 ${file} 里找不到字符串常量/属性 ${name}`);
  return match[2] ?? match[3];
}

const legalHost = stringConstant('packages/legal/src/index.ts', 'hostedDomain');
const appHostOrigin = stringConstant('packages/app-host/src/legal-links.ts', 'OFFICIAL_SITE_ORIGIN');
const serverHost = stringConstant('server/src/legal.generated.ts', 'OFFICIAL_HOSTED_DOMAIN');

const problems = [];

// 1) 域名本体必须一致 —— app-host 那份是 `https://` + legal 那一份。
if (!appHostOrigin.startsWith('https://')) {
  problems.push(`OFFICIAL_SITE_ORIGIN 必须是 https 来源：${appHostOrigin}`);
}
if (`https://${legalHost}` !== appHostOrigin) {
  problems.push(
    `官方托管域名漂移：@heyta/legal 说 ${legalHost}，` +
      `而 app-host 的条款链接分流认的是 ${appHostOrigin}`,
  );
}

// 1b) 🔴 服务端那份必须与客户端那份**逐字相同**。
// 不一致时两条单点门禁都会绿（`check:server-legal` 只对生成物 ↔ @heyta/legal，
// 而 app-host 根本不在它的视野里）—— 只有这道三方对账能抓到"读的是 A、记的是 B"。
if (serverHost !== legalHost) {
  problems.push(
    `官方托管域名三方漂移：@heyta/legal 说 ${legalHost}，` +
      `而 server/src/legal.generated.ts 认的是 ${serverHost} —— ` +
      '会出现"用户点开的文本"与"同意留痕里写下的版本"指向两套东西。' +
      '修复：node server/scripts/gen-server-legal.mjs',
  );
}

// 2) 落地页那两条路径必须真的注册过（注册表是站点结构的唯一来源，ADR-0033）。

// 3) 🔴 **落地页自己的部署地址常量也必须一致**（2026-10-16 加）。
//
// `apps/landing/src/site/origin.ts` 的 `DEFAULT_SITE_ORIGIN` 是**第七处**（算上下面那个工具就是第八处）
// 写死这个域名的地方，而它决定的是落地页**自我声明**的绝对地址（canonical / hreflang / sitemap），
// 以及 `check:entries` 逐字节比对的基准。它的文件头写着"换域名时**两件事**必须一起做"——
// 而实测这个事实住在**六处**，那句"两件事"漏了另外四处（其中就有它自己）。
const landingOriginFile = 'apps/landing/src/site/origin.ts';
const landingOrigin = /DEFAULT_SITE_ORIGIN\s*=\s*'([^']+)'/.exec(
  readFileSync(`${ROOT}/${landingOriginFile}`, 'utf8'),
);
if (landingOrigin === null) {
  problems.push(`${landingOriginFile} 里读不到 DEFAULT_SITE_ORIGIN —— 形状变了，这条对账正在空转`);
} else if (landingOrigin[1] !== `https://${legalHost}`) {
  problems.push(
    `落地页自我声明的地址与官方域名不一致：${landingOriginFile} 说 ${landingOrigin[1]}，` +
      `而官方域名是 https://${legalHost} —— ` +
      'canonical / sitemap / 入口生成物会一起声明一个不是官方的地址。',
  );
}

// 4) 发布工具里那个默认域名（`HEYTA_SITE_DOMAIN` 的兜底）也不能漂 ——
//    它决定**往哪台机器发布**，漂了就是把站点发到别处。
const publishToolFile = 'research/tools/publish-public-sites.mjs';
const publishDefault = /HEYTA_SITE_DOMAIN\s*\|\|\s*'([^']+)'/.exec(
  readFileSync(`${ROOT}/${publishToolFile}`, 'utf8'),
);
if (publishDefault === null) {
  problems.push(`${publishToolFile} 里读不到 HEYTA_SITE_DOMAIN 的兜底值 —— 形状变了，这条对账正在空转`);
} else if (publishDefault[1] !== legalHost) {
  problems.push(
    `发布工具的兜底域名与官方域名不一致：${publishToolFile} 说 ${publishDefault[1]}，` +
      `而官方域名是 ${legalHost} —— 不带参数发布会发到另一个主机。`,
  );
}

// 2) 🔴 **官方域名必须也出现在两份"托管端点主机白名单"里**（2026-10-16 加）。
//
// "官方域名"这个事实在这套代码里**有五份拷贝**：@heyta/legal 的 `hostedDomain`、
// app-host 的 `OFFICIAL_SITE_ORIGIN`、服务端生成物 `OFFICIAL_HOSTED_DOMAIN`，
// 以及两份**托管 AI 端点白名单**（`MANAGED_MODEL_HOSTS` / `SERVER_MANAGED_MODEL_HOSTS`）。
//
// 上面 1)/1b) 连的是前三条；`managed-upstream-drift.spec.ts` 连的是后两条。
// 🔴 **但"前三条 ↔ 后两条"之间那条线**此前**没有任何判据** ——
// 于是域名一旦变更，可能只改了法务那三条，而两份 AI 白名单**继续指着旧域名**为"我们自己的服务器"
// （那两行带着 `jurisdiction: 'cn'` 与"heyta 自建"的定性）。
// 后果不是死链，而是**数据出境定性对着一个不再属于我们的主机名**——
// 与 1b) 那句"读的是 A、记的是 B"是同一条错误，只不过这次错在 AI 那条线上。
for (const [file, name] of [
  ['packages/ai/src/managed-endpoints.ts', 'MANAGED_MODEL_HOSTS'],
  ['server/src/ai/managed-upstream.ts', 'SERVER_MANAGED_MODEL_HOSTS'],
]) {
  const src = readFileSync(`${ROOT}/${file}`, 'utf8');
  const hosts = [...src.matchAll(/^\s*host:\s*'([^']+)'/gm)].map((m) => m[1]);
  if (hosts.length === 0) {
    problems.push(
      `${file} 里读不到任何 \`host: '…'\` —— 白名单换了形状，这条对账正在空转（判据 ${name}）`,
    );
    continue;
  }
  if (!hosts.includes(legalHost)) {
    problems.push(
      `托管 AI 端点白名单里没有官方域名：${file} 的 ${name} 是 [${hosts.join(', ')}]，` +
        `而不含 ${legalHost} —— 法务那三条改了、这条没跟上（或者反过来）。` +
        '⚠️ 那两行带着 `jurisdiction` 与"自建"的定性，指错主机名等于对着一个不再属于我们的域名做出境定性。',
    );
  }
}

const pages = readFileSync(`${ROOT}/apps/landing/src/site/pages.ts`, 'utf8');
for (const path of ['/legal/terms', '/legal/privacy']) {
  if (!pages.includes(`path: '${path}',`)) {
    problems.push(`落地页注册表里没有 ${path} —— 条款链接会指向一个不存在的页面`);
  }
}

// 3) 服务端给运营者留的那两条路径名必须还是这两个（改了客户端就要跟着改）。
const server = readFileSync(`${ROOT}/server/src/server.ts`, 'utf8');
for (const file of ['terms.html', 'privacy.html']) {
  if (!server.includes(file)) {
    problems.push(`服务端不再有 ${file} 这条对外路径 —— OPERATOR_LEGAL_PATHS 要跟着改`);
  }
}

if (problems.length > 0) {
  console.error(`❌ 条款链接的主机名事实源对账失败：`);
  for (const p of problems) console.error(`   · ${p}`);
  process.exit(1);
}

console.log(
  `✅ 官方托管域名三方对账一致（并已连上两份托管 AI 端点白名单）：${legalHost} ↔ ${appHostOrigin} ↔ ${serverHost}` +
    '（+ 落地页与服务端四条路径都在）',
);
