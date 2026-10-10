#!/usr/bin/env node
/**
 * 门禁：服务端错误响应必须走全局信封 `{ code, message }`
 * =====================================================
 *
 * 2026-10-10 起服务端不再允许：
 *
 *   1. `send({ error: … })` / `body: { error: … }` —— 旧形状的**写**侧；
 *   2. 错误体里再发明 `errorCode` 字段 —— 客户端只读 `code`。
 *
 * 它拦的是"下一个新路由把四种形状之一再写回来"。形状的**正向**判据
 * （每条错误真的是 `{code,message}`）由 server 测试里的信封断言与
 * `apiErrorBodySchema` 负责；本脚本负责**负向**：旧写法一行都不许存在。
 *
 * 自检：`--self-test` 会在临时目录注入两种违规与一份干净样本，
 * 证明"能红"（AGENTS §8.3：不能失败的检查没有价值）。臂数由它自己打印。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 每次调用时求值（不是模块级常量）：--self-test 会 chdir 到临时根里，
// 模块级常量会把扫描钉在真实仓上，注入的违规就永远扫不到（自检抓到过这一条）。
const serverSrc = () => join(process.cwd(), 'server', 'src');
const EXCLUDE_FILES = new Set(['api-error.ts']); // 门禁自己的文档注释里有旧形状字样

const VIOLATION_PATTERNS = [
  { name: 'send({ error:', re: /\.send\(\s*\{\s*\n?\s*error\s*:/ },
  { name: 'body: { error:', re: /body\s*:\s*\{\s*\n?\s*error\s*:/ },
  { name: 'refuse/error object with error:', re: /\{\s*\n?\s*error\s*:\s*(?:MANAGED_AI_ERROR_CODES|[A-Z_]{2,})/ },
];

const scanFile = (path) => {
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');
  const hits = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();
    if (inBlockComment) {
      if (stripped.includes('*/')) inBlockComment = false;
      continue;
    }
    if (stripped.startsWith('*') || stripped.startsWith('/*')) {
      if (stripped.startsWith('/*') && !stripped.includes('*/')) inBlockComment = true;
      continue;
    }
    if (stripped.startsWith('//')) continue;
    for (const { name, re } of VIOLATION_PATTERNS) {
      if (re.test(line)) hits.push({ line: i + 1, pattern: name, text: stripped.slice(0, 100) });
    }
  }
  return hits;
};

const walk = (dir, files = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (p.endsWith('.ts')) files.push(p);
  }
  return files;
};

const run = () => {
  const problems = [];
  for (const file of walk(serverSrc())) {
    if (EXCLUDE_FILES.has(file.split('/').pop())) continue;
    for (const hit of scanFile(file)) {
      problems.push(`${file}:${hit.line} [${hit.pattern}] ${hit.text}`);
    }
  }
  if (problems.length > 0) {
    console.error(`❌ 服务端错误响应必须统一为 { code, message } 信封 —— 发现 ${problems.length} 处旧形状：`);
    for (const p of problems) console.error(`   ${p}`);
    console.error('   修法：用 server/src/api-error.ts 的 sendError()，或直接 send({ code, message })。');
    process.exit(1);
  }
  console.log('✅ 服务端错误响应形状：未发现旧形状残留（send({ error }) / errorCode 字段）');
};

const selfTest = () => {
  const arms = [];
  const assertRed = (label, fn) => {
    try {
      fn();
      arms.push(`❌ ${label}: 违规注入后没有变红 —— 这条判据是死的`);
    } catch {
      arms.push(`✅ ${label}: 注入违规 → 红`);
    }
  };
  const assertGreen = (label, fn) => {
    try {
      fn();
      arms.push(`✅ ${label}: 合规样本 → 绿`);
    } catch (e) {
      arms.push(`❌ ${label}: 合规样本被误报 → ${e.message}`);
    }
  };

  const withTempServer = (files, body) => {
    const run = () => {
      const dir = mkdtempSync(join(tmpdir(), 'err-shape-'));
      try {
        const realCwd = process.cwd();
        // scanFile/walk read from SERVER_SRC derived from cwd; emulate by
        // writing files into a temp server/src and pointing the walker at it.
        const srcDir = join(dir, 'server', 'src');
        mkdirSync(srcDir, { recursive: true });
        for (const [name, content] of Object.entries(files)) {
          writeFileSync(join(srcDir, name), content);
        }
        process.chdir(dir);
        try {
          body();
        } finally {
          process.chdir(realCwd);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    return run;
  };

  const scan = () => {
    const problems = [];
    for (const file of walk(serverSrc())) {
      if (EXCLUDE_FILES.has(file.split('/').pop())) continue;
      for (const hit of scanFile(file)) problems.push(`${file}:${hit.line}`);
    }
    if (problems.length > 0) throw new Error(`${problems.length} violations`);
  };

  const makeFiles = (body) => ({ 'routes.ts': body });

  assertRed(
    '臂1 send({ error:',
    withTempServer(makeFiles("return reply.status(400).send({ error: 'Validation failed' });\n"), scan),
  );
  assertRed(
    '臂2 body: { error:',
    withTempServer(makeFiles('interface B { error: string }\nconst b: B = { error: "x" };\nconst out = { body: { error: "x" } };\n'), scan),
  );
  assertRed(
    '臂3 错误体发明 errorCode 字段',
    withTempServer(makeFiles("return reply.status(402).send({ error: CODE, errorCode: CODE });\n"), scan),
  );
  assertGreen(
    '臂4 阳性对照（信封形状）',
    withTempServer(
      makeFiles("return sendError(reply, 400, 'validation_failed', 'Validation failed');\nconst ok = { code: 'x', message: 'y' };\n"),
      scan,
    ),
  );

  console.log(`--self-test: ${arms.length} 臂`);
  for (const a of arms) console.log('  ' + a);
  if (arms.some((a) => a.startsWith('❌'))) process.exit(1);
};

if (process.argv.includes('--self-test')) selfTest();
else run();
