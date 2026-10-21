// Actual manual-exit function bodies against in-memory MT5 files, orders and positions.
// This runner never reads terminal journals or sends actual trading requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRManualExecution.mqh', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../mt5/RRGuardExecution.mqh', import.meta.url), 'utf8');
const batch = readFileSync(new URL('../mt5/RRBatchExits.mqh', import.meta.url), 'utf8');
const ordinary = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const fields = [.../struct RMExecutionState\s*\{([\s\S]*?)\};/.exec(source)[1]
    .matchAll(/\b(uint|int|ulong|long|double)\s+(\w+)\s*;/g)].map(([, type, name]) => ({ type, name }));
const widths = { uint: 4, int: 4, ulong: 8, long: 8, double: 8 };
const recordSize = fields.reduce((sum, field) => sum + widths[field.type], 0);
const clone = value => structuredClone(value);
const zeroState = () => Object.fromEntries(fields.map(field => [field.name, 0]));

function extract(name, text = source) {
    const match = new RegExp(`(?:bool|void|string|uint|ulong|double|int)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(text);
    assert.ok(match, `Missing actual function ${name}`);
    const args = match[1].split(',').filter(arg => arg.trim()).map(arg => {
        const parsed = arg.trim().match(/(\w+)(?:\[\])?\s*(?:=\s*(.*))?$/);
        return parsed[1] + (parsed[2] === undefined ? '' : ` = ${parsed[2]}`);
    });
    let depth = 1, start = match.index + match[0].length, end = start;
    for (; end < text.length && depth; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
    }
    let body = text.slice(start, end - 1)
        .replace(/double remaining, server_tp, volumes\[RB_MAX_CHILDREN\];/g,
            'let remaining = 0, server_tp = 0, volumes = Array(64).fill(0);')
        .replace(/\b(?:RMExecutionState|RRState|MqlTick)\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bMqlTrade(?:Request|Result|CheckResult)\s+(\w+)\s*=\s*\{\}/g, 'let $1 = {}')
        .replace(/\b(?:const\s+)?(?:int|long|uint|ulong|double|bool|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:int|long|uint|ulong|double)\)/g, '')
        .replaceAll('sizeof(RMExecutionState)', String(recordSize))
        .replace(/\bstatus\s*=/g, 'status.value =')
        .replace(/\berror\s*=/g, 'error.value =')
        .replace(/\bfirst_trigger\s*=/g, 'first_trigger.value =')
        .replaceAll('if (first_trigger)', 'if (first_trigger.value)')
        .replace(/let resolved_order\s*;/g, 'let resolved_order = { value: 0 };');
    if (name === 'RMProcessLocked') body = body.replace(/HistoryOrderGetDouble\(resolved_order,/g, 'HistoryOrderGetDouble(resolved_order.value,');
    if (name === 'RGOpenExecution') body = body.replace(/\bhandle\b/g, 'handle.value');
    if (name === 'RGCloseConfirmed') body = body.replace(/\bresolved_order\b/g, 'resolved_order.value');
    if (name === 'RGExitPosition' || name === 'RGCancelOrder') {
        body = body.replace(/\bhandle\b/g, 'handle.value')
            .replace('let handle.value = INVALID_HANDLE;', 'let handle = { value: INVALID_HANDLE };')
            .replace('manager_magic, handle.value, s, first_trigger, status)', 'manager_magic, handle, s, first_trigger, status)')
            .replace('magic, handle.value, s, first_trigger, status)', 'magic, handle, s, first_trigger, status)');
    }
    if (name === 'RMTargetRemaining') body = body.replace(/\btarget\s*=/g, 'target.value =');
    if (name === 'RMRegisterLocked') body = body.replace(/\bwrite_attempted\s*=/g, 'write_attempted.value =');
    if (name === 'RMRequestClose') body = body.replace('let write_attempted = false;', 'let write_attempted = { value: false };')
        .replace('!write_attempted &&', '!write_attempted.value &&')
        .replace('cancelled.target_remaining = target;', 'cancelled.target_remaining = target.value;');
    if (name === 'RMRegisterLocked' || name === 'RMRequestClose') {
        body = body.replace('let target = 0;', 'let target = { value: 0 };')
            .replace('s.target_remaining = target;', 's.target_remaining = target.value;')
            .replace('手；等待执行确认。", target)', '手；等待执行确认。", target.value)');
    }
    if (name === 'RMManage' || name === 'RMExitSettled') body = body.replace('let status;', 'let status = { value: "" };');
    if (name === 'RBPickClose') body = body.replace(/\blots\b/g, 'lots.value');
    if (name === 'RBManageGroupLocked') {
        body = body.replace('let error;', 'let error = { value: "" };')
            .replaceAll('RBGroupVolumes(g, remaining, server_tp, volumes, error)',
                'RBGroupVolumes(g, {get value() {return remaining;}, set value(v) {remaining = v;}}, '
                + '{get value() {return server_tp;}, set value(v) {server_tp = v;}}, volumes, error)')
            .replace('RBPickClose(volumes, g.child_count, wanted, minimum, step, lots)',
                'RBPickClose(volumes, g.child_count, wanted, minimum, step, '
                + '{get value() {return lots;}, set value(v) {lots = v;}})');
    }
    if (name === 'RRHash')
        body = body.replace('hash = (hash ^ StringGetCharacter(value, i)) * 16777619;',
            'hash = Math.imul(hash ^ StringGetCharacter(value, i), 16777619) >>> 0;');
    return `function ${name}(${args.join(',')}) {${body}\n}`;
}

let env;
const names = ['ACCOUNT_SERVER', 'ACCOUNT_LOGIN', 'POSITION_IDENTIFIER', 'POSITION_TYPE', 'POSITION_TYPE_BUY',
    'POSITION_SYMBOL', 'POSITION_VOLUME', 'POSITION_TIME_UPDATE_MSC', 'SYMBOL_VOLUME_STEP', 'SYMBOL_VOLUME_MIN',
    'SYMBOL_VOLUME_MAX', 'SYMBOL_TRADE_TICK_SIZE', 'SYMBOL_DIGITS', 'SYMBOL_FILLING_MODE', 'SYMBOL_TRADE_EXEMODE', 'SYMBOL_TRADE_EXECUTION_INSTANT',
    'SYMBOL_TRADE_EXECUTION_REQUEST', 'ORDER_FILLING_FOK', 'ORDER_FILLING_IOC', 'TRADE_ACTION_DEAL', 'TRADE_ACTION_REMOVE',
    'ORDER_TYPE_BUY', 'ORDER_TYPE_SELL', 'ORDER_TYPE_BUY_LIMIT', 'ORDER_TYPE_SELL_LIMIT', 'ORDER_TYPE_BUY_STOP',
    'ORDER_TYPE_SELL_STOP', 'ORDER_TYPE_BUY_STOP_LIMIT', 'ORDER_TYPE_SELL_STOP_LIMIT', 'ORDER_STATE_FILLED',
    'ORDER_STATE_CANCELED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED', 'ORDER_COMMENT', 'ORDER_MAGIC',
    'ORDER_POSITION_ID', 'ORDER_STATE', 'ORDER_TIME_DONE_MSC', 'ORDER_VOLUME_INITIAL', 'ORDER_VOLUME_CURRENT',
    'ORDER_SYMBOL', 'ORDER_TYPE', 'DEAL_ORDER'];
const rejects = [...new Set(ordinary.match(/TRADE_RETCODE_[A-Z_]+/g))];
const format = (template, ...args) => {
    let index = 0;
    return template.replace(/%I64[udX]|%[udsX]|%\.\d+f/g, spec => {
        const value = args[index++];
        if (spec === '%I64X' || spec === '%X') return BigInt(value).toString(16).toUpperCase();
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
    FileDelete: () => { assert.fail('manual execution must never delete a released journal'); },
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
    RRCanTrade: () => env.canTrade,
    PositionsTotal: () => env.positions.length,
    PositionGetTicket: index => {
        env.identifierLookups = (env.identifierLookups ?? 0) + 1;
        if (env.onIdentifierLookup) env.onIdentifierLookup(env.identifierLookups);
        env.selectedPosition = env.positions[index]; return env.selectedPosition?.ticket ?? 0;
    },
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
        SYMBOL_VOLUME_MAX: env.maximum, SYMBOL_TRADE_TICK_SIZE: 0.01 })[key],
    SymbolInfoInteger: (_symbol, key) => key === 'SYMBOL_DIGITS' ? 2 : (key === 'SYMBOL_FILLING_MODE' ? env.fill : env.execution),
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
        const id = env.selectedPosition?.id;
        const path = context.RMExecutionFile(id), journal = env.files[path];
        assert.ok(journal && journal.records.at(-1).pending === 1, 'persist pending before send');
        assert.ok(env.locks.has(path), 'hold manual lock during send');
        if (env.files['rr:' + id]) assert.ok(env.locks.has('rr:' + id), 'hold ordinary lock during send');
        env.sent.push(clone(request)); env.events.push(['send', request.action]);
        Object.assign(result, { retcode: env.retcode, order: env.resultOrder, deal: env.resultDeal, comment: 'fixture' });
        if (env.onSend) env.onSend(); return env.sendPass;
    },
    RGPositionExitLatched: id => env.riskLatches.has(id),
    RGCanOpen: () => env.guardAllowed,
    RGOnPositionLatched: ticket => { env.alarms.push(ticket); env.events.push(['alarm', ticket]); },
    PrintFormat: (...args) => env.notices.push(args),
});
for (const name of ['RRHash', 'RRDefiniteReject']) vm.runInContext(extract(name, ordinary), context);
for (const name of ['RGTerminalOrderState', 'RGCloseConfirmed', 'RGOrdinaryExitReady'])
    vm.runInContext(extract(name, guard), context, { filename: 'guard:' + name });
for (const name of ['RMExecutionFile', 'RMExecutionChecksum', 'RMExecutionSave', 'RMExecutionLoad',
    'RMSelectIdentifier', 'RMPositionExitActive', 'RMExecutionComment', 'RMComplete', 'RMExitSettled', 'RMGuardExitReady',
    'RMTargetRemaining', 'RMRegisterLocked', 'RMRequestClose', 'RMProcessLocked', 'RMManage'])
    vm.runInContext(extract(name), context, { filename: 'production:' + name });

function position(overrides = {}) { return { ticket: 456, id: 42, direction: 1, symbol: 'TEST', volume: 1, updated: 0, ...overrides }; }
function order(overrides = {}) {
    return { ticket: 200, positionId: 42, symbol: 'TEST', magic: 123, comment: 'RM2A-1', state: 'ORDER_STATE_FILLED',
        initial: 1, remaining: 0, active: false, type: 'ORDER_TYPE_SELL', done: 0, ...overrides };
}
function reset(overrides = {}) {
    env = { server: 'Test-Server', login: 1001, now: 100, positions: [position()], orders: [], deals: {},
        files: {}, riskLatches: new Set(), guardAllowed: true, handles: new Map(), locks: new Set(), nextHandle: 0, events: [], writeAttempts: 0,
        failWriteAt: 0, flushFails: false, seekFails: false, lastError: 0, canTrade: true, step: 0.01, minimum: 0.01,
        maximum: 100, fill: 1, execution: 'MARKET', bid: 100, ask: 100.1, hasQuote: true, hasHistory: true,
        checked: [], sent: [], alarms: [], notices: [], selectCalls: 0, checkPass: true, sendPass: true,
        retcode: 'TRADE_RETCODE_DONE', resultOrder: 200, resultDeal: 0, ...overrides };
}
function request(percent = 50, id = 42) {
    const error = { value: '' };
    const accepted = context.RMRequestClose(id, percent, 123, error);
    assert.equal(env.handles.size, 0, 'request releases all handles');
    return { accepted, error: error.value };
}
function manage() { context.RMManage(); assert.equal(env.handles.size, 0, 'manager releases handles'); }
function riskReady(id = 42) {
    context.RMSelectIdentifier(id);
    const status = { value: '' };
    const ready = context.RMGuardExitReady(id, env.selectedPosition?.volume ?? 0, env.step, status);
    assert.equal(env.handles.size, 0); return { ready, status: status.value };
}
function saved(id = 42) { return env.files[context.RMExecutionFile(id)]?.records.at(-1); }
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

check('registration freezes current remaining volume and does not send a manual trade', () => {
    env.positions[0].volume = 0.32;
    assert.equal(request().accepted, true);
    assert.equal(saved().initial_volume, 0.32); assert.equal(saved().target_remaining, 0.16);
    assert.equal(env.sent.length, 0); assert.equal(context.RMPositionExitActive(42), true);
    assert.equal(env.files['rr:42'], undefined);
});
check('first execution binds exact hedging ticket and persists before sending', () => {
    request(); manage(); assert.equal(env.sent.length, 1);
    assert.equal(env.sent[0].position, 456); assert.equal(env.sent[0].volume, 0.5);
    assert.equal(env.sent[0].type, 'ORDER_TYPE_SELL'); assert.equal(env.sent[0].price, 100);
    assert.equal(env.sent[0].comment, 'RM2A-1');
});
check('duplicate active clicks cannot recompute percentage or create another request', () => {
    request(); env.positions[0].volume = 0.8;
    assert.equal(request(100).accepted, false); assert.equal(saved().target_remaining, 0.5);
    manage(); manage(); assert.equal(env.sent.length, 1); assert.equal(env.sent[0].volume, 0.3);
});
check('100 percent closes all remaining volume with a fixed zero target', () => {
    request(100); manage(); assert.equal(saved().target_remaining, 0); assert.equal(env.sent[0].volume, 1);
});
check('percentages floor to broker step and never round up the requested close', () => {
    env.positions[0].volume = 0.33; request(50); manage();
    assert.equal(saved().target_remaining, 0.17); assert.equal(env.sent[0].volume, 0.16);
});
check('partial exits preserve a legal minimum remainder', () => {
    env.minimum = 0.1; request(99); manage();
    assert.equal(saved().target_remaining, 0.1); assert.equal(env.sent[0].volume, 0.9);
});
check('too small partial or invalid percentage creates no file', () => {
    for (const percent of [0, -1, 101, NaN, Infinity, 0.01]) {
        reset(); assert.equal(request(percent).accepted, false); assert.equal(Object.keys(env.files).length, 0);
    }
    reset({ minimum: 0.1 }); env.positions[0].volume = 0.1;
    assert.equal(request(50).accepted, false); assert.equal(Object.keys(env.files).length, 0);
});
check('trade permission can resume a previously persisted manual intent', () => {
    env.canTrade = false; request(); manage(); assert.equal(env.sent.length, 0);
    env.canTrade = true; manage(); assert.equal(env.sent.length, 1);
});
check('money-stop blocking prevents new registration without touching old tasks', () => {
    env.guardAllowed = false; assert.equal(request().accepted, false); assert.equal(Object.keys(env.files).length, 0);
    env.guardAllowed = true; request(); env.guardAllowed = false; manage();
    assert.equal(env.sent.length, 1); // Registration gate does not freeze pending reconciliation.
});
check('existing risk latch prevents registration and preflight risk race prevents send', () => {
    env.riskLatches.add(42); assert.equal(request().accepted, false);
    env.riskLatches.clear(); request(); env.onCheck = () => env.riskLatches.add(42); manage();
    assert.equal(env.sent.length, 0); manage(); assert.equal(saved().complete, 1);
});
check('unknown broker result survives restart without re-sending or percentage reset', () => {
    request(); env.resultOrder = 0; env.retcode = 'TRADE_RETCODE_TIMEOUT'; manage();
    const files = clone(env.files); reset({ files, now: 10000, resultOrder: 201 }); manage();
    assert.equal(env.sent.length, 0); assert.equal(saved().pending, 1); assert.equal(saved().target_remaining, 0.5);
});
check('unknown request resolves only its exact comment and magic then sends shortfall', () => {
    request(); env.resultOrder = 0; manage();
    env.orders = [order({ initial: 0.5, remaining: 0.2 })]; env.positions[0].volume = 0.7;
    env.now = 104; env.resultOrder = 201; manage();
    assert.equal(env.sent.length, 2); assert.equal(env.sent[1].volume, 0.2); assert.equal(env.sent[1].comment, 'RM2A-2');
});
check('different magic or unfinished order cannot confirm pending even after timeout', () => {
    for (const overrides of [{ magic: 999 }, { active: true }, { state: 'WORKING' }]) {
        reset(); request(); env.resultOrder = 0; manage(); env.orders = [order({ initial: 0.5, ...overrides })];
        env.positions[0].volume = 0.5; env.now = 99999; manage(); assert.equal(env.sent.length, 1);
    }
});
check('terminal fill waits for its reflected position update at equal timestamp', () => {
    request(); manage(); env.orders = [order({ initial: 0.5, done: 104000 })];
    env.positions[0].updated = 104000; env.now = 104; manage();
    assert.equal(saved().pending, 1); assert.equal(env.sent.length, 1);
    env.positions[0].volume = 0.5; manage(); assert.equal(saved().complete, 1);
});
check('target completion does not repeatedly close another percentage', () => {
    request(); manage(); env.orders = [order({ initial: 0.5 })]; env.positions[0].volume = 0.5;
    env.now = 104; manage(); manage(); assert.equal(saved().complete, 1); assert.equal(env.sent.length, 1);
    assert.equal(context.RMPositionExitActive(42), false);
});
check('new user operation after completion uses current volume and a new sequence', () => {
    request(); manage(); env.orders = [order({ initial: 0.5 })]; env.positions[0].volume = 0.5;
    env.now = 104; manage(); assert.equal(request().accepted, false);
    env.now = 107; assert.equal(request().accepted, true); manage();
    assert.equal(saved().generation, 2); assert.equal(saved().target_remaining, 0.25);
    assert.equal(env.sent[1].comment, 'RM2A-2'); assert.equal(env.sent[1].volume, 0.25);
});
check('external reductions count toward the frozen close target', () => {
    request(); env.positions[0].volume = 0.6; manage(); assert.equal(env.sent[0].volume, 0.1);
    reset(); request(); env.positions[0].volume = 0.4; manage();
    assert.equal(env.sent.length, 0); assert.equal(saved().complete, 1);
});
check('external additions and reversals pause manual requests without repeated journal writes', () => {
    for (const changes of [{ volume: 1.2 }, { direction: -1 }]) {
        reset(); request(); Object.assign(env.positions[0], changes); manage(); const count = env.writeAttempts;
        manage(); assert.equal(env.sent.length, 0); assert.equal(saved().blocked, 1); assert.equal(env.writeAttempts, count);
    }
});
check('external addition hidden by a confirmed partial fill still pauses new sends', () => {
    request(); manage(); env.orders = [order({ initial: 0.5, done: 103000 })];
    env.positions[0] = position({ volume: 0.8, updated: 104000 }); env.now = 104; manage();
    assert.equal(saved().pending, 0); assert.equal(saved().blocked, 1); assert.equal(env.sent.length, 1);
});
check('maximum close chunk continues only after definitive confirmation', () => {
    env.maximum = 0.3; request(100); manage(); assert.equal(env.sent[0].volume, 0.3);
    env.orders = [order({ initial: 0.3 })]; env.positions[0].volume = 0.7; env.now = 104; manage();
    assert.equal(env.sent[1].volume, 0.3); assert.equal(saved().target_remaining, 0);
});
check('chunking does not strand a sub-minimum amount above the partial target', () => {
    env.maximum = 0.45; env.minimum = 0.1; request(50); manage();
    assert.equal(env.sent[0].volume, 0.4);
    env.orders = [order({ initial: 0.4 })]; env.positions[0].volume = 0.6; env.now = 104; manage();
    assert.equal(env.sent[1].volume, 0.1);
});
check('definite rejection retries after throttle with another unique sequence', () => {
    request(); env.retcode = 'TRADE_RETCODE_REJECT'; manage(); assert.equal(saved().pending, 0);
    env.now = 101; manage(); assert.equal(env.sent.length, 1);
    env.now = 104; manage(); assert.equal(env.sent[1].comment, 'RM2A-2');
});
check('ordinary lock busy or unresolved pending cannot leave an empty manual file', () => {
    addOrdinary(); env.locks.add('rr:42'); assert.equal(request().accepted, false);
    assert.equal(env.files[context.RMExecutionFile(42)], undefined);
    env.locks.clear(); addOrdinary({ pending: 1, pending_order: 600 });
    assert.equal(request().accepted, false); assert.equal(env.files[context.RMExecutionFile(42)], undefined);
});
check('ordinary pending must be reflected before registration snapshots current volume', () => {
    addOrdinary({ pending: 1, pending_order: 600 });
    env.orders = [order({ ticket: 600, initial: 0.2, comment: 'RR2A-1' })];
    assert.equal(request().accepted, false);
    env.positions[0].volume = 0.8; assert.equal(request().accepted, true);
    assert.equal(saved().initial_volume, 0.8); assert.equal(saved().target_remaining, 0.4);
    manage(); assert.equal(env.sent[0].volume, 0.4); assert.equal(env.files['rr:42'].rr.pending, 1);
});
check('ordinary record corruption blocks registration and never modifies that record', () => {
    addOrdinary(); env.files['rr:42'].valid = false; const before = clone(env.files['rr:42']);
    assert.equal(request().accepted, false); assert.deepEqual(env.files['rr:42'], before);
});
check('manual mutex is held across send and busy/corrupt states block ordinary exits', () => {
    request(); env.locks.add(context.RMExecutionFile(42)); assert.equal(context.RMPositionExitActive(42), true);
    manage(); assert.equal(env.sent.length, 0); env.locks.clear(); saved().checksum++;
    assert.equal(context.RMPositionExitActive(42), true); manage(); assert.equal(env.sent.length, 0);
});
check('intent persistence failure cannot send an order', () => {
    request(); env.failWriteAt = env.writeAttempts + 1; manage();
    assert.equal(env.sent.length, 0); assert.equal(context.RMPositionExitActive(42), true);
    manage(); assert.equal(env.sent.length, 0);
});
check('lost post-send journal write never permits a guessed retry', () => {
    request(); env.failWriteAt = env.writeAttempts + 2; manage(); assert.equal(env.sent.length, 1);
    env.now = 99999; manage(); assert.equal(env.sent.length, 1); assert.equal(context.RMPositionExitActive(42), true);
});
check('sell closes buy at Ask and tick/preflight changes cannot over-close', () => {
    env.positions[0].direction = -1; env.fill = 2; request(); manage();
    assert.equal(env.sent[0].type, 'ORDER_TYPE_BUY'); assert.equal(env.sent[0].price, 100.1);
    assert.equal(env.sent[0].type_filling, 'ORDER_FILLING_IOC');
    for (const changes of [{ volume: 0.2 }, { direction: -1 }, { ticket: 457 }]) {
        reset(); request(); env.onCheck = () => Object.assign(env.positions[0], changes); manage(); assert.equal(env.sent.length, 0);
    }
});
check('ticket replacement under the same identifier is looked up again', () => {
    request(); env.positions[0].ticket = 457; manage(); assert.equal(env.sent[0].position, 457);
});
check('risk takeover confirms pending before canceling manual remainder', () => {
    request(); manage(); env.riskLatches.add(42); assert.equal(riskReady().ready, false);
    assert.equal(saved().complete, 0); env.orders = [order({ initial: 0.5, remaining: 0.2 })];
    env.positions[0].volume = 0.7; assert.equal(riskReady().ready, true);
    assert.equal(saved().complete, 1); manage(); assert.equal(env.sent.length, 1);
});
check('risk can take over a blocked or unsent manual task without a new manual order', () => {
    request(); env.positions[0].volume = 1.2; manage(); assert.equal(saved().blocked, 1);
    env.riskLatches.add(42); assert.equal(riskReady().ready, true); assert.equal(saved().complete, 1);
    assert.equal(env.sent.length, 0);
});
check('risk query without an actual risk latch does not cancel manual intent', () => {
    request(); assert.equal(riskReady().ready, true); assert.equal(saved().complete, 0);
});
check('risk lock contention never bypasses unresolved manual close', () => {
    request(); env.riskLatches.add(42); env.locks.add(context.RMExecutionFile(42));
    assert.equal(riskReady().ready, false); env.locks.clear();
    assert.equal(riskReady().ready, true);
});
check('reverse barrier needs terminal history even when the position is absent', () => {
    request(100); env.resultOrder = 0; manage(); env.positions = [];
    assert.equal(context.RMExitSettled(42), false); assert.equal(context.RMPositionExitActive(42), true);
    env.orders = [order()]; assert.equal(context.RMExitSettled(42), true);
    assert.equal(context.RMPositionExitActive(42), false); assert.equal(env.sent.length, 1);
});
check('reverse barrier never treats an active close order as settled', () => {
    request(100); manage(); env.positions = []; env.orders = [order({ active: true })];
    assert.equal(context.RMExitSettled(42), false); env.orders[0].active = false;
    assert.equal(context.RMExitSettled(42), true);
});
check('reverse barrier cannot settle a same-ID reopened or present position', () => {
    request(100); manage(); env.orders = [order()];
    env.positions = [position({ ticket: 999 })]; assert.equal(context.RMExitSettled(42), false);
});
check('account/server namespaces cannot execute another accounts pending intent', () => {
    request(); const originalPath = context.RMExecutionFile(42); env.login = 2002; manage();
    assert.equal(env.sent.length, 0); env.login = 1001; env.server = 'Other-Server'; manage(); assert.equal(env.sent.length, 0);
    assert.ok(env.files[originalPath]);
});
check('explicit selected tickets can include other magic and other symbols independently', () => {
    env.positions.push(position({ id: 43, ticket: 999, symbol: 'SECOND', volume: 2, direction: -1 }));
    assert.equal(request(25, 43).accepted, true); manage();
    assert.equal(env.sent[0].position, 999); assert.equal(env.sent[0].symbol, 'SECOND'); assert.equal(env.sent[0].volume, 0.5);
    assert.equal(context.RMPositionExitActive(42), false);
});
check('unavailable quote or unsupported fill preserves intent without sending', () => {
    for (const changes of [{ hasQuote: false }, { fill: 0 }, { checkPass: false }]) {
        reset(changes); request(); manage(); assert.equal(env.sent.length, 0); assert.equal(saved().complete, 0);
    }
});
check('all durable fields are covered by checksum and corruption remains blocked', () => {
    request(); const original = clone(saved());
    for (const { name } of fields) {
        Object.assign(saved(), original); saved()[name]++;
        const handle = context.FileOpen(context.RMExecutionFile(42), 1 | 4);
        assert.equal(context.RMExecutionLoad(handle, 42, {}), false, `changed field ${name}`);
        context.FileClose(handle);
        assert.equal(context.RMPositionExitActive(42), true); assert.equal(request().accepted, false);
    }
});
check('reverse registration verifies expected direction while ordinary manual calls remain compatible', () => {
    const error = { value: '' };
    assert.equal(context.RMRequestClose(42, 100, 123, error, -1), false);
    assert.equal(Object.keys(env.files).length, 0);
    assert.equal(context.RMRequestClose(42, 100, 123, error, 2), false);
    assert.equal(context.RMRequestClose(42, 100, 123, error, 1), true);
    assert.equal(saved().direction, 1);
});
check('same identifier reversal between precheck and registration cannot latch the wrong direction', () => {
    const error = { value: '' };
    env.onIdentifierLookup = count => { if (count === 2) env.positions[0].direction = -1; };
    assert.equal(context.RMRequestClose(42, 100, 123, error, 1), false);
    assert.equal(env.writeAttempts, 1); assert.equal(saved().complete, 1); assert.equal(saved().sequence, 0);
    assert.equal(saved().pending, 0); assert.equal(env.sent.length, 0); manage(); assert.equal(env.sent.length, 0);
    assert.equal(context.RMPositionExitActive(42), false, 'a rejected snapshot must not leave an empty blocking journal');
    env.onIdentifierLookup = undefined; env.now += 3;
    assert.equal(context.RMRequestClose(42, 50, 123, error), true, 'a later explicit operation can select the new direction');
});
check('ambiguous initial write is retained and never removed as a rejected snapshot', () => {
    env.flushFails = true; assert.equal(request().accepted, false);
    assert.ok(env.files[context.RMExecutionFile(42)]); assert.equal(context.RMPositionExitActive(42), true);
});
check('two completed 25 percent clicks compound remaining volume and do not close original 50 percent', () => {
    env.positions[0].volume = 1.6;
    assert.equal(request(25).accepted, true); manage();
    assert.equal(env.sent[0].volume, 0.4); assert.equal(saved().target_remaining, 1.2);
    assert.equal(request(25).accepted, false, 'rapid duplicate is not a second operation');
    env.orders = [order({ initial: 0.4 })]; env.positions[0].volume = 1.2;
    env.now = 104; manage(); assert.equal(saved().complete, 1);
    env.now = 107; env.resultOrder = 201;
    assert.equal(request(25).accepted, true); manage();
    assert.equal(env.sent.length, 2); assert.equal(env.sent[1].volume, 0.3);
    assert.equal(saved().target_remaining, 0.9);
    assert.ok(Math.abs((1.6 - saved().target_remaining) / 1.6 * 100 - 43.75) < 1e-8);
});

// Parent orchestration uses the actual manual journal/executor/history functions
// above. Only the parent position snapshot and unrelated risk/stop boundaries
// are simulated (their full implementations are covered by rr_batch_exits).
Object.assign(context, {
    RB_MAX_CHILDREN: 64, RB_ENTRY_BUILDING: 0, RR_Enable: false,
    RBGroupSymbol: () => 'TEST', RBManageGroupRisk: () => false, RBGroupGuardLatched: () => false,
    RBUpdateGroupStops: () => true, RRTargetReached: () => false,
    RRStateClosesAll: s => s.target_percent.reduce((sum, p) => sum + p, 0) === 100,
    RBSaveGroup: (_handle, g) => { env.savedParent = clone(g); return true; },
    RRNotice: text => env.notices.push(text),
    RBGroupVolumes: (g, remaining, tp, volumes) => {
        remaining.value = 0; tp.value = 0; volumes.fill(0);
        g.child_id.forEach((id, i) => {
            volumes[i] = env.positions.find(p => p.id === id)?.volume ?? 0;
            remaining.value += volumes[i];
        });
        remaining.value = Number(remaining.value.toFixed(8));
        return true;
    },
});
for (const name of ['RBManualTarget', 'RBPickClose', 'RBClosedGoal', 'RBGroupCloseBusy', 'RBManageGroupLocked'])
    vm.runInContext(extract(name, batch), context, { filename: 'production:parent:' + name });

function parentTask(percent = 50, volumes = [3, 3, 3, 3]) {
    context.RR_Enable = false;
    env.positions = volumes.map((volume, i) => position({ id: 42 + i, ticket: 456 + i, volume }));
    const total = volumes.reduce((sum, volume) => sum + volume, 0);
    const g = { parent_id: 700, child_count: volumes.length, child_id: volumes.map((_, i) => 42 + i),
        exit_ready: 1, entry_state: 1, pending: 0, magic: 123, direction: 1,
        manual_active: 1, manual_target_remaining: context.RBManualTarget(total, percent, env.step),
        manual_created: env.now, manual_completed: 0,
        exit_state: { blocked: 0, initial_volume: total, stage: 0, target_count: 2,
            entry: 100, risk: 10, target_r: [2, 5], target_percent: [50, 50], target_be: [0, 0] } };
    env.savedParent = clone(g);
    return g;
}
function parentCycle(g) {
    context.RBManageGroupLocked(900, g);
    assert.equal(env.handles.size, 0, 'parent releases every child journal handle');
}
function fillLastParentClose({ terminal = true } = {}) {
    const req = env.sent.at(-1), pos = env.positions.find(p => p.ticket === req.position);
    assert.ok(pos, 'fill must refer to the selected live child');
    const id = pos.id, ticket = saved(id).pending_order;
    env.orders.push(order({ ticket, positionId: id, comment: req.comment, initial: req.volume, active: !terminal }));
    pos.volume = Number((pos.volume - req.volume).toFixed(8));
    if (pos.volume === 0) env.positions = env.positions.filter(p => p.id !== id);
    env.resultOrder++; env.now += 4;
    return id;
}
check('parent 4 x 3 lots at 50 percent settles vanished child and closes exactly 6 lots', () => {
    const g = parentTask(); assert.equal(g.manual_target_remaining, 6);
    parentCycle(g); manage(); assert.equal(env.sent.length, 1); assert.equal(env.sent[0].volume, 3);
    const first = fillLastParentClose();
    manage(); assert.equal(saved(first).complete, 0, 'ordinary manager cannot see the vanished child');
    parentCycle(g); assert.equal(saved(first).complete, 1, 'parent confirms the vanished journal from history');
    manage(); assert.equal(env.sent.length, 2); assert.equal(env.sent[1].volume, 3);
    const second = fillLastParentClose();
    parentCycle(g); manage(); parentCycle(g);
    assert.equal(saved(second).complete, 1); assert.equal(g.manual_active, 0);
    assert.equal(env.positions.reduce((sum, p) => sum + p.volume, 0), 6);
    assert.equal(env.sent.length, 2, 'repeated ticks cannot close the remaining 6 lots');
});
check('parent resumes persisted 50 percent target after first child disappeared before restart', () => {
    let g = parentTask(); parentCycle(g); manage(); fillLastParentClose();
    g = clone(env.savedParent); parentCycle(g); manage(); fillLastParentClose(); parentCycle(g);
    assert.equal(g.manual_target_remaining, 6); assert.equal(g.manual_active, 0);
    assert.equal(env.sent.reduce((sum, req) => sum + req.volume, 0), 6);
});
check('parent waits for missing or active history before scheduling another child', () => {
    const g = parentTask(); parentCycle(g); manage(); fillLastParentClose({ terminal: false });
    const pending = clone(env.orders); env.orders = []; env.now = 10000;
    parentCycle(g); manage(); assert.equal(env.sent.length, 1); assert.equal(saved().complete, 0);
    env.orders = pending; parentCycle(g); manage(); assert.equal(env.sent.length, 1);
    env.orders[0].active = false; parentCycle(g); manage(); assert.equal(env.sent.length, 2);
});
check('parent finds an ambiguous close by comment without submitting another copy', () => {
    const g = parentTask(); parentCycle(g); env.resultOrder = 0; manage();
    const req = env.sent[0]; env.positions = env.positions.filter(p => p.id !== 42);
    parentCycle(g); manage(); assert.equal(env.sent.length, 1);
    env.orders = [order({ ticket: 300, comment: req.comment, initial: 3 })];
    env.resultOrder = 301; parentCycle(g); manage();
    assert.equal(env.sent.length, 2); assert.equal(env.sent[1].position, 457);
});
check('parent cannot bypass a locked or corrupt vanished-child journal', () => {
    const g = parentTask(); parentCycle(g); manage(); fillLastParentClose();
    const path = context.RMExecutionFile(42); env.locks.add(path);
    parentCycle(g); manage(); assert.equal(env.sent.length, 1);
    env.locks.delete(path); saved().checksum++;
    parentCycle(g); manage(); assert.equal(env.sent.length, 1);
    assert.equal(g.manual_active, 1);
});
check('same identifier reappearing during parent history settlement blocks next child', () => {
    const g = parentTask(); parentCycle(g); manage(); fillLastParentClose();
    const original = context.HistoryOrderSelect;
    context.HistoryOrderSelect = ticket => {
        env.positions.push(position({ ticket: 999, volume: 3 }));
        return original(ticket);
    };
    try {
        parentCycle(g); assert.equal(saved().complete, 0);
        assert.equal(env.sent.length, 1); assert.equal(saved(43), undefined);
    } finally { context.HistoryOrderSelect = original; }
});
check('parent 100 percent closes all four children serially including final journal settlement', () => {
    const g = parentTask(100);
    for (let i = 0; i < 4; i++) {
        parentCycle(g); manage(); assert.equal(env.sent.length, i + 1); fillLastParentClose();
    }
    parentCycle(g); manage(); assert.equal(g.manual_active, 0); assert.equal(env.positions.length, 0);
    assert.equal(env.sent.reduce((sum, req) => sum + req.volume, 0), 12);
    assert.ok(g.child_id.every(id => saved(id).complete === 1));
});
check('parent target ending inside the second child closes only the required partial volume', () => {
    const g = parentTask(37.5); parentCycle(g); manage(); fillLastParentClose();
    parentCycle(g); manage(); assert.equal(env.sent[1].volume, 1.5);
    fillLastParentClose(); manage(); parentCycle(g);
    assert.equal(g.manual_active, 0); assert.equal(env.positions.reduce((sum, p) => sum + p.volume, 0), 7.5);
    assert.equal(env.sent.length, 2);
});
check('automatic 50 percent parent TP uses the same vanished-child settlement barrier', () => {
    const g = parentTask(); g.manual_active = 0; g.exit_state.stage = 1; context.RR_Enable = true;
    try {
        parentCycle(g); manage(); fillLastParentClose(); parentCycle(g); manage(); fillLastParentClose();
        parentCycle(g); manage(); assert.equal(env.sent.length, 2);
        assert.equal(env.positions.reduce((sum, p) => sum + p.volume, 0), 6);
    } finally { context.RR_Enable = false; }
});
console.log(`\n${passed} manual-execution tests passed against production function bodies.`);
console.log('Scope: in-memory journals, positions and broker responses; no terminal files or trades.');

