// Production panel methods with mocked native controls/account callbacks only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../mt5/RRTradePanel.mqh', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../mt5/Position Sizer.mqh', import.meta.url), 'utf8');
function extract(name) {
    const sig = new RegExp(`(?:void|bool) CPositionSizeCalculator::${name}\\([^)]*\\)\\s*\\{`).exec(source);
    assert.ok(sig, name); const start = sig.index + sig[0].length; let depth = 1, end = start;
    for (; depth && end < source.length; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
    const body = source.slice(start, end - 1)
        .replace(/\b(?:int|double|ulong|long|string|bool)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:int|double|ulong|long|string|bool)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\((?:int|ulong|long)\)/g, '')
        .replace(/CStringForList\s*\*obj/g, 'let obj')
        .replace('RCSetCloseOpposite(enabled, error)', 'RCSetCloseOpposite(enabled, value => error = value)');
    return `function ${name}() {${body}}`;
}
class Control {
    constructor() { this.text = ''; this.checked = false; this.enabled = true; this.items = []; this.value = 0; this.clearCalls = 0; this.rect = [0, 0, 0, 0]; }
    Text(v) { if (arguments.length) this.text = v; return this.text; }
    Checked(v) { if (arguments.length) this.checked = v; return this.checked; }
    Left() { return this.rect[0]; } Top() { return this.rect[1]; }
    Move(x, y) { this.rect = [x, y, x + this.rect[2] - this.rect[0], y + this.rect[3] - this.rect[1]]; }
    Color(v) { this.color = v; } FontSize(v) { this.font = v; } TextAlign(v) { this.align = v; }
    Enable() { this.enabled = true; } Disable() { this.enabled = false; }
    ItemsClear() { this.items = []; this.clearCalls++; this.value = 0; }
    AddItem(text, value) { this.items.push({ text, value }); }
    Value() { return this.value; }
    Expanded() { return this.expanded || false; }
    Select(i) { if (arguments.length) this.value = this.items[i]?.value || 0; return this.items.find(item => item.value === this.value)?.text || ''; }
}
class List {
    constructor() { this.nodes = []; this.index = 0; }
    GetFirstNode() { this.index = 0; return this.nodes[0] || null; }
    GetNextNode() { return this.nodes[++this.index] || null; }
    MoveListElementByName(name, index) { const i = this.nodes.findIndex(n => n.Name === name); const [node] = this.nodes.splice(i, 1); this.nodes.splice(index, 0, node); }
}
function fixture(scale = 1) {
    const s = {
        first_column_start: Math.round(7 * scale), element_height: Math.round(20 * scale), m_DPIScale: scale,
        MainTabList: new List(), TradingTabList: new List(), m_chart_id: 1, m_name: 'panel',
        m_trade_controls_refresh: 0, m_controls_ready: true, tick: 1000,
        RCCloseOpposite: false, RCReversePending: false, RCPendingStatus: '',
        ALIGN_LEFT: 0, OBJPROP_FONTSIZE: 1, OBJPROP_TOOLTIP: 2, NULL: null, clrFireBrick: 'error', clrDarkSlateGray: 'normal',
        MathRound: Math.round, ClientAreaTop: () => 30, ChartID: () => 1, GetTickCount64: () => s.tick,
        ObjectSetInteger: () => {}, ObjectSetString: (_, name, prop, value) => s.tooltips.set(name, value),
        StringSubstr: (s, from, length) => s.substr(from, length), tooltips: new Map(),
        optionCalls: [], cancelCalls: 0, allowOption: true,
        RCSetCloseOpposite: (enabled, error) => { s.optionCalls.push(enabled); if (!s.allowOption) { error('无法保存开关，请稍后重试。'); return false; } s.RCCloseOpposite = enabled; return true; },
        RCCancelReverse: () => { s.cancelCalls++; s.RCReversePending = false; s.RCPendingStatus = ''; },
    };
    for (const name of [...new Set(source.match(/m_(?:Cmb|Edt|Btn|Chk|Lbl)\w+/g)), 'm_ChkAskForConfirmation']) s[name] = new Control();
    s.m_ChkAskForConfirmation.rect = [7, 330, 310, 350];
    for (const name of ['m_LblEntryLevel', 'm_LblStopPrice', 'm_LblRiskM']) {
        const c = new Control(); c.rect = [7, 69, 310, 89]; s.MainTabList.nodes.push({ Name: name, Obj: c });
    }
    for (const type of ['Edit', 'Button', 'CheckBox', 'Label']) s[type + 'Create'] = (list, c, x1, y1, x2, y2, name, text) => {
        c.rect = [x1, y1 + 30, x2, y2 + 30]; c.Text(text); list.nodes.push({ Name: name, Obj: c }); return true;
    };
    s.ComboBoxCreate = (list, c, x1, y1, x2, y2, name) => s.EditCreate(list, c, x1, y1, x2, y2, name, '');
    vm.createContext(s);
    for (const name of ['CreateTradeControlOptions', 'OnChangeCloseOpposite', 'OnClickCancelReverse', 'RefreshTradeControlStatus']) vm.runInContext(extract(name), s);
    s.CreateTradeControlOptions();
    s.refresh = () => { s.tick += 501; s.RefreshTradeControlStatus(); };
    return s;
}
let count = 0;
function check(name, fn) { fn(); console.log(`ok ${++count} - ${name}`); }
check('creation loads unchecked reverse option without trading callbacks', () => {
    const s = fixture(); assert.equal(s.m_ChkCloseOpposite.Checked(), false);
    assert.equal(s.optionCalls.length, 0); assert.equal(s.cancelCalls, 0);
});
check('reverse checkbox applies account setting through persistence callback only', () => {
    const s = fixture(); s.m_ChkCloseOpposite.Checked(true); s.OnChangeCloseOpposite();
    assert.deepEqual(s.optionCalls, [true]); assert.equal(s.RCCloseOpposite, true);
});
check('failed reverse option save restores the actually applied checkbox and shows the error', () => {
    const s = fixture(); s.allowOption = false; s.m_ChkCloseOpposite.Checked(true); s.OnChangeCloseOpposite();
    assert.equal(s.m_ChkCloseOpposite.Checked(), false); assert.match(s.m_LblReverseStatus.Text(), /无法保存/);
    assert.equal(s.m_LblReverseStatus.color, 'error');
});
check('unchanged checkbox notifications cannot rewrite saved configuration', () => {
    const s = fixture(); s.OnChangeCloseOpposite(); s.refresh(); s.OnChangeCloseOpposite(); assert.equal(s.optionCalls.length, 0);
});
check('live reverse status reflects cross-chart option and actual pending flag', () => {
    const s = fixture(); s.RCCloseOpposite = true; s.RCReversePending = true; s.RCPendingStatus = '等待全部反向仓平完，再提交新单'; s.refresh();
    assert.equal(s.m_ChkCloseOpposite.Checked(), true); assert.equal(s.m_BtnCancelReverse.enabled, true); assert.match(s.m_LblReverseStatus.Text(), /等待/);
});
check('historical text alone does not enable cancel without an active pending reverse', () => {
    const s = fixture(); s.RCPendingStatus = '上次操作已结束'; s.refresh(); assert.equal(s.m_BtnCancelReverse.enabled, false);
});
check('cancel delegates once and refreshes pending-entry status without touching close execution', () => {
    const s = fixture(); s.RCReversePending = true; s.RCPendingStatus = '等待'; s.OnClickCancelReverse();
    assert.equal(s.cancelCalls, 1); assert.equal(s.RCReversePending, false); assert.equal(s.m_BtnCancelReverse.enabled, false);
});
check('refresh before control creation cannot call list or account callbacks', () => {
    const s = fixture(); s.m_controls_ready = false; s.RCCloseOpposite = true; s.RefreshTradeControlStatus();
    assert.equal(s.m_ChkCloseOpposite.Checked(), false); assert.equal(s.optionCalls.length, 0); assert.equal(s.cancelCalls, 0);
});
check('trade-control creation leaves original calculator rows and their positions unchanged', () => {
    const s = fixture(); assert.deepEqual(s.MainTabList.nodes.map(n => n.Name), ['m_LblEntryLevel', 'm_LblStopPrice', 'm_LblRiskM']);
    for (const row of s.MainTabList.nodes) assert.deepEqual(row.Obj.rect, [7, 69, 310, 89]);
});
check('reverse controls fit the panel at standard and fractional DPI', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
        const s = fixture(scale); const right = s.first_column_start + Math.round(307 * scale);
        for (const name of ['m_ChkCloseOpposite', 'm_LblReverseStatus', 'm_BtnCancelReverse'])
            assert.ok(s[name].rect[0] >= s.first_column_start && s[name].rect[2] <= right, `${name} ${scale}`);
        assert.ok(s.m_LblReverseStatus.rect[2] < s.m_BtnCancelReverse.rect[0]);
        assert.equal(s.m_ChkCloseOpposite.Top(), 330 + Math.round(24 * scale));
    }
});
check('position dropdown opts out of the old panel layout file stream', () => {
    const cls = /class CRRPanelComboBox[^]*?\n};/.exec(panelSource)[0];
    assert.match(cls, /Save\([^]*?return true;/); assert.match(cls, /Load\([^]*?return true;/);
    assert.doesNotMatch(source, /\b(?:OrderSend|RMService|Trade|RGManage|PlaySound)\s*\(/);
});

check('dropdown helpers handle hidden lists with stale pressed arrows without selecting or trading', () => {
    for (const method of ['OpenDropDown', 'CloseDropDown']) {
        const signature = new RegExp('bool ' + method + '\\(\\)\\s*\\{').exec(panelSource);
        assert.ok(signature, method); let i = signature.index + signature[0].length, start = i, depth = 1;
        for (; depth; i++) { if (panelSource[i] === '{') depth++; if (panelSource[i] === '}') depth--; }
        const body = panelSource.slice(start, i - 1);
        for (const visible of [false, true]) for (const pressed of [false, true]) {
            const state = { visible, pressed, calls: 0 };
            const boundary = { Expanded: () => state.visible, OnClickEdit: () => {
                state.calls++; state.pressed = !state.pressed; state.visible = state.pressed; return true;
            }};
            vm.createContext(boundary); vm.runInContext('function action() {' + body + '}', boundary);
            assert.equal(boundary.action(), true); assert.equal(state.visible, method === 'OpenDropDown');
            assert.ok(state.calls <= 2);
        }
    }
});

console.log(`RR trade UI: ${count} production-method tests passed.`);
