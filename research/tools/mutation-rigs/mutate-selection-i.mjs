#!/usr/bin/env node
/**
 * 断言 I（视图轴的选中立场名册）的变异装置 —— 工单 `docs/plans/detail-pane-alignment.md` §8.98。
 *
 * 为什么要有它：I 是**正向**名册（每一面都被迫回答），一条只会打印通过的名册比没有名册更糟
 * —— 它会把"没人想过这件事"包装成"每一面都交代过了"。所以这里逐臂问的不是"红不红"，
 * 而是"**红在哪一腿**"：缺席／词表外立场／类别不在选中词表／证据 needle 过期／消费形状缺失／
 * 登记与代码相反（过期）／键名写错／解析读空，每一腿各一臂。
 *
 * 🔴 臂只改门禁自己那份表与逻辑，**不碰产品源码** —— 产品文件在共享工作树里正被别人改，
 * 往他们手里插一行变异就是在制造别人名下的假红（工单 §1 第①道归属门的同一条理由）。
 * 所以"这一面接了选中"这类事实是靠**把登记改成与代码相反**来打红的，不是靠改代码。
 *
 * 跑法：node research/tools/mutation-rigs/mutate-selection-i.mjs
 * 退出码：0 = 全部臂符合预期；1 = 有臂不符合（那是判据没牙或臂写错，都是本批的缺陷）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const GATE = 'scripts/check-selection-single-source.mjs';
const ORIG = readFileSync(`${ROOT}/${GATE}`, 'utf8');
const md5 = (t) => createHash('md5').update(t).digest('hex');
const BASE = md5(ORIG);

const run = (src) => {
  writeFileSync(`${ROOT}/${GATE}`, src, 'utf8');
  const r = spawnSync(process.execPath, [`${ROOT}/${GATE}`], { encoding: 'utf8', cwd: ROOT });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};
const restore = () => writeFileSync(`${ROOT}/${GATE}`, ORIG, 'utf8');

let pass = 0;
let failArms = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    results.push(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`);
  } else {
    failArms += 1;
    results.push(`  🔴 ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}
/** 每条正臂的资格：RC=1，且红句里点名"断言 I"，且带着这一腿专属的那句话。 */
function redWithLeg(mutated, needle) {
  const r = run(mutated);
  return { ok: r.rc === 1 && /断言 I：/.test(r.out) && r.out.includes(needle), r };
}

// ---- 对照：未变异必须全绿 ----------------------------------------------------
const base = run(ORIG);
check('对照 未变异副本全绿（I 那行的读数打进输出）', base.rc === 0 && /✅ I：/.test(base.out), `RC=${base.rc}｜${(base.out.match(/✅ I：.*/) || ['<没打出来>'])[0].slice(0, 110)}`);

// ---- I1 少登记一面（这条名册存在的理由） ------------------------------------
const dropTasks = ORIG.replace(
  /  \{\n    view: 'tasks',[\s\S]*?because: '列表是任务的第一个投影，选中就是共享 store 里那一个值。',\n  \},\n/,
  '',
);
check('I1 摘掉 tasks 那一格 → 红且点名缺的是 tasks', dropTasks !== ORIG && redWithLeg(dropTasks, '没对"选中"交代过立场：tasks').ok);

// ---- I1b 脱牙：把分母改成名册自己（自指 = 永不为空） ------------------------
const selfRef = ORIG.replace('const viewKeys = readViewKeys();', 'const viewKeys = VIEW_STANCES.map((e) => e.view);');
const neutered = run(selfRef);
const withNeuter = run(selfRef.replace(
  /  \{\n    view: 'tasks',[\s\S]*?because: '列表是任务的第一个投影，选中就是共享 store 里那一个值。',\n  \},\n/,
  '',
));
check(
  'I1b 脱牙对照：把视图分母改成名册自己 → 同一份"少一格"不再红（证明 I1 的红确实挂在"分母来自真身"这一腿）',
  neutered.rc === 0 && withNeuter.rc === 0 && !/断言 I：/.test(withNeuter.out),
  `带牙 RC=${neutered.rc}｜脱牙后少一格 RC=${withNeuter.rc}`,
);

// ---- I2 立场词表外 ------------------------------------
const badStance = ORIG.replace("    view: 'calendar',\n    stance: 'no-rows',", "    view: 'calendar',\n    stance: 'not-selecting',");
check('I2 立场写成词表外的「not-selecting」→ 红并打印六档词表', badStance !== ORIG && redWithLeg(badStance, '不在封闭词表 selects/filters/row-actions-only/no-rows/not-a-route/pending-decision 里').ok);

// ---- I3 类别不在选中词表 ------------------------------------
const badKind = ORIG.replace("    kinds: ['habit'],", "    kinds: ['widget'],");
check('I3 登记 selects 一个词表外的类别 → 红并点名那一类', badKind !== ORIG && redWithLeg(badKind, '登记的类别「widget」不在选中词表').ok);

// ---- I4 证据 needle 过期 ------------------------------------
const badNeedle = ORIG.replace("needle: \"const editingId = useSelected('note');\",", 'needle: "const editingId = useSelected(\'note\', 123);",');
check('I4 把某条证据 needle 改成代码里不存在的写法 → 红并报"过期登记"', badNeedle !== ORIG && redWithLeg(badNeedle, '的证据 needle 在').ok);

// ---- I5 selects 但那一面没有该类的消费形状 ----------------------------------
const trashPretends = ORIG.replace(
  "    view: 'trash',\n    stance: 'row-actions-only',",
  "    view: 'trash',\n    stance: 'selects',\n    kinds: ['habit'],",
);
check('I5 把回收站登记成选中 habit（它的文件里根本没有 habit 消费形状）→ 红在消费形状那一腿', trashPretends !== ORIG && redWithLeg(trashPretends, '里没有该类的消费形状').ok);

// ---- I6 filters 挡不住"其实已经进词表" -------------------------------------
const entityConflict = ORIG.replace("    entity: 'project',", "    entity: 'task',");
check('I6 把侧栏那条 filters 点名的实体换成已在词表的 task → 红（两边必须挑一边）', entityConflict !== ORIG && redWithLeg(entityConflict, '而它已经在词表').ok);

// ---- I7 键名写错 ------------------------------------
const typo = ORIG.replace("    view: 'settings',", "    view: 'settingz',");
check('I7 把 ViewKey 写错一个字母 → 红（既不是 ViewKey 也没有 rail: 前缀）', typo !== ORIG && redWithLeg(typo, '既不是 ViewKey、也没有 rail: 前缀').ok);

// ---- I8 登记与代码相反（承重的那一腿） ------------------------------------
const habitsDeclined = ORIG.replace(
  "    view: 'habits',\n    stance: 'selects',\n    kinds: ['habit'],",
  "    view: 'habits',\n    stance: 'no-rows',",
);
const leg8 = habitsDeclined !== ORIG && redWithLeg(habitsDeclined, '这条登记过期了').ok;
check('I8 把习惯面从 selects 改成 no-rows（代码里它在读 useSelected）→ 红在"登记过期"', leg8);

// ---- I8b 脱牙：摘掉过期那一腿，喂同一份变异 --------------------------------
const neuter8 = habitsDeclined.replace('      if (live.length > 0) {', '      if (false && live.length > 0) {');
const neutered8 = run(neuter8);
check('I8b 脱牙对照：摘掉 live 判定后同一份变异不再点名那一腿（不是摘了整个名册）', !/断言 I：「habits」登记的立场是 no-rows/.test(neutered8.out) && neutered8.out.includes('✅ I：'), `RC=${neutered8.rc}`);

// ---- I9a 分母源文件读不到 ------------------------------------
// 🔴 这一臂第一次跑是**不符合预期**的，而它照出的不是臂写错，是门禁少一条腿：
//    那时 readViewKeys 直接 readFileSync，文件没了就抛裸 ENOENT 栈 —— RC=1 但输出里
//    没有"断言 I"三个字。栈也是红，可它不说明**是哪条判据**在红，下一位只能重新读栈。
//    补上 try/catch 之后这一臂才有资格判"响亮失败"。
const wrongFile = ORIG.replace("const VIEWKEY_FILE = path.join(ROOT, 'apps/web/src/features/shell/view-tabs.ts');", "const VIEWKEY_FILE = path.join(ROOT, 'apps/web/src/features/shell/view-tab.ts');");
check('I9a 视图全集的来源文件读不到 → 红且点名断言 I（不是裸栈）', wrongFile !== ORIG && redWithLeg(wrongFile, '读不到视图全集的来源').ok);

// ---- I9b 文件在，但联合类型的写法换了 ------------------------------------
const movedShape = ORIG.replace('src.match(/export type ViewKey =([\\s\\S]*?);/)', 'src.match(/export type ViewKeys =([\\s\\S]*?);/)');
check('I9b 文件在但读不出 `export type ViewKey =` → 红并报"来源换地方了"', movedShape !== ORIG && redWithLeg(movedShape, '找不到 `export type ViewKey').ok);

// ---- I10 解析读空 ------------------------------------
const deadParse = ORIG.replace(
  "const keys = [...m[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((x) => x[1]);",
  'const keys = [];',
);
check('I10 把解析改成读空 → 红在"解析出 0 项"（空集合上的"全部交代过"是永真）', deadParse !== ORIG && redWithLeg(deadParse, 'ViewKey 解析出 0 项').ok);

// ---- I11 同一棵树喂"还没有断言 I 的那版" ----------------------------------
const preSrc = execFileSync('git', ['-C', ROOT, 'show', `HEAD:${GATE}`], { encoding: 'utf8' });
const preHasI = /断言 I：/.test(preSrc);
const preRun = run(preSrc);
check(
  'I11 同一份当前代码喂 HEAD 那版门禁 → RC=0 且它自己不含断言 I（补的是实测存在的缺口，不是顺手加严）',
  !preHasI && preRun.rc === 0,
  `HEAD 那版含 I=${preHasI}｜RC=${preRun.rc}｜它打印过 I 那行=${/✅ I：/.test(preRun.out)}`,
);

// ---- 收尾：复原 + 复跑回绿 + 哈希对账 ------------------------------------
restore();
const after = run(ORIG);
const clean = md5(readFileSync(`${ROOT}/${GATE}`, 'utf8')) === BASE;
check('复原后复跑回到绿，且门禁文件逐字节回到原样', after.rc === 0 && clean, `RC=${after.rc}｜BACK_TO_CLEAN=${clean}`);

for (const line of results) console.log(line);
console.log(`\n结论：${pass}/${pass + failArms} 臂符合预期${failArms ? ' 🔴' : ' ✅'}`);
process.exit(failArms ? 1 : 0);
