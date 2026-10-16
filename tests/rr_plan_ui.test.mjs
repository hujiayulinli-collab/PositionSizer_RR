// Execute the production draft editor methods against a small UI boundary.
// No orders, files in the MT5 data directory, or live terminals are touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRPlanPanel.mqh', import.meta.url), 'utf8');
function extract(name) {
    const match = new RegExp(`void CPositionSizeCalculator::${name}\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Production function ${name} exists`);
    const start = match.index + match[0].length;
    let depth = 1, end = start;
    for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    const args = match[1].split(',').filter(Boolean).map(s => s.trim().split(/\s+/).at(-1));
    let body = source.slice(start, end - 1)
        .replace(/\bRRPlan draft;/g, 'let draft = makePlan();')
        .replace(/\b(?:double|string|int|bool)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:double|string|int|bool)\s+(?=\w+\s*=)/g, 'let ')
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
        m_rr_multiple: Array(20).fill(''), m_rr_percent: Array(20).fill(''), m_rr_be: Array(20).fill(false),
        m_LblRRPage: new Control(), m_BtnRRPrevious: new Control(), m_BtnRRNext: new Control(), m_BtnRRAdd: new Control(),
        DoubleToString: v => String(v), CountDecimalPlaces: () => 2, IntegerToString: String,
        ChartRedraw: () => {}, parseNumber, makePlan, ZeroMemory: () => {},
        parseInto: (text, target, field) => { const value = parseNumber(text); if (value === null) return false; target[field] = value; return true; },
        canEdit: true, applyAllowed: true, canEditCalls: 0, applyCalls: 0, updates: [],
        SymbolForTrading: 'AUDUSD', sets: { MagicNumber: 123, TPMultiplier: 2 },
    };
    for (const name of ['m_LblRRNumber', 'm_EdtRRMultiple', 'm_EdtRRPercent', 'm_ChkRRBreakEven', 'm_BtnRRDelete'])
        s[name] = Array.from({ length: 5 }, () => new Control());
    s.SetRRStatus = (text, error = false) => { s.status = { text, error }; };
    s.RRPlanCanEdit = () => { s.canEditCalls++; return s.canEdit; };
    s.RRPlanApply = plan => { s.applyCalls++; if (!s.applyAllowed) return false; s.RRActivePlan = structuredClone(plan); return true; };
    s.RRPlanFinalR = () => s.RRActivePlan.targets[s.RRActivePlan.count - 1].multiple;
    s.ProcessTPChange = value => s.updates.push(['TP', value]);
    s.RefreshValues = () => s.updates.push(['refresh']);
    s.SaveSettingsOnDisk = symbol => s.updates.push(['settings', symbol]);
    const context = vm.createContext(s);
    for (const name of ['LoadRRDraft', 'CaptureRRPage', 'RenderRRPage', 'OnClickBtnRRAdd', 'OnClickBtnRRDelete',
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
console.log(`RR plan UI: ${count} production-method tests passed.`);
