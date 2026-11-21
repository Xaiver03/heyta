import React, { useMemo } from 'react';
import { View, Text as RNText } from 'react-native';
import MarkdownIt from 'markdown-it';

import { useTokens } from '../theme';

/**
 * AI 回复的 Markdown 渲染（纯 JS，无原生依赖）。
 *
 * 参考：开源 AI 客户端 **Chatbox**（`chatboxai/chatbox`，GPL-3.0，桌面 Electron +
 * iOS/Android + Web 三端齐全）用 `react-markdown` + `remark-gfm/katex` 渲染回复。
 * RN 端没有 DOM，`react-markdown` 不可用；`@ronradtke/react-native-markdown-display`
 * 会拖入 `@react-native-vector-icons` 原生依赖。因此这里用同一底座
 * **`markdown-it`（MIT，2026 维护）** 的 token 流，自己渲染成 RN 组件 ——
 * 好处是完全受设计 token 控制、零原生依赖、包体可控。
 *
 * 覆盖：标题(h1–h6)、段落、无序/有序（含嵌套）列表、引用、代码块、行内代码、
 * 粗体、斜体、删除线、链接、分割线、表格、换行。
 */

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

type AnyToken = {
  type: string;
  tag: string;
  nesting: number;
  content: string;
  children?: AnyToken[] | null;
  attrGet?: (name: string) => string | null;
};
interface Node {
  token: AnyToken;
  children: Node[];
}

function buildTree(tokens: AnyToken[]): Node[] {
  const root: Node[] = [];
  const stack: Node[] = [{ token: { type: 'root', tag: '', nesting: 0, content: '' }, children: root }];
  for (const tok of tokens) {
    const cur = stack[stack.length - 1]!;
    if (tok.nesting === 1) {
      const node: Node = { token: tok, children: [] };
      cur.children.push(node);
      stack.push(node);
    } else if (tok.nesting === -1) {
      if (stack.length > 1) stack.pop();
    } else {
      cur.children.push({ token: tok, children: [] });
    }
  }
  return root;
}

type Tokens = ReturnType<typeof useTokens>;

function renderInline(
  nodes: Node[],
  t: Tokens,
  base: Record<string, unknown>,
  keyBase: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const stack: Record<string, unknown>[] = [];
  let acc: Record<string, unknown> = { ...base };
  nodes.forEach((node, i) => {
    const tok = node.token;
    const k = `${keyBase}-i${i}`;
    const mono = { fontFamily: t['font.mono'] } as const;
    switch (tok.type) {
      case 'text':
        if (tok.content) out.push(<RNText key={k} selectable style={acc}>{tok.content}</RNText>);
        break;
      case 'strong_open':
        stack.push({ ...acc });
        acc = { ...acc, fontWeight: '700' };
        break;
      case 'em_open':
        stack.push({ ...acc });
        acc = { ...acc, fontStyle: 'italic' };
        break;
      case 's_open':
        stack.push({ ...acc });
        acc = { ...acc, textDecorationLine: 'line-through' };
        break;
      case 'strong_close':
      case 'em_close':
      case 's_close':
        acc = stack.pop() ?? acc;
        break;
      case 'code_inline':
        out.push(
          <RNText key={k} selectable style={[acc, mono, { backgroundColor: t['color.surface-subtle'] }]}>
            {tok.content}
          </RNText>,
        );
        break;
      case 'link_open':
        stack.push({ ...acc });
        acc = { ...acc, color: t['color.primary'], textDecorationLine: 'underline' };
        break;
      case 'link_close':
        acc = stack.pop() ?? acc;
        break;
      case 'softbreak':
      case 'hardbreak':
        out.push(<RNText key={k}>{'\n'}</RNText>);
        break;
      case 'image': {
        const alt = tok.attrGet?.('alt') ?? '';
        out.push(<RNText key={k} selectable style={acc}>{alt}</RNText>);
        break;
      }
      default:
        if (tok.content) out.push(<RNText key={k} selectable style={acc}>{tok.content}</RNText>);
    }
  });
  return out;
}

function renderTable(node: Node, t: Tokens, keyBase: string): React.ReactNode {
  const rows: Node[] = [];
  const walk = (n: Node): void => {
    if (n.token.type === 'tr_open') {
      rows.push(n);
      return;
    }
    n.children.forEach(walk);
  };
  node.children.forEach(walk);
  return (
    <View key={keyBase}>
      {rows.map((row, ri) => {
        const cells = row.children.filter((c) => c.token.type === 'th_open' || c.token.type === 'td_open');
        const isHeader = cells.some((c) => c.token.type === 'th_open');
        return (
          <View key={`${keyBase}-r${ri}`} style={{ flexDirection: 'row' }}>
            {cells.map((cell, ci) => {
              const inline = cell.children.find((c) => c.token.type === 'inline');
              return (
                <RNText
                  key={`${keyBase}-r${ri}-c${ci}`}
                  selectable
                  style={{
                    flex: 1,
                    paddingVertical: t['space.1'],
                    paddingRight: t['space.2'],
                    fontWeight: isHeader ? '700' : '400',
                    fontSize: t['font-size.sm'],
                    color: t['color.foreground'],
                    lineHeight: t['line-height.normal'],
                  }}
                >
                  {inline ? renderInline(inline.children, t, { fontSize: t['font-size.sm'], color: t['color.foreground'] }, `${keyBase}-r${ri}-c${ci}`) : ''}
                </RNText>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function renderNodes(nodes: Node[], t: Tokens, keyBase: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const tok = node.token;
    const k = `${keyBase}-b${i}`;
    switch (tok.type) {
      case 'heading_open': {
        const tag = tok.tag;
        const size =
          tag === 'h1' ? t['font-size.2xl'] : tag === 'h2' ? t['font-size.xl'] : tag === 'h3' ? t['font-size.lg'] : t['font-size.md'];
        const inline = node.children.find((c) => c.token.type === 'inline');
        return (
          <RNText
            key={k}
            selectable
            style={{
              fontSize: size,
              fontWeight: '700',
              color: t['color.foreground'],
              lineHeight: t['line-height.tight'],
              marginTop: t['space.2'],
              marginBottom: t['space.1'],
            }}
          >
            {inline ? renderInline(inline.children, t, { fontSize: size, fontWeight: '700', color: t['color.foreground'] }, k) : null}
          </RNText>
        );
      }
      case 'paragraph_open': {
        const inline = node.children.find((c) => c.token.type === 'inline');
        return (
          <RNText
            key={k}
            selectable
            style={{ fontSize: t['font-size.base'], lineHeight: t['line-height.relaxed'], color: t['color.foreground'], marginVertical: 2 }}
          >
            {inline ? renderInline(inline.children, t, { fontSize: t['font-size.base'], lineHeight: t['line-height.relaxed'], color: t['color.foreground'] }, k) : null}
          </RNText>
        );
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = tok.type === 'ordered_list_open';
        const startAttr = tok.attrGet?.('start');
        const start = startAttr ? Number(startAttr) : 1;
        const items = node.children
          .filter((c) => c.token.type === 'list_item_open')
          .map((li, liIdx) => (
            <View key={`${k}-li${liIdx}`} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <RNText
                selectable
                style={{
                  width: 22,
                  color: t['color.foreground-muted'],
                  fontSize: t['font-size.base'],
                  lineHeight: t['line-height.relaxed'],
                }}
              >
                {ordered ? `${start + liIdx}.` : '•'}
              </RNText>
              <View style={{ flex: 1 }}>{renderNodes(li.children, t, `${k}-li${liIdx}`)}</View>
            </View>
          ));
        return (
          <View key={k} style={{ marginVertical: 2 }}>
            {items}
          </View>
        );
      }
      case 'blockquote_open':
        return (
          <View
            key={k}
            style={{ borderLeftWidth: 3, borderLeftColor: t['color.primary'], paddingLeft: t['space.3'], marginVertical: t['space.1'] }}
          >
            {renderNodes(node.children, t, k)}
          </View>
        );
      case 'fence':
      case 'code_block': {
        const code = tok.content.replace(/\n$/, '');
        return (
          <View
            key={k}
            style={{ backgroundColor: t['color.surface-sunken'], borderRadius: t['radius.md'], padding: t['space.2'], marginVertical: t['space.1'] }}
          >
            <RNText
              selectable
              style={{ fontFamily: t['font.mono'], fontSize: t['font-size.sm'], color: t['color.foreground'], lineHeight: t['line-height.normal'] }}
            >
              {code}
            </RNText>
          </View>
        );
      }
      case 'hr':
        return <View key={k} style={{ height: 1, backgroundColor: t['color.surface-sunken'], marginVertical: t['space.2'] }} />;
      case 'table_open':
        return (
          <View key={k} style={{ marginVertical: t['space.1'] }}>
            {renderTable(node, t, k)}
          </View>
        );
      case 'inline': {
        return (
          <RNText key={k} selectable style={{ fontSize: t['font-size.base'], color: t['color.foreground'] }}>
            {renderInline(node.children, t, { fontSize: t['font-size.base'], color: t['color.foreground'] }, k)}
          </RNText>
        );
      }
      default:
        return null;
    }
  });
}

export function MarkdownMessage({ text }: { text: string }): React.JSX.Element {
  const t = useTokens();
  const nodes = useMemo(() => {
    try {
      return buildTree(md.parse(text, {}) as unknown as AnyToken[]);
    } catch {
      return [];
    }
  }, [text]);
  if (nodes.length === 0) {
    return <RNText selectable style={{ fontSize: t['font-size.base'], lineHeight: t['line-height.relaxed'], color: t['color.foreground'] }}>{text}</RNText>;
  }
  return <View>{renderNodes(nodes, t, 'md')}</View>;
}
