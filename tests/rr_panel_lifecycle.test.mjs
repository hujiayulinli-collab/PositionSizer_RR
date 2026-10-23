// Executes real panel methods with a small MT5 UI boundary. In particular,
// the base Create boundary dispatches the virtual Maximize/Minimize callback
// before CreateObjects, matching the installed official Controls/Dialog.mqh.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const production = readFileSync(new URL('../mt5/Position Sizer.mqh', import.meta.url), 'utf8')
    + '\n' + readFileSync(new URL('../mt5/RRPlanPanel.mqh', import.meta.url), 'utf8')
    + '\n' + readFileSync(new URL('../mt5/RRGuardPanel.mqh', import.meta.url), 'utf8');
const beforeFix = readFileSync(new URL('./fixtures/panel-before-lifecycle-fix.mqh', import.meta.url), 'utf8');
const entrySource = readFileSync(new URL('../mt5/Position Sizer RR.mq5', import.meta.url), 'utf8');
const recoverySource = readFileSync(new URL('../mt5/RRPanelRecovery.mqh', import.meta.url), 'utf8');

function extract(source, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const signature = new RegExp(`(?:void|bool)?\\s*CPositionSizeCalculator::${escaped}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(signature, `Missing production method ${name}`);
    const start = signature.index + signature[0].length;
    let end = start;
    let depth = 1;
    for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    assert.equal(depth, 0);
    const args = signature[1].trim() === '' || signature[1].trim() === 'void' ? [] :
        signature[1].split(',').map(arg => {
            const match = /^\s*(?:const\s+)?(?:long|int|string)\s+(\w+)\s*$/.exec(arg);
            assert.ok(match, `Unsupported parameter ${arg}`);
            return match[1];
        });
    return { body: source.slice(start, end - 1), args };
}

function adapt(body) {
    return body
        .replace(/C(?:App)?Dialog::/g, '__base.')
        .replace(/\b(?:bool|int|double|long|string)\s+(?=[A-Za-z_]\w*\s*=)/g, 'let ')
        .replace(/\bCStringForList\s*\*\s*(\w+)/g, 'let $1')
        .replace(/\((?:double|int)\)/g, '')
        .replace(/\bdelete\s+(\w+)\s*;/g, '__delete($1);');
}
const methods = ['InitVariables', 'Maximize', 'Minimize', 'HideShowMaximize', '~CPositionSizeCalculator',
    'HideMain', 'HideRisk', 'HideMargin', 'HideSwaps', 'HideTrading'];
const tabs = ['Main', 'Risk', 'Margin', 'Swaps', 'Trading', 'RR', 'Guard'];
const listNames = [...tabs.map(tab => `${tab}TabList`), 'PersistentList'];

function fixture(source = production) {
    const events = [];
    const sandbox = {
        NULL: null, POINTER_DYNAMIC: 'dynamic', POINTER_INVALID: 'invalid', INVALID_HANDLE: -1,
        CONTROLS_BUTTON_COLOR_DISABLE: 0, CHART_WIDTH_IN_PIXELS: 1, OBJPROP_SELECTED: 2,
        TERMINAL_SCREEN_DPI: 3, ACCOUNT_CURRENCY_DIGITS: 4,
        m_controls_ready: false, m_minimized: false, NoPanelMaximization: false,
        m_rr_page: 0, m_rr_count: 0, m_rr_visible: false,
        m_rr_state: { version: 99, stage: 99 }, m_rr_loaded_plan: { count: 99 },
        m_guard_draft: { single: 'stale' }, m_guard_saved: { single: 'stale' }, m_guard_visible: false,
        ZeroMemory: value => { for (const key of Object.keys(value)) value[key] = 0; },
        sets: { SelectedTab: 'Main', IsPanelMinimized: false, TakeProfitsNumber: 1 },
        remember_left: -1, remember_top: -1, MaxTakeProfitsNumber: 1, LinesSelectedStatus: 0,
        ChartWidth: 0, CheckboxOnFile: '', CheckboxOffFile: '', RadiogroupOnFile: '', RadiogroupOffFile: '',
        ObjectPrefix: 'PSRR_', _Digits: 5, DetectedColorMode: false, m_DPIScale: 0, PanelWidth: 0, RRPanelScalePercent: 100, RRPanelScaleBuilding: false,
        failAfterLists: -1, initObjectsSuccess: true,
        ChartGetInteger: () => 800, ChartID: () => 1,
        ObjectGetInteger: () => true, ObjectSetInteger: () => events.push('object-selected'),
        TerminalInfoInteger: () => 96, AccountInfoInteger: () => 2,
        MathRound: Math.round,
        GetPointer: value => value, RRScalePanelBitmaps: () => {}, KeepScaleControlsReachable: () => {},
        Left: () => 15, Top: () => 20,
        Hide: () => events.push('panel-hide'), Show: () => events.push('panel-show'),
        Move: (...args) => events.push(`move:${args.join(',')}`),
        MoveAndResize: () => events.push('resize'), IniFileSave: () => events.push('ini-save'),
        CaptureRRPage: () => events.push('capture-rr-draft'),
        CaptureGuardDraft: () => events.push('capture-guard-draft'),
        m_min_rect: { Move: (...args) => events.push(`min-rect:${args.join(',')}`) },
        m_chart: { Detach: () => events.push('detach') },
        CheckPointer: value => value && !value.deleted ? value.pointerType : 'invalid',
        __delete: value => {
            assert.ok(value && value.pointerType === 'dynamic' && !value.deleted, 'invalid delete');
            value.deleted = true;
            events.push(`delete:${value.name}`);
        },
    };
    function makeList(name) {
        return { name, pointerType: 'dynamic', deleted: false,
            GetFirstNode() {
                events.push(`read:${name}`);
                return { Obj: { Hide: () => events.push(`hide:${name}`) } };
            },
            GetNextNode() { return null; },
        };
    }
    for (const name of listNames) sandbox[name] = null;
    for (const tab of tabs) {
        sandbox[tab === 'RR' ? 'RRTargetsTab' : `${tab}Tab`] = tab;
        sandbox[`m_BtnTab${tab}`] = { ColorBackground: () => events.push(`color:${tab}`) };
        sandbox[`Show${tab}`] = () => events.push(`show:${tab}`);
    }
    const context = vm.createContext(sandbox);
    sandbox.__base = {
        Maximize: () => { events.push('base-maximize'); sandbox.m_minimized = false; },
        Minimize: () => { events.push('base-minimize'); sandbox.m_minimized = true; },
        Destroy: () => events.push(`base-destroy-ready:${sandbox.m_controls_ready}`),
        Create: () => {
            events.push('base-create');
            if (sandbox.m_minimized) context.Minimize(); else context.Maximize();
            return true;
        },
    };
    const functionTexts = [...methods, ...(source === production ? ['HideRR', 'HideGuard'] : [])].map(name => {
        const { body, args } = extract(source, name);
        return `function ${name.startsWith('~') ? 'PanelDestructor' : name}(${args.join(',')}) {${adapt(body)}}`;
    });
    if (source === production) {
        for (const name of ['Create', 'Destroy']) {
            const { body, args } = extract(source, name);
            functionTexts.push(`function ${name}(${args.join(',')}) {${adapt(body)}}`);
        }
        // Execute the exact final creation block, with expensive UI creation
        // represented by a dependency boundary rather than mirrored methods.
        const createBody = extract(source, 'CreateObjects').body;
        const marker = 'm_controls_ready = true;';
        assert.ok(createBody.includes(marker), 'Missing creation completion block');
        functionTexts.push(`function CompleteControls() {${adapt(createBody.slice(createBody.indexOf(marker)))}}`);
        sandbox.InitObjects = () => {
            events.push(`init-objects-ready:${sandbox.m_controls_ready}`);
            return sandbox.initObjectsSuccess;
        };
        sandbox.CreateObjects = () => {
            events.push('create-objects');
            for (let i = 0; i < listNames.length; i++) {
                if (i === sandbox.failAfterLists) return false;
                sandbox[listNames[i]] = makeList(listNames[i]);
            }
            return context.CompleteControls();
        };
    }
    vm.runInContext(functionTexts.join('\n'), context);
    context.InitVariables();
    return { context, events, makeList, ready() {
        for (const name of listNames) sandbox[name] = makeList(name);
        sandbox.m_controls_ready = true;
    } };
}

let passed = 0;
function check(name, callback) {
    try { callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}

check('old production callback reproduces invalid RiskTabList access', () => {
    const { context, events } = fixture(beforeFix);
    assert.throws(() => context.__base.Create(), /GetFirstNode/);
    assert.deepEqual(events, ['base-create', 'base-maximize', 'color:Risk']);
});
check('old early Minimize prematurely saves panel settings', () => {
    const { context, events } = fixture(beforeFix);
    context.m_minimized = true;
    context.__base.Create();
    assert.ok(events.includes('ini-save'));
});
check('constructor initialization explicitly clears lifecycle state and all lists', () => {
    const { context } = fixture();
    assert.equal(context.m_controls_ready, false); assert.equal(context.NoPanelMaximization, false);
    assert.equal(context.m_rr_position_id, 0); assert.equal(context.m_rr_state.stage, 0);
    assert.equal(context.m_rr_loaded_plan.count, 0); assert.equal(context.m_rr_stale, false);
    for (const name of listNames) assert.equal(context[name], null);
});
check('new base Create maximize callback cannot touch uncreated controls', () => {
    const { context, events } = fixture();
    context.__base.Create();
    assert.deepEqual(events, ['base-create', 'base-maximize']);
});
check('new base Create minimize callback cannot save incomplete settings', () => {
    const { context, events } = fixture();
    context.m_minimized = true;
    context.__base.Create();
    assert.deepEqual(events, ['base-create', 'base-minimize']);
});
check('HideShowMaximize before ready is inert', () => {
    const { context, events } = fixture(); context.HideShowMaximize();
    assert.deepEqual(events, []);
});
check('real Create orders base callback before list creation without crashing', () => {
    const { context, events } = fixture();
    assert.equal(context.Create(0, 'RR', 0, 0, 0), true);
    assert.deepEqual(events, ['base-create', 'base-maximize', 'create-objects', 'init-objects-ready:true']);
    assert.equal(context.m_controls_ready, true);
});
check('failed InitObjects revokes readiness', () => {
    const { context } = fixture(); context.initObjectsSuccess = false;
    assert.equal(context.Create(0, 'RR', 0, 0, 0), false);
    assert.equal(context.m_controls_ready, false);
});
check('partial construction failures remain callable and safely destructible', () => {
    for (let allocated = 0; allocated < listNames.length; allocated++) {
        const { context, events } = fixture(); context.failAfterLists = allocated;
        assert.equal(context.Create(0, 'RR', 0, 0, 0), false);
        assert.equal(context.m_controls_ready, false);
        const begin = events.length;
        context.Maximize(); context.Minimize(); context.HideShowMaximize();
        assert.deepEqual(events.slice(begin), ['base-maximize', 'base-minimize']);
        context.Destroy(); context.PanelDestructor();
        assert.equal(events.filter(event => event.startsWith('delete:')).length, allocated);
        for (const name of listNames) assert.equal(context[name], null);
        assert.ok(events.includes('base-destroy-ready:false'));
    }
});
check('ready Maximize still hides all tabs and shows each selected tab', () => {
    for (const tab of tabs) {
        const f = fixture(); f.ready(); f.context.sets.SelectedTab = tab; f.context.Maximize();
        assert.equal(f.events.filter(event => event.startsWith('read:')).length, tabs.length);
        assert.deepEqual(f.events.filter(event => event.startsWith('show:')), [`show:${tab}`]);
        assert.ok(f.events.includes('resize'));
    }
});
check('ready Minimize saves once and preserves remembered coordinates', () => {
    const f = fixture(); f.ready(); f.context.remember_left = 12; f.context.remember_top = 34;
    f.context.Minimize();
    assert.deepEqual(f.events, ['base-minimize', 'move:12,34', 'min-rect:12,34', 'ini-save']);
    assert.equal(f.context.sets.IsPanelMinimized, true);
});
check('ready HideShowMaximize preserves minimized panel state', () => {
    const f = fixture(); f.ready(); f.context.m_minimized = true; f.context.HideShowMaximize();
    assert.equal(f.context.m_minimized, true);
    assert.equal(f.events.filter(event => event.startsWith('show:')).length, 0);
    assert.ok(f.events.includes('panel-hide')); assert.ok(f.events.includes('panel-show'));
});
check('Destroy revokes readiness before base destruction and subsequent callbacks', () => {
    const f = fixture(); f.ready(); f.context.Destroy();
    assert.deepEqual(f.events, ['detach', 'base-destroy-ready:false']);
    f.events.length = 0; f.context.Maximize();
    assert.deepEqual(f.events, ['base-maximize']);
});
check('destructor frees all dynamic lists once and handles an empty repeated cleanup', () => {
    const f = fixture(); f.ready(); f.context.PanelDestructor(); f.context.PanelDestructor();
    assert.equal(f.events.filter(event => event.startsWith('delete:')).length, listNames.length);
    assert.equal(f.context.m_controls_ready, false);
});

check('hiding the RR tab captures its draft before hiding controls', () => {
    const f = fixture(); f.ready(); f.context.m_rr_visible = true;
    f.context.HideRR();
    assert.equal(f.events[0], 'capture-rr-draft');
    assert.equal(f.context.m_rr_visible, false);
    assert.ok(f.events.includes('hide:RRTabList'));
});
check('hiding an uncreated RR tab does not dereference its list', () => {
    const f = fixture(); f.context.HideRR();
    assert.deepEqual(f.events, []);
});
check('hiding the guard tab captures its draft before hiding controls', () => {
    const f = fixture(); f.ready(); f.context.m_guard_visible = true; f.context.HideGuard();
    assert.equal(f.events[0], 'capture-guard-draft'); assert.equal(f.context.m_guard_visible, false);
    assert.ok(f.events.includes('hide:GuardTabList'));
});
check('minimizing the guard tab captures uncommitted edits before saving layout', () => {
    const f = fixture(); f.ready(); f.context.m_guard_visible = true; f.context.Minimize();
    assert.equal(f.events[0], 'capture-guard-draft'); assert.ok(f.events.indexOf('capture-guard-draft') < f.events.indexOf('ini-save'));
});
check('hiding an uncreated guard tab cannot dereference controls or a null list', () => {
    const f = fixture(); f.context.HideGuard(); assert.deepEqual(f.events, []);
});
check('draft BE checkboxes never enter the generic panel layout stream', () => {
    const wrapper = /class\s+CRRPlanCheckBox\s*:\s*public\s+CCheckBox\s*\{([\s\S]*?)\};/.exec(production);
    assert.ok(wrapper, 'RR draft checkbox wrapper is missing');
    for (const method of ['Save', 'Load']) {
        assert.match(wrapper[1], new RegExp(`virtual\\s+bool\\s+${method}\\s*\\(const int file_handle\\)\\s*\\{\\s*return true;\\s*\\}`));
    }
    assert.match(production, /CRRPlanCheckBox\s+m_ChkRRBreakEven\[5\]/);
});

function globalFunction(source, name) {
    const classLike = source.replace(new RegExp(`\\b(?:void|int|bool|string)\\s+${name}\\s*\\(`),
        `void CPositionSizeCalculator::${name}(`);
    return extract(classLike, name);
}

check('OnInit validates RR before allocating or creating controls', () => {
    const { body } = globalFunction(entrySource, 'OnInit');
    const validation = body.indexOf('if (!RRValidateInputs()) return INIT_PARAMETERS_INCORRECT;');
    assert.ok(validation >= 0);
    assert.ok(body.indexOf('RRPanelInitSucceeded = false;') < validation);
    assert.ok(validation < body.indexOf('new CPositionSizeCalculator'));
    assert.ok(validation < body.indexOf('ExtDialog.Create('));
    assert.ok(body.indexOf('RGUseInputDefaults();') > validation);
    assert.ok(body.indexOf('RGInitSettings()') < body.indexOf('ExtDialog.Create('));
    assert.match(body, /if\s*\(!ExtDialog\.Create\([\s\S]*?return INIT_FAILED;/);
    assert.match(body, /if\s*\(!ExtDialog\.Run\(\)\)[\s\S]*?return INIT_FAILED;/);
    assert.ok(body.indexOf('RRPanelInitSucceeded = true;') > body.indexOf('ExtDialog.RefreshValues();'));
});

function deinitFixture(initialized, hasPanel, layoutExists = true) {
    const events = [];
    const constants = ['REASON_INITFAILED', 'REASON_TEMPLATE', 'REASON_CLOSE', 'REASON_REMOVE',
        'REASON_CHARTCLOSE', 'REASON_PROGRAM', 'REASON_PARAMETERS', 'REASON_CHARTCHANGE', 'OBJ_LABEL'];
    const sandbox = {
        ...Object.fromEntries(constants.map(value => [value, value])),
        RRPanelInitSucceeded: initialized, DeinitializationReason: -1, POINTER_DYNAMIC: 'dynamic', NULL: null,
        RRShutdown: () => events.push('rr-shutdown'), RBShutdown: () => events.push('batch-shutdown'), EventKillTimer: () => events.push('timer-stop'),
        RCCancelReverse: () => events.push('cancel-reverse-entry'),
        RCCaptureCommon: () => events.push('capture-common-settings'),
        RRDeleteTargetLines: () => events.push('clear-rr-targets'),
        RGDeleteStatus: () => events.push('clear-guard-status'),
        CheckPointer: value => value ? 'dynamic' : 'invalid',
        __delete: () => events.push('delete-panel'),
        RRDeletePanelObjects: (_chart, prefix) => events.push(`delete-prefix:${prefix}`),
        ChartID: () => 1, ChartRedraw: () => events.push('redraw'),
        sets: {}, DoNotDeleteLinesLabels: true, ObjectPrefix: 'PSRR_', SettingsFile: '', OldSymbol: '', _Symbol: 'TEST',
        GlobalVariableSet: () => events.push('global-set'), IntegerToString: String,
        Print: () => events.push('warning'), GetLastError: () => 0,
        FileIsExist: () => layoutExists,
        FileDelete: path => { events.push(`delete-file:${path}`); return true; },
        ObjectsDeleteAll: () => events.push('delete-lines'), ObjectDelete: () => events.push('delete-line'),
        TRANSLATION_MESSAGE_FAILED_DELETE_INI: 'ini-error',
        ExtDialog: hasPanel ? {
            Name: () => '12345', Destroy: () => events.push('destroy-panel'),
            SaveSettingsOnDisk: () => events.push('save-settings'), IniFileSave: () => events.push('save-ini'),
            DeleteSettingsFile: () => events.push('delete-settings'), IniFileName: () => 'layout', IniFileExt: () => '.ini',
        } : null,
    };
    const context = vm.createContext(sandbox);
    const { body } = globalFunction(entrySource, 'OnDeinit');
    vm.runInContext(`function OnDeinit(reason) {${adapt(body)}}`, context);
    return { context, events };
}
check('actual init-failed deinit destroys only partial panel and never saves settings', () => {
    const f = deinitFixture(false, true); f.context.OnDeinit('REASON_INITFAILED');
    assert.deepEqual(f.events, ['clear-rr-targets', 'clear-guard-status', 'rr-shutdown', 'batch-shutdown', 'cancel-reverse-entry', 'timer-stop', 'destroy-panel', 'delete-panel', 'delete-prefix:12345', 'redraw']);
    assert.equal(f.context.ExtDialog, null); assert.equal(f.context.RRPanelInitSucceeded, false);
});
check('failure before allocation deinitializes without dereferencing a null panel', () => {
    const f = deinitFixture(false, false); f.context.OnDeinit('REASON_INITFAILED');
    assert.deepEqual(f.events, ['clear-rr-targets', 'clear-guard-status', 'rr-shutdown', 'batch-shutdown', 'cancel-reverse-entry', 'timer-stop', 'redraw']);
});
check('unfinished init skips saving even with a different deinit reason', () => {
    const f = deinitFixture(false, true); f.context.OnDeinit('REASON_PARAMETERS');
    assert.ok(!f.events.includes('save-settings')); assert.ok(!f.events.includes('save-ini'));
    assert.ok(!f.events.includes('global-set'));
});
check('successful parameter reinitialization still preserves user settings', () => {
    const f = deinitFixture(true, true); f.context.OnDeinit('REASON_PARAMETERS');
    assert.ok(f.events.includes('save-settings')); assert.ok(f.events.includes('save-ini'));
    assert.equal(f.context.ExtDialog, null);
});
check('successful chart change preserves panel object for reuse', () => {
    const f = deinitFixture(true, true); f.context.OnDeinit('REASON_CHARTCHANGE');
    assert.ok(f.context.ExtDialog); assert.ok(!f.events.includes('destroy-panel'));
    assert.ok(!f.events.includes('save-settings')); assert.equal(f.context.OldSymbol, 'TEST');
    assert.ok(f.events.includes('capture-common-settings'));
    assert.ok(f.events.indexOf('clear-rr-targets') >= 0);
    assert.ok(f.events.indexOf('clear-rr-targets') < f.events.indexOf('capture-common-settings'));
    assert.ok(f.events.indexOf('cancel-reverse-entry') < f.events.indexOf('capture-common-settings'));
});
check('failed initialization cannot capture half-loaded account common settings', () => {
    const f = deinitFixture(false, true); f.context.OnDeinit('REASON_CHARTCHANGE');
    assert.ok(!f.events.includes('capture-common-settings')); assert.ok(f.events.includes('cancel-reverse-entry'));
});
check('symbol prices load before common settings and final controls refresh follows layout loading', () => {
    const { body } = globalFunction(entrySource, 'OnInit');
    assert.ok(body.indexOf('ExtDialog.LoadSettingsFromDisk()') < body.indexOf('RCApplyCommon()'));
    assert.match(body, /RCApplyCommon\(\)\)\s*is_InitControlsValues_required = true;/);
    assert.ok(body.lastIndexOf('ExtDialog.IniFileLoad();') < body.indexOf('if (is_InitControlsValues_required) ExtDialog.InitControlsValues();'));
    const layout = /virtual\s+void\s+IniFileLoad\(\)\s*\{([^}]*)\}/.exec(production)[1];
    assert.ok(layout.indexOf('CAppDialog::IniFileLoad();') < layout.indexOf('InitObjects();'));
    assert.ok(extract(production, 'InitObjects').body.includes('InitControlsValues();'));
});
check('actual controls initialization overwrites stale layout display with applied risk and magic values', () => {
    const { body } = extract(production, 'InitControlsValues');
    const statements = ['m_EdtRiskPIn', 'm_EdtRiskMIn', 'm_EdtMagicNumber'].map(name => {
        const statement = new RegExp(`${name}\\.Text\\([^\\n]+;`).exec(body);
        assert.ok(statement); return statement[0];
    });
    const texts = new Map(); const saved = { Risk: 0.7, MoneyRisk: 250, MagicNumber: 9988 };
    const s = { sets: saved, AccountCurrencyDigits: 2, DoubleToString: (n, places) => n.toFixed(places), IntegerToString: String };
    for (const name of ['m_EdtRiskPIn', 'm_EdtRiskMIn', 'm_EdtMagicNumber']) s[name] = { Text: value => texts.set(name, value) };
    texts.set('m_EdtMagicNumber', '123'); texts.set('m_EdtRiskPIn', '5.00'); texts.set('m_EdtRiskMIn', '9000.00');
    vm.runInNewContext(statements.join('\n'), s);
    assert.equal(texts.get('m_EdtRiskPIn'), '0.70'); assert.equal(texts.get('m_EdtRiskMIn'), '250.00'); assert.equal(texts.get('m_EdtMagicNumber'), '9988');
    assert.deepEqual(saved, { Risk: 0.7, MoneyRisk: 250, MagicNumber: 9988 });
    assert.doesNotMatch(body, /sets\.(?:Risk|MoneyRisk|MagicNumber)\s*=/);
});
check('normal removal skips missing layout file without warning', () => {
    const f = deinitFixture(true, true, false); f.context.OnDeinit('REASON_REMOVE');
    assert.ok(!f.events.some(event => event.startsWith('delete-file:')));
    assert.ok(!f.events.includes('warning')); assert.equal(f.context.ExtDialog, null);
});
check('normal removal deletes an existing layout exactly once', () => {
    const f = deinitFixture(true, true, true); f.context.OnDeinit('REASON_REMOVE');
    assert.deepEqual(f.events.filter(event => event.startsWith('delete-file:')), ['delete-file:layout.ini']);
    assert.ok(!f.events.includes('warning'));
});

const inlineIni = /virtual\s+string\s+IniFileName\s*\(void\)\s+const\s*\{([^}]*)\}/.exec(production);
assert.ok(inlineIni, 'Missing real const IniFileName override');
let chartId = 1n;
const iniContext = vm.createContext({
    ChartID: () => chartId, IntegerToString: String,
    Version: '3.14 - RR 1.01', PanelCaptionBase: 'Position Sizer RR (ver. 3.14 - RR 1.01)',
});
vm.runInContext(`function IniFileName() {${adapt(inlineIni[1])}}`, iniContext);
check('actual IniFileName isolates charts and preserves full-width chart identifiers', () => {
    const names = new Set();
    for (const id of [1n, 2n, 12345678901234567n, 12345678901234568n]) {
        chartId = id;
        const name = iniContext.IniFileName();
        assert.equal(name, `PSRR_Settings\\Panel_${id}`);
        names.add(name);
    }
    assert.equal(names.size, 4);
});
check('actual IniFileName does not depend on captions, version changes or caption path characters', () => {
    chartId = 987654321n;
    const stable = iniContext.IniFileName();
    for (const version of ['3.14 / RR 1.01', '3.15 - RR 1.02', 'Version: future / preview?']) {
        iniContext.Version = version;
        iniContext.PanelCaptionBase = `Position Sizer RR (ver. ${version})`;
        assert.equal(iniContext.IniFileName(), stable);
    }
    assert.ok(!/[/:?]/.test(stable));
    assert.ok(stable.startsWith('PSRR_Settings\\Panel_'));
});

const recovery = vm.createContext({
    ...Object.fromEntries(['OBJ_RECTANGLE_LABEL', 'OBJ_LABEL', 'OBJ_EDIT', 'OBJ_BUTTON', 'OBJ_BITMAP_LABEL',
        'OBJPROP_TYPE', 'OBJPROP_TEXT'].map(name => [name, name])),
    StringLen: value => value.length, StringGetCharacter: (value, index) => value.charCodeAt(index),
    StringFind: (value, target) => value.indexOf(target),
    StringSubstr: (value, start, length) => length === undefined ? value.slice(start) : value.slice(start, start + length),
});
const recoveryFunctions = ['RRIsDialogPrefix', 'RROrphanPrefix', 'RRIsDialogObject', 'RRIsDialogObjectType', 'RRDeletePanelObjects', 'RRClearOrphanPanels'];
vm.runInContext(recoveryFunctions.map(name => {
    const { body, args } = globalFunction(recoverySource, name);
    const adapted = adapt(body).replace(/\bushort\s+(\w+)\s*=/g, 'let $1 =')
        .replace(/'0'/g, '48').replace(/'9'/g, '57');
    return `function ${name}(${args.join(',')}) {${adapted}}`;
}).join('\n'), recovery);

check('recovery accepts only exactly five ASCII digits as a panel prefix', () => {
    for (const prefix of ['00000', '12345', '32767', '99999']) assert.equal(recovery.RRIsDialogPrefix(prefix), true);
    for (const prefix of ['', '1234', '123456', '1234a', '-1234', '１２３４５', 'PSRR_'])
        assert.equal(recovery.RRIsDialogPrefix(prefix), false, prefix);
});
check('recovery requires the RR caption and exact Caption object shape', () => {
    assert.equal(recovery.RROrphanPrefix('12345Caption', 'Position Sizer RR (ver. 3.14 / RR 1.01)'), '12345');
    for (const [name, caption] of [
        ['12345Caption', 'Position Sizer (ver. 3.14)'],
        ['12345Caption', 'Other EA'], ['12345Caption', 'User Position Sizer RR (ver. 1)'],
        ['12345CaptionBackup', 'Position Sizer RR (ver. 1)'], ['PSRR_Caption', 'Position Sizer RR (ver. 1)'],
        ['12345Trendline', 'Position Sizer RR (ver. 1)'],
    ]) assert.equal(recovery.RROrphanPrefix(name, caption), '');
});
check('recovery leaves other panel prefixes and unrelated drawings alone', () => {
    for (const suffix of ['Border', 'Back', 'Caption', 'Close', 'MinMax', 'Client', 'ClientBack', 'm_BtnTabMain'])
        assert.equal(recovery.RRIsDialogObject(`12345${suffix}`, '12345'), true);
    for (const name of ['54321Caption', '12345Trendline', '12345Horizontal Line', 'PSRR_EntryLine', 'PS_EntryLine', 'Trendline 12345'])
        assert.equal(recovery.RRIsDialogObject(name, '12345'), false, name);
});
check('recovery permits only GUI object types, excluding price lines and drawings', () => {
    for (const type of ['OBJ_RECTANGLE_LABEL', 'OBJ_LABEL', 'OBJ_EDIT', 'OBJ_BUTTON', 'OBJ_BITMAP_LABEL'])
        assert.equal(recovery.RRIsDialogObjectType(type), true);
    for (const type of ['OBJ_HLINE', 'OBJ_VLINE', 'OBJ_TREND', 'OBJ_RECTANGLE', 'OBJ_TEXT', 'OBJ_FIBO', 'unknown'])
        assert.equal(recovery.RRIsDialogObjectType(type), false);
});
check('actual orphan cleanup deletes RR shell while preserving original panel and user drawings', () => {
    const objects = [
        { name: '12345Caption', text: 'Position Sizer RR (ver. 3.14)' },
        ...['Border', 'Back', 'Close', 'MinMax', 'Client', 'm_BtnTabMain'].map(suffix => ({ name: `12345${suffix}`, text: '' })),
        { name: '54321Caption', text: 'Position Sizer (ver. 3.14)' }, { name: '54321Border', text: '' },
        { name: '12345Trendline', text: '' }, { name: 'PS_EntryLine', text: '' }, { name: 'My trendline', text: '' },
        { name: '12345m_UserPrice', text: '', type: 'OBJ_HLINE' },
        { name: '12345ClientTrend', text: '', type: 'OBJ_TREND' },
    ];
    const deleted = [];
    Object.assign(recovery, {
        ChartID: () => 1, ObjectsTotal: () => objects.length,
        ObjectName: (_chart, index) => objects[index]?.name ?? '',
        ObjectGetString: (_chart, name) => objects.find(object => object.name === name)?.text ?? '',
        ObjectGetInteger: (_chart, name) => objects.find(object => object.name === name)?.type ?? 'OBJ_EDIT',
        ObjectDelete: (_chart, name) => {
            const index = objects.findIndex(object => object.name === name);
            if (index < 0) return false;
            objects.splice(index, 1); deleted.push(name); return true;
        }, ChartRedraw: () => {}, PrintFormat: () => {},
    });
    recovery.RRClearOrphanPanels();
    assert.equal(deleted.length, 7);
    assert.deepEqual(objects.map(object => object.name), ['54321Caption', '54321Border', '12345Trendline', 'PS_EntryLine', 'My trendline', '12345m_UserPrice', '12345ClientTrend']);
});
check('failed ObjectDelete cannot trap initialization in an endless cleanup loop', () => {
    const objects = [{ name: '12345Caption', text: 'Position Sizer RR (ver. 3.14)' },
        { name: '12345Border', text: '' }];
    let attempts = 0;
    Object.assign(recovery, {
        ObjectsTotal: () => objects.length, ObjectName: (_chart, index) => objects[index]?.name ?? '',
        ObjectGetString: (_chart, name) => objects.find(object => object.name === name)?.text ?? '',
        ObjectGetInteger: () => 'OBJ_EDIT',
        ObjectDelete: () => { attempts++; return false; },
    });
    vm.runInContext('RRClearOrphanPanels()', recovery, { timeout: 1000 });
    assert.equal(attempts, 2); assert.equal(objects.length, 2);
});
check('a user price line carrying an RR-like Caption name cannot initiate cleanup', () => {
    let attempts = 0;
    Object.assign(recovery, {
        ObjectsTotal: () => 1, ObjectName: () => '12345Caption',
        ObjectGetString: () => 'Position Sizer RR (ver. 3.14)', ObjectGetInteger: () => 'OBJ_HLINE',
        ObjectDelete: () => { attempts++; return true; },
    });
    recovery.RRClearOrphanPanels();
    assert.equal(attempts, 0);
});

process.stdout.write(`\n${passed} lifecycle tests passed; the preserved pre-fix methods reproduce the reported null-list failure.\n`);
process.stdout.write('Scope: actual MQL panel method bodies with simulated MT5 boundaries; visual terminal checks remain necessary.\n');
