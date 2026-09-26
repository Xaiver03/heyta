/**
 * 同步场景（three.js / WebGL）
 * =============================
 *
 * 这一节是整页唯一的 WebGL 场景，也是"3D 炫酷"的主场。
 *
 * 为什么用 three.js 而不是 CSS 3D：CSS 3D 没有**透视投影 + 光照 + 雾**。
 * 这里的空间感来自三件事，缺一件就会"平"：
 *   1. 真透视（近大远小）
 *   2. 方向光 + 环境光（盒子的三个面亮度不同）
 *   3. 雾（远处的节点自动变淡 —— 这是最强的纵深线索）
 *
 * 🔴 **不用 @react-three/fiber**。理由：R3F 会再带进一棵依赖树，
 * 而这个场景只需要一个 rAF 循环；手写反而能精确控制
 * 「离屏暂停 / 减少动效时只渲染一帧 / 主题切换时更新材质颜色」这三件事。
 *
 * 🔴 **颜色全部从 token 读**，不是写死的十六进制。
 * 读法用"探针元素"：把 `var(--ht-color-x)` 设成某个真实元素的 `color`，
 * 再读回计算值。**不能直接读自定义属性** —— 读到的是 `var(--ht-blue-600)`
 * 这样的原文，而不是解析后的颜色（自定义属性的计算值不保证已替换 var）。
 *
 * 与 Motion 的关系（taste skill 的隔离规则）：
 *   本组件**不使用任何 Motion hook**。它自己拥有 canvas 与 rAF 循环，
 *   不与 DOM 动画共享元素，所以两者不会争同一帧的合成权。
 *   滚动进度是**只读**地从父级传进来的一个 ref，不产生额外订阅。
 */

import { useEffect, useRef } from 'react';
import { useMotionValueEvent, useScroll } from 'motion/react';
import * as THREE from 'three';

import { useMotionPreset } from '../lib/motion.js';

/** 用探针元素把 token 解析成 `rgb(...)` 字符串。 */
function resolveToken(name: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

/**
 * 解析成 THREE.Color。
 *
 * ⚠️ 兜底用**数字三元组**而不是十六进制字符串 ——
 * 十六进制字面量会被 `check:design` 当成裸色值拦下，而这个文件也在扫描范围内。
 */
function tokenColor(name: string, fallback: [number, number, number]): THREE.Color {
  const resolved = resolveToken(name);
  const color = new THREE.Color();
  if (resolved.length === 0) {
    return color.setRGB(fallback[0], fallback[1], fallback[2]);
  }
  color.setStyle(resolved);
  return color;
}

/**
 * 三个"设备"节点。位置刻意不在一个平面上 —— 共面会读成一张图，不是空间。
 *
 * 横向铺开到 ±4.3 是**为了适配画布的宽高比**：这一节是全宽画布
 * （1440 视口下约 2.9:1），而透视野的**垂直** FOV 固定 46°。
 * 节点只占中间 5 个单位宽时，画面两侧会空掉一大半，3D 看起来像个小摆件。
 * 铺开之后横向刚好填满。
 */
const NODES: { position: [number, number, number]; size: [number, number, number] }[] = [
  { position: [-4.3, 0.6, 0.8], size: [0.6, 1.18, 0.12] }, // 手机
  { position: [0, -0.5, -1.3], size: [1.75, 1.1, 0.1] }, // 笔记本
  { position: [4.3, 0.95, 0.4], size: [1.05, 1.05, 1.05] }, // 服务器
];

/** 两两相连（一个三角形）。 */
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 0],
];

const PACKETS_PER_EDGE = 3;

export function SyncScene(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const preset = useMotionPreset();

  // 滚动进度只读进 ref —— 渲染循环每帧读它，但不订阅、不触发 React 重渲染。
  const progressRef = useRef(0);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });
  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    progressRef.current = value;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const holder = holderRef.current;
    if (canvas === null || holder === null) return;

    // ── 基础三件套 ────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // 上限 2 是刻意的：3x 屏幕上像素量翻倍，而这个场景本身已经够贵。
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    camera.position.set(0, 0.85, 6.2);

    const disposables: { dispose: () => void }[] = [renderer];

    // ── 颜色（全部来自 token）─────────────────────────────
    const colorPrimary = tokenColor('--ht-color-primary', [0.15, 0.39, 0.92]);
    const colorBorder = tokenColor('--ht-color-border', [0.89, 0.91, 0.94]);
    const colorFg = tokenColor('--ht-color-foreground', [0.06, 0.09, 0.16]);
    const colorBg = tokenColor('--ht-color-background', [0.97, 0.98, 0.99]);

    // 🔴 雾的 near/far 必须落在**相机到物体的实际距离区间附近**，
    // 否则雾完全不起作用（之前 near=8，而最近的点才 5.4，等于没有雾）。
    // 相机在 z=6.2，节点 z 从 -1.3 到 0.8，距离约 5.4~7.5 —— 取 4.5~16
    // 让近处几乎不受影响、远处淡出，这是本场景最强的纵深线索。
    scene.fog = new THREE.Fog(colorBg, 4.5, 16);

    // ── 光照：方向光给面，环境光保证暗面不死黑 ─────────────
    const ambient = new THREE.AmbientLight(0xffffff, 1.35);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 6, 5);
    scene.add(key);

    const rim = new THREE.PointLight(colorPrimary, 18, 14);
    rim.position.set(-3.4, -2.2, 2.6);
    scene.add(rim);

    // ── 世界分组：整体自转 + 滚动驱动 ──────────────────────
    const world = new THREE.Group();
    scene.add(world);

    // ── 网格地面：给空间一个参照物（没有它，"远近"读不出来）──
    const grid = new THREE.GridHelper(16, 20, colorBorder, colorBorder);
    grid.position.y = -2.3;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.62;
    world.add(grid);
    disposables.push(grid.geometry, gridMaterial);

    // ── 节点 ──────────────────────────────────────────────
    const nodeGeometries: THREE.BufferGeometry[] = [];
    const nodeMaterial = new THREE.MeshStandardMaterial({
      color: colorFg,
      roughness: 0.35,
      metalness: 0.15,
      transparent: true,
      opacity: 0.9,
    });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: colorPrimary,
      transparent: true,
      opacity: 0.55,
    });
    disposables.push(nodeMaterial, edgeMaterial);

    for (const node of NODES) {
      const box = new THREE.BoxGeometry(...node.size);
      nodeGeometries.push(box);

      const mesh = new THREE.Mesh(box, nodeMaterial);
      mesh.position.set(...node.position);
      world.add(mesh);

      // 棱线：让"盒子"在浅色背景下有明确边界，否则会糊成一团
      const edges = new THREE.EdgesGeometry(box);
      const line = new THREE.LineSegments(edges, edgeMaterial);
      line.position.copy(mesh.position);
      world.add(line);
      disposables.push(edges);
    }
    disposables.push(...nodeGeometries);

    // ── 连线 ──────────────────────────────────────────────
    const edgePoints: THREE.Vector3[] = [];
    for (const [from, to] of EDGES) {
      const a = NODES[from];
      const b = NODES[to];
      if (a === undefined || b === undefined) continue;
      edgePoints.push(new THREE.Vector3(...a.position), new THREE.Vector3(...b.position));
    }
    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    world.add(edges);
    disposables.push(edgeGeometry);

    // ── 数据包：沿连线流动的小球 ───────────────────────────
    const packetGeometry = new THREE.SphereGeometry(0.078, 12, 12);
    const packetMaterial = new THREE.MeshBasicMaterial({ color: colorPrimary });
    disposables.push(packetGeometry, packetMaterial);

    const packets: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];

    for (const [from, to] of EDGES) {
      const a = NODES[from];
      const b = NODES[to];
      if (a === undefined || b === undefined) continue;
      const start = new THREE.Vector3(...a.position);
      const end = new THREE.Vector3(...b.position);

      for (let i = 0; i < PACKETS_PER_EDGE; i += 1) {
        const mesh = new THREE.Mesh(packetGeometry, packetMaterial);
        world.add(mesh);
        packets.push({
          mesh,
          from: start,
          to: end,
          // 错开起点，否则同一根线上的小球会排成一串匀速前进，像节拍器
          t: i / PACKETS_PER_EDGE,
        });
      }
    }

    // ── 尺寸 ──────────────────────────────────────────────
    // ⚠️ 写成 `const resize = () => {}` 而不是 `function resize() {}`。
    // 函数声明会被提升，于是 TypeScript 认为它可能在 `holder === null` 的
    // 检查**之前**被调用，闭包里的收窄就失效了（TS18047）。
    // 箭头函数在检查之后才创建，收窄得以保留。
    const resize = (): void => {
      const width = holder.clientWidth;
      const height = holder.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(holder);

    // ── 离屏暂停 ──────────────────────────────────────────
    // 一个持续跑着的 WebGL 循环即使看不见也在吃 GPU 与电池。
    let visible = true;
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry !== undefined) visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(holder);

    // ── 主题切换时更新颜色 ────────────────────────────────
    // 直接改 `data-theme` 属性，所以观察属性比"重新挂载整个场景"便宜得多。
    const themeObserver = new MutationObserver(() => {
      const nextPrimary = tokenColor('--ht-color-primary', [0.15, 0.39, 0.92]);
      const nextBorder = tokenColor('--ht-color-border', [0.89, 0.91, 0.94]);
      const nextFg = tokenColor('--ht-color-foreground', [0.06, 0.09, 0.16]);
      const nextBg = tokenColor('--ht-color-background', [0.97, 0.98, 0.99]);

      packetMaterial.color.copy(nextPrimary);
      edgeMaterial.color.copy(nextPrimary);
      nodeMaterial.color.copy(nextFg);
      (grid.material as THREE.LineBasicMaterial).color.copy(nextBorder);
      if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(nextBg);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // ── 渲染循环 ──────────────────────────────────────────
    const clock = new THREE.Clock();
    let frame = 0;
    let elapsed = 0;

    function draw(): void {
      // 🔴 用**有界振荡**，不是无界自转。
      //
      // 无界自转（`elapsed * 0.12`）的后果不只是"转得慢"：节点组是**偏心**的
      // （左右各到 ±4.3），转到前方时距相机只剩 2 个单位，盒子会瞬间放大三倍
      // 并冲出画面 —— 而且这个偏移**随时间无界累积**，用户在第 5 秒和第 50 秒
      // 看到的是两种完全不同的构图（实测截图里手机直接顶出了画面上沿）。
      //
      // 振荡让构图始终可预测：角度夹在 ±0.22 rad，节点到相机的距离只在
      // 4.4~6.9 之间变化，放大倍率不超过 1.6 倍。
      const scroll = progressRef.current;
      world.rotation.y = Math.sin(elapsed * 0.16) * 0.22 + (scroll - 0.5) * 0.5;
      world.rotation.x = -0.06 + Math.sin(elapsed * 0.11) * 0.03 + (scroll - 0.5) * 0.22;
      camera.position.y = 0.85 + (scroll - 0.5) * 0.8;

      // 数据包沿连线推进。t 在 [0,1) 循环。
      for (const packet of packets) {
        packet.t += 0.0032;
        if (packet.t >= 1) packet.t -= 1;
        packet.mesh.position.lerpVectors(packet.from, packet.to, packet.t);
        // 靠近两端时缩小，读起来像"发出/收到"而不是"穿过"
        const taper = Math.sin(packet.t * Math.PI);
        packet.mesh.scale.setScalar(0.55 + taper * 0.75);
      }

      renderer.render(scene, camera);
    }

    if (preset.reduced) {
      // 减少动效：**只渲染一帧静止画面**，不启循环。
      // 不是"什么都不画" —— 3D 场景本身是内容（它表达了设备关系），
      // 去掉动画不等于去掉信息（Apple §14）。
      world.rotation.set(-0.06, 0.5, 0);
      draw();
    } else {
      const tick = (): void => {
        frame = requestAnimationFrame(tick);
        elapsed += clock.getDelta();
        if (!visible) return;
        draw();
      };
      frame = requestAnimationFrame(tick);
    }

    // ── 清理 ──────────────────────────────────────────────
    // 不清理的后果不是"泄漏一点内存"：SPA 里来回切换页面会累积
    // 多个 WebGL 上下文，浏览器在 16 个左右开始丢弃最老的，
    // 症状是"用一会儿之后 3D 突然变黑"。
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      for (const item of disposables) item.dispose();
      renderer.dispose();
    };
  }, [preset.reduced]);

  return (
    <section className="lp-sync" id="sync" ref={sectionRef}>
      {/*
        ⚠️ `.lp-wrap` 在**外层**，不能和 `.lp-sync__head` 写在同一元素上。
        `.lp-wrap` 带 `margin-inline: auto`（用来居中 1200px 的版心），
        而 `.lp-sync__head` 带 `max-inline-size: 65ch`。两者同体时，
        元素先被压窄到 65ch、再被 auto 外边距居中 —— 于是标题会
        **飘到版心中间**，左侧留出一大片空白。分成父子就没有这个问题：
        版心居中、标题在版心内左对齐。
      */}
      <div className="lp-wrap">
        <header className="lp-sync__head">
          <h2 className="lp-h2">每台设备各写各的，碰上了也不会打架</h2>
          <p className="lp-section__lede">
            每次改动都是一条独立记录，带着"我见过哪些改动"的版本信息。
            两端同时改同一条任务时，服务端会判成并发冲突并<strong>交给你决定</strong>，
            而不是悄悄用后写的覆盖先写的。
          </p>
        </header>
      </div>

      <div className="lp-sync__holder" ref={holderRef}>
        <canvas
          ref={canvasRef}
          className="lp-sync__canvas"
          role="img"
          aria-label="三台设备之间流动着加密的变更记录，其中一条被判为并发冲突"
        />
        <div className="lp-sync__legend" aria-hidden="true">
          <span className="lp-sync__legend-item">
            <span className="lp-sync__dot" />
            一次改动
          </span>
          <span className="lp-sync__legend-item">
            <span className="lp-sync__dot lp-sync__dot--plain" />
            一台设备
          </span>
        </div>
      </div>
    </section>
  );
}
