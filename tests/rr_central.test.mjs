// Production central-controller bodies; all files, charts and trades are mocked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRCentral.mqh', import.meta.url), 'utf8');
const trading = readFileSync(new URL('../mt5/Position Sizer Trading.mqh', import.meta.url), 'utf8');
const fields = [.../struct RCOptionRecord\s*\{([^}]+)\}/.exec(source)[1].matchAll(/\b(uint|int)\s+(\w+);/g)];
const recordSize = fields.length * 4;
const clone = value => structuredClone(value);
function extract(name, text = source) {
    const match = new RegExp(`(?:bool|void|string)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(text);
    assert.ok(match, `Actual function ${name} must exist`);
    const args = match[1].split(',').filter(arg => arg.trim()).map(arg => arg.trim().match(/(\w+)$/)[1]);
    let depth = 1, start = match.index + match[0].length, end = start;
    for (; end < text.length && depth; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
    }
    let body = text.slice(start, end - 1)
        .replace(/\b(?:RCOptionRecord|RRPlan)\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\b(?:const\s+)?(?:bool|string|int|uint|long|ulong|double|ENUM_ORDER_TYPE)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:int|uint|long|ulong|ENUM_ORDER_TYPE|ENUM_TIMEFRAMES)\)/g, '')
        .replaceAll('sizeof(RCOptionRecord)', String(recordSize));
    if (name === 'RCSetCloseOpposite') body = body.replace(/\berror\s*=/g, 'error.value =');
    if (name === 'RCQueueReverse') body = body.replace('let error;', 'let error = { value: "" };');
    if (name === 'RCTradeEnter') body = body.replace('let error;', 'let error = { value: "" };');
    return `function ${name}(${args.join(',')}) {${body}\n}`;
}
const names = [...source.matchAll(/(?:bool|void|string)\s+(RC\w+)\s*\([^)]*\)\s*\{/g)].map(match => match[1]);
const constants = ['ACCOUNT_SERVER', 'ACCOUNT_LOGIN', 'POSITION_SYMBOL', 'POSITION_TYPE', 'POSITION_IDENTIFIER',
    'ACCOUNT_MARGIN_MODE', 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING', 'POSITION_MAGIC', 'ORDER_MAGIC', 'SYMBOL_VOLUME_STEP',
    'ORDER_SYMBOL', 'ORDER_TYPE', 'ORDER_TYPE_BUY', 'ORDER_TYPE_SELL', 'ORDER_TYPE_BUY_LIMIT', 'ORDER_TYPE_BUY_STOP',
    'ORDER_TYPE_BUY_STOP_LIMIT', 'ORDER_TYPE_SELL_LIMIT', 'ORDER_TYPE_SELL_STOP', 'ORDER_TYPE_SELL_STOP_LIMIT'];
let env;
let panel;
function defaults() {
    return { MagicNumber: 123, TradeDirection: 1, EntryType: 0, EntryLevel: 100, StopLossLevel: 90,
        StopPriceLevel: 0, UseMoneyInsteadOfPercentage: false, RiskFromPositionSize: false,
        PositionSize: 0.5, MoneyRisk: 10, Risk: 1, TakeProfitsNumber: 1,
        DoNotApplyStopLoss: false, DoNotApplyTakeProfit: false, SLDistanceInPoints: false, StopLoss: 100,
        ATRMultiplierSL: 0, ATRPeriod: 14, ATRTimeframe: 15, SpreadAdjustmentSL: false,
        MaxNumberOfTradesTotal: 0, MaxNumberOfTradesPerSymbol: 0 };
}
function position(overrides = {}) { return { id: 42, ticket: 456, symbol: 'TEST', direction: -1, magic: 999, ...overrides }; }
function order(overrides = {}) { return { ticket: 300, symbol: 'TEST', type: 'ORDER_TYPE_SELL_LIMIT', magic: 999, ...overrides }; }
function reset(overrides = {}) {
    env = { account: 1001, server: 'Test-Server', files: {}, handles: new Map(), locks: new Set(), nextHandle: 0,
        positions: [position()], orders: [], requests: [], jobs: new Map(), risk: new Set(),
        alerts: [], prints: [], tradeCalls: [], entries: [], events: [], lastError: 0,
        canTrade: true, guardAllowed: true, splitAllowed: true, preflightAllowed: true, manualAllowed: true,
        writeFails: false, readFails: false, flushFails: false, seekFails: false,
        step: 0.01, slotAvailable: true,
        sharedPlan: { checksum: 17 }, planReadable: true, planReads: 0, ...overrides };
    panel = makePanel();
}
function makePanel() {
    const context = vm.createContext({
        ...Object.fromEntries(constants.map(name => [name, name])),
        INVALID_HANDLE: -1, FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, SEEK_SET: 0,
        POSITION_TYPE_BUY: 1, Long: 1, Instant: 0, _Symbol: 'TEST', SymbolForTrading: 'TEST',
        sets: defaults(), RRActivePlan: { checksum: 17 }, RR_Enable: true, ShowATROptions: false, ShowMaxParametersOnTrading: true,
        RCCloseOpposite: false, RCSettingsReady: false, RCPendingStatus: '', RCReversePending: false,
        RCResuming: false, RCEntryLock: -1, RCQueuedSymbol: '', RCQueuedFingerprint: '', RCQueuedServer: '',
        RCQueuedAccount: 0, RCQueuedDirection: 0, RCQueuedVolume: 0, RCQueuedIDs: [],
        RRHash: value => { let hash = 2166136261; for (const c of value) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0; return hash; },
        IntegerToString: String, DoubleToString: (value, digits) => Number(value).toFixed(digits),
        AccountInfoString: () => env.server,
        AccountInfoInteger: key => key === 'ACCOUNT_MARGIN_MODE' ? 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING' : env.account,
        SymbolInfoDouble: () => env.step, MathIsValidNumber: Number.isFinite, MathMax: Math.max,
        FileIsExist: path => Object.hasOwn(env.files, path),
        FileOpen: (path, flags) => {
            if (env.locks.has(path) || env.failOpen === path) return -1;
            if (!env.files[path]) {
                if (!(flags & 2)) return -1;
                env.files[path] = { bytes: 0, record: null };
            }
            const handle = ++env.nextHandle;
            env.handles.set(handle, { path, flags, cursor: 0 }); env.locks.add(path); return handle;
        },
        FileClose: handle => {
            assert.ok(env.handles.has(handle), 'close an owned handle');
            env.locks.delete(env.handles.get(handle).path); env.handles.delete(handle);
        },
        FileSize: handle => env.files[env.handles.get(handle).path].bytes,
        FileSeek: (handle, offset) => {
            if (env.seekFails) return false;
            env.handles.get(handle).cursor = offset; return true;
        },
        FileReadStruct: (handle, record) => {
            const state = env.handles.get(handle), file = env.files[state.path];
            if (env.readFails || state.cursor + recordSize > file.bytes || !file.record) return 0;
            Object.assign(record, clone(file.record)); state.cursor += recordSize; return recordSize;
        },
        FileWriteStruct: (handle, record) => {
            const state = env.handles.get(handle), file = env.files[state.path];
            assert.ok(state.flags & 2);
            const written = env.writeFails ? recordSize - 1 : recordSize;
            file.record = clone(record); file.bytes = Math.max(file.bytes, state.cursor + written); state.cursor += written;
            env.events.push(['write', state.path]); return written;
        },
        ResetLastError: () => { env.lastError = 0; }, GetLastError: () => env.lastError,
        FileFlush: () => { if (env.flushFails) env.lastError = 5; },
        ZeroMemory: record => Object.assign(record, { version: 0, enabled: 0, checksum: 0 }),
        ArrayResize: (array, size) => { array.length = size; return size; }, ArraySize: array => array.length,
        PositionsTotal: () => env.positions.length,
        PositionGetTicket: index => { env.selectedPosition = env.positions[index]; return env.selectedPosition?.ticket ?? 0; },
        PositionSelectByTicket: ticket => { env.selectedPosition = env.positions.find(p => p.ticket === ticket); return Boolean(env.selectedPosition); },
        PositionGetString: () => env.selectedPosition?.symbol,
        PositionGetInteger: key => ({ POSITION_TYPE: env.selectedPosition?.direction,
            POSITION_IDENTIFIER: env.selectedPosition?.id, POSITION_MAGIC: env.selectedPosition?.magic })[key],
        OrdersTotal: () => env.orders.length,
        OrderGetTicket: index => { env.selectedOrder = env.orders[index]; return env.selectedOrder?.ticket ?? 0; },
        OrderSelect: ticket => { env.selectedOrder = env.orders.find(o => o.ticket === ticket); return Boolean(env.selectedOrder); },
        OrderGetString: () => env.selectedOrder?.symbol,
        OrderGetInteger: key => key === 'ORDER_MAGIC' ? env.selectedOrder?.magic : env.selectedOrder?.type,
        RRPlanChecksum: plan => plan.checksum,
        RRPlanFileName: () => `plan:${env.server}:${env.account}`,
        RRPlanRead: (_filename, plan, error) => {
            env.planReads++; if (!env.planReadable) { error.value = 'fixture unreadable plan'; return false; }
            Object.assign(plan, clone(env.sharedPlan)); return true;
        },
        RRCanSplitVolume: () => env.splitAllowed, RRCanTrade: () => env.canTrade,
        RRNettingSlotAvailable: () => env.slotAvailable,
        RGCanOpen: () => { if (env.onGuardCheck) env.onGuardCheck(); return env.guardAllowed; },
        RGPositionExitLatched: id => env.risk.has(id),
        RGPositionIdentifierExists: id => env.positions.some(p => p.id === id),
        RMSelectIdentifier: id => {
            if (env.onManualSelect) env.onManualSelect(id);
            env.selectedPosition = env.positions.find(p => p.id === id); return env.selectedPosition?.ticket ?? 0;
        },
        RMPositionExitActive: id => env.jobs.has(id) && !env.jobs.get(id).settled,
        RMExitSettled: id => {
            env.events.push(['settled?', id]);
            return !env.positions.some(p => p.id === id) && (!env.jobs.has(id) || env.jobs.get(id).settled);
        },
        RMRequestClose: (id, percent, magic, error, expected_direction = 0) => {
            env.requests.push({ id, percent, magic, expected_direction });
            if (!env.manualAllowed || env.failManualID === id) { error.value = 'fixture failure'; return false; }
            env.jobs.set(id, { settled: false, pending: true }); return true;
        },
        Alert: (...args) => env.alerts.push(args), Print: (...args) => env.prints.push(args),
        Trade: () => {
            env.tradeCalls.push({ volume: context.RCQueuedVolume, resuming: context.RCResuming });
            if (!context.RCTradeEnter()) return;
            if (env.preflightAllowed && env.guardAllowed && context.RCEntryClear()) env.entries.push({ symbol: context.SymbolForTrading });
            context.RCTradeLeave();
        },
    });
    for (const name of names) vm.runInContext(extract(name), context, { filename: `production:${name}` });
    return context;
}
function setOption(enabled, ctx = panel) {
    const error = { value: '' }; return { ok: ctx.RCSetCloseOpposite(enabled, error), error: error.value };
}
function queue(ctx = panel, volume = 0.5) {
    if (!ctx.RCTradeEnter()) return false;
    const queued = ctx.RCQueueReverse(volume); ctx.RCTradeLeave(); return queued;
}
function settled(id = 42) {
    env.positions = env.positions.filter(p => p.id !== id);
    if (env.jobs.has(id)) env.jobs.get(id).settled = true;
}
let passed = 0;
function check(name, callback) {
    try { reset(); callback(); passed++; console.log(`PASS ${name}`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}

check('missing option defaults off and does not create a saved setting', () => {
    assert.equal(panel.RCLoadOption(), true); assert.equal(panel.RCCloseOpposite, false);
    assert.equal(panel.RCSettingsReady, true); assert.equal(Object.keys(env.files).length, 0);
    assert.equal(queue(), false); assert.equal(env.requests.length, 0); assert.equal(env.handles.size, 0);
});
check('verified setting survives a new panel and shares account namespace', () => {
    assert.equal(setOption(true).ok, true); const other = makePanel();
    assert.equal(other.RCLoadOption(), true); assert.equal(other.RCCloseOpposite, true);
    assert.equal(env.files[panel.RCOptionFile()].bytes, recordSize); assert.equal(recordSize, 12);
});
check('saved option is bound to account and server', () => {
    setOption(true); env.account = 2002; assert.equal(panel.RCLoadOption(), true); assert.equal(panel.RCCloseOpposite, false);
    env.account = 1001; env.server = 'Other'; panel.RCLoadOption(); assert.equal(panel.RCCloseOpposite, false);
});
check('option mutex prevents cross-panel writes and failed load blocks entries', () => {
    setOption(true); env.locks.add(panel.RCOptionFile());
    assert.equal(setOption(false).ok, false); assert.equal(panel.RCCloseOpposite, true);
    assert.equal(panel.RCTradeEnter(), false); assert.equal(panel.RCSettingsReady, false);
    assert.equal(env.requests.length, 0);
});
check('invalid version, boolean, checksum and frame length reject load and overwrite', () => {
    for (const change of [{ version: 2 }, { enabled: 2 }, { checksum: 0 }, { bytes: recordSize - 1 }, { bytes: recordSize * 2 }]) {
        reset(); setOption(true); const file = env.files[panel.RCOptionFile()];
        if ('bytes' in change) file.bytes = change.bytes; else Object.assign(file.record, change);
        const before = clone(file); assert.equal(panel.RCLoadOption(), false); assert.equal(setOption(false).ok, false);
        assert.deepEqual(file, before); assert.equal(panel.RCTradeEnter(), false);
    }
});
check('short write, flush and readback failures do not publish new setting immediately', () => {
    for (const changes of [{ writeFails: true }, { flushFails: true }, { readFails: true }]) {
        reset(changes); assert.equal(setOption(true).ok, false); assert.equal(panel.RCCloseOpposite, false);
        assert.equal(panel.RCSettingsReady, false); assert.equal(env.handles.size, 0);
    }
});
check('a full but unconfirmed option write can be reloaded later without false rollback guarantees', () => {
    env.flushFails = true; assert.equal(setOption(true).ok, false);
    env.flushFails = false; assert.equal(panel.RCLoadOption(), true); assert.equal(panel.RCCloseOpposite, true);
});
check('reverse gathers every opposite same-symbol position regardless of magic', () => {
    env.positions = [position(), position({ id: 43, ticket: 457, magic: 123 }),
        position({ id: 44, ticket: 458, direction: 1 }), position({ id: 45, ticket: 459, symbol: 'OTHER' })];
    setOption(true); assert.equal(queue(), true); assert.equal(panel.RCReversePending, true);
    assert.deepEqual(env.requests.map(r => r.id).sort(), [42, 43]);
    assert.ok(env.requests.every(r => r.percent === 100 && r.expected_direction === -1)); assert.equal(env.entries.length, 0);
    assert.equal(env.handles.size, 1);
});
check('same-direction or other-symbol positions do not invoke reverse queue', () => {
    env.positions = [position({ direction: 1 }), position({ id: 43, symbol: 'OTHER' })];
    setOption(true); assert.equal(queue(), false); assert.equal(env.requests.length, 0); assert.equal(env.handles.size, 0);
});
check('sell intent classifies buy positions as opposite', () => {
    panel.sets.TradeDirection = -1; env.positions = [position({ direction: 1 })];
    setOption(true); assert.equal(queue(), true); assert.equal(env.requests[0].id, 42);
});
check('all opposite order types block entry regardless of their magic', () => {
    for (const type of ['ORDER_TYPE_SELL', 'ORDER_TYPE_SELL_LIMIT', 'ORDER_TYPE_SELL_STOP', 'ORDER_TYPE_SELL_STOP_LIMIT']) {
        reset(); setOption(true); env.orders = [order({ type })]; assert.equal(queue(), false);
        assert.equal(env.requests.length, 0); assert.equal(env.handles.size, 0);
    }
});
check('same-direction and unrelated-symbol pending orders do not block reverse', () => {
    setOption(true); env.orders = [order({ type: 'ORDER_TYPE_BUY_LIMIT' }), order({ ticket: 301, symbol: 'OTHER' })];
    assert.equal(queue(), true); assert.equal(env.requests.length, 1);
});
check('split entries, invalid RR lot, unavailable trading and money lock cannot start closes', () => {
    for (const scenario of ['split', 'lot', 'offline', 'guard']) {
        reset(); setOption(true);
        if (scenario === 'split') panel.sets.TakeProfitsNumber = 2;
        if (scenario === 'lot') env.splitAllowed = false;
        if (scenario === 'offline') env.canTrade = false;
        if (scenario === 'guard') env.guardAllowed = false;
        assert.equal(queue(), true); assert.equal(panel.RCReversePending, false); assert.equal(env.requests.length, 0);
        assert.equal(env.handles.size, 0);
    }
});
check('existing manual or risk exit prevents a second reverse registration', () => {
    for (const kind of ['manual', 'risk']) {
        reset(); setOption(true); if (kind === 'manual') env.jobs.set(42, { settled: false }); else env.risk.add(42);
        queue(); assert.equal(env.requests.length, 0); assert.equal(panel.RCReversePending, false);
    }
});
check('partial registration failure leaves accepted closes running but cancels opening', () => {
    env.positions.push(position({ id: 43, ticket: 457 })); env.failManualID = 42; setOption(true); queue();
    assert.equal(env.jobs.has(43), true); assert.equal(panel.RCReversePending, false);
    panel.RCManageReverse(); assert.equal(env.entries.length, 0); assert.equal(env.handles.size, 0);
});
check('one of multiple closes completing cannot open the new position', () => {
    env.positions.push(position({ id: 43, ticket: 457 })); setOption(true); queue(); settled(43);
    panel.RCManageReverse(); assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, true);
});
check('absent position with unconfirmed close remains queued without opening', () => {
    setOption(true); queue(); env.positions = []; panel.RCManageReverse();
    assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, true);
    assert.ok(env.events.some(e => e[0] === 'settled?' && e[1] === 42));
});
check('after every close is settled original Trade is invoked exactly once', () => {
    setOption(true); queue(); settled(); panel.RCManageReverse(); panel.RCManageReverse();
    assert.equal(env.tradeCalls.length, 1); assert.equal(env.entries.length, 1);
    assert.equal(env.tradeCalls[0].resuming, true); assert.equal(env.tradeCalls[0].volume, 0.5);
    assert.equal(panel.RCReversePending, false); assert.equal(panel.RCResuming, false); assert.equal(env.handles.size, 0);
});
check('failed final preflight never automatically retries opening', () => {
    setOption(true); queue(); settled(); env.preflightAllowed = false; panel.RCManageReverse();
    env.preflightAllowed = true; panel.RCManageReverse(); assert.equal(env.tradeCalls.length, 1); assert.equal(env.entries.length, 0);
});
check('risk takeover cancels opening even if old position and manual job already finished', () => {
    setOption(true); queue(); settled(); env.risk.add(42); panel.RCManageReverse();
    assert.equal(env.tradeCalls.length, 0); assert.equal(panel.RCReversePending, false); assert.equal(env.handles.size, 0);
});
check('money guard becoming blocked cancels queued entry while closes continue', () => {
    setOption(true); queue(); env.guardAllowed = false; panel.RCManageReverse();
    assert.equal(env.tradeCalls.length, 0); assert.equal(panel.RCReversePending, false); assert.equal(env.jobs.get(42).pending, true);
});
check('SL, side, entry type, magic, sizing, RR plan or execution flag changes cancel queued entry', () => {
    const edits = [p => p.sets.StopLossLevel++, p => p.sets.TradeDirection = -1, p => p.sets.EntryType = 1,
        p => p.sets.MagicNumber++, p => p.sets.Risk++, p => p.RRActivePlan.checksum++,
        p => p.sets.DoNotApplyStopLoss = true, p => p.sets.DoNotApplyTakeProfit = true];
    for (const edit of edits) {
        reset(); setOption(true); queue(); edit(panel); settled(); panel.RCManageReverse();
        assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, false);
    }
});
check('market quote and derived position output changes do not invalidate frozen intent', () => {
    setOption(true); queue(); panel.sets.EntryLevel = 105; panel.sets.PositionSize = 0.8;
    settled(); panel.RCManageReverse(); assert.equal(env.entries.length, 1);
});
check('fixed-lot mode does invalidate queue when chosen lot size changes', () => {
    panel.sets.RiskFromPositionSize = true; setOption(true); queue(); panel.sets.PositionSize = 0.8;
    settled(); panel.RCManageReverse(); assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, false);
});
check('account, server or working symbol change cancels queued opening', () => {
    for (const edit of [() => env.account++, () => env.server = 'Other', () => panel.SymbolForTrading = 'OTHER']) {
        reset(); setOption(true); queue(); edit(); panel.RCManageReverse();
        assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, false); assert.equal(env.handles.size, 0);
    }
});
check('opposite order arriving while waiting cancels continuation', () => {
    setOption(true); queue(); env.orders = [order()]; panel.RCManageReverse();
    assert.equal(panel.RCReversePending, false); assert.equal(env.entries.length, 0); assert.equal(env.jobs.has(42), true);
});
check('new opposite position appearing after captured positions finish cancels opening', () => {
    setOption(true); queue(); settled(); env.positions = [position({ id: 43, ticket: 457 })]; panel.RCManageReverse();
    assert.equal(panel.RCReversePending, false); assert.equal(env.entries.length, 0);
});
check('manual cancellation leaves durable closes running and releases entry lock', () => {
    setOption(true); queue(); panel.RCCancelReverse(); settled(); panel.RCManageReverse();
    assert.equal(env.jobs.has(42), true); assert.equal(env.tradeCalls.length, 0); assert.equal(env.handles.size, 0);
});
check('turning the option off cancels local continuation and other panels observe it', () => {
    setOption(true); queue(); const other = makePanel(); assert.equal(setOption(false, other).ok, true);
    panel.RCManageReverse(); assert.equal(panel.RCReversePending, false); assert.equal(env.entries.length, 0);
    assert.equal(env.jobs.get(42).pending, true);
});
check('restart reloads the option and durable closes but never resurrects queued opening', () => {
    setOption(true); queue(); panel.RCCancelReverse(); const restarted = makePanel();
    assert.equal(restarted.RCLoadOption(), true); settled(); restarted.RCManageReverse();
    assert.equal(restarted.RCCloseOpposite, true); assert.equal(restarted.RCReversePending, false); assert.equal(env.tradeCalls.length, 0);
});
check('same-symbol panels share entry lock while unrelated symbol can enter', () => {
    setOption(true); queue(); const other = makePanel(); assert.equal(other.RCTradeEnter(), false);
    other.SymbolForTrading = 'OTHER'; assert.equal(other.RCTradeEnter(), true); other.RCTradeLeave();
    panel.RCCancelReverse(); other.SymbolForTrading = 'TEST'; assert.equal(other.RCTradeEnter(), true); other.RCTradeLeave();
    assert.equal(env.handles.size, 0);
});
check('repeated trade clicks on pending panel do not release its original entry lock', () => {
    setOption(true); queue(); const lock = panel.RCEntryLock;
    assert.equal(panel.RCTradeEnter(), false); assert.equal(panel.RCEntryLock, lock); assert.equal(env.handles.size, 1);
});
check('last entry barrier rejects late opposite exposure before broker submission', () => {
    setOption(true); env.positions = []; assert.equal(panel.RCEntryClear(), true);
    env.positions = [position()]; assert.equal(panel.RCEntryClear(), false);
    env.positions = []; env.orders = [order()]; assert.equal(panel.RCEntryClear(), false);
});
check('fixed-point SL follows quotes without canceling but changing its distance cancels', () => {
    panel.sets.SLDistanceInPoints = true; setOption(true); queue();
    panel.sets.EntryLevel += 2; panel.sets.StopLossLevel += 2; settled(); panel.RCManageReverse();
    assert.equal(env.entries.length, 1);
    reset(); panel.sets.SLDistanceInPoints = true; setOption(true); queue(); panel.sets.StopLoss++;
    settled(); panel.RCManageReverse(); assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, false);
});
check('active ATR stop follows calculated price and points without false cancellation', () => {
    panel.ShowATROptions = true; panel.sets.ATRMultiplierSL = 2; panel.sets.SLDistanceInPoints = true;
    setOption(true); queue(); panel.sets.StopLossLevel += 3; panel.sets.StopLoss += 30;
    settled(); panel.RCManageReverse(); assert.equal(env.entries.length, 1);
});
check('ATR mode parameters and spread adjustment changes cancel queued opening', () => {
    for (const edit of [p => p.sets.ATRMultiplierSL++, p => p.sets.ATRPeriod++,
        p => p.sets.ATRTimeframe++, p => p.sets.SpreadAdjustmentSL = true]) {
        reset(); panel.ShowATROptions = true; panel.sets.ATRMultiplierSL = 2; setOption(true); queue();
        edit(panel); settled(); panel.RCManageReverse(); assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, false);
    }
});
check('disabled ATR with a remembered multiplier still tracks the actual fixed SL', () => {
    panel.ShowATROptions = false; panel.sets.ATRMultiplierSL = 2; setOption(true); queue();
    panel.sets.StopLossLevel++; settled(); panel.RCManageReverse();
    assert.equal(env.entries.length, 0); assert.equal(panel.RCReversePending, false);
});
check('final send budget accepts reduced volume but never increases the confirmed total', () => {
    panel.RCResuming = true; panel.RCQueuedVolume = 0.5;
    assert.equal(panel.RCReserveEntryVolume(0.3), true); assert.ok(Math.abs(panel.RCQueuedVolume - 0.2) < 1e-12);
    assert.equal(panel.RCReserveEntryVolume(0.21), false);
    assert.equal(panel.RCReserveEntryVolume(0.2), true); assert.equal(panel.RCQueuedVolume, 0);
    assert.equal(panel.RCReserveEntryVolume(0.01), false);
});
check('invalid volume or broker step never consumes queued budget', () => {
    panel.RCResuming = true; panel.RCQueuedVolume = 0.5;
    for (const value of [NaN, Infinity, 0, -0.1, 0.51]) {
        assert.equal(panel.RCReserveEntryVolume(value), false); assert.equal(panel.RCQueuedVolume, 0.5);
    }
    for (const step of [NaN, Infinity, 0, -1]) {
        env.step = step; assert.equal(panel.RCReserveEntryVolume(0.5), false); assert.equal(panel.RCQueuedVolume, 0.5);
    }
});
check('unrelated ordinary entry does not use a previous reverse budget', () => {
    panel.RCResuming = false; panel.RCQueuedVolume = 0;
    assert.equal(panel.RCReserveEntryVolume(1), true); assert.equal(panel.RCQueuedVolume, 0);
});
check('both actual native send gates spend budget last and cannot resend an uncertain full submission', () => {
    const gates = trading.split('\n').filter(line => line.includes('if ((!RGCanOpen') && line.includes('RCReserveEntryVolume'));
    assert.equal(gates.length, 2, 'market and pending order sends have distinct gates');
    for (const line of gates) {
        reset(); env.positions = []; panel.RCResuming = true; panel.RCQueuedVolume = 0.5; panel.RCCloseOpposite = true;
        const condition = line.slice(line.indexOf('('), line.lastIndexOf(')') + 1);
        vm.runInContext(`function runNativeGate(sub_position_size) { return !${condition}; }`, panel);
        env.guardAllowed = false; assert.equal(panel.runNativeGate(0.5), false); assert.equal(panel.RCQueuedVolume, 0.5);
        env.guardAllowed = true; env.slotAvailable = false;
        assert.equal(panel.runNativeGate(0.5), false); assert.equal(panel.RCQueuedVolume, 0.5);
        env.slotAvailable = true; assert.equal(panel.runNativeGate(0.5), true); assert.equal(panel.RCQueuedVolume, 0);
        assert.equal(panel.runNativeGate(0.5), false, 'a timeout after sending does not restore the consumed budget');
    }
});
check('resuming does not requeue closes and refuses a newly arrived opposite position', () => {
    setOption(true); panel.RCResuming = true; env.positions = [];
    assert.equal(panel.RCQueueReverse(0.5), false); assert.equal(env.requests.length, 0);
    env.positions = [position()]; assert.equal(panel.RCQueueReverse(0.5), true); assert.equal(env.requests.length, 0);
});
check('production Trade wrapper retains queue lock until completion then releases it after the second preflight', () => {
    vm.runInContext(extract('Trade', trading), panel);
    let preflights = 0, nativeSubmits = 0;
    panel.RCTradeCore = () => {
        preflights++;
        if (panel.RCQueueReverse(0.5)) return;
        if (panel.RCEntryClear() && panel.RCReserveEntryVolume(0.5)) nativeSubmits++;
    };
    setOption(true); panel.Trade(); assert.equal(preflights, 1); assert.equal(nativeSubmits, 0); assert.equal(env.handles.size, 1);
    settled(); panel.RCManageReverse(); panel.RCManageReverse();
    assert.equal(preflights, 2); assert.equal(nativeSubmits, 1); assert.equal(env.requests.length, 1); assert.equal(env.handles.size, 0);
});
check('production wrapper releases entry lock on immediate preflight rejection', () => {
    vm.runInContext(extract('Trade', trading), panel); panel.RCTradeCore = () => {};
    panel.Trade(); assert.equal(env.handles.size, 0); assert.equal(panel.RCEntryLock, -1);
});
check('actual trade-count fuse defers existing opposite exposure only during closing preparation', () => {
    const outer = /if \((ShowMaxParametersOnTrading[^\n]+)\)/.exec(trading)[1];
    const first = trading.indexOf('if ((sets.MaxNumberOfTradesTotal > 0)');
    const start = trading.indexOf('{', first); let end = start + 1, depth = 1;
    for (; depth; end++) { if (trading[end] === '{') depth++; if (trading[end] === '}') depth--; }
    const block = trading.slice(first, end)
        .replace(/\bint\s+/g, 'let ').replace(/\((?:int|uint|long)\)/g, '')
        .replace(/\bTRANSLATION_\w+/g, '"fixture"');
    vm.runInContext(`function runCountFuse() { const closing_opposite_first = RCPreparingReverse(); if (${outer}) {${block}} return true; }`, panel);
    panel.RCCloseOpposite = true; panel.sets.MaxNumberOfTradesPerSymbol = 1; env.positions[0].magic = 123;
    assert.equal(panel.runCountFuse(), true, 'the old opposite trade does not block its own liquidation');
    panel.RCResuming = true; assert.equal(panel.runCountFuse(), undefined, 'the limit is active again during resumed preflight');
    env.positions = []; assert.equal(panel.runCountFuse(), true);
});
check('both preclose volume checks defer portfolio limits but resume them before entry', () => {
    const checks = trading.split('\n').filter(line => line.includes('double new_ps = closing_opposite_first ?'));
    assert.equal(checks.length, 2);
    for (const line of checks) {
        let calls = 0; panel.MaxVolumeCheck = volume => { calls++; return volume / 2; };
        vm.runInContext(`function runVolumeCheck(PositionSize, closing_opposite_first) {${line.replace('double ', 'let ')} return new_ps;}`, panel);
        assert.equal(panel.runVolumeCheck(1, true), 1); assert.equal(calls, 0);
        assert.equal(panel.runVolumeCheck(1, false), 0.5); assert.equal(calls, 1);
    }
});
check('both trade branches stop when opposite positions vanish after exposure checks were deferred', () => {
    const lines = trading.split('\n');
    const indexes = lines.flatMap((line, i) => line.includes('if (RCQueueReverse(PositionSize))') ? [i] : []);
    assert.equal(indexes.length, 2); env.positions = []; panel.RCCloseOpposite = true;
    for (const index of indexes) {
        const branch = lines.slice(index, index + 2).join('\n').replaceAll('delete Trade;', '');
        vm.runInContext(`function runQueueBoundary(PositionSize, closing_opposite_first) { ${branch} return 'send'; }`, panel);
        assert.equal(panel.runQueueBoundary(0.5, true), undefined);
        assert.equal(panel.runQueueBoundary(0.5, false), 'send');
    }
});
check('positions disappearing during registration precheck cannot create an empty reverse queue', () => {
    setOption(true); env.onGuardCheck = () => { env.positions = []; };
    assert.equal(queue(), true); assert.equal(env.requests.length, 0);
    assert.equal(panel.RCReversePending, false); assert.equal(env.handles.size, 0);
    panel.RCManageReverse(); assert.equal(env.entries.length, 0);
});
check('captured opposite identifier reversing before registration cancels instead of closing same-direction exposure', () => {
    setOption(true); env.onManualSelect = id => { env.positions.find(p => p.id === id).direction = 1; };
    assert.equal(queue(), true); assert.equal(env.requests.length, 0);
    assert.equal(panel.RCReversePending, false); assert.equal(env.handles.size, 0);
});
check('fresh entry reloads account default plan saved by another panel', () => {
    env.sharedPlan = { checksum: 99 }; assert.equal(panel.RCTradeEnter(), true);
    assert.equal(panel.RRActivePlan.checksum, 99); assert.equal(env.planReads, 1); panel.RCTradeLeave();
});
check('unreadable shared RR plan blocks fresh entry without changing the active plan', () => {
    env.planReadable = false; assert.equal(panel.RCTradeEnter(), false);
    assert.equal(panel.RRActivePlan.checksum, 17); assert.equal(env.handles.size, 0); assert.equal(env.requests.length, 0);
});
check('resuming reverse entry keeps its confirmed plan rather than adopting newer defaults', () => {
    setOption(true); queue(); const reads = env.planReads;
    env.sharedPlan = { checksum: 99 }; env.planReadable = false;
    settled(); panel.RCManageReverse();
    assert.equal(env.entries.length, 1); assert.equal(env.planReads, reads); assert.equal(panel.RRActivePlan.checksum, 17);
});
check('RR-disabled entry does not require or load a shared RR plan', () => {
    panel.RR_Enable = false; env.planReadable = false;
    assert.equal(panel.RCTradeEnter(), true); assert.equal(env.planReads, 0); panel.RCTradeLeave();
});
console.log(`\n${passed} central-controller tests passed against production function bodies.`);
console.log('Scope: in-memory options, reverse queue, positions and entry calls; no terminal files or trades.');
