/**
 * 从 `packages/i18n` 抽取**服务端**要用的文案，生成快照。
 * =======================================================
 *
 * ```sh
 * pnpm --filter @heyta/sync-server gen:server-copy          # 写盘
 * pnpm check:server-copy                                    # 只校验（门禁用）
 * ```
 *
 * ## 🔴 为什么是"抽取 + 提交生成物"，而不是运行时 import `@heyta/i18n`
 *
 * `server/Dockerfile` 只打包 `packages/{sync-core,shared-schema,domain}`，
 * **镜像里没有 `@heyta/i18n`**。而文案比色值更要紧 —— 它是用户直接读到的字。
 * 所以"真源只有一份"这条必须保证：邮件与凭据页的中英文案**就写在唯一的词条表里**
 * （`packages/i18n/src/locales/{zh-CN,en}.ts`，与客户端同一份），
 * 这里只是把它**搬**成服务端能读的形态。
 *
 * ❌ 绝不要在这条链上另写一份文案。`--check` 能挡住"生成物与词条表不一致"，
 * 挡不住"有人另建一个 server 私有文案表" —— 那是评审要抓的。
 *
 * ## 为什么用 TypeScript 的解析器，而不是正则或 `import()`
 *
 * · **正则**处理不了转义（`\'`、`\n`）—— 那会变成**第二套转义规则**，必然出错；
 * · **`import()`** 会撞上 `packages/i18n` 是 ESM 而本脚本跑在 CJS 下
 *   （实测 `ERR_REQUIRE_ESM`）。
 *
 * 用 TS 的 AST 两件事都没有：转义由 TS 自己解析，模块系统与它无关。
 * 代价是要认"具名变量 = 对象字面量（可能被 `as const` / `satisfies` 包着）"这一种形状 ——
 * **认不出就抛**，而不是安静地抽到 0 条（0 条会让所有邮件变成空字符串）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// ⚠️ 别名不叫 `ts`：本文件后面还有一个生成 TS 字面量的 helper，
//    同名会撞成 `Cannot access 'ts' before initialization`（实测踩到）。
import * as tsApi from 'typescript';

const SERVER = join(__dirname, '..');
const REPO = join(SERVER, '..');
const TARGET = join(SERVER, 'src/copy.generated.ts');

/** 服务端前缀。改这里等于改"哪些词条会被搬到服务端"。 */
const SERVER_PREFIX = 'server.';

const SOURCES = [
  { locale: 'zh-CN', file: join(REPO, 'packages/i18n/src/locales/zh-CN.ts'), exportName: 'zhCN' },
  { locale: 'en', file: join(REPO, 'packages/i18n/src/locales/en.ts'), exportName: 'en' },
];

/**
 * 用 TypeScript 的解析器读一份词条表，抽 `server.` 前缀的键值。
 *
 * 见文件头：为什么不正则、不 `import()`。
 */
function readCatalog(file: string, label: string, exportName: string): Record<string, string> {
  const text = readFileSync(file, 'utf8');
  const source = tsApi.createSourceFile(file, text, tsApi.ScriptTarget.Latest, true);

  let objectLiteral: tsApi.ObjectLiteralExpression | undefined;

  const visit = (node: tsApi.Node): void => {
    if (tsApi.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!tsApi.isIdentifier(decl.name)) continue;
        if (decl.name.text !== exportName) continue;

        let init: tsApi.Expression | undefined = decl.initializer;
        // 🔴 词条表是 `{ … } as const`（zh）与 `{ … } satisfies Record<…>`（en）——
        //    两种情况 initializer 都是**包装表达式**，不是裸的对象字面量。
        //    漏掉这一步的报错是"找不到形状"，看起来吓人，但原因只有这一条。
        if (
          init !== undefined &&
          (tsApi.isAsExpression(init) || tsApi.isSatisfiesExpression(init))
        ) {
          init = init.expression;
        }
        if (init !== undefined && tsApi.isObjectLiteralExpression(init)) {
          objectLiteral = init;
        }
      }
    }
    tsApi.forEachChild(node, visit);
  };
  visit(source);

  if (objectLiteral === undefined) {
    throw new Error(
      `${label}：在 ${relative(REPO, file)} 里找不到 \`${exportName} = { … }\` 的形状。\n` +
        '   词条表的结构变了 —— 请更新本脚本，不要让它抽到 0 条后安静地生成一份空表。',
    );
  }

  const out: Record<string, string> = {};
  for (const prop of objectLiteral.properties) {
    if (!tsApi.isPropertyAssignment(prop)) continue;
    const name = prop.name;
    if (!tsApi.isStringLiteral(name)) continue;
    if (!name.text.startsWith(SERVER_PREFIX)) continue;
    if (!tsApi.isStringLiteral(prop.initializer)) {
      throw new Error(
        `${label} 的词条 \`${name.text}\` 的值不是字符串字面量 —— 服务端模板只能消费字符串。`,
      );
    }
    out[name.text] = prop.initializer.text;
  }
  return out;
}

const catalogs: Record<string, Record<string, string>> = {};
for (const { locale, file, exportName } of SOURCES) {
  catalogs[locale] = readCatalog(file, locale, exportName);
}

const localeKeys = Object.keys(catalogs);
const firstLocale = localeKeys[0];
if (firstLocale === undefined) throw new Error('没有可用的语言');
const firstKeys = Object.keys(catalogs[firstLocale] ?? {}).sort();

// 两种语言的 key 集合必须一致 —— 服务端按 locale 取词条，缺一条就是运行时空串。
for (const locale of localeKeys.slice(1)) {
  const keys = Object.keys(catalogs[locale] ?? {}).sort();
  const missing = firstKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !firstKeys.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${locale} 与 ${firstLocale} 的 \`${SERVER_PREFIX}\` 词条集合不一致。\n` +
        `   缺：${missing.join(', ') || '（无）'}\n   多：${extra.join(', ') || '（无）'}`,
    );
  }
}

if (firstKeys.length === 0) {
  throw new Error(`词条表里一条 \`${SERVER_PREFIX}\` 都没有 —— 前缀被改名了？`);
}

/** TS 字符串字面量。用 JSON.stringify 是刻意的：转义**没有第二套规则**。 */
const lit = (value: string): string => JSON.stringify(value);

const lines: string[] = [];
lines.push('/**');
lines.push(' * 服务端（邮件 / 凭据页）用的文案快照 —— **自动生成，请勿手改**。');
lines.push(' *');
lines.push(' * 唯一事实源：`packages/i18n/src/locales/{zh-CN,en}.ts`（与客户端同一份词条表）');
lines.push(' * 重新生成：`pnpm --filter @heyta/sync-server gen:server-copy`');
lines.push(' * 校验漂移：`pnpm check:server-copy`（已接进 `pnpm check`）');
lines.push(' *');
lines.push(' * 🔴 只搬 `server.` 前缀的词条。**不要在这里手写第二份文案。**');
lines.push(' */');
lines.push('');
lines.push("export const SERVER_LOCALES = ['zh-CN', 'en'] as const;");
lines.push('');
lines.push('export type ServerLocale = (typeof SERVER_LOCALES)[number];');
lines.push('');
lines.push('/** 服务端可用词条的 key 联合类型（拼错是编译期错误）。 */');
lines.push('export type ServerCopyKey =');
for (const key of firstKeys) lines.push(`  | ${lit(key)}`);
lines.push('  ;');
lines.push('');
lines.push('/** 按语言分开的词条表。 */');
lines.push('export const SERVER_COPY: Record<ServerLocale, Record<ServerCopyKey, string>> = {');
for (const [locale, catalog] of Object.entries(catalogs)) {
  lines.push(`  ${lit(locale)}: {`);
  for (const key of firstKeys) lines.push(`    ${lit(key)}: ${lit(catalog[key] ?? '')},`);
  lines.push('  },');
}
lines.push('};');
lines.push('');

const output = lines.join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(TARGET, 'utf8');
  } catch {
    current = '';
  }
  if (current !== output) {
    console.error(
      `🔴 ${relative(REPO, TARGET)} 与词条表不一致。\n` +
        '   跑 `pnpm --filter @heyta/sync-server gen:server-copy` 重新生成，并一起提交。',
    );
    process.exit(1);
  }
  console.log(
    `✅ 服务端文案与词条表一致（${String(localeKeys.length)} 种语言 × ${String(firstKeys.length)} 条）。`,
  );
  process.exit(0);
}

writeFileSync(TARGET, output, 'utf8');
console.log(
  `✅ 已写入 ${relative(REPO, TARGET)}（${String(localeKeys.length)} 种语言 × ${String(firstKeys.length)} 条 \`${SERVER_PREFIX}\` 词条）`,
);
