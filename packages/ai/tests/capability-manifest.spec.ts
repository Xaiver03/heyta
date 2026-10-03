/**
 * W9 · 产品级 AI 能力清单：必须**跟着上游走**，不能是一份抄件
 * ==========================================================
 *
 * 判据出处：[ADR-0045](../../../docs/adr/0045-conversational-assistant-split-authorization-from-catalog.md)
 * §2.6 纪律一（清单只能从工具目录与 `EntityModelMap` 生成，禁止手写）与
 * §2.7（分母口径**钉死**：10 个已物化实体里剔掉 2 个落库载体 ⇒ **8**；
 * 四象限 / 今天 / 日历 / 搜索**不是实体**，不进分母）。
 *
 * ## 为什么这里几乎不写"数字等于几"的断言
 *
 * 把上游抄一遍当期望值（"清单里应该有 6 个工具"）**证明不了生成在跟随上游** ——
 * 它只证明抄的时候抄对了。所以判据分三类：
 *
 *   1. **对账**：产物里每个工具的名字与读写，与上游目录**双向**互相（漏一条红、
 *      多一条红、读写标反红）；分母 = `MODELED_ENTITY_TYPES` − 登记过的剔除项。
 *   2. **结构**：分母的每个成员都必须真的在 `MODELED_ENTITY_TYPES` 里 ——
 *      这一条才是"顺手把视图加进分母"的挡箭牌。
 *   3. **fixture**：往输入里注入一个新工具，产物里必须出现它；判不出实体的工具、
 *      归到没模型实体的工具、进了分母的视图名 —— 三种都必须让生成**当场失败**。
 *
 * 只有"现状基线 2/8"那一条是**故意钉住今天的事实**：W10 扩目录时它会红，
 * 而那正是要求的动作 —— 重新判断一次，而不是让它悄悄跟着变。
 *
 * ## 关于"从测试里 import 一个 Node 脚本"
 *
 * 生成器是 `.mjs`（Node 门禁脚本），不是包内模块，`packages/ai` 也不依赖 `scripts/`。
 * 用 `import(new URL(...))`：变量说明符 TS 不去解析，vitest 按真实 ESM 加载，
 * 于是测试拿到的是**同一条被 `pnpm check` 执行的实现**，而不是测试里另写的一份逻辑。
 *
 * ## dist 依赖
 *
 * 生成器读构建产物（`packages/{local-api,domain,shared-schema}/dist`）。
 * 缺产物时 `--check` 那条判据**响亮失败**并说明怎么补，不 `skip` ——
 * 一条在没构建时永远绿的判据等于把这条纪律取消（AGENTS §8.3）。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AI_CAPABILITY_MANIFEST, AI_CAPABILITY_TEXT } from '../src/capability-manifest.generated.js';

// ⚠️ 用 `resolve` 而不是 `join`：`HERE` 带尾斜杠，`join(HERE,'..','..')` 会先吃掉
// 那个空段，少爬一级目录。仓库根在 `packages/ai/tests` **往上三级**。
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SCRIPT = join(REPO, 'scripts/gen-ai-capability-manifest.mjs');
const ARTIFACT = join(REPO, 'packages/ai/src/capability-manifest.generated.ts');

/** 生成器脚本的形状（只用得到的这几项；见文件头为什么用动态导入）。 */
interface GeneratorModule {
  CapabilityManifestError: new (problems: unknown) => Error;
  DENOMINATOR_EXCLUSIONS: readonly { entityType: string; reason: string }[];
  NON_ENTITY_VIEWS: readonly string[];
  SYSTEM_ENTITY_TYPES: readonly string[];
  TOOL_ENTITY_OVERRIDES: Readonly<Record<string, string>>;
  attributeToolByName: (name: string) => { entityType: string | null; how: string | null };
  buildCapabilityManifest: (input: unknown) => FixtureManifest;
  renderModelText: (manifest: unknown) => string;
  readUpstream: () => Promise<Upstream>;
}

interface Upstream {
  protocolEntityTypes: readonly string[];
  modeledEntityTypes: readonly string[];
  tools: readonly {
    name: string;
    kind: string;
    schemaRecorded: boolean;
    args: readonly { name: string; type: string; required: boolean }[];
  }[];
}

interface FixtureManifest {
  coverage: { covered: number; denominator: number; ratio: string };
  userOperableEntityTypes: readonly string[];
  entityTypesWithoutTools: readonly string[];
  tools: readonly {
    name: string;
    kind: string;
    entityType: string;
    schemaRecorded: boolean;
    args: readonly { name: string; type: string; required: boolean }[];
  }[];
}

// 产物里的字面量联合类型对断言不友好（`toContain('TASK_REPEAT_CFG')` 会因为
// 它**不是**已物化类型而编译不过 —— 而那正是这条断言要问的事）。
// 所以按**数据**放宽一次，比较全部走 string。
const manifest = AI_CAPABILITY_MANIFEST as unknown as {
  manifestVersion: number;
  policy: { refusalMustSeparate: string; source: string };
  coverage: { covered: number; denominator: number; ratio: string };
  userOperableEntityTypes: readonly string[];
  modelledEntityTypes: readonly string[];
  excludedFromDenominator: readonly { entityType: string; reason: string }[];
  entityTypesWithoutTools: readonly string[];
  entities: readonly {
    entityType: string;
    materialized: boolean;
    countsTowardCoverage: boolean;
    coverage: string;
    readToolNames: readonly string[];
    writeToolNames: readonly string[];
  }[];
  tools: readonly {
    name: string;
    kind: string;
    entityType: string;
    description: string;
    schemaRecorded: boolean;
    args: readonly { name: string; type: string; required: boolean }[];
  }[];
  protocolTypesWithoutModel: readonly string[];
  systemEntityTypes: readonly string[];
  nonEntityViews: readonly string[];
};

function loadGenerator(): Promise<GeneratorModule> {
  return import(new URL('../../../scripts/gen-ai-capability-manifest.mjs', import.meta.url).href) as Promise<GeneratorModule>;
}

/** 上游目录的**现值**，从真源取，不从产物取（从产物取就是自我循环论证）。 */
async function upstreamDirectory(): Promise<Upstream> {
  return (await loadGenerator()).readUpstream();
}

/** fixture：一份够小的上游输入，用来证明"清单跟着输入走"。 */
function fixtureInput(
  overrides: Partial<{
    protocolEntityTypes: string[];
    modeledEntityTypes: string[];
    tools: unknown[];
  }> = {},
) {
  return {
    protocolEntityTypes:
      overrides.protocolEntityTypes ??
      [
        'TASK',
        'PROJECT',
        'REMINDER',
        'AI_FEEDBACK',
        'PREFERENCE_CORRECTION',
        'TASK_REPEAT_CFG',
        'GLOBAL_CONFIG',
        'MIGRATION',
        'RECOVERY',
        'ALL',
      ],
    modeledEntityTypes:
      overrides.modeledEntityTypes ??
      ['TASK', 'PROJECT', 'REMINDER', 'AI_FEEDBACK', 'PREFERENCE_CORRECTION'],
    tools: overrides.tools ?? [
      { name: 'list_tasks', kind: 'read', description: '列出任务。', schemaRecorded: true, args: [] },
      { name: 'create_task', kind: 'write', description: '新建任务。', schemaRecorded: true, args: [] },
    ],
  };
}

function readScriptStderr(): string {
  try {
    execFileSync(process.execPath, [SCRIPT, '--check'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return '';
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? '');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. 产物 == 上游（这条就是 `--check` 门禁本身）
// ─────────────────────────────────────────────────────────────────────────

describe('产物是生成物：与上游逐字节一致', () => {
  it('`--check` 退出码 0 且 stderr 为空 —— 改了工具目录/实体清单而没重新生成，这里就红', () => {
    // 变异实测：手改产物一个字节 ⇒ 本条红，stderr 打印首个差异行与两侧内容。
    const stdout = execFileSync(process.execPath, [SCRIPT, '--check'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(stdout).toContain('与上游一致');
    expect(readScriptStderr()).toBe('');
  });

  it('上游读出来是**空的**必须失败 —— 探针够不着 ≠ 一切正常', async () => {
    const gen = await loadGenerator();
    expect(() =>
      gen.buildCapabilityManifest({ protocolEntityTypes: [], modeledEntityTypes: [], tools: [] }),
    ).toThrowError(/读出来是空的/);
  });

  it('重复的工具名 / 不是 read|write 的 kind 都会让生成失败', async () => {
    const gen = await loadGenerator();
    expect(() =>
      gen.buildCapabilityManifest(
        fixtureInput({
          tools: [
            { name: 'list_tasks', kind: 'read', description: '', schemaRecorded: true, args: [] },
            { name: 'list_tasks', kind: 'write', description: '', schemaRecorded: true, args: [] },
          ],
        }),
      ),
    ).toThrowError(/工具名重复/);

    expect(() =>
      gen.buildCapabilityManifest(
        fixtureInput({
          tools: [
            { name: 'list_tasks', kind: 'maybe', description: '', schemaRecorded: true, args: [] },
            { name: 'create_task', kind: 'write', description: '', schemaRecorded: true, args: [] },
          ],
        }),
      ),
    ).toThrowError(/kind 是/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. 工具：逐条互相、读写一致、字段搬自模型真会收到的那份投影
// ─────────────────────────────────────────────────────────────────────────

describe('每一个工具都在清单里，且 kind 与目录一致', () => {
  it('产物里的工具集合与上游目录**双向**相等（少一条红、多一条红）', async () => {
    const upstream = await upstreamDirectory();
    const names = upstream.tools.map((t) => t.name);
    const inArtifact = manifest.tools.map((t) => t.name);
    expect([...inArtifact].sort()).toEqual([...names].sort());
  });

  it('每个工具的 kind 与目录逐字相同（读写标反 = 模型会说错"我能不能改"）', async () => {
    const upstream = await upstreamDirectory();
    const expected = new Map(upstream.tools.map((t) => [t.name, t.kind]));
    expect(manifest.tools.length).toBe(expected.size);
    for (const tool of manifest.tools) {
      expect(expected.has(tool.name), `清单里多了一个目录没有的工具 ${tool.name}`).toBe(true);
      expect(tool.kind, `${tool.name} 的读写属性与目录不一致`).toBe(expected.get(tool.name));
    }
  });

  it('每个工具都归到了一个**已物化**实体，且实体条目与工具条目互相对账', async () => {
    const upstream = await upstreamDirectory();
    const modeled = new Set(upstream.modeledEntityTypes);
    for (const tool of manifest.tools) {
      expect(modeled.has(tool.entityType), `${tool.name} 归到 ${tool.entityType}，但它没有领域模型`).toBe(true);
    }
    for (const entity of manifest.entities) {
      const own = manifest.tools.filter((t) => t.entityType === entity.entityType);
      expect([...entity.readToolNames].sort()).toEqual(
        own.filter((t) => t.kind === 'read').map((t) => t.name).sort(),
      );
      expect([...entity.writeToolNames].sort()).toEqual(
        own.filter((t) => t.kind === 'write').map((t) => t.name).sort(),
      );
      // coverage 必须由读/写两组推出来，不是第三份手写的口径
      const expectedCoverage =
        entity.readToolNames.length > 0 && entity.writeToolNames.length > 0
          ? 'read-write'
          : entity.readToolNames.length > 0
            ? 'read-only'
            : entity.writeToolNames.length > 0
              ? 'write-only'
              : 'none';
      expect(entity.coverage).toBe(expectedCoverage);
    }
  });

  it('参数字段搬的是**模型真会收到的那份投影**（含必填标记）', async () => {
    const upstream = await upstreamDirectory();
    for (const tool of manifest.tools) {
      const source = upstream.tools.find((t) => t.name === tool.name);
      expect(source, `${tool.name} 不在上游目录`).toBeTruthy();
      expect(tool.args.map((a) => a.name)).toEqual(source!.args.map((a) => a.name));
      expect(tool.args.filter((a) => a.required).map((a) => a.name)).toEqual(
        source!.args.filter((a) => a.required).map((a) => a.name),
      );
      expect(tool.schemaRecorded).toBe(source!.schemaRecorded);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. 分母口径（ADR-0045 §2.7 钉的是**规则**：视图与两个落库载体不进分母。
//    具体数字随实体清单走：批次二 W2 物化 `EVENT` 之后分母从 8 变 9。
//    ⚠️ ADR-0045 正文里那句"分母是 8 / 现状基线 2/8"是**当时**的读数，
//    它不是结论（结论是那条规则），所以不去改已接受的 ADR，只在这里写明口径。）
// ─────────────────────────────────────────────────────────────────────────

describe('分母恰好 9（W2 物化 EVENT 之后），且逐条点名', () => {
  it('分母成员逐条点名（多一个少一个都红 —— 这条挡住"顺手把视图加进分母"）', async () => {
    const [gen, upstream] = [await loadGenerator(), await upstreamDirectory()];
    const excludedNames = gen.DENOMINATOR_EXCLUSIONS.map((e) => e.entityType);
    const expected = upstream.modeledEntityTypes.filter(
      (t) => !excludedNames.includes(t) && !gen.NON_ENTITY_VIEWS.includes(t),
    );
    expect([...manifest.userOperableEntityTypes]).toEqual(expected);
    expect(manifest.userOperableEntityTypes.length).toBe(9);
    expect(manifest.coverage.denominator).toBe(9);
    // 🔴 W10 **之前**这里是 `toContain('EVENT')` —— 清单的职责就是把"实体有了、
    // 工具还没接"这件事显形。W10 做完之后它必须**不再**出现（这条改向就是那件事
    // 做完了的机器化证据；反向漏做 ⇒ 这条与上面 3/9 那条一起红）。
    expect(manifest.entityTypesWithoutTools).not.toContain('EVENT');
    // 顺序由实体清单决定，所以断言**排序后**的集合（口径是"还剩谁"，不是"谁先谁后"）
    expect([...manifest.entityTypesWithoutTools].sort()).toEqual([
      'FOCUS_SESSION',
      'HABIT',
      'HABIT_LOG',
      'NOTE',
      'REMINDER',
      'TAG',
    ]);
  });

  it('分母的每个成员都**必须**在 `MODELED_ENTITY_TYPES` 里 —— 视图不是实体', async () => {
    const upstream = await upstreamDirectory();
    const modeled = new Set(upstream.modeledEntityTypes);
    const strays = manifest.userOperableEntityTypes.filter((t) => !modeled.has(t));
    expect(strays, `这些名字进了分母但没有领域模型（视图不建实体）：${strays.join(', ')}`).toEqual([]);
  });

  it('剔除项只有登记过的两个落库载体，且它们**确实**是已物化实体、都写明了理由', async () => {
    const [gen, upstream] = [await loadGenerator(), await upstreamDirectory()];
    const excluded = upstream.modeledEntityTypes.filter(
      (t) => !manifest.userOperableEntityTypes.includes(t),
    );
    expect([...excluded].sort()).toEqual([...gen.DENOMINATOR_EXCLUSIONS.map((e) => e.entityType)].sort());
    for (const exclusion of manifest.excludedFromDenominator) {
      expect(upstream.modeledEntityTypes).toContain(exclusion.entityType);
      // 每条剔除都必须**写明理由** —— 空理由就是"随手排除"
      expect(exclusion.reason.length).toBeGreaterThan(6);
    }
  });

  it('`TASK_REPEAT_CFG` 算"动作"：不进分母、不进"有实体没工具"那句（§2.7 易混点之二）', () => {
    expect(manifest.userOperableEntityTypes).not.toContain('TASK_REPEAT_CFG');
    expect(manifest.entityTypesWithoutTools).not.toContain('TASK_REPEAT_CFG');
    expect(manifest.protocolTypesWithoutModel).toContain('TASK_REPEAT_CFG');
  });

  it('四象限 / 今天 / 日历 / 搜索只以"视图"身份出现，且都不是实体类型（§2.7 易混点之一）', async () => {
    const [gen, upstream] = [await loadGenerator(), await upstreamDirectory()];
    for (const view of gen.NON_ENTITY_VIEWS) {
      expect(
        upstream.protocolEntityTypes,
        `${view} 变成了实体类型 —— "视图不建实体"被破坏了，清单的分母会跟着漂`,
      ).not.toContain(view);
      expect(manifest.userOperableEntityTypes).not.toContain(view);
      expect(manifest.modelledEntityTypes).not.toContain(view);
      expect(manifest.nonEntityViews).toContain(view);
    }
  });

  it('现状基线 3/9：TASK / PROJECT / **EVENT** 有工具（再扩目录时这条会红，那是要的）', () => {
    const withTools = manifest.entities
      .filter((e) => e.countsTowardCoverage && e.coverage !== 'none')
      .map((e) => e.entityType);
    // W10 把 EVENT 接上了四个工具（读 2 / 写 2），覆盖面从 2/9 进到 3/9。
    // 这条点名是**判据**不是内容：目录再扩一个实体而这里没跟上，说明那批没做完。
    expect(withTools.sort()).toEqual(['EVENT', 'PROJECT', 'TASK']);
    expect(manifest.coverage.covered).toBe(3);
    expect(manifest.coverage.ratio).toBe('3/9');
  });

  it('🔴 EVENT 的四个工具**读写都有**，且归因走的是名字（不是 override 名单）', async () => {
    const event = manifest.entities.find((e) => e.entityType === 'EVENT');
    expect(event).toBeDefined();
    expect([...event!.readToolNames].sort()).toEqual(['get_event', 'list_events']);
    expect([...event!.writeToolNames].sort()).toEqual(['create_event', 'update_event']);
    // coverage 必须是 read-write —— 竞品那句"我们只能查看、不能新建"的产品谎言，
    // 在 heyta 的**这一格**上被否证（gap-analysis §2.1 的靶子）
    expect(event!.coverage).toBe('read-write');
    // 四条都登记了参数 schema（`schemaRecorded:false` 会静默出现在给模型的投影里）
    for (const name of ['list_events', 'get_event', 'create_event', 'update_event']) {
      const tool = manifest.tools.find((t) => t.name === name);
      expect(tool, `${name} 不在清单里`).toBeDefined();
      expect(tool!.schemaRecorded, `${name} 没有登记 INPUT_SCHEMAS`).toBe(true);
      expect(tool!.entityType).toBe('EVENT');
    }
    // 逃生门没有被用掉：EVENT 是靠**名字**归因的，不是靠 override 名单
    // （`TOOL_ENTITY_OVERRIDES` 一旦开始被逐个点名，清单就开始变成第二份手写名单）
    const gen = await loadGenerator();
    expect(Object.keys(gen.TOOL_ENTITY_OVERRIDES)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. 🔴 生成在跟随上游（fixture 注入）
// ─────────────────────────────────────────────────────────────────────────

describe('注入一个工具，清单里必须出现它（证明"生成"而不是抄）', () => {
  const withReminderTool = (gen: GeneratorModule) =>
    gen.buildCapabilityManifest(
      fixtureInput({
        tools: [
          { name: 'list_tasks', kind: 'read', description: '列出任务。', schemaRecorded: true, args: [] },
          { name: 'create_task', kind: 'write', description: '新建任务。', schemaRecorded: true, args: [] },
          { name: 'create_reminder', kind: 'write', description: '给任务建一条提醒。', schemaRecorded: true, args: [] },
        ],
      }),
    );

  it('fixture 目录加 create_reminder ⇒ 清单出现它、归到 REMINDER、算 write', async () => {
    const gen = await loadGenerator();
    const before = gen.buildCapabilityManifest(fixtureInput());
    const built = withReminderTool(gen);
    const injected = built.tools.find((t) => t.name === 'create_reminder');
    expect(injected, '新加的工具没进清单 —— 生成器在抄旧清单').toBeTruthy();
    expect(injected!.entityType).toBe('REMINDER');
    expect(injected!.kind).toBe('write');
    // 🔴 注入**改变了结论**：REMINDER 不再是"没有工具的实体"，覆盖面 +1。
    //    这一条才是"生成在跟随上游"的正面证据 —— 抄件做不到这件事。
    expect(built.entityTypesWithoutTools).toEqual(['PROJECT']);
    expect(built.coverage.denominator).toBe(3);
    expect(before.coverage.covered).toBe(1);
    expect(built.coverage.covered).toBe(before.coverage.covered + 1);
    expect(built.coverage.ratio).toBe('2/3');
  });

  it('文本投影里也必须出现它（投影与结构化清单是同一次生成的产物）', async () => {
    const gen = await loadGenerator();
    expect(gen.renderModelText(withReminderTool(gen))).toContain('create_reminder');
  });

  it('判不出实体的新工具 ⇒ 生成**当场失败**，不是静默少一条', async () => {
    const gen = await loadGenerator();
    expect(() =>
      gen.buildCapabilityManifest(
        fixtureInput({
          tools: [
            { name: 'list_tasks', kind: 'read', description: '', schemaRecorded: true, args: [] },
            { name: 'do_the_thing', kind: 'read', description: '', schemaRecorded: true, args: [] },
          ],
        }),
      ),
    ).toThrowError(/无法判定工具 `do_the_thing`/);
  });

  it('工具归到**没有领域模型**的实体（EVENT 未落地就先上工具）⇒ 失败并点名"同批"', async () => {
    const gen = await loadGenerator();
    expect(() =>
      gen.buildCapabilityManifest(
        fixtureInput({
          tools: [
            { name: 'list_tasks', kind: 'read', description: '', schemaRecorded: true, args: [] },
            { name: 'list_countdowns', kind: 'read', description: '', schemaRecorded: true, args: [] },
          ],
        }),
      ),
    ).toThrowError(/`EVENT`.*没有领域模型/s);
  });

  it('往输入里塞一个视图名（QUADRANT）⇒ 失败，报的是"视图不建实体"', async () => {
    const gen = await loadGenerator();
    const input = fixtureInput();
    (input.protocolEntityTypes as string[]).push('QUADRANT');
    (input.modeledEntityTypes as string[]).push('QUADRANT');
    expect(() => gen.buildCapabilityManifest(input)).toThrowError(/视图不建实体/);
  });

  it('登记过的剔除项一旦不在 `EntityModelMap` 里 ⇒ 失败（口径要重拍，不是删一行）', async () => {
    const gen = await loadGenerator();
    expect(() =>
      gen.buildCapabilityManifest(
        fixtureInput({ modeledEntityTypes: ['TASK', 'PROJECT', 'REMINDER', 'AI_FEEDBACK'] }),
      ),
    ).toThrowError(/PREFERENCE_CORRECTION.*已经不在/s);
  });

  it('工具名归因规则逐条对账（防止规则被改名后无人发现）', async () => {
    const gen = await loadGenerator();
    const cases: readonly [string, string][] = [
      ['list_tasks', 'TASK'],
      ['get_task', 'TASK'],
      ['create_task', 'TASK'],
      ['update_task', 'TASK'],
      ['complete_task', 'TASK'],
      ['list_projects', 'PROJECT'],
      ['list_tags', 'TAG'],
      ['create_note', 'NOTE'],
      ['upsert_habit_checkins', 'HABIT_LOG'],
      ['create_habit_log', 'HABIT_LOG'],
      ['create_habit', 'HABIT'],
      // 中心词在后这条规则的**反面对照**：限定语不该抢走归因
      ['list_tasks_by_project', 'TASK'],
      ['get_focuses_by_time', 'FOCUS_SESSION'],
      ['create_reminder', 'REMINDER'],
    ];
    for (const [name, entityType] of cases) {
      expect(gen.attributeToolByName(name).entityType, `${name} 的归因变了`).toBe(entityType);
    }
    // 含糊的名**不该**被认出来（认出来就是猜）
    expect(gen.attributeToolByName('send_ping').entityType).toBeNull();
  });

  it('没登记参数 schema 的工具：清单照出，但**明说**字段可能不完整（不谎报"无参数"）', async () => {
    const gen = await loadGenerator();
    const built = gen.buildCapabilityManifest(
      fixtureInput({
        tools: [
          { name: 'list_tasks', kind: 'read', description: '', schemaRecorded: false, args: [] },
          { name: 'create_task', kind: 'write', description: '', schemaRecorded: true, args: [] },
        ],
      }),
    );
    const flagged = built.tools.find((t) => t.name === 'list_tasks')!;
    expect(flagged.schemaRecorded).toBe(false);
    const lines = gen.renderModelText(built).split('\n');
    const at = lines.findIndex((line) => line.includes('list_tasks'));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1] ?? '').toContain('参数 schema 没有登记');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. 纪律二：拒绝话术必须区分"我没工具"与"产品做不到"
// ─────────────────────────────────────────────────────────────────────────

describe('文本投影表达的是三个状态，不是一句"不支持"', () => {
  const textLines = AI_CAPABILITY_TEXT.split('\n');

  it('每个"没有工具"的实体都在投影里点名，且同一行写清"产品里有它"', () => {
    for (const entityType of manifest.entityTypesWithoutTools) {
      const line = textLines.find((l) => l.startsWith(`- ${entityType}：`));
      expect(line, `投影里没有 ${entityType}`).toBeTruthy();
      expect(line).toContain('产品支持它');
      expect(line).toContain('我没有任何工具');
    }
  });

  it('投影里出现了"两件事必须分开说"这条纪律，并点名它的出处', () => {
    expect(AI_CAPABILITY_TEXT).toContain('拒绝时两件事必须分开说');
    expect(AI_CAPABILITY_TEXT).toContain('我没有这个工具');
    expect(manifest.policy.source).toBe('ADR-0045 §2.6 纪律二');
  });

  it('有工具的实体在投影里**逐个**列出读写与字段（模型要能引用字段名）', () => {
    for (const entity of manifest.entities) {
      if (entity.coverage === 'none' || !entity.countsTowardCoverage) continue;
      for (const name of [...entity.readToolNames, ...entity.writeToolNames]) {
        expect(AI_CAPABILITY_TEXT, `投影里少了工具 ${name}`).toContain(name);
      }
    }
    // 必填标记与上游一致（`get_task` 的 taskId 是必填）
    expect(AI_CAPABILITY_TEXT).toMatch(/get_task（taskId\*:string）/);
  });

  it('投影里的工具行数 == 清单里的工具数（一条不许多、一条不许少）', () => {
    const renderedToolLines = textLines.filter((line) => /^ {2}· \[(读|写)\] \w+/.test(line));
    expect(renderedToolLines.length).toBe(manifest.tools.length);
  });

  it('开头两句同时写出"由代码生成"与覆盖口径（滴答那句谎话的反面）', () => {
    expect(textLines[0]).toContain('不是手写的');
    expect(AI_CAPABILITY_TEXT).toContain('不可以说"产品不支持"');
    expect(AI_CAPABILITY_TEXT).toContain(`（${manifest.coverage.ratio}）`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. 生成物的告示必须在位（防止有人把产物当源码改）
// ─────────────────────────────────────────────────────────────────────────

describe('产物文件头把"改上游而不是改这里"写死', () => {
  const source = readFileSync(ARTIFACT, 'utf8');

  it('点名生成器、--check、以及"这是 prompt 数据不是界面文案"', () => {
    expect(source).toContain('自动生成，请勿手改');
    expect(source).toContain('scripts/gen-ai-capability-manifest.mjs');
    expect(source).toContain('--check');
    expect(source).toContain('不是用户界面文案');
    expect(source).toContain('ADR-0045 §2.6');
  });

  it('刻意**不含**时间戳 —— 有时间戳的生成物每次 --check 都会红，那条门禁就废了', () => {
    expect(source).not.toMatch(/generatedAt|new Date\(\)/);
  });

  it('结构化清单与文本投影都导出了（接线方不必再解析文件）', () => {
    expect(source).toContain('export const AI_CAPABILITY_MANIFEST');
    expect(source).toContain('export const AI_CAPABILITY_TEXT');
    expect(typeof AI_CAPABILITY_TEXT).toBe('string');
    expect(manifest.manifestVersion).toBe(1);
  });
});
