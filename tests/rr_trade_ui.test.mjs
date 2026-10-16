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
        .replace('RCSwitchSymbol(symbol, error)', 'RCSwitchSymbol(symbol, value => error = value)')
        .replace('RCSetCloseOpposite(enabled, error)', 'RCSetCloseOpposite(enabled, value => error = value)')
        .replace('StringTrimLeft(symbol);', 'symbol = symbol.trimStart();')
        .replace('StringTrimRight(symbol);', 'symbol = symbol.trimEnd();');
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
        MainTabList: new List(), TradingTabList: new List(), m_chart_id: 1, m_name: 'panel', SymbolForTrading: 'AUDUSD',
        m_trade_symbol_choices: '', m_trade_view_symbol: '', m_trade_symbol_selection: '', m_trade_controls_refresh: 0, m_controls_ready: true, tick: 1000,
        m_minimized: false, MainTab: 'main', sets: { SelectedTab: 'main' },
        RCCloseOpposite: false, RCReversePending: false, RCPendingStatus: '', m_rr_dirty: false, m_guard_dirty: false,
        ALIGN_LEFT: 0, OBJPROP_FONTSIZE: 1, OBJPROP_TOOLTIP: 2, NULL: null, clrFireBrick: 'error', clrDarkSlateGray: 'normal',
        MathRound: Math.round, ClientAreaTop: () => 30, ChartID: () => 1, GetTickCount64: () => s.tick,
        ObjectSetInteger: () => {}, ObjectSetString: (_, name, prop, value) => s.tooltips.set(name, value),
        StringSubstr: (s, from, length) => s.substr(from, length), symbols: ['AUDUSD', 'XAUUSD', 'EURUSD.a'],
        SymbolsTotal: () => s.symbols.length, SymbolName: index => s.symbols[index], tooltips: new Map(),
        captureCalls: 0, CaptureRRPage: () => { s.captureCalls++; }, CaptureGuardDraft: () => {},
        switchCalls: [], optionCalls: [], cancelCalls: 0, allowSwitch: true, allowOption: true,
        RCSwitchSymbol: (symbol, error) => { s.switchCalls.push(symbol); if (!s.allowSwitch) error('正在等待反向开仓，请先取消后续开仓。'); return s.allowSwitch; },
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
    for (const name of ['CreateTradeControlOptions', 'RefreshTradeSymbolChoices', 'OnChangeTradeSymbol', 'HasRRDraftChanges',
        'OnClickSwitchSymbol', 'OnChangeCloseOpposite', 'OnClickCancelReverse', 'RefreshTradeControlStatus']) vm.runInContext(extract(name), s);
    s.CreateTradeControlOptions();
    s.refresh = () => { s.tick += 501; s.RefreshTradeControlStatus(); };
    return s;
}
let count = 0;
function check(name, fn) { fn(); console.log(`ok ${++count} - ${name}`); }
check('creation loads current symbol and unchecked reverse option without trading callbacks', () => {
    const s = fixture(); assert.equal(s.m_EdtTradeSymbol.Text(), 'AUDUSD'); assert.equal(s.m_ChkCloseOpposite.Checked(), false);
    assert.equal(s.switchCalls.length, 0); assert.equal(s.optionCalls.length, 0); assert.equal(s.cancelCalls, 0);
});
check('symbol dropdown preserves broker suffixes and only writes the custom edit', () => {
    const s = fixture(); s.m_CmbTradeSymbol.Select(3); s.OnChangeTradeSymbol();
    assert.equal(s.m_EdtTradeSymbol.Text(), 'EURUSD.a'); assert.equal(s.switchCalls.length, 0);
});
check('custom symbol is trimmed and submitted only when switch is explicitly clicked', () => {
    const s = fixture(); s.m_EdtTradeSymbol.Text(' XAUUSD.pro '); s.OnClickSwitchSymbol();
    assert.deepEqual(s.switchCalls, ['XAUUSD.pro']); assert.match(s.m_LblSymbolStatus.Text(), /正在切换/);
});
check('RR draft blocks symbol switching and remains untouched', () => {
    const s = fixture(); s.m_rr_dirty = true; s.OnClickSwitchSymbol();
    assert.equal(s.switchCalls.length, 0); assert.equal(s.m_rr_dirty, true); assert.match(s.m_LblSymbolStatus.Text(), /先保存或撤销/);
});
check('risk-setting draft also blocks symbol switching so reinitialization cannot discard it', () => {
    const s = fixture(); s.m_guard_dirty = true; s.OnClickSwitchSymbol(); assert.equal(s.switchCalls.length, 0);
});
check('backend rejection is reported with the full error in its tooltip', () => {
    const s = fixture(); s.allowSwitch = false; s.OnClickSwitchSymbol(); assert.equal(s.m_LblSymbolStatus.color, 'error');
    assert.match(s.tooltips.get('panelm_LblSymbolStatus'), /取消后续开仓/);
});
check('unchanged Market Watch list is not rebuilt on every quote', () => {
    const s = fixture(); const clears = s.m_CmbTradeSymbol.clearCalls; s.refresh(); s.refresh();
    assert.equal(s.m_CmbTradeSymbol.clearCalls, clears);
});
check('Market Watch changes never overwrite a typed exact symbol', () => {
    const s = fixture(); s.m_EdtTradeSymbol.Text('BTCUSD.m'); s.symbols.push('US30'); s.refresh(); s.OnChangeTradeSymbol();
    assert.equal(s.m_EdtTradeSymbol.Text(), 'BTCUSD.m'); assert.equal(s.m_CmbTradeSymbol.items.at(-1).text, 'US30');
});
check('expanded symbol dropdown and queued choice survive a concurrent Market Watch change', () => {
    const s = fixture(); s.m_CmbTradeSymbol.expanded = true; s.symbols.push('US30'); s.refresh();
    assert.equal(s.m_CmbTradeSymbol.items.length, 4);
    s.m_CmbTradeSymbol.expanded = false; s.m_CmbTradeSymbol.Select(3); s.refresh();
    assert.equal(s.m_CmbTradeSymbol.items.length, 4); assert.equal(s.m_CmbTradeSymbol.Select(), 'EURUSD.a');
    s.OnChangeTradeSymbol(); s.refresh(); assert.equal(s.m_EdtTradeSymbol.Text(), 'EURUSD.a');
    assert.equal(s.m_CmbTradeSymbol.items.length, 5);
});
check('hidden or minimized Main page does not poll the symbol inventory', () => {
    const s = fixture(); let scans = 0; s.SymbolsTotal = () => { scans++; return s.symbols.length; };
    s.sets.SelectedTab = 'RR'; s.refresh(); assert.equal(scans, 0);
    s.sets.SelectedTab = 'main'; s.m_minimized = true; s.refresh(); assert.equal(scans, 0);
    s.m_minimized = false; s.refresh(); assert.ok(scans > 0);
});
check('completed chart symbol change updates the preserved panel instead of showing its old symbol', () => {
    const s = fixture(); s.m_EdtTradeSymbol.Text('XAUUSD'); s.OnClickSwitchSymbol();
    s.SymbolForTrading = 'XAUUSD'; s.refresh(); assert.equal(s.m_EdtTradeSymbol.Text(), 'XAUUSD');
    assert.equal(s.m_LblSymbolStatus.Text(), '当前图表 / 下单品种：XAUUSD');
    s.SymbolForTrading = 'EURUSD.a'; s.refresh(); assert.equal(s.m_EdtTradeSymbol.Text(), 'EURUSD.a');
});
check('reverse checkbox applies account setting through persistence callback only', () => {
    const s = fixture(); s.m_ChkCloseOpposite.Checked(true); s.OnChangeCloseOpposite();
    assert.deepEqual(s.optionCalls, [true]); assert.equal(s.RCCloseOpposite, true); assert.equal(s.switchCalls.length, 0);
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
    assert.equal(s.m_ChkCloseOpposite.Checked(), false); assert.equal(s.HasRRDraftChanges(), false); assert.equal(s.captureCalls, 0);
});
check('symbol selector remains before dynamic TP rows in the main list', () => {
    const s = fixture(); assert.deepEqual(s.MainTabList.nodes.slice(0, 4).map(n => n.Name), ['m_CmbTradeSymbol', 'm_EdtTradeSymbol', 'm_BtnSwitchSymbol', 'm_LblSymbolStatus']);
    const marker = s.MainTabList.nodes.findIndex(n => n.Name === 'm_LblStopPrice');
    assert.ok(marker > 3); assert.equal(s.MainTabList.nodes[4].Obj.Top(), 121);
});
check('symbol and reverse controls fit the panel at standard and fractional DPI', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
        const s = fixture(scale); const right = s.first_column_start + Math.round(307 * scale);
        for (const name of ['m_CmbTradeSymbol', 'm_EdtTradeSymbol', 'm_BtnSwitchSymbol', 'm_LblSymbolStatus', 'm_ChkCloseOpposite', 'm_LblReverseStatus', 'm_BtnCancelReverse'])
            assert.ok(s[name].rect[0] >= s.first_column_start && s[name].rect[2] <= right, `${name} ${scale}`);
        assert.ok(s.m_CmbTradeSymbol.rect[2] < s.m_EdtTradeSymbol.rect[0]);
        assert.ok(s.m_EdtTradeSymbol.rect[2] < s.m_BtnSwitchSymbol.rect[0]);
        assert.equal(s.m_ChkCloseOpposite.Top(), 330 + Math.round(24 * scale));
    }
});
check('new dropdown controls opt out of the old panel layout file stream', () => {
    const cls = /class CRRPanelComboBox[^]*?\n};/.exec(panelSource)[0];
    assert.match(cls, /Save\([^]*?return true;/); assert.match(cls, /Load\([^]*?return true;/);
    assert.doesNotMatch(source, /\b(?:OrderSend|RMService|Trade|RGManage|PlaySound)\s*\(/);
});
console.log(`RR trade UI: ${count} production-method tests passed.`);
