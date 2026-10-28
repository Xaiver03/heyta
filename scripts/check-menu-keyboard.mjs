#!/usr/bin/env node
/**
 * 菜单键盘模型门禁（全局 UX 线 P5）
 * =================================
 *
 * P5 立的命题：**视觉相同的菜单必须有相同的键盘模型**，而判断只许住在一处
 * （`packages/ui/src/control/menu.ts`），各端只做 DOM 那一半。
 * 这句话能不能守住，取决于有没有一把尺扫得出"第四枚菜单又自己写了一份"。
 *
 * **M1 每枚 `role="menu"` 都得接共享钩子**
 *   出现 `role="menu"` 的文件必须引用 `useMenuKeyboard`。
 *   立项现量（2026-10-28）：三枚菜单**四种**答案 —— 账号菜单一套完整的、
 *   rail 的 More 只接 `Escape`、习惯的 More 一条键都没接却挂了一条 `document` 上的
 *   `Escape` 监听、而这三处都没有任何测试会红。
 *
 * **M2 菜单项不许形成额外的 Tab 停靠**
 *   每个带 `role="menuitem"` 的 `<button>` 必须自己写 `tabIndex={-1}`。
 *   理由不是教条：菜单是一组互斥选项，不是一个 Tab 序列 —— 项可 Tab 时，
 *   用户 Tab 一下就"走出菜单但菜单还开着"，那是本线最难查的那类"看不见还开着"。
 *   ⚠️ 现量过一次真坑：dnd-kit 的 `attributes` 自带 `tabIndex: 0`，
 *   把它展开在 `tabIndex` **前面**才会被盖住（`RailNavigation.tsx` 里那段注释记着）。
 *   所以这一枚判的是"同一枚标签上有没有出现 `tabIndex={{-1}`"，不是判顺序。
 *
 * **M3 判断只许从那一处出口走**
 *   界面层（`apps/*`）不许直接 `import { menuActionOf }` —— 它必须经
 *   `useMenuKeyboard`。绕过去的那一处会立刻变成"第四份键盘模型"，而且看起来仍是绿的。
 *
 * **M4 共享层不许碰 DOM**
 *   `menu.ts` 里出现 `document` / `querySelector` / `.focus(` ⇒ 红。
 *   那一格守的是 AGENTS §3.5：共享层放判断，渲染归各端。
 *
 * 用法：`node scripts/check-menu-keyboard.mjs [--self-test]`
 * 🔴 未知旗标一律拒（§7 第 605 条）。
 */

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const ALLOWED_FLAGS = ['--self-test'];
const unknownFlags = process.argv.slice(2).filter((a) => a.startsWith('-') && !ALLOWED_FLAGS.includes(a));
if (unknownFlags.length > 0) {
  console.error(`❌ 未知旗标：${unknownFlags.join(' ')} —— 这枚尺不认它，会照常判默认那一份（§7 第 605 条）。`);
  process.exit(1);
}
const WANT_SELFTEST = process.argv.includes('--self-test');

const MENU_FILE = 'packages/ui/src/control/menu.ts';
const HOOK_FILE = 'apps/web/src/lib/menu/useMenuKeyboard.ts';
const SHELL_SCOPES = ['apps/web/src', 'apps/mobile/src'];
/**
 * JSX 属性那一格的 `role="menu"`。
 *
 * 🔴 不许写成 `text.includes('role="menu"')`：`apps/web/src/lib/keyboard-cursor.ts`
 * 里有 `[role="menu"]` 这种 **CSS 选择器**（它读的是"焦点落在一枚菜单上时别抢方向键"，
 * 本身不画菜单）。按子串判会把那一处报成"第四份键盘模型"—— 一把打宽的尺
 * 与一把打空的尺一样有害（§7 第 603 条）。属性形状前面必然是空白或 `>`。
 */
const MENU_ROLE_RE = /[\s>]role="menu"[\s>]/;
const MENUITEM_ROLE_RE = /role="menuitem"/;
/** 候选下限：低于它说明扫描面或写法变了，而不是"缺陷都修完了"。 */
/**
 * 候选下限。⚠️ 数的是**源码里的出现次数**，不是渲染出来的实例数
 * （账号菜单的项由一枚 `item()` 工厂生成，源码里只有一处 `role="menuitem"`）。
 * 所以 3/3 是今天的现量，不是"界面上只有三项"。
 */
const FLOORS = { menus: 3, menuItems: 3 };

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(scope) {
  const out = [];
  if (!statSync(scope, { throwIfNoEntry: false })?.isDirectory()) return out;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
    }
  };
  walk(scope);
  return out;
}

/** 一枚 `<button …>` 标签的完整文本（跨行；到第一个 `>` 为止，属性里不含 `>`）。 */
function buttonTags(text) {
  return [...text.matchAll(/<button\b[^>]*>/gs)].map((m) => m[0]);
}

/**
 * @param {{files: Array<{path: string, text: string}>, menuFile: string, hookFile: string}} tree
 */
export function check(tree) {
  const problems = [];
  const menuFiles = [];
  let menuItemCount = 0;

  for (const { path, text } of tree.files) {
    const clean = stripComments(text);
    const hasMenu = MENU_ROLE_RE.test(clean);
    if (hasMenu) {
      menuFiles.push(path);
      if (!clean.includes('useMenuKeyboard')) {
        problems.push(`M1 ${path} 画了 role="menu" 却没接 useMenuKeyboard —— 那里正在长出第四份键盘模型。`);
      }
    }
    for (const tag of buttonTags(clean)) {
      if (!MENUITEM_ROLE_RE.test(tag)) continue;
      menuItemCount += 1;
      if (!/tabIndex=\{-1\}/u.test(tag)) {
        problems.push(`M2 ${path} 的菜单项没有 tabIndex={-1} ⇒ Tab 会走进菜单而它仍开着：${tag.replace(/\s+/gu, ' ').slice(0, 80)}…`);
      }
    }
    if (path !== HOOK_FILE && /from\s+['"]@heyta\/ui['"]/u.test(clean) && /menuActionOf/u.test(clean)) {
      problems.push(`M3 ${path} 绕过 useMenuKeyboard 直接用了 menuActionOf ⇒ 判断出口不止一处。`);
    }
  }

  const menuImpl = stripComments(tree.menuFile);
  for (const domWord of ['document', 'querySelector', '.focus(']) {
    if (menuImpl.includes(domWord)) {
      problems.push(`M4 ${MENU_FILE} 里出现 ${domWord} —— 共享层只放判断，DOM 归各端（§3.5）。`);
    }
  }

  if (menuFiles.length < FLOORS.menus) {
    problems.push(`候选下限：只扫到 ${menuFiles.length} 枚 role="menu"（< ${FLOORS.menus}）—— 扫描面或写法变了，不是缺陷修完了。`);
  }
  if (menuItemCount < FLOORS.menuItems) {
    problems.push(`候选下限：只扫到 ${menuItemCount} 枚 menuitem（< ${FLOORS.menuItems}）—— M2 这一臂快瞎了。`);
  }
  return problems;
}

export function coverage({ files }) {
  const menus = files.filter(({ text }) => MENU_ROLE_RE.test(stripComments(text)));
  const items = files.reduce((n, { text }) => n + buttonTags(stripComments(text)).filter((t) => MENUITEM_ROLE_RE.test(t)).length, 0);
  return { menus: menus.length, items };
}

function scanTree() {
  const files = [];
  for (const scope of SHELL_SCOPES) {
    for (const abs of sourceFiles(join(ROOT, scope))) {
      files.push({ path: relative(ROOT, abs), text: readFileSync(abs, 'utf8') });
    }
  }
  return {
    files,
    menuFile: readFileSync(join(ROOT, MENU_FILE), 'utf8'),
    hookFile: readFileSync(join(ROOT, HOOK_FILE), 'utf8'),
  };
}

async function selftest() {
  const good = {
    files: [
      { path: 'apps/web/src/features/x/Good.tsx', text: '<div role="menu" aria-label="x"><button type="button" role="menuitem" tabIndex={-1} /></div> import { useMenuKeyboard } from "../../lib/menu/useMenuKeyboard.js";' },
      { path: 'apps/web/src/features/y/AlsoGood.tsx', text: '<div role="menu" aria-label="x"><button type="button" role="menuitem" tabIndex={-1} /><button type="button" role="menuitem" tabIndex={-1} /></div> useMenuKeyboard' },
      { path: 'apps/web/src/features/z/Third.tsx', text: '<div role="menu" aria-label="x"><button type="button" role="menuitem" tabIndex={-1} /></div> useMenuKeyboard' },
    ],
    menuFile: 'export function menuActionOf() { return { kind: "ignore" }; }',
    hookFile: 'import { menuActionOf } from "@heyta/ui";',
  };
  const arms = [];
  const push = (name, pass, detail) => arms.push({ name, pass, detail });

  push('① 合规夹具 ⇒ 零违规', check(good).length === 0, check(good).join(' | '));

  const noHook = structuredClone(good);
  noHook.files[0].text = '<div role="menu" aria-label="x"><button type="button" role="menuitem" tabIndex={-1} /></div>';
  const noHookRead = check(noHook);
  push('② 画了菜单却没接钩子 ⇒ M1 红', noHookRead.length === 1 && noHookRead[0].startsWith('M1'), noHookRead.join(' | '));

  const tabStop = structuredClone(good);
  tabStop.files[0].text = '<div role="menu" aria-label="x"><button type="button" role="menuitem" /></div> useMenuKeyboard';
  const tabStopRead = check(tabStop);
  push('③ 菜单项可被 Tab 停靠 ⇒ M2 红', tabStopRead.length === 1 && tabStopRead[0].startsWith('M2'), tabStopRead.join(' | '));

  const bypass = structuredClone(good);
  bypass.files[1].text = 'import { menuActionOf } from "@heyta/ui"; <div role="menu" aria-label="x"><button role="menuitem" tabIndex={-1} /></div> useMenuKeyboard';
  const bypassRead = check(bypass);
  push('④ 界面绕过钩子直接用判断 ⇒ M3 红', bypassRead.some((l) => l.startsWith('M3')), bypassRead.join(' | '));

  const domLeak = { ...good, menuFile: 'const el = document.querySelector("[role=menuitem]"); el.focus();' };
  const domRead = check(domLeak);
  push('⑤ 共享层碰了 DOM ⇒ M4 红（三条词各算一次）', domRead.filter((l) => l.startsWith('M4')).length === 3, domRead.join(' | '));

  const emptied = structuredClone(good);
  emptied.files = [{ path: 'apps/web/src/features/x/Good.tsx', text: 'export const x = 1;' }];
  const emptiedRead = check(emptied);
  push('⑥ 扫描面被清空 ⇒ 两枚候选下限都红（不许读成"都修完了"）', emptiedRead.filter((l) => l.startsWith('候选下限')).length === 2, emptiedRead.join(' | '));

  const commentTrap = structuredClone(good);
  commentTrap.files[0].text = '/* <div role="menu" aria-label="x"><button role="menuitem"></div> */ useMenuKeyboard';
  const commentRead = check(commentTrap);
  push('⑦ 注释里的 role="menu" 不许算进分母（否则 M2 会假红、下限会假绿）', commentRead.filter((l) => l.startsWith('M2')).length === 0, commentRead.join(' | '));

  const cov = coverage(good);
  push(`⑧ 现量读数进输出（菜单 ${cov.menus} 枚 / 项 ${cov.items} 枚）`, cov.menus === 3 && cov.items === 4, JSON.stringify(cov));

  let flagCode = 0;
  let flagErr = '';
  try {
    await runFile(process.execPath, [fileURLToPath(import.meta.url), '--self-tset'], { encoding: 'utf8' });
  } catch (err) {
    flagCode = err.code ?? 0;
    flagErr = String(err.stderr ?? '');
  }
  push(`⑨ 拼错的旗标 ⇒ rc=1（实际 rc=${flagCode}）`, flagCode === 1 && flagErr.includes('未知旗标'), flagErr.trim());

  let failed = 0;
  for (const arm of arms) {
    if (!arm.pass) failed += 1;
    console.log(`${arm.pass ? '✓' : '✗'} ${arm.name}${arm.pass ? '' : `\n    读数：${arm.detail}`}`);
  }
  console.log(`self-test：${arms.length} 枚臂，${failed} 枚不过。`);
  if (failed > 0) process.exit(1);
}

const tree = scanTree();
if (WANT_SELFTEST) {
  /**
   * 🔴 **必须 await**：`selftest()` 是 async（里面有一枚 `await runFile` 的子进程臂），
   * 不 await 就写 `selftest(); process.exit(0);` 的话 —— 主线程在第一个 `await` 处让出，
   * `process.exit(0)` 先跑，于是**九枚臂一条都没执行、console 一个字都没打、退出码 0**。
   * 这一格本条就是被它自己抓出来的：第一版就是这么写的，`--self-test` 静默退 0。
   * 一把"永远通过"的尺比没有尺更糟（§5 元规则二），所以这里连输出行数一起判。
   */
  await selftest();
  process.exit(0);
}

const problems = check(tree);
const cov = coverage(tree);
console.log(`菜单键盘门禁：role="menu" ${cov.menus} 枚、menuitem ${cov.items} 枚、判断出口 ${MENU_FILE}。`);
if (problems.length > 0) {
  for (const p of problems) console.error(`❌ ${p}`);
  console.error('\n出路是把这一格接回 `useMenuKeyboard`（判断在 `packages/ui/src/control/menu.ts`），不是往这里加豁免。');
  process.exit(1);
}
console.log('✅ 每一枚菜单都走同一份键盘判断，且没有菜单项形成额外 Tab 停靠。');
