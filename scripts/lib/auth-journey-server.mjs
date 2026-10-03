/**
 * 认证旅程验收的**服务端引导**（真 Postgres + 真服务端 + 真 WebAuthn 配置）
 * ======================================================================
 *
 * 为什么抽出来：这些旅程的**被测界面**在变（web 在 vite 上、桌面端在
 * WebView2 壳里），而**被测服务端**是同一个。把引导写在两个运行器里就是
 * 本仓反复记为「同一条规则两个实现，然后漂移」的形状 —— 尤其 WebAuthn
 * 三元组与 CORS 放行这两处，**配错的表现是"界面连不上服务端"**，
 * 而那种红最难归因（`verify:multi-end` 已经记录过一次）。
 *
 * 🔴 三条纪律（都是实测踩出来的，不是风格偏好）：
 *
 * 1. **建库必须走 `scripts/migrate-deploy.sh`**，不能直接 `prisma migrate deploy`
 *    （AGENTS.md §4）。
 * 2. **WebAuthn 三元组必须与浏览器侧的 origin 逐字一致**，否则服务端验签
 *    必然失败 —— 而失败文案是"注册失败"，不指向 origin。
 * 3. **CORS 默认只放行上游域名**（`DEFAULT_CORS_ORIGINS`），不显式配
 *    `CORS_ORIGINS` 就会在预检被拦掉，界面报"连不上服务端"而服务端日志一片干净。
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * 找一个**可以真正 spawn** 的 node（与 `verify-p1-sync.mjs` 同一份理由：
 * 封装运行时的私有垫片也叫 "node"，但它不能被独立 spawn）。
 */
export function resolveNode() {
  if (process.env['HEYTA_NODE']) return process.env['HEYTA_NODE'];

  const home = process.env['HOME'] ?? '';
  const candidates = [
    `${home}/.nvm/versions/node/v22.22.3/bin/node`,
    `${home}/.nvm/versions/node/v22.22.0/bin/node`,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  for (const c of candidates) if (existsSync(c)) return c;

  try {
    const found = execFileSync('sh', ['-c', 'which -a node'], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => !/DSH Desktop|runtime-commands/.test(p));
    for (const f of found) if (existsSync(f)) return f;
  } catch {
    // 落到默认
  }

  return process.execPath;
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // 🔴 spawn **根本没起来**（cwd 不存在、命令不存在…）时，`status` 是 null、
  //    stdout/stderr 都是空 ⇒ 症状是"失败但一个字都没有"。必须把 r.error 说出来。
  return { ok: r.status === 0, out: r.error ? `${out}\n[spawn] ${r.error.message}` : out };
}

/**
 * 🔴 **把 `root` 归一成"以斜杠结尾"**。
 *
 * 这个文件里到处是 `${root}server` 这样的**字符串拼接**，所以调用方传进来的
 * `root` 必须带尾斜杠。而 `path.join()` / `path.dirname()` **会去掉**它 ——
 * 于是"另一种同样自然的写法"会让 `cwd` 变成一个不存在的路径，
 * spawn 失败、输出为空，报出来只有一句「迁移失败：」（2026-09-30 实测，
 * 我自己的新脚本就踩了这条，而既有调用方因为用了 `new URL('..')` 恰好带尾斜杠）。
 * ⇒ 与其要求每个调用方记住，不如在这里统一。
 */
function normalizedRoot(root) {
  return root.endsWith('/') ? root : `${root}/`;
}

function psqlAvailable() {
  return run('psql', ['--version']).ok;
}

/** 剥掉 Prisma 特有查询参数 —— psql 只认 libpq URL。 */
export function toLibpqUrl(url) {
  const u = new URL(url);
  for (const key of ['schema', 'connection_limit', 'pool_timeout']) {
    u.searchParams.delete(key);
  }
  const qs = u.searchParams.toString();
  u.search = qs;
  return u.toString();
}

function defaultDbUser() {
  return (
    process.env['HEYTA_VERIFY_DB_USER'] ??
    process.env['PGUSER'] ??
    process.env['USER'] ??
    process.env['LOGNAME'] ??
    os.userInfo().username
  );
}

/** 验收库的 DATABASE_URL（每套验收一个独立库，互不踩）。 */
export function databaseUrlFor(dbName) {
  return (
    process.env['HEYTA_VERIFY_DATABASE_URL'] ??
    `postgresql://${defaultDbUser()}@127.0.0.1:5432/${dbName}` +
      '?schema=public&connection_limit=5&pool_timeout=10'
  );
}

/** 建库（如果不存在）+ 应用迁移。失败直接退出，不带着半个库往下跑。 */
export function ensureDatabase({ root, dbUrl, dbName }) {
  root = normalizedRoot(root);
  if (!psqlAvailable()) {
    console.log('⚠️  找不到 psql，跳过建库 —— 若库不存在，验收会在服务端启动阶段失败');
    return;
  }

  const adminUrl = toLibpqUrl(dbUrl.replace(/\/[^/?]+\?/, '/postgres?'));
  const exists = run('psql', [adminUrl, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`]);
  if (exists.out.trim() === '1') {
    console.log('· 验收库已存在');
  } else {
    console.log('· 验收库不存在，创建中…');
    // 用 psql 发 CREATE DATABASE —— `createdb <URL>` 会把 URL 当标识符。
    const created = run('psql', [adminUrl, '-c', `CREATE DATABASE "${dbName}"`]);
    if (!created.ok) {
      const recheck = run('psql', [adminUrl, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`]);
      if (recheck.out.trim() !== '1') {
        console.error(`❌ 建库失败：${created.out.trim().slice(0, 300)}`);
        process.exit(1);
      }
    }
  }

  console.log('· 应用迁移…');
  // 必须用项目脚本，不能用 prisma migrate deploy（AGENTS.md §4）
  const shim = `${root}research/tools/macos-sed-shim`;
  const migrated = run('sh', ['scripts/migrate-deploy.sh'], {
    cwd: `${root}server`,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      PATH: `${shim}:${process.env['PATH'] ?? ''}`,
    },
  });
  if (!migrated.ok) {
    console.error(`❌ 迁移失败：\n${migrated.out.trim().slice(-800)}`);
    process.exit(1);
  }
  console.log('· 迁移完成');
}

/**
 * server/dist 不存在**或比源码旧**就重新构建一次。
 *
 * 🔴 为什么要判新鲜度而不是"存在即跳过"（2026-09-30 实测踩到）：
 * 本仓是**多个会话共用的工作树**。另一条会话改了 `server/src/**` 或
 * `prisma/schema.prisma` 之后，`server/dist` 还停在旧版，而这个验收
 * 跑的就是那份旧 dist —— 于是出现最难查的一类红：
 *
 *   `The column users.is_admin does not exist in the current database.`
 *
 * 那是**新旧不匹配**（Prisma client 是新的、dist 是旧的、库是更旧的），
 * 而现象看着像"认证坏了"。与 §6.1.1「测试全绿 ≠ 这是当前产物」同源。
 */
export function ensureServerBuilt({ root, dbUrl }) {
  root = normalizedRoot(root);
  const entry = `${root}server/dist/src/index.js`;
  if (existsSync(entry) && !serverSourcesNewerThan(root, entry)) return;

  console.log(
    existsSync(entry)
      ? '· server/dist 比 server/src 旧，重新构建…'
      : '· server/dist 不存在，构建一次…',
  );
  const built = run('pnpm', ['--filter', '@heyta/sync-server', 'build'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  if (!built.ok) {
    console.error(`❌ 服务端构建失败：\n${built.out.trim().slice(-800)}`);
    process.exit(1);
  }
}

/** 对比 `server/src` 与 `prisma/schema.prisma` 的 mtime 是否比产物新。 */
function serverSourcesNewerThan(root, entry) {
  const builtAt = statSync(entry).mtimeMs;
  const roots = [`${root}server/src`, `${root}server/prisma/migrations`];
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const item of readdirSync(current, { withFileTypes: true })) {
        const full = `${current}/${item.name}`;
        if (item.isDirectory()) {
          stack.push(full);
        } else if (statSync(full).mtimeMs > builtAt) {
          return true;
        }
      }
    }
  }
  const schema = `${root}server/prisma/schema.prisma`;
  return existsSync(schema) && statSync(schema).mtimeMs > builtAt;
}

/**
 * `server/.env` 里是否**定义了**某个键（只看键名，不解析值、不把它读进进程环境）。
 *
 * 存在的理由：`server/index.ts` 第一行是 `import 'dotenv/config'`，而 dotenv
 * **不覆盖已经存在的 `process.env`**。所以驱动一旦注入一个一次性值，它就会
 * **盖掉**开发机上 `.env` 里那一个 —— 那不是我们要的效果（本机读数应当不变）。
 * 这道检查让注入只在"真的谁都没给"的场合生效：干净检出、新克隆、隔离 worktree。
 */
function declaredInServerDotEnv(root, name) {
  const file = `${root}server/.env`;
  if (!existsSync(file)) return false;
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  return raw.split('\n').some((line) => line.trimStart().startsWith(`${name}=`));
}

/** 一次性密钥：只在进程环境和本机 .env 都没有时给（见 `declaredInServerDotEnv`）。 */
function secretFallback(root, name) {
  if (process.env[name] !== undefined || declaredInServerDotEnv(root, name)) return {};
  return { [name]: randomBytes(32).toString('hex') };
}

/**
 * 拉起服务端并等到 `/health` 真的通（它真的 ping 一次数据库，比探 TCP 端口严格）。
 *
 * `host` 默认 `127.0.0.1`；桌面壳那条路要让**远端 Windows** 访问，
 * 所以传 `0.0.0.0`（或反向隧道到对端 loopback，见运行器）。
 *
 * @param testMode 默认 `true`（上游语义：自动验证邮箱、`/api/test/*` 造号）。
 *   🔴 **要验"那封信真的发出去了"的旅程必须传 `false`** —— TEST_MODE 下
 *   `sendEmail` 根本不碰网络，于是"抓 preview"那条判据永远等不到东西，
 *   而**更坏**的失效形态是它等到了一个**上一轮**留在日志里的 preview。
 * @param logFile 把 stdout+stderr **同时**落到这个文件。跨进程给 Playwright
 *   用例读的仪器（内存里的 log 只有驱动能读，用例读不到）。
 * @param rpId / origin 只有走 WebAuthn 的旅程需要；不传就不设那两个变量
 *   （设了错值比不设更糟 —— 服务端会拿它去验签名）。
 */
export async function startServer({
  root,
  node,
  port,
  host = '127.0.0.1',
  dbUrl,
  corsOrigins,
  rpId,
  origin,
  publicUrl,
  testMode = true,
  logFile,
}) {
  root = normalizedRoot(root);
  console.log(
    `· 启动服务端（${host}:${port}，TEST_MODE=${String(testMode)}${rpId === undefined ? '' : `，rp=${rpId}`}）…`,
  );
  const server = spawn(node, ['dist/src/index.js'], {
    cwd: `${root}server`,
    env: {
      ...process.env,
      // 🔴 干净检出（隔离 worktree / 新克隆）上 `server/.env` **不存在** —— 它被
      //    gitignore，而服务端有**两处启动自检缺了就拒绝起来**：`JWT_SECRET`
      //    （`auth.ts:34`）与 `PASSWORD_PEPPER`（`password/hash.ts:50`）。症状是
      //    "服务端未能就绪"，看起来像产品坏了，而它其实是**验收载体依赖了一份
      //    不进仓库的配置**。调用方各自的文件头都写着"不需要任何环境变量"，
      //    那就得自己兜两枚**一次性**的：库是本轮造的、令牌与口令散列随进程一起死，
      //    它们不承担生产密钥的任何义务。
      //    （2026-10-03 实测：`verify:password-web` 在 /tmp 的隔离检出里先崩在
      //     JWT_SECRET，补上后崩在 PASSWORD_PEPPER —— 一次只报一个是这类启动检查的
      //     常态，所以两个必须一起兜，别等下一轮。）
      ...secretFallback(root, 'JWT_SECRET'),
      ...secretFallback(root, 'PASSWORD_PEPPER'),
      DATABASE_URL: dbUrl,
      NODE_ENV: 'test',
      ...(testMode
        ? { TEST_MODE: 'true', TEST_MODE_CONFIRM: 'yes-i-understand-the-risks' }
        : { TEST_MODE: 'false' }),
      PORT: String(port),
      HOST: host,
      ...(publicUrl === undefined ? {} : { PUBLIC_URL: publicUrl }),
      // 🔴 `CORS_ORIGINS` 不设 ⇒ 预检被拦，界面报"连不上服务端"而日志干净。
      CORS_ORIGINS: corsOrigins.join(','),
      // 🔴 WebAuthn 三元组必须与浏览器侧 origin 逐字一致。
      ...(rpId === undefined ? {} : { WEBAUTHN_RP_ID: rpId }),
      ...(origin === undefined ? {} : { WEBAUTHN_ORIGIN: origin }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  const append = (d) => {
    log += d.toString();
    if (logFile !== undefined) appendFile(logFile, d.toString(), () => {});
  };
  server.stdout.on('data', append);
  server.stderr.on('data', append);

  const base = `http://127.0.0.1:${String(port)}`;
  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // 还没起来
    }
    if (server.exitCode !== null) break;
  }

  if (!ready) {
    console.error('❌ 服务端未能就绪。日志尾部：\n');
    console.error(log.split('\n').slice(-20).join('\n'));
    server.kill('SIGTERM');
    process.exit(1);
  }
  console.log('✅ 服务端就绪');

  return {
    proc: server,
    base,
    log: () => log,
    stop: () => {
      if (server.exitCode === null) server.kill('SIGTERM');
    },
  };
}

/** 把 `cleanup` 挂到 exit / SIGINT 上，保证不留下孤儿服务端。 */
export function installCleanup(handles) {
  const cleanup = () => {
    for (const h of handles) {
      try {
        h.stop();
      } catch {
        // 退出路径上不再抛
      }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  return cleanup;
}
