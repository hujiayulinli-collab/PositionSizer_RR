// Production editor event handling, with inert MT5 chart/save boundaries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = name => readFileSync(new URL('../mt5/' + name, import.meta.url), 'utf8');
const source = read('RRTargetEditor.mqh'), lines = read('RRTargetLines.mqh');
function extract(name) {
    const m = new RegExp('(?:void|bool) ' + name + '\\(([^)]*)\\)\\s*\\{').exec(source);
    assert.ok(m, name);
    let end = m.index + m[0].length, start = end, depth = 1;
    for (; depth; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
    const parts = m[1].split(',').map(x => x.trim());
    const args = parts.map(x => x.replace(/^(?:const\s+)?\w+\s+&?/, ''));
    const refs = parts.filter(x => !x.startsWith('const ') && x.includes('&')).map(x => x.match(/&(\w+)/)[1]);
    let b = source.slice(start, end - 1)
        .replace(/RRDragSnapshot (\w+) = ([^;]+);/g, 'let $1 = structuredClone($2);')
        .replace('RREditSnapshot = item;', 'RREditSnapshot = structuredClone(item);')
        .replace(/\b(?:string|long|int|bool|ushort|double|datetime)\s+(?=\w+\s*(?:=|;))/g, 'let ')
        .replace(/\((?:int|long|double)\)/g, '')
        .replace('StringTrimLeft(text);', 'text = text.trimStart();')
        .replace('StringTrimRight(text);', 'text = text.trimEnd();');
    for (const ref of refs) b = b.replace(new RegExp('(?<![.\\w])' + ref + '\\b', 'g'), ref + '.value');
    b = b.replace('RROpenTargetEditor(sparam, message.value)', 'RROpenTargetEditor(sparam, message)')
        .replace('RRParseEditorPrice(ObjectGetString(ChartID(), RREditPrefix + "Price", OBJPROP_TEXT), requested)',
            'RRParseEditorPrice(ObjectGetString(ChartID(), RREditPrefix + "Price", OBJPROP_TEXT), {get value(){return requested;},set value(v){requested=v;}})')
        .replace('RRSaveDraggedTarget(RREditSnapshot, requested, legal_price, message.value)',
            'RRSaveDraggedTarget(RREditSnapshot, requested, {get value(){return legal_price;},set value(v){legal_price=v;}}, message)')
        .replace('RREditPointPrice(lparam, dparam, price)',
            'RREditPointPrice(lparam, dparam, {get value(){return price;},set value(v){price=v;}})')
        .replace('ChartXYToTimePrice(ChartID(), x, y, window, time, price.value)',
            'ChartXYToTimePrice(ChartID(), x, y, v=>{window=v;}, v=>{time=v;}, price)');
    return `function ${name}(${args}) {${b}}`;
}
function fixture() {
    const c = {
        structuredClone, RREditPrefix: 'PSRR_Edit_', RREditActive: false, RREditPicking: false, RREditSnapshot: {},
        RR_Enable: true, RRDragLines: [], objects: new Map(), calls: [], width: 1000, height: 600, dpi: 96,
        RREditScale: 1, RREditDpiScale: 1, RREditChartWidth: 0,
        TerminalInfoInteger: () => c.dpi, MathRound: Math.round, MathMin: Math.min, MathMax: Math.max, MathFloor: Math.floor,
        ChartID: () => 1, SymbolInfoInteger: () => 2, ChartGetInteger: (_, key) => key === 'CHART_WIDTH_IN_PIXELS' ? c.width : c.height,
        StringLen: x => x.length, StringFind: (x, y) => x.indexOf(y), StringSubstr: (x, i, n) => n === undefined ? x.slice(i) : x.slice(i, i + n),
        StringGetCharacter: (x, i) => x.charCodeAt(i), StringToDouble: Number, MathIsValidNumber: Number.isFinite,
        DoubleToString: (x, d) => x.toFixed(d), StringFormat: (s, ...a) => s + a.join(' '),
        ObjectCreate: (_, name, type, w, time, price) => { if (c.failCreate || c.objects.has(name)) return false; c.objects.set(name, { type, OBJPROP_PRICE: price }); return true; },
        ObjectFind: (_, name) => c.objects.has(name) ? 0 : -1,
        ObjectSetInteger: (_, name, key, value) => { if (c.objects.has(name)) c.objects.get(name)[key] = value; },
        ObjectSetDouble: (_, name, key, value) => { if (c.objects.has(name)) c.objects.get(name)[key] = value; },
        ObjectSetString: (_, name, key, value) => { if (c.objects.has(name)) c.objects.get(name)[key] = value; },
        ObjectGetString: (_, name, key) => c.objects.get(name)?.[key] ?? '',
        ObjectsDeleteAll: (_, prefix) => { for (const name of c.objects.keys()) if (name.startsWith(prefix)) c.objects.delete(name); },
        RRFindDragLine: name => c.RRDragLines.findIndex(x => x.name === name),
        ChartXYToTimePrice: (_, x, y, window, time, price) => { window(c.subwindow ?? 0); time(100); price.value = c.pickPrice ?? (120 - y / 10); return !c.xyFail; },
        RRSaveDraggedTarget: (snapshot, price, legal, message) => {
            c.calls.push({ snapshot: structuredClone(snapshot), price });
            if (c.failSave) { message.value = '状态变化，未保存'; return false; }
            legal.value = Math.round(price * 100) / 100; return true;
        },
    };
    for (const name of [...new Set(source.match(/\b(?:OBJ[A-Z_]*|CHARTEVENT_[A-Z_]+|CHART_[A-Z_]+|SYMBOL_DIGITS|TERMINAL_SCREEN_DPI|CORNER_[A-Z_]+|ANCHOR_[A-Z_]+|STYLE_DOT|clr[A-Za-z]+)\b/g))]) c[name] = name;
    vm.createContext(c);
    for (const name of ['RRTargetEditorActive', 'RRCloseTargetEditor', 'RREditPlaceObject', 'RRResizeTargetEditor', 'RREditObject', 'RREditStatus', 'RROpenTargetEditor', 'RRParseEditorPrice', 'RREditHitBox', 'RREditPointPrice', 'RREditPreviewPrice', 'RRHandleTargetEditorEvent']) vm.runInContext(extract(name), c);
    c.add = (owner = 42, parent = false, editable = true) => {
        const name = `PSRR_Targets_${parent ? 'Parent_' : ''}${owner}_0_Line`;
        c.RRDragLines.push({ name, owner, parent, editable, symbol: 'TEST', index: 0, price: 106, stage: 0, plan_checksum: 123, editing: false });
        c.objects.set(name, { OBJPROP_PRICE: 106 }); c.objects.set(name.replace('_Line', '_Label'), {});
        return name.replace('_Line', '_Label');
    };
    c.event = (id, sparam = '', x = 0, y = 0) => {
        const message = { value: '' }, owner = { value: 0 }, parent = { value: false }, saved = { value: false };
        const consumed = c.RRHandleTargetEditorEvent(id, x, y, sparam, message, owner, parent, saved);
        return { consumed, message: message.value, owner: owner.value, parent: parent.value, saved: saved.value };
    };
    c.click = name => c.event(c.CHARTEVENT_OBJECT_CLICK, name);
    c.type = text => { c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT = text; };
    return c;
}
let count = 0;
function check(name, fn) { fn(); console.log(`PASS ${name}`); count++; }
check('caption click opens one editor without changing TP or sending a save', () => {
    const c = fixture(), label = c.add(); assert.equal(c.click(label).consumed, true);
    assert.equal(c.RREditActive, true); assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '106.00');
    assert.equal(c.calls.length, 0); assert.equal(c.objects.get(label.replace('_Label', '_Line')).OBJPROP_PRICE, 106);
});
check('exact price save preserves frozen parent identity and closes only editor objects', () => {
    const c = fixture(), label = c.add(9001, true); c.objects.set('unrelated', {}); c.click(label); c.type('107.13');
    const r = c.click('PSRR_Edit_Save'); assert.equal(r.saved, true); assert.equal(r.owner, 9001); assert.equal(r.parent, true);
    assert.equal(c.calls[0].price, 107.13); assert.equal(c.calls[0].snapshot.plan_checksum, 123);
    assert.equal(c.RREditActive, false); assert.ok(c.objects.has('unrelated')); assert.ok(c.objects.has(label));
    assert.equal(c.objects.get(label.replace('_Label', '_Line')).OBJPROP_PRICE, 107.13);
});
check('redrawn snapshot cannot replace the editor generation or typed price', () => {
    const c = fixture(); c.click(c.add()); c.type('107.77'); c.RRDragLines[0].stage = 2; c.RRDragLines[0].plan_checksum = 999;
    c.event(c.CHARTEVENT_CHART_CHANGE); c.event(c.CHARTEVENT_MOUSE_MOVE, '', 50, 50);
    assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '107.77'); c.click('PSRR_Edit_Save');
    assert.equal(c.calls[0].snapshot.stage, 0); assert.equal(c.calls[0].snapshot.plan_checksum, 123);
});
check('rejected save keeps saved line unchanged and leaves price available for correction', () => {
    const c = fixture(), label = c.add(); c.click(label); c.type('107.13'); c.failSave = true;
    const r = c.click('PSRR_Edit_Save'); assert.equal(r.saved, false); assert.match(r.message, /未保存/);
    assert.equal(c.RREditActive, true); assert.equal(c.objects.get(label.replace('_Label', '_Line')).OBJPROP_PRICE, 106);
    assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '107.13');
    assert.match(c.objects.get('PSRR_Edit_Status').OBJPROP_TEXT, /状态变化/);
    assert.match(c.objects.get('PSRR_Edit_Status').OBJPROP_TOOLTIP, /状态变化/);
});
check('pick mouse move is preview only; one click fills price, explicit save persists', () => {
    const c = fixture(); c.click(c.add()); c.click('PSRR_Edit_Pick'); c.pickPrice = 107.13;
    c.event(c.CHARTEVENT_MOUSE_MOVE, '', 100, 200); assert.equal(c.calls.length, 0);
    assert.equal(c.objects.get('PSRR_Edit_Preview').OBJPROP_PRICE, 107.13);
    assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '106.00');
    c.event(c.CHARTEVENT_CLICK, '', 100, 200); assert.equal(c.RREditPicking, false);
    assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '107.13'); assert.equal(c.calls.length, 0);
    assert.equal(c.click('PSRR_Edit_Save').saved, true); assert.equal(c.calls.length, 1);
});
check('pick ignores the editor hitbox, invalid coordinates, indicator subwindows and failed conversion', () => {
    const c = fixture(); c.click(c.add()); c.click('PSRR_Edit_Pick');
    for (const [x, y] of [[800, 80], [-1, 100], [1000, 100], [100, -1], [100, 600]]) c.event(c.CHARTEVENT_CLICK, '', x, y);
    c.subwindow = 1; c.event(c.CHARTEVENT_CLICK, '', 100, 200); c.subwindow = 0; c.xyFail = true; c.event(c.CHARTEVENT_CLICK, '', 100, 200);
    assert.equal(c.RREditPicking, true); assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '106.00'); assert.equal(c.calls.length, 0);
});
check('escape and cancel discard preview without a save and remove only owned editor objects', () => {
    for (const cancel of ['escape', 'button']) {
        const c = fixture(), label = c.add(); c.click(label); c.click('PSRR_Edit_Pick'); c.event(c.CHARTEVENT_MOUSE_MOVE, '', 100, 200);
        if (cancel === 'escape') c.event(c.CHARTEVENT_KEYDOWN, '', 27); else c.click('PSRR_Edit_Cancel');
        assert.equal(c.RREditActive, false); assert.equal(c.RREditPicking, false); assert.equal(c.calls.length, 0);
        assert.ok(c.objects.has(label)); assert.ok(![...c.objects.keys()].some(x => x.startsWith('PSRR_Edit_')));
    }
});
check('typing and edit completion are consumed so calculator trade hotkeys do not run', () => {
    const c = fixture(); c.click(c.add()); assert.equal(c.event(c.CHARTEVENT_KEYDOWN, '', 84).consumed, true);
    assert.equal(c.event(c.CHARTEVENT_OBJECT_ENDEDIT, 'PSRR_Edit_Price').consumed, true); assert.equal(c.calls.length, 0);
});
check('raw mouse over editor is consumed before covered calculator controls can respond', () => {
    const c = fixture(); c.click(c.add());
    assert.equal(c.event(c.CHARTEVENT_MOUSE_MOVE, '1', 800, 80).consumed, true);
    assert.equal(c.event(c.CHARTEVENT_MOUSE_MOVE, '1', 100, 200).consumed, true);
    assert.equal(c.event(c.CHARTEVENT_CLICK, '', 100, 200).consumed, true);
    assert.equal(c.click('CalculatorTradeButton').consumed, true);
    assert.equal(c.event(c.CHARTEVENT_CHART_CHANGE).consumed, false);
    assert.equal(c.calls.length, 0);
});
check('price parser rejects malformed or nonpositive values without calling save', () => {
    for (const input of ['', ' ', '0', '-1', '+1', 'NaN', 'Infinity', '1,234', '1.2.3', '1foo', '1e4', '.']) {
        const c = fixture(); c.click(c.add()); c.type(input); const r = c.click('PSRR_Edit_Save');
        assert.equal(r.saved, false, input); assert.equal(c.calls.length, 0, input); assert.match(r.message, /有效/);
    }
});
check('positive plain decimal and surrounding whitespace are supported', () => {
    for (const input of [' 107.13 ', '.5', '107', '107.']) {
        const c = fixture(); c.click(c.add()); c.type(input); assert.equal(c.click('PSRR_Edit_Save').saved, true, input);
    }
});
check('preview, noneditable, missing or unknown label never opens an editor', () => {
    for (const mode of ['preview', 'noneditable', 'missing', 'unknown', 'disabled']) {
        const c = fixture(); let label = c.add(42, false, mode !== 'noneditable');
        if (mode === 'preview') label = 'PSRR_Targets_Preview_0_Label';
        if (mode === 'missing') c.objects.delete(label.replace('_Label', '_Line'));
        if (mode === 'unknown') label = 'other_Label';
        if (mode === 'disabled') c.RR_Enable = false;
        c.click(label); assert.equal(c.RREditActive, false, mode); assert.equal(c.calls.length, 0);
    }
});
check('opening a different target discards unsaved input and binds only the new owner', () => {
    const c = fixture(), first = c.add(42), second = c.add(43); c.click(first); c.type('107.77'); c.click(second);
    assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '106.00'); c.type('108'); c.click('PSRR_Edit_Save');
    assert.equal(c.calls.length, 1); assert.equal(c.calls[0].snapshot.owner, 43);
});
check('failed UI creation leaves no active or partial editor', () => {
    const c = fixture(); const label = c.add(); c.failCreate = true; const r = c.click(label);
    assert.equal(c.RREditActive, false); assert.match(r.message, /创建失败/); assert.equal(c.calls.length, 0);
    assert.ok(![...c.objects.keys()].some(x => x.startsWith('PSRR_Edit_')));
});
check('100 125 150 and 200 percent DPI keep all controls inside wide and 320 pixel charts', () => {
    for (const dpi of [96, 120, 144, 192]) for (const width of [1000, 320]) {
        const c = fixture(); c.dpi = dpi; c.width = width; c.click(c.add());
        const back = c.objects.get('PSRR_Edit_Back');
        assert.ok(back.OBJPROP_XDISTANCE > 0); assert.ok(back.OBJPROP_XDISTANCE + back.OBJPROP_XSIZE < width);
        for (const suffix of ['Price', 'Pick', 'Save', 'Cancel']) {
            const o = c.objects.get('PSRR_Edit_' + suffix);
            assert.equal(o.OBJPROP_CORNER, 'CORNER_LEFT_UPPER');
            assert.ok(o.OBJPROP_XDISTANCE >= back.OBJPROP_XDISTANCE);
            assert.ok(o.OBJPROP_XDISTANCE + o.OBJPROP_XSIZE <= back.OBJPROP_XDISTANCE + back.OBJPROP_XSIZE);
            assert.ok(o.OBJPROP_YDISTANCE >= back.OBJPROP_YDISTANCE);
            assert.ok(o.OBJPROP_YDISTANCE + o.OBJPROP_YSIZE <= back.OBJPROP_YDISTANCE + back.OBJPROP_YSIZE);
            assert.ok(o.OBJPROP_FONTSIZE * dpi / 72 < o.OBJPROP_YSIZE, `${dpi} DPI ${width}px ${suffix}`);
            assert.ok(c.RREditHitBox(o.OBJPROP_XDISTANCE + 1, o.OBJPROP_YDISTANCE + 1));
        }
        assert.equal(c.RREditScale, Math.min(dpi / 96, width / 420));
    }
});
check('short chart caps editor height and invalid screen DPI falls back to normal scale', () => {
    for (const dpi of [0, 96, 192]) {
        const c = fixture(); c.dpi = dpi; c.height = 90; c.click(c.add());
        const back = c.objects.get('PSRR_Edit_Back');
        assert.ok(back.OBJPROP_YDISTANCE > 0);
        assert.ok(back.OBJPROP_YDISTANCE + back.OBJPROP_YSIZE < c.height);
        assert.equal(c.RREditScale, 90 / 155);
        const right = back.OBJPROP_XDISTANCE + back.OBJPROP_XSIZE;
        const bottom = back.OBJPROP_YDISTANCE + back.OBJPROP_YSIZE;
        assert.ok(c.RREditHitBox(right, bottom)); assert.equal(c.RREditHitBox(right + 1, bottom), false);
    }
});
check('resize updates geometry and hit testing without changing typed price frozen snapshot or pick state', () => {
    const c = fixture(); c.click(c.add(9001, true)); c.type('107.135'); c.click('PSRR_Edit_Pick');
    const snapshot = structuredClone(c.RREditSnapshot); c.RRDragLines[0].plan_checksum = 999;
    c.width = 320; c.height = 120; c.dpi = 192;
    assert.equal(c.event(c.CHARTEVENT_CHART_CHANGE).consumed, false);
    assert.equal(c.objects.get('PSRR_Edit_Price').OBJPROP_TEXT, '107.135');
    assert.deepEqual(c.RREditSnapshot, snapshot); assert.equal(c.RREditPicking, true);
    const o = c.objects.get('PSRR_Edit_Price'), x = o.OBJPROP_XDISTANCE + 1, y = o.OBJPROP_YDISTANCE + 1;
    assert.ok(x >= 0 && y >= 0); assert.equal(c.RREditPointPrice(x, y, { value: 0 }), false);
    assert.equal(c.calls.length, 0);
});
check('independent editor does not trade or change native trade-level chart settings', () => {
    assert.doesNotMatch(source, /\b(?:OrderSend|OrderCheck|PositionClose|ChartSetInteger)\s*\(/);
    assert.match(source, /RRSaveDraggedTarget\(RREditSnapshot/);
    assert.match(lines, /\[改价\]/); assert.match(lines, /RRPlaceTargetLabel\(y - 12, height\)/);
});
console.log(`${count} target editor checks passed.`);
