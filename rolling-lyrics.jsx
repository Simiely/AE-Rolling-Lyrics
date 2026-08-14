/*!
 * 滚动歌词生成器 (Rolling Lyrics Generator) v3.7
 * ---------------------------------------------------------------
 * 用法：
 *   1. 打开本面板，在"歌词"输入框直接粘贴整段歌词（每句一行，回车分隔）
 *      —— 也可以不填，改用在合成中选中的文本图层
 *   2. 调整参数（文本框填数字），点击"生成滚动歌词"
 *   3. 生成后选中 Lyrics_Ctrl 空对象，在效果控件里直接改参数，全部实时生效：
 *      最大字号 / 普通字号 / 间距 / 最大透明度 / 普通透明度 /
 *      滚动帧数 / 停顿帧数 / 停顿随机(开关) / 抖动帧数
 *   4. 参数可存为预设（面板"预设管理"区），下次一键载入
 *
 * 效果：
 *   - 自动按行拆分歌词，每句一个图层，垂直等间距排列
 *   - Lyrics_Ctrl 空对象驱动整体滚动（位置表达式，节奏由控件控制）
 *   - 滚动到画面中心的一句：放大到"最大字号"、按"最大透明度"显示
 *   - 未到中心的歌词：保持"普通字号"、按"普通透明度"显示
 *   - 歌词数量自适应，间距始终相同
 *
 * v3.7 变更：
 *   - 控件名改中文显示（最大字号/间距/…），表达式同步引用中文名（中文版 AE 可用）
 *   - 新增"停顿随机"开关 + "抖动帧数"：开启后每句实际停顿 = 停顿帧数 ± 抖动帧数
 *     （seedRandom 确定性随机，每句固定不闪烁，改控件实时生效）
 * v3.6.1 变更（修复）：
 *   - 效果容器改用 layer.property("ADBE Effect Parade")（layer.effects 真机取不到）
 *   - 添加效果/取参数用候选 fallback（matchName/中文/英文），兼容 AE 2026 中文版
 * v3.6 变更（参数控件化，AE 内直接调）：
 *   - 7 个参数改为 Slider Control 效果挂在 Lyrics_Ctrl 上，表达式全部引用控件
 *     （effect(name)(1)），生成后选中空对象即可在效果控件面板实时调整
 *   - 滚动动画由 Lyrics_Ctrl 位置表达式驱动（原为关键帧），节奏随控件实时变化
 *   - 移除滑块方案与 updateLyrics（面板参数即生成参数，改参在 AE 控件上做）
 * v3.5 变更（已撤销）：参数滑块 UI 与脚本侧实时更新（用户要求撤销）
 * v3.4 变更（结构重构，行为不变）：
 *   - buildLyrics 拆分为 6 个职责单一的函数（parseLyrics / computeOffsets /
 *     computeMaxDist / measureFit / createLyricLayer / buildController /
 *     attachExpressions），主线变成"编排"
 *   - SCRIPTS 命名空间按层分组：util（工具）/ preset（预设）/ core（核心）/
 *     ui（界面与主流程），找代码不再靠名字猜
 *   - 面板 UI 构建抽为 SCRIPTS.ui.buildUI()
 *   - 表达式生成改数组 join（原 41 处字符串 + 拼接）
 * v3.3 变更（Bug 修复）：
 *   - 显式 startTime = 0（AE 新建图层默认跟随播放头，v3.2 仅删除旧设置而未真正归零）
 *   - 合成时长只延长不截断（已有更长的背景内容时保持原时长）
 *   - 修正结尾时长：最后一句停留结束后再多停 1 秒（原逻辑多出 scrollFrames 静止）
 *   - 超长句自动缩窄改用真实文本测量（sourceRectAtTime），不再用估算公式
 *   - 清理旧图层精确匹配 Lyrics_Ctrl / Lyrics_Master，不再误删用户自定义 Lyrics_* 图层
 * v3.2 变更：两个空对象与滚动动画一律从合成最开头（0 秒）生成，不跟随播放指针。
 * v3.1 变更：渐变范围改固定值（合成高度 25%），歌词再多放大缩小也清晰；linear 改 ease。
 * v3.0 变更（预设存储，参考 AE-Lyrics-Animator）：
 *   - JSON polyfill（ExtendScript 无内置 JSON）
 *   - 双层持久化：工程目录 JSON（跟工程走）+ app.settings 全局保底
 *   - 面板新增"预设管理"：存储 [1-4] / 使用 [1-4] / 清除全部 / 复位
 *
 * v2.4 变更：整体移动时放大/透明度中心跟随 Lyrics_Master。
 * v2.3 变更：新增总控制 Lyrics_Master 整体移动。
 * v2.2 变更：面板歌词输入框；v2.1：参数内嵌面板；v2.0：对齐 knowledge-base。
 * ---------------------------------------------------------------
 */

(function (thisObj) {
    var SCRIPTS = {};
    var PANEL_MODE = (typeof Panel !== "undefined") && (thisObj instanceof Panel);
    var UI = null; // 面板控件引用

    var CTRL_NAME = "Lyrics_Ctrl";     // 滚动控制器名（表达式引用，必须英文）
    var MASTER_NAME = "Lyrics_Master"; // 总控制名（整体移动歌词）
    var LYRIC_PREFIX = "歌词_";        // 歌词图层前缀

    var DEFAULTS = {
        maxSize: 120, normalSize: 60, gap: 140,
        maxOpacity: 100, normalOpacity: 60,
        scrollFrames: 30, pauseFrames: 20,
        pauseRandom: false, jitterFrames: 10,
        fitLong: true
    };

    // ---- 预设常量（对齐 AE-Lyrics-Animator 双层持久化方案） ----
    var PRESET_COUNT = 4;
    var PRESET_VERSION = 2; // v2：新增 pauseRandom / jitterFrames 短键（pr / jit）
    var SETTINGS_SECTION = "Rolling_Lyrics";
    var SETTINGS_KEY_PREFIX = "preset_";
    var PRESET_FILENAME = "滚动歌词预设.json";
    var presetsCache = {}; // { "1": {短键参数}, ... }

    /* ---------------- JSON polyfill（ExtendScript 无内置 JSON） ---------------- */

    if (typeof JSON === "undefined") { JSON = {}; }
    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (obj) {
            var t = typeof obj;
            if (t === "undefined") { return undefined; }
            if (t === "function" || obj === null) { return "null"; }
            if (t === "boolean" || t === "number") { return String(obj); }
            if (t === "string") {
                return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
                    .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
            }
            if (obj instanceof Array) {
                var arr = [];
                for (var i = 0; i < obj.length; i++) { arr.push(JSON.stringify(obj[i])); }
                return "[" + arr.join(",") + "]";
            }
            if (t === "object") {
                var pairs = [];
                for (var k in obj) {
                    if (obj.hasOwnProperty(k)) {
                        var v = JSON.stringify(obj[k]);
                        if (v !== undefined) { pairs.push('"' + k + '":' + v); }
                    }
                }
                return "{" + pairs.join(",") + "}";
            }
            return "null";
        };
    }
    if (typeof JSON.parse !== "function") {
        JSON.parse = function (text) {
            if (typeof text !== "string" || text.length === 0) { return null; }
            return eval("(" + text + ")");
        };
    }

    /* ================= util 层：通用工具（无副作用） ================= */

    SCRIPTS.util = {};

    // 估算文本宽度（汉字≈1倍字号，西文≈0.55倍），用于超长句自动缩字号的兜底估算
    SCRIPTS.util.estTextWidth = function (str, fontSize) {
        var w = 0, i, code;
        for (i = 0; i < str.length; i++) {
            code = str.charCodeAt(i);
            if (code > 0x2E7F) { w += 1.0; }
            else if (code > 0x20 && code < 0x7F) { w += 0.55; }
            else { w += 0.3; }
        }
        return w * fontSize;
    };

    // 解析数值（非法/<=0 时回退默认）
    SCRIPTS.util.numVal = function (v, fallback) {
        var n = parseFloat(v);
        return (isNaN(n) || n <= 0) ? fallback : n;
    };

    // 安全添加属性：候选 matchName 逐个尝试（AE 2026 中文版 matchName 兼容，见 knowledge-base）
    // 参考 starry-sky-generator 的 addPropertySafe
    SCRIPTS.util.addPropertySafe = function (parent, candidates) {
        for (var c = 0; c < candidates.length; c++) {
            try {
                var prop = parent.addProperty(candidates[c]);
                if (prop) { return prop; }
            } catch (e) {}
        }
        return null;
    };

    // 安全获取子属性：候选名逐个尝试（matchName / 中文显示名 / 英文显示名）
    SCRIPTS.util.getPropertySafe = function (parent, candidates) {
        for (var c = 0; c < candidates.length; c++) {
            try {
                var prop = parent.property(candidates[c]);
                if (prop) { return prop; }
            } catch (e) {}
        }
        return null;
    };

    // 清除属性上的表达式和全部关键帧
    SCRIPTS.util.clearProp = function (prop) {
        prop.expression = "";
        while (prop.numKeys > 0) { prop.removeKeyframe(1); }
    };

    // 清理旧生成图层（统一前缀命名 + 倒序遍历，避免索引前移跳删）
    // 注意：Lyrics_ 前缀收窄为精确匹配两个控制器名，避免误删用户自定义的 Lyrics_* 图层
    SCRIPTS.util.removeGenerated = function (comp, keepLayer) {
        var i, L;
        for (i = comp.numLayers; i >= 1; i--) {
            L = comp.layer(i);
            if (L === keepLayer) { continue; }
            if (L.name.indexOf(LYRIC_PREFIX) === 0 || L.name === CTRL_NAME || L.name === MASTER_NAME) {
                L.remove();
            }
        }
    };

    /* ================= preset 层：预设（参数映射 + 双层持久化） ================= */

    SCRIPTS.preset = {};

    // 从 UI 控件读取参数（生成与保存共用同一来源）
    SCRIPTS.preset.collectParams = function (ui) {
        return {
            maxSize: SCRIPTS.util.numVal(ui.eMax.text, DEFAULTS.maxSize),
            normalSize: SCRIPTS.util.numVal(ui.eNormal.text, DEFAULTS.normalSize),
            gap: SCRIPTS.util.numVal(ui.eGap.text, DEFAULTS.gap),
            maxOpacity: Math.min(100, SCRIPTS.util.numVal(ui.eMaxOp.text, DEFAULTS.maxOpacity)),
            normalOpacity: Math.min(100, SCRIPTS.util.numVal(ui.eNormalOp.text, DEFAULTS.normalOpacity)),
            scrollFrames: SCRIPTS.util.numVal(ui.eScroll.text, DEFAULTS.scrollFrames),
            pauseFrames: SCRIPTS.util.numVal(ui.ePause.text, DEFAULTS.pauseFrames),
            pauseRandom: (ui.pauseRandomChk) ? !!ui.pauseRandomChk.value : DEFAULTS.pauseRandom,
            jitterFrames: (ui.eJitter) ? SCRIPTS.util.numVal(ui.eJitter.text, DEFAULTS.jitterFrames) : DEFAULTS.jitterFrames,
            fitLong: ui.fitChk.value
        };
    };

    // 参数 → 预设（短键压缩）
    SCRIPTS.preset.toPreset = function (params) {
        return {
            v: PRESET_VERSION,
            max: params.maxSize, nor: params.normalSize, gap: params.gap,
            mop: params.maxOpacity, nop: params.normalOpacity,
            sf: params.scrollFrames, pf: params.pauseFrames,
            pr: params.pauseRandom ? 1 : 0, jit: params.jitterFrames,
            fit: params.fitLong
        };
    };

    // 预设 → 参数（缺失字段回退默认，兼容旧预设）
    SCRIPTS.preset.fromPreset = function (p) {
        if (!p) { return { maxSize: DEFAULTS.maxSize, normalSize: DEFAULTS.normalSize, gap: DEFAULTS.gap, maxOpacity: DEFAULTS.maxOpacity, normalOpacity: DEFAULTS.normalOpacity, scrollFrames: DEFAULTS.scrollFrames, pauseFrames: DEFAULTS.pauseFrames, pauseRandom: DEFAULTS.pauseRandom, jitterFrames: DEFAULTS.jitterFrames, fitLong: DEFAULTS.fitLong }; }
        return {
            maxSize: SCRIPTS.util.numVal(p.max, DEFAULTS.maxSize),
            normalSize: SCRIPTS.util.numVal(p.nor, DEFAULTS.normalSize),
            gap: SCRIPTS.util.numVal(p.gap, DEFAULTS.gap),
            maxOpacity: Math.min(100, SCRIPTS.util.numVal(p.mop, DEFAULTS.maxOpacity)),
            normalOpacity: Math.min(100, SCRIPTS.util.numVal(p.nop, DEFAULTS.normalOpacity)),
            scrollFrames: SCRIPTS.util.numVal(p.sf, DEFAULTS.scrollFrames),
            pauseFrames: SCRIPTS.util.numVal(p.pf, DEFAULTS.pauseFrames),
            pauseRandom: (p.pr !== undefined) ? !!p.pr : DEFAULTS.pauseRandom,
            jitterFrames: SCRIPTS.util.numVal(p.jit, DEFAULTS.jitterFrames),
            fitLong: (p.fit !== undefined) ? !!p.fit : DEFAULTS.fitLong
        };
    };

    // 把预设参数写回 UI 控件
    SCRIPTS.preset.applyParams = function (ui, p) {
        var params = SCRIPTS.preset.fromPreset(p);
        ui.eMax.text = String(params.maxSize);
        ui.eNormal.text = String(params.normalSize);
        ui.eGap.text = String(params.gap);
        ui.eMaxOp.text = String(params.maxOpacity);
        ui.eNormalOp.text = String(params.normalOpacity);
        ui.eScroll.text = String(params.scrollFrames);
        ui.ePause.text = String(params.pauseFrames);
        if (ui.pauseRandomChk) { ui.pauseRandomChk.value = params.pauseRandom; }
        if (ui.eJitter) { ui.eJitter.text = String(params.jitterFrames); }
        ui.fitChk.value = params.fitLong;
    };

    // 工程目录预设 JSON 文件路径（跟工程走）
    SCRIPTS.preset.getProjectPresetFile = function () {
        try {
            var projFile = app.project.file;
            if (!projFile) { return null; }
            var projFolder = projFile.parent;
            if (!projFolder) { return null; }
            return new File(projFolder.fsName + "/" + PRESET_FILENAME);
        } catch (e) { return null; }
    };

    // 从工程目录 JSON 读取全部预设
    SCRIPTS.preset.readFromProjectFile = function () {
        try {
            var f = SCRIPTS.preset.getProjectPresetFile();
            if (!f || !f.exists) { return null; }
            f.open("r");
            var text = f.read();
            f.close();
            if (!text || text.length === 0) { return null; }
            var parsed = JSON.parse(text);
            if (parsed && typeof parsed === "object") { return parsed; }
        } catch (e) {}
        return null;
    };

    // 写入预设到工程目录 JSON（成功返回 true）
    SCRIPTS.preset.writeToProjectFile = function (data) {
        try {
            var f = SCRIPTS.preset.getProjectPresetFile();
            if (!f) { return false; }
            var content = JSON.stringify(data);
            if (!content || content.length === 0) { return false; }
            var opened = f.open("w");
            if (!opened) { return false; }
            var wrote = f.write(content);
            f.close();
            if (!wrote) { return false; }
            f.open("r");
            var verify = f.read();
            f.close();
            return (verify && verify.length > 0);
        } catch (e) { return false; }
    };

    // 删除工程目录预设 JSON
    SCRIPTS.preset.deleteProjectFile = function () {
        try {
            var f = SCRIPTS.preset.getProjectPresetFile();
            if (f && f.exists) { f.remove(); }
        } catch (e) {}
    };

    // 从 app.settings 读取单个预设（全局保底）
    SCRIPTS.preset.readFromSettings = function (idx) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx)) {
                var text = app.settings.getSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx);
                if (text && text.length > 0) { return JSON.parse(text); }
            }
        } catch (e) {}
        return null;
    };

    // 写入单个预设到 app.settings
    SCRIPTS.preset.writeToSettings = function (idx, params) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx, JSON.stringify(params));
            return true;
        } catch (e) { return false; }
    };

    // 删除 app.settings 中单个预设
    SCRIPTS.preset.deleteFromSettings = function (idx) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx)) {
                app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx, "");
            }
        } catch (e) {}
    };

    // 初始化：优先工程目录 JSON，回退 app.settings
    SCRIPTS.preset.initPresets = function () {
        var fromFile = SCRIPTS.preset.readFromProjectFile();
        if (fromFile) { return fromFile; }
        var cache = {};
        for (var i = 1; i <= PRESET_COUNT; i++) {
            var p = SCRIPTS.preset.readFromSettings(i);
            if (p) { cache[String(i)] = p; }
        }
        return cache;
    };

    /* ================= core 层：生成核心（可测试） ================= */

    SCRIPTS.core = {};

    // 解析歌词文本 → 非空行数组（去掉首尾空白）
    SCRIPTS.core.parseLyrics = function (text) {
        var lines = String(text || "").split(/\r?\n/);
        var out = [], i, t;
        for (i = 0; i < lines.length; i++) {
            t = lines[i].replace(/^\s+|\s+$/g, "");
            if (t.length > 0) { out.push(t); }
        }
        return out;
    };

    // 每句相对画面中心的等差偏移（间距相同，关于中心对称）
    SCRIPTS.core.computeOffsets = function (n, gap) {
        var centerIdx = (n - 1) / 2;
        var offsets = [], i;
        for (i = 0; i < n; i++) { offsets.push((i - centerIdx) * gap); }
        return offsets;
    };

    // 缩放/透明度渐变范围：固定值（合成高度 25%，至少覆盖相邻一句的 1.5 倍）
    // 不能用"总跨度一半"——歌词句数多时范围过大，相邻句的缩放差异被摊薄到看不出
    SCRIPTS.core.computeMaxDist = function (comp, gap) {
        return Math.max(Math.round(comp.height * 0.25), Math.round(gap * 1.5));
    };

    // 超长句自动缩窄：真实文本测量（measureFn 注入，便于 Node 测试）
    // measureFn(text, size) 负责"设置文本字号 + 返回实测宽度"；最多缩 2 轮，下限 12
    // 返回 { base: 普通字号, ratio: 中心放大比, cap: 放大比上限（null=不限制） }
    SCRIPTS.core.measureFit = function (text, normalSize, maxSize, maxW, fitLong, measureFn) {
        var base = normalSize;
        var ratio = maxSize / normalSize;
        var cap = null;
        if (fitLong) {
            var w = measureFn(text, normalSize);
            var pass;
            for (pass = 0; pass < 2; pass++) {
                if (w <= maxW) { break; }
                base = Math.max(12, normalSize * maxW / w);
                w = measureFn(text, base);
            }
            // 中心放大后不得超出画布：放大后宽度 ≈ 实测宽度 × ratio
            if (base < normalSize && w > 0) { ratio = Math.max(1, maxW / w); cap = ratio; }
        }
        return { base: base, ratio: ratio, cap: cap };
    };

    // 创建单个歌词图层（复用/复制源图层，或新建并归零 startTime）
    SCRIPTS.core.createLyricLayer = function (comp, srcLayer, index) {
        var L;
        if (srcLayer) {
            if (index === 0) { L = srcLayer; } else { L = srcLayer.duplicate(); }
        } else {
            L = comp.layers.addText();
            L.startTime = 0;
        }
        L.name = LYRIC_PREFIX + (index + 1);
        return L;
    };

    // 给空对象挂一个 Slider Control 效果并赋初值（表达式用 effect(name)(1) 引用）
    // 关键（参考 starry-sky-generator / knowledge-base）：
    //   - 效果容器必须 layer.property("ADBE Effect Parade")，layer.effects 在 AE 2026 取不到
    //   - 添加效果与取滑块参数都用候选 fallback（matchName / 中文 / 英文），中文版 AE 兼容
    SCRIPTS.core.addSliderControl = function (layer, name, value) {
        var fxGroup = SCRIPTS.util.getPropertySafe(layer, ["ADBE Effect Parade", "Effects"]);
        if (!fxGroup) { throw new Error("无法获取效果容器（ADBE Effect Parade）"); }
        var fx = SCRIPTS.util.addPropertySafe(fxGroup, ["ADBE Slider Control", "ADBE Slider Control-0001", "滑块控制"]);
        if (!fx) { throw new Error("无法添加 Slider Control 效果: " + name); }
        fx.name = name;
        var sp = SCRIPTS.util.getPropertySafe(fx, ["ADBE Slider Control-0001", "滑块", "Slider"]);
        if (sp) { sp.setValue(value); }
        return fx;
    };

    // 给空对象挂一个 Checkbox Control 效果（开关用，表达式用 effect(name)(1) 读 0/1）
    SCRIPTS.core.addCheckboxControl = function (layer, name, value) {
        var fxGroup = SCRIPTS.util.getPropertySafe(layer, ["ADBE Effect Parade", "Effects"]);
        if (!fxGroup) { throw new Error("无法获取效果容器（ADBE Effect Parade）"); }
        var fx = SCRIPTS.util.addPropertySafe(fxGroup, ["ADBE Checkbox Control", "ADBE Checkbox Control-0001", "复选框控制"]);
        if (!fx) { throw new Error("无法添加 Checkbox Control 效果: " + name); }
        fx.name = name;
        var sp = SCRIPTS.util.getPropertySafe(fx, ["ADBE Checkbox Control-0001", "复选框", "Checkbox"]);
        if (sp) { sp.setValue(value ? 1 : 0); }
        return fx;
    };

    // 创建滚动控制器 + 总控制（空对象）。
    // 7 个参数以 Slider Control 效果挂在 Lyrics_Ctrl 上，表达式全部引用控件
    // —— 生成后直接在 AE 里改控件数值即实时生效，无需脚本参与。
    // 滚动动画由 Lyrics_Ctrl 的位置表达式驱动（n 句循环：停顿 pause 帧 → 滚动 scroll 帧）。
    SCRIPTS.core.buildController = function (comp, n, params) {
        // 从合成最开头生成：显式 startTime = 0（AE 新建图层默认跟随播放头，
        // 不显式归零则播放头不在 0 帧时前几秒无歌词）
        var ctrl = comp.layers.addNull();
        ctrl.name = CTRL_NAME;
        ctrl.startTime = 0;
        ctrl.transform.position.setValue([comp.width / 2, comp.height / 2]);

        // 总控制：拖动它可整体移动歌词（初始在画面中心，偏移量 = 当前值 - 初始值）
        var master = comp.layers.addNull();
        master.name = MASTER_NAME;
        master.startTime = 0;
        master.transform.position.setValue([comp.width / 2, comp.height / 2]);

        // 9 个参数控件（效果名中文显示；表达式用 effect("中文名")(1) 引用，中文版 AE 可用）
        SCRIPTS.core.addSliderControl(ctrl, "最大字号", params.maxSize);
        SCRIPTS.core.addSliderControl(ctrl, "普通字号", params.normalSize);
        SCRIPTS.core.addSliderControl(ctrl, "间距", params.gap);
        SCRIPTS.core.addSliderControl(ctrl, "最大透明度", params.maxOpacity);
        SCRIPTS.core.addSliderControl(ctrl, "普通透明度", params.normalOpacity);
        SCRIPTS.core.addSliderControl(ctrl, "滚动帧数", params.scrollFrames);
        SCRIPTS.core.addSliderControl(ctrl, "停顿帧数", params.pauseFrames);
        SCRIPTS.core.addCheckboxControl(ctrl, "停顿随机", params.pauseRandom);
        SCRIPTS.core.addSliderControl(ctrl, "抖动帧数", params.jitterFrames);

        // 滚动位置表达式：按 time 循环"停留+滚动"，节奏由控件驱动。
        // 停顿随机开启时，每句停顿 = 停顿帧数 ± 抖动帧数（seedRandom 确定性随机，
        // 同一种子流算出每句累积开始时间与当前句停顿，保证每句稳定不闪烁）
        var frameDur = comp.frameDuration;
        ctrl.transform.position.expression = [
            "f = 1/thisComp.frameDuration;",
            "sc = effect(\"滚动帧数\")(1);",
            "pc = effect(\"停顿帧数\")(1);",
            "jitOn = effect(\"停顿随机\")(1);",
            "jit = effect(\"抖动帧数\")(1);",
            "g = effect(\"间距\")(1);",
            "n = " + n + ";",
            "half = (n - 1)/2;",
            "times = [0];",
            "t = 0;",
            "for (i = 0; i < n - 1; i++) {",
            "  seedRandom(i + 11000, true);",
            "  jp = pc + (jitOn > 0.5 ? jit * (random() * 2 - 1) : 0);",
            "  t += (sc + jp)/f;",
            "  times.push(t);",
            "}",
            "idx = 0;",
            "while (idx < n - 1 && time >= times[idx + 1]) { idx++; }",
            "seedRandom(idx + 11000, true);",
            "jp = pc + (jitOn > 0.5 ? jit * (random() * 2 - 1) : 0);",
            "lt = time - times[idx];",
            "y0 = thisComp.height/2 - (idx - half)*g;",
            "y1 = thisComp.height/2 - (Math.min(idx + 1, n - 1) - half)*g;",
            "if (lt <= jp/f) { [thisComp.width/2, y0]; }",
            "else { [thisComp.width/2, linear(lt, jp/f, jp/f + sc/f, y0, y1)]; }"
        ].join("\n");

        // 结尾帧号（按初始参数估算合成时长；控件改大节奏后需手动延长合成）
        var endFrames = (n - 1) * (params.pauseFrames + params.scrollFrames) + params.pauseFrames + Math.round(1 / frameDur);
        return { ctrl: ctrl, master: master, endFrames: endFrames };
    };

    // 给一句歌词挂三条表达式（表达式全英文代码 + 中文效果名引用，中文版 AE 可用）
    // i / centerIdx：句索引与中心索引；cap：该句放大比上限（null=不限制）
    SCRIPTS.core.attachExpressions = function (L, i, centerIdx, centerX, centerY, cap) {
        L.transform.position.expression = [
            "c = thisComp.layer(\"" + CTRL_NAME + "\");",
            "m = thisComp.layer(\"" + MASTER_NAME + "\").transform.position;",
            "offsetY = (" + i + " - " + centerIdx + ") * c.effect(\"间距\")(1);",
            "[" + centerX + " + (m[0] - " + centerX + "), c.transform.position[1] + offsetY + (m[1] - " + centerY + ")]"
        ].join("\n");
        L.transform.scale.expression = [
            "c = thisComp.layer(\"" + CTRL_NAME + "\");",
            "m = thisComp.layer(\"" + MASTER_NAME + "\").transform.position;",
            "maxS = c.effect(\"最大字号\")(1);",
            "norS = c.effect(\"普通字号\")(1);",
            "g = c.effect(\"间距\")(1);",
            "maxDist = Math.max(thisComp.height * 0.25, g * 1.5);",
            (cap === null)
                ? "ratio = maxS / norS;"
                : "ratio = Math.min(maxS / norS, " + cap.toFixed(4) + ");",
            "d = Math.abs(transform.position[1] - m[1]);",
            "dd = Math.min(d, maxDist);",
            "s = ease(dd, 0, maxDist, ratio * 100, 100);",
            "[s, s]"
        ].join("\n");
        L.transform.opacity.expression = [
            "c = thisComp.layer(\"" + CTRL_NAME + "\");",
            "m = thisComp.layer(\"" + MASTER_NAME + "\").transform.position;",
            "maxO = c.effect(\"最大透明度\")(1);",
            "norO = c.effect(\"普通透明度\")(1);",
            "g = c.effect(\"间距\")(1);",
            "maxDist = Math.max(thisComp.height * 0.25, g * 1.5);",
            "d = Math.abs(transform.position[1] - m[1]);",
            "dd = Math.min(d, maxDist);",
            "ease(dd, 0, maxDist, maxO, norO)"
        ].join("\n");
    };

    // 主线：编排各子步骤生成整段滚动歌词
    // params: {maxSize, normalSize, gap, maxOpacity, normalOpacity,
    //          scrollFrames, pauseFrames, fitLong}
    // srcLayer 可为 null（无源样式时用默认文本样式）；lyricsText 优先于 srcLayer 文本
    SCRIPTS.core.buildLyrics = function (comp, srcLayer, params, lyricsText) {
        // 先清理旧的生成图层（防重复运行堆积）
        SCRIPTS.util.removeGenerated(comp, srcLayer);

        var fullText = lyricsText || (srcLayer ? (srcLayer.text.sourceText.value.text || "") : "");
        var lyrics = SCRIPTS.core.parseLyrics(fullText);
        var n = lyrics.length;
        if (n < 1) { throw new Error("没有找到歌词。"); }
        if (n === 1) { throw new Error("只有一句歌词，无法滚动。请把歌词写成多行（每句一行，用回车分隔）。"); }

        var maxSize = params.maxSize;
        var normalSize = params.normalSize;
        var gap = params.gap;
        var maxOpacity = Math.min(100, params.maxOpacity);
        var normalOpacity = Math.min(100, params.normalOpacity);
        var scrollFrames = Math.round(params.scrollFrames);
        var pauseFrames = Math.round(params.pauseFrames);
        var pauseRandom = !!params.pauseRandom;
        var jitterFrames = Math.max(0, Math.round(params.jitterFrames || 0));
        if (scrollFrames < 1) { scrollFrames = 1; }
        if (pauseFrames < 0) { pauseFrames = 0; }

        var offsets = SCRIPTS.core.computeOffsets(n, gap);
        var maxDist = SCRIPTS.core.computeMaxDist(comp, gap); // 初始渐变范围（表达式内会随 gap 控件动态算）
        var maxW = comp.width * 0.88;
        var bases = [], ratios = [], caps = [], layers = [];
        var centerIdx = (n - 1) / 2;
        var L, td, fit, rr, i;

        // ---- 生成歌词图层（有源图层则继承样式，否则用默认文本样式） ----
        for (i = 0; i < n; i++) {
            L = SCRIPTS.core.createLyricLayer(comp, srcLayer, i);

            // 超长句自动缩窄：真实文本测量（先设文本字号 → 实测 → 超宽再缩）
            fit = SCRIPTS.core.measureFit(lyrics[i], normalSize, maxSize, maxW, params.fitLong, function (txt, size) {
                td = L.text.sourceText.value;
                td.text = txt;
                td.fontSize = size;
                L.text.sourceText.setValue(td);
                rr = L.sourceRectAtTime(0, false);
                return (rr && rr.width) ? rr.width : 0;
            });
            bases.push(fit.base);
            ratios.push(fit.ratio);
            caps.push(fit.cap);

            // 最终写回文本与字号（fitLong 关闭时直接用普通字号）
            td = L.text.sourceText.value;
            td.text = lyrics[i];
            td.fontSize = fit.base;
            L.text.sourceText.setValue(td);

            rr = L.sourceRectAtTime(0, false);
            L.transform.anchorPoint.setValue([rr.left + rr.width / 2, rr.top + rr.height / 2]);
            SCRIPTS.util.clearProp(L.text.sourceText);
            SCRIPTS.util.clearProp(L.transform.anchorPoint);
            SCRIPTS.util.clearProp(L.transform.position);
            SCRIPTS.util.clearProp(L.transform.scale);
            SCRIPTS.util.clearProp(L.transform.opacity);
            layers.push(L);
        }

        // ---- 滚动控制器 + 总控制（参数控件挂在 Lyrics_Ctrl 上） ----
        var ctl = SCRIPTS.core.buildController(comp, n, {
            maxSize: maxSize, normalSize: normalSize, gap: gap,
            maxOpacity: maxOpacity, normalOpacity: normalOpacity,
            scrollFrames: scrollFrames, pauseFrames: pauseFrames,
            pauseRandom: pauseRandom, jitterFrames: jitterFrames
        });

        // 合成时长：只延长不截断（合成里已有更长的内容如背景音乐时保持原时长）
        var targetDur = ctl.endFrames * comp.frameDuration;
        if (targetDur > comp.duration) { comp.duration = targetDur; }

        // ---- 挂表达式（全部引用 Lyrics_Ctrl 上的参数控件） ----
        for (i = 0; i < n; i++) {
            SCRIPTS.core.attachExpressions(layers[i], i, centerIdx, comp.width / 2, comp.height / 2, caps[i]);
        }

        return {
            count: n,
            duration: comp.duration,
            layers: layers,
            controller: ctl.ctrl,
            master: ctl.master,
            offsets: offsets,
            bases: bases,
            ratios: ratios,
            caps: caps,
            maxDist: maxDist,
            endFrames: ctl.endFrames
        };
    };

    /* ================= ui 层：界面与主流程 ================= */

    SCRIPTS.ui = {};

    SCRIPTS.ui.setStatus = function (msg) {
        if (UI && UI.status) {
            UI.status.text = msg;
            UI.pal.layout.layout(true);
        }
    };

    // 保存预设到槽位：同时写 app.settings（全局）+ 工程目录 JSON（跟工程走）
    SCRIPTS.ui.saveSlot = function (idx) {
        var params = SCRIPTS.preset.collectParams(UI);
        var preset = SCRIPTS.preset.toPreset(params);
        presetsCache[String(idx)] = preset;

        var globalOk = SCRIPTS.preset.writeToSettings(idx, preset);
        var fileOk = SCRIPTS.preset.writeToProjectFile(presetsCache);
        SCRIPTS.ui.updateLoadButtons();
        if (fileOk) {
            SCRIPTS.ui.setStatus("已保存到预设 " + idx + "（工程目录 JSON）");
        } else if (globalOk) {
            SCRIPTS.ui.setStatus("已保存到预设 " + idx + "（全局设置；工程未保存则跟工程走需先存 .aep）");
        } else {
            SCRIPTS.ui.setStatus("保存预设 " + idx + " 失败");
        }
    };

    // 加载预设到面板
    SCRIPTS.ui.loadSlot = function (idx) {
        if (!presetsCache || !presetsCache[String(idx)]) {
            SCRIPTS.ui.setStatus("预设 " + idx + " 没有数据");
            return;
        }
        SCRIPTS.preset.applyParams(UI, presetsCache[String(idx)]);
        SCRIPTS.ui.setStatus("已加载预设 " + idx);
    };

    // 清除全部预设
    SCRIPTS.ui.clearAllPresets = function () {
        for (var i = 1; i <= PRESET_COUNT; i++) { SCRIPTS.preset.deleteFromSettings(i); }
        SCRIPTS.preset.deleteProjectFile();
        presetsCache = {};
        SCRIPTS.ui.updateLoadButtons();
        SCRIPTS.ui.setStatus("已清除所有预设");
    };

    // 恢复默认参数
    SCRIPTS.ui.resetParams = function () {
        SCRIPTS.preset.applyParams(UI, SCRIPTS.preset.toPreset(DEFAULTS));
        SCRIPTS.ui.setStatus("已恢复默认参数");
    };

    // 刷新"使用"按钮可用状态（有数据才可点）
    SCRIPTS.ui.updateLoadButtons = function () {
        if (!UI || !UI.loadBtns) { return; }
        for (var pi = 1; pi <= PRESET_COUNT; pi++) {
            if (UI.loadBtns[pi - 1]) {
                UI.loadBtns[pi - 1].enabled = (presetsCache && presetsCache[String(pi)]) ? true : false;
            }
        }
    };

    // Debug 模式：报错弹可复制对话框（多行只读输入框，Ctrl+A 全选 / Ctrl+C 复制）
    SCRIPTS.ui.showErrorDialog = function (err) {
        // 带上出错行号（ExtendScript Error 有 line 属性），便于定位
        var loc = (err && err.line) ? "（第 " + err.line + " 行）" : "";
        var msg = "发生错误" + loc + "：" + (err && err.message ? err.message : String(err));
        if (err && err.stack) { msg += "\n\n--- 堆栈 ---\n" + err.stack; }
        var win = new Window("dialog", "脚本错误 (Debug)");
        win.orientation = "column";
        win.alignChildren = "fill";
        win.spacing = 10;
        win.margins = 16;
        var hint = win.add("statictext", undefined, "以下信息可复制：点击输入框，Ctrl+A 全选，Ctrl+C 复制。");
        hint.alignment = ["fill", "center"];
        var ed = win.add("edittext", undefined, msg, { multiline: true, readonly: true });
        ed.preferredSize = [480, 160];
        ed.alignment = ["fill", "fill"];
        var btns = win.add("group");
        btns.alignment = "center";
        btns.spacing = 10;
        var bCopy = btns.add("button", undefined, "全选复制");
        var bOk = btns.add("button", undefined, "知道了");
        bCopy.onClick = function () { ed.active = true; ed.selectAll(); };
        bOk.onClick = function () { win.close(); };
        win.show();
    };

    // 成功信息：显示在面板窗口底部状态栏；无面板时用轻量对话框兜底
    SCRIPTS.ui.showSuccess = function (text) {
        if (UI && UI.status) {
            UI.status.text = "✓ " + text;
            UI.pal.layout.layout(true);
        } else {
            var win = new Window("dialog", "完成");
            win.orientation = "column";
            win.alignChildren = "center";
            win.spacing = 8;
            win.margins = 16;
            var st = win.add("statictext", undefined, "✓ " + text);
            st.alignment = ["fill", "center"];
            var b = win.add("button", undefined, "确定");
            b.onClick = function () { win.close(); };
            win.show();
        }
    };

    // 主流程
    SCRIPTS.ui.run = function () {
        if (app.project === null) { alert("请先打开一个 After Effects 项目。"); return; }
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) { alert("请先激活一个合成（在时间轴面板点一下）。"); return; }

        // 歌词来源：① 面板输入框优先；② 为空时回退到选中的文本图层
        var lyricsText = (UI && UI.eLyrics) ? UI.eLyrics.text : "";
        var srcLayer = null;
        if (!lyricsText || lyricsText.replace(/\s/g, "") === "") {
            if (comp.selectedLayers.length !== 1) {
                alert("请在面板的歌词输入框中粘贴歌词（每句一行），或先选中一个含歌词的文本图层。");
                return;
            }
            var sel = comp.selectedLayers[0];
            if (!(sel instanceof TextLayer)) { alert("选中的不是文本图层，请在面板输入歌词。"); return; }
            if (!sel.text.sourceText.value.text || sel.text.sourceText.value.text.replace(/\s/g, "") === "") {
                alert("选中的文本图层是空的，请在面板输入歌词。"); return;
            }
            srcLayer = sel;
        } else {
            // 输入框有歌词：若恰好选中文本图层则继承其样式，否则用默认样式
            if (comp.selectedLayers.length === 1 && comp.selectedLayers[0] instanceof TextLayer) {
                srcLayer = comp.selectedLayers[0];
            }
        }

        var params = SCRIPTS.preset.collectParams(UI);
        if (params.maxSize < params.normalSize) { params.maxSize = params.normalSize; }

        SCRIPTS.ui.setStatus("生成中…");

        app.beginUndoGroup("生成滚动歌词");
        try {
            var result = SCRIPTS.core.buildLyrics(comp, srcLayer, params, lyricsText);
            SCRIPTS.ui.showSuccess("已生成 " + result.count + " 句歌词，总时长约 " + result.duration.toFixed(1) + " 秒。空格键预览。");
        } catch (err) {
            // 运行时错误：Debug 开 → 可复制对话框；关 → 面板状态栏
            if (UI && UI.debugChk && UI.debugChk.value) {
                SCRIPTS.ui.showErrorDialog(err);
            } else if (UI && UI.status) {
                UI.status.text = "✗ " + (err.message || String(err));
                UI.pal.layout.layout(true);
            } else {
                alert("出错：" + (err.message || String(err)));
            }
        } finally {
            app.endUndoGroup();
        }
    };

    // 构建面板 UI（参数直接铺在窗口内）；返回控件引用集合
    SCRIPTS.ui.buildUI = function (pal) {
        var btn = pal.add("button", undefined, "生成滚动歌词");
        btn.alignment = ["fill", "center"];

        // 歌词输入框（多行）
        var lyricsLb = pal.add("statictext", undefined, "歌词（每句一行，回车分隔）：");
        lyricsLb.alignment = ["fill", "center"];
        var eLyrics = pal.add("edittext", undefined, "", { multiline: true });
        eLyrics.preferredSize = [380, 110];
        eLyrics.alignment = ["fill", "fill"];
        var hintLb = pal.add("statictext", undefined, "未填时使用选中的文本图层；选中文本图层可继承字体/颜色");
        hintLb.alignment = ["fill", "center"];

        // 参数行：文本框直接输入数字（生成后可在 AE 里用 Lyrics_Ctrl 上的控件实时调整）
        function paramRow(label, def) {
            var r = pal.add("group");
            r.orientation = "row";
            r.alignChildren = "center";
            r.spacing = 8;
            var lb = r.add("statictext", undefined, label);
            lb.preferredSize.width = 180;
            lb.alignment = ["left", "center"];
            var ed = r.add("edittext", undefined, String(def));
            ed.preferredSize.width = 90;
            ed.alignment = ["fill", "center"];
            return ed;
        }

        var eMax = paramRow("最大文字大小 (px):", DEFAULTS.maxSize);
        var eNormal = paramRow("普通文字大小 (px):", DEFAULTS.normalSize);
        var eGap = paramRow("两句歌词间距 (px):", DEFAULTS.gap);
        var eMaxOp = paramRow("最大文字透明度 (%):", DEFAULTS.maxOpacity);
        var eNormalOp = paramRow("普通文字透明度 (%):", DEFAULTS.normalOpacity);
        var eScroll = paramRow("滚动帧数 (一句到下一句):", DEFAULTS.scrollFrames);
        var ePause = paramRow("停顿帧数 (每句停留):", DEFAULTS.pauseFrames);

        // 停顿随机：开启后每句实际停顿 = 停顿帧数 ± 抖动帧数（如 30±10 → 20~40）
        var pauseRandomChk = pal.add("checkbox", undefined, "停顿随机（每句停顿在 停顿±抖动 间随机）");
        pauseRandomChk.value = DEFAULTS.pauseRandom;
        pauseRandomChk.alignment = ["fill", "center"];
        var eJitter = paramRow("抖动帧数 (±):", DEFAULTS.jitterFrames);

        var fitChk = pal.add("checkbox", undefined, "自动缩小超长歌词（防止超出画布）");
        fitChk.value = true;
        fitChk.alignment = ["fill", "center"];

        // ---- 预设管理（参考 AE-Lyrics-Animator：槽位按钮 + 双层持久化） ----
        var presetGrp = pal.add("panel");
        presetGrp.text = "  预设管理";
        presetGrp.orientation = "column";
        presetGrp.alignChildren = ["fill", "top"];
        presetGrp.spacing = 3;
        presetGrp.margins = [8, 14, 8, 6];

        var saveRow = presetGrp.add("group");
        saveRow.orientation = "row";
        saveRow.alignChildren = ["left", "center"];
        saveRow.spacing = 1;
        var saveLabel = saveRow.add("statictext", undefined, "存储");
        saveLabel.size = { width: 24, height: 20 };
        var saveBtns = [];
        for (var px = 1; px <= PRESET_COUNT; px++) {
            var sBtn = saveRow.add("button", undefined, String(px));
            sBtn.size = { width: 26, height: 22 };
            saveBtns.push(sBtn);
        }
        var clearPresetBtn = saveRow.add("button", undefined, "清除全部");
        clearPresetBtn.size = { width: 62, height: 22 };

        var loadRow = presetGrp.add("group");
        loadRow.orientation = "row";
        loadRow.alignChildren = ["left", "center"];
        loadRow.spacing = 1;
        var loadLabel = loadRow.add("statictext", undefined, "使用");
        loadLabel.size = { width: 24, height: 20 };
        var loadBtns = [];
        for (var px = 1; px <= PRESET_COUNT; px++) {
            var lBtn = loadRow.add("button", undefined, String(px));
            lBtn.size = { width: 26, height: 22 };
            lBtn.enabled = false;
            loadBtns.push(lBtn);
        }
        var resetBtn = loadRow.add("button", undefined, "复位");
        resetBtn.size = { width: 55, height: 22 };

        for (var px = 1; px <= PRESET_COUNT; px++) {
            (function (idx) {
                saveBtns[idx - 1].onClick = function () { SCRIPTS.ui.saveSlot(idx); };
                loadBtns[idx - 1].onClick = function () { SCRIPTS.ui.loadSlot(idx); };
            })(px);
        }
        clearPresetBtn.onClick = function () { SCRIPTS.ui.clearAllPresets(); };
        resetBtn.onClick = function () { SCRIPTS.ui.resetParams(); };

        var debugChk = pal.add("checkbox", undefined, "Debug 模式：报错弹可复制对话框");
        debugChk.value = true;
        debugChk.alignment = ["fill", "center"];

        var tipLb = pal.add("statictext", undefined, "生成后拖动 Lyrics_Master 空对象可整体移动歌词");
        tipLb.alignment = ["fill", "center"];

        var status = pal.add("statictext", undefined, "就绪：粘贴歌词后点击生成");
        status.alignment = ["fill", "center"];

        btn.onClick = SCRIPTS.ui.run;
        UI = {
            pal: pal, btn: btn, eLyrics: eLyrics,
            eMax: eMax, eNormal: eNormal, eGap: eGap,
            eMaxOp: eMaxOp, eNormalOp: eNormalOp,
            eScroll: eScroll, ePause: ePause,
            pauseRandomChk: pauseRandomChk, eJitter: eJitter,
            fitChk: fitChk, debugChk: debugChk, status: status,
            saveBtns: saveBtns, loadBtns: loadBtns
        };
        return UI;
    };

    /* ---------------- 启动 ---------------- */

    var inExtendScript = (typeof app !== "undefined");
    if (inExtendScript) {
        var pal = PANEL_MODE ? thisObj
            : new Window("palette", "滚动歌词生成器", undefined, { resizeable: false });
        pal.orientation = "column";
        pal.alignChildren = "fill";
        pal.spacing = 5;
        pal.margins = 12;

        SCRIPTS.ui.buildUI(pal);

        // 初始化预设缓存 + 刷新按钮状态
        presetsCache = SCRIPTS.preset.initPresets();
        SCRIPTS.ui.updateLoadButtons();

        if (PANEL_MODE) {
            pal.layout.layout(true);
        } else {
            pal.center();
            pal.show();
        }
    }

    // Node 测试环境导出（AE 中无 module，不会执行）
    if (typeof module !== "undefined" && module.exports) {
        module.exports = SCRIPTS;
    }
})(this);
