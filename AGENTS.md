# AGENTS.md · 项目规则

> 📌 **文档基线**：2026-08-14（commit `59b3a70`）完成四件套重写
> **更新文档/代码后，请更新此行**（日期 + 新 commit hash），并在 CHANGELOG 追加版本

## 技术栈
- AE 2026 中文版（内部版本 26.0）+ ExtendScript（ES3 语法）
- 语法红线：不能用 `const`/`let`、模板字符串、箭头函数、`class`；**无内置 JSON 对象**（需 polyfill，脚本内已注入）

## 关键坑（改代码前必读）
- **表达式里禁止中文名**：控制器/总控制命名必须英文（`Lyrics_Ctrl` / `Lyrics_Master`），表达式全英文，否则非中文版 AE 失效
- **JSON polyfill**：ExtendScript 无内置 JSON，脚本顶部已注入 stringify/parse 兜底，不要移除
- **渐变范围用固定值**：`maxDist = max(合成高度×25%, 间距×1.5)`，不能用总跨度一半——歌词句数多时放大效果会被摊薄到看不出
- **文件编码 UTF-8 BOM**：.jsx 中文 UI 必须 UTF-8 BOM，否则乱码；部署用 `deploy_ae_script.py`（自动加 BOM + 校验）
- **空对象从合成开头生成**：两个空对象与关键帧一律从 0 帧开始，不跟随播放指针（用户明确要求）

## 约定
- UI 标签用中文；注释用中文；单文件交付（rolling-lyrics.jsx）
- 生成图层统一前缀命名（`歌词_` / `Lyrics_`），清理倒序遍历
- 面板参数直接铺在窗口内（不用参数弹窗，v2.1 起）
- 预设存储：双层持久化（工程目录 JSON 优先 + app.settings 保底），槽位 1-4

## 常用命令
```bash
# 语法检查（ES3）
cp rolling-lyrics.jsx _check.js && node --check _check.js && rm _check.js

# 单元测试（Node mock AE 环境，17 组）
node test_rolling_lyrics.js

# 部署到 AE 26.0 ScriptUI Panels（UTF-8 BOM + 字节校验）
python "C:\Users\2504\.workbuddy\skills\ae-script-deploy\scripts\deploy_ae_script.py" --src rolling-lyrics.jsx --version 26.0
```

## 详细规则（按需 @引用）
- @knowledge-base（Simiely/knowledge-base 用户库）：`ES3语法限制速查`、`AE表达式跨语言兼容`、`AE动画时间基准与图层清理`、`ScriptUI布局两坑`、`ScriptUI可见性与控件状态陷阱`
