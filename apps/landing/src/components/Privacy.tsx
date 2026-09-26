/**
 * 隐私（滚动驱动的逐字加密）
 * ============================
 *
 * 这是整页最"贵"的一个效果，但它花的不是性能，是**语义**：
 * 同一句话左右并排，左边是你的设备、右边是服务端。
 * 滚动时右边的字**一个接一个变成密文** —— 用户不需要读任何解释，
 * 就能看懂"服务端从头到尾没见过明文"。
 *
 * 为什么不用 `setInterval` 做打字机：
 *   时间驱动的动画与用户的滚动位置**没有关系**，用户往回滚时它会继续往前跑，
 *   于是"我滚到哪了"和"画面上是什么"对不上。这里用**滚动进度**当唯一时间轴，
 *   往回滚字就变回明文 —— 可逆、可打断，符合 Apple §3。
 *
 * 性能：只在"已加密字数"**变化**时才 setState，所以整个滚动过程最多触发
 * `字数 + 1` 次重渲染，而不是每一帧一次。
 */

import { useRef, useState } from 'react';
import { useMotionValueEvent, useScroll } from 'motion/react';
import { Server, Smartphone } from 'lucide-react';

/** 演示用的明文。挑一句"一看就知道不该给别人看"的话。 */
const PLAINTEXT = '给妈妈买生日礼物';

const CIPHER_ALPHABET = '0123456789ABCDEF';

/**
 * 每个位置对应的密文字符。
 *
 * 🔴 用 sin 散列而不是 `Math.random()`：随机数会让每次刷新得到不同的密文，
 * 而 React 严格模式会渲染两遍 —— 用户会看到密文在闪。
 * 确定性还带来一个好处：这一屏**可以截图**，每次截到的都一样。
 *
 * 导出是为了让测试能验证这条确定性（见 `tests/determinism.spec.ts`）。
 */
export function cipherCharAt(index: number): string {
  const noise = Math.sin(index * 12.9898 + 4.1414) * 43758.5453;
  const unit = noise - Math.floor(noise);
  return CIPHER_ALPHABET[Math.floor(unit * CIPHER_ALPHABET.length)] ?? '0';
}

export function Privacy(): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const [encrypted, setEncrypted] = useState(0);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 0.85', 'end 0.45'],
  });

  const chars = [...PLAINTEXT];

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    // 进度 0 → 0 个字已加密；进度 1 → 全部加密
    const next = Math.round(Math.max(0, Math.min(1, value)) * chars.length);
    setEncrypted((previous) => (previous === next ? previous : next));
  });

  return (
    <section className="lp-section lp-privacy" id="privacy" ref={sectionRef}>
      <div className="lp-wrap">
        <header className="lp-section__head">
          <h2 className="lp-h2">服务端从头到尾没见过你的明文</h2>
          <p className="lp-section__lede">
            加密在你的设备上完成，密钥不出设备。服务端拿到的是一段它打不开的东西，
            而且<strong>没有任何开关能让它看到明文</strong> —— 不是"我们承诺不看"，是"看不到"。
          </p>
        </header>

        <div className="lp-privacy__panels">
          <div className="lp-privacy__panel">
            <div className="lp-privacy__panel-head">
              <Smartphone size={16} aria-hidden="true" />
              你的设备
            </div>
            <p className="lp-privacy__text">{PLAINTEXT}</p>
            <p className="lp-privacy__note">密钥在这里，也留在这里</p>
          </div>

          <div className="lp-privacy__panel lp-privacy__panel--server">
            <div className="lp-privacy__panel-head">
              <Server size={16} aria-hidden="true" />
              服务端
            </div>
            <p className="lp-privacy__text lp-privacy__text--cipher">
              {chars.map((char, index) => (
                <span
                  key={`${char}-${String(index)}`}
                  className={
                    index < encrypted
                      ? 'lp-privacy__char lp-privacy__char--locked'
                      : 'lp-privacy__char'
                  }
                >
                  {index < encrypted ? cipherCharAt(index) : char}
                </span>
              ))}
            </p>
            <p className="lp-privacy__note">
              {encrypted === 0
                ? '往下滚，看看它到底收到了什么'
                : `已加密 ${String(encrypted)} / ${String(chars.length)} 个字`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
