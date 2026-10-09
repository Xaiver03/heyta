#!/usr/bin/env node
/**
 * 抬 `tokenVersion` 的每一条路都必须**同时**关掉实时通道（常驻门禁，纯读盘，不占设备）。
 *
 * ## 为什么要有这条
 *
 * `websocket-connection.service.ts` 的 `closeForUser` 上写着它自己的理由：
 * "sockets are authenticated **only at upgrade** and kept alive by the heartbeat, so without
 * this a revoked device would keep receiving op notifications indefinitely"。
 * 也就是说 `tokenVersion++` 管得住的是**下一次的 HTTP 请求**，管不住**已经开着的那个页面**。
 *
 * 这一条本轮之前不是假设：仓库里 8 处代码级 bump 分成两类，而两类的处理不一致 ——
 * `POST /api/replace-token`、后台强制登出、passkey 恢复、`/revoke-all` 都补了通道那一半；
 * **改密、重置口令、换绑邮箱生效**三条只写了计数器。那三条恰好是用户口中的"把别人踢下线"，
 * 而 `auth.ts` 里 `TOKEN_REVOKED` 的注释自己就把它们列为撤销事件。
 * 漏掉的那一半**没有任何一层会报错**：库里那格 +1、日志写着"all sessions revoked"、
 * 界面上"登录设备"也不谎（`listSessions` 按版本过滤），只有那个旧页面还在实时收别人的 op。
 *
 * ## 判据（四条，逐条可失败）
 *
 *  ① 每一处**代码级**（剥掉注释后）的 `tokenVersion: { increment: … }` 所在文件，必须出现
 *     `closeForUser(` 或 `revokeAllDeviceSessions(` 之一。豁免要写进 `EXEMPT` 登记表，
 *     而且**带上期望的 bump 处数** —— 登记一枚"文件"却不管"这个文件里又多了一处"，
 *     豁免就会变成漏点的口子（计数漂移即红）。
 *  ② `revokeAllSessions(`（只删行、不关通道）只许住在 `access-sessions.ts` 里，
 *     外部一律用 `revokeAllDeviceSessions`。钉的是**两半不许分开写**：这一族的漏法
 *     从来不是"忘了有个函数"，是"抄了上半没抄下半"。
 *  ③ **阳性对照**：射程里必须真的读到 `.ts` 文件、且真的数出过 bump。一处都数不到就
 *     `exit 2` 报探针，而不是报"全部合规"（AGENTS §7 元规则 2）。
 *  ④ `SUMMARY` 打印三个计数，让读数可以被逐条核对而不是"绿了就完事"。
 *
 * ⚠️ **口径边界（写清，不假装覆盖）**：这一枚只认 `tokenVersion: { increment }` 这一种写形状。
 * 实测仓库里现在只有这一种（`grep -rn 'token_version' server/src` 数到的裸 SQL 全是 SELECT /
 * 比较，没有 UPDATE），而 `select: { tokenVersion: true }` 那一类是**读**，不是写。
 * 将来有人写 `data: { tokenVersion: 5 }`（直接赋值），本门禁看不见 —— 那需要形状分析，
 * 登记在 `docs/plans/account-standard-suite.md` 的边界那一节。
 *
 * ⚠️ 与 `check-token-minting.mjs` 同一个有意的取舍：剥注释时不跟踪字符串。
 * 代价是字符串里写着 `tokenVersion: { increment` 会被数成一处（**假红**）；
 * 换来的是不会因为一个引号就把后面的代码当字符串吞掉（**假绿**）。门禁一律选假红那侧。
 *
 * `--self-test` 用夹具逐臂证明每条真会红、假缺陷真不红（臂数由它自己打印，文档里不许抄）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { listTsFiles, stripTsComments } from './lib/strip-ts-comments.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag >= 0 && process.argv[rootFlag + 1] ? resolve(process.argv[rootFlag + 1]) : process.cwd();
const SELF = 'scripts/check-session-revocation.mjs';
const SRC_DIR = 'server/src';
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'Pods',
  'DerivedData',
  'vendor',
]);

/** 唯一的"抬全设备计数器"写形状（口径边界见文件头）。 */
const BUMP = /tokenVersion:\s*\{\s*increment\s*:/g;
/** 通道那一半：直接关，或用把两半绑在一起的助手。 */
const CLOSE = /(?:closeForUser|revokeAllDeviceSessions)\s*\(/;
/** 只删行的那半 —— 只许住在助手里。 */
const NARROW = /revokeAllSessions\s*\(/g;
const HELPER_FILE = 'server/src/account/access-sessions.ts';

/**
 * 登记表：文件 → **期望的**代码级 bump 处数 + 为什么这里可以不带通道那一半。
 * 计数一漂移就红，所以这张表挡得住"往豁免文件里再塞一处"。
 */
const EXEMPT = new Map([
  [
    'server/src/auth.ts',
    {
      count: 2,
      why:
        '两处都在专用助手里（`revokeAllTokens` / `replaceToken`）。通道那一半刻意留给调用方的路由，' +
        '因为这两个助手本身不知道也不该知道"这次是不是当前设备自己发起的"。' +
        '实测调用方：`/revoke-all`、后台强制登出、`sync.routes` 的设备撤销、`/api/replace-token` 各自都关。',
    },
  ],
]);

function scan(root) {
  const files = listTsFiles(root, SRC_DIR, SKIP_DIRS);
  const out = { probe: null, violations: [], fileCount: files.length, bumpCount: 0, exemptHits: 0 };
  if (files.length === 0) {
    out.probe = `探针：${join(root, SRC_DIR)} 里一个 .ts 都没读到 —— 射程为空，不能报"全部合规"`;
    return out;
  }

  const perFile = [];
  for (const { abs, rel } of files) {
    let source;
    try {
      source = readFileSync(abs, 'utf8');
    } catch (err) {
      out.probe = `探针：读不到 ${rel}（${err instanceof Error ? err.message : 'unknown'}）`;
      return out;
    }
    const code = stripTsComments(source);
    const bumps = (code.match(BUMP) ?? []).length;
    const narrow = (code.match(NARROW) ?? []).length;
    perFile.push({ rel, bumps, narrow, closes: CLOSE.test(code) });
  }

  out.bumpCount = perFile.reduce((n, f) => n + f.bumps, 0);
  if (out.bumpCount === 0) {
    out.probe = `探针：读了 ${String(files.length)} 个文件却一处 bump 都没数到 —— 判据的形状已经和现实脱节`;
    return out;
  }

  for (const f of perFile) {
    if (f.bumps > 0) {
      const exemption = EXEMPT.get(f.rel);
      if (exemption) {
        out.exemptHits += 1;
        if (exemption.count !== f.bumps) {
          out.violations.push(
            `${f.rel}：登记的是 ${String(exemption.count)} 处 bump，现数到 ${String(f.bumps)} 处 —— 豁免跟着代码漂了。` +
              `理由原文：${exemption.why}`,
          );
        }
        continue;
      }
      if (!f.closes) {
        out.violations.push(
          `${f.rel}：抬了 ${String(f.bumps)} 次 ` +
            '`tokenVersion` 却没有关实时通道（既没有 `closeForUser(` 也没有 `revokeAllDeviceSessions(`）—— ' +
            '旧设备那个已经开着的页面会继续收 op 通知。要豁免就进 `EXEMPT` 并写明理由与该文件的期望计数。',
        );
      }
    }
    if (f.narrow > 0 && f.rel !== HELPER_FILE) {
      out.violations.push(
        `${f.rel}：直接调了 ` +
          `\`revokeAllSessions(\`（只删会话行、不关通道）。全设备登出请用 \`revokeAllDeviceSessions\` —— ` +
          '这一族的漏法从来不是"忘了有个函数"，是"抄了上半没抄下半"。',
      );
    }
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  const dir = join(process.cwd(), 'tmp/session-revocation-selftest');
  const BUMP_OK =
    "import { getWsConnectionService } from './sync/services/websocket-connection.service';\nexport const reset = async (id: number): Promise<void> => {\n  await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });\n  getWsConnectionService().closeForUser(id);\n};\n";
  const CLEAN = "export const helper = (a: number): number => a + 1;\n// 这里不许再写第二份计数器抬法。\n";

  const fixtures = [
    {
      name: '臂 A 抬了计数器却没关通道 ⇒ 红，理由是"没有关实时通道"',
      files: {
        'server/src/password/recovery.ts':
          "export const reset = async (id: number): Promise<void> => {\n  await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });\n};\n",
        'server/src/other.ts': BUMP_OK,
      },
      wantRed: true,
      want: '没有关实时通道',
    },
    {
      name: '臂 B 通道那一半用助手做 ⇒ 绿，且 SUMMARY 必须写 bump=2',
      files: {
        'server/src/account/email-change.ts':
          "import { revokeAllDeviceSessions } from './access-sessions';\nexport const apply = async (id: number): Promise<void> => {\n  await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });\n  await revokeAllDeviceSessions(id);\n};\n",
        'server/src/other.ts': BUMP_OK,
      },
      wantRed: false,
      want: 'bump=2',
    },
    {
      name: '臂 C 注释里写着 bump ⇒ 不算一处（否则门禁红在文档上，就会被人关掉）',
      files: {
        // 只有 notes.ts 提到那个形状（在注释里），另一处真 bump 带通道 ⇒ 总数必须是 1。
        'server/src/notes.ts':
          "export const x = 1;\n// 这一行原来是 `tokenVersion: { increment: 1 }` 的 user.update —— 已改。\n/* 块注释里的 tokenVersion: { increment: 1 } 也不算 */\nexport const y = x + 1;\n",
        'server/src/other.ts': BUMP_OK,
      },
      wantRed: false,
      want: 'bump=1',
    },
    {
      name: '臂 D 豁免文件里多塞一处 bump ⇒ 红，理由是"豁免跟着代码漂了"',
      files: {
        'server/src/auth.ts':
          "export const revokeAllTokens = async (id: number): Promise<void> => {\n  await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });\n};\nexport const replaceToken = async (id: number): Promise<string> => {\n  await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });\n  return 'x';\n};\nexport const extra = async (id: number): Promise<void> => {\n  await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });\n};\n",
        'server/src/other.ts': BUMP_OK,
      },
      wantRed: true,
      want: '豁免跟着代码漂了',
    },
    {
      name: '臂 E 在助手外面只删行 ⇒ 红，理由是"抄了上半没抄下半"',
      files: {
        'server/src/admin/admin.routes.ts':
          "import { revokeAllSessions } from '../account/access-sessions';\nexport const kick = async (id: number): Promise<void> => {\n  await revokeAllSessions(id);\n  getWsConnectionService().closeForUser(id);\n};\n",
        'server/src/other.ts': BUMP_OK,
      },
      wantRed: true,
      want: '抄了上半没抄下半',
    },
    {
      name: '臂 F 射程为空（没有 server/src）⇒ 退 2 报探针，不是"全部合规"',
      files: { 'README.md': '# 空的\n' },
      wantRed: true,
      want: '探针',
    },
  ];

  let fail = 0;
  for (const fx of fixtures) {
    rmSync(dir, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(fx.files)) {
      const abs = join(dir, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
    const kid = spawnSync(
      process.execPath,
      [join(process.cwd(), 'scripts/check-session-revocation.mjs'), '--root', dir],
      { encoding: 'utf8', cwd: process.cwd() },
    );
    const out = `${kid.stdout ?? ''}${kid.stderr ?? ''}`;
    const red = kid.status !== 0;
    const hasReason = out.includes(fx.want);
    const ok = red === fx.wantRed && hasReason;
    console.log(
      `${fx.name}：${ok ? 'OK' : 'FAIL'}（red=${String(red)} want=${String(fx.wantRed)} 理由在场=${String(hasReason)}）`,
    );
    if (!ok) console.log(out.split('\n').slice(0, 6).join('\n'));
    fail += ok ? 0 : 1;
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`ARMS=${String(fixtures.length)} FAIL=${String(fail)}`);
  process.exit(fail === 0 ? 0 : 1);
}

const r = scan(ROOT);
if (r.probe !== null) {
  console.log(r.probe);
  console.log(
    `SUMMARY 文件=${String(r.fileCount)} bump=${String(r.bumpCount)} 违规=${String(r.violations.length)}`,
  );
  process.exit(2);
}

if (r.violations.length > 0) {
  for (const v of r.violations) console.log(`✗ ${v}`);
  console.log(
    `SUMMARY 文件=${String(r.fileCount)} bump=${String(r.bumpCount)} 豁免命中=${String(r.exemptHits)} 违规=${String(r.violations.length)}`,
  );
  process.exit(1);
}

console.log(
  `✓ 全部 ${String(r.bumpCount)} 处 ` +
    '`tokenVersion` 抬法都关得到实时通道（' +
    `${String(r.fileCount)} 个文件，豁免 ${String(r.exemptHits)} 枚且计数逐字相符）`,
);
console.log(
  `SUMMARY 文件=${String(r.fileCount)} bump=${String(r.bumpCount)} 豁免命中=${String(r.exemptHits)} 违规=0`,
);
process.exit(0);
