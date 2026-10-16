// Execute the production draft editor methods against a small UI boundary.
// No orders, files in the MT5 data directory, or live terminals are touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRPlanPanel.mqh', import.meta.url), 'utf8');
function extract(name) {
    const match = new RegExp(`(?:void|bool) CPositionSizeCalculator::${name}\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Production function ${name} exists`);
    const start = match.index + match[0].length;
    let depth = 1, end = start;
    for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    const args = match[1].split(',').filter(Boolean).map(s => s.trim().split(/\s+/).at(-1).replace('&', ''));
    let body = source.slice(start, end - 1)
        .replace(/\bRRPlan (\w+);/g, 'let $1 = makePlan();')
        .replace(/\bRRState (\w+);/g, 'let $1 = {};')
        .replace(/\b(?:double|string|int|bool|ulong|uint)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:double|string|int|bool|ulong|uint)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\(int\)/g, '')
        .replace(/RRReadManagedPosition\(([^;\n]+), (state|current), ticket, error\)/g, 'RRReadManagedPosition($1, $2)')
        .replace('RRPlanParseNumber(m_EdtRRMultiple[row].Text(), multiple)', '((multiple = parseNumber(m_EdtRRMultiple[row].Text())) !== null)')
        .replace(/m_rr_state = state;/g, 'm_rr_state = structuredClone(state);')
        .replace(/m_rr_loaded_plan = plan;/g, 'm_rr_loaded_plan = structuredClone(plan);')
        .replace('(m_rr_count + 4) / 5', 'Math.floor((m_rr_count + 4) / 5)')
        .replace('(m_rr_count - 1) / 5', 'Math.floor((m_rr_count - 1) / 5)')
        .replace('RRPlanParseNumber(m_rr_multiple[m_rr_count - 1], previous_r)',
                 '(previous_r = parseNumber(m_rr_multiple[m_rr_count - 1])) !== null')
        .replace(/RRPlanParseNumber\((m_rr_(?:multiple|percent)\[i\]), draft.targets\[i\]\.(multiple|percent)\)/g,
                 'parseInto($1, draft.targets[i], "$2")');
    return `function ${name}(${args.join(',')}) { ${body} }`;
}

class Control {
    constructor() { this.text = ''; this.checked = false; this.visible = true; this.enabled = true; }
    Text(value) { if (arguments.length) this.text = value; return this.text; }
    Checked(value) { if (arguments.length) this.checked = value; return this.checked; }
    Visible(value) { this.visible = value; }
    Enable() { this.enabled = true; }
    Disable() { this.enabled = false; }
    ReadOnly(value) { this.readonly = value; }
    Color(value) { this.color = value; }
}
function parseNumber(text) {
    text = text.trim();
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
}
const makePlan = () => ({ count: 0, targets: Array.from({ length: 20 }, () => ({ multiple: 0, percent: 0, move_be: 0 })) });
function fixture(count = 2) {
    const active = makePlan(); active.count = count;
    for (let i = 0; i < count; i++) active.targets[i] = { multiple: i + 1, percent: 100 / count, move_be: i === 0 ? 1 : 0 };
    const s = {
        RRActivePlan: active, RR_MAX_TARGETS: 20, RR_Enable: true,
        m_rr_count: 0, m_rr_page: 0, m_rr_visible: true, m_minimized: false,
        m_controls_ready: true, m_rr_position_id: 0, m_rr_last_refresh: 0, m_rr_stale: false, m_rr_readonly: false, m_rr_dirty: false,
        m_rr_expected_checksum: 0, m_rr_expected_stage: 0, m_rr_live_stage: 0, m_rr_state: {}, m_rr_loaded_plan: makePlan(),
        m_rr_multiple: Array(20).fill(''), m_rr_percent: Array(20).fill(''), m_rr_be: Array(20).fill(false),
        m_LblRRPage: new Control(), m_BtnRRPrevious: new Control(), m_BtnRRNext: new Control(), m_BtnRRAdd: new Control(),
        DoubleToString: (v, digits) => v.toFixed(digits),
        CountDecimalPlaces: value => { for (let i = 0; i < 100; i++) if (Math.abs(Math.round(value * 10 ** i) / 10 ** i - value) < 1e-8) return i; return -1; },
        IntegerToString: String,
        ChartRedraw: () => {}, parseNumber, makePlan, ZeroMemory: () => {}, structuredClone,
        parseInto: (text, target, field) => { const value = parseNumber(text); if (value === null) return false; target[field] = value; return true; },
        canEdit: true, applyAllowed: true, canEditCalls: 0, applyCalls: 0, updates: [],
        SymbolForTrading: 'AUDUSD', sets: { MagicNumber: 123, TPMultiplier: 2, EntryLevel: 100, StopLossLevel: 90 },
        SYMBOL_DIGITS: 'digits', SYMBOL_TRADE_TICK_SIZE: 'tick', POSITION_VOLUME: 'volume', POSITION_TP: 'tp',
        SymbolInfoInteger: () => 2, SymbolInfoDouble: () => 0.01, MathAbs: Math.abs,
        RRTargetPrice: (direction, entry, risk, multiple) => Math.round((entry + direction * risk * multiple) * 100) / 100,
        clrDimGray: 'grey', clrDarkSlateGray: 'normal', tick: 1000, GetTickCount64: () => s.tick,
        positions: new Map(), readable: true, positionApplyCalls: [], positionApplyAllowed: true,
    };
    for (const name of ['m_LblRRNumber', 'm_LblRRPrice', 'm_EdtRRMultiple', 'm_EdtRRPercent', 'm_ChkRRBreakEven', 'm_BtnRRDelete'])
        s[name] = Array.from({ length: 5 }, () => new Control());
    for (const name of ['m_LblRRMode', 'm_LblRRInfo', 'm_LblRRBEInfo', 'm_LblRRPositionInfo', 'm_BtnRRSave', 'm_BtnRRReset']) s[name] = new Control();
    s.RRReadManagedPosition = (symbol, magic, id, state) => {
        const position = s.positions.get(id); if (!s.readable || !position) return false;
        Object.assign(state, structuredClone(position)); s.selected = position; return true;
    };
    s.RRStatePlan = (state, plan) => Object.assign(plan, structuredClone(state.plan));
    s.RRPlanChecksum = plan => JSON.stringify(plan);
    s.RRNextManagedPosition = (symbol, magic, id) => {
        const ids = [...s.positions.keys()].sort((a, b) => a - b); return ids.find(i => i > id) || 0;
    };
    s.PositionSelectByTicket = () => true;
    s.RRSelectManagedPosition = (symbol, magic, id) => s.positions.has(id);
    s.PositionGetDouble = prop => s.selected[prop];
    s.RRApplyPositionPlan = (symbol, magic, id, plan, checksum, stage) => {
        s.positionApplyCalls.push({ symbol, magic, id, plan: structuredClone(plan), checksum, stage });
        const p = s.positions.get(id);
        if (!s.positionApplyAllowed || !p || checksum !== s.RRPlanChecksum(p.plan) || stage !== p.stage) return false;
        p.plan = structuredClone(plan); return true;
    };
    s.SetRRStatus = (text, error = false) => { s.status = { text, error }; };
    s.RRPlanCanEdit = () => { s.canEditCalls++; return s.canEdit; };
    s.RRPlanApply = plan => { s.applyCalls++; if (!s.applyAllowed) return false; s.RRActivePlan = structuredClone(plan); return true; };
    s.RRPlanFinalR = () => s.RRActivePlan.targets[s.RRActivePlan.count - 1].multiple;
    s.ProcessTPChange = value => s.updates.push(['TP', value]);
    s.RefreshValues = () => s.updates.push(['refresh']);
    s.SaveSettingsOnDisk = symbol => s.updates.push(['settings', symbol]);
    const context = vm.createContext(s);
    for (const name of ['LoadRRDraft', 'FillRRDraft', 'LoadRRPositionDraft', 'UpdateRRModeLabels', 'CaptureRRPage', 'RenderRRPage', 'OnClickBtnRRAdd', 'OnClickBtnRRDelete',
                         'RefreshRRTargetPrices', 'RefreshRRLiveStatus', 'OnClickBtnRRNewPlan', 'OnClickBtnRRPosition',
                         'OnClickBtnRRPrevious', 'OnClickBtnRRNext', 'OnClickBtnRRReset', 'OnClickBtnRRSave'])
        vm.runInContext(extract(name), context);
    s.LoadRRDraft();
    return s;
}
let count = 0;
function check(name, test) { test(); count++; console.log(`ok ${count} - ${name}`); }

check('saved plan loads R, percentage and BE independently', () => {
    const s = fixture();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '2');
    assert.equal(s.m_EdtRRPercent[0].Text(), '50');
    assert.equal(s.m_ChkRRBreakEven[0].Checked(), true);
    assert.equal(s.m_ChkRRBreakEven[1].Checked(), false);
    assert.equal(s.m_BtnRRNext.enabled, false);
    assert.equal(s.m_BtnRRPrevious.enabled, false);
});
check('unused rows are hidden and visible targets stay visible', () => {
    const s = fixture();
    for (let i = 0; i < 5; i++) assert.equal(s.m_EdtRRMultiple[i].visible, i < 2);
});
check('typing and BE edits remain a draft until save', () => {
    const s = fixture(); const before = JSON.stringify(s.RRActivePlan);
    s.m_EdtRRMultiple[0].Text('1.75'); s.m_EdtRRPercent[0].Text('35'); s.m_ChkRRBreakEven[1].Checked(true);
    s.CaptureRRPage();
    assert.equal(s.m_rr_multiple[0], '1.75'); assert.equal(s.m_rr_percent[0], '35'); assert.equal(s.m_rr_be[1], true);
    assert.equal(JSON.stringify(s.RRActivePlan), before); assert.equal(s.applyCalls, 0);
});
check('adding sixth target jumps to second page and retains unfinished text', () => {
    const s = fixture(5);
    s.m_EdtRRMultiple[0].Text('1..2'); s.m_ChkRRBreakEven[4].Checked(true);
    s.OnClickBtnRRAdd();
    assert.equal(s.m_rr_page, 1); assert.equal(s.m_rr_count, 6); assert.equal(s.m_EdtRRMultiple[0].Text(), '6');
    assert.equal(s.m_EdtRRPercent[0].Text(), '0'); assert.equal(s.m_ChkRRBreakEven[0].Checked(), false);
    assert.equal(s.m_BtnRRPrevious.enabled, true); assert.equal(s.m_BtnRRNext.enabled, false);
    s.OnClickBtnRRPrevious();
    assert.equal(s.m_EdtRRMultiple[0].Text(), '1..2'); assert.equal(s.m_ChkRRBreakEven[4].Checked(), true);
});
check('pagination preserves independent BE choices and edits on each page', () => {
    const s = fixture(7);
    s.m_EdtRRPercent[4].Text('5'); s.OnClickBtnRRNext();
    s.m_EdtRRMultiple[1].Text('9.25'); s.m_ChkRRBreakEven[1].Checked(true); s.OnClickBtnRRPrevious();
    assert.equal(s.m_EdtRRPercent[4].Text(), '5'); s.OnClickBtnRRNext();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '9.25'); assert.equal(s.m_ChkRRBreakEven[1].Checked(), true);
});
check('delete shifts R, percentage and BE as one target', () => {
    const s = fixture(3);
    s.m_EdtRRPercent[2].Text('40'); s.m_ChkRRBreakEven[2].Checked(true); s.OnClickBtnRRDelete(1);
    assert.equal(s.m_rr_count, 2); assert.equal(s.m_EdtRRMultiple[1].Text(), '3');
    assert.equal(s.m_EdtRRPercent[1].Text(), '40'); assert.equal(s.m_ChkRRBreakEven[1].Checked(), true);
    assert.equal(s.RRActivePlan.count, 3);
});
check('deleting sole last-page row returns to valid previous page', () => {
    const s = fixture(6); s.OnClickBtnRRNext(); s.OnClickBtnRRDelete(0);
    assert.equal(s.m_rr_page, 0); assert.equal(s.m_rr_count, 5); assert.equal(s.m_EdtRRMultiple[4].Text(), '5');
});
check('last remaining target cannot be deleted', () => {
    const s = fixture(1); s.OnClickBtnRRDelete(0);
    assert.equal(s.m_rr_count, 1); assert.equal(s.status.error, true);
});
check('twentieth target caps additions and remains editable on page four', () => {
    const s = fixture(19); s.OnClickBtnRRAdd();
    assert.equal(s.m_rr_count, 20); assert.equal(s.m_rr_page, 3); assert.equal(s.m_BtnRRAdd.enabled, false);
    s.OnClickBtnRRAdd(); assert.equal(s.m_rr_count, 20);
});
check('reset discards unsaved values and reloads saved plan', () => {
    const s = fixture(6); s.OnClickBtnRRNext(); s.m_EdtRRMultiple[0].Text('99'); s.OnClickBtnRRAdd(); s.OnClickBtnRRReset();
    assert.equal(s.m_rr_count, 6); assert.equal(s.m_rr_page, 0); assert.equal(s.m_rr_multiple[5], '6');
});
check('malformed visible input is rejected before guard or apply', () => {
    const s = fixture(); s.m_EdtRRMultiple[1].Text('2oops'); s.OnClickBtnRRSave();
    assert.equal(s.applyCalls, 0); assert.equal(s.canEditCalls, 0); assert.equal(s.status.error, true);
    assert.match(s.status.text, /第 2 个/);
});
check('malformed input on another page is still rejected', () => {
    const s = fixture(6); s.m_EdtRRPercent[2].Text('bad'); s.OnClickBtnRRNext(); s.OnClickBtnRRSave();
    assert.equal(s.applyCalls, 0); assert.match(s.status.text, /第 3 个/);
});
check('pending-order guard blocks saving and TP updates', () => {
    const s = fixture(); const before = JSON.stringify(s.RRActivePlan); s.canEdit = false; s.OnClickBtnRRSave();
    assert.equal(s.canEditCalls, 1); assert.equal(s.applyCalls, 0); assert.equal(s.status.error, true);
    assert.equal(JSON.stringify(s.RRActivePlan), before); assert.equal(s.updates.length, 0);
});
check('plan validation or persistence failure preserves active plan', () => {
    const s = fixture(); const before = JSON.stringify(s.RRActivePlan); s.applyAllowed = false;
    s.m_EdtRRMultiple[1].Text('8'); s.OnClickBtnRRSave();
    assert.equal(s.applyCalls, 1); assert.equal(JSON.stringify(s.RRActivePlan), before); assert.equal(s.updates.length, 0);
});
check('successful save captures current controls and refreshes final TP', () => {
    const s = fixture(); s.m_EdtRRMultiple[1].Text('5'); s.m_ChkRRBreakEven[1].Checked(true); s.OnClickBtnRRSave();
    assert.equal(s.RRActivePlan.targets[1].multiple, 5); assert.equal(s.RRActivePlan.targets[1].move_be, 1);
    assert.equal(s.sets.TPMultiplier, 5); assert.deepEqual(s.updates, [['TP', false], ['refresh'], ['settings', 'AUDUSD']]);
    assert.equal(s.status.error, false);
});
check('RR disabled can save plan without modifying the regular TP', () => {
    const s = fixture(); s.RR_Enable = false; s.m_EdtRRMultiple[1].Text('5'); s.OnClickBtnRRSave();
    assert.equal(s.RRActivePlan.targets[1].multiple, 5); assert.equal(s.sets.TPMultiplier, 2);
    assert.deepEqual(s.updates, [['settings', 'AUDUSD']]); assert.match(s.status.text, /RR_Enable/);
});
check('minimized page rendering never makes target controls visible', () => {
    const s = fixture(); s.m_minimized = true; s.RenderRRPage();
    assert.equal(s.m_EdtRRMultiple.some(c => c.visible), false);
});
function addPosition(s, id = 42, overrides = {}) {
    const plan = makePlan(); plan.count = 2;
    plan.targets[0] = { multiple: 2, percent: 50, move_be: 1 };
    plan.targets[1] = { multiple: 5, percent: 50, move_be: 0 };
    const position = { version: 2, identifier: id, stage: 0, blocked: 0, direction: -1,
        entry: 4341.74, risk: 7.68, initial_volume: 0.32, volume: 0.32, tp: 4303.34, plan, ...overrides };
    s.positions.set(id, position); return position;
}
check('new-plan previews use calculator entry, while live targets use frozen actual fill', () => {
    const s = fixture(); addPosition(s);
    assert.match(s.m_LblRRPrice[0].Text(), /新仓预览 110/);
    s.OnClickBtnRRPosition();
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_BtnRRSave.Text(), '应用到该持仓');
    assert.match(s.m_LblRRPrice[0].Text(), /4326.38/); assert.match(s.m_LblRRPrice[1].Text(), /4303.34/);
    assert.match(s.m_LblRRBEInfo.Text(), /4341.74.*7.68/); assert.match(s.m_LblRRPositionInfo.Text(), /0.32.*TP已同步/);
});
check('draft target prices update without moving applied position targets', () => {
    const s = fixture(); const p = addPosition(s); s.OnClickBtnRRPosition();
    s.m_EdtRRMultiple[0].Text('3'); s.RefreshRRTargetPrices();
    assert.match(s.m_LblRRPrice[0].Text(), /草稿价 4318.7.*未应用/);
    assert.equal(p.plan.targets[0].multiple, 2); assert.equal(s.positionApplyCalls.length, 0);
});
check('live quote refresh preserves unfinished numeric text and BE edits', () => {
    const s = fixture(); const p = addPosition(s); s.OnClickBtnRRPosition();
    s.m_EdtRRMultiple[0].Text('1..'); s.m_ChkRRBreakEven[1].Checked(true); p.volume = 0.24;
    s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[0].Text(), '1..'); assert.equal(s.m_ChkRRBreakEven[1].Checked(), true);
    assert.match(s.m_LblRRPositionInfo.Text(), /0.24/); assert.match(s.m_LblRRPrice[0].Text(), /请输入有效/);
});
check('stage advancing preserves draft but locks stale save until explicit reload', () => {
    const s = fixture(); const p = addPosition(s); s.OnClickBtnRRPosition();
    s.m_EdtRRMultiple[1].Text('6'); p.stage = 1; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '6'); assert.equal(s.m_rr_stale, true);
    assert.equal(s.m_BtnRRSave.enabled, false); assert.equal(s.m_EdtRRMultiple[0].readonly, true);
    s.OnClickBtnRRSave(); assert.equal(s.positionApplyCalls.length, 0);
    s.OnClickBtnRRReset(); assert.equal(s.m_rr_stale, false); assert.equal(s.m_EdtRRMultiple[1].Text(), '5');
    assert.equal(s.m_EdtRRMultiple[0].readonly, true); assert.equal(s.m_EdtRRMultiple[1].readonly, false);
});
check('other-chart plan change marks draft stale even when execution stage stays unchanged', () => {
    const s = fixture(); const p = addPosition(s); s.OnClickBtnRRPosition();
    p.plan.targets[1].multiple = 7; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_rr_stale, true); assert.equal(s.m_EdtRRMultiple[1].Text(), '5');
    s.OnClickBtnRRReset(); assert.equal(s.m_EdtRRMultiple[1].Text(), '7');
});
check('triggered rows cannot change or be deleted and retain full numeric precision on apply', () => {
    const s = fixture(); const p = addPosition(s, 42, { stage: 1 }); p.plan.targets[0].multiple = 1.123456789123;
    s.OnClickBtnRRPosition(); s.m_EdtRRMultiple[0].Text('999'); s.m_EdtRRPercent[0].Text('0');
    s.m_ChkRRBreakEven[0].Checked(false); s.OnClickBtnRRDelete(0); s.m_EdtRRMultiple[1].Text('6'); s.OnClickBtnRRSave();
    assert.equal(p.plan.count, 2); assert.equal(p.plan.targets[0].multiple, 1.123456789123);
    assert.equal(p.plan.targets[0].percent, 50); assert.equal(p.plan.targets[0].move_be, 1);
    assert.equal(p.plan.targets[1].multiple, 6);
});
check('apply saves only the selected position and reports server TP awaiting synchronization', () => {
    const s = fixture(); const p = addPosition(s); const p2 = addPosition(s, 99); const newPlan = JSON.stringify(s.RRActivePlan);
    s.OnClickBtnRRPosition(); s.m_EdtRRMultiple[1].Text('6'); s.OnClickBtnRRSave();
    assert.equal(p.plan.targets[1].multiple, 6); assert.equal(p2.plan.targets[1].multiple, 5);
    assert.equal(JSON.stringify(s.RRActivePlan), newPlan); assert.equal(s.applyCalls, 0); assert.equal(s.updates.length, 0);
    assert.match(s.status.text, /最终 TP 待服务器同步/); assert.match(s.m_LblRRPositionInfo.Text(), /TP待同步/);
    assert.equal(s.m_rr_dirty, false);
});
check('race between last refresh and apply passes frozen checksum/stage for engine rejection', () => {
    const s = fixture(); const p = addPosition(s); s.OnClickBtnRRPosition(); const baseline = s.m_rr_expected_checksum;
    s.m_EdtRRMultiple[1].Text('6'); p.stage = 1; s.OnClickBtnRRSave();
    assert.equal(s.positionApplyCalls.length, 1); assert.equal(s.positionApplyCalls[0].stage, 0);
    assert.equal(s.positionApplyCalls[0].checksum, baseline); assert.equal(p.plan.targets[1].multiple, 5);
    assert.equal(s.status.error, true); assert.equal(s.m_EdtRRMultiple[1].Text(), '6');
});
check('legacy positions show actual targets but all mutations remain disabled', () => {
    const s = fixture(); addPosition(s, 42, { version: 1, stage: 2 }); s.OnClickBtnRRPosition();
    assert.equal(s.m_rr_readonly, true); assert.equal(s.m_rr_live_stage, 1);
    assert.match(s.m_LblRRPrice[0].Text(), /已触发/); assert.match(s.m_LblRRPrice[1].Text(), /待触发/);
    assert.equal(s.m_BtnRRSave.enabled, false); assert.equal(s.m_BtnRRAdd.enabled, false);
    s.OnClickBtnRRAdd(); s.OnClickBtnRRDelete(0); s.OnClickBtnRRSave();
    assert.equal(s.m_rr_count, 2); assert.equal(s.positionApplyCalls.length, 0);
});
check('switching modes cannot silently discard uncommitted text', () => {
    const s = fixture(); addPosition(s); addPosition(s, 99);
    s.m_EdtRRMultiple[0].Text('1.5'); s.OnClickBtnRRPosition(); assert.equal(s.m_rr_position_id, 0);
    assert.match(s.status.text, /先保存或撤销/); s.OnClickBtnRRReset(); s.OnClickBtnRRPosition();
    s.m_EdtRRMultiple[1].Text('6'); s.OnClickBtnRRNewPlan(); assert.equal(s.m_rr_position_id, 42);
    s.OnClickBtnRRPosition(); assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_EdtRRMultiple[1].Text(), '6');
});
check('position cycle isolates plans and wraps without returning to new-plan mode', () => {
    const s = fixture(); addPosition(s); const p = addPosition(s, 99); p.plan.targets[1].multiple = 8;
    s.OnClickBtnRRPosition(); assert.equal(s.m_rr_position_id, 42);
    s.OnClickBtnRRPosition(); assert.equal(s.m_rr_position_id, 99); assert.equal(s.m_EdtRRMultiple[1].Text(), '8');
    s.OnClickBtnRRPosition(); assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_EdtRRMultiple[1].Text(), '5');
    s.OnClickBtnRRNewPlan(); assert.equal(s.m_rr_position_id, 0); assert.equal(s.m_BtnRRSave.Text(), '保存新仓方案');
});
check('transient state read failure preserves live draft and allows guarded retry', () => {
    const s = fixture(); addPosition(s); s.OnClickBtnRRPosition(); s.m_EdtRRMultiple[1].Text('6');
    s.readable = false; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '6'); assert.match(s.m_LblRRPositionInfo.Text(), /草稿已保留/);
    s.readable = true; s.tick += 600; s.RefreshRRLiveStatus(); assert.equal(s.m_rr_stale, false);
});
check('legacy or blocked position remains read-only after reset', () => {
    const s = fixture(); addPosition(s, 42, { blocked: 1 }); s.OnClickBtnRRPosition(); s.OnClickBtnRRReset();
    assert.equal(s.m_rr_readonly, true); assert.equal(s.m_EdtRRMultiple[0].readonly, true);
});
check('closed position can explicitly discard its dirty draft and return to new-plan mode', () => {
    const s = fixture(); addPosition(s); s.OnClickBtnRRPosition(); s.m_EdtRRMultiple[1].Text('6'); s.CaptureRRPage();
    s.positions.delete(42); s.tick += 600; s.RefreshRRLiveStatus(); s.OnClickBtnRRReset();
    assert.equal(s.m_rr_position_id, 0); assert.equal(s.m_rr_dirty, false); assert.match(s.status.text, /持仓已关闭/);
});
check('reset with a busy journal keeps a still-open position draft intact', () => {
    const s = fixture(); addPosition(s); s.OnClickBtnRRPosition(); s.m_EdtRRMultiple[1].Text('6'); s.CaptureRRPage();
    s.readable = false; s.OnClickBtnRRReset();
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_rr_dirty, true); assert.equal(s.m_EdtRRMultiple[1].Text(), '6');
});
check('single-position next button wraps and reports that same position without losing selection', () => {
    const s = fixture(); addPosition(s); s.OnClickBtnRRPosition(); s.OnClickBtnRRPosition();
    assert.equal(s.m_rr_position_id, 42); assert.match(s.status.text, /只有这一笔/);
});
check('fine volume steps remain visible in both original and remaining quantities', () => {
    const s = fixture(); addPosition(s, 42, { initial_volume: 0.003, volume: 0.001 }); s.OnClickBtnRRPosition();
    assert.match(s.m_LblRRInfo.Text(), /初始 0.003 手/); assert.match(s.m_LblRRPositionInfo.Text(), /余仓 0.001 手/);
});
console.log(`RR plan UI: ${count} production-method tests passed.`);
