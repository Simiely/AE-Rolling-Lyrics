# AGENTS.md · 项目规则

> 📌 **文档基线**：2026-08-14（commit `95c8cf5`）完成 v3.3~v3.7 修复/重构/功能 + 四件套同步
> **更新文档/代码后，请更新此行**（日期 + 新 commit hash），并在 CHANGELOG 追加版本

## 技术栈
- AE 2026 中文版（内部版本 26.0）+ ExtendScript（ES3 语法）
- 语法红线：不能用 `const`/`let`、模板字符串、箭头函数、`class`；**无内置 JSON 对象**（需 polyfill，脚本内已注入）

## 关键坑（改代码前必读）
- **图层名必须英文**：控制器/总控制命名必须英文（`Lyrics_Ctrl` / `Lyrics_Master`），表达式里引用**图层名**用英文，否则非中文版 AE 失效
- **效果名可用中文**（v3.7 起）：`Lyrics_Ctrl` 上 9 个参数控件用中文名（最大字号/间距/…），表达式引用 `effect("中文名")(1)`——中文版 AE 正常（同 starry-sky-generator）；代价是非中文版 AE 失效，勿再改回英文名
- **效果容器 API（大坑）**：给图层挂效果必须 `layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control")`——**`layer.effects` 在 AE 2026 真机取不到，会报 "undefined 不是对象"**；添加效果与取滑块参数都走 `addPropertySafe`/`getPropertySafe` 候选 fallback（matchName / 中文 / 英文），参考 starry-sky-generator 与 knowledge-base「AE2026中文版matchName兼容」
- **JSON polyfill**：ExtendScript 无内置 JSON，脚本顶部已注入 stringify/parse 兜底，不要移除
- **渐变范围用固定公式**：表达式内 `maxDist = max(合成高度×25%, 间距×1.5)`（随 间距 控件动态算），不能用总跨度一半——歌词句数多时放大效果会被摊薄到看不出
- **文件编码 UTF-8 BOM**：.jsx 中文 UI 必须 UTF-8 BOM，否则乱码；部署用 `deploy_ae_script.py`（自动加 BOM + 校验）
- **空对象从合成开头生成**：两个空对象一律显式 `startTime = 0`（AE 新建图层默认跟随播放头），不跟随播放指针（用户明确要求）
- **滚动无关键帧**：`Lyrics_Ctrl` 位置是表达式驱动（v3.6 起），节奏由 滚动帧数/停顿帧数/间距/停顿随机/抖动帧数 控件控制；测试 1/21/22 断言无关键帧
- **停顿随机用 seedRandom**：每句停顿 = 停顿帧数 ± 抖动帧数，用 `seedRandom(idx+11000, true)` 确定性随机（每句固定不闪烁），不同属性换 offset（见 knowledge-base「AE表达式seedRandom种子管理」）

## 约定
- UI 标签用中文；注释用中文；单文件交付（rolling-lyrics.jsx）
- 生成图层统一前缀命名（`歌词_` / `Lyrics_`），清理倒序遍历
- 面板参数直接铺在窗口内（不用参数弹窗，v2.1 起）
- 预设存储：双层持久化（工程目录 JSON 优先 + app.settings 保底），槽位 1-4

## 常用命令
```bash
# 语法检查（ES3）
cp rolling-lyrics.jsx _check.js && node --check _check.js && rm _check.js

# 单元测试（Node mock AE 环境，22 组）
node test_rolling_lyrics.js

# 部署到 AE 26.0 ScriptUI Panels（UTF-8 BOM + 字节校验）
python "C:\Users\2504\.workbuddy\skills\ae-script-deploy\scripts\deploy_ae_script.py" --src rolling-lyrics.jsx --version 26.0
```

## 详细规则（按需 @引用）
- @knowledge-base（Simiely/knowledge-base 用户库）：`ES3语法限制速查`、`AE表达式跨语言兼容`、`AE动画时间基准与图层清理`、`ScriptUI布局两坑`、`ScriptUI可见性与控件状态陷阱`、`AE2026中文版matchName兼容`、`AE表达式seedRandom种子管理`
