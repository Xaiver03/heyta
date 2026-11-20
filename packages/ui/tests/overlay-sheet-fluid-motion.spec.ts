import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/overlay/BottomSheet.tsx', import.meta.url), 'utf8');

describe('BottomSheet 全局跟手与动量', () => {
  it('边界用橡皮筋反馈，不在最大最小档硬停', () => {
    expect(source).toContain('rubberBandOffset');
  });

  it('松手用速度和动量预测选择档位，而不是只看最后位置', () => {
    expect(source).toContain('projectGestureOffset');
    expect(source).toContain("tokens['motion.deceleration-rate']");
  });

  it('识别手势之前的位移不会在接管瞬间重复叠加', () => {
    expect(source).toContain('gesture.dy - gestureOrigin.current');
  });

  it('吸附弹簧继承松手速度，只有带速度时才用动量阻尼', () => {
    expect(source).toContain('velocity: releaseVelocity.current');
    expect(source).toContain('{ momentum: releaseVelocity.current !== 0 }');
  });
});
