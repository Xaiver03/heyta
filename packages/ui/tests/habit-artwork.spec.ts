import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { HABIT_ICONS } from '@heyta/domain';

import artwork from '../src/habits/habit-artwork.generated.json';

type DecodedPng = {
  width: number;
  height: number;
  alpha: Uint8Array;
};

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function decodeRgbaPng(dataUri: string): DecodedPng {
  expect(dataUri).toMatch(/^data:image\/png;base64,/);
  const bytes = Uint8Array.from(Buffer.from(dataUri.slice('data:image/png;base64,'.length), 'base64'));
  expect(bytes.slice(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];

  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const payload = bytes.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      const header = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      bitDepth = payload[8]!;
      colorType = payload[9]!;
      interlace = payload[12]!;
    } else if (type === 'IDAT') {
      idat.push(payload);
    } else if (type === 'IEND') {
      break;
    }
  }

  expect({ bitDepth, colorType, interlace }).toEqual({ bitDepth: 8, colorType: 6, interlace: 0 });
  const scanlines = Uint8Array.from(inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part)))));
  const stride = width * 4;
  const alpha = new Uint8Array(width * height);
  let sourceOffset = 0;
  let previous = new Uint8Array(stride);

  const paeth = (left: number, above: number, upperLeft: number): number => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    if (aboveDistance <= upperLeftDistance) return above;
    return upperLeft;
  };

  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[sourceOffset++];
    const row = scanlines.slice(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? row[i - 4]! : 0;
      const above = previous[i]!;
      const upperLeft = i >= 4 ? previous[i - 4]! : 0;
      if (filter === 1) row[i] = (row[i]! + left) & 0xff;
      else if (filter === 2) row[i] = (row[i]! + above) & 0xff;
      else if (filter === 3) row[i] = (row[i]! + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) row[i] = (row[i]! + paeth(left, above, upperLeft)) & 0xff;
      else expect(filter, `unsupported PNG filter at row ${y}`).toBe(0);
    }
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = row[x * 4 + 3]!;
    previous = row;
  }

  return { width, height, alpha };
}

describe('原创习惯图形运行时资源', () => {
  it('覆盖 24 个 domain key，顺序与 atlas 产品顺序一致', () => {
    expect(Object.keys(artwork)).toEqual([...HABIT_ICONS]);
    expect(Object.values(artwork)).toHaveLength(24);
  });

  it('每枚 data URI 都是真实可解码的 128x128 RGBA PNG', () => {
    for (const icon of HABIT_ICONS) {
      const decoded = decodeRgbaPng(artwork[icon]);
      expect(decoded.width, icon).toBe(128);
      expect(decoded.height, icon).toBe(128);
      expect(Math.max(...decoded.alpha), icon).toBeGreaterThan(0);
      expect(Math.min(...decoded.alpha), icon).toBe(0);
    }
  });

  it('每枚图形都保留透明外缘，圆形徽章没有被切到运行时边界', () => {
    for (const icon of HABIT_ICONS) {
      const { width, height, alpha } = decodeRgbaPng(artwork[icon]);
      let left = width;
      let top = height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (alpha[y * width + x] === 0) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      expect(left, icon).toBeGreaterThan(0);
      expect(top, icon).toBeGreaterThan(0);
      expect(right, icon).toBeLessThan(width - 1);
      expect(bottom, icon).toBeLessThan(height - 1);
    }
  });
});
