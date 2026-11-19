import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { lightTokens } from '@heyta/design-system';
import { describe, expect, it, vi } from 'vitest';

import { FocusRing, type FocusRingProps } from '../src/focus/FocusRing.js';

vi.mock('react-native', () => ({
  StyleSheet: {
    absoluteFill: { position: 'absolute' },
    create: <T,>(styles: T): T => styles,
  },
  View: 'View',
}));

vi.mock('react-native-svg', () => ({
  Circle: 'Circle',
  Line: 'Line',
  Svg: 'Svg',
  Text: 'SvgText',
}));

vi.mock('../src/theme.js', async () => {
  const { resolveAllTextStyles } = await import('@heyta/design-system');
  return {
    useHeytaTokens: () => lightTokens,
    useHeytaText: () => resolveAllTextStyles(lightTokens),
  };
});

type TestElement = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

function elements(node: ReactNode): TestElement[] {
  if (!isValidElement(node)) return [];
  const element = node as TestElement;
  return [
    element,
    ...Children.toArray(element.props.children).flatMap((child) => elements(child)),
  ];
}

function ring(props: Partial<FocusRingProps> = {}): TestElement {
  return FocusRing({
    progress: 0.25,
    tone: 'work',
    label: '专注进度 25%',
    ...props,
  }) as TestElement;
}

function ofType(node: ReactNode, type: string): TestElement[] {
  return elements(node).filter((element) => element.type === type);
}

function hand(node: ReactNode, id: string): TestElement | undefined {
  return ofType(node, 'Line').find((element) => element.props.testID === id);
}

function hasCountdownRotation(node: ReactNode): boolean {
  return ofType(node, 'Svg').some((svg) => JSON.stringify(svg.props.style).includes('-90deg'));
}

const size = lightTokens['size.focus-ring'];
const center = size / 2;

describe('FocusRing 正计时钟面', () => {
  it('画 I–XII，XII 在顶部，钟面不继承倒计时圆弧的 -90° 旋转', () => {
    const tree = ring({ variant: 'dial', elapsedMs: 0 });
    const numerals = ofType(tree, 'SvgText');

    expect(numerals.map((numeral) => numeral.props.children)).toEqual([
      'XII',
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
      'VII',
      'VIII',
      'IX',
      'X',
      'XI',
    ]);
    expect(Number(numerals[0]?.props.x)).toBeCloseTo(center, 8);
    expect(Number(numerals[0]?.props.y)).toBeLessThan(center);
    expect(hasCountdownRotation(tree)).toBe(false);
  });

  it('秒针、分针、时针分别由 elapsedMs 驱动；缺省时都指向 XII', () => {
    const initial = ring({ variant: 'dial' });
    for (const id of ['focus-dial-hour-hand', 'focus-dial-minute-hand', 'focus-dial-second-hand']) {
      const initialHand = hand(initial, id);
      expect(initialHand, id).toBeDefined();
      expect(Number(initialHand?.props.x2)).toBeCloseTo(center, 8);
      expect(Number(initialHand?.props.y2)).toBeLessThan(center);
    }

    const seconds = hand(ring({ variant: 'dial', elapsedMs: 15_000 }), 'focus-dial-second-hand');
    expect(Number(seconds?.props.x2)).toBeGreaterThan(center);
    expect(Number(seconds?.props.y2)).toBeCloseTo(center, 8);

    const minutes = hand(
      ring({ variant: 'dial', elapsedMs: 15 * 60_000 }),
      'focus-dial-minute-hand',
    );
    expect(Number(minutes?.props.x2)).toBeGreaterThan(center);
    expect(Number(minutes?.props.y2)).toBeCloseTo(center, 8);

    const hours = hand(
      ring({ variant: 'dial', elapsedMs: 3 * 60 * 60_000 }),
      'focus-dial-hour-hand',
    );
    expect(Number(hours?.props.x2)).toBeGreaterThan(center);
    expect(Number(hours?.props.y2)).toBeCloseTo(center, 8);
  });
});

describe('FocusRing 既有契约', () => {
  it('倒计时仍画原来的进度弧并保留 -90° 起点，不混入钟面元素', () => {
    const tree = ring({ variant: 'progress', progress: 0.25, elapsedMs: 15_000 });
    const progressArc = ofType(tree, 'Circle').find(
      (circle) => circle.props.strokeDasharray !== undefined,
    );
    const radius = (size - lightTokens['size.focus-ring-stroke']) / 2;

    expect(progressArc).toBeDefined();
    expect(Number(progressArc?.props.strokeDashoffset)).toBeCloseTo(2 * Math.PI * radius * 0.75, 8);
    expect(hasCountdownRotation(tree)).toBe(true);
    expect(ofType(tree, 'SvgText')).toHaveLength(0);
    expect(hand(tree, 'focus-dial-second-hand')).toBeUndefined();
  });

  it('中央 children 与无障碍 label 原样保留', () => {
    const tree = ring({
      variant: 'dial',
      elapsedMs: 15_000,
      label: '已专注 15 秒',
      children: React.createElement('CenterTime', null, '00:15'),
    });

    expect(tree.props.accessibilityLabel).toBe('已专注 15 秒');
    expect(ofType(tree, 'CenterTime')[0]?.props.children).toBe('00:15');
  });
});
