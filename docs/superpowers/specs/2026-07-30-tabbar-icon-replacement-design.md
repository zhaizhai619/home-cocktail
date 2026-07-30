# 底部导航图标替换设计

## 目标

将底部导航中“酒单”和“吧台”的 Lucide 图标替换为用户指定图标，消除“吧台”当前烧瓶图标带来的实验室联想，同时保持导航整体视觉一致。

## 最终图标映射

| 导航项 | Lucide 图标 | 本地资源文件 |
|---|---|---|
| 酒单 | `ReceiptText` | `menu.svg`、`menu-active.svg` 及同名 PNG |
| 吧台 | `Martini` | `materials.svg`、`materials-active.svg` 及同名 PNG |
| 我的 | `UserRound` | 保持现状 |

## 实现约束

- 不调整 `app.json` 中的页面路径、文字或图标文件路径。
- 保留现有 81×81 像素画布和透明背景。
- 普通态使用 `#9d9991`、`stroke-width="1.8"`。
- 选中态使用 `#242321`、`stroke-width="2.1"`。
- SVG 使用 Lucide 官方路径；PNG 由对应 SVG 重新渲染，避免手工描摹差异。
- 保留现有 Lucide ISC 许可证文件。

## 验证

- 检查四个 PNG 均为 81×81 RGBA 图片。
- 检查普通态与选中态的几何路径一致，仅颜色和线宽不同。
- 检查 `app.json` 仍引用现有 `menu*.png` 与 `materials*.png`。
- 运行现有测试，确认导航契约没有回归。
