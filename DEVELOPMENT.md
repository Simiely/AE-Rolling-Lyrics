# DEVELOPMENT.md · 开发文档

## 一、项目概览

AE 滚动歌词生成器：多行歌词 → 逐句图层 + 滚动动画 + 中心高亮。核心思路是「一个滚动控制器 + 一个总控制 + N 个表达式图层」，全部由脚本生成，参数可存预设。

## 二、架构说明

### 图层结构（生成结果）

```
Lyrics_Master   ← 总控制空对象（startTime=0）：拖动整体移动
Lyrics_Ctrl     ← 滚动控制器空对象（startTime=0）：位置表达式驱动滚动节奏，挂 9 个参数控件
歌词_1 ~ 歌词_N ← 每句歌词：锚点居中，位置/缩放/透明度三表达式（引用参数控件）
```

### 表达式方案（v3.6 起：参数控件化；v3.7：中文控件名 + 停顿随机）

9 个参数（7 滑块 + 1 开关 + 1 抖动）以效果控件挂在 `Lyrics_Ctrl` 上，**效果名中文**，表达式引用 `effect("中文名")(1)`——生成后 AE 内改控件即实时生效，脚本不再参与。

```js
// Lyrics_Ctrl.transform.position —— 滚动动画（表达式驱动，无关键帧）
// v3.7：每句停顿可随机（停顿帧数 ± 抖动帧数），周期不等 → 用累积开始时间数组
// times[i] = 第 i 句开始时刻；while 定位当前句；seedRandom 确定性随机（每句固定不闪烁）
f = 1/thisComp.frameDuration;
sc = effect("滚动帧数")(1);
pc = effect("停顿帧数")(1);
jitOn = effect("停顿随机")(1);   // 0/1 开关
jit = effect("抖动帧数")(1);
g = effect("间距")(1);
n = 5; half = (n - 1)/2;
times = [0]; t = 0;
for (i = 0; i < n - 1; i++) {
  seedRandom(i + 11000, true);
  jp = pc + (jitOn > 0.5 ? jit * (random() * 2 - 1) : 0);   // 每句实际停顿
  t += (sc + jp)/f;
  times.push(t);
}
idx = 0;
while (idx < n - 1 && time >= times[idx + 1]) { idx++; }
seedRandom(idx + 11000, true);                               // 同一种子流 → 同句同值
jp = pc + (jitOn > 0.5 ? jit * (random() * 2 - 1) : 0);
lt = time - times[idx];
y0 = thisComp.height/2 - (idx - half)*g;
y1 = thisComp.height/2 - (Math.min(idx + 1, n - 1) - half)*g;
if (lt <= jp/f) { [thisComp.width/2, y0]; }
else { [thisComp.width/2, linear(lt, jp/f, jp/f + sc/f, y0, y1)]; }

// 歌词位置（每句）：中心 + 总控制偏移 + 该句偏移（间距由 间距 控件驱动）
offsetY = (0 - 2) * c.effect("间距")(1);   // (i - centerIdx) * 间距
m = thisComp.layer("Lyrics_Master").transform.position;
c = thisComp.layer("Lyrics_Ctrl");
[960 + (m[0] - 960), c.transform.position[1] + offsetY + (m[1] - 540)]

// 缩放：距"总控制 Y"越近越大；渐变范围表达式内动态算（间距 控件驱动）
maxS = c.effect("最大字号")(1);
norS = c.effect("普通字号")(1);
maxDist = Math.max(thisComp.height * 0.25, g * 1.5);
ratio = Math.min(maxS / norS, 2.0000);   // 上限 cap 生成时烘焙（超长句防溢出，短句为 maxS/norS）
d = Math.abs(transform.position[1] - m[1]);
dd = Math.min(d, maxDist);
ease(dd, 0, maxDist, ratio * 100, 100)

// 透明度：同上，引用 最大透明度 / 普通透明度 控件
ease(dd, 0, maxDist, maxO, norO)
```

要点：
- **中心判定跟随总控制**（`m[1]`），整体拖动时高亮位置同步移动
- **渐变范围固定公式**（`max(合成高度×25%, 间距×1.5)`），由表达式运行时计算，随 间距 控件联动
- **滚动无关键帧**：`Lyrics_Ctrl` 位置是表达式，节奏完全由控件驱动（含随机停顿）
- **超长句防溢出**：生成时测量的放大上限 `cap` 烘焙进缩放表达式（`ratio = min(maxS/norS, cap)`），AE 内调大字号也不会超出画布
- **效果名中文**：控件显示中文 + 表达式 `effect("中文名")(1)` 引用（中文版 AE 可用；非中文版失效是已知 trade-off）
- **随机停顿**：`seedRandom(idx+11000, true)` 确定性随机——每句停顿固定、不闪烁；不同属性随机需换 offset（见 knowledge-base「AE表达式seedRandom种子管理」）

### 预设持久化（双层）

| 层 | 位置 | 优先级 |
|---|---|---|
| 工程目录 JSON | `.aep` 同目录 `滚动歌词预设.json` | 高（跟工程走） |
| app.settings | AE 用户设置（section `Rolling_Lyrics`） | 低（全局保底） |

读取：工程 JSON → app.settings；保存：双写。预设短键：`v/max/nor/gap/mop/nop/sf/pf/pr/jit/fit`（v2 新增 pr/jit），缺失字段回退默认。

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

### 问题：layer.effects 取不到，挂效果报 undefined（v3.6.1）

**TL;DR**：给空对象挂 Slider Control 用 `layer.effects.addProperty(...)` 在 AE 2026 真机报 "undefined 不是对象"；必须用 `layer.property("ADBE Effect Parade")`。

- 根因：ExtendScript 里效果容器不是 `layer.effects`（Mock 测试里自造了该属性，掩盖了真机问题——mock 必须忠于真实 API）
- 解决：效果容器 `layer.property("ADBE Effect Parade")`；添加效果与取滑块参数都走候选 fallback（matchName / 中文 / 英文）
- 预防：AE 属性访问统一用 `addPropertySafe`/`getPropertySafe`；参考 starry-sky-generator 与 knowledge-base「AE2026中文版matchName兼容」
