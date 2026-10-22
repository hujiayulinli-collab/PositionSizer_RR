// Production panel methods with mocked native controls/account callbacks only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../mt5/RRTradePanel.mqh', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../mt5/Position Sizer.mqh', import.meta.url), 'utf8');
function extract(name, content = source) {
    const sig = new RegExp(`(?:void|bool) CPositionSizeCalculator::${name}\\([^)]*\\)\\s*\\{`).exec(content);
    assert.ok(sig, name); const start = sig.index + sig[0].length; let depth = 1, end = start;
    for (; depth && end < content.length; end++) { if (content[end] === '{') depth++; if (content[end] === '}') depth--; }
    const body = content.slice(start, end - 1)
        .replace(/\bdouble lots, interval, deviation;/g, 'let lots, interval, deviation;')
        .replace(/\b(?:int|double|ulong|long|string|bool)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:int|double|ulong|long|string|bool)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\((?:int|ulong|long)\)/g, '')
        .replace(/CStringForList\s*\*obj/g, 'let obj')
        .replace('RCSetCloseOpposite(enabled, error)', 'RCSetCloseOpposite(enabled, value => error = value)')
        .replace(/RRPlanParseNumber\((m_EdtBatch\w+\.Text\(\)), (lots|interval|deviation)\)/g, '(($2 = parseNumber($1)) !== null)')
        .replace('RBSaveSettings(m_ChkBatchEnabled.Checked(), lots, interval, deviation, error)', 'RBSaveSettings(m_ChkBatchEnabled.Checked(), lots, interval, deviation, value => error = value)');
    return `function ${name}() {${body}}`;
}
class Control {
    constructor() { this.text = ''; this.checked = false; this.enabled = true; this.items = []; this.value = 0; this.clearCalls = 0; this.rect = [0, 0, 0, 0]; this.visible = true; }
    Text(v) { if (arguments.length) this.text = v; return this.text; }
    Checked(v) { if (arguments.length) this.checked = v; return this.checked; }
    Left() { return this.rect[0]; } Top() { return this.rect[1]; }
    Move(x, y) { this.rect = [x, y, x + this.rect[2] - this.rect[0], y + this.rect[3] - this.rect[1]]; }
    Show() { this.visible = true; } Hide() { this.visible = false; }
    ColorBackground(v) { this.background = v; }
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
function fixture(scale = 1, savedIntervalMilliseconds = 1000) {
    const s = {
        first_column_start: Math.round(7 * scale), element_height: Math.round(20 * scale), m_DPIScale: scale,
        MainTabList: new List(), TradingTabList: new List(), m_chart_id: 1, m_name: 'panel',
        m_trade_controls_refresh: 0, m_controls_ready: true, tick: 1000, m_trade_batch_page: false,
        sets: { SelectedTab: 4 }, MainTab: 0, RiskTab: 1, MarginTab: 2, SwapsTab: 3, TradingTab: 4, RRTargetsTab: 5, GuardTab: 6,
        m_minimized: false, NoPanelMaximization: false, PanelWidth: 350,
        CONTROLS_BUTTON_COLOR_DISABLE: 'inactive', CONTROLS_BUTTON_COLOR_ENABLE: 'active',
        ChartRedraw: () => {}, StringFind: (s, q) => s.indexOf(q), Height: value => s.height = value, Top: () => 0, Width: () => {},
        RBEnabled: false, RBChildMaxLots: 5, RBIntervalMilliseconds: savedIntervalMilliseconds, RBMaxDeviationPoints: 0,
        m_batch_feedback: '', m_batch_feedback_error: false, batchActive: false, batchStatus: '', batchSaveCalls: [], batchCancelCalls: 0, batchCancelAllowed: true, refreshValuesCalls: 0, batchSaveAllowed: true,
        RBEntryActive: () => s.batchActive, RBStatusText: () => s.batchStatus,
        RBSaveSettings: (enabled, lots, interval, deviation, error) => {
            s.batchSaveCalls.push({ enabled, lots, interval, deviation });
            if (!s.batchSaveAllowed) { error('保存失败；保持原设置'); return false; }
            Object.assign(s, { RBEnabled: enabled, RBChildMaxLots: lots, RBIntervalMilliseconds: interval, RBMaxDeviationPoints: deviation }); return true;
        },
        RBCancelEntry: () => { s.batchCancelCalls++; if (s.batchCancelAllowed) s.batchActive = false; }, RefreshValues: () => s.refreshValuesCalls++,
        parseNumber: text => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim()) && Number.isFinite(Number(text)) ? Number(text) : null,
        IntegerToString: String, DoubleToString: (n,d) => n.toFixed(d), CountDecimalPlaces: n => String(n).split('.')[1]?.length || 0,
        MathFloor: Math.floor,
        RCCloseOpposite: false, RCReversePending: false, RCPendingStatus: '',
        ALIGN_LEFT: 0, OBJPROP_FONTSIZE: 1, OBJPROP_TOOLTIP: 2, NULL: null, clrFireBrick: 'error', clrDarkSlateGray: 'normal',
        MathRound: Math.round, ClientAreaTop: () => 24, ChartID: () => 1, GetTickCount64: () => s.tick,
        ObjectSetInteger: () => {}, ObjectSetString: (_, name, prop, value) => s.tooltips.set(name, value),
        StringSubstr: (s, from, length) => s.substr(from, length), tooltips: new Map(),
        optionCalls: [], cancelCalls: 0, allowOption: true,
        RCSetCloseOpposite: (enabled, error) => { s.optionCalls.push(enabled); if (!s.allowOption) { error('无法保存开关，请稍后重试。'); return false; } s.RCCloseOpposite = enabled; return true; },
        RCCancelReverse: () => { s.cancelCalls++; s.RCReversePending = false; s.RCPendingStatus = ''; },
    };
    for (const name of [...new Set(source.match(/m_(?:Cmb|Edt|Btn|Chk|Lbl)\w+/g)), 'm_ChkAskForConfirmation', 'm_LblURL']) s[name] = new Control();
    const right = s.first_column_start + Math.round(307 * scale);
    s.m_ChkAskForConfirmation.rect = [s.first_column_start, 24 + Math.round(450 * scale), right, 24 + Math.round(470 * scale)];
    s.m_BtnTrade.rect = [s.first_column_start, 24 + Math.round(42 * scale), s.first_column_start + Math.round(50 * scale), 24 + Math.round(62 * scale)];
    s.TradingTabList.nodes.push({ Name: 'm_ChkAskForConfirmation', Obj: s.m_ChkAskForConfirmation }, { Name: 'm_BtnTrade', Obj: s.m_BtnTrade });
    for (const name of ['m_LblEntryLevel', 'm_LblStopPrice', 'm_LblRiskM']) {
        const c = new Control(); c.rect = [7, 69, 310, 89]; s.MainTabList.nodes.push({ Name: name, Obj: c });
    }
    for (const type of ['Edit', 'Button', 'CheckBox', 'Label']) s[type + 'Create'] = (list, c, x1, y1, x2, y2, name, text, tooltip = '') => {
        c.rect = [x1, y1 + 24, x2, y2 + 24]; c.Text(text); c.tooltip = tooltip; list.nodes.push({ Name: name, Obj: c }); return true;
    };
    s.ComboBoxCreate = (list, c, x1, y1, x2, y2, name) => s.EditCreate(list, c, x1, y1, x2, y2, name, '');
    vm.createContext(s);
    for (const name of ['CreateTradeControlOptions', 'OnChangeCloseOpposite', 'OnClickCancelReverse', 'RefreshTradeControlStatus', 'OnClickBatchSave', 'OnClickBatchCancel', 'RefreshBatchStatus', 'OnClickTradeRegularPage', 'OnClickTradeBatchPage', 'RefreshTradingSubpage', 'LayoutTradingSubpage']) vm.runInContext(extract(name), s);
    vm.runInContext(extract('MoveAndResize', panelSource), s);
    s.CreateTradeControlOptions();
    s.MoveAndResize();
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
        assert.equal(s.m_ChkCloseOpposite.Top(), 24 + Math.round(450 * scale) + 2 * Math.round(24 * scale));
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


check('batch setting edits remain unapplied drafts across recurring status refresh', () => {
    const s = fixture(); s.m_ChkBatchEnabled.Checked(true); s.m_EdtBatchLots.Text('2..'); s.m_EdtBatchInterval.Text('3');
    s.refresh(); s.refresh(); assert.equal(s.m_EdtBatchLots.Text(), '2..'); assert.equal(s.m_EdtBatchInterval.Text(), '3');
    assert.equal(s.m_ChkBatchEnabled.Checked(), true); assert.equal(s.RBEnabled, false); assert.equal(s.batchSaveCalls.length, 0);
});
check('saving valid batch settings delegates once and recalculates whole group volume only after persistence', () => {
    const s = fixture(); assert.equal(s.m_EdtBatchLots.Text(), '5'); assert.equal(s.m_EdtBatchInterval.Text(), '1000');
    s.m_ChkBatchEnabled.Checked(true); s.m_EdtBatchLots.Text('2.5'); s.m_EdtBatchInterval.Text('250'); s.m_EdtBatchDeviation.Text('30'); s.OnClickBatchSave();
    assert.deepEqual(s.batchSaveCalls, [{ enabled: true, lots: 2.5, interval: 250, deviation: 30 }]); assert.equal(s.refreshValuesCalls, 1);
    assert.equal(s.RBEnabled, true); assert.equal(s.batchActive, false); assert.equal(s.optionCalls.length, 0);
    assert.match(s.m_batch_feedback, /挂单正常提交、不拆子单/);
});
check('batch help distinguishes market-only splitting from ordinary pending submission', () => {
    const s = fixture();
    assert.match(s.m_ChkBatchEnabled.tooltip, /仅市价分批；挂单正常提交、不拆子单/);
    assert.match(s.m_ChkBatchEnabled.tooltip, /不修改正在执行的父订单/);
    s.RBEnabled = true; s.refresh();
    assert.match(s.tooltips.get('panelm_LblBatchStatus'), /仅市价分批；挂单正常提交、不拆子单/);
    assert.equal(s.batchSaveCalls.length, 0); assert.equal(s.batchCancelCalls, 0);
});
check('real batch warnings and progress retain priority over market-only default help', () => {
    for (const status of ['父ID 123456 · 已成交 15 / 40 手 · 第4个子单等待', '父订单暂停：风控锁定，请检查账户状态。']) {
        const s = fixture(); s.RBEnabled = true; s.batchActive = true; s.batchStatus = status; s.refresh();
        assert.equal(s.tooltips.get('panelm_LblBatchStatus'), status);
        assert.equal(s.m_LblBatchStatus.Text(), status.substr(0, 25));
        assert.equal(s.m_BtnBatchCancel.enabled, true); assert.equal(s.batchCancelCalls, 0);
    }
});
check('malformed or unsafe batch values cannot reach persistence or alter calculator sizing', () => {
    for (const [field, value] of [['Lots', '0'], ['Lots', '-5'], ['Lots', '2..'], ['Interval', '0'], ['Interval', '1'], ['Interval', '99'], ['Interval', '100.5'], ['Interval', '250.5'], ['Interval', '3600001'], ['Interval', '100ms'], ['Deviation', '-1'], ['Deviation', '1.5'], ['Deviation', '2147483648']]) {
        const s = fixture(); s['m_EdtBatch' + field].Text(value); s.OnClickBatchSave();
        assert.equal(s.batchSaveCalls.length, 0, field + value); assert.equal(s.refreshValuesCalls, 0); assert.equal(s.m_batch_feedback_error, true);
        assert.match(s.m_LblBatchStatus.Text(), /每子手数须大于0/);
        assert.match(s.m_batch_feedback, /100–3600000整数毫秒/);
    }
});
check('millisecond input accepts minimum, subsecond, one-second and maximum integer settings without conversion', () => {
    for (const interval of [100, 250, 1000, 3600000]) {
        const s = fixture(); s.m_ChkBatchEnabled.Checked(true); s.m_EdtBatchInterval.Text(String(interval)); s.OnClickBatchSave();
        assert.deepEqual(s.batchSaveCalls, [{ enabled: true, lots: 5, interval, deviation: 0 }]);
        assert.equal(s.RBIntervalMilliseconds, interval); assert.equal(s.m_batch_feedback_error, false);
        assert.equal(s.refreshValuesCalls, 1);
    }
});
check('creation displays saved milliseconds and explains confirmation barrier without changing stored settings', () => {
    for (const interval of [100, 250, 1000, 3600000]) {
        const s = fixture(1, interval);
        assert.equal(s.m_LblBatchInterval.Text(), '间隔（毫秒）');
        assert.equal(s.m_EdtBatchInterval.Text(), String(interval)); assert.equal(s.batchSaveCalls.length, 0);
        const tooltip = s.tooltips.get('panelm_EdtBatchInterval');
        assert.match(tooltip, /100毫秒=0.1秒/); assert.match(tooltip, /上一子单成交和止损确认/); assert.match(tooltip, /仅影响新父订单/);
    }
});
check('active group rejection preserves saved interval, editable draft and queue without cancelling or entering trades', () => {
    const s = fixture(); s.batchActive = true;
    s.RBSaveSettings = (enabled, lots, interval, deviation, error) => {
        s.batchSaveCalls.push({ enabled, lots, interval, deviation });
        error('当前有父订单正在分批开仓，请结束或取消后再修改设置。'); return false;
    };
    s.m_EdtBatchInterval.Text('100'); s.OnClickBatchSave();
    assert.equal(s.batchActive, true); assert.equal(s.batchCancelCalls, 0); assert.equal(s.cancelCalls, 0);
    assert.equal(s.m_EdtBatchInterval.Text(), '100'); assert.equal(s.RBIntervalMilliseconds, 1000);
    assert.equal(s.batchSaveCalls.length, 1); assert.equal(s.refreshValuesCalls, 0); assert.equal(s.optionCalls.length, 0);
    assert.equal(s.m_batch_feedback_error, true); assert.match(s.m_batch_feedback, /当前有父订单正在分批开仓/);
    assert.match(s.m_LblBatchStatus.Text(), /当前有父订单正在分批开仓/);
    assert.equal(s.m_BtnBatchCancel.enabled, true);
});
check('failed batch persistence retains draft and old effective values with visible error', () => {
    const s = fixture(); s.batchSaveAllowed = false; s.m_EdtBatchLots.Text('3'); s.OnClickBatchSave();
    assert.equal(s.m_EdtBatchLots.Text(), '3'); assert.equal(s.RBChildMaxLots, 5); assert.equal(s.refreshValuesCalls, 0);
    assert.match(s.m_LblBatchStatus.Text(), /保存失败/); assert.equal(s.m_LblBatchStatus.color, 'error');
});
check('batch cancellation affects only entry queue and preserves editable settings', () => {
    const s = fixture(); s.batchActive = true; s.m_EdtBatchLots.Text('3..'); s.refresh(); assert.equal(s.m_BtnBatchCancel.enabled, true);
    s.OnClickBatchCancel(); assert.equal(s.batchCancelCalls, 1); assert.equal(s.cancelCalls, 0); assert.equal(s.batchSaveCalls.length, 0);
    assert.equal(s.m_BtnBatchCancel.enabled, false); assert.equal(s.m_EdtBatchLots.Text(), '3..'); assert.match(s.m_batch_feedback, /已成交仓位继续保留/);
});
check('batch progress can show parent id and fill total without replacing active drafts', () => {
    const s = fixture(); s.batchStatus = '父ID 123456 · 已成交 15 / 40 手 · 第4个子单等待'; s.batchActive = true; s.refresh();
    assert.match(s.m_LblBatchStatus.Text() + s.m_LblBatchStatus2.Text(), /父ID 123456.*15.*40.*第4/);
    assert.equal(s.tooltips.get('panelm_LblBatchStatus'), s.batchStatus); assert.equal(s.m_BtnBatchCancel.enabled, true);
});
check('batch rows have no overlaps and resize reference includes all progress rows at each DPI', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
        const s = fixture(scale), right = s.first_column_start + Math.round(307 * scale);
        for (const { Obj: c, Name } of s.TradingTabList.nodes) assert.ok(c.rect[0] >= s.first_column_start && c.rect[2] <= right, Name);
        const rows = ['m_BtnTradeBatchPage', 'm_BtnTrade', 'm_ChkBatchEnabled', 'm_EdtBatchLots', 'm_EdtBatchDeviation', 'm_BtnBatchSave', 'm_LblBatchStatus', 'm_LblBatchStatus2', 'm_LblBatchStatus3'];
        for (let i = 1; i < rows.length; i++) assert.ok(s[rows[i-1]].rect[3] < s[rows[i]].rect[1], rows[i]);
        assert.ok(s.m_LblBatchLots.rect[2] < s.m_EdtBatchLots.rect[0]); assert.ok(s.m_EdtBatchLots.rect[2] < s.m_LblBatchInterval.rect[0]);
        assert.ok(s.m_LblBatchInterval.rect[2] < s.m_EdtBatchInterval.rect[0]); assert.ok(s.m_BtnBatchSave.rect[2] < s.m_BtnBatchCancel.rect[0]);
    }
    assert.match(panelSource, /ref_point = m_trade_batch_page \? m_LblBatchStatus3.Top\(\) : m_LblReverseStatus.Top\(\)/);
    assert.match(panelSource, /CRRPlanCheckBox\s+m_ChkBatchEnabled/);
});

check('cancel failure stays actionable and reports unfinished cancellation without claiming success', () => {
    const s = fixture(); s.batchActive = true; s.batchCancelAllowed = false; s.batchStatus = '父订单正在处理，稍后重试取消。';
    s.OnClickBatchCancel(); assert.equal(s.batchActive, true); assert.equal(s.m_BtnBatchCancel.enabled, true);
    assert.equal(s.m_batch_feedback_error, true); assert.match(s.m_LblBatchStatus.Text(), /取消尚未完成/);
    assert.doesNotMatch(s.m_batch_feedback, /已取消/); assert.equal(s.batchCancelCalls, 1);
});


check('trade subpages preserve edits and keep trade action while hiding irrelevant controls', () => {
    const s = fixture(); assert.equal(s.m_ChkCloseOpposite.visible, true); assert.equal(s.m_ChkBatchEnabled.visible, false);
    s.m_EdtBatchLots.Text('3..'); s.OnClickTradeBatchPage();
    assert.equal(s.m_trade_batch_page, true); assert.equal(s.m_BtnTrade.visible, true); assert.equal(s.m_ChkBatchEnabled.visible, true);
    assert.equal(s.m_ChkCloseOpposite.visible, false); assert.equal(s.m_ChkAskForConfirmation.visible, false);
    assert.equal(s.m_BtnTradeBatchPage.background, 'active'); assert.equal(s.batchSaveCalls.length, 0);
    s.OnClickTradeRegularPage(); assert.equal(s.m_EdtBatchLots.Text(), '3..'); assert.equal(s.m_ChkBatchEnabled.visible, false);
    assert.equal(s.m_BtnTradeRegularPage.background, 'active'); assert.equal(s.m_BtnTrade.visible, true);
});
check('real trading layout stays compact on both subpages at 100 to 200 percent DPI', () => {
    for (const scale of [1, 1.25, 1.5, 2]) {
        const s = fixture(scale); const ordinaryHeight = s.height;
        assert.equal(ordinaryHeight, 24 + Math.round(450 * scale) + 5 * Math.round(24 * scale));
        assert.ok(ordinaryHeight <= 600 * scale, String(scale));
        s.OnClickTradeBatchPage(); const batchHeight = s.height;
        assert.equal(batchHeight, 24 + Math.round(42 * scale) + 10 * Math.round(24 * scale));
        assert.ok(batchHeight <= 310 * scale, String(scale));
        assert.ok(s.m_BtnTradeRegularPage.rect[3] < s.m_BtnTrade.rect[1]);
        assert.ok(s.m_BtnTrade.rect[3] < s.m_ChkBatchEnabled.rect[1]);
        assert.ok(s.m_LblBatchStatus3.rect[3] < s.m_LblURL.Top());
        s.OnClickTradeRegularPage(); assert.equal(s.height, ordinaryHeight);
    }
});
check('subpage visibility honors newly inserted TP controls and historical hidden flags', () => {
    const s = fixture(); s.OnClickTradeBatchPage();
    const dynamic = new Control(), removed = new Control();
    s.TradingTabList.nodes.push({ Name: 'm_EdtTradingTPEdit2', Obj: dynamic, Hidden: false }, { Name: 'm_EdtTradingTPEdit3', Obj: removed, Hidden: true });
    // Dynamic TP insertion may shift every later node; layout restores subpage anchors.
    s.m_BtnTradeBatchPage.Move(s.m_BtnTradeBatchPage.Left(), 999); s.MoveAndResize();
    assert.equal(dynamic.visible, false); assert.equal(removed.visible, false); assert.equal(s.m_BtnTradeBatchPage.Top(), 66);
    s.OnClickTradeRegularPage(); assert.equal(dynamic.visible, true); assert.equal(removed.visible, false);
    s.sets.SelectedTab = 0; s.RefreshTradingSubpage(); assert.ok(s.TradingTabList.nodes.every(n => !n.Obj.visible));
    s.sets.SelectedTab = 4; s.m_minimized = true; s.RefreshTradingSubpage(); assert.ok(s.TradingTabList.nodes.every(n => !n.Obj.visible));
    s.m_minimized = false; s.RefreshTradingSubpage(); assert.equal(dynamic.visible, true); assert.equal(removed.visible, false);
});
check('subpage callbacks before readiness cannot touch panel layout or selection', () => {
    const s = fixture(); s.m_controls_ready = false; const height = s.height;
    s.OnClickTradeBatchPage(); s.LayoutTradingSubpage(); s.RefreshTradingSubpage();
    assert.equal(s.m_trade_batch_page, false); assert.equal(s.height, height);
});

console.log(`RR trade UI: ${count} production-method tests passed.`);

