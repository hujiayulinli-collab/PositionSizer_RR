// Actual guard function bodies against in-memory MT5 files, orders and positions.
// This runner never reads terminal journals or sends actual trading requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRGuardExecution.mqh', import.meta.url), 'utf8');
const ordinary = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const fields = [.../struct RGExecutionState\s*\{([\s\S]*?)\};/.exec(source)[1]
    .matchAll(/\b(uint|int|ulong|long|double)\s+(\w+)\s*;/g)].map(([, type, name]) => ({ type, name }));
const widths = { uint: 4, int: 4, ulong: 8, long: 8, double: 8 };
const recordSize = fields.reduce((sum, field) => sum + widths[field.type], 0);
const clone = value => structuredClone(value);
const zeroState = () => Object.fromEntries(fields.map(field => [field.name, 0]));

function extract(name, text = source) {
    const match = new RegExp(`(?:bool|void|string|uint)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(text);
    assert.ok(match, `Missing actual function ${name}`);
    const args = match[1].split(',').map(arg => arg.trim().match(/(\w+)\s*$/)[1]);
    let depth = 1, start = match.index + match[0].length, end = start;
    for (; end < text.length && depth; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
    }
    let body = text.slice(start, end - 1)
        .replace(/\b(?:RGExecutionState|RRState|MqlTick)\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bMqlTrade(?:Request|Result|CheckResult)\s+(\w+)\s*=\s*\{\}/g, 'let $1 = {}')
        .replace(/\b(?:const\s+)?(?:int|long|uint|ulong|double|bool|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:int|long|uint|ulong|double)\)/g, '')
        .replaceAll('sizeof(RGExecutionState)', String(recordSize))
        .replace(/\bstatus\s*=/g, 'status.value =')
        .replace(/\bfirst_trigger\s*=/g, 'first_trigger.value =')
        .replaceAll('if (first_trigger)', 'if (first_trigger.value)')
        .replace(/let resolved_order\s*;/g, 'let resolved_order = { value: 0 };');
    if (name === 'RGOpenExecution') body = body.replace(/\bhandle\b/g, 'handle.value');
    if (name === 'RGCloseConfirmed') body = body.replace(/\bresolved_order\b/g, 'resolved_order.value');
    if (name === 'RGExitPosition' || name === 'RGCancelOrder') {
        body = body.replace(/\bhandle\b/g, 'handle.value')
            .replace('let handle.value = INVALID_HANDLE;', 'let handle = { value: INVALID_HANDLE };')
            .replace('manager_magic, handle.value, s, first_trigger, status)', 'manager_magic, handle, s, first_trigger, status)')
            .replace('magic, handle.value, s, first_trigger, status)', 'magic, handle, s, first_trigger, status)');
    }
    if (name === 'RRHash')
        body = body.replace('hash = (hash ^ StringGetCharacter(value, i)) * 16777619;',
            'hash = Math.imul(hash ^ StringGetCharacter(value, i), 16777619) >>> 0;');
    return `function ${name}(${args.join(',')}) {${body}\n}`;
}

let env;
const names = ['ACCOUNT_SERVER', 'ACCOUNT_LOGIN', 'POSITION_IDENTIFIER', 'POSITION_TYPE', 'POSITION_TYPE_BUY',
    'POSITION_SYMBOL', 'POSITION_VOLUME', 'POSITION_TIME_UPDATE_MSC', 'SYMBOL_VOLUME_STEP', 'SYMBOL_VOLUME_MIN',
    'SYMBOL_VOLUME_MAX', 'SYMBOL_FILLING_MODE', 'SYMBOL_TRADE_EXEMODE', 'SYMBOL_TRADE_EXECUTION_INSTANT',
    'SYMBOL_TRADE_EXECUTION_REQUEST', 'ORDER_FILLING_FOK', 'ORDER_FILLING_IOC', 'TRADE_ACTION_DEAL', 'TRADE_ACTION_REMOVE',
    'ORDER_TYPE_BUY', 'ORDER_TYPE_SELL', 'ORDER_TYPE_BUY_LIMIT', 'ORDER_TYPE_SELL_LIMIT', 'ORDER_TYPE_BUY_STOP',
    'ORDER_TYPE_SELL_STOP', 'ORDER_TYPE_BUY_STOP_LIMIT', 'ORDER_TYPE_SELL_STOP_LIMIT', 'ORDER_STATE_FILLED',
    'ORDER_STATE_CANCELED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED', 'ORDER_COMMENT', 'ORDER_MAGIC',
    'ORDER_POSITION_ID', 'ORDER_STATE', 'ORDER_TIME_DONE_MSC', 'ORDER_VOLUME_INITIAL', 'ORDER_VOLUME_CURRENT',
    'ORDER_SYMBOL', 'ORDER_TYPE', 'DEAL_ORDER'];
const rejects = [...new Set(ordinary.match(/TRADE_RETCODE_[A-Z_]+/g))];
const format = (template, ...args) => {
    let index = 0;
    return template.replace(/%I64[udX]|%[uds]|%\.\d+f/g, spec => {
        const value = args[index++];
        if (spec === '%I64X') return BigInt(value).toString(16).toUpperCase();
        if (spec.endsWith('f')) return Number(value).toFixed(Number(spec.slice(2, -1)));
        return String(value);
    });
};
function historyOrder(ticket) { return env.orders.find(order => order.ticket === ticket && !order.active); }
const context = vm.createContext({
    ...Object.fromEntries([...names, ...rejects].map(name => [name, name])),
    FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, SEEK_END: 2, SEEK_SET: 0, INVALID_HANDLE: -1,
    SYMBOL_FILLING_FOK: 1, SYMBOL_FILLING_IOC: 2, RR_DeviationPoints: 20,
    MathIsValidNumber: Number.isFinite, MathMax: Math.max, MathMin: Math.min, MathFloor: Math.floor, MathAbs: Math.abs,
    NormalizeDouble: (v, d) => Number(v.toFixed(d)), DoubleToString: (v, d) => v.toFixed(d), IntegerToString: String,
    StringFormat: format, StringLen: value => value.length, StringGetCharacter: (value, index) => value.charCodeAt(index),
    AccountInfoString: () => env.server, AccountInfoInteger: () => env.login, TimeLocal: () => env.now,
    ZeroMemory: object => Object.assign(object, zeroState()),
    FileIsExist: path => Object.hasOwn(env.files, path),
    FileOpen: (path, flags) => {
        env.events.push(['open', path, flags]);
        if (env.locks.has(path) || env.failOpen === path) return -1;
        if (!env.files[path]) {
            if (!(flags & 2)) return -1;
            env.files[path] = { records: [], bytes: 0 };
        }
        const handle = ++env.nextHandle;
        env.handles.set(handle, { path, flags, cursor: 0 }); env.locks.add(path);
        return handle;
    },
    FileClose: handle => {
        assert.ok(env.handles.has(handle), 'close only a held handle');
        env.locks.delete(env.handles.get(handle).path); env.handles.delete(handle);
    },
    FileSize: handle => env.files[env.handles.get(handle).path].bytes,
    FileSeek: (handle, offset, origin) => {
        if (env.seekFails) return false;
        const info = env.handles.get(handle); info.cursor = (origin === 2 ? env.files[info.path].bytes : 0) + offset;
        return true;
    },
    FileWriteStruct: (handle, value) => {
        const info = env.handles.get(handle), file = env.files[info.path];
        assert.ok(info.flags & 2, 'ordinary RR handles must never be written');
        assert.ok(!info.path.startsWith('rr:'), 'never write ordinary RR journals');
        env.writeAttempts++;
        const length = env.failWriteAt === env.writeAttempts ? recordSize - 1 : recordSize;
        file.records.push(clone(value)); file.bytes += length; info.cursor += length;
        env.events.push(['save', value.kind, value.sequence, value.pending, value.complete]);
        return length;
    },
    FileReadStruct: (handle, value) => {
        const info = env.handles.get(handle), file = env.files[info.path];
        if (info.cursor + recordSize > file.bytes) return 0;
        Object.assign(value, clone(file.records[Math.floor(info.cursor / recordSize)]));
        return recordSize;
    },
    FileFlush: () => { if (env.flushFails) env.lastError = 5; },
    ResetLastError: () => { env.lastError = 0; }, GetLastError: () => env.lastError,
    RRFileName: id => `rr:${id}`,
    RRLoad: (handle, value, id) => {
        const file = env.files[env.handles.get(handle).path];
        Object.assign(value, clone(file.rr ?? {}));
        return Boolean(file.rr && file.valid !== false && file.rr.identifier === id);
    },
    RRRequestComment: state => `RR${BigInt(state.identifier).toString(16).toUpperCase()}-${state.sequence}`,
    RMGuardExitReady: () => !env.manualPending,
    RRCanTrade: () => env.canTrade,
    PositionsTotal: () => env.positions.length,
    PositionGetTicket: index => { env.selectedPosition = env.positions[index]; return env.selectedPosition?.ticket ?? 0; },
    PositionSelectByTicket: ticket => {
        env.selectCalls++;
        if (env.onSelect) env.onSelect(env.selectCalls);
        env.selectedPosition = env.positions.find(position => position.ticket === ticket);
        return Boolean(env.selectedPosition);
    },
    PositionGetInteger: key => ({ POSITION_IDENTIFIER: env.selectedPosition?.id,
        POSITION_TYPE: env.selectedPosition?.direction === 1 ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL',
        POSITION_TIME_UPDATE_MSC: env.selectedPosition?.updated ?? 0 })[key],
    PositionGetString: () => env.selectedPosition?.symbol,
    PositionGetDouble: () => env.selectedPosition?.volume,
    SymbolInfoDouble: (_symbol, key) => ({ SYMBOL_VOLUME_STEP: env.step, SYMBOL_VOLUME_MIN: env.minimum,
        SYMBOL_VOLUME_MAX: env.maximum })[key],
    SymbolInfoInteger: (_symbol, key) => key === 'SYMBOL_FILLING_MODE' ? env.fill : env.execution,
    SymbolInfoTick: (_symbol, tick) => { Object.assign(tick, { bid: env.bid, ask: env.ask }); return env.hasQuote; },
    HistorySelectByPosition: id => { env.historyId = id; return env.hasHistory; },
    HistoryOrdersTotal: () => env.orders.filter(o => !o.active && o.positionId === env.historyId).length,
    HistoryOrderGetTicket: index => env.orders.filter(o => !o.active && o.positionId === env.historyId)[index]?.ticket ?? 0,
    HistoryOrderSelect: ticket => Boolean(historyOrder(ticket)),
    HistoryOrderGetString: ticket => historyOrder(ticket)?.comment ?? '',
    HistoryOrderGetInteger: (ticket, key) => {
        const order = historyOrder(ticket);
        return ({ ORDER_MAGIC: order?.magic, ORDER_POSITION_ID: order?.positionId,
            ORDER_STATE: order?.state, ORDER_TIME_DONE_MSC: order?.done ?? 0 })[key];
    },
    HistoryOrderGetDouble: (ticket, key) => key === 'ORDER_VOLUME_INITIAL' ? historyOrder(ticket)?.initial : historyOrder(ticket)?.remaining,
    HistoryDealSelect: ticket => Object.hasOwn(env.deals, ticket),
    HistoryDealGetInteger: ticket => env.deals[ticket],
    OrderSelect: ticket => { env.selectedOrder = env.orders.find(o => o.ticket === ticket && o.active); return Boolean(env.selectedOrder); },
    OrderGetString: () => env.selectedOrder?.symbol,
    OrderGetInteger: key => key === 'ORDER_TYPE' ? env.selectedOrder?.type : env.selectedOrder?.magic,
    OrderCheck: (request, result) => {
        env.checked.push(clone(request)); Object.assign(result, { retcode: 'CHECK', comment: 'fixture' });
        if (env.onCheck) env.onCheck(); return env.checkPass;
    },
    OrderSend: (request, result) => {
        const kind = request.action === 'TRADE_ACTION_REMOVE' ? 2 : 1;
        const journal = Object.entries(env.files).find(([path, file]) => !path.startsWith('rr:') && file.records?.at(-1)?.kind === kind
            && file.records.at(-1).identifier === (kind === 2 ? request.order : env.selectedPosition?.id));
        assert.ok(journal && journal[1].records.at(-1).pending === 1, 'durable intent must precede send');
        assert.ok(env.locks.has(journal[0]), 'send holds the guard lock');
        if (kind === 1 && env.files[`rr:${env.selectedPosition.id}`])
            assert.ok(env.locks.has(`rr:${env.selectedPosition.id}`), 'send holds the ordinary RR lock');
        env.sent.push(clone(request)); env.events.push(['send', request.action]);
        Object.assign(result, { retcode: env.retcode, order: env.resultOrder, deal: env.resultDeal, comment: 'fixture' });
        if (env.onSend) env.onSend(); return env.sendPass;
    },
    RGOnPositionLatched: ticket => { env.alarms.push(ticket); env.events.push(['alarm', ticket]); },
    PrintFormat: (...args) => env.notices.push(args),
});
for (const name of ['RRHash', 'RRDefiniteReject']) vm.runInContext(extract(name, ordinary), context);
for (const name of ['RGExecutionFile', 'RGPositionExitLatched', 'RGOrderCancelLatched', 'RGPositionIdentifierExists',
    'RGExecutionChecksum', 'RGExecutionSave', 'RGExecutionLoad', 'RGOpenExecution', 'RGExecutionComment',
    'RGTerminalOrderState', 'RGCloseConfirmed', 'RGOrdinaryExitReady', 'RGCompleteExecution', 'RGExitPositionLocked',
    'RGExitPosition', 'RGIsPendingOrderType', 'RGCancelOrderLocked', 'RGCancelOrder'])
    vm.runInContext(extract(name), context, { filename: `production:${name}` });

function position(overrides = {}) { return { ticket: 456, id: 42, direction: 1, symbol: 'TEST', volume: 1, updated: 0, ...overrides }; }
function order(overrides = {}) {
    return { ticket: 200, positionId: 42, symbol: 'TEST', magic: 123, comment: 'RG2A-1', state: 'ORDER_STATE_FILLED',
        initial: 1, remaining: 0, active: false, type: 'ORDER_TYPE_SELL', done: 0, ...overrides };
}
function reset(overrides = {}) {
    env = { server: 'Test-Server', login: 1001, now: 100, positions: [position()], orders: [], deals: {},
        files: {}, handles: new Map(), locks: new Set(), nextHandle: 0, events: [], writeAttempts: 0,
        failWriteAt: 0, flushFails: false, seekFails: false, lastError: 0, canTrade: true, step: 0.01, minimum: 0.01,
        maximum: 100, fill: 1, execution: 'MARKET', bid: 100, ask: 100.1, hasQuote: true, hasHistory: true,
        checked: [], sent: [], alarms: [], notices: [], selectCalls: 0, checkPass: true, sendPass: true,
        retcode: 'TRADE_RETCODE_DONE', resultOrder: 200, resultDeal: 0, ...overrides };
}
function exit(ticket = 456, key = 'single-loss') {
    const status = { value: '' }, first = { value: false };
    const complete = context.RGExitPosition(ticket, key, 123, status, first);
    assert.equal(env.handles.size, 0, 'all handles must close');
    assert.ok(status.value.length > 0); return { complete, first: first.value, status: status.value };
}
function cancel(ticket = 300, key = 'daily-loss') {
    const status = { value: '' }, first = { value: false };
    const complete = context.RGCancelOrder(ticket, key, status, first);
    assert.equal(env.handles.size, 0); assert.ok(status.value.length > 0);
    return { complete, first: first.value, status: status.value };
}
function saved(kind = 1, id = 42) { return env.files[context.RGExecutionFile(kind, id)]?.records.at(-1); }
function addOrdinary(overrides = {}) {
    env.files['rr:42'] = { bytes: 552, valid: true, rr: { identifier: 42, magic: 123, sequence: 1,
        pending: 0, pending_order: 0, before_volume: 1, ...overrides } };
}
const pendingOrder = overrides => order({ ticket: 300, active: true, type: 'ORDER_TYPE_BUY_LIMIT', comment: 'original', ...overrides });
let passed = 0;
function check(name, callback) {
    try { reset(); callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}

check('new latch saves and alarms before preflight/send with exact hedging ticket', () => {
    const result = exit(); assert.equal(result.first, true); assert.equal(result.complete, false);
    assert.equal(env.sent[0].position, 456); assert.equal(env.sent[0].type, 'ORDER_TYPE_SELL');
    assert.equal(env.sent[0].volume, 1); assert.equal(env.sent[0].comment, 'RG2A-1');
    assert.ok(env.events.findIndex(e => e[0] === 'save') < env.events.findIndex(e => e[0] === 'alarm'));
    assert.ok(env.events.findIndex(e => e[0] === 'alarm') < env.events.findIndex(e => e[0] === 'send'));
});
check('disabled trading still latches once and resumes after permission restores', () => {
    env.canTrade = false; assert.equal(exit().first, true); assert.equal(env.sent.length, 0);
    assert.equal(context.RGPositionExitLatched(42), true);
    assert.equal(exit().first, false); assert.equal(env.alarms.length, 1);
    env.canTrade = true; exit(456, ''); assert.equal(env.sent.length, 1);
});
check('empty key cannot adopt a fresh position', () => {
    assert.equal(exit(456, '').complete, false); assert.equal(env.writeAttempts, 0); assert.equal(env.sent.length, 0);
});
check('latch remains active after trigger recovers or key changes', () => {
    exit(); const count = env.writeAttempts; env.now = 10000;
    const result = exit(456, 'new-trigger'); assert.equal(result.first, false);
    assert.equal(env.sent.length, 1); assert.equal(env.writeAttempts, count);
});
check('restarted unknown result cannot resend or replay first alert', () => {
    env.retcode = 'TRADE_RETCODE_TIMEOUT'; env.resultOrder = 0; env.sendPass = false; exit();
    const files = clone(env.files); reset({ files, now: 10000, resultOrder: 201 });
    assert.equal(exit(456, '').first, false); assert.equal(env.sent.length, 0); assert.equal(saved().pending, 1);
});
check('unknown result recovers from exact comment and magic then closes partial remainder', () => {
    env.resultOrder = 0; env.retcode = 'TRADE_RETCODE_TIMEOUT'; exit();
    env.orders = [order({ initial: 1, remaining: 0.4 })]; env.positions[0].volume = 0.4; env.now = 104;
    env.resultOrder = 201; env.retcode = 'TRADE_RETCODE_DONE'; exit(456, '');
    assert.equal(env.sent.length, 2); assert.equal(env.sent[1].volume, 0.4); assert.equal(env.sent[1].comment, 'RG2A-2');
});
check('different magic cannot resolve an ambiguous request', () => {
    env.resultOrder = 0; exit(); env.orders = [order({ magic: 999 })]; env.positions[0].volume = 0.5; env.now = 104;
    exit(456, ''); assert.equal(env.sent.length, 1);
});
check('active partially filled close blocks retries even with a smaller position', () => {
    exit(); env.orders = [order({ active: true, remaining: 0.5 })]; env.positions[0].volume = 0.5; env.now = 1000;
    exit(); assert.equal(env.sent.length, 1);
});
check('terminal fill waits for position volume reflection before another close', () => {
    exit(); env.orders = [order({ remaining: 0.4 })]; env.now = 104; exit(); assert.equal(env.sent.length, 1);
    env.positions[0].volume = 0.4; exit(); assert.equal(env.sent[1].volume, 0.4);
});
check('definite rejection retries only after throttle and advances unique sequence', () => {
    env.retcode = 'TRADE_RETCODE_REJECT'; exit(); assert.equal(saved().pending, 0);
    env.now = 101; exit(); assert.equal(env.sent.length, 1);
    env.now = 104; exit(); assert.equal(env.sent[1].comment, 'RG2A-2');
});
check('unknown connection/error results retain pending rather than whitelist guesses', () => {
    for (const code of ['TRADE_RETCODE_CONNECTION', 'TRADE_RETCODE_ERROR', 'UNKNOWN']) {
        reset({ retcode: code, resultOrder: 0, sendPass: false }); exit(); env.now = 10000; exit();
        assert.equal(env.sent.length, 1); assert.equal(saved().pending, 1);
    }
});
check('partial chunks respect max lot and continue only after confirmation', () => {
    env.maximum = 0.6; exit(); assert.equal(env.sent[0].volume, 0.6);
    env.orders = [order({ initial: 0.6 })]; env.positions[0].volume = 0.4; env.now = 104; exit();
    assert.equal(env.sent[1].volume, 0.4);
});
check('max-volume chunk never strands a sub-minimum remainder', () => {
    env.maximum = 0.95; env.minimum = 0.1; exit(); assert.equal(env.sent[0].volume, 0.9);
});
check('sell position buys exact ticket at Ask using permitted IOC', () => {
    env.positions[0].direction = -1; env.fill = 2; exit();
    assert.equal(env.sent[0].type, 'ORDER_TYPE_BUY'); assert.equal(env.sent[0].price, 100.1);
    assert.equal(env.sent[0].type_filling, 'ORDER_FILLING_IOC');
});
check('no quote, unsupported fill, and failed preflight preserve latch without sending', () => {
    for (const changes of [{ hasQuote: false }, { fill: 0 }, { checkPass: false }]) {
        reset(changes); assert.equal(exit().first, true); assert.equal(env.sent.length, 0);
        assert.equal(context.RGPositionExitLatched(42), true);
    }
});
check('preflight volume change prevents oversized netting close', () => {
    env.onCheck = () => { env.positions[0].volume = 0.3; }; exit();
    assert.equal(env.sent.length, 0); assert.equal(saved().pending, 0);
});
check('preflight direction change prevents an order in the old direction', () => {
    env.onCheck = () => { env.positions[0].direction = -1; }; exit(); assert.equal(env.sent.length, 0);
});
check('ticket change with same identifier does not mark latch complete', () => {
    env.onCheck = () => { env.positions[0].ticket = 457; }; exit();
    assert.equal(saved().complete, 0); assert.equal(env.sent.length, 0);
    env.onCheck = undefined; exit(457, ''); assert.equal(env.sent[0].position, 457);
});
check('ticket change between outer lookup and locked handler is not completion', () => {
    env.onSelect = call => { if (call === 2) env.positions[0].ticket = 457; }; exit();
    assert.equal(saved().complete, 0); assert.equal(env.sent.length, 0);
});
check('actual disappearance during preflight completes without affecting new identifier', () => {
    env.onCheck = () => { env.positions = [position({ ticket: 900, id: 99 })]; }; exit();
    assert.equal(saved().complete, 1); assert.equal(env.sent.length, 0);
    env.onCheck = undefined; assert.equal(exit(900, '').complete, false); assert.equal(env.sent.length, 0);
});
check('settled external reversal rebinds direction before flattening', () => {
    env.canTrade = false; exit(); env.positions[0].direction = -1; env.canTrade = true; exit(456, '');
    assert.equal(env.sent[0].type, 'ORDER_TYPE_BUY'); assert.equal(saved().direction, -1);
});
check('external reversal cannot bypass an unresolved emergency request', () => {
    env.resultOrder = 0; exit(); env.positions[0].direction = -1; env.now = 104; exit();
    assert.equal(env.sent.length, 1); assert.equal(saved().direction, 1);
});
check('later live-position update resolves terminal close despite external addition/reversal', () => {
    exit(); env.orders = [order({ remaining: 0.4, done: 103000 })];
    env.positions[0] = position({ volume: 1.2, direction: -1, updated: 104000 }); env.now = 104; exit();
    assert.equal(env.sent.length, 2); assert.equal(env.sent[1].type, 'ORDER_TYPE_BUY'); assert.equal(env.sent[1].volume, 1.2);
});
check('equal or older position timestamp cannot prove an unreflected close completed', () => {
    for (const updated of [102999, 103000]) {
        reset(); exit(); env.orders = [order({ remaining: 0.4, done: 103000 })];
        env.positions[0].updated = updated; env.now = 104; exit();
        assert.equal(env.sent.length, 1); assert.equal(saved().pending, 1);
    }
});
check('ordinary RR busy lock delays guard send but not initial latch alarm', () => {
    addOrdinary(); env.locks.add('rr:42'); assert.equal(exit().first, true);
    assert.equal(env.sent.length, 0); assert.equal(env.alarms.length, 1);
});
check('unconfirmed ordinary RR pending prevents concurrent emergency close', () => {
    addOrdinary({ pending: 1, pending_order: 200 }); exit(); assert.equal(env.sent.length, 0);
});
check('confirmed ordinary RR partial allows emergency remainder while journal stays untouched', () => {
    addOrdinary({ pending: 1, pending_order: 200 }); const before = clone(env.files['rr:42']);
    env.orders = [order({ comment: 'RR2A-1', remaining: 0.5 })]; env.positions[0].volume = 0.5; exit();
    assert.equal(env.sent[0].volume, 0.5); assert.deepEqual(env.files['rr:42'], before);
});
check('corrupt ordinary RR journal fails closed without rewriting it', () => {
    addOrdinary(); env.files['rr:42'].valid = false; exit(); assert.equal(env.sent.length, 0);
});
check('empty ordinary journal from latch recheck cannot deadlock emergency liquidation', () => {
    env.files['rr:42'] = { bytes: 0, valid: false };
    exit(); assert.equal(env.sent.length, 1); assert.deepEqual(env.files['rr:42'], { bytes: 0, valid: false });
});
check('other instance holding guard lock prevents duplicate latch and send', () => {
    env.locks.add(context.RGExecutionFile(1, 42)); assert.equal(exit().first, false); assert.equal(env.sent.length, 0);
});
check('initial save failure cannot alarm or send and torn latch cannot restart sequence', () => {
    env.failWriteAt = 1; assert.equal(exit().first, false); assert.equal(env.alarms.length, 0); assert.equal(env.sent.length, 0);
    env.failWriteAt = 0; exit(); assert.equal(env.sent.length, 0); assert.equal(context.RGPositionExitLatched(42), true);
});
check('intent save failure prevents send after successful initial latch', () => {
    env.failWriteAt = 2; assert.equal(exit().first, true); assert.equal(env.sent.length, 0);
});
check('reply save failure leaves ambiguity blocked after restart', () => {
    env.failWriteAt = 3; exit(); assert.equal(env.sent.length, 1);
    const files = clone(env.files); reset({ files, now: 1000 }); exit(456, ''); assert.equal(env.sent.length, 0);
});
check('checksummed complete-record corruption is not accepted', () => {
    env.canTrade = false; exit(); saved().sequence = 999; env.canTrade = true; exit(); assert.equal(env.sent.length, 0);
});
check('journal filenames isolate account and server, not trigger labels', () => {
    const original = context.RGExecutionFile(1, 42); env.login = 1002;
    assert.notEqual(context.RGExecutionFile(1, 42), original); env.login = 1001; env.server = 'Other';
    assert.notEqual(context.RGExecutionFile(1, 42), original);
});
check('pending order latch precedes exact-ticket cancellation', () => {
    env.orders = [pendingOrder()]; assert.equal(cancel().first, true);
    assert.equal(env.sent[0].action, 'TRADE_ACTION_REMOVE'); assert.equal(env.sent[0].order, 300);
    assert.equal(context.RGOrderCancelLatched(300), true);
});
check('cancel permission disabled still persists trigger and resumes with empty key', () => {
    env.orders = [pendingOrder()]; env.canTrade = false; cancel(); assert.equal(env.sent.length, 0);
    env.canTrade = true; assert.equal(cancel(300, '').first, false); assert.equal(env.sent.length, 1);
});
check('unknown cancellation never retries merely because timeout elapsed', () => {
    env.orders = [pendingOrder()]; env.retcode = 'TRADE_RETCODE_TIMEOUT'; cancel(); env.now = 10000; cancel();
    assert.equal(env.sent.length, 1);
});
check('definite cancellation rejection can retry after throttle', () => {
    env.orders = [pendingOrder()]; env.retcode = 'TRADE_RETCODE_REJECT'; cancel(); env.now = 104; cancel();
    assert.equal(env.sent.length, 2);
});
check('confirmed cancelled order completes without affecting any replacement ticket', () => {
    env.orders = [pendingOrder()]; cancel(); env.orders[0].active = false; env.orders[0].state = 'ORDER_STATE_CANCELED';
    env.orders.push(pendingOrder({ ticket: 301 })); assert.equal(cancel(300, '').complete, true);
    assert.equal(saved(2, 300).complete, 1); assert.equal(env.sent.length, 1);
});
check('filled instead of cancelled order is terminal and leaves its position for daily scan', () => {
    env.orders = [pendingOrder()]; cancel(); env.orders[0].active = false;
    assert.equal(cancel(300, '').complete, true); assert.equal(env.positions.length, 1);
});
check('missing order without history remains pending rather than guessing completion', () => {
    env.orders = [pendingOrder()]; cancel(); env.orders = []; assert.equal(cancel(300, '').complete, false);
    assert.equal(saved(2, 300).pending, 1); assert.equal(env.sent.length, 1);
});
check('market execution orders are never mistaken for pending entries to cancel', () => {
    env.orders = [pendingOrder({ type: 'ORDER_TYPE_BUY' })]; assert.equal(cancel().complete, true);
    assert.equal(env.sent.length, 0); assert.equal(env.writeAttempts, 0);
});
check('latched cancellation survives restart and lost reply without re-sending', () => {
    env.orders = [pendingOrder()]; cancel(); const files = clone(env.files), orders = clone(env.orders);
    reset({ files, orders, now: 1000 }); assert.equal(cancel(300, '').first, false); assert.equal(env.sent.length, 0);
});

check('risk cannot send while a manual close result is unresolved', () => {
    reset(); env.manualPending = true;
    const status = { value: '' }, first = { value: false };
    context.RGExitPosition(env.positions[0].ticket, 'single', 321, status, first);
    assert.equal(env.sent.length, 0);
});

process.stdout.write(`\n${passed} guard execution tests passed against actual production function bodies.\n`);
process.stdout.write('Scope: simulated MT5 file/order/position boundaries only; no terminal journals, UI operations or real trades.\n');

