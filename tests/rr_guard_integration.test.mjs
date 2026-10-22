// Executes production manager/event-handler bodies against inert MT5 boundaries.
// No terminal is opened and no real trading request is sent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const managerSource = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const entrySource = readFileSync(new URL('../mt5/Position Sizer RR.mq5', import.meta.url), 'utf8');
const tradingSource = readFileSync(new URL('../mt5/Position Sizer Trading.mqh', import.meta.url), 'utf8');
const guardSource = readFileSync(new URL('../mt5/RRGuard.mqh', import.meta.url), 'utf8');

function extract(source, name) {
    const match = new RegExp(`\\b(?:void|bool|int)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Missing production function ${name}`);
    const start = match.index + match[0].length;
    let end = start;
    let depth = 1;
    for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    assert.equal(depth, 0, `${name} braces`);
    const args = match[1].trim() ? match[1].split(',').map(arg => {
        const parameter = /^\s*(?:const\s+)?\w+\s*&?\s*(\w+)(\s*=\s*[^,]+)?\s*$/.exec(arg);
        assert.ok(parameter, `Unsupported argument ${arg}`);
        return parameter[1] + (parameter[2] ?? '');
    }) : [];
    return { args, body: source.slice(start, end - 1) };
}
function adapt(body) {
    return body
        .replace(/\bRRState\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bRGDayState\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\b(?:const\s+)?(?:bool|int|long|ulong|string|double|datetime)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:long|ulong|int|double|datetime)\)/g, '')
        .replace('RGCancelOrder(ticket, RGDailyLocked ? "daily" : "", status)',
            'RGCancelOrder(ticket, RGDailyLocked ? "daily" : "", value => status = value)')
        .replace('RGExitPosition(ticket, trigger, magic, status, first)',
            'RGExitPosition(ticket, trigger, magic, value => status = value, value => first = value)');
}
function install(context, source, name, replacementBody) {
    const { args, body } = extract(source, name);
    vm.runInContext(`function ${name}(${args.join(',')}) {${adapt(replacementBody ?? body)}}`, context);
}

function managerFixture({ race = false, latched = [], existingJournal = false, failOpen = false,
    wasExisting = false, legacyWithoutPostLockCheck = false, positionMagic = 321, symbol = 'XAUUSD' } = {}) {
    const events = [];
    const guardLatches = new Set(latched);
    const journals = new Map(existingJournal ? [['rr/42', 1]] : []);
    const handles = new Map();
    let nextHandle = 1;
    let emergencySends = 0;
    const context = vm.createContext({
        RR_Enable: true, RRAccount: 11, RRServer: 'Demo', RRLastRun: 0,
        ACCOUNT_LOGIN: 'login', ACCOUNT_SERVER: 'server', POSITION_SYMBOL: 'symbol',
        POSITION_MAGIC: 'magic', POSITION_IDENTIFIER: 'identifier',
        FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, INVALID_HANDLE: -1,
        AccountInfoInteger: () => 11, AccountInfoString: () => 'Demo', GetTickCount64: () => 1000,
        RRSnapshotExisting: () => events.push('snapshot-existing'), PositionsTotal: () => 1,
        PositionGetTicket: () => 99, PositionGetString: () => symbol,
        PositionGetInteger: property => property === 'identifier' ? 42 : positionMagic,
        RRFileName: id => `rr/${id}`, RRWasExisting: () => wasExisting,
        FileIsExist: name => journals.has(name),
        RGPositionExitLatched: id => {
            const result = guardLatches.has(id);
            events.push(`latch:${result}`);
            return result;
        },
        RMPositionExitActive: () => false, RBIsChild: () => false,
        FileOpen: name => {
            if (failOpen) return -1;
            if (race && !journals.has(name)) {
                // Scheduling boundary: another chart saves its guard intent
                // after the first latch check, sees no ordinary journal yet,
                // and begins its emergency close before this FileOpen returns.
                guardLatches.add(42); emergencySends++;
                events.push('emergency-no-ordinary-file');
            }
            if (!journals.has(name)) journals.set(name, 0);
            const handle = nextHandle++;
            handles.set(handle, name); events.push('ordinary-lock'); return handle;
        },
        FileSize: handle => journals.get(handles.get(handle)),
        FileClose: handle => { handles.delete(handle); events.push('ordinary-unlock'); },
        RRCapture: (_ticket, state) => { events.push('capture'); state.magic = positionMagic; return true; },
        RRSave: () => { events.push('save'); return true; },
        RRLoad: (_handle, state) => { events.push('load'); state.magic = positionMagic; return true; },
        RRProcess: () => events.push('ordinary-process'),
        RRNotice: () => events.push('notice'),
    });
    let body = extract(managerSource, 'RRManage').body;
    if (legacyWithoutPostLockCheck) {
        // A mutation of the real current body recreates the former missing
        // post-lock check. No independent implementation of RRManage is used.
        const postLockCheck = /if\s*\(RGPositionExitLatched\(id\)\)\s*\{\s*FileClose\(handle\);\s*continue;\s*\}/;
        assert.match(body, postLockCheck, 'Post-lock race guard must exist in production');
        body = body.replace(postLockCheck, '');
    }
    install(context, managerSource, 'RRManage', body);
    return { context, events, handles, get emergencySends() { return emergencySends; } };
}

let passed = 0;
function check(name, callback) {
    try { callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}
check('without post-lock check, first-file race reaches both emergency and ordinary execution', () => {
    const f = managerFixture({ race: true, legacyWithoutPostLockCheck: true });
    f.context.RRManage('XAUUSD', 321);
    assert.equal(f.emergencySends, 1); assert.ok(f.events.includes('ordinary-process'));
});
check('production rechecks after first journal lock and suppresses ordinary exit in the race', () => {
    const f = managerFixture({ race: true }); f.context.RRManage('XAUUSD', 321);
    assert.equal(f.emergencySends, 1);
    assert.deepEqual(f.events, ['latch:false', 'emergency-no-ordinary-file', 'ordinary-lock', 'latch:true', 'ordinary-unlock']);
    assert.equal(f.handles.size, 0);
});
check('an existing emergency latch skips ordinary journal and execution entirely', () => {
    const f = managerFixture({ latched: [42] }); f.context.RRManage('XAUUSD', 321);
    assert.deepEqual(f.events, ['latch:true']);
});
check('an unrelated emergency latch does not suspend this fresh RR position', () => {
    const f = managerFixture({ latched: [999] }); f.context.RRManage('XAUUSD', 321);
    assert.ok(f.events.includes('capture')); assert.ok(f.events.includes('ordinary-process'));
    assert.equal(f.handles.size, 0);
});
check('existing RR journal resumes normally when guard does not own the position', () => {
    const f = managerFixture({ existingJournal: true }); f.context.RRManage('XAUUSD', 321);
    assert.ok(f.events.includes('load')); assert.ok(!f.events.includes('capture'));
    assert.ok(f.events.includes('ordinary-process')); assert.equal(f.handles.size, 0);
});
check('ordinary journal lock failure cannot reach close decisions', () => {
    const f = managerFixture({ failOpen: true }); f.context.RRManage('XAUUSD', 321);
    assert.ok(f.events.includes('notice')); assert.ok(!f.events.includes('ordinary-process'));
});
check('old positions without an RR journal remain excluded', () => {
    const f = managerFixture({ wasExisting: true }); f.context.RRManage('XAUUSD', 321);
    assert.deepEqual(f.events, []);
});
check('ordinary RR retains symbol and magic isolation', () => {
    for (const options of [{ positionMagic: 999 }, { symbol: 'EURUSD' }]) {
        const f = managerFixture(options); f.context.RRManage('XAUUSD', 321);
        assert.deepEqual(f.events, []);
    }
});

function handlerFixture({ guardAllows = true, initialized = true, rrEnabled = true, reverseBlocks = false, batchActive = false } = {}) {
    const events = [];
    const context = vm.createContext({
        RRPanelInitSucceeded: initialized, RR_Enable: rrEnabled, RGEntryBlocked: !guardAllows,
        RGHistoryDirty: false, SymbolForTrading: 'XAUUSD', sets: { MagicNumber: 321, TrailingStopPoints: 10 },
        LastRecalculationTime: 0, RRLastTimerManagement: 0, RRLastTimerView: 0,
        now: 2000, GetTickCount64: () => context.now, batchActive, RBEntryActive: () => context.batchActive,
        RGManage: magic => { events.push(`guard:${magic}`); return guardAllows; },
        RMManage: () => events.push('manual'),
        RBManageGroups: () => events.push('group-exits'), RBManageEntry: () => events.push('batch-entry'), RCTradeLeave: () => events.push('entry-unlock'),
        RCManageReverse: () => { events.push('reverse'); if (reverseBlocks) context.RGEntryBlocked = true; },
        RRManage: (symbol, magic) => events.push(`rr:${symbol}:${magic}`),
        ExtDialog: { RefreshValues: () => events.push('refresh'), CheckAndRestoreLines: () => events.push('restore-lines') },
        RRRefreshViews: () => events.push('views'), RDFlushAlerts: () => events.push('flush-audio'),
        RDOnTransaction: () => events.push('deal-event'), DoTrailingStop: () => events.push('trailing'),
        ChartRedraw: () => events.push('redraw'),
    });
    for (const name of ['OnTick', 'OnTimer', 'OnTrade', 'OnTradeTransaction']) install(context, entrySource, name);
    return { context, events };
}
check('actual tick handler evaluates money guard before ordinary RR', () => {
    const f = handlerFixture(); f.context.OnTick();
    assert.deepEqual(f.events.slice(0, 7), ['guard:321', 'manual', 'group-exits', 'batch-entry', 'entry-unlock', 'reverse', 'rr::321']);
});
check('actual timer evaluates guard first and dispatches queued actual-deal sounds', () => {
    const f = handlerFixture(); f.context.OnTimer();
    assert.deepEqual(f.events.slice(0, 9), ['guard:321', 'manual', 'group-exits', 'batch-entry', 'entry-unlock', 'reverse', 'rr::321', 'flush-audio', 'views']);
});
check('timer setup requests 100 ms and initialization fails explicitly if unavailable', () => {
    for (const allowed of [false, true]) {
        const periods = [], errors = [];
        const context = vm.createContext({ RRLastTimerManagement: 99, RRLastTimerView: 99,
            EventSetMillisecondTimer: period => { periods.push(period); return allowed; },
            Print: (...args) => errors.push(args), TRANSLATION_MESSAGE_ERROR_SETTING_TIMER: 'timer error', GetLastError: () => 7 });
        install(context, entrySource, 'RRStartTimer');
        assert.equal(context.RRStartTimer(), allowed);
        assert.deepEqual(periods, [100]); assert.equal(errors.length, allowed ? 0 : 1);
        assert.equal(context.RRLastTimerManagement, 0); assert.equal(context.RRLastTimerView, 0);
    }
    assert.match(extract(entrySource, 'OnInit').body, /if\s*\(!RRStartTimer\(\)\)\s*return INIT_FAILED;/);
    assert.doesNotMatch(entrySource, /EventSetTimer\s*\(/);
});
check('active batch polls at 100 ms without ticks and always runs guard before entry', () => {
    const f = handlerFixture({ batchActive: true });
    for (const now of [2000, 2100, 2200]) {
        f.context.now = now; f.events.length = 0; f.context.OnTimer();
        assert.deepEqual(f.events.slice(0, 4), ['guard:321', 'manual', 'group-exits', 'batch-entry']);
    }
});
check('idle timer retains one-second management cadence', () => {
    const f = handlerFixture(); f.context.OnTimer(); f.events.length = 0;
    for (let now = 2100; now < 3000; now += 100) { f.context.now = now; f.context.OnTimer(); }
    assert.deepEqual(f.events, []);
    f.context.now = 3000; f.context.OnTimer();
    assert.equal(f.events.filter(event => event === 'batch-entry').length, 1);
});
check('a new active batch bypasses idle throttle on the next 100 ms event', () => {
    const f = handlerFixture(); f.context.OnTimer(); f.events.length = 0;
    f.context.batchActive = true; f.context.now = 2100; f.context.OnTimer();
    assert.equal(f.events[0], 'guard:321'); assert.ok(f.events.includes('batch-entry'));
});
check('delayed timer performs one management pass without catch-up bursts', () => {
    const f = handlerFixture({ batchActive: true }); f.context.OnTimer(); f.events.length = 0;
    f.context.now = 9200; f.context.OnTimer();
    assert.equal(f.events.filter(event => event === 'batch-entry').length, 1);
    assert.equal(f.context.RRLastTimerManagement, 9200);
});
check('active batch view refresh is throttled without skipping risk or entry checks', () => {
    const f = handlerFixture({ batchActive: true }); f.context.OnTimer(); f.events.length = 0;
    for (let now = 2100; now <= 2500; now += 100) { f.context.now = now; f.context.OnTimer(); }
    assert.equal(f.events.filter(event => event === 'guard:321').length, 5);
    assert.equal(f.events.filter(event => event === 'batch-entry').length, 5);
    assert.equal(f.events.filter(event => event === 'views').length, 1);
});
check('daily guard block prevents ordinary RR on both tick and timer', () => {
    for (const handler of ['OnTick', 'OnTimer']) {
        const f = handlerFixture({ guardAllows: false }); f.context[handler]();
        assert.equal(f.events[0], 'guard:321'); assert.ok(!f.events.some(event => event.startsWith('rr:')));
        assert.deepEqual(f.events.slice(0, 6), ['guard:321', 'manual', 'group-exits', 'batch-entry', 'entry-unlock', 'reverse']);
    }
});
check('money guard still runs with RR disabled, and blocks legacy trailing if locked', () => {
    const f = handlerFixture({ guardAllows: false, rrEnabled: false }); f.context.OnTick();
    assert.equal(f.events[0], 'guard:321'); assert.ok(!f.events.includes('trailing'));
});
check('incomplete panel initialization cannot start timer or tick trading paths', () => {
    const f = handlerFixture({ initialized: false }); f.context.OnTick(); f.context.OnTimer();
    assert.deepEqual(f.events, []);
});
check('actual deal transaction dirties accounting and queues notification without trading', () => {
    const f = handlerFixture(); f.context.OnTradeTransaction({}, {}, {});
    assert.equal(f.context.RGHistoryDirty, true); assert.deepEqual(f.events, ['deal-event']);
});
check('actual OnTrade invalidates realized history cache before UI refresh', () => {
    const f = handlerFixture(); f.context.OnTrade();
    assert.equal(f.context.RGHistoryDirty, true); assert.deepEqual(f.events, ['refresh', 'redraw']);
});
check('manual, reverse and all-symbol RR management stay ahead of the panel timer throttle', () => {
    const f = handlerFixture(); f.context.LastRecalculationTime = 2000; f.context.OnTimer();
    assert.deepEqual(f.events, ['guard:321', 'manual', 'group-exits', 'batch-entry', 'entry-unlock', 'reverse', 'rr::321', 'flush-audio', 'views']);
});
check('a new money block detected during reverse preflight suppresses ordinary RR in the same event', () => {
    for (const handler of ['OnTick', 'OnTimer']) {
        const f = handlerFixture({ reverseBlocks: true }); f.context[handler]();
        assert.deepEqual(f.events.slice(0, 6), ['guard:321', 'manual', 'group-exits', 'batch-entry', 'entry-unlock', 'reverse']);
        assert.ok(!f.events.some(event => event.startsWith('rr:')));
    }
});

check('actual entry preflight checks money guard even when RR is disabled', () => {
    for (const allowed of [false, true]) {
        const events = [];
        const context = vm.createContext({ RBEnabled: false, RBLoadSettings: () => true, RR_Enable: false, sets: { MagicNumber: 321 },
            RGCanOpen: magic => { events.push(`entry-guard:${magic}`); return allowed; } });
        install(context, tradingSource, 'RRBeforeTrade');
        assert.equal(context.RRBeforeTrade(), allowed);
        assert.deepEqual(events, ['entry-guard:321']);
    }
});
check('entry reloads shared batch settings and refuses unreadable or newly enabled unsupported mode', () => {
    for (const readable of [false, true]) {
        const events=[];
        const context=vm.createContext({RBEnabled:false,RR_Enable:false,Instant:0,sets:{MagicNumber:321,EntryType:0},
            RGCanOpen:()=>true,Alert:()=>events.push('blocked')});
        context.RBLoadSettings=()=>{events.push('load');context.RBEnabled=true;return readable;};
        install(context,tradingSource,'RRBeforeTrade');
        assert.equal(context.RRBeforeTrade(),false);
        assert.deepEqual(events,['load','blocked']);
    }
});
check('Trade core always starts with guarded entry preflight', () => {
    const { body } = extract(tradingSource, 'RCTradeCore');
    assert.match(body.trimStart(), /^if\s*\(!RRBeforeTrade\(\)\)\s*return;/);
});
check('Trade wrapper reaches the guarded core only with the entry lock and releases it afterwards', () => {
    for (const allowed of [false, true]) {
        const events = [];
        const context = vm.createContext({
            RCTradeEnter: () => { events.push('enter'); return allowed; },
            RCTradeCore: () => events.push('guarded-core'), RCTradeLeave: () => events.push('leave'),
        });
        install(context, tradingSource, 'Trade'); context.Trade();
        assert.deepEqual(events, allowed ? ['enter', 'guarded-core', 'leave'] : ['enter']);
    }
});
check('both pending and market sends recheck daily guard after their confirmation dialog', () => {
    const { body } = extract(tradingSource, 'RCTradeCore');
    const sendSites = [...body.matchAll(/if\s*\(!Trade\.(OrderOpen|PositionOpen)\(/g)];
    assert.equal(sendSites.length, 2);
    for (const site of sendSites) {
        const prefix = body.slice(0, site.index);
        const confirmation = prefix.lastIndexOf('CheckConfirmation(');
        const guard = prefix.lastIndexOf('if ((!RGCanOpen(sets.MagicNumber))');
        assert.ok(confirmation >= 0 && guard > confirmation, `${site[1]} must recheck after confirmation`);
        const guardBlock = prefix.slice(guard).trim();
        assert.match(guardBlock, /isOrderPlacementFailing\s*=\s*true;\s*break;\s*\}$/);
        assert.ok(!guardBlock.includes('CheckConfirmation('));
    }
});
check('post-entry ordinary management is conditional on a fresh guard result', () => {
    const { body } = extract(tradingSource, 'RCTradeCore');
    assert.match(body, /if\s*\(AtLeastOneOrderExecuted\s*&&\s*RGManage\(sets\.MagicNumber,\s*true\)\)\s*RRManage\("",\s*sets\.MagicNumber\)/);
});

// This fixture substitutes account settings, accounting, durable storage and
// execution boundaries. Trigger decisions, latch precedence and entry gating
// are the actual production RGManage/RGCanOpen bodies, not a second engine.
function settingsGuardFixture() {
    const events = [];
    const blankDay = () => ({ day: 0, locked: 0, drained: 0, limit: 0, trigger_net: 0 });
    const b = {
        now: 86400 * 20000 + 3600, account: 11, server: 'Demo',
        settingsOK: true, saved: { single: 0, scope: 0, daily: 0 }, draft: {},
        net: 0, snapshotOK: true, daily: null, positions: [], orders: [],
        exitLatches: new Set(), cancelLatches: new Set(), sends: [], saves: [], alerts: [], handles: new Set(),
    };
    const context = vm.createContext({
        RG_OWN_MAGIC: 0, RG_ENTIRE_ACCOUNT: 1,
        RGCurrentPositionLossLimit: 0, RGCurrentPositionScope: 0, RGCurrentDailyLossLimit: 0,
        RGAccount: 11, RGServer: 'Demo', RGEntryBlocked: false, RGDailyLocked: false,
        RGHistoryDirty: true, RGSnapshotReady: false, RGRealized: 0, RGFloating: 0,
        RGCachedDay: 0, RGHistoryAt: 0, RGLastError: '', RGStatus: '', RGSettingsError: '',
        ACCOUNT_LOGIN: 'login', ACCOUNT_SERVER: 'server', ACCOUNT_CURRENCY: 'currency',
        POSITION_IDENTIFIER: 'id', POSITION_MAGIC: 'magic', POSITION_PROFIT: 'profit', POSITION_SWAP: 'swap',
        FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, INVALID_HANDLE: -1,
        AccountInfoInteger: () => b.account,
        AccountInfoString: p => p === 'server' ? b.server : 'USD',
        TimeCurrent: () => b.now, RGDayStart: now => Math.floor(now / 86400) * 86400,
        RGSyncSettings: () => {
            events.push('sync-settings');
            context.RGSettingsError = b.settingsOK ? '' : '共享设置暂时不可读取';
            if (!b.settingsOK) return false;
            context.RGCurrentPositionLossLimit = b.saved.single;
            context.RGCurrentPositionScope = b.saved.scope;
            context.RGCurrentDailyLossLimit = b.saved.daily;
            return true;
        },
        RGReadSnapshot: (_now, force) => {
            events.push(`snapshot:${force}`); context.RGRealized = b.net; context.RGFloating = 0; return b.snapshotOK;
        },
        RGDailyFileName: () => 'daily', FileIsExist: () => b.daily !== null,
        FileOpen: () => { b.handles.add(1); return 1; }, FileClose: h => b.handles.delete(h),
        ZeroMemory: s => Object.assign(s, blankDay()),
        RGLoadDay: (_h, s, today) => { Object.assign(s, b.daily ?? { ...blankDay(), day: today }); return true; },
        RGSaveDay: (_h, s) => {
            events.push(`save-day:${s.locked}:${s.drained}`);
            b.daily = structuredClone(s); b.saves.push(structuredClone(s)); return true;
        },
        MathIsValidNumber: Number.isFinite,
        PositionsTotal: () => b.positions.length, OrdersTotal: () => b.orders.length,
        PositionGetTicket: i => { context.selectedPosition = b.positions[i]; return context.selectedPosition?.ticket ?? 0; },
        PositionGetInteger: p => context.selectedPosition[p], PositionGetDouble: p => context.selectedPosition[p] ?? 0,
        OrderGetTicket: i => b.orders[i]?.ticket ?? 0,
        RGPositionExitLatched: id => b.exitLatches.has(id), RGOrderCancelLatched: ticket => b.cancelLatches.has(ticket),
        RGCancelOrder: (ticket, trigger) => {
            events.push('cancel'); b.sends.push({ kind: 'cancel', ticket, trigger });
            b.orders = b.orders.filter(o => o.ticket !== ticket); return true;
        },
        RGExitPosition: (ticket, trigger) => {
            events.push('close'); b.sends.push({ kind: 'close', ticket, trigger });
            b.positions = b.positions.filter(p => p.ticket !== ticket); return true;
        },
        StringFormat: (format, ...values) => `${format} ${values.join(' ')}`,
        RDPlayRiskAlert: message => b.alerts.push(message), RRNotice: () => {},
        Alert: (...parts) => b.alerts.push(parts.join('')),
    });
    for (const name of ['RGLimitHit', 'RGPositionInScope', 'RGAdvanceDay', 'RGResetContext', 'RGManage', 'RGCanOpen'])
        install(context, guardSource, name);
    const position = (ticket, profit, magic = 321) => {
        const p = { ticket, id: ticket + 1000, profit, swap: 0, magic }; b.positions.push(p); return p;
    };
    const seedLock = (overrides = {}) => {
        b.daily = { ...blankDay(), day: context.RGDayStart(b.now), locked: 1, limit: 500, trigger_net: -600, ...overrides };
    };
    return { b, context, events, position, seedLock };
}
check('saved lower single-position threshold applies to the already-open position on the next pass', () => {
    const f = settingsGuardFixture(); f.b.saved.single = 500; f.position(1, -300);
    assert.equal(f.context.RGManage(321), true); assert.equal(f.b.sends.length, 0);
    f.b.saved.single = 200; f.events.length = 0;
    f.context.RGManage(321);
    assert.deepEqual(f.events.slice(0, 2), ['sync-settings', 'snapshot:false']);
    assert.deepEqual(f.b.sends, [{ kind: 'close', ticket: 1, trigger: 'position' }]);
});
check('a draft lower threshold never reaches the engine until it is saved', () => {
    const f = settingsGuardFixture(); f.b.saved.single = 500; f.b.draft.single = 100; f.position(1, -300);
    f.context.RGManage(321);
    assert.equal(f.context.RGCurrentPositionLossLimit, 500); assert.equal(f.b.sends.length, 0);
    f.b.saved.single = f.b.draft.single; f.context.RGManage(321);
    assert.equal(f.b.sends.length, 1);
});
check('saved lower daily threshold immediately latches current losses and cancels before closing', () => {
    const f = settingsGuardFixture(); f.b.saved.daily = 1000; f.b.net = -600;
    f.position(1, 100, 0); f.b.orders.push({ ticket: 2 });
    assert.equal(f.context.RGManage(321), true); assert.equal(f.b.sends.length, 0);
    f.b.saved.daily = 500;
    assert.equal(f.context.RGManage(321), false);
    assert.deepEqual(f.b.sends.map(s => s.kind), ['cancel', 'close']);
    assert.equal(f.b.daily.limit, 500); assert.equal(f.b.daily.trigger_net, -600);
    assert.equal(f.b.daily.locked, 1); assert.equal(f.b.daily.drained, 1);
    assert.ok(f.events.indexOf('save-day:1:0') < f.events.indexOf('cancel'));
});
check('changing scope affects existing positions at the next settings synchronization', () => {
    const f = settingsGuardFixture(); f.b.saved.single = 200; f.position(1, -300, 999);
    f.context.RGManage(321); assert.equal(f.b.sends.length, 0);
    f.b.saved.scope = f.context.RG_ENTIRE_ACCOUNT; f.context.RGManage(321);
    assert.equal(f.b.sends[0].ticket, 1);
});
check('disabling or raising the daily threshold never clears a current-day durable lock', () => {
    for (const limit of [0, 100000]) {
        const f = settingsGuardFixture(); f.seedLock(); f.b.saved.daily = limit; f.position(1, 100);
        assert.equal(f.context.RGCanOpen(321), false);
        assert.equal(f.b.daily.locked, 1); assert.equal(f.b.daily.limit, 500);
        assert.equal(f.b.daily.trigger_net, -600); assert.equal(f.b.sends[0].trigger, 'daily');
    }
});
check('disabling single protection and narrowing scope retain an existing position exit latch', () => {
    const f = settingsGuardFixture(); const p = f.position(1, 100, 999); f.b.exitLatches.add(p.id);
    f.context.RGManage(321);
    assert.deepEqual(f.b.sends, [{ kind: 'close', ticket: 1, trigger: '' }]);
});
check('unreadable shared settings fail closed without triggering unverified default thresholds', () => {
    const f = settingsGuardFixture(); f.b.settingsOK = false; f.b.net = -10000; f.position(1, -10000);
    f.context.RGCurrentPositionLossLimit = 1; f.context.RGCurrentDailyLossLimit = 1;
    assert.equal(f.context.RGCanOpen(321), false);
    assert.equal(f.b.sends.length, 0); assert.equal(f.b.saves.length, 0); assert.equal(f.b.daily, null);
    assert.match(f.context.RGStatus, /共享设置暂时不可读取/); assert.equal(f.b.handles.size, 0);
});
check('unreadable settings still drain a daily lock across all magic numbers and pending orders', () => {
    const f = settingsGuardFixture(); f.b.settingsOK = false; f.seedLock(); f.position(1, 100, 999);
    f.b.orders.push({ ticket: 2 });
    assert.equal(f.context.RGManage(321), false);
    assert.deepEqual(f.b.sends.map(s => s.kind), ['cancel', 'close']);
    assert.ok(f.b.sends.every(s => s.trigger === 'daily'));
    assert.equal(f.b.daily.locked, 1); assert.equal(f.b.daily.drained, 1); assert.equal(f.b.alerts.length, 0);
    assert.match(f.context.RGStatus, /共享设置暂时不可读取/); assert.equal(f.b.handles.size, 0);
});
check('unreadable settings continue single-position and order latches without creating unrelated exits', () => {
    const f = settingsGuardFixture(); f.b.settingsOK = false;
    const p = f.position(1, 100, 999); f.position(3, -10000); f.b.exitLatches.add(p.id);
    f.b.orders.push({ ticket: 2 }, { ticket: 4 }); f.b.cancelLatches.add(2);
    assert.equal(f.context.RGManage(321), false);
    assert.deepEqual(f.b.sends, [{ kind: 'cancel', ticket: 2, trigger: '' }, { kind: 'close', ticket: 1, trigger: '' }]);
    assert.deepEqual(f.b.positions.map(p => p.ticket), [3]); assert.deepEqual(f.b.orders.map(o => o.ticket), [4]);
});
check('settings recovery removes its entry block while preserving any independent daily lock', () => {
    for (const locked of [false, true]) {
        const f = settingsGuardFixture(); if (locked) f.seedLock({ drained: 1 });
        f.b.settingsOK = false; assert.equal(f.context.RGCanOpen(321), false);
        f.b.settingsOK = true; assert.equal(f.context.RGCanOpen(321), !locked);
        assert.doesNotMatch(f.context.RGStatus, /设置未就绪/);
    }
});
check('fresh pre-send entry check synchronizes a cross-chart cap update and forces a current snapshot', () => {
    const f = settingsGuardFixture(); f.b.saved.daily = 1000; f.b.net = -600;
    assert.equal(f.context.RGCanOpen(321), true);
    f.b.saved.daily = 500; f.events.length = 0;
    assert.equal(f.context.RGCanOpen(321), false);
    assert.deepEqual(f.events.slice(0, 2), ['sync-settings', 'snapshot:true']); assert.equal(f.b.daily.locked, 1);
});
check('account context reset happens before settings synchronization and does not erase its failure block', () => {
    const f = settingsGuardFixture(); f.b.account = 22; f.b.settingsOK = false;
    assert.equal(f.context.RGManage(321), false);
    assert.equal(f.context.RGAccount, 22); assert.equal(f.context.RGEntryBlocked, true);
    assert.match(f.context.RGStatus, /共享设置暂时不可读取/);
});
check('initialization loads shared settings before controls and keeps the settings page recoverable on load failure', () => {
    const { body } = extract(entrySource, 'OnInit');
    const defaults = body.indexOf('RGUseInputDefaults();');
    const settings = body.indexOf('RGInitSettings()');
    const controls = body.indexOf('new CPositionSizeCalculator');
    assert.ok(defaults >= 0 && settings > defaults && controls > settings);
    assert.match(body, /if\s*\(!RGInitSettings\(\)\)\s*Print\([^;]+;/);
    assert.doesNotMatch(body, /if\s*\(!RGInitSettings\(\)\)[^\n]*return/);
});

process.stdout.write(`\n${passed} guard integration tests passed against production functions.\n`);
process.stdout.write('Scope: in-memory scheduling and boundary simulation, plus source contracts for the full trading form. No live trading.\n');
