// Execute the production draft editor methods against a small UI boundary.
// No orders, files in the MT5 data directory, or live terminals are touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRPlanPanel.mqh', import.meta.url), 'utf8')
    + '\n' + readFileSync(new URL('../mt5/RRTradePanel.mqh', import.meta.url), 'utf8');
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
        .replace(/\bulong groups\[\];/g, 'let groups = [];')
        .replace(/\bstring group_labels\[\];/g, 'let group_labels = [];')
        .replace(/\b(?:double|string)\s+((?:\w+,\s*)+\w+);/g, 'let $1;')
        .replace(/\bRRPlan (\w+);/g, 'let $1 = makePlan();')
        .replace(/\bRRState (\w+);/g, 'let $1 = {};')
        .replace(/\b(?:double|string|int|bool|ulong|uint|long)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:double|string|int|bool|ulong|uint|long)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\((?:int|ulong|long)\)/g, '')
        .replace(/RRReadManagedPosition\(([^;\n]+), (state|current), ticket, error\)/g, 'RRReadManagedPosition($1, $2)')
        .replace(/RBReadManagedGroup\(([^,\n]+), (state|current), symbol, remaining, server_tp, error\)/g, 'RBReadManagedGroup($1, $2, data => {symbol = data.symbol; remaining = data.remaining; server_tp = data.server_tp; error = data.error;})')
        .replace('RBRequestGroupClose(m_rr_group_id, percent, error)', 'RBRequestGroupClose(m_rr_group_id, percent, value => error = value)')
        .replace('RBApplyGroupPlan(m_rr_group_id, draft, m_rr_expected_checksum, m_rr_expected_stage, error)', 'RBApplyGroupPlan(m_rr_group_id, draft, m_rr_expected_checksum, m_rr_expected_stage, value => error = value)')
        .replace('RRPlanParseNumber(m_EdtRRMultiple[row].Text(), multiple)', '((multiple = parseNumber(m_EdtRRMultiple[row].Text())) !== null)')
        .replace('RMRequestClose(m_rr_position_id, percent, sets.MagicNumber, error)', 'RMRequestClose(m_rr_position_id, percent, sets.MagicNumber, value => error = value)')
        .replace('RRPlanParseNumber(m_EdtRRClosePercent.Text(), percent)', '((percent = parseNumber(m_EdtRRClosePercent.Text())) !== null)')
        .replace('RRPlanParseNumber(percentage, summary.targets[index].percent)', 'parseInto(percentage, summary.targets[index], "percent")')
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
    FontSize(value) { this.fontSize = value; }
    TextAlign(value) { this.align = value; }
}
class Combo extends Control {
    constructor() { super(); this.items = []; this.value = 0; }
    ItemsClear() { this.items = []; this.value = 0; }
    AddItem(text, value) { this.items.push({ text, value }); }
    SelectByValue(value) { this.value = value; return true; }
    Value() { return this.value; }
    Expanded() { return this.expanded || false; }
    OpenDropDown() { this.expanded = true; this.opens = (this.opens || 0) + 1; return true; }
    CloseDropDown() { this.expanded = false; return true; }
    Select(index) { if (arguments.length) this.value = this.items[index]?.value || 0; return this.items.find(i => i.value === this.value)?.text || ''; }
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
        m_rr_has_plan: true, m_rr_position_magic: 123, m_rr_position_symbol: 'AUDUSD', m_rr_position_choices: '',
        m_controls_ready: true, m_rr_position_id: 0, m_rr_group_id: 0, m_rr_last_refresh: 0, m_rr_stale: false, m_rr_readonly: false, m_rr_dirty: false,
        m_rr_expected_checksum: 0, m_rr_expected_stage: 0, m_rr_live_stage: 0, m_rr_state: {}, m_rr_loaded_plan: makePlan(),
        m_rr_multiple: Array(20).fill(''), m_rr_percent: Array(20).fill(''), m_rr_be: Array(20).fill(false),
        m_LblRRPage: new Control(), m_BtnRRPrevious: new Control(), m_BtnRRNext: new Control(), m_BtnRRAdd: new Control(),
        DoubleToString: (v, digits) => v.toFixed(digits),
        CountDecimalPlaces: value => { for (let i = 0; i < 100; i++) if (Math.abs(Math.round(value * 10 ** i) / 10 ** i - value) < 1e-8) return i; return -1; },
        IntegerToString: String, StringSubstr: (text, start, count) => (text || '').substr(start, count),
        ArrayResize: (items, n) => { items.length = n; },
        ChartRedraw: () => {}, parseNumber, makePlan, ZeroMemory: () => {}, structuredClone,
        parseInto: (text, target, field) => { const value = parseNumber(text); if (value === null) return false; target[field] = value; return true; },
        canEdit: true, applyAllowed: true, canEditCalls: 0, applyCalls: 0, updates: [],
        SymbolForTrading: 'AUDUSD', sets: { MagicNumber: 123, TPMultiplier: 2, EntryLevel: 100, StopLossLevel: 90 },
        SYMBOL_DIGITS: 'digits', SYMBOL_TRADE_TICK_SIZE: 'tick', POSITION_VOLUME: 'volume', POSITION_TP: 'tp',
        POSITION_IDENTIFIER: 'identifier', POSITION_SYMBOL: 'symbol', POSITION_MAGIC: 'magic', POSITION_TYPE: 'type', POSITION_TYPE_BUY: 0,
        SymbolInfoInteger: () => 2, SymbolInfoDouble: () => 0.01, MathAbs: Math.abs, MathMax: Math.max,
        RRTargetPrice: (direction, entry, risk, multiple) => Math.round((entry + direction * risk * multiple) * 100) / 100,
        clrDimGray: 'grey', clrDarkSlateGray: 'normal', clrFireBrick: 'error', tick: 1000, GetTickCount64: () => s.tick,
        groups: new Map(), groupReadable: true, groupApplyCalls: [], groupCloseCalls: [], positions: new Map(), readable: true, positionApplyCalls: [], positionApplyAllowed: true,
        first_column_start: 7, element_height: 20, m_DPIScale: 1, MathRound: Math.round, ALIGN_RIGHT: 1, RRTabList: [],
    };
    for (const name of ['m_LblRRNumber', 'm_LblRRPrice', 'm_EdtRRMultiple', 'm_EdtRRPercent', 'm_ChkRRBreakEven', 'm_BtnRRDelete'])
        s[name] = Array.from({ length: 5 }, () => new Control());
    for (const name of ['m_LblRRMode', 'm_LblRRInfo', 'm_LblRRBEInfo', 'm_LblRRPositionInfo', 'm_BtnRRSave', 'm_BtnRRReset', 'm_BtnRRManualClose', 'm_EdtRRClosePercent',
        'm_BtnRRNewPlan', 'm_BtnRRPosition', 'm_LblRRManualInfo', 'm_LblRRClosePercent', 'm_LblRRClosePercentUnit', 'm_LblRRHeadingR', 'm_LblRRHeadingPercent', 'm_LblRRHeadingBE', 'm_LblRRStatus', 'm_LblRRStatus2']) s[name] = new Control();
    for (const type of ['Label', 'Button', 'Edit', 'CheckBox', 'ComboBox']) s[type + 'Create'] = (list, control, x1, y1, x2, y2, name, text) => {
        control.rect = [x1, y1, x2, y2]; control.name = name; if (text !== undefined) control.Text(text); list.push(control); return true;
    };
    s.m_CmbRRPosition = new Combo();
    s.PositionsTotal = () => s.positions.size;
    s.PositionGetTicket = index => { s.selected = [...s.positions.values()][index]; return s.selected?.ticket || 0; };
    s.PositionGetInteger = prop => s.selected[prop]; s.PositionGetString = prop => s.selected[prop];
    s.RRReadManagedPosition = (symbol, magic, id, state) => {
        const position = s.positions.get(id); if (!s.readable || !position || !position.plan) return false;
        assert.equal(symbol, position.symbol); assert.equal(magic, position.magic);
        Object.assign(state, structuredClone(position)); s.selected = position; return true;
    };
    s.RBCollectGroups = ids => { ids.push(...s.groups.keys()); return ids.length; };
    s.RBPositionParent = id => s.positions.get(id)?.parent || 0;
    s.RBGroupBuilding = id => !s.groupReadable || !!s.groups.get(id)?.building || !!s.groups.get(id)?.pending;
    s.RBReadManagedGroup = (id, target, output) => {
        const group = s.groups.get(id);
        if (!group || !s.groupReadable) { output({ error: '父组状态暂不可读' }); return false; }
        Object.assign(target, structuredClone(group));
        output({ symbol: group.symbol, remaining: group.volume, server_tp: group.tp, error: '' }); return true;
    };
    s.RBApplyGroupPlan = (id, plan, checksum, stage, error) => {
        s.groupApplyCalls.push({ id, plan: structuredClone(plan), checksum, stage }); const group = s.groups.get(id);
        if (!group || group.building || !s.groupReadable || checksum !== s.RRPlanChecksum(group.plan) || stage !== group.stage) { error('父组状态已变化'); return false; }
        group.plan = structuredClone(plan); return true;
    };
    s.RBRequestGroupClose = (id, percent, error) => {
        const group = s.groups.get(id);
        if (!group || group.building) { error('父组建仓中；请先取消剩余开仓'); return false; }
        s.groupCloseCalls.push({ id, percent, snapshot: group.volume }); return true;
    };
    s.RRStatePlan = (state, plan) => Object.assign(plan, structuredClone(state.plan));
    s.RRPlanChecksum = plan => JSON.stringify(plan);
    s.RRPlanTotalPercent = plan => plan.targets.slice(0, plan.count).reduce((sum, target) => sum + target.percent, 0);
    s.RRPlanClosesAll = plan => s.RRPlanTotalPercent(plan) >= 100 - 1e-7;
    s.RRStateClosesAll = state => state.version === 1 || s.RRPlanClosesAll(state.plan);
    s.RRNextManagedPosition = (symbol, magic, id) => {
        const ids = [...s.positions.keys()].sort((a, b) => a - b); return ids.find(i => i > id) || 0;
    };
    s.PositionSelectByTicket = () => true;
    s.RRSelectManagedPosition = (symbol, magic, id) => s.positions.has(id);
    s.PositionGetDouble = prop => s.selected[prop];
    s.closeCalls = []; s.closeAllowed = true;
    s.RMRequestClose = (id, percent, magic, error) => { if (!s.closeAllowed) error("正在等待上次平仓成交确认，请勿重复点击。"); s.closeCalls.push({ id, percent, magic, snapshot: s.positions.get(id)?.volume }); return s.closeAllowed; };
    s.RRApplyPositionPlan = (symbol, magic, id, plan, checksum, stage) => {
        s.positionApplyCalls.push({ symbol, magic, id, plan: structuredClone(plan), checksum, stage });
        const p = s.positions.get(id);
        if (!s.positionApplyAllowed || !p || checksum !== s.RRPlanChecksum(p.plan) || stage !== p.stage) return false;
        p.plan = structuredClone(plan); return true;
    };
    s.SetRRStatus = (text, error = false) => { s.status = { text, error }; };
    s.RRPlanCanEdit = (symbol, magic) => { s.canEditCalls++; assert.equal(symbol, ''); assert.equal(magic, s.sets.MagicNumber); return s.canEdit; };
    s.RRPlanApply = plan => { s.applyCalls++; if (!s.applyAllowed) return false; s.RRActivePlan = structuredClone(plan); return true; };
    s.defaultReadAllowed = true; s.defaultReadCalls = 0;
    s.RRPlanFileName = () => 'account-plan.bin';
    s.RRPlanRead = (_filename, target) => { s.defaultReadCalls++; if (!s.defaultReadAllowed) return false; if (s.newerDefault) Object.assign(target, structuredClone(s.newerDefault)); return true; };
    s.RRPlanFinalR = () => s.RRActivePlan.targets[s.RRActivePlan.count - 1].multiple;
    s.ProcessTPChange = value => s.updates.push(['TP', value]);
    s.RefreshValues = () => s.updates.push(['refresh']);
    s.SaveSettingsOnDisk = symbol => s.updates.push(['settings', symbol]);
    const context = vm.createContext(s);
    for (const name of ['CreateRRControls', 'LoadRRDraft', 'FillRRDraft', 'LoadRRPositionDraft', 'LoadRRGroupDraft', 'RefreshRRGroupStatus', 'UpdateRRModeLabels', 'CaptureRRPage', 'RenderRRPage', 'OnClickBtnRRAdd', 'OnClickBtnRRDelete',
                         'RefreshRRTargetPrices', 'RefreshRRPlanSummary', 'RefreshRRLiveStatus', 'OnClickBtnRRNewPlan', 'OnClickBtnRRPosition',
                         'OnClickBtnRRPrevious', 'OnClickBtnRRNext', 'OnClickBtnRRReset', 'OnClickBtnRRSave', 'SelectRRPanelPosition',
                         'RefreshRRPositionChoices', 'OnChangeRRPosition', 'OnClickRRManualClose', 'RefreshRRManualAction'])
        vm.runInContext(extract(name), context);
    s.selectPosition = id => { s.RefreshRRPositionChoices(); s.m_CmbRRPosition.SelectByValue(id); s.OnChangeRRPosition(); };
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
    const position = { version: 2, identifier: id, ticket: id + 10000, symbol: 'AUDUSD', magic: 123, type: 1, stage: 0, blocked: 0, direction: -1,
        entry: 4341.74, risk: 7.68, initial_volume: 0.32, volume: 0.32, tp: 4303.34, plan, ...overrides };
    s.positions.set(id, position); return position;
}
check('new-plan previews use calculator entry, while live targets use frozen actual fill', () => {
    const s = fixture(); addPosition(s);
    assert.match(s.m_LblRRPrice[0].Text(), /新仓预览 110/);
    s.selectPosition(42);
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_BtnRRSave.Text(), '应用到该持仓');
    assert.match(s.m_LblRRPrice[0].Text(), /4326.38/); assert.match(s.m_LblRRPrice[1].Text(), /4303.34/);
    assert.match(s.m_LblRRBEInfo.Text(), /4341.74.*7.68/); assert.match(s.m_LblRRPositionInfo.Text(), /0.32.*TP已同步/);
});
check('draft target prices update without moving applied position targets', () => {
    const s = fixture(); const p = addPosition(s); s.selectPosition(42);
    s.m_EdtRRMultiple[0].Text('3'); s.RefreshRRTargetPrices();
    assert.match(s.m_LblRRPrice[0].Text(), /草稿价 4318.7.*未应用/);
    assert.equal(p.plan.targets[0].multiple, 2); assert.equal(s.positionApplyCalls.length, 0);
});
check('live quote refresh preserves unfinished numeric text and BE edits', () => {
    const s = fixture(); const p = addPosition(s); s.selectPosition(42);
    s.m_EdtRRMultiple[0].Text('1..'); s.m_ChkRRBreakEven[1].Checked(true); p.volume = 0.24;
    s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[0].Text(), '1..'); assert.equal(s.m_ChkRRBreakEven[1].Checked(), true);
    assert.match(s.m_LblRRPositionInfo.Text(), /0.24/); assert.match(s.m_LblRRPrice[0].Text(), /请输入有效/);
});
check('stage advancing preserves draft but locks stale save until explicit reload', () => {
    const s = fixture(); const p = addPosition(s); s.selectPosition(42);
    s.m_EdtRRMultiple[1].Text('6'); p.stage = 1; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '6'); assert.equal(s.m_rr_stale, true);
    assert.equal(s.m_BtnRRSave.enabled, false); assert.equal(s.m_EdtRRMultiple[0].readonly, true);
    s.OnClickBtnRRSave(); assert.equal(s.positionApplyCalls.length, 0);
    s.OnClickBtnRRReset(); assert.equal(s.m_rr_stale, false); assert.equal(s.m_EdtRRMultiple[1].Text(), '5');
    assert.equal(s.m_EdtRRMultiple[0].readonly, true); assert.equal(s.m_EdtRRMultiple[1].readonly, false);
});
check('other-chart plan change marks draft stale even when execution stage stays unchanged', () => {
    const s = fixture(); const p = addPosition(s); s.selectPosition(42);
    p.plan.targets[1].multiple = 7; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_rr_stale, true); assert.equal(s.m_EdtRRMultiple[1].Text(), '5');
    s.OnClickBtnRRReset(); assert.equal(s.m_EdtRRMultiple[1].Text(), '7');
});
check('triggered rows cannot change or be deleted and retain full numeric precision on apply', () => {
    const s = fixture(); const p = addPosition(s, 42, { stage: 1 }); p.plan.targets[0].multiple = 1.123456789123;
    s.selectPosition(42); s.m_EdtRRMultiple[0].Text('999'); s.m_EdtRRPercent[0].Text('0');
    s.m_ChkRRBreakEven[0].Checked(false); s.OnClickBtnRRDelete(0); s.m_EdtRRMultiple[1].Text('6'); s.OnClickBtnRRSave();
    assert.equal(p.plan.count, 2); assert.equal(p.plan.targets[0].multiple, 1.123456789123);
    assert.equal(p.plan.targets[0].percent, 50); assert.equal(p.plan.targets[0].move_be, 1);
    assert.equal(p.plan.targets[1].multiple, 6);
});
check('apply saves only the selected position and reports server TP awaiting synchronization', () => {
    const s = fixture(); const p = addPosition(s); const p2 = addPosition(s, 99); const newPlan = JSON.stringify(s.RRActivePlan);
    s.selectPosition(42); s.m_EdtRRMultiple[1].Text('6'); s.OnClickBtnRRSave();
    assert.equal(p.plan.targets[1].multiple, 6); assert.equal(p2.plan.targets[1].multiple, 5);
    assert.equal(JSON.stringify(s.RRActivePlan), newPlan); assert.equal(s.applyCalls, 0); assert.equal(s.updates.length, 0);
    assert.match(s.status.text, /最终 TP 待服务器同步/); assert.match(s.m_LblRRPositionInfo.Text(), /TP待同步/);
    assert.equal(s.m_rr_dirty, false);
});
check('race between last refresh and apply passes frozen checksum/stage for engine rejection', () => {
    const s = fixture(); const p = addPosition(s); s.selectPosition(42); const baseline = s.m_rr_expected_checksum;
    s.m_EdtRRMultiple[1].Text('6'); p.stage = 1; s.OnClickBtnRRSave();
    assert.equal(s.positionApplyCalls.length, 1); assert.equal(s.positionApplyCalls[0].stage, 0);
    assert.equal(s.positionApplyCalls[0].checksum, baseline); assert.equal(p.plan.targets[1].multiple, 5);
    assert.equal(s.status.error, true); assert.equal(s.m_EdtRRMultiple[1].Text(), '6');
});
check('legacy positions show actual targets but all mutations remain disabled', () => {
    const s = fixture(); addPosition(s, 42, { version: 1, stage: 2 }); s.selectPosition(42);
    assert.equal(s.m_rr_readonly, true); assert.equal(s.m_rr_live_stage, 1);
    assert.match(s.m_LblRRPrice[0].Text(), /已触发/); assert.match(s.m_LblRRPrice[1].Text(), /待触发/);
    assert.equal(s.m_BtnRRSave.enabled, false); assert.equal(s.m_BtnRRAdd.enabled, false);
    s.OnClickBtnRRAdd(); s.OnClickBtnRRDelete(0); s.OnClickBtnRRSave();
    assert.equal(s.m_rr_count, 2); assert.equal(s.positionApplyCalls.length, 0);
});
check('switching modes cannot silently discard uncommitted text', () => {
    const s = fixture(); addPosition(s); addPosition(s, 99);
    s.m_EdtRRMultiple[0].Text('1.5'); s.selectPosition(42); assert.equal(s.m_rr_position_id, 0);
    assert.match(s.status.text, /先保存或撤销/); s.OnClickBtnRRReset(); s.selectPosition(42);
    s.m_EdtRRMultiple[1].Text('6'); s.OnClickBtnRRNewPlan(); assert.equal(s.m_rr_position_id, 42);
    s.selectPosition(99); assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_EdtRRMultiple[1].Text(), '6');
});
check('position dropdown directly selects isolated plans without returning to new-plan mode', () => {
    const s = fixture(); addPosition(s); const p = addPosition(s, 99); p.plan.targets[1].multiple = 8;
    s.selectPosition(42); assert.equal(s.m_rr_position_id, 42);
    s.selectPosition(99); assert.equal(s.m_rr_position_id, 99); assert.equal(s.m_EdtRRMultiple[1].Text(), '8');
    s.selectPosition(42); assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_EdtRRMultiple[1].Text(), '5');
    s.OnClickBtnRRNewPlan(); assert.equal(s.m_rr_position_id, 0); assert.equal(s.m_BtnRRSave.Text(), '保存新仓方案');
});
check('transient state read failure preserves live draft and allows guarded retry', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRMultiple[1].Text('6');
    s.readable = false; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '6'); assert.match(s.m_LblRRPositionInfo.Text(), /草稿已保留/);
    s.readable = true; s.tick += 600; s.RefreshRRLiveStatus(); assert.equal(s.m_rr_stale, false);
});
check('legacy or blocked position remains read-only after reset', () => {
    const s = fixture(); addPosition(s, 42, { blocked: 1 }); s.selectPosition(42); s.OnClickBtnRRReset();
    assert.equal(s.m_rr_readonly, true); assert.equal(s.m_EdtRRMultiple[0].readonly, true);
});
check('closed position can explicitly discard its dirty draft and return to new-plan mode', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRMultiple[1].Text('6'); s.CaptureRRPage();
    s.positions.delete(42); s.tick += 600; s.RefreshRRLiveStatus(); s.OnClickBtnRRReset();
    assert.equal(s.m_rr_position_id, 0); assert.equal(s.m_rr_dirty, false); assert.match(s.status.text, /持仓已关闭/);
});
check('reset with a busy journal keeps a still-open position draft intact', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRMultiple[1].Text('6'); s.CaptureRRPage();
    s.readable = false; s.OnClickBtnRRReset();
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_rr_dirty, true); assert.equal(s.m_EdtRRMultiple[1].Text(), '6');
});
check('refreshing the dropdown retains current position and unfinished plan text', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRMultiple[1].Text('6..'); s.OnClickBtnRRPosition();
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_CmbRRPosition.Value(), 42); assert.match(s.status.text, /已刷新/);
    assert.equal(s.m_EdtRRMultiple[1].Text(), '6..');
});
check('fine volume steps remain visible in both original and remaining quantities', () => {
    const s = fixture(); addPosition(s, 42, { initial_volume: 0.003, volume: 0.001 }); s.selectPosition(42);
    assert.match(s.m_LblRRInfo.Text(), /初始 0.003 手/); assert.match(s.m_LblRRPositionInfo.Text(), /余仓 0.001 手/);
});
check('runner percentage preview updates directly from typing and distinguishes saved allocation', () => {
    const s = fixture(); s.m_EdtRRPercent[1].Text('25'); s.RefreshRRTargetPrices();
    assert.match(s.m_LblRRInfo.Text(), /草稿 75% \/ 保留 25%.*已用 100%/);
    assert.match(s.m_LblRRPositionInfo.Text(), /保留部分不设全平 TP/);
    assert.equal(s.m_rr_percent[1], '50'); assert.equal(s.RRActivePlan.targets[1].percent, 50);
});
check('saved runner new-plan feedback retains unallocated volume and does not invent BE', () => {
    const s = fixture(); s.m_ChkRRBreakEven[0].Checked(false); s.m_EdtRRPercent[1].Text('25'); s.OnClickBtnRRSave();
    assert.equal(s.RRActivePlan.targets[0].move_be, 0); assert.equal(s.RRActivePlan.targets[1].move_be, 0);
    assert.match(s.m_LblRRInfo.Text(), /已安排 75% \/ 保留 25%/); assert.doesNotMatch(s.m_LblRRInfo.Text(), /草稿|已用/);
    assert.match(s.status.text, /保留余仓，不设置全平 TP/); assert.match(s.m_LblRRBEInfo.Text(), /仅勾 BE/);
});
check('live runner reports pending cancellation until the actual server TP is exactly zero', () => {
    const s = fixture(); const p = addPosition(s); p.plan.targets[1].percent = 25; s.selectPosition(42);
    assert.match(s.m_LblRRInfo.Text(), /已安排 75% \/ 保留 25%/);
    assert.match(s.m_LblRRPositionInfo.Text(), /旧TP待取消 4303.34/);
    p.tp = 0.00001; s.tick += 600; s.RefreshRRLiveStatus(); assert.match(s.m_LblRRPositionInfo.Text(), /旧TP待取消/);
    p.tp = 0; s.tick += 600; s.RefreshRRLiveStatus(); assert.match(s.m_LblRRPositionInfo.Text(), /全平TP已取消/);
});
check('changing a full-close live plan to a runner preserves the selected BE flags', () => {
    const s = fixture(); const p = addPosition(s); s.selectPosition(42);
    s.m_EdtRRPercent[1].Text('25'); s.m_ChkRRBreakEven[1].Checked(true); s.OnClickBtnRRSave();
    assert.equal(p.plan.targets[0].percent, 50); assert.equal(p.plan.targets[1].percent, 25);
    assert.equal(p.plan.targets[0].move_be, 1); assert.equal(p.plan.targets[1].move_be, 1);
    assert.match(s.status.text, /将取消全平 TP/); assert.match(s.m_LblRRPositionInfo.Text(), /旧TP待取消/);
});
check('all runner targets may already be triggered while adding a new future target remains available', () => {
    const s = fixture(); const p = addPosition(s, 42, { stage: 2, volume: 0.08, tp: 0 }); p.plan.targets[1].percent = 25;
    s.selectPosition(42); assert.equal(s.m_BtnRRAdd.enabled, true);
    assert.equal(s.m_EdtRRMultiple[0].readonly, true); assert.equal(s.m_EdtRRMultiple[1].readonly, true);
    s.OnClickBtnRRAdd(); assert.equal(s.m_EdtRRMultiple[2].readonly, false); s.m_EdtRRPercent[2].Text('25');
    s.OnClickBtnRRSave(); assert.equal(p.plan.count, 3); assert.equal(p.plan.targets[2].multiple, 6);
    assert.equal(p.plan.targets[2].percent, 25); assert.equal(p.plan.targets[0].percent, 50); assert.equal(p.plan.targets[1].percent, 25);
    assert.match(s.status.text, /最终 TP 待服务器同步/);
});
check('a zero-close BE-only plan displays all original volume retained without changing BE selection', () => {
    const s = fixture(1); s.m_EdtRRPercent[0].Text('0'); s.m_ChkRRBreakEven[0].Checked(true); s.OnClickBtnRRSave();
    assert.match(s.m_LblRRInfo.Text(), /已安排 0% \/ 保留 100%/);
    assert.equal(s.RRActivePlan.targets[0].move_be, 1); assert.equal(s.RRActivePlan.targets[0].percent, 0);
});
check('cross-page allocation summary includes saved draft values on other pages', () => {
    const s = fixture(6); s.m_EdtRRPercent[0].Text('10'); s.OnClickBtnRRNext(); s.m_EdtRRPercent[0].Text('15');
    s.RefreshRRTargetPrices();
    assert.match(s.m_LblRRInfo.Text(), /草稿 91.666/); assert.match(s.m_LblRRInfo.Text(), /保留 8.333/);
    assert.equal(s.m_EdtRRPercent[0].Text(), '15');
});
check('invalid and excessive percentages do not advertise a valid retained balance or rewrite input', () => {
    const s = fixture(); s.m_EdtRRPercent[0].Text('1..'); s.RefreshRRTargetPrices();
    assert.match(s.m_LblRRInfo.Text(), /未填完整/); assert.equal(s.m_EdtRRPercent[0].Text(), '1..');
    s.m_EdtRRPercent[0].Text('75'); s.RefreshRRTargetPrices(); assert.match(s.m_LblRRInfo.Text(), /125%.*超出 100%/);
    assert.equal(s.m_LblRRInfo.color, 'error'); assert.equal(s.RRActivePlan.targets[0].percent, 50);
});
check('position dropdown includes all symbols and magic numbers with actual ticket and side', () => {
    const s = fixture(); addPosition(s, 42, { symbol: 'XAUUSD', magic: 0, type: 0 });
    addPosition(s, 99, { symbol: 'EURUSD.a', magic: 888 }); s.RefreshRRPositionChoices();
    assert.match(s.m_CmbRRPosition.items[1].text, /^XAUUSD #10042 买入$/);
    assert.match(s.m_CmbRRPosition.items[2].text, /^EURUSD.a #10099 卖出$/);
    assert.equal(s.m_rr_position_id, 0); assert.equal(s.closeCalls.length, 0);
});
check('a different symbol managed position reads and applies using its actual magic', () => {
    const s = fixture(); addPosition(s, 99, { symbol: 'EURUSD.a', magic: 888 }); s.selectPosition(99);
    s.m_EdtRRMultiple[1].Text('7'); s.OnClickBtnRRSave();
    assert.equal(s.positionApplyCalls[0].symbol, 'EURUSD.a'); assert.equal(s.positionApplyCalls[0].magic, 888);
    assert.equal(s.SymbolForTrading, 'AUDUSD');
});
check('manual positions without journals expose only manual exit without invented R or target rows', () => {
    const s = fixture(); addPosition(s, 42, { symbol: 'XAUUSD', magic: 0, plan: null }); s.selectPosition(42);
    assert.equal(s.m_rr_has_plan, false); assert.equal(s.m_rr_readonly, true); assert.equal(s.m_rr_count, 0);
    assert.equal(s.m_BtnRRSave.enabled, false); assert.equal(s.m_BtnRRAdd.enabled, false);
    assert.ok(s.m_EdtRRMultiple.every(c => !c.visible)); assert.match(s.m_LblRRBEInfo.Text(), /不提供 R/);
    assert.match(s.m_LblRRPositionInfo.Text(), /仅手动平仓/); assert.equal(s.m_BtnRRManualClose.enabled, true);
    s.OnClickBtnRRSave(); assert.equal(s.positionApplyCalls.length, 0); assert.equal(s.applyCalls, 0);
});
check('custom manual percentage closes the selected manual position from click-time remaining volume', () => {
    const s = fixture(); const p = addPosition(s, 99, { magic: 0, plan: null, volume: 0.32 }); s.selectPosition(99);
    s.m_EdtRRClosePercent.Text('12.5'); p.volume = 0.08; s.OnClickRRManualClose();
    assert.deepEqual(s.closeCalls, [{ id: 99, percent: 12.5, magic: 123, snapshot: 0.08 }]);
    assert.match(s.status.text, /12.5%.*以成交回报为准/); assert.equal(s.positionApplyCalls.length, 0);
});
check('manual percentage validation rejects empty malformed zero negative or above-100 values', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42);
    for (const percent of ['', 'abc', '0', '-25', '101', 'NaN', '1e999']) {
        s.m_EdtRRClosePercent.Text(percent); s.OnClickRRManualClose(); assert.equal(s.status.error, true);
    }
    assert.equal(s.closeCalls.length, 0);
});
check('manual close has no implicit selected position while viewing a new plan', () => {
    const s = fixture(); addPosition(s); s.m_EdtRRClosePercent.Text('50'); s.OnClickRRManualClose();
    assert.equal(s.closeCalls.length, 0); assert.match(s.status.text, /先.*选择/);
});
check('manual action preserves an unfinished RR draft and does not submit that draft', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRMultiple[1].Text('7..');
    s.m_EdtRRClosePercent.Text('50'); s.OnClickRRManualClose();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '7..'); assert.equal(s.positionApplyCalls.length, 0); assert.equal(s.closeCalls.length, 1);
});
check('closed selection remains identifiable and offers choosing another position without sending', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.positions.delete(42); s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_BtnRRManualClose.enabled, true); assert.equal(s.m_BtnRRManualClose.Text(), "先选择持仓"); assert.match(s.m_CmbRRPosition.items.at(-1).text, /已关闭/);
    assert.equal(s.m_rr_position_id, 42); s.OnClickBtnRRReset(); assert.equal(s.m_rr_position_id, 0);
});
check('refresh and dropdown reconstruction do not rewrite a custom manual percentage', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRClosePercent.Text('37.25');
    addPosition(s, 99); s.tick += 600; s.RefreshRRLiveStatus(); s.OnClickBtnRRPosition();
    assert.equal(s.m_EdtRRClosePercent.Text(), '37.25'); assert.equal(s.m_CmbRRPosition.Value(), 42);
});
check('actual RR control creation keeps manual actions and all five targets inside the panel', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
        const s = fixture(); s.m_DPIScale = scale; s.first_column_start = Math.round(7 * scale); s.element_height = Math.round(20 * scale);
        assert.equal(s.CreateRRControls(), true);
        const right = s.first_column_start + Math.round(307 * scale);
        for (const control of s.RRTabList) assert.ok(control.rect[0] >= s.first_column_start && control.rect[2] <= right, control.name);
        assert.ok(s.m_CmbRRPosition.rect[3] < s.m_LblRRClosePercent.rect[1]);
        assert.ok(s.m_LblRRClosePercent.rect[2] < s.m_EdtRRClosePercent.rect[0]);
        assert.ok(s.m_EdtRRClosePercent.rect[2] < s.m_LblRRClosePercentUnit.rect[0]);
        assert.ok(s.m_LblRRClosePercentUnit.rect[2] < s.m_BtnRRManualClose.rect[0]);
        assert.equal(s.m_LblRRClosePercentUnit.Text(), "%");
        assert.ok(s.m_LblRRManualInfo.rect[3] < s.m_LblRRInfo.rect[1]);
        assert.ok(s.m_LblRRPrice[4].rect[3] < s.m_BtnRRNext.rect[1]);
        assert.ok(s.m_BtnRRSave.rect[3] < s.m_LblRRStatus.rect[1]);
        assert.ok(s.m_LblRRStatus2.rect[3] < Math.round(600 * scale));
    }
});
check('inventory refresh cannot dismiss an open dropdown or replace a queued user selection', () => {
    const s = fixture(); addPosition(s); s.RefreshRRPositionChoices();
    s.m_CmbRRPosition.expanded = true; addPosition(s, 99); s.RefreshRRPositionChoices();
    assert.equal(s.m_CmbRRPosition.items.length, 2);
    s.m_CmbRRPosition.expanded = false; s.m_CmbRRPosition.SelectByValue(42); s.RefreshRRPositionChoices();
    assert.equal(s.m_CmbRRPosition.Value(), 42); assert.equal(s.m_CmbRRPosition.items.length, 2);
    s.OnChangeRRPosition(); s.RefreshRRPositionChoices();
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_CmbRRPosition.items.length, 3);
});
check('new-plan reset reloads the shared plan saved by another chart', () => {
    const s = fixture(); s.m_EdtRRMultiple[1].Text('9'); s.newerDefault = structuredClone(s.RRActivePlan); s.newerDefault.targets[1].multiple = 7;
    s.OnClickBtnRRReset(); assert.equal(s.defaultReadCalls, 1); assert.equal(s.m_EdtRRMultiple[1].Text(), '7'); assert.equal(s.m_rr_dirty, false);
});
check('new-plan reset keeps unfinished draft when shared file cannot be read', () => {
    const s = fixture(); s.m_EdtRRMultiple[1].Text('9..'); s.CaptureRRPage(); s.defaultReadAllowed = false;
    s.OnClickBtnRRReset(); assert.equal(s.m_EdtRRMultiple[1].Text(), '9..'); assert.equal(s.m_rr_dirty, true); assert.equal(s.status.error, true);
});
check('pristine new-plan editor follows active shared-plan reload after chart symbol change', () => {
    const s = fixture(); s.RRActivePlan.targets[1].multiple = 8; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '8'); assert.equal(s.m_rr_stale, false); assert.equal(s.m_BtnRRSave.enabled, true);
});
check('dirty new-plan editor keeps unfinished text and locks save when shared baseline changes', () => {
    const s = fixture(); s.m_EdtRRMultiple[1].Text('9..'); s.RRActivePlan.targets[1].multiple = 8; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_EdtRRMultiple[1].Text(), '9..'); assert.equal(s.m_rr_stale, true); assert.equal(s.m_BtnRRSave.enabled, false);
    s.OnClickBtnRRSave(); assert.equal(s.applyCalls, 0); s.OnClickBtnRRReset(); assert.equal(s.m_EdtRRMultiple[1].Text(), '8'); assert.equal(s.m_rr_stale, false);
});
check('queued Save detects active baseline change before any timer refresh and cannot revert shared plan', () => {
    const s = fixture(); s.RRActivePlan.targets[1].multiple = 8; s.OnClickBtnRRSave();
    assert.equal(s.applyCalls, 0); assert.equal(s.canEditCalls, 0); assert.equal(s.m_rr_stale, true);
    assert.equal(s.m_EdtRRMultiple[1].Text(), '2'); assert.equal(s.RRActivePlan.targets[1].multiple, 8);
});
check('shared default updates do not replace a frozen live-position editor', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.RRActivePlan.targets[1].multiple = 8;
    s.tick += 600; s.RefreshRRLiveStatus(); assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_EdtRRMultiple[1].Text(), '5'); assert.equal(s.m_rr_stale, false);
});

check('unselected manual action is visibly actionable and opens chooser without picking an order', () => {
    const s = fixture(); addPosition(s); addPosition(s, 99);
    assert.equal(s.m_BtnRRManualClose.enabled, true); assert.equal(s.m_BtnRRManualClose.Text(), '先选择持仓');
    assert.match(s.m_LblRRManualInfo.Text(), /未选中/);
    s.m_EdtRRClosePercent.Text('25'); s.OnClickRRManualClose();
    assert.equal(s.m_CmbRRPosition.Expanded(), true);
    assert.equal(s.m_rr_position_id, 0); assert.equal(s.m_CmbRRPosition.Value(), 0);
    assert.equal(s.closeCalls.length, 0); assert.equal(s.m_EdtRRClosePercent.Text(), '25');
    s.m_CmbRRPosition.expanded = false; s.selectPosition(99);
    assert.equal(s.m_BtnRRManualClose.Text(), '按比例平仓'); assert.match(s.m_LblRRManualInfo.Text(), /当前余仓/);
    assert.equal(s.closeCalls.length, 0);
    s.OnClickRRManualClose(); assert.equal(s.closeCalls.length, 1); assert.equal(s.closeCalls[0].id, 99);
});
check('no account holdings reports actionable feedback beside button without dispatching', () => {
    const s = fixture(); s.OnClickRRManualClose();
    assert.match(s.m_LblRRManualInfo.Text(), /没有持仓/); assert.match(s.status.text, /未成交挂单/);
    assert.equal(s.m_CmbRRPosition.Expanded(), false); assert.equal(s.closeCalls.length, 0);
});
check('choosing a manual position cannot discard an unfinished new-plan draft', () => {
    const s = fixture(); addPosition(s); s.m_EdtRRMultiple[0].Text('1..'); s.OnClickRRManualClose();
    assert.equal(s.m_EdtRRMultiple[0].Text(), '1..'); assert.match(s.m_LblRRManualInfo.Text(), /保存或撤销/);
    assert.equal(s.m_CmbRRPosition.Expanded(), false); assert.equal(s.closeCalls.length, 0); assert.equal(s.applyCalls, 0);
});
check('closed selected identity opens chooser but never falls through to another holding', () => {
    const s = fixture(); addPosition(s); addPosition(s, 99); s.selectPosition(42); s.positions.delete(42);
    s.OnClickRRManualClose(); assert.equal(s.m_CmbRRPosition.Expanded(), true);
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.closeCalls.length, 0);
});
check('manual registration rejection remains visible next to action across ordinary refresh', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRClosePercent.Text('25'); s.closeAllowed = false;
    s.OnClickRRManualClose(); assert.match(s.m_LblRRManualInfo.Text(), /等待上次平仓/);
    s.tick += 600; s.RefreshRRLiveStatus(); assert.match(s.m_LblRRManualInfo.Text(), /等待上次平仓/);
    assert.equal(s.status.error, true);
});
check('invalid manual percentage explains the input error beside the button', () => {
    const s = fixture(); addPosition(s); s.selectPosition(42); s.m_EdtRRClosePercent.Text('abc');
    s.OnClickRRManualClose(); assert.match(s.m_LblRRManualInfo.Text(), /大于 0/); assert.equal(s.closeCalls.length, 0);
});


function addGroup(s, id = 123456, overrides = {}) {
    const plan = makePlan(); plan.count = 2;
    plan.targets[0] = { multiple: 2, percent: 50, move_be: 1 };
    plan.targets[1] = { multiple: 5, percent: 25, move_be: 0 };
    const group = { identifier: id, version: 2, stage: 0, blocked: 0, symbol: 'EURUSD', magic: 777, direction: 1,
        entry: 100, risk: 2, initial_volume: 40, volume: 40, tp: 0, building: false, plan, ...overrides };
    s.groups.set(id, group); return group;
}
check('parent dropdown uses a separate negative identity and includes symbol and child ownership', () => {
    const s = fixture(); addGroup(s); addPosition(s, 42, { parent: 123456 }); s.RefreshRRPositionChoices();
    assert.match(s.m_CmbRRPosition.items[1].text, /EURUSD.*父ID 123456/); assert.equal(s.m_CmbRRPosition.items[1].value, -123456);
    assert.match(s.m_CmbRRPosition.items[2].text, /子单 父123456/);
    s.selectPosition(-123456); assert.equal(s.m_rr_group_id, 123456); assert.equal(s.m_rr_position_id, 0);
    assert.equal(s.m_rr_position_magic, 777); assert.equal(s.m_BtnRRSave.Text(), '应用到父组');
    assert.match(s.m_LblRRPrice[0].Text(), /104/); assert.equal(s.closeCalls.length, 0);
});
check('group manual action uses parent and total current remainder without a child request', () => {
    const s = fixture(); const group = addGroup(s); s.selectPosition(-123456); group.volume = 20;
    s.m_EdtRRClosePercent.Text('25'); s.OnClickRRManualClose();
    assert.deepEqual(s.groupCloseCalls, [{ id: 123456, percent: 25, snapshot: 20 }]); assert.equal(s.closeCalls.length, 0);
});
check('group RR save preserves parent CAS state and does not overwrite global defaults or child plans', () => {
    const s = fixture(); const group = addGroup(s); s.selectPosition(-123456); s.m_EdtRRMultiple[1].Text('8'); s.OnClickBtnRRSave();
    assert.equal(group.plan.targets[1].multiple, 8); assert.equal(s.groupApplyCalls.length, 1); assert.equal(s.groupApplyCalls[0].id, 123456);
    assert.equal(s.positionApplyCalls.length, 0); assert.equal(s.applyCalls, 0); assert.equal(s.m_rr_group_id, 123456);
});
check('group membership prevents independent child RR edits or manual closes', () => {
    const s = fixture(); addGroup(s); addPosition(s, 42, { parent: 123456 }); s.selectPosition(42);
    assert.equal(s.m_rr_readonly, true); assert.match(s.m_LblRRMode.Text(), /子单 父123456/);
    s.OnClickBtnRRSave(); s.m_EdtRRClosePercent.Text('50'); s.OnClickRRManualClose();
    assert.equal(s.positionApplyCalls.length, 0); assert.equal(s.closeCalls.length, 0); assert.match(s.status.text, /选择父ID/);
});
check('building group stays selected and read-only and cannot dispatch a partial close', () => {
    const s = fixture(); const group = addGroup(s, 123456, { building: true, initial_volume: 5, volume: 5 }); s.selectPosition(-123456);
    assert.equal(s.m_rr_group_id, 123456); assert.equal(s.m_rr_readonly, true); assert.equal(s.m_BtnRRSave.enabled, false);
    s.m_EdtRRClosePercent.Text('25'); s.OnClickRRManualClose(); assert.equal(s.groupCloseCalls.length, 0); assert.match(s.status.text, /先取消/);
    s.tick += 600; s.RefreshRRLiveStatus(); assert.match(s.m_LblRRPositionInfo.Text(), /建仓中.*5/);
    group.building = false; group.initial_volume = 10; group.volume = 10; s.tick += 600; s.RefreshRRLiveStatus();
    assert.equal(s.m_rr_group_id, 123456); assert.equal(s.m_rr_readonly, false); assert.equal(s.m_rr_state.initial_volume, 10);
});
check('temporary unreadable group stays selected and later loads without falling into new-plan mode', () => {
    const s = fixture(); addGroup(s); s.groupReadable = false; s.selectPosition(-123456);
    assert.equal(s.m_rr_group_id, 123456); assert.equal(s.m_rr_has_plan, false); assert.equal(s.m_rr_readonly, true);
    s.OnClickBtnRRReset(); assert.equal(s.m_rr_group_id, 123456);
    s.groupReadable = true; s.tick += 600; s.RefreshRRLiveStatus(); assert.equal(s.m_rr_has_plan, true); assert.equal(s.m_rr_group_id, 123456);
});
check('group refresh preserves a live edit and locks stale save after a target is triggered', () => {
    const s = fixture(); const group = addGroup(s); s.selectPosition(-123456); s.m_EdtRRMultiple[1].Text('7..'); group.stage = 1;
    s.tick += 600; s.RefreshRRLiveStatus(); assert.equal(s.m_EdtRRMultiple[1].Text(), '7..'); assert.equal(s.m_rr_stale, true);
    s.OnClickBtnRRSave(); assert.equal(s.groupApplyCalls.length, 0); s.OnClickBtnRRReset(); assert.equal(s.m_rr_group_id, 123456);
    assert.equal(s.m_rr_live_stage, 1); assert.equal(s.m_EdtRRMultiple[0].readonly, true); assert.equal(s.m_EdtRRMultiple[1].readonly, false);
});
check('group selection respects unsaved child or global draft and never aliases a positive position id', () => {
    const s = fixture(); addGroup(s, 42); addPosition(s, 42); s.selectPosition(42); s.m_EdtRRMultiple[1].Text('7..'); s.selectPosition(-42);
    assert.equal(s.m_rr_position_id, 42); assert.equal(s.m_rr_group_id, 0); assert.equal(s.m_CmbRRPosition.Value(), 42);
    s.OnClickBtnRRReset(); s.selectPosition(-42); assert.equal(s.m_rr_position_id, 0); assert.equal(s.m_rr_group_id, 42);
});
check('new-plan button deliberately exits parent selection without changing the parent or default plan', () => {
    const s = fixture(); addGroup(s); s.selectPosition(-123456); s.OnClickBtnRRNewPlan();
    assert.equal(s.m_rr_group_id, 0); assert.equal(s.m_CmbRRPosition.Value(), 0); assert.equal(s.groupApplyCalls.length, 0);
});
check('inconsistent child TPs display a pending group sync without a misleading negative price', () => {
    const s = fixture(); addGroup(s, 123456, { tp: -1 }); s.selectPosition(-123456); s.tick += 600; s.RefreshRRLiveStatus();
    assert.match(s.m_LblRRPositionInfo.Text(), /各子单TP待同步/);
});

check('parent chooser hides finished history but retains active unresolved and selected ended groups', () => {
    const s = fixture(); const current = addGroup(s, 101); addGroup(s, 102, { volume: 0 });
    const building = addGroup(s, 103, { volume: 0, building: true }); addGroup(s, 104, { volume: 0, pending: 1 });
    s.RefreshRRPositionChoices(); assert.deepEqual(s.m_CmbRRPosition.items.map(i => i.value), [0, -101, -103, -104]);
    s.selectPosition(-101); current.volume = 0; building.building = false; s.RefreshRRPositionChoices();
    assert.deepEqual(s.m_CmbRRPosition.items.map(i => i.value), [0, -101, -104]);
    assert.match(s.m_CmbRRPosition.items[1].text, /父ID 101.*已结束/); assert.equal(s.m_CmbRRPosition.Value(), -101);
    s.OnClickBtnRRNewPlan(); s.RefreshRRPositionChoices(); assert.deepEqual(s.m_CmbRRPosition.items.map(i => i.value), [0, -104]);
});

console.log(`RR plan UI: ${count} production-method tests passed.`);
