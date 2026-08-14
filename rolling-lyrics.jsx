/*!
 * 滚动歌词生成器 (Rolling Lyrics Generator) v3.2
 * ---------------------------------------------------------------
 * 用法：
 *   1. 打开本面板，在"歌词"输入框直接粘贴整段歌词（每句一行，回车分隔）
 *      —— 也可以不填，改用在合成中选中的文本图层
 *   2. 调整参数，点击"生成滚动歌词"
 *   3. 参数可存为预设（面板"预设管理"区），下次一键载入
 *
 * 效果：
 *   - 自动按行拆分歌词，每句一个图层，垂直等间距排列
 *   - 一个空对象控制器驱动整体匀速滚动
 *   - 滚动到画面中心的一句：放大到"最大字号"、按"最大透明度"显示
 *   - 未到中心的歌词：保持"普通字号"、按"普通透明度"显示
 *   - 歌词数量自适应，间距始终相同
 *
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
        fitLong: true
    };

    // ---- 预设常量（对齐 AE-Lyrics-Animator 双层持久化方案） ----
    var PRESET_COUNT = 4;
    var PRESET_VERSION = 1;
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

    /* ---------------- 工具函数 ---------------- */

    // 估算文本宽度（汉字≈1倍字号，西文≈0.55倍），用于超长句自动缩字号
    SCRIPTS.estTextWidth = function (str, fontSize) {
        var w = 0, i, code;
        for (i = 0; i < str.length; i++) {
            code = str.charCodeAt(i);
            if (code > 0x2E7F) { w += 1.0; }
            else if (code > 0x20 && code < 0x7F) { w += 0.55; }
            else { w += 0.3; }
        }
        return w * fontSize;
    };

    // 清除属性上的表达式和全部关键帧
    SCRIPTS.clearProp = function (prop) {
        prop.expression = "";
        while (prop.numKeys > 0) { prop.removeKeyframe(1); }
    };

    // 清理旧生成图层（统一前缀命名 + 倒序遍历，避免索引前移跳删）
    SCRIPTS.removeGenerated = function (comp, keepLayer) {
        var i, L;
        for (i = comp.numLayers; i >= 1; i--) {
            L = comp.layer(i);
            if (L === keepLayer) { continue; }
            if (L.name.indexOf(LYRIC_PREFIX) === 0 || L.name.indexOf("Lyrics_") === 0) {
                L.remove();
            }
        }
    };

    // 解析数值（非法/<=0 时回退）
    SCRIPTS.numVal = function (v, fallback) {
        var n = parseFloat(v);
        return (isNaN(n) || n <= 0) ? fallback : n;
    };

    /* ---------------- 预设：参数 <-> 短键结构 ---------------- */

    // 从 UI 控件读取参数（生成与保存共用同一来源）
    SCRIPTS.collectParams = function (ui) {
        return {
            maxSize: SCRIPTS.numVal(ui.eMax.text, DEFAULTS.maxSize),
            normalSize: SCRIPTS.numVal(ui.eNormal.text, DEFAULTS.normalSize),
            gap: SCRIPTS.numVal(ui.eGap.text, DEFAULTS.gap),
            maxOpacity: Math.min(100, SCRIPTS.numVal(ui.eMaxOp.text, DEFAULTS.maxOpacity)),
            normalOpacity: Math.min(100, SCRIPTS.numVal(ui.eNormalOp.text, DEFAULTS.normalOpacity)),
            scrollFrames: SCRIPTS.numVal(ui.eScroll.text, DEFAULTS.scrollFrames),
            pauseFrames: SCRIPTS.numVal(ui.ePause.text, DEFAULTS.pauseFrames),
            fitLong: ui.fitChk.value
        };
    };

    // 参数 → 预设（短键压缩）
    SCRIPTS.toPreset = function (params) {
        return {
            v: PRESET_VERSION,
            max: params.maxSize, nor: params.normalSize, gap: params.gap,
            mop: params.maxOpacity, nop: params.normalOpacity,
            sf: params.scrollFrames, pf: params.pauseFrames,
            fit: params.fitLong
        };
    };

    // 预设 → 参数（缺失字段回退默认，兼容旧预设）
    SCRIPTS.fromPreset = function (p) {
        if (!p) { return { maxSize: DEFAULTS.maxSize, normalSize: DEFAULTS.normalSize, gap: DEFAULTS.gap, maxOpacity: DEFAULTS.maxOpacity, normalOpacity: DEFAULTS.normalOpacity, scrollFrames: DEFAULTS.scrollFrames, pauseFrames: DEFAULTS.pauseFrames, fitLong: DEFAULTS.fitLong }; }
        return {
            maxSize: SCRIPTS.numVal(p.max, DEFAULTS.maxSize),
            normalSize: SCRIPTS.numVal(p.nor, DEFAULTS.normalSize),
            gap: SCRIPTS.numVal(p.gap, DEFAULTS.gap),
            maxOpacity: Math.min(100, SCRIPTS.numVal(p.mop, DEFAULTS.maxOpacity)),
            normalOpacity: Math.min(100, SCRIPTS.numVal(p.nop, DEFAULTS.normalOpacity)),
            scrollFrames: SCRIPTS.numVal(p.sf, DEFAULTS.scrollFrames),
            pauseFrames: SCRIPTS.numVal(p.pf, DEFAULTS.pauseFrames),
            fitLong: (p.fit !== undefined) ? !!p.fit : DEFAULTS.fitLong
        };
    };

    // 把预设参数写回 UI 控件
    SCRIPTS.applyParams = function (ui, p) {
        var params = SCRIPTS.fromPreset(p);
        ui.eMax.text = String(params.maxSize);
        ui.eNormal.text = String(params.normalSize);
        ui.eGap.text = String(params.gap);
        ui.eMaxOp.text = String(params.maxOpacity);
        ui.eNormalOp.text = String(params.normalOpacity);
        ui.eScroll.text = String(params.scrollFrames);
        ui.ePause.text = String(params.pauseFrames);
        ui.fitChk.value = params.fitLong;
    };

    /* ---------------- 预设：本地存储（双层持久化） ---------------- */

    // 工程目录预设 JSON 文件路径（跟工程走）
    SCRIPTS.getProjectPresetFile = function () {
        try {
            var projFile = app.project.file;
            if (!projFile) { return null; }
            var projFolder = projFile.parent;
            if (!projFolder) { return null; }
            return new File(projFolder.fsName + "/" + PRESET_FILENAME);
        } catch (e) { return null; }
    };

    // 从工程目录 JSON 读取全部预设
    SCRIPTS.readFromProjectFile = function () {
        try {
            var f = SCRIPTS.getProjectPresetFile();
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
    SCRIPTS.writeToProjectFile = function (data) {
        try {
            var f = SCRIPTS.getProjectPresetFile();
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
    SCRIPTS.deleteProjectFile = function () {
        try {
            var f = SCRIPTS.getProjectPresetFile();
            if (f && f.exists) { f.remove(); }
        } catch (e) {}
    };

    // 从 app.settings 读取单个预设（全局保底）
    SCRIPTS.readFromSettings = function (idx) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx)) {
                var text = app.settings.getSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx);
                if (text && text.length > 0) { return JSON.parse(text); }
            }
        } catch (e) {}
        return null;
    };

    // 写入单个预设到 app.settings
    SCRIPTS.writeToSettings = function (idx, params) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx, JSON.stringify(params));
            return true;
        } catch (e) { return false; }
    };

    // 删除 app.settings 中单个预设
    SCRIPTS.deleteFromSettings = function (idx) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx)) {
                app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY_PREFIX + idx, "");
            }
        } catch (e) {}
    };

    // 初始化：优先工程目录 JSON，回退 app.settings
    SCRIPTS.initPresets = function () {
        var fromFile = SCRIPTS.readFromProjectFile();
        if (fromFile) { return fromFile; }
        var cache = {};
        for (var i = 1; i <= PRESET_COUNT; i++) {
            var p = SCRIPTS.readFromSettings(i);
            if (p) { cache[String(i)] = p; }
        }
        return cache;
    };

    /* ---------------- 预设：UI 操作 ---------------- */

    SCRIPTS.setStatus = function (msg) {
        if (UI && UI.status) {
            UI.status.text = msg;
            UI.pal.layout.layout(true);
        }
    };

    // 保存预设到槽位：同时写 app.settings（全局）+ 工程目录 JSON（跟工程走）
    SCRIPTS.saveSlot = function (idx) {
        var params = SCRIPTS.collectParams(UI);
        var preset = SCRIPTS.toPreset(params);
        presetsCache[String(idx)] = preset;

        var globalOk = SCRIPTS.writeToSettings(idx, preset);
        var fileOk = SCRIPTS.writeToProjectFile(presetsCache);
        SCRIPTS.updateLoadButtons();
        if (fileOk) {
            SCRIPTS.setStatus("已保存到预设 " + idx + "（工程目录 JSON）");
        } else if (globalOk) {
            SCRIPTS.setStatus("已保存到预设 " + idx + "（全局设置；工程未保存则跟工程走需先存 .aep）");
        } else {
            SCRIPTS.setStatus("保存预设 " + idx + " 失败");
        }
    };

    // 加载预设到面板
    SCRIPTS.loadSlot = function (idx) {
        if (!presetsCache || !presetsCache[String(idx)]) {
            SCRIPTS.setStatus("预设 " + idx + " 没有数据");
            return;
        }
        SCRIPTS.applyParams(UI, presetsCache[String(idx)]);
        SCRIPTS.setStatus("已加载预设 " + idx);
    };

    // 清除全部预设
    SCRIPTS.clearAllPresets = function () {
        for (var i = 1; i <= PRESET_COUNT; i++) { SCRIPTS.deleteFromSettings(i); }
        SCRIPTS.deleteProjectFile();
        presetsCache = {};
        SCRIPTS.updateLoadButtons();
        SCRIPTS.setStatus("已清除所有预设");
    };

    // 恢复默认参数
    SCRIPTS.resetParams = function () {
        SCRIPTS.applyParams(UI, SCRIPTS.toPreset(DEFAULTS));
        SCRIPTS.setStatus("已恢复默认参数");
    };

    // 刷新"使用"按钮可用状态（有数据才可点）
    SCRIPTS.updateLoadButtons = function () {
        if (!UI || !UI.loadBtns) { return; }
        for (var pi = 1; pi <= PRESET_COUNT; pi++) {
            if (UI.loadBtns[pi - 1]) {
                UI.loadBtns[pi - 1].enabled = (presetsCache && presetsCache[String(pi)]) ? true : false;
            }
        }
    };

    /* ---------------- 核心逻辑（纯函数，便于测试） ---------------- */

    // params: {maxSize, normalSize, gap, maxOpacity, normalOpacity,
    //          scrollFrames, pauseFrames, fitLong}
    // srcLayer 可为 null（无源样式时用默认文本样式）；lyricsText 优先于 srcLayer 文本
    SCRIPTS.buildLyrics = function (comp, srcLayer, params, lyricsText) {
        // 先清理旧的生成图层（防重复运行堆积）
        SCRIPTS.removeGenerated(comp, srcLayer);

        var fullText = lyricsText || (srcLayer ? (srcLayer.text.sourceText.value.text || "") : "");
        var lines = fullText.split(/\r?\n/);
        var lyrics = [], i, t;
        for (i = 0; i < lines.length; i++) {
            t = lines[i].replace(/^\s+|\s+$/g, "");
            if (t.length > 0) { lyrics.push(t); }
        }
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
        if (scrollFrames < 1) { scrollFrames = 1; }
        if (pauseFrames < 0) { pauseFrames = 0; }

        // 每句相对画面中心的偏移（等差 => 间距相同）
        var centerIdx = (n - 1) / 2;
        var offsets = [];
        for (i = 0; i < n; i++) { offsets.push((i - centerIdx) * gap); }

        // 缩放/透明度渐变范围：用固定值（合成高度 25%，至少覆盖相邻一句的 1.5 倍）
        // 不能用"总跨度一半"——歌词句数多时范围过大，相邻句的缩放差异被摊薄到看不出
        var maxDist = Math.max(Math.round(comp.height * 0.25), Math.round(gap * 1.5));

        // 每句基础字号与中心缩放比（超长句自动缩窄）
        var maxW = comp.width * 0.88;
        var bases = [];
        var ratios = [];
        for (i = 0; i < n; i++) {
            var base = normalSize;
            var ratio = maxSize / normalSize;
            if (params.fitLong) {
                var w = SCRIPTS.estTextWidth(lyrics[i], normalSize);
                if (w > maxW) {
                    base = Math.max(12, normalSize * maxW / w);
                    var wBig = SCRIPTS.estTextWidth(lyrics[i], base * ratio);
                    if (wBig > maxW && wBig > 0) {
                        ratio = Math.max(1, maxW / SCRIPTS.estTextWidth(lyrics[i], base));
                    }
                }
            }
            bases.push(base);
            ratios.push(ratio);
        }

        // ---- 生成歌词图层（有源图层则继承样式，否则用默认文本样式） ----
        var layers = [];
        var L, td, r;
        for (i = 0; i < n; i++) {
            if (srcLayer) {
                if (i === 0) { L = srcLayer; } else { L = srcLayer.duplicate(); }
            } else {
                L = comp.layers.addText();
            }
            L.name = LYRIC_PREFIX + (i + 1);
            td = L.text.sourceText.value;
            td.text = lyrics[i];
            td.fontSize = bases[i];
            L.text.sourceText.setValue(td);
            r = L.sourceRectAtTime(0, false);
            L.transform.anchorPoint.setValue([r.left + r.width / 2, r.top + r.height / 2]);
            SCRIPTS.clearProp(L.text.sourceText);
            SCRIPTS.clearProp(L.transform.anchorPoint);
            SCRIPTS.clearProp(L.transform.position);
            SCRIPTS.clearProp(L.transform.scale);
            SCRIPTS.clearProp(L.transform.opacity);
            layers.push(L);
        }

        // ---- 创建滚动控制器 + 总控制（空对象）并打滚动关键帧 ----
        // 从合成最开头生成：startTime 用默认 0，关键帧也从 0 帧开始（不跟随播放指针）
        var ctrl = comp.layers.addNull();
        ctrl.name = CTRL_NAME;
        ctrl.transform.position.setValue([comp.width / 2, comp.height / 2]);

        // 总控制：拖动它可整体移动歌词（初始在画面中心，偏移量 = 当前值 - 初始值）
        var master = comp.layers.addNull();
        master.name = MASTER_NAME;
        master.transform.position.setValue([comp.width / 2, comp.height / 2]);

        var frameDur = comp.frameDuration;
        var tFrames = 0;
        for (i = 0; i < n; i++) {
            var y = comp.height / 2 - offsets[i];
            // 到达中心
            ctrl.transform.position.setValueAtTime(tFrames * frameDur, [comp.width / 2, y]);
            // 停留到 pauseFrames 后才开始滚向下一句
            ctrl.transform.position.setValueAtTime((tFrames + pauseFrames) * frameDur, [comp.width / 2, y]);
            tFrames += pauseFrames + scrollFrames;
        }
        // 结尾：最后一句多停留 1 秒
        var endFrames = tFrames + pauseFrames + Math.round(1 / frameDur);
        comp.duration = endFrames * frameDur;

        // ---- 给每句歌词挂表达式（表达式全英文，引用控制器用英文名） ----
        for (i = 0; i < n; i++) {
            L = layers[i];
            L.transform.position.expression =
                "offsetY = " + offsets[i] + ";\n" +
                "m = thisComp.layer(\"" + MASTER_NAME + "\").transform.position;\n" +
                "c = thisComp.layer(\"" + CTRL_NAME + "\").transform.position;\n" +
                "[" + (comp.width / 2) + " + (m[0] - " + (comp.width / 2) + "), " +
                "c[1] + offsetY + (m[1] - " + (comp.height / 2) + ")]";
            L.transform.scale.expression =
                "m = thisComp.layer(\"" + MASTER_NAME + "\").transform.position;\n" +
                "d = Math.abs(transform.position[1] - m[1]);\n" +
                "dd = Math.min(d, " + maxDist + ");\n" +
                "s = ease(dd, 0, " + maxDist + ", " + (ratios[i] * 100) + ", 100);\n" +
                "[s, s]";
            L.transform.opacity.expression =
                "m = thisComp.layer(\"" + MASTER_NAME + "\").transform.position;\n" +
                "d = Math.abs(transform.position[1] - m[1]);\n" +
                "dd = Math.min(d, " + maxDist + ");\n" +
                "ease(dd, 0, " + maxDist + ", " + maxOpacity + ", " + normalOpacity + ")";
        }

        return {
            count: n,
            duration: comp.duration,
            layers: layers,
            controller: ctrl,
            master: master,
            offsets: offsets,
            bases: bases,
            ratios: ratios,
            maxDist: maxDist,
            endFrames: endFrames
        };
    };

    /* ---------------- 错误 / 成功提示 ---------------- */

    // Debug 模式：报错弹可复制对话框（多行只读输入框，Ctrl+A 全选 / Ctrl+C 复制）
    SCRIPTS.showErrorDialog = function (err) {
        var msg = "发生错误：" + (err && err.message ? err.message : String(err));
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
    SCRIPTS.showSuccess = function (text) {
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

    /* ---------------- 主流程 ---------------- */

    SCRIPTS.run = function () {
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

        var params = SCRIPTS.collectParams(UI);
        if (params.maxSize < params.normalSize) { params.maxSize = params.normalSize; }

        SCRIPTS.setStatus("生成中…");

        app.beginUndoGroup("生成滚动歌词");
        try {
            var result = SCRIPTS.buildLyrics(comp, srcLayer, params, lyricsText);
            SCRIPTS.showSuccess("已生成 " + result.count + " 句歌词，总时长约 " + result.duration.toFixed(1) + " 秒。空格键预览。");
        } catch (err) {
            // 运行时错误：Debug 开 → 可复制对话框；关 → 面板状态栏
            if (UI && UI.debugChk && UI.debugChk.value) {
                SCRIPTS.showErrorDialog(err);
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

    /* ---------------- 面板 UI（参数直接铺在窗口内） ---------------- */

    var inExtendScript = (typeof app !== "undefined");
    if (inExtendScript) {
        var pal = PANEL_MODE ? thisObj
            : new Window("palette", "滚动歌词生成器", undefined, { resizeable: false });
        pal.orientation = "column";
        pal.alignChildren = "fill";
        pal.spacing = 5;
        pal.margins = 12;

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
                saveBtns[idx - 1].onClick = function () { SCRIPTS.saveSlot(idx); };
                loadBtns[idx - 1].onClick = function () { SCRIPTS.loadSlot(idx); };
            })(px);
        }
        clearPresetBtn.onClick = function () { SCRIPTS.clearAllPresets(); };
        resetBtn.onClick = function () { SCRIPTS.resetParams(); };

        var debugChk = pal.add("checkbox", undefined, "Debug 模式：报错弹可复制对话框");
        debugChk.value = true;
        debugChk.alignment = ["fill", "center"];

        var tipLb = pal.add("statictext", undefined, "生成后拖动 Lyrics_Master 空对象可整体移动歌词");
        tipLb.alignment = ["fill", "center"];

        var status = pal.add("statictext", undefined, "就绪：粘贴歌词后点击生成");
        status.alignment = ["fill", "center"];

        btn.onClick = SCRIPTS.run;
        UI = {
            pal: pal, btn: btn, eLyrics: eLyrics,
            eMax: eMax, eNormal: eNormal, eGap: eGap,
            eMaxOp: eMaxOp, eNormalOp: eNormalOp,
            eScroll: eScroll, ePause: ePause,
            fitChk: fitChk, debugChk: debugChk, status: status,
            saveBtns: saveBtns, loadBtns: loadBtns
        };

        // 初始化预设缓存 + 刷新按钮状态
        presetsCache = SCRIPTS.initPresets();
        SCRIPTS.updateLoadButtons();

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
