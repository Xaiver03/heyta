/**
 * 版本耦合的对外说法有没有牙（`server/README.md`「Clients and version coupling」）。
 *
 * 那份文档写的是**三条前置条件都不成立**：没有客户端发 `appVersion`、没有客户端创建因果
 * full-state 边界、没有东西消费那个闸门。改道取证（审计 §8.17）否证了"补个生产者"——
 * 光上报会把那条日志变成假信号。于是这一批真正欠的东西是：**那三条"还没有"必须会有人响**，
 * 否则文档下一读就是错的。
 *
 * 每个 0 命中的检查都配**同趟阳性对照**（扫描器坏了、目录改名了、正则写窄了，输出上和
 * "确实没有"长得一模一样）。另有注入臂（下方 `describe('注入臂')`）：用内存里的覆盖树喂
 * 合成内容，**不动任何真实文件** —— 臂不红就说明判据恒真。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIN_CHECKPOINT_SAFE_APP_VERSION,
  isCheckpointSafeAppVersion,
} from '../src/sync/checkpoint-gate';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-types', 'build', '.git']);

/** 只读一棵树（真检出，或注入臂的覆盖树）。 */
interface TreeReader {
  exists(rel: string): boolean;
  read(rel: string): string;
  /** 递归列出 relDir 下这些扩展名的文件，返回仓库相对路径（`/` 分隔）。 */
  walk(relDir: string, exts: readonly string[]): string[];
}

const toRel = (abs: string): string =>
  (abs.startsWith(`${REPO_ROOT}/`) ? abs.slice(REPO_ROOT.length + 1) : abs)
    .split(sep)
    .join('/');

const realTree: TreeReader = {
  exists: (rel) => existsSync(join(REPO_ROOT, rel)),
  read: (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8'),
  walk: (relDir, exts) => {
    const out: string[] = [];
    const absDir = join(REPO_ROOT, relDir);
    if (!existsSync(absDir) || !statSync(absDir).isDirectory()) return out;
    const stack = [absDir];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
          continue;
        }
        if (entry.isFile() && exts.some((ext) => entry.name.endsWith(`.${ext}`))) {
          out.push(toRel(join(dir, entry.name)));
        }
      }
    }
    return out.sort();
  },
};

/**
 * 注入臂用的覆盖树：叠加若干文件内容，并可整段摘掉某些路径前缀 —— 用来证明
 * "目录没了／作用域塌了"会响，而不是安静地读出 0 命中。
 */
const overlayTree = (
  base: TreeReader,
  files: readonly Record<string, string>[] = [],
  dropPrefixes: readonly string[] = [],
): TreeReader => {
  const overlay: Record<string, string> = Object.assign({}, ...files);
  const dropped = (rel: string): boolean =>
    dropPrefixes.some((p) => rel === p || rel.startsWith(`${p}/`));
  return {
    exists: (rel) => !dropped(rel) && (rel in overlay || base.exists(rel)),
    read: (rel) => {
      if (dropped(rel)) throw new Error(`臂已摘除该路径: ${rel}`);
      return overlay[rel] ?? base.read(rel);
    },
    walk: (relDir, exts) => {
      const synthetic = Object.keys(overlay).filter(
        (rel) => rel.startsWith(`${relDir}/`) && exts.some((ext) => rel.endsWith(`.${ext}`)),
      );
      const visible = [...base.walk(relDir, exts), ...synthetic].filter((rel) => !dropped(rel));
      return [...new Set(visible)].sort();
    },
  };
};

// ── 判据本体 ──────────────────────────────────────────────────────────────

const README_GATE_LINE = /`MIN_CHECKPOINT_SAFE_APP_VERSION` is `(\d+\.\d+\.\d+)`/g;
/**
 * 🔴 构造形状，不是比较形状。`opType:` 后跟 full-state 枚举 = 造了一条边界 op；
 * 而 `op.opType === 'REPAIR'` 只是上传分桶时的比较 —— 后者在 sync-client 里存在且合法（实测三处）。
 * 用宽松的词级正则会把比较读成构造 ⇒ 判据在别人把机制落进 op-log 之后恒红（这条我在合并载体上量到过）。
 */
const FULL_STATE_CONSTRUCT_RE =
  /opType:\s*(?:OpType\.(?:Repair|REPAIR|SyncImport|SYNC_IMPORT|BackupImport|BACKUP_IMPORT)|'(?:REPAIR|SYNC_IMPORT|BACKUP_IMPORT)')/;
/** 调用形状要带接收者：生成物里的方法定义 `createSyncCheckpoint() {`（bridge-bundle 打包了 op-log 的类）不是调用。 */
const FULL_STATE_CALL_RE = /\.createSyncCheckpoint\s*\(/;
const DOWNLOAD_URL_MARKER = '/api/sync/ops';
const GATE_DECL_REL = 'server/src/sync/checkpoint-gate.ts';
const CLEANUP_REL = 'server/src/sync/cleanup.ts';
const CLIENT_SRC_DIR = 'packages/sync-client/src';
const CLIENT_REL = `${CLIENT_SRC_DIR}/client.ts`;
/**
 * 产品层 = 会替用户做事的那些层（同步编排 / 宿主接线 / 各壳的 TS 源码）。
 * `packages/op-log/src` **不在**此列：那是维护机制本体该在的地方（ADR-0046/0047 明写它是"显式维护 API，
 * 没有自动 timer"），对它单独有一条"构造点数只能 0 或 1"的账。
 */
const PRODUCT_SCOPE_BASE = [CLIENT_SRC_DIR, 'packages/app-host/src'];
const OP_LOG_SRC = 'packages/op-log/src';

/** 有 TS 源码的移动/桌面/节点壳（新增一个带 src 的壳会自动进作用域）。 */
const appShellSrcDirs = (reader: TreeReader): string[] => {
  const names = new Set<string>();
  for (const rel of reader.walk('apps', ['ts', 'tsx'])) {
    const parts = rel.split('/');
    if (parts.length >= 4 && parts[2] === 'src') names.add(parts[1]);
  }
  return [...names].map((name) => `apps/${name}/src`).sort();
};

const filesWith = (
  reader: TreeReader,
  relFiles: readonly string[],
  re: RegExp,
): string[] => relFiles.filter((rel) => re.test(reader.read(rel)));

interface Assessment {
  /** 每条失败以 `<检查号>:` 开头，注入臂按前缀断言是哪几条响。 */
  failures: string[];
  readings: Record<string, unknown>;
}

const assess = (reader: TreeReader): Assessment => {
  const failures: string[] = [];
  const readings: Record<string, unknown> = {};
  const fail = (id: string, message: string): void => {
    failures.push(`${id}: ${message}`);
  };

  // C1 —— 阈值的那份对外抄件必须等于代码常量。
  const readmeRel = 'server/README.md';
  if (!reader.exists(readmeRel)) {
    fail('C1', `${readmeRel} 读不到（判据作用域塌了）`);
  } else {
    const copies = [...reader.read(readmeRel).matchAll(README_GATE_LINE)].map((m) => m[1]);
    readings.readmeGateCopies = copies;
    if (copies.length !== 1) {
      fail('C1', `README 里"阈值抄件"应有恰好 1 处，实得 ${copies.length} 处（句式改了要同步本判据）`);
    }
    for (const value of copies) {
      if (value !== MIN_CHECKPOINT_SAFE_APP_VERSION) {
        fail('C1', `README 写的是 ${value}，代码常量是 ${MIN_CHECKPOINT_SAFE_APP_VERSION}`);
      }
    }
    // 阳性对照：同一个抽取器必须读得出"别的数"，否则它可能只是在复述常量。
    const control = [...'`MIN_CHECKPOINT_SAFE_APP_VERSION` is `9.9.9`'.matchAll(README_GATE_LINE)]
      .map((m) => m[1]);
    if (control.length !== 1 || control[0] !== '9.9.9') {
      fail('C1', `抽取器阳性对照失效（读到 [${control.join(', ')}]）`);
    }
  }

  // C2 —— 本仓库任何工作区的版本都不满足闸门：这是"上报了也判不出新客户端"的事实基础。
  const manifestRels = [
    ...reader
      .walk('packages', ['json'])
      .filter((rel) => rel.split('/').length === 3 && rel.endsWith('/package.json')),
    ...reader
      .walk('apps', ['json'])
      .filter((rel) => rel.split('/').length === 3 && rel.endsWith('/package.json')),
    'server/package.json',
  ].sort();
  const workspaces = manifestRels.map((rel) => {
    const parsed = JSON.parse(reader.read(rel)) as { name?: string; version?: string };
    return { rel, name: parsed.name ?? rel, version: parsed.version ?? '' };
  });
  readings.workspaceCount = workspaces.length;
  readings.workspaceVersions = [...new Set(workspaces.map((w) => w.version))].sort();
  // 作用域下限不写死数字，钉回真源：pnpm-workspace.yaml 里每个 glob 都必须枚举到东西。
  const globs = [...reader.read('pnpm-workspace.yaml').matchAll(/^\s*-\s*["']([\w/*-]+)["']$/gm)]
    .map((m) => m[1]);
  readings.workspaceGlobs = globs;
  if (globs.length === 0) fail('C2', 'pnpm-workspace.yaml 里没解析出任何 glob（判据作用域无从核对）');
  for (const glob of globs) {
    const prefix = glob.endsWith('/*') ? `${glob.slice(0, -2)}/` : '';
    const covered =
      prefix === ''
        ? manifestRels.includes(`${glob}/package.json`)
        : manifestRels.some((rel) => rel.startsWith(prefix));
    if (!covered) fail('C2', `工作区 glob ${glob} 枚举到 0 份 package.json`);
  }
  const names = new Set(workspaces.map((w) => w.name));
  for (const required of ['@heyta/sync-server', '@heyta/sync-client']) {
    if (!names.has(required)) fail('C2', `工作区清单缺 ${required}`);
  }
  for (const w of workspaces) {
    if (isCheckpointSafeAppVersion(w.version)) {
      fail('C2', `${w.name} 的版本 ${w.version} 已能满足闸门 ⇒ README 前置条件 1 的措辞过期了`);
    }
  }
  // 阳性对照：闸门确实认得"够新"的号，否则上面那条 0 命中是恒真。
  if (!isCheckpointSafeAppVersion(MIN_CHECKPOINT_SAFE_APP_VERSION)) {
    fail('C2', '阳性对照失效：等于阈值的版本本应判"新"');
  }

  // C3 —— 没有生产者：sync-client 不发 appVersion，且下载查询串就是文档说的那三个键。
  const clientFiles = reader.walk(CLIENT_SRC_DIR, ['ts']);
  readings.syncClientFiles = clientFiles;
  if (clientFiles.length < 4) {
    fail('C3', `${CLIENT_SRC_DIR} 只扫到 ${clientFiles.length} 个 .ts（<4）—— 作用域塌了`);
  }
  const senders = filesWith(reader, clientFiles, /appversion/i);
  if (senders.length > 0) {
    fail('C3', `sync-client 里出现 appVersion：${senders.join(', ')} ⇒ README 那句"没有 heyta 客户端发它"过期了`);
  }
  // 阳性对照：同一个扫描函数在服务端侧必须找得到这个词。
  if (filesWith(reader, reader.walk('server/src', ['ts']), /appversion/i).length === 0) {
    fail('C3', 'appVersion 阳性对照失效：server/src 本应读得到它');
  }
  if (!reader.exists(CLIENT_REL)) {
    fail('C3', `${CLIENT_REL} 读不到（文档点名的构造点没了）`);
  } else {
    const lines = reader.read(CLIENT_REL).split('\n');
    const start = lines.findIndex((l) => l.includes('new URL(') && l.includes(DOWNLOAD_URL_MARKER));
    if (start < 0) {
      fail('C3', `找不到 ${DOWNLOAD_URL_MARKER} 的查询串构造点`);
    } else {
      const end = lines.findIndex((l, i) => i > start && l.includes('fetchImpl('));
      if (end < 0) {
        fail('C3', '查询串构造点到 fetchImpl( 之间的边界找不到');
      } else {
        const keys = [...lines.slice(start, end).join('\n').matchAll(/searchParams\.set\(\s*'([^']+)'/g)]
          .map((m) => m[1]);
        readings.downloadQueryKeys = keys;
        const expected = ['excludeClient', 'limit', 'sinceSeq'];
        const sorted = [...keys].sort();
        if (sorted.join(',') !== expected.join(',')) {
          fail('C3', `下载查询串实发 [${sorted.join(', ')}]，文档说只有 [${expected.join(', ')}]`);
        }
        if (new Set(keys).size !== keys.length) {
          fail('C3', `下载查询串里有重复键 [${keys.join(', ')}]`);
        }
      }
    }
  }

  // C4 —— 没有任何**产品路径**创建因果 full-state 边界（前置条件 2 的精确形态）。
  // 机制本体在 op-log，这是设计（ADR-0046/0047：显式维护 API，无自动 timer）；这条判据管的是
  // "有没有人把它接进替用户做事的那几层"，不是"机制存不存在"。
  const scope = [...PRODUCT_SCOPE_BASE, ...appShellSrcDirs(reader)];
  readings.fullStateScope = scope;
  if (scope.length < 5) {
    fail('C4', `作用域只有 ${scope.length} 个目录（<5）—— apps/*/src 的枚举坏了`);
  }
  const shellCount = scope.filter((d) => d.startsWith('apps/')).length;
  if (shellCount < 4) {
    fail('C4', `只枚举到 ${shellCount} 个带 TS 的 apps/*/src（<4）`);
  }
  const scannedPerDir: Record<string, number> = {};
  const productConstructions: string[] = [];
  const productCallers: string[] = [];
  for (const dir of scope) {
    const rels = reader.walk(dir, ['ts', 'tsx']);
    scannedPerDir[dir] = rels.length;
    if (rels.length === 0) fail('C4', `${dir} 扫到 0 个文件 —— 判据在此会静默`);
    for (const rel of rels) {
      const text = reader.read(rel);
      if (FULL_STATE_CONSTRUCT_RE.test(text)) productConstructions.push(rel);
      if (FULL_STATE_CALL_RE.test(text)) productCallers.push(rel);
    }
  }
  readings.fullStateScanned = scannedPerDir;
  readings.fullStateProductConstructions = productConstructions;
  readings.fullStateProductCallers = productCallers;
  if (productConstructions.length > 0) {
    fail('C4', `产品层自己造了 full-state op：${productConstructions.join(', ')} ⇒ README 前置条件 2 过期了`);
  }
  if (productCallers.length > 0) {
    fail('C4', `产品层开始调用维护检查点 ${FULL_STATE_CALL_RE.source}：${productCallers.join(', ')} ⇒ 前置条件 2 已经成立，那节文档要重读`);
  }
  // 机制本体的账：op-log src 里允许有构造点，但只允许 0 或 1 个文件含它。
  // 0 = 这棵树还没有机制；1 = 机制在 designated 位置。**第二个**构造点意味着有人新加了一条边界来源，
  // 而那不会是产品层，所以现在这条判据看不见它 —— 这一条就是让它看得见的方式。
  const opLogFile = reader.walk(OP_LOG_SRC, ['ts']);
  const mechanismFiles = filesWith(reader, opLogFile, FULL_STATE_CONSTRUCT_RE);
  readings.fullStateMechanismFiles = mechanismFiles;
  readings.opLogFileCount = opLogFile.length;
  if (opLogFile.length === 0) fail('C4', `${OP_LOG_SRC} 扫到 0 个 .ts —— 机制那一侧无从对账`);
  if (mechanismFiles.length > 1) {
    fail('C4', `${OP_LOG_SRC} 出现 ${mechanismFiles.length} 个 full-state 构造点（${mechanismFiles.join(', ')}）⇒ 多了一条边界来源，前置条件 2 的措辞要重写`);
  }
  // 形状对照（与树无关）：四种形状必须各归各位，否则上面那些 0 命中只是正则太窄。
  const shape = {
    构造命中: FULL_STATE_CONSTRUCT_RE.test("engine.dispatch({ opType: OpType.Repair })"),
    比较不误伤: FULL_STATE_CONSTRUCT_RE.test("if (op.opType === 'REPAIR') {"),
    枚举成员不误伤: FULL_STATE_CONSTRUCT_RE.test("  Repair = 'REPAIR',"),
    调用命中: FULL_STATE_CALL_RE.test("await engine.createSyncCheckpoint();"),
    定义不误伤: FULL_STATE_CALL_RE.test("    createSyncCheckpoint() {"),
  };
  readings.fullStateShapeControls = shape;
  if (!shape.构造命中 || shape.比较不误伤 || shape.枚举成员不误伤 || !shape.调用命中 || shape.定义不误伤) {
    fail('C4', `形状对照失效 ${JSON.stringify(shape)} —— 这几条 0 命中不能算证明`);
  }

  // C5 —— 闸门唯一的消费者是那行日志；没有任何东西**分支于**它。
  if (!reader.exists(GATE_DECL_REL)) {
    fail('C5', `${GATE_DECL_REL} 读不到（符号改名了，"0 引用"就成了假的）`);
  } else if (!reader.read(GATE_DECL_REL).includes('export const isAccountCheckpointSafe')) {
    fail('C5', `${GATE_DECL_REL} 里已没有 export const isAccountCheckpointSafe`);
  }
  const serverTs = reader.walk('server/src', ['ts']);
  const outside = serverTs.filter((rel) => rel !== GATE_DECL_REL);
  const accountSafeRefs = filesWith(reader, outside, /isAccountCheckpointSafe\b/);
  const constantRefs = filesWith(reader, outside, /MIN_CHECKPOINT_SAFE_APP_VERSION\b/);
  readings.checkpointRefsOutsideModule = { accountSafeRefs, constantRefs };
  if (accountSafeRefs.length > 0) {
    fail('C5', `isAccountCheckpointSafe 被 ${accountSafeRefs.join(', ')} 调用 ⇒ 多了消费者，README 前置条件 3 过期了`);
  }
  if (constantRefs.length !== 1 || constantRefs[0] !== CLEANUP_REL) {
    fail('C5', `闸门常量的外部引用应恰好是 ${CLEANUP_REL}，实得 [${constantRefs.join(', ')}]`);
  }
  if (constantRefs.length > 0 && filesWith(reader, [CLEANUP_REL], /Cleanup \[checkpoint-gate\]/).length === 0) {
    fail('C5', `${CLEANUP_REL} 里那行日志标记不在了 ⇒ "唯一消费者是日志"这句要重写`);
  }

  return { failures, readings };
};

// ── 生产读数 ──────────────────────────────────────────────────────────────

describe('版本耦合的三条对外前置条件（server/README.md）', () => {
  it('现量：抄件等于常量、没有生产者、没有边界构造、没有第二消费者', () => {
    const { failures, readings } = assess(realTree);
    // 读数落进测试输出，下一读的人不用重新量（台账引用这一行）。
    console.log('[version-coupling] readings', JSON.stringify(readings));
    expect(failures).toEqual([]);
  });
});

// ── 注入臂：每条判据都要能被单独点红，且只点红它自己 ────────────────────────

const baseline = assess(realTree);

describe('注入臂（不能失败的判据没有价值）', () => {
  interface Arm {
    label: string;
    /** 变异确实进了这棵树 —— 少了这一条，臂可能什么都没改还照样"红/绿"。 */
    probe: (tree: TreeReader) => void;
    tree: TreeReader;
    expectIds: readonly string[];
  }

  const arms: readonly Arm[] = [
    {
      label: 'C1 README 的阈值抄件换了数字',
      tree: overlayTree(realTree, [
        { 'server/README.md': realTree.read('server/README.md').replace('is `18.21.2`', 'is `18.99.0`') },
      ]),
      probe: (t) => expect(t.read('server/README.md')).toContain('is `18.99.0`'),
      expectIds: ['C1'],
    },
    {
      label: 'C2 某个工作区的版本进了闸门空间',
      tree: overlayTree(realTree, [
        {
          'packages/sync-client/package.json': JSON.stringify(
            { name: '@heyta/sync-client', version: '18.22.0' },
            null,
            2,
          ),
        },
      ]),
      probe: (t) => expect(JSON.parse(t.read('packages/sync-client/package.json')).version).toBe('18.22.0'),
      expectIds: ['C2'],
    },
    {
      label: 'C3 客户端开始发 appVersion',
      tree: overlayTree(realTree, [
        {
          [CLIENT_REL]: realTree
            .read(CLIENT_REL)
            .replace(
              "      url.searchParams.set('excludeClient', this.options.clientId);",
              "      url.searchParams.set('excludeClient', this.options.clientId);\n      url.searchParams.set('appVersion', '0.0.0');",
            ),
        },
      ]),
      probe: (t) => expect(t.read(CLIENT_REL)).toContain("searchParams.set('appVersion'"),
      expectIds: ['C3'],
    },
    {
      label: 'C4 宿主层新造了一条 REPAIR op',
      tree: overlayTree(realTree, [
        {
          'packages/app-host/src/arm-full-state.ts': "export const arm = { opType: 'REPAIR' };\n",
        },
      ]),
      probe: (t) => expect(t.exists('packages/app-host/src/arm-full-state.ts')).toBe(true),
      expectIds: ['C4'],
    },
    {
      label: 'C4 宿主层开始调用维护检查点（= 前置条件 2 成立了）',
      tree: overlayTree(realTree, [
        {
          'packages/app-host/src/arm-caller.ts':
            "export const arm = (engine) => engine.createSyncCheckpoint();\n",
        },
      ]),
      probe: (t) => expect(t.read('packages/app-host/src/arm-caller.ts')).toContain('.createSyncCheckpoint('),
      expectIds: ['C4'],
    },
    {
      label: 'C4 机制那一侧冒出第二个构造点',
      tree: overlayTree(realTree, [
        {
          'packages/op-log/src/arm-second-a.ts': "export const a = { opType: OpType.Repair };\n",
          'packages/op-log/src/arm-second-b.ts': "export const b = { opType: 'SYNC_IMPORT' };\n",
        },
      ]),
      probe: (t) => expect(t.exists('packages/op-log/src/arm-second-b.ts')).toBe(true),
      expectIds: ['C4'],
    },
    {
      label: 'C4 上传路径那种比较形状**不该**被判成构造（反向臂：真的加了它才会红）',
      tree: overlayTree(realTree, [
        {
          'packages/sync-client/src/client.ts': `${realTree.read(CLIENT_REL)}\nconst armCompare = (op) => op.opType === 'REPAIR';\n`,
        },
      ]),
      probe: (t) => expect(t.read(CLIENT_REL)).toContain("op.opType === 'REPAIR'"),
      expectIds: [],
    },
    {
      label: 'C5 有人加了分支于闸门的自动 cadence',
      tree: overlayTree(realTree, [
        {
          'server/src/sync/arm-cadence.ts':
            "import { isAccountCheckpointSafe } from './checkpoint-gate';\nexport const arm = isAccountCheckpointSafe([]);\n",
        },
      ]),
      probe: (t) => expect(t.exists('server/src/sync/arm-cadence.ts')).toBe(true),
      expectIds: ['C5'],
    },
    {
      label: '作用域塌了：sync-client 的 src 整个不见（0 命中不能算通过）',
      tree: overlayTree(realTree, [], [CLIENT_SRC_DIR]),
      probe: (t) => expect(t.exists(CLIENT_REL)).toBe(false),
      expectIds: ['C3', 'C4'],
    },
    {
      label: '作用域塌了：apps 整棵不见',
      tree: overlayTree(realTree, [], ['apps']),
      probe: (t) => expect(t.exists('apps/web/package.json')).toBe(false),
      expectIds: ['C2', 'C4'],
    },
    {
      label: '抄件那一份被摘掉',
      tree: overlayTree(realTree, [], ['server/README.md']),
      probe: (t) => expect(t.exists('server/README.md')).toBe(false),
      expectIds: ['C1'],
    },
  ];

  for (const arm of arms) {
    it(`臂「${arm.label}」只让 [${arm.expectIds.join(', ') || '（空集：这是反向臂）'}] 响`, () => {
      expect(baseline.failures, '基线必须先干净，否则任何臂都证明不了什么').toEqual([]);
      arm.probe(arm.tree);
      const { failures } = assess(arm.tree);
      const firedIds = [...new Set(failures.map((f) => f.slice(0, 2)))].sort();
      if (arm.expectIds.length === 0) {
        // 反向臂：这条变异是"真实存在但形状不算"的写法，判据必须**不**响。
        // 它挡的是"正则宽到把合法写法也判成违规" —— 那种判据会在别人正常落地时误红，
        // 而误红的判据下场就是被放宽，放宽通常是放宽到没牙。
        expect(failures, `不该响却响了：${failures.join(' | ')}`).toEqual([]);
        return;
      }
      expect(firedIds, failures.join(' | ')).toEqual([...arm.expectIds].sort());
    });
  }
});
