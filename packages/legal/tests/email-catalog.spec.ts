/**
 * 功能邮件的**封闭词表**回到代码对账（工单 W7）。
 *
 * ## 为什么这一条必须存在，而 `structure.spec.ts` 挡不住它
 *
 * 对外文本里有三处在数同一件事：「发十封功能邮件（验证邮箱、魔法登录、…）」「只有第 3 条列过的那十封」
 * 「我们只发十封纯功能性邮件：…」。那是一个**封闭句式** —— 它等于在说"除这些之外没有别的邮件"，
 * 而本仓库已经吃过一次同形状的亏（`docs/plans/countdown-anniversary.md` §8.5 与
 * `check:legal-tools` 的来历：「未列出的即视为未授权」把一张表变成授权面）。
 *
 * 🔴 本轮实测到的正是它坏掉的样子：**「五封」在批次二之前就已经是假的**。
 * `server/src/email.ts` 里早就有 `sendEmailPasswordRegistrationCodeEmail`（注册验证码那封），
 * 它没有被写进任何一处词表，而**没有任何一层会失败** —— 2026-10-07 那笔提交给同一份政策加了
 * 「邮箱注册验证码挑战」这一*数据*类别，却没有动那三个数：同一个功能在政策里一半新、一半旧。
 * 本批（ADR-0063）又加了四封（换绑-新邮箱确认、换绑-旧邮箱授权、换绑完成通知、新增认证器告知），
 * 所以真值是 **十封**，而那个数只能从代码数出来，不能从文案抄。
 *
 * ## 判据
 *
 *  ① `server/src/email.ts` 里每一枚 `export const send*Email` 都在登记表里有一个人类可读的名字
 *     —— 新增一封而登记没跟上，红的是"没登记"，而不是"少承诺了一封"。
 *  ② 登记表里的名字一个都不许多于实现（撤掉一封而文案与登记仍留着 = 对外多承诺）。
 *  ③ 九份文档 × 中英两栏里，**每一处**"N 封功能邮件 / N functional emails"形状的数都等于 ① 数到的枚数。
 *  ④ 一处单元格若点名了 ≥2 个类别，它就是**枚举**那一格 —— 必须把每一类都点齐（漏一类的枚举
 *     比不写枚举更坏：它看起来是完整的）。
 *  ⑤ 悬空守卫：登记表每个名字都真在语料里出现、`N 封` 那条形状真命中过若干次。
 *     0 命中不可信（AGENTS §7 元规则 2）。
 *  ⑥ 承重对照：把同一套扫描函数跑在**两份合成文档**上 —— 一份把数字写错、一份枚举漏一类 ——
 *     两者都必须被抓出来。没有这一条，③④ 有可能只是一直在打印自己。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LEGAL_DOCUMENTS, type LegalDocument } from '../src/index.js';

/** 与 `structure.spec.ts` 同一份口径：本包的栏位就是这两个。 */
const LEGAL_LOCALES = ['zh-CN', 'en'] as const;

/** 与 `structure.spec.ts` 同一个理由：判据读的是**运行时真源**，不是本文件的注释。 */
const EMAIL_MODULE = fileURLToPath(new URL('../../../server/src/email.ts', import.meta.url));

/**
 * 类别名登记表。函数名 = `server/src/email.ts` 的导出名；中英文那一格是**给用户看的话**，
 * 必须逐字出现在文档的枚举格里（所以它同时是判据的期望值与漂移的探测器）。
 */
const EMAIL_KINDS: Array<{ fn: string; zh: string; en: string }> = [
  { fn: 'sendVerificationEmail', zh: '验证邮箱', en: 'address verification' },
  { fn: 'sendEmailPasswordRegistrationCodeEmail', zh: '注册验证码', en: 'registration code' },
  { fn: 'sendLoginMagicLinkEmail', zh: '魔法登录', en: 'magic sign-in link' },
  { fn: 'sendPasskeyRecoveryEmail', zh: '找回通行密钥', en: 'passkey recovery' },
  { fn: 'sendPasswordResetEmail', zh: '重置口令', en: 'password reset' },
  { fn: 'sendPasswordChangedEmail', zh: '口令已改通知', en: 'password-changed notice' },
  { fn: 'sendEmailChangeConfirmEmail', zh: '换绑-新邮箱确认', en: 'rebinding confirmation' },
  { fn: 'sendEmailChangeAuthorizeEmail', zh: '换绑-旧邮箱授权', en: 'rebinding authorisation' },
  { fn: 'sendEmailChangedEmail', zh: '换绑完成通知', en: 'change completed notice' },
  { fn: 'sendAuthenticatorAddedEmail', zh: '新增认证器告知', en: 'authenticator-added notice' },
];

/** 代码里真实存在的导出名（不做注释剥离：这个模块的导出形状是 `export const send…Email = async (`）。 */
const exportedSenders = (): string[] => {
  const src = readFileSync(EMAIL_MODULE, 'utf8');
  return [...src.matchAll(/^export\s+const\s+(send\w*Email)\s*=/gm)].map((m) => m[1] as string);
};

const ZH_NUM_WORDS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16,
};
const EN_NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
};

const asCount = (token: string, words: Record<string, number>): number =>
  /^\d+$/.test(token) ? Number(token) : (words[token] ?? Number.NaN);

/**
 * 一句里"在数功能邮件"的两种形状。中英各一条，**必须各判一次** ——
 * `structure.spec.ts` 的历史就是漏了整栏英文的形状，让旧数字对外发了几天。
 *
 * ⚠️ 中文那条刻意要求 `封` 后面跟的是"（纯）功能（性）邮件"：政策里另有"三封安全通知"这种
 * **另一件事**的计数，宽的图案会把它们一起抓进来并报出一句假红。
 */
const COUNT_SHAPES: Record<'zh-CN' | 'en', { re: RegExp; words: Record<string, number> }> = {
  'zh-CN': { re: /([0-9]+|[一二三四五六七八九十]{1,2})\s*封(?:纯)?功能(?:性)?邮件/g, words: ZH_NUM_WORDS },
  en: {
    re: /\b([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\s+(?:purely\s+)?functional\s+e-?mails?\b/gi,
    words: EN_NUM_WORDS,
  },
};

/**
 * 把一份文档某一栏的全部文本拍平（表格行与列表项都算，与 `structure.spec.ts` 同一口径）。
 *
 * 🔴 `skipChangelog` 那一档不是便利，是**语义**：版本变更表的职责就是把旧措辞引用出来
 * （"把『五封』改成『十封』"这一句里当然出现 5），把它当成一句当前的对外承诺来数，
 * 每条修订都会让自己变红。`scripts/check-legal-closure-truth.mjs` 认的是同一件事，
 * 那里也带一条"排除前后命中数必须不等"的承重断言 —— 这里照做（见悬空守卫那条）。
 *
 * 认法取**表头第一格**（`版本` / `Version`）而不是写死整张表头：本仓九份文档的变更表头
 * 已经有三种写法（`[版本, 日期与变更摘要]`、`[版本, 日期, 变化]`、`[Version, Date and summary of the change]`），
 * 写死一张清单就是等着第四种漂过去。
 */
function cellsOf(doc: LegalDocument, locale: 'zh-CN' | 'en', skipChangelog = true): string[] {
  const out: string[] = [];
  for (const section of doc.sections[locale]) {
    // 🔴 `blocks` 在类型上是可选的。这里**不静默跳过**：一份"这一节没有块"的文档
    // 会让整条枚举对账变成少扫一节的恒真方向假绿 —— 与 `structure.spec.ts` 里
    // "约束名对不上默认形状就抛错，不退回按第一个下划线切"同一条立场。
    const blocks = section.blocks;
    if (blocks === undefined) {
      throw new Error(
        `${doc.id}/${locale} 的第「${section.id}」节没有 blocks —— ` +
          '本探针按"每节都有可扫的块"来数封闭枚举。要么这一节真的空了（那对外承诺少了一格），' +
          '要么探针要先跟着改（不许改成 ?? [] 悄悄跳过）。',
      );
    }
    for (const block of blocks) {
      if (block.kind === 'table') {
        const head0 = String(block.head[0] ?? '').trim();
        if (skipChangelog && (head0 === '版本' || head0 === 'Version')) continue;
        out.push(...block.head, ...block.rows.flat());
      } else if (block.kind === 'ul' || block.kind === 'ol') {
        out.push(...block.items);
      } else {
        out.push(block.text);
      }
    }
  }
  return out;
}

/** 扫描语料，返回"数字不符"与"枚举不完整"两类 offender。真文档与合成夹具走同一条函数。 */
function auditCorpus(docs: LegalDocument[], truth: number, skipChangelog = true): string[] {
  const offenders: string[] = [];
  for (const doc of docs) {
    for (const locale of LEGAL_LOCALES) {
      const lang = locale === 'zh-CN' ? 'zh' : 'en';
      const { re, words } = COUNT_SHAPES[locale];
      for (const cell of cellsOf(doc, locale, skipChangelog)) {
        const text = String(cell ?? '');
        for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
          const stated = asCount(String(m[1]), words);
          if (Number.isNaN(stated)) {
            offenders.push(`${doc.id}/${locale}：「${text.slice(0, 40)}…」里的数量词认不出来，判据读不懂它 = 悬空`);
          } else if (stated !== truth) {
            offenders.push(`${doc.id}/${locale}：写的是 ${stated} 封，而代码里有 ${truth} 枚 send*Email 导出`);
          }
          const named = EMAIL_KINDS.filter((k) => text.includes(k[lang]));
          if (named.length >= 2) {
            const missing = EMAIL_KINDS.filter((k) => !text.includes(k[lang]));
            if (missing.length > 0) {
              offenders.push(
                `${doc.id}/${locale}：那一格在逐类点名（已点 ${named.length} 类），但漏了 ${missing.length} 类：${missing
                  .map((k) => k[lang])
                  .join('、')}`,
              );
            }
          }
        }
      }
    }
  }
  return offenders;
}

describe('功能邮件的封闭词表与代码对账', () => {
  const senders = exportedSenders();

  it('🔴 探针读到了实现（0 枚 = 这个模块改形或路径漂了，不能报"全部合规"）', () => {
    expect(senders.length, `在 ${EMAIL_MODULE} 里一枚 send*Email 都没数到 —— 先怀疑这个探针`).toBeGreaterThan(0);
  });

  it('🔴 每一枚实现都在登记表里有一个人类可读的名字，一个都不许多', () => {
    const unregistered = senders.filter((fn) => !EMAIL_KINDS.some((k) => k.fn === fn));
    expect(
      unregistered,
      `server/src/email.ts 新增了这一封但词表没跟上（症状：政策里那句"N 封"变成假话，而它是一句封闭承诺）：${unregistered.join(', ')}`,
    ).toEqual([]);

    const phantom = EMAIL_KINDS.filter((k) => !senders.includes(k.fn));
    expect(
      phantom,
      `登记表里这些名字在代码里已经没有对应的发信函数了（撤掉一封却留着登记与文案 = 对外多承诺）：${phantom
        .map((k) => k.fn)
        .join(', ')}`,
    ).toEqual([]);
  });

  it('🔴 九份文档 × 中英两栏里每一处"N 封功能邮件"都等于代码数到的枚数，逐类点名的格子点得齐', () => {
    const offenders = auditCorpus(LEGAL_DOCUMENTS as unknown as LegalDocument[], senders.length);
    expect(offenders, '\n' + offenders.join('\n')).toEqual([]);
  });

  it('🔴 悬空守卫：登记表每个名字都真在语料里、数量词形状真命中过', () => {
    const corpus: Record<'zh-CN' | 'en', string> = {
      'zh-CN': LEGAL_DOCUMENTS.map((d) => cellsOf(d as unknown as LegalDocument, 'zh-CN').join('\n')).join('\n'),
      en: LEGAL_DOCUMENTS.map((d) => cellsOf(d as unknown as LegalDocument, 'en').join('\n')).join('\n'),
    };
    const missing = EMAIL_KINDS.filter(
      (k) => !corpus['zh-CN'].includes(k.zh) || !corpus.en.toLowerCase().includes(k.en.toLowerCase()),
    ).map((k) => `${k.fn}（中文「${k.zh}」/ 英文「${k.en}」）`);
    expect(missing, `这些类别在语料里一处都找不到，登记表已经悬空：${missing.join('、')}`).toEqual([]);

    let hits = 0;
    for (const locale of LEGAL_LOCALES) {
      const { re } = COUNT_SHAPES[locale];
      hits += (corpus[locale].match(new RegExp(re.source, re.flags)) ?? []).length;
    }
    expect(hits, '「N 封功能邮件 / N functional emails」在语料里一处都没命中，本条判据已经悬空').toBeGreaterThanOrEqual(4);

    // 承重（排除变更表这条腿自己必须真的在做事）：不排除时命中数**必须更大**。
    // 相等说明要么没读到变更表、要么把历史引用当成了当前的对外承诺 —— 两种都是判据在打印自己。
    const docs = LEGAL_DOCUMENTS as unknown as LegalDocument[];
    const judged = auditCorpus(docs, senders.length, true).length;
    const naive = auditCorpus(docs, senders.length, false).length;
    expect(judged, '排除变更表之后仍有不符项，与上面那条判据矛盾').toBe(0);
    expect(naive, '把变更表也扫进来之后命中数没变 —— 排除那条腿没起作用（现量：两样都是 0）').toBeGreaterThan(judged);
  });

  it('🔴 承重对照：数字写错与枚举漏一类，这两样都真的会让上面那条转红', () => {
    // 合成文档不是"再造一份真源"，而是**给判据自身**做一次端到端造失：
    // 若哪天有人把 ③④ 改成恒真（例如把 offender 收集丢在一边），这两臂会立刻存活下来并被打印。
    const synth = (zh: string, en: string): LegalDocument =>
      ({
        id: 'fixture',
        sections: {
          'zh-CN': [{ id: 's1', title: 't', blocks: [{ kind: 'p', text: zh }] }],
          en: [{ id: 's1', title: 't', blocks: [{ kind: 'p', text: en }] }],
        },
      }) as unknown as LegalDocument;

    const truth = senders.length;
    const listZh = EMAIL_KINDS.map((k) => k.zh).join('、');
    const listEn = EMAIL_KINDS.map((k) => k.en).join(', ');

    const wrongNumber = auditCorpus([synth(`发${truth + 1}封功能邮件（${listZh}）`, `sending ${truth + 1} functional emails (${listEn})`)], truth);
    expect(
      wrongNumber.some((o) => o.includes('而代码里有')),
      `把数量写成 ${truth + 1} 却没有被抓出来 —— 数字判据已经不会红`,
    ).toBe(true);

    const missingClass = EMAIL_KINDS[3] as (typeof EMAIL_KINDS)[number];
    const shortZh = EMAIL_KINDS.filter((k) => k !== missingClass).map((k) => k.zh).join('、');
    const shortEn = EMAIL_KINDS.filter((k) => k !== missingClass).map((k) => k.en).join(', ');
    const dropped = auditCorpus([synth(`发${truth}封功能邮件（${shortZh}）`, `sending ${truth} functional emails (${shortEn})`)], truth);
    expect(
      dropped.some((o) => o.includes('漏了') && o.includes(missingClass.zh)),
      `枚举里删掉「${missingClass.zh}」这一类却没有被抓出来 —— 逐类点名的判据已经不会红`,
    ).toBe(true);

    // 阴性对照：数字对、类别点齐 ⇒ 必须**不**报。缺了它，上面两臂可以靠"永远报"通过。
    const clean = auditCorpus([synth(`发${truth}封功能邮件（${listZh}）`, `sending ${truth} functional emails (${listEn})`)], truth);
    expect(clean, `一份本来合规的合成文档被报了：${clean.join(' / ')}`).toEqual([]);
  });
});
