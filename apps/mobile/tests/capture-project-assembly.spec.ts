/**
 * 手机端「新建落进哪一份清单」那一格的装配判据（M6-12 / 任务 #71）
 * =================================================================
 *
 * 产品定义那句「任务/便签/评论三族与另一台设备**双向**同步」此前在手机上只成立半句：
 * 三族的下行都有设备腿读数，上行只有评论那一族真走过 —— 因为手机上**根本没有**
 * "把一条新条目指到某一份清单"的控件（`actions.create` 两处调用点都不交 `projectId`、
 * `setNoteProject` 两壳零调用点）。本批补的就是那一枚控件，于是这里钉四格：
 *
 * ① 共享层两条提交路（规则解析 / AI 应用）**都**过 `withCaptureProject` ——
 *    只接一条会得到"手打的能选清单、AI 建的不能"，同一句话两端不同形。
 * ② 任务面板把计划里的 `projectId` 交给动作层（不交 ⇒ 手机新任务永远落收集箱）。
 * ③ 便签板**不选清单落点**：便签是"不想变成任务、不必马上安排"的独立记录，
 *    新建走 `createNote(content)`（省略 `projectId` = 未归属），不挂"落进哪份清单"那一行。
 * ④ 只有任务面板渲染那一行（`projectPicker`），文案是**整句**无障碍名（不拿前缀拼清单名）。
 *
 * ⚠️ ①–④ 钉的是"线接上了"；**真机上按一枚芯片、任务确实落进那份共享清单**由
 * 设备腿 L10 判（`scripts/verify-mobile-collab-ios.sh` 第 10d 步 + owner 侧验签）。
 */
import { describe, expect, it } from 'vitest';

import { read, stripComments } from './source-reading';

describe('① 共享层：两条提交路都带落点', () => {
  const code = stripComments(read('packages/ui/src/capture/CaptureComposer.tsx'));

  it('规则解析那一路（submit）过 withCaptureProject', () => {
    /*
     * 🔴 匹配到 `withCaptureProject(` 为止，**不锁第一个实参的名字**。
     * 这里守的是"提交必须过 withCaptureProject"这条行为，不是"中间变量叫 plan"。
     * 2026-11-14 加描述那一行时，中间变量从 `plan` 变成了 `withDescription`
     * （`plan` + 描述拼出来的新对象），断言就红了 —— 而行为一点没变。
     * 锁变量名的断言会在每次重构时假红一次，然后被人改成 `.*` 之后再也不红。
     */
    expect(code).toMatch(
      /onSubmit\(withCaptureProject\(\s*\w+,\s*captureSelectedProject\(projectPicker\)\?\.id\)\)/,
    );
  });

  it('AI 那一路**已经不在了**（2026-11 随「一句话捕获」整体删除）', () => {
    // 捕获框只剩规则解析那一条提交路：`submit`。原来那第二条（AI 应用）
    // 连着 `toAiCaptureSubmitPlan` 一起从共享层删掉了 —— 它不再有调用方。
    expect(code).not.toContain('toAiCaptureSubmitPlan');
  });

  it('那一行只在宿主给了 picker 时才画（web 不传 ⇒ 一处都不许多画）', () => {
    expect(code).toMatch(/projectPicker === undefined \? null : \(/);
  });
});

describe('② 任务面板：把选中的清单交给动作层', () => {
  const code = stripComments(read('apps/mobile/src/screens/TasksScreen.tsx'));

  it('create 的字段表里有 plan.projectId 那一枚条件展开', () => {
    expect(code).toContain('...(plan.projectId === undefined ? {} : { projectId: plan.projectId })');
  });

  it('可选项来自宿主的清单列表（含共享那一行），不是写死的', () => {
    expect(code).toMatch(/projects=\{projects\.map\(\(project\) => \(\{ id: project\.id, name: project\.name \}\)\)\}/);
  });

  it('面板关掉时落点回到默认（否则下一次新建悄悄沿用上一次的清单）', () => {
    expect(code).toMatch(/if \(!visible\) setProjectId\(null\);/);
  });
});

describe('③ 便签板：不选清单落点（便签是"不想变成任务"的独立记录）', () => {
  const code = stripComments(read('apps/mobile/src/screens/NotesSection.tsx'));

  it('便签新建不再挂"落进哪份清单"（`newNoteProjectId` 已随 iOS 式新建移除）', () => {
    expect(code).not.toContain('newNoteProjectId');
    expect(code).not.toContain('<CaptureProjectPickerRow');
  });

  it('新建便签走 `createNote(content)`，不带 projectId（省略 = 未归属）', () => {
    expect(stripComments(read('apps/mobile/src/screens/NoteEditScreen.tsx'))).toContain(
      '.createNote(content)',
    );
  });
});

describe('④ 只有任务面板渲染"落进哪份清单"那一行（便签不落清单）', () => {
  it('便签板**不再**挂 CaptureProjectPickerRow', () => {
    expect(stripComments(read('apps/mobile/src/screens/NotesSection.tsx'))).not.toContain(
      '<CaptureProjectPickerRow',
    );
  });

  it('任务面板经共享捕获器挂（projectPicker 属性）', () => {
    expect(stripComments(read('apps/mobile/src/screens/TasksScreen.tsx'))).toMatch(
      /projectPicker=\{\{/,
    );
  });

  it('无障碍名走整句词条，不拿前缀拼清单名', () => {
    const labels = stripComments(read('apps/mobile/src/lib/capture-labels.ts'));
    expect(labels).toContain("t('mobile.capture.project.optionAria', { name })");
    expect(labels).toContain("t('mobile.capture.project.inboxAria')");
    expect(labels).not.toMatch(/optionAria: \(name\) => `[^`]*\$\{name\}/);
  });

  it('每一枚芯片自己把"是不是落点"说出来（底色不是唯一线索）', () => {
    // `check:selection-single-source` 那枚门管的是**列表里选中的那一行**，这一格是表单里的落点、
    // 不在它的词表里 ⇒ "不许只靠颜色"这一格由本线自己钉住：谓词由落点 id 等值算出来，
    // 并且真的挂到无障碍通道上（摘掉 `aria-selected` 或把它换成常量，这一条就红）。
    const code = stripComments(read('packages/ui/src/capture/CaptureComposer.tsx'));
    expect(code).toMatch(/const on = picker\.destinationId === id;/);
    expect(code).toMatch(/aria-selected=\{on\}/);
  });

  it('那一行的标题念的是**此刻的落点**（选中态不许只靠颜色说话）', () => {
    const code = stripComments(read('packages/ui/src/capture/CaptureComposer.tsx'));
    expect(code).toContain('const selected = captureSelectedProject(picker);');
    expect(code).toMatch(
      /selected === undefined \? picker\.labels\.currentInbox : picker\.labels\.current\(selected\.name\)/,
    );
    // 静态组名只留给容器当无障碍标签，不许再坐在可见标题上（那是设备腿 L10 的针脚）。
    expect(code).not.toMatch(/styles\.projectTitle\]\}>\{picker\.labels\.title\}/);
  });
});
