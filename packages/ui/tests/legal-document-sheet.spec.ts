/**
 * 法律阅读弹层的结构契约。
 *
 * `packages/ui` 的测试环境不渲染 React Native（见 vitest.config.ts），所以这里
 * 钉住会影响用户旅程的承重形状；跨端像素与点击路径由各宿主的 UI 验收负责。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sheetSource = readFileSync(
  fileURLToPath(new URL('../src/auth/LegalDocumentSheet.tsx', import.meta.url)),
  'utf8',
);
const authSource = readFileSync(
  fileURLToPath(new URL('../src/auth/AuthForm.tsx', import.meta.url)),
  'utf8',
);

describe('LegalDocumentSheet —— 阅读不会破坏认证表单上下文', () => {
  it('打开由宿主控制，关闭只调用 onClose，组件不拥有表单状态', () => {
    expect(sheetSource).toMatch(/visible=\{visible\}/);
    expect(sheetSource).toMatch(/onRequestClose=\{onClose\}/);
    expect(sheetSource).toMatch(/onPress=\{onClose\}/);
    expect(sheetSource).not.toMatch(/useState/);
  });

  it('正文从注入的 document 按当前语言读取，未复制另一套法律内容', () => {
    expect(sheetSource).toMatch(/document\.sections\[locale\]/);
    expect(sheetSource).toMatch(/document\.title\[locale\]/);
    expect(sheetSource).not.toMatch(/服务条款|隐私政策|Terms of Service|Privacy Policy/);
  });

  it('弹层使用轻阴影表达层级，不重新画边框', () => {
    expect(sheetSource).toMatch(/shadow\.md/);
    expect(sheetSource).not.toMatch(/borderWidth|borderColor|borderStyle/);
  });

  it('表格每个值都带自己的列标签，窄屏不会把表头和数据堆成无意义的三行', () => {
    expect(sheetSource).toMatch(/tableField/);
    expect(sheetSource).toMatch(/block\.head\[cellIndex\]/);
    expect(sheetSource).toMatch(/tableLabel/);
    expect(sheetSource).toMatch(/tableGridRow/);
    expect(sheetSource).toMatch(/compact/);
    const recordStyle = sheetSource.slice(sheetSource.indexOf('tableRecord:'), sheetSource.indexOf('tableField:'));
    expect(recordStyle).not.toContain('backgroundColor');
  });

  it('桌面表格使用同一组 flex 列，移动端退化为无卡片的标签和值', () => {
    expect(sheetSource).toMatch(/block\.head\.map/);
    expect(sheetSource).toMatch(/style=\{styles\.tableGridCell\}/);
    expect(sheetSource).toMatch(/style=\{styles\.tableRecord\}/);
    expect(sheetSource).not.toMatch(/backgroundColor:\s*tokens\['color\.info-subtle'\]/);
  });

  it('重要说明使用语义强调与留白，而不是彩色大卡片', () => {
    expect(sheetSource).toMatch(/calloutText/);
    expect(sheetSource).toContain("calloutText: { ...text['row-title']");
    expect(sheetSource).not.toMatch(/styles\.callout[\s\S]{0,240}backgroundColor/);
  });

  it('四列及以上的桌面表格也退化为记录式布局，避免窄列挤压', () => {
    expect(sheetSource).toMatch(/block\.head\.length\s*>=\s*4/);
    expect(sheetSource).toMatch(/useRecordLayout/);
  });

  it('窄屏标题允许换行，关闭按钮不参与标题压缩', () => {
    expect(sheetSource).toMatch(/title:\s*\{[^}]*flexShrink:\s*1/);
    expect(sheetSource).toMatch(/close:\s*\{[\s\S]*?minWidth:/);
  });

  it('正文层级由共享文字样式表达，子标题与顶层标题分开', () => {
    expect(sheetSource).toMatch(/depth === 0 \? text\['section-title'\] : text\.headline/);
    expect(sheetSource).toMatch(/section\.subsections\?\.map/);
  });

  it('草案状态沿用法律文本的行内标记渲染，不把 ** 原样显示', () => {
    expect(sheetSource).toMatch(/InlineText[\s\S]{0,120}value=\{labels\.status\}/);
    expect(sheetSource).not.toMatch(/>\{labels\.status\}<\/Text>/);
  });

  it('固定头部只保留标题与关闭，摘要随正文滚动且不挤占固定头部', () => {
    const headerAt = sheetSource.indexOf('<View style={styles.header}>');
    const scrollAt = sheetSource.indexOf('<ScrollView key={document.id}');
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(scrollAt).toBeGreaterThan(headerAt);
    const fixedHeader = sheetSource.slice(headerAt, scrollAt);
    expect(fixedHeader).not.toContain('document.summary[locale]');
    expect(fixedHeader).not.toContain('labels.status');
    expect(fixedHeader).not.toContain('labels.meta');
    const scrollBody = sheetSource.slice(scrollAt);
    expect(scrollBody).toContain('labels.status');
    expect(scrollBody).toContain('labels.meta');
    expect(scrollBody).toContain('document.summary[locale]');
  });
});

describe('AuthForm —— 注册口令提示不再消费', () => {
  it('兼容接收旧字段，但不把 passwordHint 渲染到输入框下方', () => {
    expect(authSource).toMatch(/passwordHint\?: string/);
    expect(authSource).not.toMatch(/labels\.passwordHint/);
    expect(authSource).not.toMatch(/showPasswordHint/);
  });
});
