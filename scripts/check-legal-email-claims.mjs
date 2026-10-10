#!/usr/bin/env node
/**
 * 对外法务文本点名的"功能邮件"清单 ↔ 服务端真会发出去的那几封，逐枚对账。
 *
 * 为什么要有这把尺：法务条款里"我们只发 N 封纯功能性邮件"是一个**封闭句式**，
 * 它承诺的是"除此之外不发"。这种句式一旦指的那个集合开始漂（代码加了一封、文案没跟着改，
 * 或文案先写了一封代码里还没有的），没有任何一层会失败 —— 仓内先例是 `check:legal-tools`
 * 挡那张"未列出即视为未授权"的工具表，同一个理由。
 *
 * 两个方向不对称，所以两档处置也不同：
 *  - **超承诺**（文本点名的那封，代码里根本不会发）⇒ 判红。这是对用户说了假话。
 *  - **漏披露**（代码真会发，文本没点名）⇒ 只打印，不判红。
 *    它同样是假的，但修法要动对外文本的句子，而 `packages/legal/src/documents/*.ts` 此刻
 *    被三条线同时握着未提交改动（见计划 §6.78 那张 hunk 归属表）；从这条共享检出里单面提交
 *    整片文件，会把别人那半切掉，而法务文件的版本行还进同意指纹。
 *    等那一批由文件当前的写入者一次收拢时，把这一档升成判红 —— 升法与判据都印在下面的输出里。
 *
 * 用法：node scripts/check-legal-email-claims.mjs [--json] [--self-test]
 *
 * 🔴 载体纪律（2026-10-10 实测出来的，别改回去）：**两边都读磁盘**。第一版用 `git grep`
 * 找调用点、用 `readFileSync` 读文本，于是一枚未跟踪的在飞调用文件（`server/src/password/registration-otp.ts`）
 * 在尺上等于"不存在"，把真的会发的那一封判成"对外多承诺"。混载体造的是**假红**，
 * 而假红最贵 —— 它会让人去改一份本来正确的法务文本。臂 A6 把这一条钉住。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const EN_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** `server/src` 下的每一枚 `.ts`，**按磁盘上的树**收（含未跟踪文件）。
 *  🔴 调用点不能拿 `git grep` 去找：它只看得见 tracked 内容，而本尺其余部分（`email.ts`、
 *  那两份法务文本）读的都是磁盘。两种载体混在一把尺里会造出假红 —— 2026-10-10 实测：
 *  `server/src/password/registration-otp.ts` 那枚未跟踪的在飞文件真的会发注册验证码，
 *  而 `git grep` 看不见它，于是"十封"被判成对外多承诺。尺错，不是文本错。 */
const SERVER_TS = (() => {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        walk(`${dir}/${e.name}`);
      } else if (e.name.endsWith('.ts')) out.push(`${dir}/${e.name}`);
    }
  };
  walk('server/src');
  return out;
})();

/** subjectKey 家族 → 对外文本里用来点名它的那几个写法（中英各一枚以上，取文本现用写法）。
 *  加一封邮件必须在这里加一行（否则"漏披露"那一档立刻把它报出来），
 *  而文本里用了表外名字 ⇒ 判红。 */
const ALIAS = {
  verify: { zh: ['验证邮箱'], en: ['address verification'] },
  login: { zh: ['魔法登录'], en: ['magic link', 'magic sign-in link'] },
  recover: { zh: ['找回通行密钥'], en: ['passkey recovery'] },
  reset: { zh: ['重置口令'], en: ['password reset'] },
  passwordChanged: { zh: ['口令已改通知', '口令已修改的安全通知'], en: ['password-changed notice', 'a security notice that your password changed'] },
  changeConfirm: { zh: ['换绑-新邮箱确认'], en: ['rebinding confirmation for the new address'] },
  changeAuthorize: { zh: ['换绑-旧邮箱授权'], en: ['rebinding authorisation for the current address'] },
  changed: { zh: ['换绑完成通知'], en: ['e-mail change completed notice'] },
  authenticatorAdded: { zh: ['新增认证器告知'], en: ['authenticator-added notice'] },
  // 注册验证码这一封：`sendEmailPasswordRegistrationCodeEmail` 的调用点在
  // `server/src/password/registration-otp.ts`（2026-10-10 现量：那枚文件当时还未跟踪）。
  // 它留在别名表里是必须的 —— 文本点名它，而代码确实发得出；把它拿掉会立刻变成"表外名字"假红。
  registerCode: { zh: ['注册验证码'], en: ['registration code'] },
};

const DOCS = [
  'packages/legal/src/documents/privacy.ts',
  'packages/legal/src/documents/third-parties.ts',
];

const num = (s) => CN_NUM[s] ?? EN_NUM[s?.toLowerCase()] ?? Number(s);

/** 服务端真会发的那些封：email.ts 里声明的 send* 常量，且它在 server/src 里有 email.ts 之外的调用点。
 *  "定义了但没人调"不算会发。调用点按 `SERVER_TS`（磁盘上的树）扫，不按索引扫 —— 理由见上面那段。 */
function shippedFns(read) {
  const emailSrc = read('server/src/email.ts');
  const decls = [...emailSrc.matchAll(/^export const (send[A-Za-z0-9]+)\b/gm)].map((m) => m[1]);
  const out = new Map();
  for (const fn of decls) {
    const called = SERVER_TS.some((f) => f !== 'server/src/email.ts' && read(f).includes(`${fn}(`));
    if (!called) continue;
    const body = sliceConst(emailSrc, fn, decls);
    for (const m of body.matchAll(/server\.email\.([A-Za-z0-9]+)\.[a-zA-Z.]*subject/g)) out.set(m[1], fn);
  }
  return out;
}

const shippedKeys = (read) => new Set(shippedFns(read).keys());

function sliceConst(src, name, allDecls) {
  const at = src.search(new RegExp(`^export const ${name}\\b`, 'm'));
  if (at < 0) return '';
  let next = src.length;
  for (const other of allDecls) {
    if (other === name) continue;
    const i = src.indexOf(`export const ${other}`, at + 1);
    if (i > -1 && i < next) next = i;
  }
  return src.slice(at, next);
}

/** 从对外文本里抽出每一处"N 封功能邮件"声明 + 它点名的名字。 */
function claimsOf(src, locale) {
  const found = [];
  const zh = [
    /发(\d+|[一二三四五六七八九十]+)封(?:纯)?功能邮件（([^）]*)）/g,
    /只发\*\*(\d+|[一二三四五六七八九十]+)封纯功能性邮件\*\*：([^。\n]*)/g,
    /那(\d+|[一二三四五六七八九十]+)封(?:纯)?功能性?邮件/g,
    /(\d+|[一二三四五六七八九十]+)封功能性邮件的每一封/g,
  ];
  const en = [
    /delivering the (\w+) functional emails \(([^)]*)\)/g,
    /send \*\*(\w+) purely functional e-mails[^*]*\*\*: ([^.\n]*)/g,
    /one of the (\w+) functional e-?mails/g,
    /Each of the (\w+) functional e-?mails/g,
  ];
  const table = locale === 'zh' ? zh : en;
  for (const re of table) {
    for (const m of src.matchAll(re)) {
      const stated = num(m[1]);
      const names = (m[2] ?? '')
        .split(/[、,，]/)
        .map((s) => s.replace(/\*\*/g, '').replace(/^(and|及|以及|还有)\s+/, '').trim())
        .filter((s) => s.length > 1 && !/^(其中|the three)/.test(s));
      found.push({ stated, names, hit: m[0].slice(0, 46) });
    }
  }
  return found;
}

function judge(read, docs = DOCS) {
  const shipped = shippedKeys(read);
  const namesOf = (locale) => Object.entries(ALIAS).flatMap(([k, a]) => a[locale].map((n) => ({ key: k, n })));
  const known = { zh: namesOf('zh'), en: namesOf('en') };
  const over = [];
  const selfInconsistent = [];
  let declared = 0;
  for (const d of docs) {
    const src = read(d);
    for (const locale of ['zh', 'en']) {
      for (const c of claimsOf(src, locale)) {
        declared += 1;
        if (c.names.length && c.stated !== undefined && c.names.length !== c.stated) {
          selfInconsistent.push({ d, locale, ...c });
        }
        for (const n of c.names) {
          const hit = known[locale].find((x) => n.includes(x.n) || x.n.includes(n));
          if (!hit) {
            over.push({ d, locale, name: n, why: '别名表里没有这个名字（新加一封要先在这里登记它）', ...c });
          } else if (!shipped.has(hit.key)) {
            over.push({ d, locale, name: n, why: `服务端不会发这一封（${hit.key} 没有调用点）`, ...c });
          }
        }
      }
    }
  }
  const claimedKeys = new Set();
  for (const d of docs) {
    const src = read(d);
    for (const [k, a] of Object.entries(ALIAS)) {
      if (a.zh.some((n) => src.includes(n)) || a.en.some((n) => src.includes(n))) claimedKeys.add(k);
    }
  }
  const undisclosed = [...shipped].filter((k) => !claimedKeys.has(k));
  return { shipped, declared, over, selfInconsistent, undisclosed };
}

function readFromDisk(p) {
  return readFileSync(join(REPO, p), 'utf8');
}

function selfTest() {
  const arms = [];
  const push = (name, ok, note = '') => arms.push({ name, ok, note });
  const real = readFromDisk;
  const shipped = shippedKeys(real);

  // A0/A1 落在真树上：这把尺确实扫到了东西，且扫到的枚数不是空的。
  const base = judge(real);
  push('A0 解析到至少一处"N 封"声明', base.declared > 0, `命中 ${base.declared} 处 / 实发 ${shipped.size} 封`);
  push('A1 分母下限：实发的封数至少和别名表里登记的六枚同级', shipped.size >= 6, `shipped=${shipped.size}`);

  const FULL = [...shipped].map((k) => ALIAS[k].zh[0]);
  const doc = (n, names) => ({ 'packages/legal/src/documents/privacy.ts': `'登录账号；发${n}封功能邮件（${names.join('、')}）。'` });
  const readOf = (map) => (p) => map[p] ?? real(p);
  const ONLY = ['packages/legal/src/documents/privacy.ts'];

  // A6 钉的是这把尺自己的载体：调用点必须读磁盘。把磁盘上那一枚发信常量的**全部**调用文件抹成空，
  // 它就必须立刻不算"实发"。用 `git grep` 找调用点的版本在这一臂上不会有任何变化
  // —— 那正是 2026-10-10 那枚假红的形状（未跟踪的在飞调用文件被索引尺看不见）。
  const fnOf = shippedFns(real);
  const probeKey = [...shipped].find((k) => k in ALIAS && fnOf.get(k) !== undefined);
  const probeFn = probeKey === undefined ? undefined : fnOf.get(probeKey);
  const probeCallers =
    probeFn === undefined
      ? []
      : SERVER_TS.filter((f) => f !== 'server/src/email.ts' && real(f).includes(`${probeFn}(`));
  const readNoCaller = (p) => (probeCallers.includes(p) ? '' : real(p));
  const shippedNoCaller = shippedKeys(readNoCaller);
  push(
    'A6 抹掉磁盘上那几枚调用文件 ⇒ 那一封立刻不算实发（调用点读的是工作树，不是索引）',
    probeKey !== undefined && probeCallers.length > 0 && shipped.has(probeKey) && !shippedNoCaller.has(probeKey),
    `调用文件 ${probeCallers.length} 枚：${probeCallers.join(', ') || '无'}`,
  );

  // A2 用 A6 那把"摘掉调用点"的读法造出"有发信器、没调用点"那一枚，走的是同一条分支，
  // 但不再依赖真树上恰好有一封没接上的信（2026-10-10 起 `registerCode` 已有调用点）。
  const FULL_NC = [...shippedNoCaller].map((k) => ALIAS[k].zh[0]);
  const r2 = judge((p) => doc(shippedNoCaller.size + 1, [...FULL_NC, ALIAS[probeKey].zh[0]])[p] ?? readNoCaller(p), ONLY);
  push(
    'A2 点名一封代码里不会发的信 ⇒ 抓到',
    r2.over.length === 1 && r2.over[0].name === ALIAS[probeKey].zh[0] && /没有调用点/.test(r2.over[0].why),
    r2.over[0]?.why ?? '没抓到',
  );

  const r3 = judge(readOf(doc(shipped.size - 1, FULL)), ONLY);
  push('A3 数字与点名的枚数不符 ⇒ 抓到', r3.selfInconsistent.length === 1, r3.selfInconsistent[0] ? `写 ${r3.selfInconsistent[0].stated} 而点到 ${r3.selfInconsistent[0].names.length}` : '没抓到');

  const miss = FULL.filter((n) => n !== ALIAS.changed.zh[0]);
  const r4 = judge(readOf(doc(shipped.size - 1, miss)), ONLY);
  push('A4 少写一封 ⇒ 进"漏披露"名单而不是判红', r4.over.length === 0 && r4.selfInconsistent.length === 0 && r4.undisclosed.includes('changed'), `undisclosed=${r4.undisclosed.join(',') || '空'}`);

  const r5 = judge(readOf(doc(shipped.size, [...FULL.slice(0, -1), '给你发的日常通知'])), ONLY);
  push('A5 表外名字（一封没登记过的信）⇒ 抓到', r5.over.length === 1 && /别名表里没有/.test(r5.over[0].why), r5.over[0]?.name ?? '没抓到');

  const failed = arms.filter((a) => !a.ok);
  for (const a of arms) console.log(`${a.ok ? '✅' : '❌'} ${a.name}${a.note ? ` — ${a.note}` : ''}`);
  console.log(`SELFTEST_ARMS=${arms.length} FAILED=${failed.length}`);
  return failed.length ? 1 : 0;
}

function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const r = judge(readFromDisk);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ shipped: [...r.shipped], declared: r.declared, over: r.over, selfInconsistent: r.selfInconsistent, undisclosed: [...r.undisclosed] }));
    process.exit(r.over.length || r.selfInconsistent.length ? 1 : 0);
  }
  console.log(`实发 ${r.shipped.size} 封：${[...r.shipped].sort().join(' / ')}`);
  console.log(`对外文本里 ${r.declared} 处"N 封"声明，逐枚对账：`);
  for (const o of r.over) console.log(`  🔴 超承诺 ${o.locale} 「${o.name}」—— ${o.why}（${o.d}：${o.hit}）`);
  for (const s of r.selfInconsistent) console.log(`  🔴 自相矛盾 ${s.locale}：写「${s.stated} 封」而点到 ${s.names.length} 枚（${s.d}：${s.hit}）`);
  if (r.undisclosed.length) {
    console.log(`  🟡 漏披露（代码会发、文本没点名）：${r.undisclosed.map((k) => `${k}=${ALIAS[k].zh}`).join('、')}`);
    console.log('     这一档要动对外文本的句子，而 packages/legal 那五份此刻被三条线同时握着未提交改动 ——');
    console.log('     由那一批的写入者一次收拢；收拢后请把这一档也升成判红（把 undisclosed 并进 failing）。');
  }
  if (r.over.length || r.selfInconsistent.length) {
    console.log('❌ 对外文本承诺了代码里不存在的邮件（或自己前后不符）。');
    process.exit(1);
  }
  console.log('✅ 没有一封是对用户的多头承诺。');
  process.exit(0);
}

main();
