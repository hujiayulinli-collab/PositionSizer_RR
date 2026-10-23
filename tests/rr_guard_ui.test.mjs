// Actual panel methods, with an in-memory control/configuration boundary.
// No MT5 process, UI automation, settings-file writes, sounds, or trades.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRGuardPanel.mqh', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../mt5/Position Sizer.mqh', import.meta.url), 'utf8');
function adapt(body) {
    return body.replace(/\b(?:double|int|ulong|uint|string|bool)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:double|int|ulong|uint|string|bool)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\(int\)/g, '')
        .replace(/CStringForList\s*\*\s*obj/g, 'let obj')
        .replace(/m_guard_saved = m_guard_draft;/g, 'm_guard_saved = structuredClone(m_guard_draft);')
        .replace('RRPlanParseNumber(m_guard_draft.single, single)', '((single = parseNumber(m_guard_draft.single)) !== null)')
        .replace('RRPlanParseNumber(m_guard_draft.daily, daily)', '((daily = parseNumber(m_guard_draft.daily)) !== null)')
        .replace('m_guard_draft.loss_wav, m_guard_revision, error)', 'm_guard_draft.loss_wav, m_guard_revision, value => error = value)');
}
function extract(name) {
    const signature = new RegExp(`(?:void|bool) CPositionSizeCalculator::${name}\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(signature, name);
    let depth = 1, end = signature.index + signature[0].length, start = end;
    for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    const args = signature[1].split(',').filter(Boolean).map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    return `function ${name}(${args.join(',')}) {${adapt(source.slice(start, end - 1))}}`;
}
class Control {
    constructor() { this.text = ''; this.checked = false; this.visible = false; this.enabled = true; }
    Text(value) { if (arguments.length) this.text = value; return this.text; }
    Checked(value) { if (arguments.length) this.checked = value; return this.checked; }
    FontSize(value) { this.fontSize = value; }
    TextAlign(value) { this.align = value; }
    Color(value) { this.color = value; }
    ColorBackground(value) { this.background = value; }
    Enable() { this.enabled = true; }
    Disable() { this.enabled = false; }
    Show() { this.visible = true; }
    Hide() { this.visible = false; }
}
class PanelList {
    constructor() { this.nodes = []; this.index = 0; }
    GetFirstNode() { this.index = 0; return this.nodes[0] || null; }
    GetNextNode() { return this.nodes[++this.index] || null; }
}
const blankDraft = () => ({ single: '', daily: '', scope: 0, show_status: false, sound: false, trade_wav: '', loss_wav: '' });
function parseNumber(value) {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
    const result = Number(value); return Number.isFinite(result) ? result : null;
}
function fixture() {
    const s = {
        m_guard_draft: blankDraft(), m_guard_saved: blankDraft(), m_guard_visible: false, m_guard_dirty: false,
        m_guard_stale: false, m_guard_revision: 0, m_guard_account_key: '', m_guard_last_refresh: 0,
        m_controls_ready: true, m_minimized: false, m_name: 'panel', GuardTabList: new PanelList(),
        RGSettingsReady: true, RGSettingsRevision: 1, RGSettingsAccountKey: 'Demo|123', actualKey: 'Demo|123',
        RGSettingsError: '', RGSettingsHaveDefaults: true, storedExists: true,
        RGCurrentPositionLossLimit: 500, RGCurrentPositionScope: 0, RGCurrentDailyLossLimit: 2000, RGCurrentShowStatus: true,
        RDCurrentEnableTradeSound: true, RDCurrentTradeSound: 'ok.wav', RDCurrentLossSound: 'alert.wav',
        RGDailyLocked: false, RGEntryBlocked: false, RGSnapshotReady: true, RGRealized: -250, RGFloating: -50, RGStatus: '监控中',
        RG_OWN_MAGIC: 0, RG_ENTIRE_ACCOUNT: 1, tick: 1000, ACCOUNT_CURRENCY: 1, currency: 'USD',
        GuardTab: 6, sets: { SelectedTab: 0 }, first_column_start: 7, element_height: 20, m_DPIScale: 1,
        ALIGN_RIGHT: 1, ALIGN_LEFT: 0, OBJPROP_TOOLTIP: 1, clrFireBrick: 'error', clrDarkSlateGray: 'normal',
        NULL: null, POINTER_INVALID: 'invalid', CONTROLS_BUTTON_COLOR_DISABLE: 0, CONTROLS_BUTTON_COLOR_ENABLE: 1,
        parseNumber, structuredClone, MathRound: Math.round, MathMax: Math.max,
        RRPanelScaleFont: points => Math.max(6, Math.round(points * s.m_DPIScale)),
        DoubleToString: (v, digits) => v.toFixed(digits),
        CountDecimalPlaces: v => { for (let i = 0; i < 100; i++) if (Math.abs(Math.round(v * 10 ** i) / 10 ** i - v) < 1e-8) return i; return -1; },
        StringSubstr: (v, start, length) => v.substr(start, length),
        ChartID: () => 1, ChartRedraw: () => {}, GetTickCount64: () => s.tick, AccountInfoString: () => s.currency,
        ZeroMemory: value => Object.assign(value, blankDraft()),
        CheckPointer: value => value ? 'valid' : 'invalid', RGSettingsCurrentKey: () => s.actualKey,
        RGSettingsFileName: () => 'settings.bin', FileIsExist: () => s.storedExists,
        RGSyncSettings: () => { if (s.onSync) s.onSync(); },
        calls: [], events: [], tooltips: new Map(), allowSave: true,
        ObjectSetString: (_, name, prop, value) => s.tooltips.set(name, value),
        MoveAndResize: () => s.events.push('resize'),
    };
    for (const name of new Set(source.match(/m_(?:Btn|Lbl|Edt|Chk)\w+/g))) s[name] = new Control();
    for (const type of ['Label', 'Edit', 'Button', 'CheckBox']) s[type + 'Create'] = (list, control, x1, y1, x2, y2, name, text) => {
        Object.assign(control, { rect: [x1, y1, x2, y2], name }); control.Text(text); list.nodes.push({ Obj: control }); return true;
    };
    for (const tab of ['Main', 'Risk', 'Margin', 'Swaps', 'Trading', 'RR']) s['Hide' + tab] = () => s.events.push('hide:' + tab);
    s.RGSaveSettings = (single, scope, daily, show, sound, trade, loss, revision, setError) => {
        s.calls.push({ single, scope, daily, show, sound, trade, loss, revision });
        if (s.beforeSave) s.beforeSave();
        if (!s.allowSave || revision !== s.RGSettingsRevision || !trade.endsWith('.wav') || !loss.endsWith('.wav')) {
            setError('保存未确认，请重新载入核对。'); return false;
        }
        Object.assign(s, { RGCurrentPositionLossLimit: single, RGCurrentPositionScope: scope, RGCurrentDailyLossLimit: daily,
            RGCurrentShowStatus: show, RDCurrentEnableTradeSound: sound, RDCurrentTradeSound: trade, RDCurrentLossSound: loss,
            RGSettingsRevision: revision + 1, RGSettingsReady: true, storedExists: true }); return true;
    };
    vm.createContext(s);
    for (const name of ['CreateGuardControls', 'GuardSettingsEditable', 'LoadGuardDraft', 'RenderGuardDraft', 'CaptureGuardDraft',
        'SetGuardStatus', 'OnGuardDraftChanged', 'OnClickBtnGuardScope', 'OnClickBtnGuardReset', 'OnClickBtnGuardSave',
        'RefreshGuardLiveStatus', 'HideGuard', 'ShowGuard', 'OnClickBtnTabGuard']) vm.runInContext(extract(name), s);
    s.CreateGuardControls();
    s.status = () => s.tooltips.get('panelm_LblGuardStatus');
    s.refresh = () => { s.tick += 501; s.RefreshGuardLiveStatus(); };
    return s;
}
let count = 0;
function check(name, test) { test(); console.log(`ok ${++count} - ${name}`); }

check('initial controls load all seven current saved account values', () => {
    const s = fixture(); assert.equal(s.m_EdtGuardSingle.Text(), '500'); assert.equal(s.m_EdtGuardDaily.Text(), '2000');
    assert.equal(s.m_ChkGuardShowStatus.Checked(), true); assert.equal(s.m_ChkGuardTradeSound.Checked(), true);
    assert.equal(s.m_EdtGuardTradeSound.Text(), 'ok.wav'); assert.equal(s.m_EdtGuardLossSound.Text(), 'alert.wav');
    assert.equal(s.m_guard_revision, 1); assert.equal(s.m_guard_account_key, 'Demo|123');
});
check('typing scope and checkbox changes stay drafts without changing active settings', () => {
    const s = fixture(); s.m_EdtGuardSingle.Text('125'); s.m_EdtGuardDaily.Text('900'); s.m_ChkGuardTradeSound.Checked(false);
    s.m_ChkGuardShowStatus.Checked(false); s.m_EdtGuardTradeSound.Text('custom.wav'); s.OnClickBtnGuardScope(); s.OnGuardDraftChanged();
    assert.equal(s.m_guard_draft.scope, 1); assert.equal(s.m_guard_dirty, true); assert.equal(s.calls.length, 0);
    assert.equal(s.RGCurrentPositionLossLimit, 500); assert.equal(s.RGCurrentDailyLossLimit, 2000);
    assert.equal(s.RDCurrentEnableTradeSound, true); assert.equal(s.RGCurrentShowStatus, true); assert.equal(s.RGCurrentPositionScope, 0);
});
check('valid explicit save applies exact draft values with the loaded revision', () => {
    const s = fixture(); s.m_EdtGuardSingle.Text('125.25'); s.m_EdtGuardDaily.Text('900'); s.OnClickBtnGuardScope();
    s.m_ChkGuardTradeSound.Checked(false); s.m_ChkGuardShowStatus.Checked(false); s.m_EdtGuardLossSound.Text('loss.wav'); s.OnClickBtnGuardSave();
    assert.deepEqual(s.calls, [{ single: 125.25, scope: 1, daily: 900, show: false, sound: false, trade: 'ok.wav', loss: 'loss.wav', revision: 1 }]);
    assert.equal(s.RGCurrentPositionLossLimit, 125.25); assert.equal(s.m_guard_revision, 2); assert.equal(s.m_guard_dirty, false);
});
check('blank malformed negative and nonfinite amounts never become accidental zero limits', () => {
    for (const value of ['', ' ', 'abc', '-1', '1..2', '1,000', 'Infinity']) {
        const s = fixture(); s.m_EdtGuardDaily.Text(value); s.OnClickBtnGuardSave();
        assert.equal(s.calls.length, 0, value); assert.equal(s.RGCurrentDailyLossLimit, 2000); assert.match(s.status(), /非负数字/);
    }
});
check('zero caps are accepted only through an explicit valid save', () => {
    const s = fixture(); s.m_EdtGuardSingle.Text('0'); s.m_EdtGuardDaily.Text('0'); s.OnClickBtnGuardSave();
    assert.equal(s.calls.length, 1); assert.equal(s.RGCurrentDailyLossLimit, 0); assert.equal(s.RGCurrentPositionLossLimit, 0);
});
check('undo restores amounts scope checkboxes and sound filenames from saved configuration', () => {
    const s = fixture(); s.m_EdtGuardSingle.Text('bad'); s.m_ChkGuardTradeSound.Checked(false); s.m_EdtGuardTradeSound.Text('new.wav'); s.OnClickBtnGuardScope();
    s.OnClickBtnGuardReset(); assert.equal(s.m_EdtGuardSingle.Text(), '500'); assert.equal(s.m_guard_draft.scope, 0);
    assert.equal(s.m_ChkGuardTradeSound.Checked(), true); assert.equal(s.m_EdtGuardTradeSound.Text(), 'ok.wav'); assert.equal(s.m_guard_dirty, false);
});
check('hiding and reopening the page preserves unfinished text and checkbox draft', () => {
    const s = fixture(); s.ShowGuard(); s.m_EdtGuardSingle.Text('1..'); s.m_ChkGuardTradeSound.Checked(false); s.HideGuard(); s.ShowGuard();
    assert.equal(s.m_EdtGuardSingle.Text(), '1..'); assert.equal(s.m_ChkGuardTradeSound.Checked(), false); assert.equal(s.calls.length, 0);
});
check('routine live refresh uses applied daily limit and never overwrites unfinished edits', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('500'); s.m_EdtGuardSingle.Text('1..'); s.refresh();
    assert.equal(s.m_EdtGuardSingle.Text(), '1..'); assert.equal(s.m_EdtGuardDaily.Text(), '500');
    assert.match(s.m_LblGuardRemaining.Text(), /1700.00 USD/); assert.match(s.m_LblGuardRealized.Text(), /-250.00/);
    assert.match(s.m_LblGuardFloating.Text(), /-50.00/); assert.equal(s.calls.length, 0);
});
check('pristine draft automatically follows a saved change from another chart', () => {
    const s = fixture(); s.RGCurrentDailyLossLimit = 1500; s.RGSettingsRevision++; s.refresh();
    assert.equal(s.m_EdtGuardDaily.Text(), '1500'); assert.equal(s.m_guard_revision, 2); assert.equal(s.m_guard_stale, false);
});
check('another chart update preserves a dirty draft while disabling stale save', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('800'); s.RGCurrentDailyLossLimit = 1500; s.RGSettingsRevision++; s.refresh();
    assert.equal(s.m_EdtGuardDaily.Text(), '800'); assert.equal(s.m_guard_stale, true); assert.equal(s.m_BtnGuardSave.enabled, false);
    s.OnClickBtnGuardSave(); assert.equal(s.calls.length, 0); s.OnClickBtnGuardReset();
    assert.equal(s.m_EdtGuardDaily.Text(), '1500'); assert.equal(s.m_guard_stale, false); assert.equal(s.m_BtnGuardSave.enabled, true);
});
check('revision check also protects save before the next live refresh', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('800'); s.RGSettingsRevision++; s.OnClickBtnGuardSave();
    assert.equal(s.calls.length, 0); assert.equal(s.m_guard_stale, true); assert.equal(s.m_EdtGuardDaily.Text(), '800');
});
check('config store receives expected revision for races occurring after the UI check', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('800'); s.beforeSave = () => s.RGSettingsRevision++; s.OnClickBtnGuardSave();
    assert.equal(s.calls[0].revision, 1); assert.equal(s.RGCurrentDailyLossLimit, 2000); assert.match(s.status(), /未确认/);
});
check('account switch with the same revision cannot apply an old account draft', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('800'); s.actualKey = s.RGSettingsAccountKey = 'Other|456'; s.RGCurrentDailyLossLimit = 3000;
    s.OnClickBtnGuardSave(); assert.equal(s.calls.length, 0); assert.equal(s.m_EdtGuardDaily.Text(), '3000'); assert.match(s.status(), /账户已切换/);
});
check('account switch clears the old draft even while the new saved record is unavailable', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('800'); s.actualKey = 'Other|456'; s.RGSettingsReady = false; s.refresh();
    assert.equal(s.m_EdtGuardDaily.Text(), ''); assert.equal(s.m_BtnGuardSave.enabled, false); s.OnClickBtnGuardSave(); assert.equal(s.calls.length, 0);
    s.RGSettingsAccountKey = s.actualKey; s.RGSettingsReady = true; s.RGCurrentDailyLossLimit = 3000; s.refresh();
    assert.equal(s.m_EdtGuardDaily.Text(), '3000'); assert.equal(s.m_guard_stale, false);
});
check('saved-record read failures preserve same-account draft and block save until recovery', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('800'); s.RGSettingsReady = false; s.RGSettingsError = '文件忙'; s.refresh();
    assert.equal(s.m_EdtGuardDaily.Text(), '800'); assert.equal(s.m_BtnGuardSave.enabled, false); s.OnClickBtnGuardSave(); assert.equal(s.calls.length, 0);
    s.RGSettingsReady = true; s.refresh(); assert.equal(s.m_EdtGuardDaily.Text(), '800'); assert.equal(s.m_BtnGuardSave.enabled, true);
});
check('first-run invalid F7 defaults remain repairable through the page without reopening properties', () => {
    const s = fixture(); s.storedExists = false; s.RGSettingsRevision = 0; s.RGSettingsReady = false; s.RGCurrentPositionLossLimit = -5; s.RDCurrentLossSound = 'invalid';
    s.LoadGuardDraft(); assert.equal(s.m_EdtGuardSingle.Text(), '-5'); assert.equal(s.m_BtnGuardSave.enabled, true);
    s.m_EdtGuardSingle.Text('500'); s.m_EdtGuardLossSound.Text('alert.wav'); s.OnClickBtnGuardSave();
    assert.equal(s.calls.length, 1); assert.equal(s.calls[0].revision, 0); assert.equal(s.RGSettingsReady, true);
});
check('repair exception cannot overwrite an existing corrupt record or missing previously saved file', () => {
    const s = fixture(); s.RGSettingsReady = false; s.RGSettingsRevision = 0; s.storedExists = true;
    assert.equal(s.GuardSettingsEditable(), false); s.storedExists = false; s.RGSettingsRevision = 5;
    assert.equal(s.GuardSettingsEditable(), false); s.OnClickBtnGuardSave(); assert.equal(s.calls.length, 0);
});
check('repair exception requires initialized defaults and the current account identity', () => {
    const s = fixture(); s.RGSettingsReady = false; s.RGSettingsRevision = 0; s.storedExists = false; s.RGSettingsHaveDefaults = false;
    assert.equal(s.GuardSettingsEditable(), false); s.RGSettingsHaveDefaults = true; s.actualKey = 'Other|456'; assert.equal(s.GuardSettingsEditable(), false);
});
check('a save error preserves the draft and reports ambiguous persistence without claiming success', () => {
    const s = fixture(); s.allowSave = false; s.m_EdtGuardDaily.Text('800'); s.OnClickBtnGuardSave();
    assert.equal(s.m_EdtGuardDaily.Text(), '800'); assert.equal(s.m_guard_dirty, true); assert.match(s.status(), /未确认.*重新载入/);
});
check('changing limits never clears an already latched daily lock in the panel', () => {
    const s = fixture(); s.RGDailyLocked = true; s.RGEntryBlocked = true; s.RGStatus = '清仓完成，当天禁止新开仓';
    s.m_EdtGuardDaily.Text('0'); s.OnClickBtnGuardSave(); assert.equal(s.RGDailyLocked, true); assert.match(s.status(), /保护锁仍然有效/);
    assert.match(s.m_LblGuardState.Text(), /当天已锁定/); assert.equal(s.m_LblGuardState.color, 'error');
});
check('unavailable live accounting is shown as waiting instead of stale numeric certainty', () => {
    const s = fixture(); s.RGSnapshotReady = false; s.refresh();
    for (const name of ['m_LblGuardRealized', 'm_LblGuardFloating', 'm_LblGuardRemaining']) assert.match(s[name].Text(), /等待数据/);
});
check('tab selection hides every other page and sizes the guard page', () => {
    const s = fixture(); s.OnClickBtnTabGuard(); assert.equal(s.sets.SelectedTab, s.GuardTab); assert.equal(s.m_guard_visible, true);
    assert.deepEqual(s.events, ['hide:Main', 'hide:Risk', 'hide:Margin', 'hide:Swaps', 'hide:Trading', 'hide:RR', 'resize']);
});
check('guard controls stay within the existing content width and row actions do not overlap', () => {
    const s = fixture(); for (const { Obj: control } of s.GuardTabList.nodes) {
        assert.ok(control.rect[0] >= 7 && control.rect[2] <= 314, control.name);
        assert.ok(control.rect[3] > control.rect[1], control.name);
    }
    assert.ok(s.m_BtnGuardSave.rect[2] < s.m_BtnGuardReset.rect[0]);
    assert.ok(s.m_LblGuardStatus2.rect[3] < 500);
});
check('seven actual tab definitions retain legible fonts and disjoint button rectangles', () => {
    const body = panelSource.slice(panelSource.indexOf('    PersistentList = new CPanelList;'), panelSource.indexOf('// Main', panelSource.indexOf('    PersistentList = new CPanelList;')));
    for (const scale of [0.75, 1, 1.25, 1.5, 1.75, 2]) {
        const s = fixture(); Object.assign(s, { PanelList, m_DPIScale: scale, first_column_start: Math.round(7 * scale), y: 8,
            TRANSLATION_TAB_BUTTON_RISK: '风险', TRANSLATION_TAB_BUTTON_MARGIN: '保证金', TRANSLATION_TAB_BUTTON_SWAPS: '掉期', TRANSLATION_TAB_BUTTON_TRADING: '交易' });
        for (const tab of ['Main', 'Risk', 'Margin', 'Swaps', 'Trading', 'RR']) s['m_BtnTab' + tab] = new Control();
        s.PersistentList = null;
        for (const tab of ['Main', 'Risk', 'Margin', 'Swaps', 'Trading', 'RR']) s[tab + 'TabList'] = null;
        vm.runInContext(`function createTabs() {${adapt(body).replace(/new CPanelList/g, 'new PanelList()')}} createTabs();`, s);
        const tabs = s.PersistentList.nodes.map(node => node.Obj); assert.equal(tabs.length, 7);
        assert.ok(tabs.every(tab => tab.fontSize === Math.max(6, Math.round(9 * scale))));
        assert.ok(tabs.at(-1).rect[2] <= s.first_column_start + Math.round(307 * scale), `DPI ${scale}`);
        for (let i = 1; i < tabs.length; i++) assert.ok(tabs[i - 1].rect[2] < tabs[i].rect[0]);
    }
});
check('explicit reload synchronizes the account record before discarding a draft', () => {
    const s = fixture(); s.m_EdtGuardDaily.Text('800');
    s.onSync = () => { s.RGSettingsRevision = 2; s.RGCurrentDailyLossLimit = 3500; };
    s.OnClickBtnGuardReset(); assert.equal(s.m_EdtGuardDaily.Text(), '3500');
    assert.equal(s.m_guard_revision, 2); assert.equal(s.m_guard_dirty, false); assert.equal(s.calls.length, 0);
});
check('draft and rendering methods do not call trading manager executors or audio playback', () => {
    assert.doesNotMatch(source, /\b(?:OrderSend|RGManage|RGExitPosition|RGCancelOrder|PlaySound|RDPlayRiskAlert)\s*\(/);
});
console.log(`RR guard UI: ${count} production-method tests passed.`);
