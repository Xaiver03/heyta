/**
 * 保留期文案的事实性闸门（缺陷 D8 / 工单 A3 的钉子）
 * ==================================================
 *
 * ## 为什么这份文件存在，而 `structure.spec.ts` 挡不住它
 *
 * `structure.spec.ts` 文件头自己写得很清楚：那套判据**只保证形态**
 * （中英逐段镜像、`**` 成对、`docRef` 指得到、主体名字不是别人的），
 * 「不保证这句话是真的」。而 2026-10-03 实测到的正是一句**形态完整、中英对齐、
 * 内容核验不过**的承诺：四段文案都写着"承载删除的那段加密历史会在保留期
 * （45 天）届满后被清理"。
 *
 * 🔴 那句清理**在我们的数据上一条都不会命中**：服务端
 * `deleteOldSyncedOpsForAllUsers()` 的候选集要求该账号的流水里存在一条
 * **因果全量 op**（`SYNC_IMPORT` / `BACKUP_IMPORT` / 带 `repairBaseServerSeq`
 * 的 `REPAIR`，见 `server/src/sync/sync.types.ts` 的
 * `CAUSAL_FULL_STATE_OPERATION_WHERE`），而 heyta 的客户端只产 `CRT`/`UPD`/`DEL`
 * ⇒ 每日任务的删除条数恒为 0。文档一旦生效，这句话就是一条**可以被监管核验、
 * 且核验不过**的陈述。
 *
 * ## 判据的形状（为什么不是"禁掉 45 天"）
 *
 * 45 天这个窗口**真的写在代码里**（`sync.types.ts` 的 `RETENTION_MS`），
 * 而**设备记录**那条路确实每天在清（`device.service.ts` 的 `deleteStaleDevices`
 * 只看 `lastSeenAt`，不挂任何边界）—— 所以"不许出现 45 天"会把一条**真话**也打死。
 *
 * 于是这条闸门判的是**语义配对**，作用单位是"一个段落 / 一个列表项 / 一行表格"
 * （表格一行算一个单位：`45 天` 在第二格、`每日清扫` 在第三格，拆开看两边都不完整）：
 *
 *   一个单位若同时 (a) 在说**同步事件 / 承载它的那段加密历史**、
 *   (b) 提到**保留期或那个天数**、(c) 说它**会被清理/删除**，
 *   它就**必须**同时交代当前的生效条件（`完整状态边界` / `full-state boundary`，
 *   或"一条都不命中 / 当前不会定期清理"这类限定）。
 *
 * 这样将来任何人再抄一句"45 天之后就清了"，红；把设备记录那条真话留着，绿。
 * 第三条用例还钉住"不许为了让这条绿而把真话改成假话"。
 *
 * ⚠️ 它只管这一类。限定语齐全但数字抄错的段落它挡不住 —— 数字对不对要靠
 * `docs/research/legal-dataflow-server.md` 那张表与被引的 `file:line` 复跑。
 */

import { describe, expect, it } from 'vitest';

import type { LegalBlock, LegalDocument, LegalSection } from '../src/types.js';
import { LEGAL_DOCUMENTS } from '../src/index.js';

/**
 * 一个块拆成**可判读的语言单位**。
 *
 * 🔴 表格按**行**而不是按格：`['同步事件…', '**45 天**', '每日定时任务自动清扫…']`
 * 这一整行才是那句承诺；逐格看的话第三格不含天数、第二格不含"清扫"，
 * 三条同时命中的判据会整行漏掉（这就是"拆开看两边都对、合起来是假的"的形状）。
 */
function unitsOfBlock(block: LegalBlock): string[] {
  switch (block.kind) {
    case 'p':
    case 'callout':
    case 'docRef':
      return [block.text];
    case 'ul':
    case 'ol':
      return [...block.items];
    case 'table':
      return block.rows.map((row) => row.join(' | '));
  }
}

function allUnits(document: LegalDocument): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const walk = (locale: string, sections: readonly LegalSection[]): void => {
    for (const section of sections) {
      const at = `${document.id}/${locale}#${section.id}`;
      for (const block of section.blocks ?? []) for (const text of unitsOfBlock(block)) {
        out.push({ where: at, text });
      }
      walk(locale, section.subsections ?? []);
    }
  };
  for (const [locale, sections] of Object.entries(document.sections)) walk(locale, sections);
  return out;
}

/** (a) 在说"同步事件 / 承载它的那段历史"，而不是设备记录、备份、访问日志。 */
const ABOUT_SYNC_EVENTS = /同步事件|加密历史|密文操作日志|sync events?|encrypted history|ciphertext operation log/i;
/** (b) 提到那个窗口 —— 没有窗口就谈不上"承诺按期清理"。 */
const MENTIONS_RETENTION = /保留期|45 天|retention|45[- ]day|45 days/i;
/** (c) 说它会被清掉。*/
const CLAIMS_IT_IS_CLEANED = /清理|清除|清扫|清掉|届满|将被|会删|被删|销毁|prune|sweep|expir|cleared|destroyed/i;
/** 已经如实交代了"当前不生效"的那一半。 */
const CARRIES_THE_QUALIFIER =
  /完整状态边界|full-state boundary|当前不会定期清理|一条都不|一条也|不会命中|不命中|不删|恒为 0|生效条件|not periodically pruned|never reaches|does not work today|matches no data|not pruned/i;

/**
 * 判定器本身。单独抽出来是为了能**喂它一句已知是假的话**（见"牙齿"那条用例）——
 * 一个从没被假样本触发过的判据，绿了也不说明任何东西。
 */
function isOffender(text: string): boolean {
  return (
    ABOUT_SYNC_EVENTS.test(text) &&
    MENTIONS_RETENTION.test(text) &&
    CLAIMS_IT_IS_CLEANED.test(text) &&
    !CARRIES_THE_QUALIFIER.test(text)
  );
}

describe('保留期文案的事实性（A3 / 缺陷 D8）', () => {
  it('🔴 凡是"同步事件会在保留期届满后被清理"的段落，都必须交代当前的生效条件', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const document of LEGAL_DOCUMENTS) {
      for (const { where, text } of allUnits(document)) {
        if (!ABOUT_SYNC_EVENTS.test(text) || !MENTIONS_RETENTION.test(text)) continue;
        checked += 1;
        if (isOffender(text)) offenders.push(`${where}: ${text.slice(0, 160)}…`);
      }
    }

    // 阳性对照：这条闸门**必须有东西可判**。一条都没扫到 = 作用面写坏了
    //（needle 漂了），那时"零违规"什么都不是。
    expect(checked, '一条都没扫到 ⇒ 探针坏了，不是文案干净').toBeGreaterThan(0);
    expect(
      offenders,
      '有段落承诺同步事件会被按期清理，却没交代它当前不生效：\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('🔴🔴 判据自己有牙齿：把撤掉的那句原文喂回去，必须判红', () => {
    // 这四条字面串就是本轮改掉的原文（逐字来自 `packages/legal/src/documents/*` 的旧版本：
    // 3 条中文 + 1 条英文）。字符串条数请以此数组为准，别在注释里另记一份数字。
    // 断言的是**分类器**，不是文案 —— 分类器哪天被改宽到连这种句子都放行，
    // 这条先红，而不是等到下一次有人抄一份假承诺。
    const withdrawn = [
      // privacy.ts（旧 :485）
      '**删除**：✅ 应用内的删除在事件模型里是**追加一条删除事件**，不是抹掉记录。它从你的所有设备与界面上消失，但服务器上承载它的加密历史记录会在**保留期（当前 45 天）届满后**被清理掉。',
      // data-rights.ts（旧状态表那一格）
      '对应的加密历史仍在，直到保留期届满或账号注销',
      // personal-info-list.ts（旧表格那一行，跨格才成立）
      '同步事件（密文操作日志）与设备记录 | **45 天** | 每日定时任务自动清扫。删除条数**即使为 0 也会记一条日志**',
      // 英文侧同样撤掉的那句
      'The encrypted history remains until retention expires or the account is closed',
    ];
    for (const text of withdrawn) {
      expect(isOffender(text), `这句假话没被判红：${text.slice(0, 60)}…`).toBe(true);
    }

    // 反向对照：本轮写下的实话**不该**被判红（否则上面那条"全绿"只是因为判据
    // 见谁都红）。逐条点名，不靠整体计数——整体计数挡不住"两条假两条真"。
    const honest = [
      '同步事件（密文操作日志）与设备记录 | **45 天窗口**，但两类要分开说：**设备记录**确实按这个窗口每日清扫；**同步事件当前一条都不会被清掉**——那条清扫只处理已经存在「完整状态边界」的账号',
      'The encrypted history is not periodically pruned today; it only acts on accounts containing a “full-state boundary”.',
    ];
    for (const text of honest) {
      expect(isOffender(text), `这句实话被误判：${text.slice(0, 60)}…`).toBe(false);
    }
  });

  it('🔴 三份文档都真的把这条边界写出来了（不是只在一份里改）', () => {
    // 抄件漂移的标准形状就是"改了一处、其余还留着旧话"。这里逐份点名，
    // 而不是数全仓命中数 —— 全仓 3 次命中可能全在同一份文件里。
    const ids = ['privacy', 'personal-info-list', 'data-rights'];
    for (const id of ids) {
      const document = LEGAL_DOCUMENTS.find((d) => d.id === id);
      expect(document, `找不到文档 ${id}（id 变了就是这份判据要先改）`).toBeDefined();
      const zh = allUnits(document!).filter((u) => u.where.includes('/zh-CN#'));
      const en = allUnits(document!).filter((u) => u.where.includes('/en#'));
      expect(
        zh.some((u) => /完整状态边界/.test(u.text)),
        `${id} 中文侧没有「完整状态边界」这条限定`,
      ).toBe(true);
      expect(
        en.some((u) => /full-state boundary/.test(u.text)),
        `${id} 英文侧没有 full-state boundary 这条限定（中英必须同时补）`,
      ).toBe(true);
    }
  });

  it('🔴 设备记录那条**真话**不许被顺手改假（防"为绿而改"的反向护栏）', () => {
    // 上一条判据逼着人给每段加限定；而设备行的每日清扫是**真的在跑**
    //（`deleteStaleDevices` 只按 `lastSeenAt` 判，不挂因果边界）。
    // 如果有人为了让判据"形状统一"把设备那行也改成"不清理"，那是把真话改成假话。
    const privacy = LEGAL_DOCUMENTS.find((d) => d.id === 'privacy')!;
    const rows = unitsOfTable(privacy, /设备记录|Device records/i);
    expect(rows.length, '隐私政策里那行设备记录不见了').toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        /删除|直接删|deleted/i.test(row),
        `设备记录那行必须仍然说"会删"（它是每日真在执行的）：${row.slice(0, 120)}…`,
      ).toBe(true);
      // 真话也不许被写成承诺之外的另一种假话：不许出现"永远不删"
      expect(row).not.toMatch(/不会删|永不删|never deleted/i);
    }
  });
});

/** 把某份文档里**表头含这些字**的表格行拼出来（行 = 各格 join）。 */
function unitsOfTable(document: LegalDocument, firstCell: RegExp): string[] {
  const out: string[] = [];
  const walk = (sections: readonly LegalSection[]): void => {
    for (const section of sections) {
      for (const block of section.blocks ?? []) {
        if (block.kind !== 'table') continue;
        for (const row of block.rows) {
          const joined = row.join(' | ');
          if (firstCell.test(joined)) out.push(joined);
        }
      }
      walk(section.subsections ?? []);
    }
  };
  for (const sections of Object.values(document.sections)) walk(sections);
  return out;
}
