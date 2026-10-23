// Execute production panel-scale code with an in-memory MT5 file/UI boundary.
// No terminal, sound, trade, or real settings file is touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRPanelScale.mqh', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../mt5/Position Sizer.mqh', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../mt5/Position Sizer RR.mq5', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../mt5/RRPanelScaleUI.mqh', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../mt5/RRPanelScaleRuntime.mqh', import.meta.url), 'utf8');
function extract(content, name) {
    const signature = new RegExp(`(?:void|bool|int|string|CWnd\\s*\\*)\\s*(?:CPositionSizeCalculator::)?${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(content);
    assert.ok(signature, `Missing production function ${name}`);
    const start = signature.index + signature[0].length;
    let depth = 1, end = start;
    for (; depth && end < content.length; end++) { if (content[end] === '{') depth++; if (content[end] === '}') depth--; }
    assert.equal(depth, 0, name);
    const args = signature[1].split(',').filter(Boolean).map(arg => arg.trim().split(/\s+/).at(-1).replace(/^[*&]/, ''));
    return { args, body: content.slice(start, end - 1) };
}
function adapt(body) {
    return body.replace('uint pixels[], width = 0, height = 0;', 'let pixels = [], width = 0, height = 0;')
        .replace('uint scaled[];', 'let scaled = [];')
        .replace('ResourceReadImage(original, pixels, width, height)', 'ResourceReadImage(original, pixels, dimensions => { width = dimensions.width; height = dimensions.height; })')
        .replace('(int)(y * height / scaled_height)', 'Math.trunc(y * height / scaled_height)')
        .replace('(int)(x * width / scaled_width)', 'Math.trunc(x * width / scaled_width)')
        .replace(/\b(?:const\s+)?(?:bool|int|long|ulong|double|string)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\b(?:bool|int|long|ulong|double|string)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\((?:int|long|double)\)/g, '')
        .replace(/dynamic_cast<([A-Za-z]+)\s*\*>\(([^)]+)\)/g, 'asType($2, "$1")')
        .replace(/\b(?:CPositionSizeCalculator|CStringForList|CWndContainer|CWnd|CEdit|CCheckBox|CHorizontalRadioGroup)\s*\*\s*/g, 'let ')
        .replace(/\bdelete (\w+);/g, '__delete($1);')
        .replace(/new CPositionSizeCalculator\s*;/g, 'new CPositionSizeCalculator();')
        .replace('Settings saved_settings = sets;', 'let saved_settings = structuredClone(sets);')
        .replace(/sets = saved_settings;/g, 'sets = structuredClone(saved_settings);')
        .replace(/(m_rr_state|m_rr_loaded_plan|m_guard_draft|m_guard_saved) = source\.\1;/g, '$1 = structuredClone(source.$1);')
        .replace(/CAppDialog::/g, '__base.');
}
function install(s, content, names) {
    for (const name of names) {
        const { args, body } = extract(content, name);
        vm.runInContext(`function ${name}(${args.join(',')}) {${adapt(body)}}`, s);
    }
}
function fixture() {
    const files = new Map(), handles = new Map(), events = [];
    const s = {
        RRPanelScalePercent: 100, RRPanelScalePending: 0, RRPanelScaleIdBase: 0, RRPanelScaleBuilding: false,
        MathRound: Math.round, MathMax: Math.max, IntegerToString: String,
        StringToInteger: text => parseInt(text, 10) || 0, ChartID: () => s.chart,
        FILE_READ: 1, FILE_WRITE: 2, FILE_TXT: 4, FILE_ANSI: 8, FILE_REWRITE: 16, INVALID_HANDLE: -1,
        chart: 11, failOpen: false, failWrite: false, failMove: false,
        FolderCreate: path => { events.push(['mkdir', path]); return true; },
        FileOpen(path, flags) {
            events.push(['open', path, flags]);
            if (s.failOpen || (flags & 1 && !files.has(path))) return -1;
            if (flags & 2) files.set(path, []);
            const id = handles.size + 1; handles.set(id, { path, flags, offset: 0 }); return id;
        },
        FileReadString(id) { const h = handles.get(id); return files.get(h.path)[h.offset++] || ''; },
        FileWrite(id, text) { if (s.failWrite) return 0; files.get(handles.get(id).path).push(text); return text.length + 2; },
        FileFlush: id => events.push(['flush', id]), FileClose: id => events.push(['close', id]),
        FileMove(from, origin, to, flags) {
            events.push(['move', from, to, flags]); if (s.failMove) return false;
            files.set(to, files.get(from)); files.delete(from); return true;
        },
    };
    vm.createContext(s);
    install(s, source, ['RRPanelScaleValid', 'RRPanelScalePixels', 'RRPanelScaleFont', 'RRPanelScaleFileName',
        'RRPanelScaleLoad', 'RRPanelScaleSave', 'RRPanelScaleRequest']);
    return { s, files, events };
}
let count = 0;
function check(name, action) { action(); console.log(`ok ${++count} - ${name}`); }

check('only six supported scale presets are accepted', () => {
    const { s } = fixture();
    for (let percent = 0; percent <= 250; percent++)
        assert.equal(s.RRPanelScaleValid(percent), [75, 100, 125, 150, 175, 200].includes(percent), String(percent));
});
check('scale metrics derive from base pixels and fonts without cumulative rounding drift', () => {
    const { s } = fixture();
    for (const percent of [75, 100, 125, 150, 175, 200, 125, 75, 100]) {
        s.RRPanelScalePercent = percent;
        for (const pixels of [2, 3, 16, 18, 20, 22, 100]) assert.equal(s.RRPanelScalePixels(pixels), Math.round(pixels * percent / 100));
        for (const points of [5, 7, 8, 9, 10]) assert.equal(s.RRPanelScaleFont(points), Math.max(6, Math.round(points * percent / 100)));
    }
});
check('a scale click queues a request without saving files or applying trading operations', () => {
    const { s, events } = fixture();
    s.RRPanelScaleRequest(125); assert.equal(s.RRPanelScalePending, 125); assert.equal(s.RRPanelScalePercent, 100);
    assert.deepEqual(events, []);
});
check('invalid and reentrant scale requests cannot replace a pending choice', () => {
    const { s } = fixture(); s.RRPanelScaleRequest(150);
    for (const value of [0, 74, 101, 201, 100]) { s.RRPanelScaleRequest(value); assert.equal(s.RRPanelScalePending, 150); }
    s.RRPanelScaleBuilding = true; s.RRPanelScaleRequest(200); assert.equal(s.RRPanelScalePending, 150);
});
check('missing preference resets to 100 percent and drops obsolete requests', () => {
    const { s } = fixture(); s.RRPanelScalePercent = 200; s.RRPanelScalePending = 75;
    s.RRPanelScaleLoad(); assert.equal(s.RRPanelScalePercent, 100); assert.equal(s.RRPanelScalePending, 0);
});
check('saved chart preference roundtrips all supported presets without account settings writes', () => {
    const { s, files, events } = fixture();
    for (const value of [75, 100, 125, 150, 175, 200]) {
        s.RRPanelScalePercent = value; assert.equal(s.RRPanelScaleSave(), true);
        assert.deepEqual(files.get(s.RRPanelScaleFileName()), ['PSRR_PANEL_SCALE_V1', String(value)]);
        s.RRPanelScalePercent = 100; s.RRPanelScaleLoad(); assert.equal(s.RRPanelScalePercent, value);
    }
    assert.ok(events.filter(e => e[0] === 'open').every(e => /^PSRR_Settings\\PanelScale_11\.txt(?:\.tmp)?$/.test(e[1])));
});
check('layout scale is isolated per chart and is not an account-wide shared preference', () => {
    const { s } = fixture(); s.RRPanelScalePercent = 150; s.RRPanelScaleSave();
    s.chart = 12; s.RRPanelScaleLoad(); assert.equal(s.RRPanelScalePercent, 100);
    s.RRPanelScalePercent = 75; s.RRPanelScaleSave();
    s.chart = 11; s.RRPanelScaleLoad(); assert.equal(s.RRPanelScalePercent, 150);
});
check('malformed preference is rejected without accepting partial or arbitrary scales', () => {
    const { s, files } = fixture();
    for (const value of ['', '075', '125abc', '125.0', '-100', '50', '225', '110', 'NaN']) {
        files.set(s.RRPanelScaleFileName(), ['PSRR_PANEL_SCALE_V1', value]); s.RRPanelScaleLoad();
        assert.equal(s.RRPanelScalePercent, 100, value);
    }
    files.set(s.RRPanelScaleFileName(), ['PSRR_PANEL_SCALE_V0', '150']); s.RRPanelScaleLoad();
    assert.equal(s.RRPanelScalePercent, 100);
});
check('failed preference open write or replace preserves the last confirmed preference', () => {
    for (const fault of ['failOpen', 'failWrite', 'failMove']) {
        const { s, files } = fixture(); s.RRPanelScalePercent = 125; s.RRPanelScaleSave();
        s.RRPanelScalePercent = 200; s[fault] = true; assert.equal(s.RRPanelScaleSave(), false, fault);
        assert.deepEqual(files.get(s.RRPanelScaleFileName()), ['PSRR_PANEL_SCALE_V1', '125']);
        s[fault] = false; s.RRPanelScaleLoad(); assert.equal(s.RRPanelScalePercent, 125);
    }
});
check('unsupported in-memory scale is never persisted', () => {
    const { s, events } = fixture(); s.RRPanelScalePercent = 110;
    assert.equal(s.RRPanelScaleSave(), false); assert.deepEqual(events, []);
});
check('native combo and list cached hit geometry uses the same scale as rendering', () => {
    for (const metric of ['COMBO_ITEM_HEIGHT', 'LIST_ITEM_HEIGHT', 'SCROLL_SIZE', 'DIALOG_CAPTION_HEIGHT'])
        assert.match(source, new RegExp(`#define CONTROLS_${metric} \\(RRPanelScalePixels\\(\\d+\\)\\)`));
    assert.match(source, /#define CONTROLS_FONT_SIZE \(RRPanelScaleFont\(10\)\)/);
    assert.match(panel, /m_DPIScale = screen_dpi \/ 96\.0 \* RRPanelScalePercent \/ 100\.0/);
});

function transactionFixture(fault = '') {
    const { s, files, events } = fixture();
    const trading = { entryQueue: { parent: 987, pending: 123, nextChild: 2 }, exits: { goal: 6, filled: 3 }, dailyLocked: true };
    Object.assign(s, {
        RRPanelInitSucceeded: true, POINTER_DYNAMIC: 1, NULL: null, Version: 'test', structuredClone,
        sets: { SelectedTab: 5, IsPanelMinimized: false, Risk: 500, StopLossLevel: 90 },
        CheckPointer: value => value && !value.deleted && !value.invalid ? 1 : 0,
        RRPanelScaleReservePrefix: () => { events.push('reserve'); return fault !== 'reserve'; },
        RRDeletePanelObjects: (_, prefix) => events.push(`cleanup:${prefix}`),
        RRApplyPanelTheme: target => events.push(`theme:${target.label}`),
        GetTickCount64: (() => { let now = 0; return () => now += 10; })(),
        ChartRedraw: () => events.push('redraw'), Print: text => events.push(['print', text]), PrintFormat: (text, ...args) => events.push(['format', text, ...args]),
        __delete: value => { assert.equal(value.destroyed, true); value.deleted = true; events.push(`delete:${value.label}`); },
    });
    class Dialog {
        constructor(label = 'new') { this.label = label; this.invalid = fault === 'allocate' && label === 'new'; this.id = 1; }
        Left() { return 37; } Top() { return 51; } Name() { return this.label; }
        PrepareScaleDraft() { events.push('capture'); this.draft = '7..'; }
        Create() { events.push('create'); s.sets.Risk = 999; return fault !== 'create'; }
        CopyScaleDraftFrom(previous) { events.push('restore'); this.draft = previous.draft; }
        RunForScale() { events.push('run'); this.id = 10001; return fault !== 'run'; }
        Destroy() { this.destroyed = true; events.push(`destroy:${this.label}`); }
        FocusRRTargetLines() { events.push(`focus:${this.label}`); }
        MoveOutsideTradeButton() { events.push('outside-trade-button'); }
        IniFileSave() { events.push('layout-save'); }
    }
    s.CPositionSizeCalculator = Dialog; s.ExtDialog = new Dialog('old');
    const old = s.ExtDialog;
    install(s, runtime, ['RRApplyPanelScale']);
    return { s, files, events, old, trading };
}
check('deferred replacement commits only after create restore and native Run succeed', () => {
    const { s, events, old, trading } = transactionFixture();
    const snapshot = structuredClone(trading);
    s.RRPanelScaleRequest(150); s.RRApplyPanelScale();
    assert.equal(s.RRPanelScalePercent, 150); assert.equal(s.RRPanelScalePending, 0); assert.equal(s.RRPanelScaleBuilding, false);
    assert.notEqual(s.ExtDialog, old); assert.equal(s.ExtDialog.draft, '7..'); assert.equal(old.deleted, true);
    assert.ok(events.indexOf('run') < events.indexOf('destroy:old'));
    assert.ok(events.indexOf('delete:old') < events.indexOf('layout-save'));
    assert.equal(s.sets.Risk, 500); assert.deepEqual(trading, snapshot);
});
check('successful scale emits one phase timing summary without account or position data', () => {
    const { s, events } = transactionFixture();
    s.RRPanelScaleRequest(125); s.RRApplyPanelScale();
    const summaries = events.filter(event => Array.isArray(event) && event[0] === 'format');
    assert.equal(summaries.length, 1);
    const [kind, format, before, after, total, create, restore, destroy, persist] = summaries[0];
    assert.match(format, /PS RR UI.*创建.*恢复.*清理.*保存与绘制/);
    assert.equal(before, 100); assert.equal(after, 125);
    for (const duration of [total, create, restore, destroy, persist]) assert.ok(duration > 0);
    assert.doesNotMatch(format, /Account|Position|ticket|账户|订单号/);
});
check('allocation prefix Create and Run failures retain the live old panel and settings', () => {
    for (const fault of ['allocate', 'reserve', 'create', 'run']) {
        const { s, events, old, files } = transactionFixture(fault);
        s.RRPanelScaleRequest(175); s.RRApplyPanelScale();
        assert.equal(s.ExtDialog, old, fault); assert.equal(old.deleted, undefined, fault); assert.equal(old.draft, '7..');
        assert.equal(s.RRPanelScalePercent, 100); assert.equal(s.RRPanelScaleBuilding, false); assert.equal(s.sets.Risk, 500);
        assert.equal(files.size, 0); assert.ok(events.includes('focus:old')); assert.ok(!events.includes('layout-save'));
        if (fault !== 'allocate') assert.ok(events.includes('delete:new'));
    }
});
check('inactive initialization invalid panel and reentrant callbacks leave request pending and are inert', () => {
    for (const fault of ['initialization', 'panel', 'building']) {
        const { s, events } = transactionFixture(); s.RRPanelScalePending = 125;
        if (fault === 'initialization') s.RRPanelInitSucceeded = false;
        if (fault === 'panel') s.ExtDialog.invalid = true;
        if (fault === 'building') s.RRPanelScaleBuilding = true;
        s.RRApplyPanelScale(); assert.equal(s.RRPanelScalePending, 125); assert.deepEqual(events, []);
    }
});
check('failed preference save keeps successful new panel and reports persistence failure', () => {
    const { s, events, old } = transactionFixture(); s.failMove = true;
    s.RRPanelScaleRequest(75); s.RRApplyPanelScale();
    assert.equal(s.RRPanelScalePercent, 75); assert.notEqual(s.ExtDialog, old);
    assert.ok(events.some(e => Array.isArray(e) && e[0] === 'print' && /保存失败/.test(e[1])));
});
check('repeated increases decreases and reset never cancel queue or reinitialize the EA', () => {
    const { s, trading } = transactionFixture(), snapshot = structuredClone(trading);
    for (const percent of [125, 150, 200, 75, 100]) { s.RRPanelScaleRequest(percent); s.RRApplyPanelScale(); assert.equal(s.RRPanelScalePercent, percent); }
    assert.deepEqual(trading, snapshot);
    assert.doesNotMatch(runtime + ui, /\b(?:OnInit|OnDeinit|RBCancelEntry|RCInit|RBInit|RRInit|RGManage|OrderSend|ExpertRemove|PlaySound)\s*\(/);
    assert.ok(extract(entry, 'OnTimer').body.includes('RRApplyPanelScale();'));
    assert.ok(!extract(entry, 'OnChartEvent').body.includes('RRApplyPanelScale();'));
});
check('native Run failure cannot consume IDs and each successful replacement uses a fresh event range', () => {
    const { s } = fixture(); const ids = [];
    Object.assign(s, { CONTROLS_MAXIMUM_ID: 10000, Id: value => ids.push(value), __base: { Run: () => false } });
    install(s, ui, ['RunForScale']);
    assert.equal(s.RunForScale(), false); assert.equal(s.RRPanelScaleIdBase, 0); assert.deepEqual(ids, []);
    s.__base.Run = () => true;
    assert.equal(s.RunForScale(), true); assert.equal(s.RunForScale(), true); assert.deepEqual(ids, [10000, 20000]);
    assert.doesNotMatch(extract(ui, 'RunForScale').body, /SeekAndDestroyDuplicatePanels/);
});

class Control {
    constructor(name, type = 'CEdit', children = []) { this.name = name; this.type = type; this.children = children; this.text = ''; this.checked = false; this.value = 0; this.color = 'black'; this.rect = [0, 0, 10, 10]; }
    Name() { return this.name; } ControlsTotal() { return this.children.length; } Control(i) { return this.children[i]; }
    Text(value) { if (arguments.length) this.text = value; return this.text; }
    PropFlags(value) { if (arguments.length) this.flags = value; return this.flags || 0; }
    ReadOnly(value) { if (arguments.length) this.readonly = value; return !!this.readonly; }
    TextAlign(value) { if (arguments.length) this.align = value; return this.align || 0; }
    IsEnabled() { return !this.disabled; } Enable() { this.disabled = false; }
    Checked(value) { if (arguments.length) this.checked = value; return this.checked; }
    Value(value) { if (arguments.length) this.value = value; return this.value; }
    Color(value) { if (arguments.length) this.color = value; return this.color; }
    FontSize(value) { this.font = value; } Disable() { this.disabled = true; }
    Left() { return this.rect[0]; } Top() { return this.rect[1]; } Bottom() { return this.rect[3]; }
    Move(x, y) { this.rect = [x, y, x + this.rect[2] - this.rect[0], y + this.rect[3] - this.rect[1]]; }
}
function copyFixture() {
    const { s, events } = fixture();
    Object.assign(s, { NULL: null, structuredClone, StringLen: text => text.length, StringSubstr: (text, offset) => text.slice(offset),
        StringFind: (text, part) => text.indexOf(part), asType: (value, type) => value && value.type === type ? value : null });
    install(s, ui, ['RRScaleFindControl', 'RRScaleCopyControls']);
    return { s, events };
}
check('recursive native control copy preserves incomplete text checkbox and radio values by stable name', () => {
    const { s } = copyFixture();
    const old = new Control('old', 'CWndContainer', [new Control('oldRisk'), new Control('oldBE', 'CCheckBox'),
        new Control('oldScope', 'CHorizontalRadioGroup'), new Control('oldNested', 'CWndContainer', [new Control('oldNestedInput')])]);
    const fresh = new Control('new', 'CWndContainer', [new Control('newScope', 'CHorizontalRadioGroup'), new Control('newRisk'),
        new Control('newBE', 'CCheckBox'), new Control('newNested', 'CWndContainer', [new Control('newNestedInput')])]);
    old.children[0].Text('7..'); old.children[0].PropFlags(8); old.children[1].Checked(true); old.children[2].Value(2); old.children[3].children[0].Text('37.25');
    old.children[0].ReadOnly(true); old.children[0].Disable(); old.children[0].TextAlign(2);
    s.RRScaleCopyControls(old, fresh, 'old', 'new');
    assert.equal(fresh.children[1].Text(), '7..'); assert.equal(fresh.children[1].PropFlags(), 8); assert.equal(fresh.children[2].Checked(), true);
    assert.equal(fresh.children[1].ReadOnly(), true); assert.equal(fresh.children[1].IsEnabled(), false); assert.equal(fresh.children[1].TextAlign(), 2);
    assert.equal(fresh.children[0].Value(), 2); assert.equal(fresh.children[3].children[0].Text(), '37.25');
    assert.notEqual(old.children[0], fresh.children[1]);
});
check('scale label and preset buttons never inherit the previous scale caption', () => {
    const { s } = copyFixture();
    const old = new Control('old', 'CWndContainer', [new Control('oldm_BtnScaleReset'), new Control('oldm_LblScale')]);
    const fresh = new Control('new', 'CWndContainer', [new Control('newm_BtnScaleReset'), new Control('newm_LblScale')]);
    old.children[0].Text('100%'); fresh.children[0].Text('150%'); fresh.children[1].Text('面板缩放');
    s.RRScaleCopyControls(old, fresh, 'old', 'new');
    assert.equal(fresh.children[0].Text(), '150%'); assert.equal(fresh.children[1].Text(), '面板缩放');
});
check('matching panel hierarchies copy in a linear number of stable-name inspections', () => {
    const { s } = copyFixture(); let reads = 0;
    class CountedControl extends Control { Name() { reads++; return super.Name(); } }
    const size = 400;
    const old = new CountedControl('old', 'CWndContainer', Array.from({ length: size }, (_, i) => new CountedControl(`oldInput${i}`)));
    const fresh = new CountedControl('new', 'CWndContainer', Array.from({ length: size }, (_, i) => new CountedControl(`newInput${i}`)));
    for (let i = 0; i < size; i++) old.children[i].Text(`${i}..`);
    s.RRScaleCopyControls(old, fresh, 'old', 'new');
    assert.ok(reads < size * 6, `Expected linear traversal, got ${reads} name inspections`);
    for (let i = 0; i < size; i++) assert.equal(fresh.children[i].Text(), `${i}..`);
});
check('missing optional peers never redirect raw input into an unrelated destination control', () => {
    const { s } = copyFixture();
    const old = new Control('old', 'CWndContainer', [new Control('oldMissing'), new Control('oldRisk')]);
    const fresh = new Control('new', 'CWndContainer', [new Control('newRisk')]);
    old.children[0].Text('unrelated'); old.children[1].Text('123.');
    s.RRScaleCopyControls(old, fresh, 'old', 'new');
    assert.equal(fresh.children[0].Text(), '123.');
});
check('prepare captures only visible draft pages and closes popup without selecting or saving', () => {
    const { s, events } = fixture();
    Object.assign(s, { m_rr_visible: true, m_guard_visible: false, CaptureRRPage: () => events.push('rr'),
        CaptureGuardDraft: () => events.push('guard'), m_CmbRRPosition: { CloseDropDown: () => events.push('close') } });
    install(s, ui, ['PrepareScaleDraft']); s.PrepareScaleDraft(); assert.deepEqual(events, ['rr', 'close']);
    events.length = 0; s.m_rr_visible = false; s.m_guard_visible = true; s.PrepareScaleDraft(); assert.deepEqual(events, ['guard', 'close']);
});

check('actual snapshot restores selected owner page exact RR metadata guard revisions and unfinished controls', () => {
    const { s, events } = copyFixture();
    const old = new Control('old', 'CWndContainer', [new Control('oldm_EdtRRClosePercent'), new Control('oldm_EdtBatchLots')]);
    old.rect = [37, 51, 387, 651]; old.children[0].Text('37.25'); old.children[1].Text('3..'); old.IsMinimized = () => true;
    const fresh = [new Control('newm_EdtRRClosePercent'), new Control('newm_EdtBatchLots')];
    Object.assign(s, { RR_MAX_TARGETS: 20, GetPointer: value => value, type: 'CWndContainer', Name: () => 'new',
        ControlsTotal: () => fresh.length, Control: i => fresh[i],
        RenderRRPage: () => events.push('render-rr'), UpdateRRModeLabels: () => events.push('rr-labels'),
        RefreshRRPositionChoices: () => events.push(['choices', s.m_CmbRRPosition.value]), RenderGuardDraft: () => events.push('render-guard'),
        MoveAndResize: () => events.push('layout'), Move: (x, y) => events.push(['move', x, y]),
        KeepScaleControlsReachable: () => events.push('reachable'), FixatePanelPosition: () => events.push('fixate'), Minimize: () => events.push('minimize') });
    const copied = [...extract(ui, 'CopyScaleDraftFrom').body.matchAll(/\b(m_\w+|ATR_handle) = source\.\1;/g)].map(m => m[1]);
    for (const name of copied) old[name] = `saved:${name}`;
    Object.assign(old, { ATR_handle: 44, m_rr_page: 2, m_rr_count: 13, m_rr_position_id: 123, m_rr_group_id: 987,
        m_rr_expected_stage: 2, m_rr_live_stage: 3, m_rr_stale: true, m_rr_readonly: true, m_rr_dirty: true,
        m_rr_expected_checksum: 444, m_rr_state: { stage: 2, risk: 0.0004, pending: 55 }, m_rr_loaded_plan: { targets: [{ multiple: 2.5555555555 }] },
        m_trade_batch_page: true, m_batch_feedback: '原队列仍在执行', m_batch_feedback_error: true,
        m_guard_draft: { single: '50..', daily: '2900', sound: true }, m_guard_saved: { single: '500', daily: '2900', sound: false },
        m_guard_dirty: true, m_guard_stale: true, m_guard_revision: 19, m_guard_account_key: 'Demo|123' });
    for (const name of ['m_rr_multiple', 'm_rr_percent', 'm_rr_original_multiple', 'm_rr_source_index', 'm_rr_be']) {
        old[name] = Array.from({ length: 20 }, (_, i) => name.endsWith('_be') ? i % 2 : `${name}:${i}`); s[name] = Array(20).fill('default');
    }
    old.m_rr_multiple[12] = '7..'; old.m_rr_original_multiple[7] = '2.5555555555';
    old.m_CmbRRPosition = { Select: () => 'NZDUSD parent 987' };
    s.m_CmbRRPosition = { items: [], value: 0, ItemAdd(text, value) { this.items.push({ text, value }); }, SelectByValue(value) { this.value = value; } };
    for (const name of ['m_LblRRStatus', 'm_LblRRStatus2', 'm_LblGuardStatus', 'm_LblGuardStatus2']) {
        old[name] = new Control(`old${name}`); old[name].Text(`original:${name}`); old[name].Color('error'); s[name] = new Control(`new${name}`);
    }
    install(s, ui, ['CopyScaleDraftFrom']); s.CopyScaleDraftFrom(old);
    for (const name of ['ATR_handle', 'm_rr_page', 'm_rr_count', 'm_rr_position_id', 'm_rr_group_id', 'm_rr_expected_checksum', 'm_rr_stale',
        'm_rr_readonly', 'm_rr_dirty', 'm_trade_batch_page', 'm_batch_feedback', 'm_guard_revision', 'm_guard_account_key']) assert.equal(s[name], old[name], name);
    assert.deepEqual(s.m_rr_multiple, old.m_rr_multiple); assert.deepEqual(s.m_rr_original_multiple, old.m_rr_original_multiple);
    assert.deepEqual(s.m_guard_draft, old.m_guard_draft); assert.notEqual(s.m_guard_draft, old.m_guard_draft);
    assert.deepEqual(s.m_rr_state, old.m_rr_state); assert.notEqual(s.m_rr_state, old.m_rr_state);
    assert.equal(s.m_rr_position_choices, ''); assert.equal(fresh[0].Text(), '37.25'); assert.equal(fresh[1].Text(), '3..');
    assert.equal(s.m_LblRRStatus.Color(), 'error'); assert.equal(s.remember_left, 37); assert.equal(s.remember_top, 51);
    assert.equal(events.at(-1), 'minimize');
    assert.ok(events.some(e => Array.isArray(e) && e[0] === 'choices' && e[1] === -987));
    old.m_rr_group_id = 0; old.m_rr_position_id = 123; events.length = 0; s.CopyScaleDraftFrom(old);
    assert.ok(events.some(e => Array.isArray(e) && e[0] === 'choices' && e[1] === 123));
});
check('scale controls and all seven content lists use disjoint top rows at every preset', () => {
    for (const percent of [75, 100, 125, 150, 175, 200]) {
        const { s } = fixture(), scale = percent / 100, controls = [];
        class List {
            constructor(nodes) { this.nodes = nodes; this.index = 0; }
            GetFirstNode() { this.index = 0; return this.nodes[0] || null; }
            GetNextNode() { return this.nodes[++this.index] || null; }
        }
        Object.assign(s, { RRPanelScalePercent: percent, NULL: null, m_DPIScale: scale,
            first_column_start: Math.round(7 * scale), element_height: Math.round(20 * scale), PersistentList: new List([]) });
        const lists = ['Main', 'Risk', 'Margin', 'Swaps', 'Trading', 'RR', 'Guard'].map(tab => {
            const c = new Control(tab); c.rect = [7, Math.round(42 * scale), 100, Math.round(62 * scale)];
            s[`${tab}TabList`] = new List([{ Obj: c }]); return c;
        });
        for (const name of ['m_LblScale', 'm_BtnScaleDown', 'm_BtnScaleReset', 'm_BtnScaleUp']) s[name] = new Control(name);
        for (const type of ['Label', 'Button']) s[`${type}Create`] = (list, control, x1, y1, x2, y2, name, text) => {
            control.rect = [x1, y1, x2, y2]; control.Text(text); controls.push(control); return true;
        };
        install(s, ui, ['RRScaleShiftList', 'CreatePanelScaleControls']); assert.equal(s.CreatePanelScaleControls(), true);
        controls.sort((a, b) => a.Left() - b.Left());
        for (let i = 1; i < controls.length; i++) assert.ok(controls[i - 1].rect[2] < controls[i].rect[0]);
        assert.ok(controls.at(-1).rect[2] <= s.first_column_start + Math.round(307 * scale));
        assert.ok(lists.every(c => c.Top() > s.m_BtnScaleUp.Bottom()));
        assert.equal(s.m_BtnScaleReset.Text(), `${percent}%`);
        assert.equal(!!s.m_BtnScaleDown.disabled, percent === 75); assert.equal(!!s.m_BtnScaleUp.disabled, percent === 200);
    }
});
check('oversized panel keeps scale row reachable without silently changing the requested percentage', () => {
    const { s, events } = fixture(); let x = 1200, y = 900;
    Object.assign(s, { m_controls_ready: true, CHART_WIDTH_IN_PIXELS: 1, CHART_HEIGHT_IN_PIXELS: 2,
        ChartGetInteger: (_, field) => field === 1 ? 800 : 600, MathMin: Math.min,
        Left: () => x, Top: () => y, Width: () => 700, m_BtnScaleUp: { Bottom: () => y + 110 },
        Move: (left, top) => { x = left; y = top; }, FixatePanelPosition: () => events.push('fixate') });
    install(s, ui, ['KeepScaleControlsReachable']); s.RRPanelScalePercent = 200; s.KeepScaleControlsReachable();
    assert.equal(x, 100); assert.equal(y, 482); assert.equal(s.RRPanelScalePercent, 200);
    assert.equal(s.remember_left, 100); assert.equal(s.remember_top, 482);
});
check('dialog prefix selection skips occupied names and reseeds the reserved native create value', () => {
    const { s } = fixture(); let seed = 0, calls = 0, totalCalls = 0;
    Object.assign(s, { GetTickCount: () => 100, MathSrand: value => seed = value, rand: () => seed % 32768,
        IntegerToString: (value, length = 0) => String(value).padStart(length, '0'), StringFind: (text, part) => text.indexOf(part),
        ObjectsTotal: () => { totalCalls++; return 2; }, ObjectName: (_, i) => { calls++; return ['00100Back', '00100m_BtnTrade'][i]; } });
    install(s, runtime, ['RRPanelScaleReservePrefix']);
    assert.equal(s.RRPanelScaleReservePrefix(), true); assert.equal(seed, 8019); assert.ok(calls >= 3);
    assert.equal(totalCalls, 1, 'Native object-count lookup must not run once per chart object');
});
check('exhausted native prefix attempts fail without touching existing chart objects', () => {
    const { s } = fixture(); let seed = 0, attempts = 0;
    Object.assign(s, { GetTickCount: () => 100, MathSrand: value => { seed = value; attempts++; }, rand: () => seed % 32768,
        IntegerToString: (value, length = 0) => String(value).padStart(length, '0'), StringFind: (text, part) => text.indexOf(part),
        ObjectsTotal: () => 1, ObjectName: () => `${String(seed % 32768).padStart(5, '0')}Back` });
    install(s, runtime, ['RRPanelScaleReservePrefix']);
    assert.equal(s.RRPanelScaleReservePrefix(), false); assert.equal(attempts, 100);
});
function bitmapFixture() {
    const { s } = fixture(), resources = new Map();
    Object.assign(s, { RRScaleBitmapKeys: [], RRScaleBitmapNames: [], COLOR_FORMAT_ARGB_NORMALIZE: 1,
        ArraySize: array => array.length, ArrayResize: (array, size) => { array.length = size; return size; },
        ResourceReadImage: (name, pixels, dimensions) => {
            if (name !== 'test') return false;
            pixels.push(1, 2, 3, 4); dimensions({ width: 2, height: 2 }); return true;
        },
        ResourceCreate: (name, pixels, width, height) => { resources.set(name, { pixels: [...pixels], width, height }); return !s.failResource; },
    });
    install(s, ui, ['RRScaleBitmap']); return { s, resources };
}
check('bitmap scaling preserves corners with integer nearest-neighbour sampling and caches each preset', () => {
    const { s, resources } = bitmapFixture(); s.RRPanelScalePercent = 200;
    const name = s.RRScaleBitmap('test'), resized = resources.get(name);
    assert.equal(resized.width, 4); assert.equal(resized.height, 4);
    assert.deepEqual(resized.pixels, [1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
    assert.equal(s.RRScaleBitmap('test'), name); assert.equal(resources.size, 1);
    s.RRPanelScalePercent = 150; assert.notEqual(s.RRScaleBitmap('test'), name); assert.equal(resources.size, 2);
    s.RRPanelScalePercent = 200; assert.equal(s.RRScaleBitmap('test'), name); assert.equal(resources.size, 2);
});
check('100 percent missing images and resource creation failure retain the original native bitmap', () => {
    const { s, resources } = bitmapFixture(); assert.equal(s.RRScaleBitmap('test'), 'test'); assert.equal(resources.size, 0);
    s.RRPanelScalePercent = 75; assert.equal(s.RRScaleBitmap('missing'), 'missing');
    s.failResource = true; assert.equal(s.RRScaleBitmap('test'), 'test'); assert.equal(s.RRScaleBitmapKeys.length, 0);
});
check('actual timer services due trade management before scaling and scaling cannot be starved by either throttle', () => {
    for (const scenario of [
        { name: 'active batch and view throttled', active: true, management: 2050, view: 2090, due: true },
        { name: 'idle management due and view throttled', active: false, management: 1000, view: 2090, due: true },
        { name: 'idle management throttled', active: false, management: 2050, view: 2090, due: false },
    ]) {
        const events = [], s = {
            RRPanelInitSucceeded: true, RRLastTimerManagement: scenario.management, RRLastTimerView: scenario.view,
            LastRecalculationTime: 2090, RGEntryBlocked: false, sets: { MagicNumber: 123 },
            GetTickCount64: () => 2100, RBEntryActive: () => scenario.active,
            RGManage: magic => { assert.equal(magic, 123); events.push('risk'); return true; },
            RMManage: () => events.push('manual exits'), RBManageGroups: () => events.push('group exits'),
            RBManageEntry: () => events.push('batch entry'), RCTradeLeave: () => events.push('release entry lock'),
            RCManageReverse: () => events.push('reverse entry'), RRManage: () => events.push('staged exits'),
            RDFlushAlerts: () => events.push('deal alerts'), RRApplyPanelScale: () => events.push('scale'),
            RRRefreshViews: () => events.push('view'),
            ExtDialog: { CheckAndRestoreLines: () => events.push('lines'), RefreshValues: () => events.push('values') },
            ChartRedraw: () => events.push('redraw'),
            RRReportSlowUI: () => {},
        };
        vm.createContext(s); install(s, entry, ['OnTimer']); s.OnTimer();
        assert.deepEqual(events, scenario.due
            ? ['risk', 'manual exits', 'group exits', 'batch entry', 'release entry lock', 'reverse entry', 'staged exits', 'deal alerts', 'scale']
            : ['scale'], scenario.name);
        assert.equal(s.RRLastTimerManagement, scenario.due ? 2100 : scenario.management, scenario.name);
        assert.equal(s.RRLastTimerView, scenario.view, scenario.name);
    }
});

console.log(`RR panel scale: ${count} production-boundary tests passed.`);
