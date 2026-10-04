/**
 * 批次 E2 —— Web 宿主的本机销毁：清单必须**逐类**，且与真源**逐字**对账
 * =====================================================================
 *
 * 这个宿主比谁都容易漏，因为它有**三个** IndexedDB 库、一份 OPFS 文件、
 * 两个 Storage，而 `lib/oplog.ts` 的迁移**设计上就不删旧来源**
 * （「两者可并存一个版本周期」）—— 于是"只清当前后端"的销毁会在下次启动时
 * 被留下的那个库**原样灌回来**，而界面说的是"已清除"。
 *
 * 所以这里两组判据：
 *   · **行为**：三类东西真的没了、一类失败不许让其余几类不做。
 *   · **真源对账**：清单是抄件，抄件一定会漂（AGENTS 与既有判据的同一课）。
 *     库名、VFS 目录名、令牌键名各有一条比对，漂了就红。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexedDbAdapter } from '@heyta/storage';

import {
  WEB_DATABASE_NAMES,
  WEB_OPFS_DIRECTORY,
  WEB_SESSION_KEYS_UNPREFIXED,
  WEB_STORAGE_PREFIX,
  eraseWebLocalData,
} from '../src/lib/local-data-destruction.js';

const WEB_SRC = join(process.cwd(), 'src');

/**
 * 🔴 这一组是给 §10.59 那条**真浏览器实测**用的模型桩（不是自造的假 API）：
 * 实测三臂 —— 空白页能删 `.heyta-web`、应用活着但换别的目录名也能删、
 * **只有池自己那个目录删不掉**（`NoModificationAllowedError`），
 * 因为 SAH Pool 的同步访问句柄住在 storage worker 那一侧。
 *
 * 这里把"句柄占着 ⇒ 删不掉；关掉 worker ⇒ 能删"这件事照下来，于是**调用顺序**有了判据：
 * 摘掉 `removeOpfsDirectory()` 里那句 `await releaseStorageWorker()`，下面第一条立刻红。
 * ⚠️ "terminate 真的会释放句柄"这一层**不在这里证** —— 那是 `e2e/tests/local-data-destruction-browser.spec.ts`
 *   的活（纵深防御要求两层各有判据，见本文件头）。
 */
const poolLock = vi.hoisted(() => ({
  held: false,
  releaseCalls: 0,
  removeCalls: 0,
  /** 第几次 `removeEntry` 之后才肯放行（0 = 永远不放行，用来量"有界重试"的上界）。 */
  succeedFromAttempt: 0,
}));

vi.mock('../src/lib/oplog.js', () => ({
  releaseStorageWorker: async () => {
    poolLock.releaseCalls += 1;
    poolLock.held = false;
  },
}));
// `process.cwd()` 在不同调用方式下会是仓库根或 `apps/web`，所以路径一律从
// `WEB_SRC` 反推，不写死相对层数（写死的那版在这里指向 apps/packages/…）。
const REPO_ROOT = resolve(WEB_SRC, '../../..');

/** 在同一个工厂上读一个库的 ops 条数；库不存在时 `init()` 会建成空的 ⇒ 0。 */
async function opsCount(dbName: string): Promise<number> {
  const adapter = new IndexedDbAdapter(dbName);
  await adapter.init();
  const count = await adapter.count('ops');
  adapter.close();
  return count;
}

/**
 * 🔴 每个改过全局对象的探针都必须**留下还原**。
 *
 * 这不是洁癖：本文件里有一条用例把 `sessionStorage` 换成"访问就抛"的对象，
 * 而 `vi.restoreAllMocks()` **管不到 `defineProperty`**。上一次它就是靠这个
 * 把后面三条用例毒成 `sessionStorage.clear is not a function` ——
 * 症状长得像产品坏了，实际是上一段用户操作留下的状态（§7 第 83 条同一个规律）。
 */
const undoStack: Array<() => void> = [];

function override(target: object, property: string, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, { value, configurable: true, writable: true });
  undoStack.push(() => {
    if (previous === undefined) {
      delete (target as Record<string, unknown>)[property];
      return;
    }
    Object.defineProperty(target, property, previous);
  });
}

/** 把全局 IndexedDB 换成一份干净的工厂（`setup.ts` 装的是 `fake-indexeddb/auto`）。 */
function resetIdb(): void {
  const g = globalThis as unknown as { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;
}

function installOpfs(options: { error?: Error } = {}): {
  removeEntry: ReturnType<typeof vi.fn>;
} {
  const removeEntry = vi.fn(async (name: string) => {
    if (options.error !== undefined) throw options.error;
    void name;
  });
  override(globalThis.navigator, 'storage', { getDirectory: async () => ({ removeEntry }) });
  return { removeEntry };
}

function installServiceWorkerLayer(caches: Record<string, string[]> = { 'app-shell': [] }): {
  unregister: ReturnType<typeof vi.fn>;
  deleted: string[];
} {
  const deleted: string[] = [];
  const unregister = vi.fn(async () => true);
  override(globalThis, 'caches', {
    keys: async () => Object.keys(caches),
    delete: async (key: string) => {
      deleted.push(key);
      return true;
    },
  });
  override(globalThis.navigator, 'serviceWorker', { getRegistration: async () => ({ unregister }) });
  return { unregister, deleted };
}

beforeEach(() => {
  resetIdb();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const undo of undoStack.splice(0).reverse()) undo();
});

describe('E2 —— 清单与真源逐字对账（抄件一定会漂）', () => {
  /** 从一段源码里取 `const NAME = 'value'` 的字面值。 */
  function literal(source: string, declaration: RegExp): string {
    const found = declaration.exec(source);
    if (found?.[1] === undefined) {
      // 解析不出来必须**响亮**失败：静默返回 undefined 会把对账变成"永远相等"。
      throw new Error(`真源里解析不到：${declaration.source}`);
    }
    return found[1];
  }

  it('三个库名与各自的真源**逐字相同**', () => {
    const oplog = readFileSync(join(WEB_SRC, 'lib/oplog.ts'), 'utf8');
    const vault = readFileSync(join(WEB_SRC, 'lib/vault-session.ts'), 'utf8');
    const sw = readFileSync(join(WEB_SRC, 'pwa/sw.ts'), 'utf8');

    expect([...WEB_DATABASE_NAMES].sort()).toEqual(
      [
        literal(oplog, /export function initOpLog\(dbName = '([^']+)'\)/),
        literal(vault, /const DB_NAME = '([^']+)'/),
        literal(sw, /const DB_NAME = '([^']+)'/),
      ].sort(),
    );
  });

  it('🔴 OPFS 目录名 = 真源 VFS 名派生出的那个（`.` + vfsName）', () => {
    // `sqlite-wasm-driver.ts` 里是 `directory: `.${vfsName}``，
    // 所以这里必须按同一条规则派生，不能只比一个字符串常量。
    const worker = readFileSync(join(WEB_SRC, 'worker/storage.worker.ts'), 'utf8');
    const driver = readFileSync(
      join(REPO_ROOT, 'packages/storage/src/sqlite/sqlite-wasm-driver.ts'),
      'utf8',
    );
    const vfs = literal(worker, /const DB_VFS_NAME = '([^']+)'/);
    expect(driver, '派生规则改了就必须同步这里').toContain('`.${vfsName}`');
    expect(WEB_OPFS_DIRECTORY).toBe(`.${vfs}`);
  });

  it('🔴 全仓每一个 IndexedDB 库名都在清单里（第三个宿主/第四个库出现时会红）', () => {
    // 这不是"比对我已经想到的三个"，是**枚举所有者**：
    // 扫 src 下每一处 `new IndexedDbAdapter(X)` / `indexedDB.open(X`，
    // 把实参解析成字面量（同文件常量也解析），然后要求它落在清单里。
    const names = new Set<string>();
    const sites: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(?:ts|tsx)$/.test(entry) || entry.endsWith('.spec.ts') || entry.includes('.test.')) {
          continue;
        }
        const source = readFileSync(path, 'utf8');
        const calls = [
          ...source.matchAll(/new IndexedDbAdapter\(\s*([^)]+?)\s*\)/g),
          ...source.matchAll(/indexedDB\.open\(\s*([^,\s)]+)/g),
        ];
        for (const call of calls) {
          const arg = (call[1] ?? '').trim();
          sites.push(`${relative(WEB_SRC, path)} → ${arg}`);
          const resolved = resolveName(arg, source);
          if (resolved === undefined) {
            throw new Error(
              `解析不出库名，判据够不着这一处：${relative(WEB_SRC, path)} 的 ${arg}`,
            );
          }
          names.add(resolved);
        }
      }
    };

    walk(WEB_SRC);
    // 探针自检：一条都没扫到 = 遍历坏了，不是"仓库里没有库"。
    expect(sites.length, `一处 IndexedDB 都没扫到 ⇒ 遍历坏了`).toBeGreaterThan(0);
    expect([...names].sort()).toEqual([...WEB_DATABASE_NAMES].sort());
  });

  it('令牌四键与 `pending-login.ts` 的导出常量同一集合', () => {
    const source = readFileSync(join(WEB_SRC, 'features/auth/pending-login.ts'), 'utf8');
    const keys = [...source.matchAll(/export const PENDING_\w+_KEY = '([^']+)'/g)].map(
      (m) => m[1] as string,
    );
    expect(keys.length, '真源里的键数量变了就先看是不是解析坏了').toBe(4);
    expect([...WEB_SESSION_KEYS_UNPREFIXED].sort()).toEqual(keys.sort());
  });
});

/** `new IndexedDbAdapter('heyta')` 的字面量，或同文件里 `const X = 'heyta'`。 */
function resolveName(arg: string, source: string): string | undefined {
  const quoted = /^['"]([^'"]+)['"]$/.exec(arg);
  if (quoted?.[1] !== undefined) return quoted[1];
  const param = /^([A-Za-z_$][\w$]*)$/.exec(arg);
  if (param?.[1] === undefined) return undefined;
  // 形参：`initOpLog(dbName = 'heyta')` 这种默认值就是真源。
  const asParam = new RegExp(`(?:function \\w+\\(|${param[1]}\\s*=\\s*)'([^']+)'`).exec(source);
  return asParam?.[1];
}

describe('E2 —— 逐类真的清掉', () => {
  it('🔴 三个库 + heyta* 键 + 令牌四键 + OPFS + CacheStorage 一起没', async () => {
    for (const name of WEB_DATABASE_NAMES) {
      const adapter = new IndexedDbAdapter(name);
      await adapter.init();
      await adapter.add('ops', { op: { id: `${name}-1` }, source: 'local' });
      adapter.close();
    }
    localStorage.setItem('heyta.theme', 'dark');
    localStorage.setItem('heyta.locale', 'zh-CN');
    // 一条**从未在任何人清单里**的 heyta 键：点名清单漏的就是它。
    localStorage.setItem('heyta.brand-new-module', 'x');
    localStorage.setItem('other-app:key', '不能碰');
    sessionStorage.setItem('loginToken', 'one-time-token');
    sessionStorage.setItem('loginEmail', 'someone@example.test');
    sessionStorage.setItem('heyta.session', '1');

    const opfs = installOpfs();
    const sw = installServiceWorkerLayer({ 'app-shell': [], 'widget': [] });

    const reports = await eraseWebLocalData();

    expect(reports.length, `报告 ${String(reports.length)} 条 ⇒ 有代码没跑到`).toBe(8);
    for (const name of WEB_DATABASE_NAMES) {
      expect(await opsCount(name), `「${name}」里还有东西`).toBe(0);
    }
    expect(localStorage.getItem('heyta.theme')).toBeNull();
    expect(localStorage.getItem('heyta.brand-new-module')).toBeNull();
    // 前缀扫只扫自己的东西：别的应用的键不许动。
    expect(localStorage.getItem('other-app:key')).toBe('不能碰');
    expect(sessionStorage.getItem('loginToken')).toBeNull();
    expect(sessionStorage.getItem('loginEmail')).toBeNull();
    expect(sessionStorage.getItem('heyta.session')).toBeNull();
    expect(opfs.removeEntry).toHaveBeenCalledWith(WEB_OPFS_DIRECTORY, { recursive: true });
    expect(sw.deleted.sort()).toEqual(['app-shell', 'widget']);
    expect(sw.unregister).toHaveBeenCalledTimes(1);
    // 任何一类都不许报"没删掉"。
    expect(reports.filter((r) => !r.containerRemoved).map((r) => r.target)).toEqual([]);
  });

  it('🔴 主库销毁抛错 ⇒ 后面的几类**照做**，且这一类以 reason 报出来', async () => {
    // 这一条钉的是"一类失败 = 整次销毁半途而废"：那会留下最难的形态 ——
    // 界面说"同步已停止"，磁盘上留着半份数据，而下一次启动还可能把它灌回来。
    const adapterProto = IndexedDbAdapter.prototype as unknown as {
      destroy: () => Promise<never>;
    };
    vi.spyOn(adapterProto, 'destroy').mockRejectedValue(new Error('IndexedDB 被别的标签页占着'));

    localStorage.setItem('heyta.theme', 'dark');
    sessionStorage.setItem('loginEmail', 'someone@example.test');
    installOpfs();
    installServiceWorkerLayer();

    const reports = await eraseWebLocalData();

    expect(reports).toHaveLength(8);
    expect(reports[0]?.containerRemoved).toBe(false);
    expect(reports[0]?.reason).toContain('别的标签页');
    // 后面几类真的做了，不是被 catch 顺手跳过的。
    expect(localStorage.getItem('heyta.theme')).toBeNull();
    expect(sessionStorage.getItem('loginEmail')).toBeNull();
  });

  it('OPFS 不可用（没有 getDirectory）⇒ 如实报 false，不抛、不假装删了', async () => {
    override(globalThis.navigator, 'storage', {});
    installServiceWorkerLayer();

    const reports = await eraseWebLocalData();
    const opfs = reports.find((r) => r.target.startsWith('opfs:'));
    expect(opfs?.containerRemoved, '没有 getDirectory 却报"删掉了"').toBe(false);
    // 🔴 只断言"这一类失败必须带一条可读的原因"，**不钉它的措辞**。
    // 原来这里写的是 `toContain('getDirectory')`，而 reason 的字符串在 2026-10-03
    // 被另一条会话统一改成了 ASCII 机器码（`opfs-unavailable`，见 §7 第 83 条：
    // 证据文件要保持纯 ASCII）。那句话断的是"诊断文本长什么样"，不是本条的不变量 ——
    // 不变量是"不可用 ≠ 已删除，而且要说得出为什么"。
    expect(typeof opfs?.reason, '失败却没带原因').toBe('string');
    expect((opfs?.reason ?? '').length, '原因是一条空串').toBeGreaterThan(0);
  });

  it('OPFS 目录本来就不存在（NotFoundError）⇒ 算成功', async () => {
    // 销毁的语义是"事后不存在"，不是"我删了一次"。
    // 把 NotFoundError 报成失败会让全新安装的用户的每次注销都显示"没清干净"。
    const missing = Object.assign(new Error('not found'), { name: 'NotFoundError' });
    installOpfs({ error: missing });
    installServiceWorkerLayer();

    const reports = await eraseWebLocalData();
    const opfs = reports.find((r) => r.target.startsWith('opfs:'));
    expect(opfs?.containerRemoved).toBe(true);
    expect(opfs?.reason).toBeUndefined();
  });

  it('sessionStorage 访问就抛（隐私模式）⇒ 报 false + 原因，**不**让整次销毁失败', async () => {
    const throwing = {
      get length(): number {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    override(globalThis, 'sessionStorage', throwing);
    installOpfs();
    installServiceWorkerLayer();

    const reports = await eraseWebLocalData();
    expect(reports).toHaveLength(8);
    expect(reports.filter((r) => !r.containerRemoved).map((r) => r.target)).toEqual([
      'sessionStorage',
      'sessionStorage:令牌键',
    ]);
  });
});

describe('E2 —— 这个宿主的销毁器真的被接到了同步层上', () => {
  /** 去掉整行注释 —— 锚点必须落在**真代码**上，否则注释里提到的名字会造出假顺序。 */
  function stripCommentLines(source: string): string {
    return source
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      .join('\n');
  }

  it('main.tsx 在**任何同步之前**注册 eraseWebLocalData', () => {
    // 顺序是判据本体：注册晚于第一次同步，就等于第一次 ACCOUNT_CLOSED 没人清。
    const source = stripCommentLines(readFileSync(join(WEB_SRC, 'main.tsx'), 'utf8'));
    const register = source.indexOf('registerLocalEraser(eraseWebLocalData)');
    expect(register, 'Web 没注册销毁器 = 注销后本机明文留着').toBeGreaterThan(-1);

    const touches = ['startAutoSync(', 'createSyncClient(', 'initOpLog(']
      .map((needle) => source.indexOf(needle))
      .filter((index) => index >= 0);
    expect(touches.length, '探针找不到任何存储/同步入口 ⇒ 入口形状改了，去看真源').toBeGreaterThan(
      0,
    );
    expect(register).toBeLessThan(Math.min(...touches));
  });

  it('前缀常量与真源里那些 `heyta.*` 键同源（没人用别的前缀）', () => {
    // 前缀扫抓不到不带 `heyta` 前缀的键 —— 上一条把已知的四个点了名，
    // 这一条保证以后不会**悄悄**再添第五个：扫 src 里所有 setItem 的字面键。
    const offenders: string[] = [];
    const named: readonly string[] = WEB_SESSION_KEYS_UNPREFIXED;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(?:ts|tsx)$/.test(entry)) continue;
        const source = readFileSync(path, 'utf8');
        for (const m of source.matchAll(/(?:local|session)Storage\.setItem\(\s*'([^']+)'/g)) {
          const key = m[1] as string;
          if (!key.startsWith(WEB_STORAGE_PREFIX) && !named.includes(key)) {
            offenders.push(`${relative(WEB_SRC, path)} → ${key}`);
          }
        }
      }
    };
    walk(WEB_SRC);
    expect(
      offenders,
      `这些键不带前缀、也不在点名清单里 ⇒ 注销后留着：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('E2 —— OPFS 那一类：先关持句柄的 worker，再删（有界重试）', () => {
  /** 装一把"池占着就删不掉"的 OPFS 桩 —— 这是真浏览器实测的形状，不是想象。 */
  function installLockedOpfs(): void {
    const removeEntry = vi.fn(async () => {
      poolLock.removeCalls += 1;
      const allowed =
        poolLock.succeedFromAttempt === 0
          ? !poolLock.held
          : poolLock.removeCalls >= poolLock.succeedFromAttempt;
      if (!allowed) {
        const error = new Error(
          `Failed to execute 'removeEntry' on 'FileSystemDirectoryHandle': An attempt was made to modify an object where modifications are not allowed.`,
        );
        error.name = 'NoModificationAllowedError';
        throw error;
      }
    });
    override(globalThis.navigator, 'storage', { getDirectory: async () => ({ removeEntry }) });
  }

  function resetLock(held: boolean, succeedFromAttempt = 0): void {
    poolLock.held = held;
    poolLock.releaseCalls = 0;
    poolLock.removeCalls = 0;
    poolLock.succeedFromAttempt = succeedFromAttempt;
  }

  /** 只取 OPFS 那一条凭据（其余几类由上面那组判据管）。 */
  async function eraseOpfsReport() {
    const reports = await eraseWebLocalData();
    return reports.find((r) => r.target.startsWith('opfs:'));
  }

  it('🔴 句柄占着 ⇒ 销毁必须先把 worker 关掉，关掉之后就删得掉', async () => {
    resetLock(true);
    installLockedOpfs();
    const opfs = await eraseOpfsReport();
    expect(poolLock.releaseCalls, 'erase 没关 worker 就去删 OPFS（这正是真浏览器里每次都失败的那条路）').toBeGreaterThan(
      0,
    );
    expect(opfs?.containerRemoved, `关了 worker 仍报删不掉：${String(opfs?.reason)}`).toBe(true);
    expect(opfs?.reason, '成功却不该带原因').toBeUndefined();
    // 顺序判据的牙齿：摘掉 `await releaseStorageWorker()` ⇒ 上面三条同时红。
  });

  it('terminate 之后句柄不是同步消失 ⇒ 重试一次要能接住（第一发被拒不算失败）', async () => {
    resetLock(false, 2);
    installLockedOpfs();
    const opfs = await eraseOpfsReport();
    expect(poolLock.removeCalls, '一次被拒就放弃 ⇒ 没有那层有界重试').toBeGreaterThanOrEqual(2);
    expect(opfs?.containerRemoved, `第二发已经能删了却报失败：${String(opfs?.reason)}`).toBe(true);
  });

  it('🔴 一直删不掉 ⇒ 如实报 false，且**重试有上界**（不许热循环）', async () => {
    // `succeedFromAttempt=99`：时间表跑完永不放行（`held` 会被 release 清掉，所以不能靠它挡）。
    resetLock(true, 99);
    installLockedOpfs();
    const opfs = await eraseOpfsReport();
    expect(opfs?.containerRemoved, '一次都没删掉却报成功').toBe(false);
    expect(opfs?.reason ?? '', `失败却没写为什么失败：${String(opfs?.reason)}`).toContain(
      'opfs-delete-failed',
    );

    // 上界从**真源那张时间表**推导，不抄常数（抄的那版六天内就会漂）。
    const source = readFileSync(join(WEB_SRC, 'lib/local-data-destruction.ts'), 'utf8');
    const schedule = /OPFS_DELETE_SCHEDULE_MS\s*=\s*\[([^\]]*)\]/.exec(source);
    expect(schedule, '时间表常量 `OPFS_DELETE_SCHEDULE_MS` 不见了 ⇒ 这条判据失去参照').not.toBeNull();
    const waits = (schedule?.[1] ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    expect(waits.length, '时间表是空的（一次都不试）').toBeGreaterThan(0);
    expect(poolLock.removeCalls, `重试次数没有上界（跑了 ${String(poolLock.removeCalls)} 发）`).toBeLessThanOrEqual(
      waits.length,
    );
    // 🔴 预算下限来自**实测**（§10.60 的 B4 臂：等到 1000 ms 才删得掉），
    // 不是保守取值。谁把预算剪到释放句柄的延迟以下，这条就红。
    const lastWait = waits[waits.length - 1] as number;
    expect(lastWait, `重试预算只到 ${String(lastWait)} ms —— 低于实测的句柄释放延迟`).toBeGreaterThanOrEqual(1000);
  });
});
