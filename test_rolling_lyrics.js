/* Mock AE 环境，测试 rolling-lyrics.jsx 的核心逻辑 */
"use strict";

const assert = require("assert");
const SCRIPTS = require("./rolling-lyrics.jsx");

function makeProp() {
    const p = {
        expression: "",
        val: null,
        keys: [],
        setValue(v) { this.val = v; },
        setValueAtTime(t, v) { this.keys.push({ t, v }); },
        removeKeyframe(i) { this.keys.splice(i - 1, 1); }
    };
    // numKeys 动态反映 keys 长度，模拟 AE 属性（clearProp 依赖它删关键帧）
    Object.defineProperty(p, "numKeys", { get() { return this.keys.length; } });
    return p;
}

function makeTextLayer(text, fontSize) {
    const L = {
        name: "lyrics",
        startTime: 0,
        removed: false,
        text: {
            sourceText: {
                value: { text: text, fontSize: fontSize },
                setValue(td) { this.value = td; }
            }
        },
        // 模拟 AE 真实文本测量：宽度按当前字号估算（与 estTextWidth 同系数）
        sourceRectAtTime() {
            const td = this.text.sourceText.value;
            const fs = td.fontSize || 60;
            return { left: 0, top: 0, width: SCRIPTS.util.estTextWidth(td.text, fs), height: fs };
        },
        duplicate() {
            const C = makeTextLayer(this.text.sourceText.value.text, this.text.sourceText.value.fontSize);
            C.transform = {
                anchorPoint: makeProp(), position: makeProp(),
                scale: makeProp(), opacity: makeProp()
            };
            return C;
        },
        remove() { this.removed = true; },
        transform: {
            anchorPoint: makeProp(), position: makeProp(),
            scale: makeProp(), opacity: makeProp()
        }
    };
    return L;
}

// 模拟 AE 的 Slider Control 效果：效果对象可像函数一样调用取参数（fx(1) → 滑块属性）
function makeSliderFx(name, value) {
    const fx = function (arg) { return arg === 1 ? fx.slider : null; };
    Object.defineProperty(fx, "name", { value: name, writable: true, configurable: true });
    fx.matchName = "ADBE Slider Control";
    fx.slider = makeProp();
    fx.slider.setValue(value);
    fx.property = function (arg) {
        return (arg === 1
            || arg === "ADBE Slider Control-0001" || arg === "滑块" || arg === "Slider"
            || arg === "ADBE Checkbox Control-0001" || arg === "复选框" || arg === "Checkbox")
            ? fx.slider : null;
    };
    return fx;
}

function makeEffects() {
    return {
        list: [],
        addProperty() {
            const fx = makeSliderFx("Slider Control", 0);
            fx.matchName = "ADBE Slider Control";
            this.list.push(fx);
            return fx;
        },
        property(arg) {
            if (typeof arg === "number") { return this.list[arg - 1]; }
            for (const f of this.list) { if (f.name === arg) { return f; } }
            return null;
        }
    };
}

function makeComp(layersArr) {
    const arr = layersArr || [];
    return {
        width: 1920, height: 1080,
        frameDuration: 1 / 30, duration: 1,
        time: 2,
        get numLayers() { return arr.length; },
        layer(i) { return arr[i - 1]; },
        layers: {
            addNull() {
                const ctrl = {
                    name: "Null", startTime: 0, removed: false,
                    remove() { this.removed = true; },
                    transform: { position: makeProp() },
                    effects: makeEffects(),
                    property(path) {
                        return (path === "ADBE Effect Parade" || path === "Effects") ? this.effects : null;
                    }
                };
                arr.push(ctrl);
                return ctrl;
            },
            addText() {
                const T = makeTextLayer("Text", 60);
                T.transform = {
                    anchorPoint: makeProp(), position: makeProp(),
                    scale: makeProp(), opacity: makeProp()
                };
                arr.push(T);
                return T;
            }
        }
    };
}

const baseParams = {
    maxSize: 120, normalSize: 60, gap: 140,
    maxOpacity: 100, normalOpacity: 60,
    scrollFrames: 30, pauseFrames: 20,
    pauseRandom: false, jitterFrames: 10,
    fitLong: true
};

/* ---------- 测试 1：5 句拆分 + offsets 等差 + 参数控件 + 表达式驱动滚动 ---------- */
{
    const src = makeTextLayer("第一句\n第二句\n第三句\n第四句\n第五句", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);

    assert.strictEqual(r.count, 5, "应拆出 5 句");
    assert.deepStrictEqual(r.offsets, [-280, -140, 0, 140, 280], "offsets 应等差 140 且对称");
    assert.strictEqual(r.maxDist, 270, "渐变范围应为固定值 max(1080*0.25, 140*1.5)=270");

    // 9 个参数控件挂在 Lyrics_Ctrl 上，初值 = 面板参数（7 滑块 + 1 开关 + 1 抖动）
    const fxList = r.controller.effects.list;
    const fx = {};
    fxList.forEach(f => { fx[f.name] = f.slider.val; });
    assert.strictEqual(fxList.length, 9, "应有 9 个参数控件");
    assert.strictEqual(fx["最大字号"], 120, "最大字号 控件初值 120");
    assert.strictEqual(fx["普通字号"], 60, "普通字号 控件初值 60");
    assert.strictEqual(fx["间距"], 140, "间距 控件初值 140");
    assert.strictEqual(fx["最大透明度"], 100, "最大透明度 控件初值 100");
    assert.strictEqual(fx["普通透明度"], 60, "普通透明度 控件初值 60");
    assert.strictEqual(fx["滚动帧数"], 30, "滚动帧数 控件初值 30");
    assert.strictEqual(fx["停顿帧数"], 20, "停顿帧数 控件初值 20");
    assert.strictEqual(fx["停顿随机"], 0, "停顿随机 开关初值 0（默认关闭）");
    assert.strictEqual(fx["抖动帧数"], 10, "抖动帧数 控件初值 10");

    // 滚动动画由位置表达式驱动（无关键帧），节奏引用控件
    const ctrlExpr = r.controller.transform.position.expression;
    assert.ok(ctrlExpr.indexOf('effect("滚动帧数")(1)') >= 0, "滚动表达式应引用 滚动帧数 控件");
    assert.ok(ctrlExpr.indexOf('effect("停顿帧数")(1)') >= 0, "滚动表达式应引用 停顿帧数 控件");
    assert.ok(ctrlExpr.indexOf('effect("间距")(1)') >= 0, "滚动表达式应引用 间距 控件");
    assert.ok(ctrlExpr.indexOf("n = 5;") >= 0, "滚动表达式应烘焙句数 n=5");
    assert.strictEqual(r.controller.transform.position.keys.length, 0, "控制器位置不再有关键帧（表达式驱动）");

    // 时长：5 句，(5-1)*50 + 20 + 1秒(30帧) = 250 帧，从 0 开始
    const endFrames = (5 - 1) * 50 + 20 + 30;
    assert.strictEqual(r.endFrames, endFrames, "endFrames 计算错误");
    assert.ok(Math.abs(comp.duration - endFrames / 30) < 1e-9, "合成时长应 = endFrames 帧");

    // 控制器/总控制命名与起始（合成开头）
    assert.strictEqual(r.controller.name, "Lyrics_Ctrl", "控制器应为英文名 Lyrics_Ctrl");
    assert.ok(r.layers.every((L, i) => L.name === "歌词_" + (i + 1)), "歌词图层应带统一前缀");

    // 表达式内容（全英文引用控制器 + 总控制 + 参数控件）
    const L0 = r.layers[0];
    assert.ok(L0.transform.position.expression.indexOf("Lyrics_Ctrl") >= 0, "位置表达式应引用英文控制器名");
    assert.ok(L0.transform.position.expression.indexOf("Lyrics_Master") >= 0, "位置表达式应引用总控制");
    assert.ok(L0.transform.position.expression.indexOf("滚动控制器") < 0, "表达式不得含中文图层名");
    assert.ok(L0.transform.position.expression.indexOf('c.effect("间距")(1)') >= 0, "位置表达式应引用 间距 控件");
    assert.ok(L0.transform.scale.expression.indexOf('c.effect("最大字号")(1)') >= 0, "缩放表达式应引用 最大字号 控件");
    assert.ok(L0.transform.scale.expression.indexOf("transform.position[1] - m[1]") >= 0, "缩放中心应跟随总控制 Y");
    assert.ok(L0.transform.scale.expression.indexOf("thisComp.height/2") < 0, "缩放中心不得再硬编码合成中心");
    assert.ok(L0.transform.opacity.expression.indexOf('c.effect("最大透明度")(1)') >= 0, "透明度表达式应引用 最大透明度 控件");
    assert.ok(L0.transform.opacity.expression.indexOf('c.effect("普通透明度")(1)') >= 0, "透明度表达式应引用 普通透明度 控件");
    assert.ok(L0.transform.opacity.expression.indexOf("transform.position[1] - m[1]") >= 0, "透明度中心应跟随总控制 Y");

    console.log("测试1 通过：5 句拆分/偏移/参数控件/表达式驱动滚动");
}

/* ---------- 测试 2：偶数句（4 句）对称偏移 ---------- */
{
    const src = makeTextLayer("一\n二\n三\n四", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.deepStrictEqual(r.offsets, [-210, -70, 70, 210], "4 句 offsets 应对称（gap=140）");
    assert.strictEqual(r.maxDist, 270, "渐变范围应为固定值 270");
    console.log("测试2 通过：偶数句对称");
}

/* ---------- 测试 3：超长句自动缩字号 ---------- */
{
    const longLine = "这是一句特别特别特别特别特别特别特别特别特别特别长的歌词为了测试";
    const src = makeTextLayer("短句\n" + longLine + "\n第三句", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    const maxW = comp.width * 0.88;
    assert.strictEqual(r.bases[0], 60, "短句基础字号应保持 60");
    assert.ok(r.bases[1] < 60, "超长句基础字号应缩小");
    assert.ok(r.bases[1] >= 12, "字号不应小于 12");
    const wBig = SCRIPTS.util.estTextWidth(longLine, r.bases[1] * r.ratios[1]);
    assert.ok(wBig <= maxW + 1, "中心放大后不应超出画布宽（实际 " + wBig.toFixed(1) + " / " + maxW + "）");
    assert.strictEqual(r.bases[2], 60, "第三句应保持 60");
    assert.ok(r.caps[1] !== null && r.caps[1] <= 1.0, "超长句应有放大上限（防溢出）");
    assert.strictEqual(r.caps[2], null, "短句不应有放大上限");
    console.log("测试3 通过：超长句自动缩窄 base=" + r.bases[1].toFixed(1) + " ratio=" + r.ratios[1].toFixed(2));
}

/* ---------- 测试 4：fitLong=false 时不缩窄 ---------- */
{
    const longLine = "这是一句特别特别特别特别特别特别特别特别特别特别长的歌词为了测试";
    const src = makeTextLayer("短句\n" + longLine, 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, Object.assign({}, baseParams, { fitLong: false }));
    assert.strictEqual(r.bases[1], 60, "关闭缩窄时基础字号应保持 60");
    assert.strictEqual(r.ratios[1], 2, "缩放比应为 max/normal = 2");
    assert.strictEqual(r.caps[1], null, "关闭缩窄时无放大上限");
    console.log("测试4 通过：fitLong=false 保持原字号");
}

/* ---------- 测试 5：空白行过滤 ---------- */
{
    const src = makeTextLayer("第一句\n\n   \n第二句\n\n", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.strictEqual(r.count, 2, "空白行应被过滤");
    assert.deepStrictEqual(r.offsets, [-70, 70], "两行 offset 应 ±70");
    console.log("测试5 通过：空白行过滤");
}

/* ---------- 测试 6：异常情况 ---------- */
{
    const src = makeTextLayer("只有一句", 60);
    const comp = makeComp();
    let threw = false;
    try { SCRIPTS.core.buildLyrics(comp, src, baseParams); } catch (e) { threw = true; }
    assert.ok(threw, "单句应抛错");
    console.log("测试6 通过：单句抛错");
}

/* ---------- 测试 7：重跑时清理旧生成图层（倒序、保留无关图层与源图层） ---------- */
{
    const oldLyric = makeTextLayer("旧歌词", 60);
    oldLyric.name = "歌词_9";
    const oldCtrl = { name: "Lyrics_Ctrl", removed: false, remove() { this.removed = true; } };
    const unrelated = { name: "背景音乐", removed: false, remove() { this.removed = true; } };
    const arr = [oldLyric, oldCtrl, unrelated]; // layer(1)=oldLyric, layer(2)=oldCtrl, layer(3)=unrelated
    const src = makeTextLayer("新第一句\n新第二句\n新第三句", 60);
    const comp = makeComp(arr);
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);

    assert.ok(oldLyric.removed, "旧歌词图层应被清理");
    assert.ok(oldCtrl.removed, "旧控制器应被清理");
    assert.ok(!unrelated.removed, "无关图层应保留");
    assert.ok(!src.removed, "源图层不应被删除（如果源本身是旧图层也应保留）");
    assert.strictEqual(r.count, 3, "新歌词应正常生成 3 句");
    console.log("测试7 通过：重跑清理旧图层（保留无关图层与源图层）");
}

/* ---------- 测试 8：源图层为旧生成图层时清理不删源 ---------- */
{
    const src = makeTextLayer("A\nB\nC", 60);
    src.name = "歌词_1";
    const comp = makeComp([src]);
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.ok(!src.removed, "源图层即使带歌词_前缀也不应被删除");
    assert.strictEqual(r.count, 3, "应正常生成");
    console.log("测试8 通过：清理不误删源图层");
}

/* ---------- 测试 9：无源图层 + 面板歌词输入（override） ---------- */
{
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, null, baseParams, "甲\n乙\n丙\n丁\n戊");
    assert.strictEqual(r.count, 5, "override 歌词应拆出 5 句");
    assert.deepStrictEqual(r.offsets, [-280, -140, 0, 140, 280], "offsets 应正确");
    assert.ok(r.layers.every((L, i) => L.name === "歌词_" + (i + 1)), "应生成 歌词_1..5");
    assert.strictEqual(r.layers[0].text.sourceText.value.text, "甲", "第一句文本应为甲");
    assert.strictEqual(r.layers[0].text.sourceText.value.fontSize, 60, "基础字号应为普通字号");
    assert.ok(r.layers[0].transform.position.expression.indexOf("Lyrics_Ctrl") >= 0, "表达式应引用英文控制器");
    console.log("测试9 通过：无源图层 + 面板歌词输入");
}

/* ---------- 测试 10：override 歌词优先于源图层文本 ---------- */
{
    const src = makeTextLayer("图层里的歌词", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams, "面板输入一\n面板输入二\n面板输入三");
    assert.strictEqual(r.count, 3, "应使用 override 歌词而非源图层文本");
    assert.strictEqual(r.layers[0].text.sourceText.value.text, "面板输入一");
    console.log("测试10 通过：override 优先于源图层");
}

/* ---------- 测试 11：总控制 Lyrics_Master 创建与引用 ---------- */
{
    const src = makeTextLayer("一\n二\n三\n四\n五", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.strictEqual(r.master.name, "Lyrics_Master", "总控制应命名 Lyrics_Master");
    assert.strictEqual(r.master.startTime, 0, "总控制应默认从合成开头（0 秒）");
    assert.strictEqual(r.controller.startTime, 0, "滚动控制器应默认从合成开头（0 秒）");
    assert.ok(r.layers.every((L) => L.startTime === 0), "新建歌词图层应从合成开头（startTime=0）");
    assert.deepStrictEqual(r.master.transform.position.val, [960, 540], "总控制初始位置应在合成中心");
    const expr = r.layers[0].transform.position.expression;
    assert.ok(expr.indexOf("960 + (m[0] - 960)") >= 0, "x 应为 中心 + master 水平偏移");
    assert.ok(expr.indexOf("c.transform.position[1] + offsetY + (m[1] - 540)") >= 0, "y 应为 滚动位置 + offset + master 垂直偏移");
    console.log("测试11 通过：总控制创建与表达式引用");
}

/* ---------- 测试 12：清理会删除旧总控制 ---------- */
{
    const oldMaster = { name: "Lyrics_Master", removed: false, remove() { this.removed = true; } };
    const arr = [oldMaster];
    const src = makeTextLayer("甲\n乙\n丙", 60);
    const comp = makeComp(arr);
    SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.ok(oldMaster.removed, "旧总控制应被清理");
    console.log("测试12 通过：旧总控制被清理");
}

/* ---------- 测试 13：整体移动后中心跟随（数学模拟） ---------- */
{
    // 模拟：master 下移 100px 后，滚到"视觉中心"的歌词（offsetY=0）
    // 歌词 y = ctrl[1] + offsetY + (master[1]-540)；master 移动后视觉中心 = master[1]
    // 中心句 ctrl[1]=540, offsetY=0, master[1]=640 → y=640, d=|640-640|=0 → 放大
    const src = makeTextLayer("一\n二\n三\n四\n五", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    // 位置表达式：y = c[1] + offsetY + (m[1] - 540)；中心句 offsetY = (2-2)*gap = 0
    const posExpr = r.layers[2].transform.position.expression; // 中心句 offsetY=0
    assert.ok(posExpr.indexOf("offsetY = (2 - 2) * c.effect") >= 0, "中心句 offsetY 应为 0（(2-2)*gap）");
    assert.ok(posExpr.indexOf("c.transform.position[1] + offsetY + (m[1] - 540)") >= 0, "位置应含 master 垂直偏移");
    // 缩放/透明度：d = |position[1] - m[1]| → 中心跟随 master
    const scaleExpr = r.layers[2].transform.scale.expression;
    assert.ok(scaleExpr.indexOf("transform.position[1] - m[1]") >= 0, "缩放中心 = master Y");
    console.log("测试13 通过：整体移动后放大中心跟随总控制");
}

/* ---------- 测试 14：预设 collect/apply 往返一致性 ---------- */
{
    function makeUI() {
        return {
            eMax: { text: "120" }, eNormal: { text: "60" }, eGap: { text: "140" },
            eMaxOp: { text: "100" }, eNormalOp: { text: "60" },
            eScroll: { text: "30" }, ePause: { text: "20" },
            fitChk: { value: true }
        };
    }
    const ui = makeUI();
    ui.eMax.text = "160"; ui.eNormal.text = "70"; ui.eGap.text = "180";
    ui.eMaxOp.text = "95"; ui.eNormalOp.text = "50";
    ui.eScroll.text = "45"; ui.ePause.text = "10"; ui.fitChk.value = false;
    ui.pauseRandomChk = { value: true }; ui.eJitter = { text: "15" };

    const params = SCRIPTS.preset.collectParams(ui);
    assert.strictEqual(params.maxSize, 160, "collectParams 应读取 maxSize");
    assert.strictEqual(params.fitLong, false, "collectParams 应读取 fitLong");
    assert.strictEqual(params.pauseRandom, true, "collectParams 应读取 pauseRandom");
    assert.strictEqual(params.jitterFrames, 15, "collectParams 应读取 jitterFrames");

    const preset = SCRIPTS.preset.toPreset(params);
    assert.strictEqual(preset.v, 2, "预设应带版本号（v2 含停顿随机）");
    assert.strictEqual(preset.max, 160, "预设短键 max 应正确");
    assert.strictEqual(preset.sf, 45, "预设短键 sf 应正确");
    assert.strictEqual(preset.pr, 1, "预设短键 pr（停顿随机）应正确");
    assert.strictEqual(preset.jit, 15, "预设短键 jit（抖动帧数）应正确");

    // apply 写回后 collect 一致（往返）
    SCRIPTS.preset.applyParams(ui, preset);
    const params2 = SCRIPTS.preset.collectParams(ui);
    assert.strictEqual(params2.maxSize, 160, "往返后 maxSize 应一致");
    assert.strictEqual(params2.scrollFrames, 45, "往返后 scrollFrames 应一致");
    assert.strictEqual(params2.pauseFrames, 10, "往返后 pauseFrames 应一致");
    assert.strictEqual(params2.fitLong, false, "往返后 fitLong 应一致");
    assert.strictEqual(params2.pauseRandom, true, "往返后 pauseRandom 应一致");
    assert.strictEqual(params2.jitterFrames, 15, "往返后 jitterFrames 应一致");
    console.log("测试14 通过：预设 collect/apply 往返一致");
}

/* ---------- 测试 15：预设字段缺失回退默认值 ---------- */
{
    const p = { v: 1, max: 150 }; // 只有 max，其余缺失
    const params = SCRIPTS.preset.fromPreset(p);
    assert.strictEqual(params.maxSize, 150, "有值字段应使用预设值");
    assert.strictEqual(params.normalSize, 60, "缺失字段应回退默认 normalSize=60");
    assert.strictEqual(params.gap, 140, "缺失字段应回退默认 gap=140");
    assert.strictEqual(params.fitLong, true, "缺失 fitLong 应回退 true");
    // 非法数值也回退
    const p2 = { v: 1, max: "abc", gap: -5 };
    const params2 = SCRIPTS.preset.fromPreset(p2);
    assert.strictEqual(params2.maxSize, 120, "非法 max 应回退默认 120");
    assert.strictEqual(params2.gap, 140, "非法 gap 应回退默认 140");
    // 空预设
    const params3 = SCRIPTS.preset.fromPreset(null);
    assert.strictEqual(params3.maxSize, 120, "空预设应全部回退默认");
    console.log("测试15 通过：预设缺失/非法字段回退默认");
}

/* ---------- 测试 16：预设与生成集成 ---------- */
{
    function makeUI() {
        return {
            eMax: { text: "150" }, eNormal: { text: "70" }, eGap: { text: "200" },
            eMaxOp: { text: "90" }, eNormalOp: { text: "40" },
            eScroll: { text: "36" }, ePause: { text: "12" },
            fitChk: { value: true }
        };
    }
    const ui = makeUI();
    const comp = makeComp();
    const params = SCRIPTS.preset.collectParams(ui);
    const r = SCRIPTS.core.buildLyrics(comp, null, params, "甲\n乙\n丙\n丁\n戊");
    assert.strictEqual(r.count, 5, "预设参数应能正常生成");
    assert.strictEqual(r.layers[0].text.sourceText.value.fontSize, 70, "基础字号应取预设 normalSize=70");
    assert.deepStrictEqual(r.offsets, [-400, -200, 0, 200, 400], "间距应取预设 gap=200");
    // 参数控件初值应取预设值
    const fx = {};
    r.controller.effects.list.forEach(f => { fx[f.name] = f.slider.val; });
    assert.strictEqual(fx["最大透明度"], 90, "maxOpacity 控件初值应取预设 90");
    assert.strictEqual(fx["普通透明度"], 40, "normalOpacity 控件初值应取预设 40");
    // 透明度表达式应引用控件（AE 内改控件即实时生效）
    assert.ok(r.layers[0].transform.opacity.expression.indexOf('c.effect("最大透明度")(1)') >= 0, "透明度表达式应引用 maxOpacity 控件");
    assert.ok(r.layers[0].transform.opacity.expression.indexOf('c.effect("普通透明度")(1)') >= 0, "透明度表达式应引用 normalOpacity 控件");
    console.log("测试16 通过：预设参数与生成集成");
}

/* ---------- 测试 17：句数多时渐变范围不爆炸（放大效果不摊薄） ---------- */
{
    // 20 句歌词：旧逻辑 maxDist=(20-1)/2*140=1330 → 相邻句缩放差异被摊薄到看不出
    // 新逻辑：固定 max(1080*0.25, 140*1.5)=270，相邻句差异明显
    const lines = [];
    for (let i = 1; i <= 20; i++) { lines.push("第" + i + "句歌词"); }
    const src = makeTextLayer(lines.join("\n"), 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.strictEqual(r.count, 20, "应拆出 20 句");
    assert.strictEqual(r.maxDist, 270, "20 句时渐变范围仍应为固定值 270（而非 1330）");
    const expr = r.layers[0].transform.scale.expression;
    assert.ok(expr.indexOf('c.effect("最大字号")(1)') >= 0, "缩放表达式应引用 maxSize 控件");
    assert.ok(expr.indexOf("ratio = maxS / norS;") >= 0, "短句无放大上限（直接用控件比例）");
    assert.ok(expr.indexOf("ease(dd, 0, maxDist") >= 0, "应使用 ease 缓动");
    console.log("测试17 通过：句数多时渐变范围固定，放大效果清晰");
}

/* ---------- 测试 18：合成已有更长内容时不截断时长 ---------- */
{
    const src = makeTextLayer("一\n二\n三", 60);
    const comp = makeComp();
    comp.duration = 100; // 模拟已有 100 秒内容（如背景音乐）
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.strictEqual(comp.duration, 100, "合成时长不应被缩短");
    const endFrames = (3 - 1) * 50 + 20 + 30; // (n-1)*50 + 20 + 1s
    assert.strictEqual(r.endFrames, endFrames, "endFrames 计算仍正确");
    console.log("测试18 通过：合成已有更长内容时不截断");
}

/* ---------- 测试 19：清理不误删用户自定义 Lyrics_* 图层 ---------- */
{
    const userLayer = { name: "Lyrics_Backup", removed: false, remove() { this.removed = true; } };
    const arr = [userLayer];
    const src = makeTextLayer("甲\n乙\n丙", 60);
    const comp = makeComp(arr);
    SCRIPTS.core.buildLyrics(comp, src, baseParams);
    assert.ok(!userLayer.removed, "用户自定义 Lyrics_Backup 不应被清理");
    console.log("测试19 通过：清理精确匹配，不误删用户 Lyrics_* 图层");
}

/* ---------- 测试 20：参数变化只改控件初值，表达式始终引用控件（AE 内实时生效） ---------- */
{
    const comp = makeComp();
    const params = {
        maxSize: 150, normalSize: 70, gap: 200,
        maxOpacity: 90, normalOpacity: 40,
        scrollFrames: 40, pauseFrames: 15, fitLong: true
    };
    const r = SCRIPTS.core.buildLyrics(comp, null, params, "甲\n乙\n丙\n丁\n戊");
    const fx = {};
    r.controller.effects.list.forEach(f => { fx[f.name] = f.slider.val; });
    assert.strictEqual(fx["间距"], 200, "gap 控件初值应取参数 200");
    assert.strictEqual(fx["滚动帧数"], 40, "scrollFrames 控件初值应取参数 40");
    assert.strictEqual(fx["停顿帧数"], 15, "pauseFrames 控件初值应取参数 15");
    // 表达式不烘焙数值、只引用控件 → 在 AE 里改控件值即实时生效，无需重新生成
    assert.ok(r.layers[0].transform.position.expression.indexOf('c.effect("间距")(1)') >= 0, "位置表达式应引用 gap 控件而非常量");
    assert.ok(r.layers[0].transform.position.expression.indexOf("offsetY = (0 - 2)") >= 0, "offsetY 公式应含句索引");
    console.log("测试20 通过：参数控件化，AE 内改控件即实时生效");
}

/* ---------- 测试 21：滚动由位置表达式驱动（无关键帧，节奏引用控件） ---------- */
{
    const src = makeTextLayer("一\n二\n三\n四\n五", 60);
    const comp = makeComp();
    const r = SCRIPTS.core.buildLyrics(comp, src, baseParams);
    const expr = r.controller.transform.position.expression;
    assert.ok(expr.indexOf("n = 5;") >= 0, "滚动表达式应烘焙句数 n=5");
    assert.ok(expr.indexOf('effect("滚动帧数")(1)') >= 0, "应引用 scrollFrames 控件");
    assert.ok(expr.indexOf('effect("停顿帧数")(1)') >= 0, "应引用 pauseFrames 控件");
    assert.ok(expr.indexOf("linear(lt") >= 0, "滚动段应使用 linear 插值");
    assert.strictEqual(r.controller.transform.position.keys.length, 0, "不应有关键帧（表达式驱动）");
    console.log("测试21 通过：滚动表达式驱动（无关键帧）");
}

/* ---------- 测试 22：停顿随机（每句停顿 = 停顿帧数 ± 抖动帧数，seedRandom 确定性随机） ---------- */
{
    const src = makeTextLayer("一\n二\n三\n四\n五", 60);
    const comp = makeComp();
    const params = Object.assign({}, baseParams, { pauseRandom: true, jitterFrames: 8 });
    const r = SCRIPTS.core.buildLyrics(comp, src, params);
    const fx = {};
    r.controller.effects.list.forEach(f => { fx[f.name] = f.slider.val; });
    assert.strictEqual(fx["停顿随机"], 1, "停顿随机 开关应为 1（开启）");
    assert.strictEqual(fx["抖动帧数"], 8, "抖动帧数 控件初值 8");
    const expr = r.controller.transform.position.expression;
    assert.ok(expr.indexOf('effect("停顿随机")(1)') >= 0, "表达式应引用 停顿随机 开关");
    assert.ok(expr.indexOf('effect("抖动帧数")(1)') >= 0, "表达式应引用 抖动帧数 控件");
    assert.ok(expr.indexOf("jit * (random() * 2 - 1)") >= 0, "抖动应为 ±抖动帧数 的随机值");
    assert.ok(expr.indexOf("seedRandom(idx + 11000, true)") >= 0, "应使用确定性随机种子（每句固定不闪烁）");
    assert.ok(expr.indexOf("times.push") >= 0, "应累积每句开始时间（停顿不同 → 周期不同）");
    console.log("测试22 通过：停顿随机（±抖动，seedRandom 确定性随机）");
}

console.log("\n全部 22 组测试通过 ✔");
