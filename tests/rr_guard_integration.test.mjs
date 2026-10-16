// Executes production manager/event-handler bodies against inert MT5 boundaries.
// No terminal is opened and no real trading request is sent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const managerSource = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const entrySource = readFileSync(new URL('../mt5/Position Sizer RR.mq5', import.meta.url), 'utf8');
const tradingSource = readFileSync(new URL('../mt5/Position Sizer Trading.mqh', import.meta.url), 'utf8');

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
        const parameter = /^\s*(?:const\s+)?\w+\s*&?\s*(\w+)\s*$/.exec(arg);
        assert.ok(parameter, `Unsupported argument ${arg}`);
        return parameter[1];
    }) : [];
    return { args, body: source.slice(start, end - 1) };
}
function adapt(body) {
    return body
        .replace(/\bRRState\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\b(?:const\s+)?(?:bool|int|long|ulong|string|double)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:long|ulong|int|double)\)/g, '');
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

function handlerFixture({ guardAllows = true, initialized = true, rrEnabled = true } = {}) {
    const events = [];
    const context = vm.createContext({
        RRPanelInitSucceeded: initialized, RR_Enable: rrEnabled, RGEntryBlocked: !guardAllows,
        RGHistoryDirty: false, SymbolForTrading: 'XAUUSD', sets: { MagicNumber: 321, TrailingStopPoints: 10 },
        LastRecalculationTime: 0, GetTickCount64: () => 2000,
        RGManage: magic => { events.push(`guard:${magic}`); return guardAllows; },
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
    assert.deepEqual(f.events.slice(0, 2), ['guard:321', 'rr:XAUUSD:321']);
});
check('actual timer evaluates guard first and dispatches queued actual-deal sounds', () => {
    const f = handlerFixture(); f.context.OnTimer();
    assert.deepEqual(f.events.slice(0, 4), ['guard:321', 'rr:XAUUSD:321', 'flush-audio', 'views']);
});
check('daily guard block prevents ordinary RR on both tick and timer', () => {
    for (const handler of ['OnTick', 'OnTimer']) {
        const f = handlerFixture({ guardAllows: false }); f.context[handler]();
        assert.equal(f.events[0], 'guard:321'); assert.ok(!f.events.some(event => event.startsWith('rr:')));
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

check('actual entry preflight checks money guard even when RR is disabled', () => {
    for (const allowed of [false, true]) {
        const events = [];
        const context = vm.createContext({ RR_Enable: false, sets: { MagicNumber: 321 },
            RGCanOpen: magic => { events.push(`entry-guard:${magic}`); return allowed; } });
        install(context, tradingSource, 'RRBeforeTrade');
        assert.equal(context.RRBeforeTrade(), allowed);
        assert.deepEqual(events, ['entry-guard:321']);
    }
});
check('Trade always starts with guarded entry preflight', () => {
    const { body } = extract(tradingSource, 'Trade');
    assert.match(body.trimStart(), /^if\s*\(!RRBeforeTrade\(\)\)\s*return;/);
});
check('both pending and market sends recheck daily guard after their confirmation dialog', () => {
    const { body } = extract(tradingSource, 'Trade');
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
    const { body } = extract(tradingSource, 'Trade');
    assert.match(body, /if\s*\(AtLeastOneOrderExecuted\s*&&\s*RGManage\(sets\.MagicNumber,\s*true\)\)\s*RRManage\(/);
});

process.stdout.write(`\n${passed} guard integration tests passed against production functions.\n`);
process.stdout.write('Scope: in-memory scheduling and boundary simulation, plus source contracts for the full trading form. No live trading.\n');
