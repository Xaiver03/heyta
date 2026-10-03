# W7 · 纪念卡片**设备出图**证据（Android）

这张图**不是**截图，也不是 web 画的那张 —— 它是**装在模拟器里的应用自己写进沙盒的那串字节**，
由 `scripts/verify-mobile-card-export.sh` 第 5 步从设备拉回来存在这里。
产生它的那一趟：2026-10-04 07:41，载体 `7c63411b`，`pnpm verify:mobile-card-export` **rc=0**。

## 看见了什么（人打开这张图核对到的）

- 竖版卡片，浅底（设计系统的近白 + `surface-sunken` 外框），标题 `w7e2e-073853` 在左上，
  中间大字「还有 7 天」，左下「10月11日 星期日」，字色是前景墨色 / muted 石板灰两档。
- **左侧那条竖条是浅灰，不是主蓝** —— 这是**设计**不是缺陷：没选过模板时
  `EventBoard.tsx:641` 故意用 `color.surface-sunken`。所以这一趟不拿"含品牌蓝"当判据
  （那会把一条设计事实测成缺陷），脚本文件头写着同一条理由。
- 中文渲染正常（Hermes + 系统字体），没有豆腐块、没有截断、没有叠字。
- **两条互相自洽的交叉验证**（只有看图才会做）：跑这一趟的当天是 10-04，
  探针建的那条卡片日期是"7 天后"⇒ 图上「还有 7 天」与「10月11日」彼此对得上；
  文件名里的 `10月11日 星期日` 也是同一天。三者不一致就说明某一层算错了。

## 机器判据（同一趟打印的）

| 判据 | 读数 |
|---|---|
| ① 读数器自检（正向对照） | `apps/web/evidence/countdown-export/card-light.png` ⇒ `W=1080 H=1440 BYTES=66130 TRANSPARENT=false BLANK=false` |
| ① 读数器自检（反向对照） | `probe-3x2.png` ⇒ `W=3 H=2 BLANK=true` ⇒ 这台读数器**会区分**，不是恒返回契约值 |
| ② 点了才出现 | 点导出前缓存目录为空 ⇒ 点之后出现 `heyta-w7e2e-073853-10月11日 星期日.png` |
| ③ 字节等于契约 | 本文件 `W=1080 H=1440 BYTES=36493 TRANSPARENT=false BLANK=false SMEARED=false SHA=d6d2a88788d1` |
| ④ 零授权弹窗 | 全程结束后前台仍是 `com.heyta`，没有出现任何系统权限页 ⇒ 与 `packages/legal` 那句"不申请照片"同向 |

契约那两个数不是抄来的：`EXPORT_CARD_EDGE_PX` / `EXPORT_CARD_HEIGHT_PX` 在运行时从
`packages/shared-schema` 的**构建产物**里读回，所以"设备出图 = 契约"这句话两端都换了实现。
