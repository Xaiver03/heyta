/**
 * 清单「移入文件夹」的两端接线对账（读源码，不 render）
 * ======================================================
 *
 * ⚠️ 为什么这里不 render 组件：`packages/ui/vitest.config.ts` 文件头写明了本仓库
 * **不引入 DOM 测试栈**（为了测一个组件而装一整套 jsdom 测试栈，代价是长期的维护面
 * 与许可证登记，而"渲染得对不对"的真判据在三个平台的壳级验收）。
 * 组件里因此只该留**没有分支**的那一层，本文件钉的是它外面那一圈接线。
 *
 * 四件事，各挡一种"类型检查、构建、既有测试全都不会红"的坏法：
 *   1. 两端**都真的有入口**（动作层有函数、界面上零入口 = 用户那儿没这个功能）。
 *   2. 两端的候选集来自**同一个领域函数**（各自筛一遍迟早漂成两套标准，
 *      症状是"手机上能选、电脑上不能选"）。
 *   3. 被拒时**失败可见**（`.catch` + 走共享的 reason→词条映射），
 *      否则就是"点了没反应"，而数据什么都没变 —— 本仓最恨的这一类。
 *   4. 共享组件**不许自己 import i18n**（`@heyta/i18n` 是唯一文案事实源，
 *      但文案由宿主注入，共享层才能被任何一端原样复用）。
 *
 * 中英键集对等不在这里测 —— `packages/i18n/tests/catalog.spec.ts` 已经双向钉住了，
 * 再抄一遍就是第二份标准（抄件一定会漂）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

const MOBILE = resolve(repo, 'apps/mobile/src/screens/ListsSection.tsx');
const WEB = resolve(repo, 'apps/web/src/features/projects/ProjectsPanel.tsx');
const WEB_STORE = resolve(repo, 'apps/web/src/features/projects/store.ts');
const PICKER = resolve(repo, 'packages/ui/src/projects/FolderPicker.tsx');

describe('清单「移入文件夹」：两端都真的有入口', () => {
  for (const [name, file] of [
    ['mobile', MOBILE],
    ['web', WEB],
  ] as const) {
    it(`${name} 把 FolderPicker 挂进了 OrganizerList 已有的行尾插槽`, () => {
      const src = readFileSync(file, 'utf8');
      // 三条都要命中：import、挂在**已有的** `renderItemExtra` 插槽上、真的调改父动作。
      // 只命中 import 的那种"接了一半"，与本仓 `check:ai-coverage` 的按端枚举同口径。
      expect(src).toContain('FolderPicker');
      expect(src).toContain('renderItemExtra=');
      expect(src).toMatch(/setParent\(|setProjectParent\(/);
    });

    it(`${name} 的候选集来自领域函数，不是界面自己筛的`, () => {
      expect(readFileSync(file, 'utf8')).toContain('folderTargetsFor(');
    });

    it(`${name} 被拒时把原因显示出来（有 catch，且走共享的 reason→词条映射）`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('.catch(');
      expect(src).toContain('folderRejectionMessageKey(');
    });
  }

  it('web 的 store 是薄转发，不在壳里做第二份判断', () => {
    const src = readFileSync(WEB_STORE, 'utf8');
    expect(src).toContain('projectActions.setParent(');
    // 🔴 只认**调用形状**（带括号的调用），不认裸标识名：store 的注释里正当提到
    //    领域函数叫什么名字，按裸名匹配会把"解释这条边界为什么存在的那句话"
    //    当成违规（本仓踩过：抄门禁原文进被扫描的台账 = 自己造一条新违规）。
    expect(/(?<![.\w])validateProjectParentChange\s*\(/.test(src)).toBe(false);
  });

  it('共享组件不 import i18n —— 文案由宿主注入', () => {
    const src = readFileSync(PICKER, 'utf8');
    // 同上：认的是 import 语句这个形状，不是文件里出现了这个包名（注释里必须能说明边界）。
    expect(/from ['"]@heyta\/i18n['"]/.test(src)).toBe(false);
  });
});
