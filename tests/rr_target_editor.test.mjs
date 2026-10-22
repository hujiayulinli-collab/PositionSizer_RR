// The custom price-entry window was retired. Execute its replacement cleanup
// and target rendering bodies; the separate drag suite exercises saving.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL('../mt5/' + name, import.meta.url), 'utf8');
const lines = read('RRTargetLines.mqh'), entry = read('Position Sizer RR.mq5');
function extract(source, name) {
    const signature = new RegExp(`(?:void|bool|int) ${name}\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(signature, name);
    const start = signature.index + signature[0].length;
    let end = start, depth = 1;
    for (; depth; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
    const args = signature[1].split(',').filter(a => a.trim()).map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    let body = source.slice(start, end - 1)
        .replace(/\b(?:const\s+)?(?:string|long|ulong|uint|int|double|bool|datetime)\s+(?=\w+\s*(?:=|;))/g, 'let ')
        .replace(/\((?:int|long)\)/g, '')
        .replace('ChartTimePriceToXY(chart, 0, time, price, x, y)', 'ChartTimePriceToXY(chart, 0, time, price, v => { x = v.x; y = v.y; })');
    return `function ${name}(${args.join(',')}) {${body}}`;
}
function fixture() {
    const c = {
        objects: new Map(), removed: [], RRLinePrefix: 'PSRR_Targets_',
        RRLastLineRefresh: 999, RRLabelRows: [100, 118], snapshots: ['old'],
        ChartID: () => 1, _Symbol: 'TEST', _Period: 5,
        ArrayResize: (a, n) => { a.length = n; },
        RRResetDragLines: () => { c.snapshots.length = 0; },
        ObjectsDeleteAll: (_, prefix) => { for (const name of c.objects.keys()) if (name.startsWith(prefix)) { c.objects.delete(name); c.removed.push(name); } },
        ObjectFind: (_, name) => c.objects.has(name) ? 0 : -1,
        ObjectCreate: (_, name, type, sub, time, price) => { c.objects.set(name, { OBJPROP_TYPE: type, OBJPROP_PRICE: price }); return true; },
        ObjectGetInteger: (_, name, key) => c.objects.get(name)?.[key] ?? 0,
        ObjectSetInteger: (_, name, key, value) => { c.objects.get(name)[key] = value; return true; },
        ObjectSetDouble: (_, name, key, value) => { c.objects.get(name)[key] = value; return true; },
        ObjectSetString: (_, name, key, value) => { c.objects.get(name)[key] = value; return true; },
        RRTargetLineEditing: () => false, RRTargetLinePriority: () => 20,
        RRPlaceTargetLabel: desired => desired, iTime: () => 123,
        ChartGetInteger: () => 650,
        ChartTimePriceToXY: (_, sub, time, price, output) => { output({ x: 100, y: 200 }); return true; },
    };
    for (const constant of [...new Set(lines.match(/\b(?:OBJ[A-Z_]*|CHART_[A-Z_]+|CORNER_[A-Z_]+|ANCHOR_[A-Z_]+|STYLE_[A-Z_]+)\b/g))]) c[constant] = constant;
    vm.createContext(c);
    for (const name of ['RRDrawTarget', 'RRDeleteTargetLines']) vm.runInContext(extract(lines, name), c);
    c.draw = (editable = true) => c.RRDrawTarget('PSRR_Targets_42_0', 106, '#42 | TP1 2R | 106.00 | 平 50% + BE', 'gold', false, 0, editable);
    return c;
}
let count = 0;
function check(name, fn) { fn(); console.log('PASS ' + name); count++; }

check('custom editor module and entry hooks are absent', () => {
    assert.equal(existsSync(new URL('../mt5/RRTargetEditor.mqh', import.meta.url)), false);
    assert.doesNotMatch(entry, /RRTargetEditor|RRCloseTargetEditor|RRHandleTargetEditorEvent|RREdit/);
    assert.doesNotMatch(lines, /\[改价\]|输入精确价格|图上选价/);
});
check('upgrade cleanup removes old editor, preview and caption objects without touching other chart objects', () => {
    const c = fixture();
    for (const name of ['PSRR_Edit_Back', 'PSRR_Edit_Price', 'PSRR_Edit_Preview', 'PSRR_Edit_Save', 'PSRR_Targets_42_0_Line', 'PSRR_Targets_42_0_Label', 'PSRR_EntryLine', 'user_line', 'PSRR_EditUnrelated']) c.objects.set(name, {});
    c.RRDeleteTargetLines();
    assert.deepEqual([...c.objects.keys()], ['PSRR_EntryLine', 'user_line', 'PSRR_EditUnrelated']);
    assert.equal(c.removed.length, 6);
    assert.equal(c.RRLastLineRefresh, 0); assert.equal(c.RRLabelRows.length, 0); assert.equal(c.snapshots.length, 0);
});
check('empty or repeated cleanup remains harmless', () => {
    const c = fixture(); c.RRDeleteTargetLines(); c.RRDeleteTargetLines();
    assert.equal(c.objects.size, 0); assert.equal(c.removed.length, 0);
});
check('both initialization and unloading run the minimal cleanup', () => {
    const init = entry.slice(entry.indexOf('int OnInit()'), entry.indexOf('void OnDeinit('));
    const deinit = entry.slice(entry.indexOf('void OnDeinit('), entry.indexOf('void OnTick()'));
    assert.ok(init.indexOf('RRDeleteTargetLines();') >= 0);
    assert.ok(init.indexOf('RRDeleteTargetLines();') < init.indexOf('RRValidateInputs()'));
    assert.ok(deinit.indexOf('RRDeleteTargetLines();') < deinit.indexOf('RRShutdown();'));
});
check('active TP remains draggable and its label is descriptive without a competing click priority', () => {
    const c = fixture(); c.draw();
    const line = c.objects.get('PSRR_Targets_42_0_Line'), label = c.objects.get('PSRR_Targets_42_0_Label');
    assert.equal(line.OBJPROP_SELECTABLE, true); assert.equal(line.OBJPROP_SELECTED, false);
    assert.equal(line.OBJPROP_ZORDER, 20); assert.equal(line.OBJPROP_BACK, false);
    assert.equal(label.OBJPROP_SELECTABLE, false); assert.equal(label.OBJPROP_ZORDER, 0);
    assert.equal(label.OBJPROP_TEXT, line.OBJPROP_TEXT);
    assert.match(line.OBJPROP_TOOLTIP, /双击选中TP线后拖动，松开即保存/);
    assert.match(label.OBJPROP_TOOLTIP, /双击选中TP线后拖动，松开即保存/);
    assert.equal(label.OBJPROP_YDISTANCE, 188);
    assert.equal(c.objects.size, 2);
});
check('redraw replaces any old clickable caption without opening a window or selecting a target', () => {
    const c = fixture(); c.draw();
    c.objects.get('PSRR_Targets_42_0_Label').OBJPROP_TEXT += '  [改价]';
    c.objects.get('PSRR_Targets_42_0_Label').OBJPROP_ZORDER = 120;
    c.draw();
    assert.doesNotMatch(c.objects.get('PSRR_Targets_42_0_Label').OBJPROP_TEXT, /改价/);
    assert.equal(c.objects.get('PSRR_Targets_42_0_Label').OBJPROP_ZORDER, 0);
    assert.equal(c.objects.get('PSRR_Targets_42_0_Line').OBJPROP_SELECTED, false);
    assert.equal(c.objects.size, 2);
});
check('read-only targets do not invite edits or inherit an old selected state', () => {
    const c = fixture(); c.draw(); c.objects.get('PSRR_Targets_42_0_Line').OBJPROP_SELECTED = true; c.draw(false);
    const line = c.objects.get('PSRR_Targets_42_0_Line');
    assert.equal(line.OBJPROP_SELECTABLE, false); assert.equal(line.OBJPROP_SELECTED, false);
    assert.match(line.OBJPROP_TOOLTIP, /不可拖动/);
    assert.doesNotMatch(c.objects.get('PSRR_Targets_42_0_Label').OBJPROP_TOOLTIP, /拖动|改价/);
});
check('drag routing and panel focus remain, with no editor mouse or keyboard interception', () => {
    const events = entry.slice(entry.indexOf('void OnChartEvent('), entry.indexOf('void OnTimer()'));
    assert.match(events, /id == CHARTEVENT_OBJECT_DRAG \|\| id == CHARTEVENT_OBJECT_CHANGE/);
    assert.ok(events.indexOf('RRHandleTargetDrag') < events.indexOf('if (id == CHARTEVENT_MOUSE_MOVE)'));
    assert.match(events, /ExtDialog\.NotifyRRTargetMoved/);
    assert.match(events, /RRDispatchPanelEvent\(id, lparam, dparam, sparam\)/);
    const dispatch = entry.slice(entry.indexOf('void RRDispatchPanelEvent('), entry.indexOf('void RRRefreshViews(', entry.indexOf('void RRDispatchPanelEvent(')));
    assert.match(dispatch, /ExtDialog\.FocusRRTargetLines\(\)/);
    assert.doesNotMatch(events, /RREdit|RRHandleTargetEditorEvent/);
});
console.log(`${count} target editor removal checks passed.`);
