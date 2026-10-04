/**
 * 中英结构对账 + 对外承诺的形态闸门
 * ===================================
 *
 * 🔴 **本包不受 `check:ui-language` 管辖**（它扫各端的 `apps` 下的 `src`），
 * 所以"中英不许漂移"这件事**只有这里在管**。这不是补一个空缺，
 * 换的是**一类闸门**：词条表靠 `Record<MessageKey, string>` 的多余属性检查在编译期红，
 * 而"两份语言的结构相同"这种性质类型表达不了（`Record<Locale, LegalSection[]>`
 * 两边都是同一个类型），只能用测试表达。
 *
 * 于是这里钉四件事，前三件都是**类型永远管不到**的：
 *
 *   1. **结构逐段镜像**：小节 id 序列、每节块数、块的 `kind` 顺序、
 *      表格的表头长度与每行单元格数、有序/无序列表的项数、子小节递归 —— 全部一一对应。
 *      漂移的形态是"英文版少一段"，而它**在页面上看不出来**（少一段读起来仍然通顺），
 *      只会让中英两版对外承诺的范围不同 —— 法务场景里这是最坏的一类缺陷。
 *   2. **行内标记平衡**：`**` 与反引号必须成对，且**不许出现** `<`、Markdown 链接、
 *      裸 URL。渲染器（落地页 `RichText`）只支持 `**粗**` 与 `` `代码` `` 两种，
 *      写进别的标记不是"少渲染一个样式"，是**在页面上留下字面的星号或尖括号**。
 *   3. **`docRef` 的目标必须存在**：指向一份不存在的文件，在页面上会渲染成
 *      一段引用了自己也没有的文本的死链接。
 *   4. **主体与备案号**：不得出现**别人的**名字（上游德语 AGB 的服务提供者），
 *      不得出现任何**尚未核准**的 App 备案号，不得留下模板占位符。
 *
 * ⚠️ 这套判据**只保证形态**，不保证"这句话是真的"。
 * 事实性靠 §`docs/plans/legal-compliance-before-filing.md` §1 那张表：
 * 每一条"我们做/不做 X"要能指回一份 `docs/research/legal-dataflow-*.md`。
 * 结构测试挡不住一个结构完整、中英对齐、但**内容编造**的文件 —— 它压根没这个能力。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { LegalBlock, LegalDocument, LegalSection } from '../src/types.js';

import { LEGAL_DOCUMENTS, OPERATOR, legalSetVersion, legalTitle } from '../src/index.js';

/**
 * 本包的语言清单**钉死在两个**。
 *
 * 🔴 为什么不用 `LOCALES`（`@heyta/i18n/provider`）：那是**界面文案**的语言集合，
 * 以后加第三种语言时它一定会扩，而对外法律文本加语言是一个**独立的法务决定**
 * （每种语言都要有人对它的措辞负责）。用 `LOCALES` 会让"加了个界面语言"
 * 静默变成"一份没有法务复核的外文法律文本"。
 * 加语言要改这里，改这里就要想一遍。
 */
const LEGAL_LOCALES = ['zh-CN', 'en'] as const;

type LegalShape =
  | { readonly kind: 'block'; readonly type: string }
  | { readonly kind: 'section'; readonly id: string; readonly shape: readonly LegalShape[] };

/** 把一个 locale 的整棵小节树压成**可比较的形状**（文字全部丢掉，只留结构）。 */
function shapeOf(sections: readonly LegalSection[]): readonly LegalShape[] {
  return sections.map((section) => ({
    kind: 'section' as const,
    id: section.id,
    shape: [
      ...(section.blocks ?? []).map((block) => ({ kind: 'block' as const, type: blockType(block) })),
      ...shapeOf(section.subsections ?? []),
    ],
  }));
}

/**
 * 块的形状标识 —— **把表格与列表的"几列几行几项"也算进形状**。
 *
 * 只比 `kind` 是不够的：英文版把一张六行的表写成五行，`kind` 完全相同，
 * 而页面上访客看到的清单少一项 —— 那正是"两版对外承诺范围不同"的形状。
 */
function blockType(block: LegalBlock): string {
  switch (block.kind) {
    case 'table':
      return `table(${block.head.length}x${block.rows.length}[${block.rows
        .map((row) => row.length)
        .join(',')}])`;
    case 'ul':
    case 'ol':
      return `${block.kind}(${block.items.length})`;
    case 'docRef':
      return `docRef(${block.docId})`;
    default:
      return block.kind;
  }
}

/** 把一棵小节树上的每一段可渲染文字推进 `texts`（含小节标题与表格单元格）。 */
function pushTexts(sections: readonly LegalSection[], texts: string[]): void {
  for (const section of sections) {
    texts.push(section.title);
    for (const block of section.blocks ?? []) {
      switch (block.kind) {
        case 'p':
        case 'callout':
          texts.push(block.text);
          break;
        case 'docRef':
          texts.push(block.text);
          break;
        case 'ul':
        case 'ol':
          texts.push(...block.items);
          break;
        case 'table':
          texts.push(...block.head, ...block.rows.flat());
          break;
      }
    }
    pushTexts(section.subsections ?? [], texts);
  }
}

/** 遍历整棵树上的每一段可渲染文字（含标题、摘要、表格单元格）—— **两栏合并**。 */
function allTexts(document: LegalDocument): readonly string[] {
  const texts: string[] = [
    ...Object.values(document.title),
    ...Object.values(document.summary),
  ];
  pushTexts(document.sections['zh-CN'], texts);
  pushTexts(document.sections.en, texts);
  return texts;
}

/**
 * 只取**某一语言栏**的文字。
 *
 * 判"英文栏里有没有带登记名称"这类问题必须用这个：`allTexts` 是两栏合并的，
 * 中文栏天生带着登记名称，用它判会得到"永远满足"的假绿。
 */
function columnTexts(
  document: LegalDocument,
  locale: (typeof LEGAL_LOCALES)[number],
): readonly string[] {
  const texts: string[] = [document.title[locale], document.summary[locale]];
  pushTexts(document.sections[locale], texts);
  return texts;
}

const ids = LEGAL_DOCUMENTS.map((document) => document.id);

describe('@heyta/legal 的注册表自身', () => {
  it('id 唯一，且是 URL 安全的小写短横线', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, `id "${id}" 会直接进 URL（/legal/<id>/）`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('每份文件在两种语言下都有标题与摘要，且都不为空', () => {
    for (const document of LEGAL_DOCUMENTS) {
      for (const locale of LEGAL_LOCALES) {
        expect(document.title[locale]?.trim(), `${document.id} 缺标题`).toBeTruthy();
        expect(document.summary[locale]?.trim(), `${document.id} 缺摘要`).toBeTruthy();
        expect(legalTitle(document.id, locale)).toBe(document.title[locale]);
      }
    }
  });

  it('legalSetVersion() 含每份文件的 id@version，且与数组顺序无关', () => {
    const version = legalSetVersion();
    for (const document of LEGAL_DOCUMENTS) {
      expect(version).toContain(`${document.id}@${document.version}`);
    }
    expect(version.split(';').length).toBe(LEGAL_DOCUMENTS.length);
    // 排序拼接：字典序，所以与声明顺序无关（声明顺序变了不该改变指纹）。
    expect(version).toBe(
      [...LEGAL_DOCUMENTS]
        .map((document) => `${document.id}@${document.version}`)
        .sort()
        .join(';'),
    );
  });
  it('docRef 指向的文件必须真的存在', () => {
    // 🔴 这条管的是本包**唯一**的跨文件引用机制。渲染器从注册表解析 URL，
    // 所以目标写错的表现不是编译期红（`docId` 是 `string`，不是联合类型），
    // 而是页面上出现一句"见《…」"却点不出东西 —— 法务文本里的死链接
    // 与"没有这条引用"一样是可达性缺陷。
    const refs: { from: string; to: string }[] = [];
    const walk = (document: LegalDocument, sections: readonly LegalSection[]): void => {
      for (const section of sections) {
        for (const block of section.blocks ?? []) {
          if (block.kind === 'docRef') refs.push({ from: document.id, to: block.docId });
        }
        walk(document, section.subsections ?? []);
      }
    };
    for (const document of LEGAL_DOCUMENTS) walk(document, document.sections['zh-CN']);
    expect(refs.length, '一条 docRef 都没有 = 这条判据是装饰，先确认它抓过东西').toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ids, `${ref.from} 引用了注册表里不存在的 ${ref.to}`).toContain(ref.to);
    }
  });
});

describe('每份文本的元信息纪律', () => {
  for (const document of LEGAL_DOCUMENTS) {
    it(`${document.id}：版本、日期、状态三者自洽`, () => {
      expect(document.version, '版本号要写进同意记录，不许空').toMatch(/^\d+\.\d+/);
      expect(document.updatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (document.status === 'draft') {
        // 🔴 草案没有生效日期。写了就等于宣布"这一版已经对用户发生效力"。
        expect(document.effectiveDate, 'draft 文本不许有生效日期').toBeUndefined();
      } else {
        expect(document.effectiveDate, 'effective 文本必须有生效日期').toBeTruthy();
      }
    });

    it(`${document.id}：小节 id 在同一份文件里唯一`, () => {
      const seen: string[] = [];
      const walk = (sections: readonly LegalSection[]): void => {
        for (const section of sections) {
          seen.push(section.id);
          walk(section.subsections ?? []);
        }
      };
      walk(document.sections['zh-CN']);
      expect(new Set(seen).size, `重复的锚点 id 会让深链接指错地方：${seen.join(',')}`).toBe(
        seen.length,
      );
    });
  }
});

describe('中英逐段镜像（本包唯一的语言对齐闸门）', () => {
  for (const document of LEGAL_DOCUMENTS) {
    it(`${document.id}：两版结构逐一对应`, () => {
      const zh = shapeOf(document.sections['zh-CN']);
      const en = shapeOf(document.sections.en);
      // 逐字比对而不是 toEqual：形状以 `table(5x6[5,5,5,5,5])` 这种形式出现，
      // 差异一眼能读出是"哪一节哪张表少了一行"，不必再去翻对象。
      expect(JSON.stringify(en), `${document.id} 英文版结构与中文版不一致`).toBe(
        JSON.stringify(zh),
      );
    });

    it(`${document.id}：两版都只声明 ${LEGAL_LOCALES.join('/')} 这两种语言`, () => {
      expect(Object.keys(document.sections).sort()).toEqual([...LEGAL_LOCALES].sort());
      expect(Object.keys(document.title).sort()).toEqual([...LEGAL_LOCALES].sort());
      expect(Object.keys(document.summary).sort()).toEqual([...LEGAL_LOCALES].sort());
    });
  }
});

describe('行内标记与渲染器能表达的东西一致', () => {
  for (const document of LEGAL_DOCUMENTS) {
    it(`${document.id}：标记成对、无 HTML、无裸链接、无占位符`, () => {
      for (const text of allTexts(document)) {
        const label = text.slice(0, 32);
        // `**` 的计数按"星号对的个数"算：连续的 *** 会算出奇数，那正是想要的报错。
        const stars = (text.match(/\*/g) ?? []).length;
        expect(stars % 2, `${label}… 里有落单的星号`).toBe(0);
        const ticks = (text.match(/`/g) ?? []).length;
        expect(ticks % 2, `${label}… 里有落单反引号`).toBe(0);
        // 🔴 下面三条查的是**散文**，所以先把 `` `代码` `` 摘掉。
        // 理由不是宽容，是那条标记本来就只支持两种：代码段里的 `<path>`、
        // `http://…`、`[x](y)` 会**按字面渲染**，而那正是想要的效果
        // （法律文本里在讲"命令行参数长什么样"、"自建地址是 http:// 开头"）。
        // 不摘掉它们，闸门会在真实内容上判红 —— 而一个总在红闸门上的
        // 后果不是"没人写代码段"，是"下次真违规也被人当噪音跳过"。
        const prose = text.replace(/`[^`]*`/g, '');
        expect(prose, `${label}… 不许在散文里出现 HTML（渲染器不解析它）`).not.toMatch(/[<][a-zA-Z/]/);
        expect(prose, `${label}… 不许在散文里出现 Markdown 链接`).not.toMatch(/\]\(/);
        expect(prose, `${label}… 不许在散文里出现裸 URL（指向另一份文件走 docRef 块）`).not.toMatch(
          /https?:\/\//,
        );
        // 模板占位符：服务端那份英文模板就是这么把 "[Contact Name]" 发出去的。
        // 这条**不摘代码段** —— 占位符写在哪都是占位符。
        expect(text, `${label}… 是未替换的占位符`).not.toMatch(
          /\{\{|\[Contact|TODO|TBD|待填|XXX|示例\.com/,
        );
      }
    });
  }
});

describe('对外承诺里的主体不许错', () => {
  const allText = LEGAL_DOCUMENTS.flatMap((document) => allTexts(document));

  it.each([
    ['Super Productivity', '那是上游项目的名字，不是 heyta 的'],
    ['SuperSync', '同上：服务端 vendored 自它，但对外主体不是它'],
    ['Johannes Millan', '上游德语 AGB 的服务提供者，与 heyta 无关'],
    ['[Your Company', '模板占位符'],
  ])('正文里不出现 %s（%s）', (needle, why) => {
    const hits = allText.filter((text) => text.includes(needle));
    expect(hits, `${why}；命中 ${hits.length} 处：${hits.map((h) => h.slice(0, 40)).join(' | ')}`)
      .toEqual([]);
  });

  it('备案号：正文里出现的每一个 ICP 编号都必须就是 OPERATOR 那一个', () => {
    // 🔴 这条管的**不是**"不许印备案号" —— 隐私政策本来就该公布备案号
    //（《互联网信息服务管理办法》与商店提审都看这一行）。管的是**漂移**：
    // 编号在 `OPERATOR.icpNumber` 有一份，在九份文件的正文里各有一份，
    // 换主体/换号时改一处漏八处，而对外承诺里一个错的备案号比不写更坏
    //（它把责任指向一个不存在的备案）。所以判据是"只能等于那一个"。
    const seen = new Set<string>();
    for (const text of allText) {
      for (const match of text.matchAll(/[京津沪粤浙苏鲁闽桂]{1}ICP备\d{6,}号/g)) {
        seen.add(match[0]);
      }
    }
    for (const number of seen) {
      expect(number, `正文里的备案号与 OPERATOR.icpNumber 不一致`).toBe(OPERATOR.icpNumber);
    }
    // 反向也要成立：本主体**有**已核准的 ICP 备案号（`OPERATOR.icpNumber`
    // 不是可空字段，它就是备案主体那份事实），九份正文里却一处都没印 = 漏写。
    expect(seen.size, 'OPERATOR 有 ICP 备案号，但九份正文里一处都没出现').toBeGreaterThan(0);
  });

  it('App 备案号：核准之前正文里不许出现任何编号，核准之后必须就是 OPERATOR 那一个', () => {
    // 未核准时写一个编号 = 编造。核准后如果正文与字段不一致 = 漂移。两种都要红。
    const numbered = allText.filter((text) => /App\s*备案号\s*[浙京沪粤]\s*ICP|\[[^\]]*待核准[^\]]*\]/.test(text));
    if (OPERATOR.appFilingNumber === null) {
      expect(numbered, 'App 备案号尚未核准，正文却出现了编号').toEqual([]);
    } else {
      for (const text of numbered) {
        expect(text).toContain(OPERATOR.appFilingNumber);
      }
    }
  });

  it('联系邮箱与 OPERATOR 那份一致，不在九份文件里各写一遍', () => {
    // 🔴 TLD 必须是**字母**：`[\w.]+` 会把同意指纹 `terms@1.0` 也当成邮箱
    //（那个字符串就出现在权利行使那一份里，讲的是"你同意的是哪一套文本"）。
    const emails = new Set(
      allText.flatMap((text) => [
        ...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g),
      ]).map((m) => m[0]),
    );
    for (const email of emails) {
      expect(email, `正文里出现了 OPERATOR 之外的联系邮箱 ${email}`).toBe(OPERATOR.contactEmail);
    }
  });

  it('英文栏引用了信用代码的文本，必须同时给出登记的中文主体名称', () => {
    // G-31 的来历：`terms` 的英文栏只有转写名 `Xiaoli (Hangzhou) …`，而主体名称以登记
    // 文字为准 —— 服务条款是九份里**唯一规定合同主体**的那份，缺它的英文读者只能看到
    // 一个音译。这条判据**必须按语言栏分别取文**（见 `columnTexts` 的注释）：中文栏天生
    // 带着登记名称，用两栏合并的 `allTexts` 判会得到一条永远满足的假绿。
    let citing = 0;
    for (const document of LEGAL_DOCUMENTS) {
      const en = columnTexts(document, 'en').join('\n');
      if (!en.includes(OPERATOR.code)) continue;
      citing += 1;
      expect(
        en,
        `${document.id}：英文栏引用了信用代码 ${OPERATOR.code}，却没有一处给出登记名称「${OPERATOR.name}」`,
      ).toContain(OPERATOR.name);
    }
    // 反向：这条规则不能退化成"没有任何文本引用信用代码"的空判据。
    expect(citing, '没有一份文本的英文栏引用信用代码 —— 这条判据已经悬空').toBeGreaterThan(0);
  });
});

/**
 * 对外承诺里**可复算的数字**必须与它的数据源对账。
 *
 * 🔴 为什么单独立一条，而不是"改的时候记得一起改"：隐私政策里那句「注销是真删除」是对
 * `DELETE /api/account` 行为的**事实性承诺**（PIPL 第四十七条 / GDPR 第十七条"删除权"
 * 到底删了多少东西）。它由一份 research 文档抄进文案 —— 而**抄件一定会漂**。
 * 2026-10-03 实测漂过两次：R10 加 `user_avatars` 后真值变了而文本没跟；
 * 而 `data-rights.ts` 与三份 research 文档抄走的是**另一个数**（18），无人值守。
 *
 * ⚠️ **本条的口径在 2026-10-03 被更正过一次，原口径是错的**：
 * 原来数的是"全部迁移里 `ON DELETE CASCADE` 的出现次数"（当时 = **19**），
 * 而那句话承诺的是"**我名下的数据**随注销消失"。两个口径不是一回事：
 * 前者把与被删账号无关的级联（例如 `coupon_redemptions → checkout_orders`）算进来，
 * 还把同一条约束在后续迁移里被重建的那几次**重复计数**（42 个迁移文件是累加的历史，不是当前状态）。
 * 现量三种口径：出现次数 19、`schema.prisma` 声明的 Cascade 代码行 16、
 * **引用 `users` 且 CASCADE 的外键 16 条 / 覆盖 15 张表**（`referrals` 有邀请人、被邀请人两条）。
 * ⇒ 这里改成从迁移里推导"**引用 users 且 CASCADE**"的约束**集合**，
 *   并且除了比数字，还要求文案**逐类点名**每一张表（少一类就红 —— 那才是用户读得到的东西）。
 *
 * ⚠️ **2026-10-04 补**：上面那组"现量 16 条 / 15 张表"已经漂了 —— 本判据今天量到
 * **19 条 / 18 张表**（增量是 vault 批次 ADR-0050 新长的 `vault_key_packages` /
 * `vault_key_migrations` / `revoked_sync_devices`）。旧数字留着是 10-03 那次更正的现场，
 * **不要照它们抄文案**：本轮 `data-rights` 第六节那行就是这么抄的，被这条判据当场报红。
 * 文案里的数字只能从 `userCascades.size` / `cascadeTables.length` 来，不能从注释、ADR 或上一版文案来。
 */
describe('对外文本里可复算的数字，回到真源对账', () => {
  /** 迁移目录相对本包：`packages/legal/tests` → 仓库根的 `server/prisma/migrations`（上三级）。 */
  const MIGRATIONS = fileURLToPath(new URL('../../../server/prisma/migrations', import.meta.url));

  /**
   * 从迁移历史推导"注销一个账号时真的会随 `users` 行消失的外键约束"。
   * 按**约束名**建账：后面某条迁移把它改成非 CASCADE（或重建）就撤账，
   * 所以 42 个文件的累加历史不会变成重复计数。
   */
  const userCascades = (() => {
    const live = new Map<string, string>();
    for (const rel of readdirSync(MIGRATIONS, { recursive: true })
      .filter((p): p is string => typeof p === 'string' && p.endsWith('migration.sql'))
      .sort()) {
      const sql = readFileSync(join(MIGRATIONS, rel), 'utf8');
      for (const raw of sql.split(';')) {
        const s = raw.replace(/\s+/g, ' ');
        for (const m of s.matchAll(
          /CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\("([^"]+)"\)\s+REFERENCES\s+"([^"]+)"/gi,
        )) {
          if (m[3] !== 'users') continue;
          const [, name, column] = m;
          if (name === undefined || column === undefined) {
            throw new Error('Foreign-key constraint match is missing its name or column');
          }
          const tail = s.slice(m.index);
          const od = tail.match(/ON DELETE (CASCADE|RESTRICT|SET NULL|SET DEFAULT)/i);
          // 表名 = 约束名去掉 `_<列名>_fkey`（Postgres 默认命名 `<表>_<列>_fkey`）。
          // 🔴 以前这里是 `name.split('_')[0]`，于是 `account_notifications_user_id_fkey`
          //    被切成 `account`、`checkout_orders_user_id_fkey` 被切成 `checkout` ——
          //    整个类别覆盖判据会拿着七个假表名去要求文案点名，红的原因和真的缺陷无关。
          //    对不上这个形状就**响亮地失败**，不静默猜表名。
          const suffix = `_${column}_fkey`;
          if (!name.toLowerCase().endsWith(suffix)) {
            throw new Error(
              `约束名 "${name}" 不是 Postgres 默认的 "<表>_<列>_fkey" 形状，` +
                '推不出表名 —— 这里被手工命名过，判据要先跟着改（不许退回按第一个下划线切）',
            );
          }
          const table = name.slice(0, name.length - suffix.length);
          if (od?.[1]?.toUpperCase() === 'CASCADE') live.set(name, table);
          else live.delete(name);
        }
      }
    }
    return live;
  })();

  const cascadeTables = [...new Set(userCascades.values())].sort();

  /**
   * 每张表**必须**在文案里有一个用户读得到的类别名。这里是判据的期望值（不是第二份真源）：
   * 表名来自上面的推导，而"这一类在中文里叫什么"是人话，只用来检查文案有没有漏掉一类。
   */
  const CATEGORY_NAMES: Array<{ table: string; zh: string; en: string }> = [
    { table: 'operations', zh: '同步事件', en: 'sync event' },
    { table: 'vault_key_packages', zh: '加密密钥包', en: 'wrapped key package' },
    { table: 'vault_key_migrations', zh: '密钥迁移记录', en: 'key migration record' },
    { table: 'revoked_sync_devices', zh: '撤销设备记录', en: 'revoked device record' },
    { table: 'user_sync_state', zh: '同步状态', en: 'sync state' },
    { table: 'sync_devices', zh: '设备记录', en: 'device record' },
    { table: 'passkeys', zh: '通行密钥', en: 'passkey' },
    { table: 'pending_passkey_registrations', zh: '未完成的通行密钥注册', en: 'pending passkey registration' },
    { table: 'subscriptions', zh: '订阅', en: 'subscription' },
    { table: 'checkout_orders', zh: '订单', en: 'checkout order' },
    { table: 'coupon_redemptions', zh: '优惠码核销', en: 'coupon redemption' },
    { table: 'invite_codes', zh: '邀请码', en: 'invite code' },
    { table: 'referrals', zh: '邀请关系', en: 'referral' },
    { table: 'account_notifications', zh: '通知', en: 'notification' },
    { table: 'user_avatars', zh: '头像', en: 'avatar' },
    { table: 'user_consents', zh: '条款接受记录', en: 'consent' },
    { table: 'tombstones', zh: '墓碑', en: 'tombstone' },
    { table: 'widget_push_subscriptions', zh: '推送订阅', en: 'push subscription' },
    // 2026-10-03 vault 批次（ADR-0050）新长的三张级联表。
    { table: 'vault_key_packages', zh: '密钥包', en: 'key package' },
    { table: 'vault_key_migrations', zh: '密钥迁移记录', en: 'key migration record' },
    { table: 'revoked_sync_devices', zh: '撤销设备记录', en: 'revoked device record' },
  ];

  it('🔴 推导本身有产出（数不出约束 = 探针坏了，不是"没有级联"）', () => {
    // 前提断言：目录/正则/约束名形状任一失效都会得到空集合，而空集合能让下面每一条"对账"
    // 都变成恒真 —— 所以先证明探针能数到东西，再谈数字对不对。
    expect(userCascades.size, `在 ${MIGRATIONS} 下推导到 0 条「引用 users 且 CASCADE」的约束 —— 先怀疑这个探针`).toBeGreaterThan(0);
    // 正向对照：这两张表是"我的任务数据"的载体，它们必须在集合里；
    // 不在就说明推导口径被改坏了（改名、改约束名形状、或级联被摘掉）。
    expect(cascadeTables).toEqual(expect.arrayContaining(['operations', 'user_sync_state']));
  });

  it('🔴 每张随注销消失的表都在文案里有一个用户读得到的类别名', () => {
    // 判据的"牙齿"在这条：数字对得上但漏列一类（原句就漏了 5 类）同样是对外少承诺了范围。
    const missing = cascadeTables.filter(
      (t) => !CATEGORY_NAMES.some((c) => c.table === t),
    );
    expect(
      missing,
      `这些表会随注销被级联删除，但文案里没有任何一处点到它们这一类：${missing.join(', ')}`,
    ).toEqual([]);
    // 反向防悬空：登记的类别不许比真源多（多出来的那类要么已被取消级联、要么表名写错了）。
    const extra = CATEGORY_NAMES.filter((c) => !cascadeTables.includes(c.table)).map((c) => c.table);
    expect(extra, `登记了这些类别，但真源里没有对应的 users 级联约束：${extra.join(', ')}`).toEqual([]);
  });

  it('🔴 所有抄了「N 处级联 / N cascades / N foreign keys」的文档、中英两栏，都等于真源条数', () => {
    // 三个可复算的量各自有形状：级联**条数**、覆盖的**表数**（`referrals` 有两条外键，
    // 所以条数 ≠ 表数），以及下面那条"逐类点名"的判据。只钉第一个的话，
    // "16 条级联、12 张表"这种半对的写法会溜过去。
    //
    // 🔴 **形状必须中英各列一遍**（2026-10-04 实测补）：这一条以前只认
    // `共 N 处级联`/`覆盖 N 张表`/`N cascades … total`/`across N tables` 四种写法，
    // 而英文 GDPR 那行写的是 `19 foreign keys … covering 18 tables` —— **四种都不匹配**。
    // 于是 `data-rights` 英文栏把旧数 `16 / 15` 原样对外发布，而本套件 66 条全绿。
    // 少一种形状 = 那一格没有任何一层在守（同一条纪律见 `docs/plans/trash-and-archive.md` §10.16）。
    const checks: Array<{ pattern: RegExp; truth: number; label: string }> = [
      { pattern: /共\s*(\d+)\s*处级联/g, truth: userCascades.size, label: '处级联' },
      { pattern: /覆盖\s*(\d+)\s*张表/g, truth: cascadeTables.length, label: '张表' },
      { pattern: /(\d+)\s+cascades?\b[^)）]{0,24}total/gi, truth: userCascades.size, label: 'cascades in total' },
      { pattern: /across\s+(\d+)\s+tables/gi, truth: cascadeTables.length, label: 'tables' },
      { pattern: /(\d+)\s+foreign keys\b/gi, truth: userCascades.size, label: 'foreign keys' },
      { pattern: /covering\s+(\d+)\s+tables/gi, truth: cascadeTables.length, label: 'covering tables' },
    ];

    const hitsByLabel = new Map<string, number>(checks.map((c) => [c.label, 0]));
    let checked = 0;
    const offenders: string[] = [];
    for (const document of LEGAL_DOCUMENTS) {
      for (const locale of LEGAL_LOCALES) {
        const text = columnTexts(document, locale).join('\n');
        for (const { pattern, truth, label } of checks) {
          for (const match of text.matchAll(pattern)) {
            checked += 1;
            hitsByLabel.set(label, (hitsByLabel.get(label) ?? 0) + 1);
            if (Number(match[1]) !== truth) {
              offenders.push(
                `${document.id}/${locale} 的「${label}」写的是 ${match[1]}，而真源是 ${truth}（引用 users 且 CASCADE 的外键 ${userCascades.size} 条 / ${cascadeTables.length} 张表）`,
              );
            }
          }
        }
      }
    }
    expect(offenders, '\n' + offenders.join('\n')).toEqual([]);
    // 悬空守卫：**逐形状**查载体，而不是只查一个总数。
    // 总数够（>= 4）挡不住"其中三种形状一处都没命中"—— 那三种写下的数字从此没人比。
    const dangling = checks.filter((c) => (hitsByLabel.get(c.label) ?? 0) === 0).map((c) => c.label);
    expect(
      dangling,
      `这些形状在九份文档 × 中英两栏里一处都没命中，本条判据对它们已经悬空：${dangling.join('、')}`,
    ).toEqual([]);
    expect(checked, '"N 处级联 / N cascades / N foreign keys" 的命中总数过少 —— 判据接近悬空').toBeGreaterThanOrEqual(
      checks.length,
    );
  });

  it('🔴 逐类点名的那句文案，中英两栏都要在（不许只在中文栏列全）', () => {
    const privacy = LEGAL_DOCUMENTS.find((d) => d.id === 'privacy');
    expect(privacy, '注册表里没有 privacy 这份文件').toBeTruthy();
    for (const locale of LEGAL_LOCALES) {
      // 🔴 取样范围必须等于这句话的语义范围。第一版把整份文档拼起来判"有没有点名这一类"，
      // 于是变异"从注销那句里删掉墓碑"**一个都不红** —— 因为「墓碑」在政策别处（四态那节）也有。
      // 判据的作用域比承诺宽，它就只是在打印自己。
      // ⇒ 只在**承载注销承诺的那一格**里查覆盖：它靠"处级联 / cascades in total"定位，
      //   而那正是上面数字判据认的同一形状，两者不会各看一份文本。
      const marker = locale === 'zh-CN' ? '处级联' : 'cascades in total';
      const closureCells = columnTexts(privacy!, locale).filter((t) => t.includes(marker));
      expect(
        closureCells.length,
        `${locale} 栏找不到承载注销承诺的那一格（定位形状漂了）—— 判据已悬空`,
      ).toBeGreaterThan(0);

      // 🔴 本包的 locale 字面量是 `'zh-CN' | 'en'`，而类别表按 `'zh' | 'en'` 登记；
      // 直接 `c[locale]` 会拿到 undefined（第一版就在这里炸了）。映射要显式写出来。
      const lang = locale === 'zh-CN' ? 'zh' : 'en';
      for (const cell of closureCells) {
        const lower = cell.toLowerCase();
        const absent = CATEGORY_NAMES.filter((c) => !lower.includes(c[lang].toLowerCase())).map(
          (c) => `${c.table}（这一类要出现「${c[lang]}」）`,
        );
        expect(
          absent,
          `${locale} 栏的注销承诺里少列了这些类别：${absent.join('、')}`,
        ).toEqual([]);
      }
    }
  });

  it('🔴 每一格"注销是级联硬删"的承诺，中英两栏都自带"其它设备本地数据"这条边界', () => {
    // 来历：本轮（批次 E）把"注销 = 彻底销毁"落成实话时发现，注销承诺散在四份文档里，
    // 而它们**只说服务端删了什么**，没有一处说"你其它设备上的本地明文库不会因此消失"。
    // 中英镜像判据挡不住这种漂移 —— 它只比形状（单元格数、块序），两栏可以一起夸大。
    // 所以这条按**语义**判：凡是做了级联硬删承诺的那一格，就必须同时带着那条边界。
    // 定位的是**那条注销承诺本身**，不是"任何同时提到注销和级联的格子" ——
    // 「订阅、订单」那行也说"注销时随账号一起级联删除"，但它是分类表里的一行，
    // 要求它也去复述设备边界只会把文案写成复读机。判据的范围要等于承诺的范围。
    const CLAIM_ZH = /注销[\s\S]{0,40}(硬删除|硬删|没有冷静期|不可恢复)/;
    const CLAIM_EN =
      /((closure|account deletion|close your account)[\s\S]{0,90}(hard delete|no cooling-off|cannot be undone))|((hard delete|no cooling-off)[\s\S]{0,90}(closure|account deletion))/i;
    const BOUNDARY_ZH = /本地.{0,16}(库|数据)/;
    // 🔴 「local data」两词相邻的写法会漏掉 "Local plaintext data"（本轮真实文案就是这样写的），
    // 所以允许中间夹最多三个修饰词。放宽的是**形状**，不是语义：仍然要求"本地"紧挨着
    // "data/database/store"，把边界删掉照样红（变异 M7 验过）。
    const BOUNDARY_EN = /local(?:\s+\w+){0,3}\s+(data|databases?|store)/i;
    const DEVICE_ZH = /(其它|其他)设备/;
    const DEVICE_EN = /other device/i;

    const offenders: string[] = [];
    let claims = 0;
    for (const document of LEGAL_DOCUMENTS) {
      for (const locale of LEGAL_LOCALES) {
        const zh = locale === 'zh-CN';
        for (const cell of columnTexts(document, locale)) {
          if (!(zh ? CLAIM_ZH : CLAIM_EN).test(cell)) continue;
          claims += 1;
          // 🔴 逐项 push，不要写成 `[[a],[b]].filter(Boolean)` —— 那两个内层数组恒真，
          // 于是每一条承诺都会被判红，这条判据从"找缺边界"退化成"见谁都红"。
          const miss: string[] = [];
          if (!(zh ? BOUNDARY_ZH : BOUNDARY_EN).test(cell)) {
            miss.push(zh ? '「本地库/本地数据」这条边界' : 'the "local data" boundary');
          }
          if (!(zh ? DEVICE_ZH : DEVICE_EN).test(cell)) {
            miss.push(zh ? '「其它设备」这个限定' : 'the "other devices" qualifier');
          }
          if (miss.length) {
            offenders.push(
              `${document.id}/${locale}：「${cell.slice(0, 42)}…」承诺了级联硬删，却没写 ${miss.join('、')}`,
            );
          }
        }
      }
    }
    expect(offenders, '\n' + offenders.join('\n')).toEqual([]);
    // 前提：一条承诺都没匹配到 = 我的定位形状漂了，这条会退化成恒绿。
    expect(claims, '没有任何一格被认成"注销级联硬删"的承诺 —— 定位形状漂了，这条判据已经悬空').toBeGreaterThan(0);
  });
});
