# DEVELOPMENT.md · 开发文档

## 一、项目概览

AE 滚动歌词生成器：多行歌词 → 逐句图层 + 滚动动画 + 中心高亮。核心思路是「一个滚动控制器 + 一个总控制 + N 个表达式图层」，全部由脚本生成，参数可存预设。

## 二、架构说明

### 图层结构（生成结果）

```
Lyrics_Master   ← 总控制空对象（startTime=0）：拖动整体移动
Lyrics_Ctrl     ← 滚动控制器空对象（startTime=0）：关键帧驱动滚动节奏
歌词_1 ~ 歌词_N ← 每句歌词：锚点居中，位置/缩放/透明度三表达式
```

### 表达式方案

每句歌词挂三个表达式，全部英文（引用 `Lyrics_Master` / `Lyrics_Ctrl`）：

```js
// 位置：中心 + 总控制偏移量（当前值-初始值）
offsetY = -280;                      // 每句等差
m = thisComp.layer("Lyrics_Master").transform.position;
c = thisComp.layer("Lyrics_Ctrl").transform.position;
[960 + (m[0] - 960), c[1] + offsetY + (m[1] - 540)]

// 缩放：距"总控制 Y"越近越大；范围固定值 + ease 缓动
d = Math.abs(transform.position[1] - m[1]);
dd = Math.min(d, 270);
ease(dd, 0, 270, 200, 100)

// 透明度：同上
ease(dd, 0, 270, 100, 60)
```

要点：
- **中心判定跟随总控制**（`m[1]`），整体拖动时高亮位置同步移动
- **渐变范围固定**（`max(合成高度×25%, 间距×1.5)`），与句数无关
- 关键帧：每句 2 个（到达中心 + 停留结束），时间从 0 帧开始

### 预设持久化（双层）

| 层 | 位置 | 优先级 |
|---|---|---|
| 工程目录 JSON | `.aep` 同目录 `滚动歌词预设.json` | 高（跟工程走） |
| app.settings | AE 用户设置（section `Rolling_Lyrics`） | 低（全局保底） |

读取：工程 JSON → app.settings；保存：双写。预设短键：`v/max/nor/gap/mop/nop/sf/pf/fit`，缺失字段回退默认。

### 测试

`test_rolling_lyrics.js` 用 Node mock AE 对象（layer/comp/property），`typeof module !== "undefined"` 导出核心逻辑直接 `require('./rolling-lyrics.jsx')` 测试。

## 三、关键问题与方案

### 问题：表达式写中文图层名，跨语言失效（v2.0）

**TL;DR**：表达式里写 `thisComp.layer("滚动控制器")` 在非中文版 AE 失效；控制器统一英文命名。

- 根因：表达式跨语言执行，中文 UI 名不是表达式可用标识符
- 解决：控制器命名 `Lyrics_Ctrl`、总控制 `Lyrics_Master`，表达式全英文，UI 中文
- 预防：生成代码时脚本侧中文做 UI、表达式侧一律英文

### 问题：ExtendScript 无内置 JSON，预设存储报错（v3.0）

**TL;DR**：`JSON.stringify` 直接 ReferenceError；注入 polyfill 后再做持久化。

- 根因：ExtendScript（ES3）没有 JSON 对象
- 解决：脚本顶部注入 stringify/parse polyfill（parse 用 eval 实现）
- 预防：任何文件/设置持久化前先注入

### 问题：歌词句数多时看不出放大缩小（v3.1）

**TL;DR**：渐变范围用了"总跨度一半"，句数多时单句占比被摊薄；改固定范围 + ease。

- 根因：`maxDist = (句数-1)/2 × 间距`，20 句时 1330px，相邻句只占 10%，缩放差异 <10% 不可见
- 解决：渐变范围固定 `max(合成高度×25%, 间距×1.5)`，linear 改 ease
- 预防：距离渐变一律用固定范围，不随元素数量缩放

### 问题：空对象默认落在时间轴 0 秒 / 或跟随播放指针，反复调整（v3.2）

**TL;DR**：用户明确要求两个空对象与动画从合成最开头（0 秒）生成，不跟随播放指针。

- 根因：v2.0 按知识库"播放头对齐"惯例加了 `startTime = comp.time`，与用户预期不符
- 解决：移除 baseTime 偏移，startTime 用默认 0，关键帧从 0 帧开始
- 预防：以用户明确要求为准（本项目不采用播放头对齐惯例）

### 问题：参数藏在弹窗里，面板上看不到"控制菜单"（v2.1）

**TL;DR**：参数控件全部铺在面板窗口内，不用参数弹窗。

- 根因：v1.0 参数在点击后弹出的 dialog，用户觉得"控制菜单没显示"
- 解决：7 项参数 + 开关直接内嵌面板，点生成直接用面板参数
- 预防：面板型脚本参数一律内嵌
