#!/usr/bin/env node
/**
 * 会话令牌**只许在一处签**（常驻门禁，纯读盘，不占设备）。
 *
 * ## 为什么要有这条
 *
 * `server/src/account/access-sessions.ts` 的文件头写着"`auth.ts` 的 `issueSession()` 是唯一出口"，
 * `auth.ts` 里也写着"由 `pnpm check:token-minting` 钉住只有一处 `jwt.sign`" ——
 * 而**那枚门禁当时并不存在**。这不是整洁问题，是一条安全属性没有主人：
 *
 * 一枚会话令牌要能被**逐个撤销**（ADR-0063 §2.5），前提是每次签发都附带做了两件事 ——
 * 生成一个 `jti`、把 `jti → sessionId` 那一行写进 `access_sessions`。第二份裸 `jwt.sign`
 * 签出来的令牌**结构上带不出这两样**：它看起来完全正常、能过 `verifyToken`、能同步，
 * 但那一枚永远无法单独登出（库里没有对应的行），而没有任何一层会报错。
 * 本轮之前仓库里真的躺着 **4 份**裸签（`replaceToken`、通行密钥登录、`test-routes`、
 * `auth.ts` 里自己那份），注释还写着"与上面那条一致" —— 一致的意思是"各自再抄一遍"。
 *
 * ## 判据（五条，逐条可失败）
 *
 *  ① **`jwt.sign(` 的调用点恰好一枚**（剥掉注释之后再数）。
 *  ② 那一枚必须在 `server/src/auth.ts` 里，且落在 `issueSession` 的函数体内。
 *  ③ **`jsonwebtoken` 的 import 恰好一处**，也在 `auth.ts`：任何第二处 import 都能自己签或自己验，
 *     而"自己验"正是绕开 `jti` 存在性检查的那个形状。
 *  ④ **阳性对照**：`server/src` 必须真的读到 `.ts` 文件、且 ① 数出过东西；
 *     数不到就 `exit 2` 报探针，而不是报"全部合规"（AGENTS §7 元规则 2）。
 *  ⑤ 每一处 **`issueSession(` 调用**都必须带第二个参数，而且那个参数不许是空的 `{}`。
 *     这条钉的是**会话元数据**（工单 W10）：`access_sessions` 那两列 `device_name` / `user_agent`
 *     是「登录设备」列表里唯一能让人认得出"哪一台是我"的东西。本轮之前只有
 *     `POST /auth/passkey/verify` 一条登录路带 UA，其余五条（口令登录、魔法登录、邮箱链接注册、
 *     注册验证码激活、改口令后换发）签出的行两列皆空 ⇒ 用户看着五个一模一样的日期去点"退出这一台"，
 *     而"退出登录"这个功能在最常走的那几条路上退化成"退出所有"。
 *     新增一条登录路而忘了带元数据，编译是过的（参数可选，默认 `{}`）—— 所以只能由这条拦。
 *
 * `--self-test` 用夹具逐臂证明每条真会红、假缺陷真不红（臂数由它自己打印，文档里不许抄）。
 *
 * ⚠️ 一处**有意的取舍**：剥注释时不跟踪字符串。代价是"字符串字面量里写着 `jwt.sign(`"
 *    会被数成一个调用点（假红）；换来的是不会因为正则字面量里有一个引号就把后面的代码
 *    当成字符串吞掉（**假绿**）。这里选假红那一侧。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stripTsComments } from './lib/strip-ts-comments.mjs';
import { spawnSync } from 'node:child_process';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag >= 0 && process.argv[rootFlag + 1] ? resolve(process.argv[rootFlag + 1]) : process.cwd();
const SELF = 'scripts/check-token-minting.mjs';
const CANONICAL_SIGN_FILE = 'server/src/auth.ts';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', 'Pods', 'DerivedData', 'vendor']);

function walk(dir, acc = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const SIGN_CALL = /\bjwt\s*\.\s*sign\s*\(/;

/**
 * 判断那唯一一枚 `jwt.sign(` 是否落在 `issueSession` 的声明区间里。
 *
 * ⚠️ 不做花括号配平：真实声明的参数表里带着默认值 `meta: {...} = {}`，
 * "从声明往后找第一个 `{`"会命中那个空对象字面量，函数体就切成了 `{}` ——
 * 于是门禁在真代码上报红。区间判据（声明起点 → 下一个顶层 `export`）不需要解析语法，
 * 而它回答的正是这个问题："这一枚签名是不是 `issueSession` 自己那一段"。
 */
function signInsideIssueSession(stripped) {
  const decl = /(?:export\s+)?(?:const|let)\s+issueSession\s*=|(?:export\s+)?(?:async\s+)?function\s+issueSession\b/.exec(
    stripped,
  );
  if (!decl || decl.index === undefined) {
    return { ok: false, reason: `${CANONICAL_SIGN_FILE} 里找不到 issueSession 的声明` };
  }
  // 🔴 边界只能往**声明之后**找：取全文件第一个 `export` 的话，任何在 `issueSession`
  //    之前导出的东西都会把边界顶成"文件末尾"，于是"签名在同一文件、却挂在别的
  //    export 上"这种形状就悄悄绿了（真实 `auth.ts` 正是有前置导出的形状）。
  const after = stripped.slice(decl.index);
  const rel = after.search(/\n(?:export|declare)\s/);
  const boundary = rel < 0 ? stripped.length : decl.index + rel;
  const sign = stripped.search(SIGN_CALL);
  if (sign < 0) return { ok: false, reason: '剥掉注释后没有数到签名调用点' };
  if (sign < decl.index || sign > boundary) {
    return {
      ok: false,
      reason: '签名不在 issueSession 函数体内（第二处签发带不出 jti，那枚令牌从此无法单独登出）',
    };
  }
  return { ok: true };
}

/**
 * 找出 `stripped` 里所有 **`issueSession(` 的调用点**（声明处不算），
 * 并回答两处问题：第二个参数在不在、是不是一个空的 `{}`。
 *
 * 不做语法解析，只做括号配平 + 顶层逗号切分 —— 真实调用只有两种形状
 * （`issueSession(user, meta)` 与跨行的 `issueSession({ id: x }, sessionMetaFromRequest(req))`），
 * 这两种都被"数顶层逗号"覆盖。与其在这里长出一套 TS 解析器，不如把判据写成
 * 只在现有形状上承重，并在夹具里把形状钉住（臂 G / 臂 H）。
 */
function issueSessionCalls(stripped) {
  const skip = new Set();
  for (const d of stripped.matchAll(/(?:export\s+)?(?:const|let)\s+issueSession\s*=\s*(?:async\s*)?\(/g)) {
    skip.add(d.index + d[0].length - 1);
  }
  for (const d of stripped.matchAll(/(?:export\s+)?function\s+issueSession\s*\(/g)) {
    skip.add(d.index + d[0].length - 1);
  }

  const calls = [];
  for (const m of stripped.matchAll(/\bissueSession\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    if (skip.has(open)) continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < stripped.length; i += 1) {
      const c = stripped[i];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) {
      calls.push({ args: null, unbalanced: true });
      continue;
    }
    const inner = stripped.slice(open + 1, close);
    let level = 0;
    const parts = [];
    let cur = '';
    for (const c of inner) {
      if (c === '(' || c === '[' || c === '{') level += 1;
      else if (c === ')' || c === ']' || c === '}') level -= 1;
      if (c === ',' && level === 0) {
        parts.push(cur);
        cur = '';
      } else cur += c;
    }
    parts.push(cur);
    calls.push({ args: parts.map((p) => p.trim()), unbalanced: false });
  }
  return calls;
}

function scan() {
  const srcDir = join(ROOT, 'server', 'src');
  if (!existsSync(srcDir)) {
    return { probeError: `读不到 server/src（判据没有射程）：${ROOT}` };
  }
  const files = walk(srcDir);
  if (files.length === 0) return { probeError: 'server/src 里一枚 .ts 都没读到' };

  const signSites = [];
  const importSites = [];
  /** 每一处 `issueSession(` 调用落在哪个文件，配平失败也记下来（不能当成"没调用"）。 */
  const callSites = [];
  for (const abs of files) {
    const rel = relative(ROOT, abs).split(/[\\/]/).join('/');
    // 🔴 本脚本不参与：它的判据文本与夹具里写着 `jwt.sign(` 的字面量。
    if (rel === SELF) continue;
    const stripped = stripTsComments(readFileSync(abs, 'utf8'));
    const hits = stripped.match(new RegExp(SIGN_CALL.source, 'g')) ?? [];
    for (let n = 0; n < hits.length; n += 1) signSites.push(rel);
    if (/from\s+['"]jsonwebtoken['"]/.test(stripped) || /require\(\s*['"]jsonwebtoken['"]\s*\)/.test(stripped)) {
      importSites.push(rel);
    }
    for (const call of issueSessionCalls(stripped)) callSites.push({ rel, ...call });
  }

  if (signSites.length === 0) {
    return { probeError: '一枚 `jwt.sign(` 都没数到 ⇒ 签名出口消失或改形，判据已经失效' };
  }

  const errors = [];
  if (signSites.length !== 1) {
    errors.push(`签名出口不止一处（${signSites.length}）：${signSites.join(', ')}`);
  }
  if (!signSites.every((f) => f === CANONICAL_SIGN_FILE)) {
    errors.push(`签名不在 ${CANONICAL_SIGN_FILE} 里：${[...new Set(signSites)].join(', ')}`);
  }
  if (importSites.length !== 1 || importSites[0] !== CANONICAL_SIGN_FILE) {
    errors.push(
      `jsonwebtoken 的 import 应当只在 ${CANONICAL_SIGN_FILE} 出现一次，实际：${importSites.join(', ') || '（零处）'}`,
    );
  }
  if (errors.length === 0) {
    const verdict = signInsideIssueSession(stripTsComments(readFileSync(join(ROOT, CANONICAL_SIGN_FILE), 'utf8')));
    if (!verdict.ok) errors.push(verdict.reason);
  }

  // ⑤ 只在前面全绿时才判 —— 顺序是刻意的：签名出口已经不唯一时，先报那一条，
  // 不要让"某一处调用没带元数据"把真正的病因盖住（夹具的每一臂都靠这个顺序拿到它该拿的理由）。
  if (errors.length === 0) {
    if (callSites.length === 0) {
      return {
        probeError: 'server/src 里一处 `issueSession(` 调用都没数到 ⇒ 要么登录路全没了，要么判据的调用形状漂了（不能报"全部合规"）',
      };
    }
    for (const call of callSites) {
      if (call.unbalanced) {
        errors.push(`${call.rel}：有一处 issueSession( 的括号配平走到了文件末尾 —— 调用形状看不懂，不猜`);
        continue;
      }
      if (call.args.length < 2) {
        errors.push(`${call.rel}：有一处 issueSession(${call.args[0] ?? ''}) 没带第二个参数 ⇒ 这条登录路签出的会话行两列元数据皆空，「登录设备」列表认不出它是哪台`);
      } else if (call.args[1] === '{}' || call.args[1] === '') {
        errors.push(`${call.rel}：有一处 issueSession 的第二参数是空对象 ⇒ 形状上带了元数据、内容上什么都没带，与没带是同一种伤害`);
      }
    }
  }

  return {
    fileCount: files.length,
    signCount: signSites.length,
    importCount: importSites.length,
    callCount: callSites.length,
    errors,
  };
}

function main() {
  const r = scan();
  if (r.probeError) {
    console.error(`❔ 探针：${r.probeError}`);
    return 2;
  }
  if (r.errors.length > 0) {
    console.error('🔴 会话令牌的签发出口不再唯一，或某条登录路没带会话元数据 ——');
    for (const e of r.errors) console.error(`  · ${e}`);
    console.error(
      `SUMMARY 文件=${r.fileCount} 签名=${r.signCount} import=${r.importCount} 调用=${r.callCount}（要求 1 与 1，且都在 ${CANONICAL_SIGN_FILE}；每一处调用都要带非空的第二参数）`,
    );
    return 1;
  }
  console.log(
    `✅ 令牌只在一处签（${CANONICAL_SIGN_FILE} 的 issueSession），${r.callCount} 处调用全带会话元数据；文件=${r.fileCount} 签名=${r.signCount} import=${r.importCount}`,
  );
  return 0;
}

if (process.argv.includes('--self-test')) {
  const dir = join(process.cwd(), 'tmp/token-minting-selftest');
  const AUTH_OK =
    "import * as jwt from 'jsonwebtoken';\nexport const issueSession = async (p: object, meta: object): Promise<string> => {\n  const jti = 'x';\n  return jwt.sign(p, 'secret', { jwtid: jti });\n};\nexport const login = (req: object): Promise<string> => issueSession({ id: 1 }, sessionMetaFromRequest(req));\n";
  const CLEAN_OTHER = "export const helper = (a: number): number => a + 1;\n// 这里不许再写第二份签名。\n";

  const fixtures = [
    {
      name: '臂 A 第二处签名 ⇒ 红，理由是"签名出口不止一处"',
      files: {
        'server/src/auth.ts': AUTH_OK,
        'server/src/second.ts': "import * as jwt from 'jsonwebtoken';\nexport const mint = (p: object): string => jwt.sign(p, 's');\n",
      },
      wantRed: true,
      want: '签名出口不止一处',
    },
    {
      name: '臂 B 签名在同一个文件、却挂在别的 export 上 ⇒ 红，理由是"不在 issueSession 函数体内"',
      // 🔴 夹具**故意在 issueSession 之前放一枚 export**：边界若从全文件第一个
      // `export` 起算，那枚前置导出会把边界顶成"文件末尾"，这一臂就会假绿。
      // 真实 `auth.ts` 正是有前置导出的形状。
      files: {
        'server/src/auth.ts':
          "import * as jwt from 'jsonwebtoken';\nexport const MAX_TOKEN_AGE_MS = 3600;\nexport const issueSession = async (): Promise<string> => { return 'stub'; };\nexport const leak = (p: object): string => jwt.sign(p, 's');\n",
        'server/src/second.ts': CLEAN_OTHER,
      },
      wantRed: true,
      want: '不在 issueSession 函数体内',
    },
    {
      name: '臂 C 形状正确 ⇒ 绿，且 SUMMARY 必须写 签名=1',
      files: { 'server/src/auth.ts': AUTH_OK, 'server/src/second.ts': CLEAN_OTHER },
      wantRed: false,
      want: '签名=1',
    },
    {
      // 这一臂钉的是**剥注释**那一半：仓库里到处在文字上提 `jwt.sign`。
      // 不剥 ⇒ 门禁红在文档上 ⇒ 被人关掉。
      name: '臂 D 注释里提到 jwt.sign 不算调用点 ⇒ 绿',
      files: {
        'server/src/auth.ts': AUTH_OK,
        'server/src/notes.ts':
          "export const x = 1;\n// 这一行原来是全仓第二份裸 jwt.sign(p, 's') —— 已改成调用 issueSession。\n/* 块注释里的 jwt.sign( 也不算 */\nexport const y = x + 1;\n",
      },
      wantRed: false,
      want: '签名=1',
    },
    {
      name: '臂 E 第二处 import jsonwebtoken（即使一次都不签）⇒ 红，理由是"jsonwebtoken 的 import"',
      files: {
        'server/src/auth.ts': AUTH_OK,
        'server/src/verifier.ts': "import { verify } from 'jsonwebtoken';\nexport const v = (t: string): unknown => verify(t, 's');\n",
      },
      wantRed: true,
      want: 'jsonwebtoken 的 import',
    },
    {
      name: '臂 F 射程为空（没有 server/src）⇒ 退 2 报探针，不是"全部合规"',
      files: { 'README.md': '# 空的\n' },
      wantRed: true,
      want: '探针',
    },
    {
      // ⑤ 的第一半：新增一条登录路而**忘了带**元数据 —— 编译是过的（参数可选、默认 `{}`），
      // 症状是那一行的两列元数据全空，而界面只会显示一个日期。
      name: '臂 G issueSession 少带第二个参数 ⇒ 红，理由是"没带第二个参数"',
      files: {
        'server/src/auth.ts': AUTH_OK,
        'server/src/late-login.routes.ts':
          "import { issueSession } from './auth';\nexport const POST = async (req: { id: number }): Promise<string> => issueSession({ id: req.id });\n",
      },
      wantRed: true,
      want: '没带第二个参数',
    },
    {
      // ⑤ 的第二半：**形状上带了、内容上是空的**这一档。只查"逗号个数"的门禁在这里
      // 会变成一条永远通过的判据（AGENTS §7 元规则 2），所以空对象单独红一次。
      name: '臂 H 第二参数是空对象 ⇒ 红，理由是"空对象"',
      files: {
        'server/src/auth.ts': AUTH_OK,
        'server/src/late-login.routes.ts':
          "import { issueSession } from './auth';\nexport const POST = async (req: { id: number }): Promise<string> => issueSession({ id: req.id }, {});\n",
      },
      wantRed: true,
      want: '空对象',
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
    const kid = spawnSync(process.execPath, [join(process.cwd(), 'scripts/check-token-minting.mjs'), '--root', dir], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    const out = `${kid.stdout ?? ''}${kid.stderr ?? ''}`;
    const red = kid.status !== 0;
    const hasReason = fx.want === null || out.includes(fx.want);
    const ok = red === fx.wantRed && hasReason;
    console.log(`${fx.name}：${ok ? 'OK' : 'FAIL'}（red=${String(red)} want=${String(fx.wantRed)} 理由在场=${String(hasReason)}）`);
    if (!ok) console.log(out.split('\n').slice(0, 6).join('\n'));
    fail += ok ? 0 : 1;
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`ARMS=${String(fixtures.length)} FAIL=${String(fail)}`);
  process.exit(fail === 0 ? 0 : 1);
}

process.exit(main());
