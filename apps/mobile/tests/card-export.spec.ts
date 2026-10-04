/**
 * W7 成品图 · 移动端栅格化与落盘的判据
 * ==================================================================
 *
 * ## 判的是"两端导出的是同一尺寸的同一张图"这件事，不是"代码看起来对"
 *
 * 本壳没有 RN 组件测试栈（`@testing-library/react-native` 不在依赖里，引它要先过
 * AGENTS §3.1 + §3.2 两道门），所以这里仍是**两半**：
 *
 *   · **换算半**：`card-export-units.ts` 是纯函数，node 里值导入真跑。
 *     最有价值的一条是"两端各自把单位乘回契约像素"—— 那条直接把
 *     "iOS 传点、Android 传像素"这个坑钉住，而它的失效形状是**导出一张尺寸不对的图，
 *     屏幕上完全正常**。
 *   · **接线半**：原生模块名在三处（JS / Swift `moduleName()` / `.m` 的
 *     `RCT_EXTERN_MODULE`）必须逐字相同，Android 的目录名在两处（Kotlin /
 *     `card_export_paths.xml`）必须逐字相同，`surface` 必须真被渲染。
 *     这些全都**没有编译器帮忙**，而且错了不炸 —— 错了就是"按钮在、点了没反应"，
 *     本仓在小组件那一格交过学费。一律先剥注释再匹配（§7 第 50 条那种假绿）。
 *
 * ## 判据能不能红（本轮实测过的变异臂）
 *
 * | 臂 | 改动 | 红在哪一条 |
 * |---|---|---|
 * | A1 | `rasterScaleFor` 的除法改成乘法 | 「乘回契约像素」两条同时红 |
 * | A2 | `rasterRequestFor` 的 iOS 分支改成也交契约像素 | 「iOS 那一支乘回契约」红 |
 * | A3 | 把 `{surface}` 从 `CountdownScreen` 删掉 | 「surface 真被渲染」红 |
 * | A4 | 把 Kotlin 的 `DIR_NAME` 改成 `card_export` | 「目录名逐字相同」红 |
 * | A5 | 把 Swift 的 `moduleName()` 改成 `HeytaCardExportModule` | 「三处名字对齐」红 |
 * | A6 | 把 `alignmentBaseline` 改成 `dominantBaseline` | 「基线 prop 名用的是 RNSVG 真有的那个」红 |
 * | A7 | 把 `writeCardPng` 的 `no-module` 分支改成 `resolve('')` | 「没有原生模块时不许假装成功」红 |
 *
 * （读数落在 `docs/plans/countdown-w7-device-export.md` §6。）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { tokensForTheme, resolveTextStyle } from '@heyta/design-system';
import { EXPORT_CARD_EDGE_PX, EXPORT_CARD_HEIGHT_PX, EXPORT_CARD_SCALE, EXPORT_CARD_SIZE } from '@heyta/shared-schema';
import { buildCardExportLayout, type CardExportDrawOp, type CardExportRequest } from '@heyta/ui/node';
import { describe, expect, it } from 'vitest';

import { cardTextLinesFor, rasterRequestFor, rasterScaleFor } from '../src/lib/card-export-units';
import { writeCardPng } from '../src/lib/card-export-native';

const MOBILE_LIB = (name: string): string =>
  fileURLToPath(new URL(`../src/lib/${name}`, import.meta.url));
const MOBILE_SCREEN = (name: string): string =>
  fileURLToPath(new URL(`../src/screens/${name}`, import.meta.url));
const ANDROID = (rest: string): string =>
  fileURLToPath(new URL(`../android/app/src/main/${rest}`, import.meta.url));
const IOS = (name: string): string =>
  fileURLToPath(new URL(`../ios/Heyta/${name}`, import.meta.url));
const XCODE_PROJ = (): string =>
  fileURLToPath(new URL('../ios/Heyta.xcodeproj/project.pbxproj', import.meta.url));

/** 剥注释：把一行调用注释掉来糊过判据是本仓记过的第一种假绿。 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|\s)\/\/[^\n]*/gu, '$1');
}

function requestOf(dark = false): CardExportRequest {
  const tokens = tokensForTheme(dark ? 'dark' : 'light');
  return {
    texts: {
      title: '上线那天',
      face: '还有 12 天',
      date: '2026年11月14日',
      age: undefined,
    },
    theme: {
      tokens,
      text: {
        'screen-title': resolveTextStyle('screen-title', tokens),
        'section-title': resolveTextStyle('section-title', tokens),
        headline: resolveTextStyle('headline', tokens),
        'row-title': resolveTextStyle('row-title', tokens),
        'row-meta': resolveTextStyle('row-meta', tokens),
        caption: resolveTextStyle('caption', tokens),
        'group-label': resolveTextStyle('group-label', tokens),
        'tab-label': resolveTextStyle('tab-label', tokens),
        'panel-title': resolveTextStyle('panel-title', tokens),
        badge: resolveTextStyle('badge', tokens),
        'numeric-display': resolveTextStyle('numeric-display', tokens),
        'numeric-body': resolveTextStyle('numeric-body', tokens),
      },
    },
    accentColor: tokens['color.primary'],
    dateStem: '2026年11月14日',
  };
}

describe('W7 · 两端各自乘回契约像素（这条是"设备出图"的全部难点）', () => {
  // density 取 1 / 2 / 2.625 / 3 四档：2.625 是 PixelRatio 的真实取值之一，
  // 只测整数会让"除以整数"这类写法混过去。
  for (const density of [1, 2, 2.625, 3]) {
    it(`density ${String(density)}：版面单位 × density 恰好回到契约的宽与高`, () => {
      const layout = buildCardExportLayout(requestOf(), rasterScaleFor(density));
      // Android：交的是像素，本身就是契约值 ⇒ 不该随 density 变。
      const android = rasterRequestFor('android', layout.width, layout.height);
      expect(android).toEqual(EXPORT_CARD_SIZE);
      // iOS：交的是点 ⇒ 点 × 屏幕 scale == 契约像素。
      const ios = rasterRequestFor('ios', layout.width, layout.height);
      expect(Math.round(ios.width * density)).toBe(EXPORT_CARD_EDGE_PX);
      expect(Math.round(ios.height * density)).toBe(EXPORT_CARD_HEIGHT_PX);
      // 版面本身也自洽：单位宽 × density == 契约宽（说明"除以 density"这一步真做了）。
      expect(Math.round(layout.width * density)).toBe(EXPORT_CARD_EDGE_PX);
    });
  }

  it('倍率随 density 折回：rasterScaleFor(d) × d 恒等于 EXPORT_CARD_SCALE', () => {
    for (const density of [1, 2, 2.625, 3]) {
      expect(rasterScaleFor(density) * density).toBeCloseTo(EXPORT_CARD_SCALE, 10);
    }
    // 阳性对照：density 1 那一档必须与 web 用同一个倍率，
    // 否则"web 与移动端画的是同一张图"这件事根本没有对照物。
    expect(rasterScaleFor(1)).toBe(EXPORT_CARD_SCALE);
  });

  it('字号也跟着折：3× 设备上的 fontSize 恰好是 web 那一档的 1/3', () => {
    const web = buildCardExportLayout(requestOf(), rasterScaleFor(1));
    const phone = buildCardExportLayout(requestOf(), rasterScaleFor(3));
    const webSize = web.ops.find((op) => op.kind === 'text')?.fontSize;
    const phoneSize = phone.ops.find((op) => op.kind === 'text')?.fontSize;
    expect(webSize).toBeTypeOf('number');
    expect(phoneSize).toBeTypeOf('number');
    expect((phoneSize ?? 0) * 3).toBeCloseTo(webSize ?? 0, 8);
  });
});

describe('W7 · 折行在共享层，本端只贡献尺子', () => {
  /** 版面里"标题"那一条文字指令（`maxLines === 2` 的那一个），原样取出来用。 */
  function titleOp(_wantLines: number): CardExportDrawOp {
    const long = requestOf();
    long.texts.title = '这是一个非常非常非常长、足够在两行里放不下、必须再折一次的倒数日标题';
    const op = buildCardExportLayout(long, rasterScaleFor(2))
      .ops.find((candidate) => candidate.kind === 'text' && candidate.maxLines === 2);
    expect(op, '版面里没有标题那一条文字指令（maxLines 改了？）').toBeDefined();
    return op as CardExportDrawOp;
  }

  const textOpsOf = (request: CardExportRequest): CardExportDrawOp[] =>
    buildCardExportLayout(request, rasterScaleFor(3)).ops.filter((op) => op.kind === 'text');

  it('每一行的行数不超过版面给的 maxLines（多的会被叠在卡外，而尺寸判据照样绿）', () => {
    for (const op of textOpsOf(requestOf())) {
      const lines = cardTextLinesFor(op);
      expect(lines.length).toBeLessThanOrEqual(op.maxLines ?? 1);
    }
  });

  it('两行标题：y 严格递增、间距就是行高（叠在一起是这条判据唯一抓得到的形状）', () => {
    const lines = cardTextLinesFor(titleOp(2));
    expect(lines.length).toBe(2);
    const step = (lines[1]?.y ?? 0) - (lines[0]?.y ?? 0);
    expect(step).toBeCloseTo(lines[1]!.y - lines[0]!.y, 10);
    expect(step).toBeGreaterThan(0);
  });

  it('放不下的那种**必须**收成 maxLines 行并以省略号收尾（硬截会给出半句话）', () => {
    // 构造一条真放不下的：宽度给到只够 6 个汉字，标题 20 个字。
    const squeezed: CardExportDrawOp = {
      kind: 'text', x: 0, y: 0, width: 6 * 16, height: 24, radius: 0, color: '#000',
      text: '这是一个非常非常非常长、足够在两行里放不下、必须再折一次的倒数日标题',
      fontSize: 16, lineHeight: 24, maxLines: 2,
    };
    const lines = cardTextLinesFor(squeezed);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.line.endsWith('…')).toBe(true);
    // 阳性对照：同一串给足够宽就不该折，也不该带省略号。
    const wide = cardTextLinesFor({ ...squeezed, width: 4000 });
    expect(wide).toHaveLength(1);
    expect(wide[0]?.line.endsWith('…')).toBe(false);
  });

  it('单行不会多出第二个元素，也不会往下偏移', () => {
    const [first] = cardTextLinesFor({
      kind: 'text',
      x: 10,
      y: 20,
      width: 300,
      height: 24,
      radius: 0,
      color: '#000',
      text: '短',
      fontSize: 16,
      lineHeight: 24,
      maxLines: 2,
    });
    expect(cardTextLinesFor({
      kind: 'text', x: 10, y: 20, width: 300, height: 24, radius: 0, color: '#000',
      text: '短', fontSize: 16, lineHeight: 24, maxLines: 2,
    })).toHaveLength(1);
    // 行盒居中：y 落在行盒中间，不是顶边。
    expect(first?.y).toBe(20 + 24 / 2);
  });
});

describe('W7 · 落盘通道：没有原生模块时不许假装成功', () => {
  it('node 环境里 `require("react-native")` 拿不到模块 ⇒ 报 no-module', async () => {
    const result = await writeCardPng('heyta-x.png', 'aGVsbG8=');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no-module');
  });

  it('空 base64 在**没有模块**时仍先报 no-module，而不是 empty（顺序说明查找真发生了）', async () => {
    const result = await writeCardPng('heyta-x.png', '');
    expect(!result.ok && result.error).toBe('no-module');
  });

  it('导出这一路上一个网络调用都没有（扫源码，不是主张）', () => {
    const network = /\bfetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|\.sendBeacon\s*\(/gu;
    for (const file of [MOBILE_LIB('card-export.tsx'), MOBILE_LIB('card-export-units.ts'), MOBILE_LIB('card-export-native.ts'), MOBILE_SCREEN('CountdownScreen.tsx')]) {
      const hits = [...codeOf(file).matchAll(network)].map((m) => m[0] ?? '');
      expect(hits, `${file} 里出现了网络调用：${JSON.stringify(hits)}`).toEqual([]);
    }
    // 阳性对照：这把尺子喂一条已知命中的样本必须数得出非零。
    expect(
      [..."x = fetch('/y'); new WebSocket('w');".matchAll(network)].map((m) => m[0] ?? ''),
    ).toEqual(['fetch(', 'new WebSocket']);
  });
});

describe('W7 · 接线：那些没有编译器帮忙的名字', () => {
  const MOBILE_TS = codeOf(MOBILE_LIB('card-export-native.ts'));
  const KOTLIN = codeOf(ANDROID('java/com/heytamobile/fs/CardExportModule.kt'));
  const SWIFT = codeOf(IOS('HeytaCardExportModule.swift'));
  const BRIDGE_M = codeOf(IOS('HeytaCardExportModuleBridge.m'));

  it('模块名三处逐字相同（JS / Swift `moduleName()` / `.m` 的 RCT_EXTERN_MODULE）', () => {
    const js = /const CARD_EXPORT_MODULE_NAME = '([^']+)'/u.exec(MOBILE_TS)?.[1];
    const swift = /static func moduleName\(\) -> String! \{ "([^"]+)" \}/u.exec(SWIFT)?.[1];
    const objc = /RCT_EXTERN_MODULE\((\w+),/u.exec(BRIDGE_M)?.[1];
    expect(js, 'JS 侧没抓到模块名 —— 形状变了，这条判据已经失效').toBeTruthy();
    expect(swift).toBe(js);
    // `.m` 里的那个是 **ObjC 类名**，Swift 侧靠 `@objc(名字)` 给它一个稳定 extern 名。
    const objcName = /@objc\((\w+)\)/u.exec(SWIFT)?.[1];
    expect(objcName, 'Swift 类没有 @objc(...) extern 名').toBeTruthy();
    expect(objc).toBe(objcName);
  });

  it('Swift 的选择器与 `.m` 的 RCT_EXTERN_METHOD 逐字符对齐', () => {
    const swiftSel = /@objc\((writePngBase64:[^)]*)\)/u.exec(SWIFT)?.[1];
    // `.m` 里每个参数都带 ObjC 类型，类型本身写在括号里（`(NSString *)fileName`），
    // 所以这里的正则需要吃掉一层配对括号 —— 用 `[^)]*` 会在第一个 `)` 就截断，
    // 得到一个只剩 `writePngBase64:` 的假读数（本轮实测就是这么红出来的）。
    const mSel = /RCT_EXTERN_METHOD\((writePngBase64:(?:[^()]|\([^()]*\))*)\)/u.exec(BRIDGE_M)?.[1];
    expect(swiftSel).toBeTruthy();
    expect(mSel).toBeTruthy();
    // `.m` 里参数名可以带类型，取"标签序列"比较：writePngBase64:base64:resolve:reject:
    // 🔴 提取标签的正则必须允许**数字**：`writePngBase64:` 与 `base64:` 都以数字结尾，
    // 用 `[A-Za-z]+:` 会把这两段**静默丢掉**，于是这条判据只剩 `resolve:reject:` ——
    // 它照样会"绿"，而那两个名字其实根本没在对账（本轮就是这么红的，红得很值）。
    const labelsOf = (s: string): string =>
      (s.match(/[A-Za-z][A-Za-z0-9]*:/gu) ?? []).join('');
    expect(labelsOf(mSel ?? '')).toBe(labelsOf(swiftSel ?? ''));
    expect(labelsOf(mSel ?? '')).toBe('writePngBase64:base64:resolve:reject:');
  });

  it('Android 的缓存子目录名与 FileProvider 白名单逐字相同', () => {
    const kotlin = /DIR_NAME = "([^"]+)"/u.exec(KOTLIN)?.[1];
    const xml = /<cache-path name="[^"]+" path="([^"]+)"\s*\/>/u.exec(
      readFileSync(ANDROID('res/xml/card_export_paths.xml'), 'utf8'),
    )?.[1];
    expect(kotlin).toBeTruthy();
    // xml 里带尾斜杠（Android 要求目录），Kotlin 里不带 ⇒ 比的是去掉尾斜杠后的那一段。
    expect(xml?.replace(/\/$/u, '')).toBe(kotlin);
  });

  it('Kotlin 侧的 FileProvider authority 后缀与 manifest 里那个 `${applicationId}.…` 相同', () => {
    const suffix = /PROVIDER_AUTHORITY_SUFFIX = "([^"]+)"/u.exec(KOTLIN)?.[1];
    const manifest = readFileSync(ANDROID('AndroidManifest.xml'), 'utf8');
    expect(suffix).toBeTruthy();
    expect(manifest).toContain(`android:authorities="\${applicationId}.${String(suffix)}"`);
  });

  it('两个原生模块都注册了 / 加进了 Xcode target（忘了不报编译错，只让模块不存在）', () => {
    const mainApp = codeOf(ANDROID('java/com/heytamobile/MainApplication.kt'));
    expect(mainApp).toContain('add(CardExportPackage())');
    const proj = readFileSync(XCODE_PROJ(), 'utf8');
    for (const name of ['HeytaCardExportModule.swift', 'HeytaCardExportModuleBridge.m']) {
      // "在 Sources 编译阶段里"的**可数证据**是同一条注释出现两次：
      // 一次是 PBXBuildFile 的定义，一次是 Sources phase 的条目。
      // 只数一次会放过"定义了但没进 phase"那种（那正是小组件账本 W2-2 的形状）。
      const entries = proj.split(`${name} in Sources`).length - 1;
      expect(entries, `${name} 在 pbxproj 的 Sources 里出现 ${String(entries)} 次`).toBeGreaterThanOrEqual(2);
    }
  });

  it('移动端那一屏真的接上了导出（回调 + 文字 + surface 三件齐）', () => {
    const screen = codeOf(MOBILE_SCREEN('CountdownScreen.tsx'));
    expect(screen).toContain('onExportCard=');
    expect(screen).toContain('exportError=');
    // 🔴 `{surface}` 少了这一行，按钮照样在、点了永远没有图。
    expect(screen).toContain('{surface}');
    const labels = codeOf(MOBILE_LIB('countdown-display.ts'));
    expect(labels).toContain("exportCard: t('web.countdown.export')");
  });

  it('基线用的是 RNSVG 真有的那个 prop 名（`dominantBaseline` 会被静默忽略）', () => {
    const painter = codeOf(MOBILE_LIB('card-export.tsx'));
    expect(painter).toContain('alignmentBaseline="central"');
    expect(painter).not.toContain('dominantBaseline');
  });

  it('版面只有一个生产者：apps/ 下不许再写一遍 buildCardExportLayout', () => {
    // 判"没有第二份"靠的是扫这一处的定义点，而不是"我觉得没人写"。
    const painter = codeOf(MOBILE_LIB('card-export.tsx'));
    const webPainter = codeOf(fileURLToPath(new URL('../../../apps/web/src/features/countdown/card-export.ts', import.meta.url)));
    for (const source of [painter, webPainter]) {
      expect(/function buildCardExportLayout/u.test(source)).toBe(false);
    }
  });
});
