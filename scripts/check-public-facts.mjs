#!/usr/bin/env node
/**
 * 公共事实下行对账（倒数纪念日批次二 W4b —— ADR-0052 §4 第 2 条点名的那条门禁）
 * =====================================================================
 *
 * ## 为什么必须有这一条
 *
 * ADR-0052 把 `GET /api/holiday-adjustments` 定性成 heyta **第一条匿名只读的
 * 服务端→客户端内容通道**，并把整条定性押在它自称"可判"的那条边界上：
 *
 * > 🔴 路径与查询串里不许出现 `:id` / `?userId=` / 按清单按地区分流的形态。
 * > 一旦"按用户下发不同的公共事实"成为可能，它就从公共事实变成了用户画像，
 * > 本 ADR 的定性当场作废。
 *
 * 而"服务端会不会再悄悄开一条匿名下行"这件事**当时没有任何一层在守** ——
 * 契约里的 `PUBLIC_FACT_SHAPES` 是一份没人读的数据。ADR-0052 §4 第 2 条自己登记了
 * 这笔欠账（"落点 `scripts/check-public-facts.mjs`，该脚本此刻不存在"）。本文件兑现它。
 *
 * ## 判据（五条，各自能红）
 *
 * 1. **形状登记表是封闭集**：`PUBLIC_FACT_SHAPES` 每一条都要在
 *    `REVIEWED_PUBLIC_FACT_CHANNELS` 里有登记，**反向也要相等**。加一种公共事实 ⇒ 红。
 *    加一条的成本是刻意的 —— 与 AGENTS §3.2 许可证白名单同一个设计：它逼人为这个
 *    形状做一次真判断，而不是让它悄悄长出来。
 * 2. **逐字形状**：`root` / `year` / `day` 三层键与登记**集合相等**。多一个键 = 悄悄
 *    扩大对外下发的内容；少一个键 = 契约变了而依据没变。
 * 3. **匿名面不许带身份维度**：路径里出现 `:id` / `userId` / `clientId` / `listId` /
 *    `projectId` / `deviceId` / `email` / `token` / `?` ⇒ 红。
 * 4. 🔴 **反向枚举（牙齿在这条）**：扫 `server/src` 全部路由声明，每条 `GET` 在它自己的
 *    作用域里**找不到认证证据**（插件级 `addHook('preHandler', …)`，或该条路由自己的
 *    选项对象里有 `preHandler`），就必须落在第 1 条的公共事实集或
 *    `REVIEWED_ANONYMOUS_GET` 里。⇒ **新开一条匿名 GET 而不登记，这里必红**，而登记
 *    必须先读过那条路由的实现。
 * 5. **公共事实不许被改成需要登录**：登记过的那条路径如果挂上认证 ⇒ 红。它一旦按身份
 *    给不同答案，ADR-0052 的定性就不成立 —— 而这种改变不能悄悄发生。
 *
 * ## 三条实现上的坑（本轮实测，不是假想）
 *
 * - **路由有两处真源**：声明在各 `*.routes.ts`，**前缀在 `server.ts` 的
 *   `register(plugin, { prefix })`**。只数其一会把整片路由拼成错误路径。而一份文件可以
 *   导出**好几个**插件（各自前缀不同）⇒ 前缀必须按"这条路由住在谁的函数体里"现取，
 *   不能取文件里的第一个。
 * - **路径是模板串**：`/${HOLIDAY_ADJUSTMENT_PATHS.public}`。现值从**构建产物**
 *   `@heyta/shared-schema` 取（从源码正则抠 = 第二套解析规则）。取不到就把那条路由判为
 *   "没被判定"并响亮失败 —— 静默跳过等于给判据 4 留一个漏口的口子。
 * - **认证证据不止一种写法**：路由级 `preHandler: authenticate`、插件级
 *   `addHook('preHandler', authenticate)`（覆盖整份文件）、`addHook('preHandler',
 *   requireAdmin)`、`addHook('preHandler', createEntitlementGuard())`。词表漏一种 ⇒ 假红；
 *   宽到把非认证也算成证据 ⇒ 假绿。所以判据 4 **把匿名清单打印出来**，让人对着看。
 *
 * ## 变异臂（八条，逐臂跑过才允许声称"有牙"；读数落在提交信息里）
 *
 * M1 契约加第二种形状 ⇒ 判据 1 红 · M2 摘掉登记表里那条 id ⇒ 判据 1 反向红
 * M3 契约 `day` 层加一个键 ⇒ 判据 2 红 · M4 公开路径改 `holiday-adjustments/:userId` ⇒ 判据 3 红
 * M5 加一条无认证的 `fastify.get('/probe')` ⇒ 判据 4 红 · M6 给公共事实挂 authenticate ⇒ 判据 5 红
 * M7 让路径常量解不开 ⇒ "未判定"那臂红 · M8 清空 REVIEWED_ANONYMOUS_GET ⇒ 判据 4 红
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

/**
 * 这一行是不是注释（行首是 `//`、`*`、`/*`，或匹配位置之前已经出现了 `//`）。
 *
 * 🔴 这条过滤是判据 4 的**假绿来源**，不是防御性美化：首跑实测 `server.ts` 里唯一的
 * `addHook('preHandler', requireAdmin)` 出现在**一句注释的括号里**（讲的是 admin.routes.ts
 * 的闸门放在哪），于是整份 `server.ts` 被判成"有认证证据"，把真匿名的
 * `fastifyServer.get('/health')` 吞掉了 —— 而"匿名面只剩公共事实那一条"这个结论
 * 恰好就是这条门禁要说的话。**注释让门禁说出了假话，而且方向是假绿。**
 */
function isComment(text, index) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const before = text.slice(lineStart, index);
  return /^\s*(?:\/\/|\*|\/\*)/.test(before) || before.includes('//');
}

/** 从**构建产物**取契约现值。 */
const schema = require(join(ROOT, 'packages/shared-schema/dist/index.js'));

/** 契约里的公共事实登记表：判据 1/2/3 的检查对象，也是判据 4 的合法集。 */
const publicFactEntries = new Map(
  (schema.PUBLIC_FACT_SHAPES ?? []).map((entry) => [entry.id, entry]),
);

const problems = [];
const fail = (rule, msg) => problems.push({ rule, msg });

/**
 * 已逐条审过的公共事实通道。键 = 契约里的 `id`。每条都要回答 ADR-0052 §2 那三件事：
 * 它不是任何人的数据、服务端读得写得出、事实源本来就在设备之外。
 */
const REVIEWED_PUBLIC_FACT_CHANNELS = {
  'holiday-adjustments':
    '调休/补班公告：国务院让哪天上班、哪天放假。不是任何人的数据，服务端完全读得写得出，事实源本来就在设备之外（ADR-0052 §2）。',
};

/** 与判据 1 同一批审过的逐字形状。改这里之前先想清楚：这些键是对外承诺的一部分。 */
const REVIEWED_SHAPE_KEYS = {
  'holiday-adjustments': {
    root: ['version', 'years'],
    year: ['year', 'papers', 'days'],
    day: ['day', 'isOffDay'],
  },
};

/**
 * 已逐条读过实现并审过的**其它**匿名 GET。键 = 完整路径（含 `server.ts` 给的前缀）。
 *
 * ⚠️ 这张表是判据 4 的唯一出口，所以每一行都必须是一次**读过的结论**：加之前打开那条
 * 路由，确认它回的东西与身份无关，再把确认写进理由。留空不代表"没有别的匿名 GET"，
 * 代表"还没有人为它们做过这个判断"。
 */
const REVIEWED_ANONYMOUS_GET = {
  // 两条都是读实现后的结论（`server.ts:467` 与 `server.ts:489`）：
  '/health':
    '存活探针：跑一次 `SELECT 1` 后回 {status, db, wsConnections}。连接数是**运维量**不是身份维度 —— 它按人给不出不同答案，所以不构成用户画像。',
  '/live': '就绪探针：常量 `{status:"ok"}`，刻意不碰依赖（见它上面那段注释：数据库挂了重启进程只会更糟）。',
};

/** 判据 3 的词表：命中即说明这条下行开始按身份给不同答案。 */
const IDENTITY_TOKENS = [
  ':id',
  'userId',
  'user_id',
  'clientId',
  'client_id',
  'listId',
  'list_id',
  'projectId',
  'project_id',
  'deviceId',
  'device_id',
  'email',
  'token',
  '?',
];

/** 算"认证证据"的词表（宁窄勿宽：窄了是假红，会被打印出来发现；宽了是假绿）。 */
const AUTH_EVIDENCE_RE = /\b(authenticate|requireAdmin|createEntitlementGuard|EntitlementGuard)\b/;

/**
 * 路由声明。🔴 接收者**不许用白名单**：首跑就是靠 `fastify|app|server` 三个字面名去匹配，
 * 于是 `server.ts:467` 的 `fastifyServer.get('/health', …)` **整条没被枚举** ——
 * 而 `/health` 是真匿名面，"匿名 GET 只有 1 条"那个读数因此是假的。
 * 改成认"任何接收者 + 首参是以 `/` 开头的字符串字面量"：实测 `server/src` 里
 * 非路径形状的 `.get('…')` 命中 **0 条**（Map/headers 那类都不会被误当路由）。
 */
const ROUTE_RE = /[A-Za-z_$][\w$]*\.(get|post|put|delete|patch|head|options)\(\s*([`'"])(\/[^`'"]*)\2/g;
const FILE_HOOK_RE = /addHook\(\s*['"]preHandler['"]\s*,\s*([^)]*)\)/g;
const PLUGIN_RE = /export const ([A-Za-z_]\w*Routes)\s*=\s*async/g;

/** 路径参数的下一个 `{…}` 就是 fastify 的选项对象；扫平衡括号取它。 */
function optionsObjectAfter(text, from) {
  let i = from;
  while (i < text.length && /[\s,]/.test(text[i])) i += 1;
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(i, j + 1);
    }
  }
  return null;
}

const sourceFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (entry.endsWith('.ts')) sourceFiles.push(p);
  }
})(join(ROOT, 'server/src'));

/** 前缀的真源。 */
const serverTs = readFileSync(join(ROOT, 'server/src/server.ts'), 'utf8');
const prefixByPlugin = new Map();
for (const m of serverTs.matchAll(/register\(\s*([A-Za-z_][\w]*)\s*,\s*\{([\s\S]*?)\}/g)) {
  const pm = /prefix:\s*['"]([^'"]*)['"]/.exec(m[2]);
  prefixByPlugin.set(m[1], pm ? pm[1] : '');
}

const anonymousGets = [];
const unresolved = [];
const unregisteredPlugins = [];
let getRoutesSeen = 0;

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');

  const fileGuarded = [...text.matchAll(FILE_HOOK_RE)]
    .filter((m) => !isComment(text, m.index))
    .some((m) => AUTH_EVIDENCE_RE.test(m[1]));

  const plugins = [...text.matchAll(PLUGIN_RE)]
    .filter((m) => !isComment(text, m.index))
    .map((m) => ({ name: m[1], start: m.index }));
  for (const p of plugins) {
    if (!prefixByPlugin.has(p.name)) unregisteredPlugins.push(`${relative(ROOT, file)} → ${p.name}`);
  }

  for (const rm of text.matchAll(ROUTE_RE)) {
    if (isComment(text, rm.index)) continue; // 注释里举的路由例子不是路由
    if (rm[1].toLowerCase() !== 'get') continue;
    getRoutesSeen += 1;

    // 前缀按"这条路由住在哪个插件的函数体里"现取。
    let owner = null;
    for (const p of plugins) if (p.start < rm.index && (!owner || p.start > owner.start)) owner = p;
    const prefix = owner && prefixByPlugin.has(owner.name) ? prefixByPlugin.get(owner.name) : '';

    let path = rm[3].replace(/\$\{([\w.]+)\}/g, (whole, expr) => {
      let cur = schema;
      for (const part of expr.split('.')) {
        if (cur == null || !(part in cur)) return `«${expr}»`;
        cur = cur[part];
      }
      return typeof cur === 'string' ? cur : `«${expr}»`;
    });
    if (path.includes('«')) {
      unresolved.push(`${relative(ROOT, file)} → GET ${path}`);
      continue;
    }
    if (!path.startsWith('/')) path = `/${path}`;
    const fullPath = `${prefix}${path}`.replace(/\/{2,}/g, '/');

    const opts = optionsObjectAfter(text, rm.index + rm[0].length);
    const routeGuarded = !!opts && /\bpreHandler\b/.test(opts);

    if (fileGuarded || routeGuarded) {
      for (const [id, entry] of publicFactEntries) {
        if (fullPath === entry.path) {
          fail(5, `公共事实 ${id} 的下行 ${entry.path} 现在带认证证据（${relative(ROOT, file)}）—— 它一旦按身份下发就不再是公共事实：要么改回匿名，要么另写一份 ADR`);
        }
      }
      continue;
    }

    anonymousGets.push({ path: fullPath, file: relative(ROOT, file) });
  }
}

// ── 判据 1：封闭集（双向）──────────────────────────────────────────
for (const [id] of publicFactEntries) {
  if (!(id in REVIEWED_PUBLIC_FACT_CHANNELS)) {
    fail(1, `公共事实形状 \`${id}\` 没在本文件 REVIEWED_PUBLIC_FACT_CHANNELS 里登记 —— 新一种公共事实要先过 ADR-0052 §2 那三条，再在这里写明它为什么不是任何人的数据`);
  }
}
for (const id of Object.keys(REVIEWED_PUBLIC_FACT_CHANNELS)) {
  if (!publicFactEntries.has(id)) {
    fail(1, `REVIEWED_PUBLIC_FACT_CHANNELS 里还登记着 \`${id}\`，契约里已经没有这一种 —— 删掉这条登记，别留一份没人认领的对外依据`);
  }
}

// ── 判据 2：三层键集合相等 ────────────────────────────────────────
for (const [id, entry] of publicFactEntries) {
  const reviewed = REVIEWED_SHAPE_KEYS[id];
  if (!reviewed) continue;
  for (const level of ['root', 'year', 'day']) {
    const keys = entry.keys?.[level];
    if (!Array.isArray(keys)) {
      fail(2, `公共事实 ${id} 的 keys.${level} 不是数组 —— 形状无从对账`);
      continue;
    }
    const actual = [...keys].sort().join(',');
    const registered = [...reviewed[level]].sort().join(',');
    if (actual !== registered) {
      fail(2, `公共事实 ${id} 的 ${level} 层键与登记不一致：契约=[${actual}] 登记=[${registered}] —— 对外下发的内容变了而依据没变（或反过来）`);
    }
  }
}

// ── 判据 3：匿名面不许有身份维度 ──────────────────────────────────
for (const [id, entry] of publicFactEntries) {
  const hits = IDENTITY_TOKENS.filter((t) => entry.path.includes(t));
  if (hits.length) {
    fail(3, `公共事实 ${id} 的路径 ${entry.path} 含身份维度 ${hits.join(' / ')} —— ADR-0052 §2.1 那条"唯一可判的边界"就是它，命中即定性作废`);
  }
}

// ── 判据 4：每条匿名 GET 都要有人认领 ─────────────────────────────
const publicPaths = new Set([...publicFactEntries.values()].map((e) => e.path));
for (const { path, file } of anonymousGets) {
  if (publicPaths.has(path)) continue;
  if (path in REVIEWED_ANONYMOUS_GET) continue;
  fail(4, `${file} 的 GET ${path} 找不到认证证据，也不在任何登记面上 —— 这是新一条匿名下行。要么挂认证，要么读过实现之后在 REVIEWED_ANONYMOUS_GET 写一句它为什么可以匿名`);
}

// ── 探针自检：分母、解不开、没注册 ────────────────────────────────
if (unresolved.length) {
  fail(4, `${unresolved.length} 条 GET 的路径里有从契约取不到现值的常量，**这些路由没有被判定**：\n     ${unresolved.join('\n     ')}`);
}
if (unregisteredPlugins.length) {
  fail(4, `${unregisteredPlugins.length} 个路由插件在 server.ts 里找不到 register(…) —— 它们的前缀是猜的：\n     ${unregisteredPlugins.join('\n     ')}`);
}
if (getRoutesSeen === 0) {
  fail(4, '在 server/src 里枚举到 0 条 GET 路由 —— 那是探针坏了，不是"服务端没有匿名面"（AGENTS §7 元规则 1）');
}

if (problems.length) {
  console.error(`❌ 公共事实下行对账失败：${problems.length} 处`);
  for (const p of problems) console.error(`  [判据${p.rule}] ${p.msg}`);
  console.error(`   本轮：GET 路由 ${getRoutesSeen} 条，其中匿名 ${anonymousGets.length} 条 → ${anonymousGets.map((a) => a.path).sort().join(' ') || '无'}`);
  process.exit(1);
}

console.log(
  `✅ 公共事实下行对账通过：GET 路由 ${getRoutesSeen} 条；形状登记表 ${publicFactEntries.size} 条（三层键逐字对过）；` +
    `匿名 GET ${anonymousGets.length} 条全部有认领（公共事实 ${publicPaths.size} + 已审 ${Object.keys(REVIEWED_ANONYMOUS_GET).length}）；` +
    `解不开的路径 0 条、找不到注册处的插件 0 个`,
);
console.log(`   匿名 GET 清单：${anonymousGets.map((a) => a.path).sort().join(' ')}`);
