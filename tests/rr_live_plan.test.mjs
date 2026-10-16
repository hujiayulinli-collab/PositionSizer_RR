// Execute production live-plan APIs with simulated MT5 positions/files/history.
// No real terminal files or trade requests are accessed by this runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const manager = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const core = readFileSync(new URL('../mt5/RRCore.mqh', import.meta.url), 'utf8');
const plans = readFileSync(new URL('../mt5/RRPlan.mqh', import.meta.url), 'utf8');
const copy = value => structuredClone(value);
function emptyPlan() {
    return { count: 0, targets: Array.from({ length: 20 }, () => ({ multiple: 0, percent: 0, move_be: 0 })) };
}
function plan(rows = [[2, 50, 1], [5, 50, 0]]) {
    const result = emptyPlan();
    result.count = rows.length;
    rows.forEach(([multiple, percent, move_be = 0], i) => { result.targets[i] = { multiple, percent, move_be }; });
    return result;
}
function state(overrides = {}) {
    return { version: 2, identifier: 42, magic: 123, opening_order: 100, direction: 1, entry: 100, risk: 10,
        initial_volume: 1, first_r: 2, final_r: 5, percent: 50, move_be: 1, offset_points: 3,
        stage: 0, be_done: 0, blocked: 0, sequence: 7, pending: 0, pending_order: 0, before_volume: 0.7,
        last_request: 29, last_stop_request: 35, checksum: 123456, target_count: 2,
        target_r: [2, 5, ...Array(18).fill(0)], target_percent: [50, 50, ...Array(18).fill(0)],
        target_be: [1, 0, ...Array(18).fill(0)], be_requested: 0, ...overrides };
}
function position(overrides = {}) {
    return { ticket: 456, id: 42, symbol: 'TEST', magic: 123, volume: 1, entry: 100, direction: 1, ...overrides };
}

function extract(source, name) {
    const match = new RegExp(`(?:bool|void|double|ulong|uint)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Missing production function ${name}`);
    let depth = 1;
    const start = match.index + match[0].length;
    let end = start;
    for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    assert.equal(depth, 0);
    const args = match[1].split(',').map(arg => arg.trim().match(/(\w+)\s*$/)[1]);
    let body = source.slice(start, end - 1)
        .replace(/\bRRState\s+(\w+)\s*=\s*s\s*;/g, 'let $1 = clone(s);')
        .replace(/\bRRState\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bRRPlan\s+(\w+)\s*;/g, 'let $1 = emptyPlan();')
        .replace(/\bMqlTick\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\b(?:const\s+)?(?:double|int|uint|ulong|long|bool|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:ulong|long|uint|int|double)\)/g, '')
        .replace(/\berror\s*=/g, 'error.value =')
        .replace('RRHistory(s.identifier, opening_order, in_volume, mixed)',
            'RRHistory(s.identifier, value => { opening_order = value.opening_order; in_volume = value.in_volume; mixed = value.mixed; })')
        .replace('s = updated;', 'Object.assign(s, clone(updated));');
    // Output-reference adapters are the only changes to API call syntax.
    if (name === 'RRReadManagedPosition' || name === 'RRSelectManagedPosition') {
        body = body.replace(/\bticket\b/g, 'ticket.value')
            .replaceAll('RRSelectManagedPosition(symbol, magic, id, ticket.value)', 'RRSelectManagedPosition(symbol, magic, id, ticket)');
    }
    if (name === 'RRApplyPositionPlan') {
        body = body.replace('RRSelectManagedPosition(symbol, magic, id, ticket)',
            'RRSelectManagedPosition(symbol, magic, id, { get value() { return ticket; }, set value(v) { ticket = v; } })');
    }
    if (name === 'RRNextManagedPosition') {
        body = body.replace('RRReadManagedPosition(symbol, magic, id, s, ticket, error)',
            'RRReadManagedPosition(symbol, magic, id, s, { get value() { return ticket; }, set value(v) { ticket = v; } }, error)');
    }
    body = body.replace(/let error\s*;/g, "let error = { value: '' };");
    if (name === 'RRPlanChecksum')
        body = body.replace('hash = (hash ^ StringGetCharacter(value, i)) * 16777619;',
            'hash = Math.imul(hash ^ StringGetCharacter(value, i), 16777619) >>> 0;');
    return `function ${name}(${args.join(',')}) {${body}\n}`;
}

let env;
const symbols = ['POSITION_IDENTIFIER', 'POSITION_MAGIC', 'POSITION_TYPE', 'POSITION_TYPE_BUY',
    'POSITION_SYMBOL', 'POSITION_PRICE_OPEN', 'POSITION_VOLUME', 'SYMBOL_VOLUME_STEP', 'SYMBOL_VOLUME_MIN',
    'SYMBOL_TRADE_TICK_SIZE', 'SYMBOL_DIGITS', 'TERMINAL_CONNECTED'];
const context = vm.createContext({
    ...Object.fromEntries(symbols.map(name => [name, name])),
    RR_MAX_TARGETS: 20, FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, INVALID_HANDLE: -1,
    clone: copy, emptyPlan, MathAbs: Math.abs, MathMax: Math.max, MathFloor: Math.floor, MathCeil: Math.ceil,
    MathIsValidNumber: Number.isFinite, NormalizeDouble: (number, digits) => Number(number.toFixed(digits)),
    DoubleToString: (number, digits) => number.toFixed(digits), IntegerToString: String,
    StringLen: text => text.length, StringGetCharacter: (text, index) => text.charCodeAt(index),
    StringFormat: (format, ...args) => `${format} ${args.join(' ')}`,
    ZeroMemory: value => {
        const isPlan = Object.hasOwn(value, 'targets');
        for (const key of Object.keys(value)) delete value[key];
        if (isPlan) Object.assign(value, emptyPlan());
    },
    PositionsTotal: () => env.positions.length,
    PositionGetTicket: index => { env.selected = env.positions[index]; return env.selected?.ticket ?? 0; },
    PositionSelectByTicket: ticket => {
        env.selected = env.positions.find(p => p.ticket === ticket);
        return Boolean(env.selected);
    },
    PositionGetString: () => env.selected?.symbol,
    PositionGetInteger: key => ({ POSITION_IDENTIFIER: env.selected?.id, POSITION_MAGIC: env.selected?.magic,
        POSITION_TYPE: env.selected?.direction === 1 ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL' })[key],
    PositionGetDouble: key => ({ POSITION_PRICE_OPEN: env.selected?.entry, POSITION_VOLUME: env.selected?.volume })[key],
    RRFileName: id => `journal:${id}`,
    FileIsExist: filename => Object.hasOwn(env.files, filename),
    FileOpen: (filename, flags) => {
        env.opens.push({ filename, flags });
        if (env.failOpen || env.locked.has(filename)) return -1;
        const handle = ++env.handle;
        env.handles.set(handle, { filename, flags }); env.locked.add(filename);
        return handle;
    },
    FileClose: handle => {
        assert.ok(env.handles.has(handle), 'every close owns an open handle');
        env.locked.delete(env.handles.get(handle).filename); env.handles.delete(handle); env.closed.push(handle);
    },
    RRLoad: (handle, output, id) => {
        const file = env.files[env.handles.get(handle).filename];
        if (file) Object.assign(output, copy(file.state));
        if (env.onLoad) env.onLoad();
        return Boolean(file?.valid && file.state.identifier === id);
    },
    RRSave: (handle, output) => {
        const opened = env.handles.get(handle);
        assert.ok(opened && (opened.flags & 2), 'save requires the exclusive writable handle');
        env.saveAttempts++;
        if (env.failSave) return false;
        env.saved.push(copy(output)); env.files[opened.filename] = { valid: true, state: copy(output) };
        return true;
    },
    RRHistory: (_id, output) => {
        output({ opening_order: env.openingOrder, in_volume: env.inVolume, mixed: env.mixed });
        if (env.onHistory) env.onHistory();
        return env.hasHistory;
    },
    TerminalInfoInteger: () => env.connected,
    SymbolInfoDouble: (_symbol, key) => ({ SYMBOL_VOLUME_STEP: env.step, SYMBOL_VOLUME_MIN: env.minimum,
        SYMBOL_TRADE_TICK_SIZE: env.tickSize })[key],
    SymbolInfoInteger: () => env.digits,
    SymbolInfoTick: (_symbol, tick) => { Object.assign(tick, { bid: env.bid, ask: env.ask }); return env.hasQuote; },
    PrintFormat: (...args) => env.notices.push(args),
    OrderSend: () => { throw new Error('Editing must never send a trade request'); },
});
for (const name of ['RRTargetPrice', 'RRTargetReached']) vm.runInContext(extract(core, name), context);
for (const name of ['RRPlanValidate', 'RRPlanChecksum']) vm.runInContext(extract(plans, name), context);
for (const name of ['RRSelectManagedPosition', 'RRStatePlan', 'RRReadManagedPosition', 'RRNextManagedPosition',
    'RRPositionPlanPricesSafe', 'RRApplyPositionPlanLocked', 'RRApplyPositionPlan'])
    vm.runInContext(extract(manager, name), context, { filename: `production:${name}` });

function reset(s = state(), overrides = {}) {
    env = { positions: [position()], files: { 'journal:42': { valid: true, state: copy(s) } }, selected: undefined,
        locked: new Set(), handles: new Map(), handle: 0, opens: [], closed: [], saved: [], saveAttempts: 0,
        failOpen: false, failSave: false, openingOrder: 100, inVolume: 1, mixed: false, hasHistory: true,
        step: 0.01, minimum: 0.01, tickSize: 0.01, digits: 2, connected: true, hasQuote: true,
        bid: 119, ask: 119.2, notices: [], ...overrides };
}
function read(id = 42, symbol = 'TEST', magic = 123) {
    const s = {}, ticket = { value: 0 }, error = { value: 'stale' };
    const ok = context.RRReadManagedPosition(symbol, magic, id, s, ticket, error);
    return { ok, s, ticket: ticket.value, error: error.value };
}
function loadedPlan(s) { const p = emptyPlan(); context.RRStatePlan(s, p); return p; }
function apply(p = plan([[2.5, 40, 1], [6, 60]]), options = {}) {
    const original = options.baseline ?? env.files['journal:42']?.state ?? state();
    const checksum = options.checksum ?? context.RRPlanChecksum(loadedPlan(original));
    const error = { value: 'stale' };
    const ok = context.RRApplyPositionPlan(options.symbol ?? 'TEST', options.magic ?? 123, options.id ?? 42,
        p, checksum, options.stage ?? original.stage, error);
    assert.equal(env.handles.size, 0, 'all file paths release their handle');
    if (ok) assert.equal(error.value, '');
    else { assert.ok(error.value.length > 0); assert.equal(env.saved.length, 0); }
    return { ok, error: error.value };
}
let passed = 0;
function check(name, callback) {
    try { callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}

check('read returns frozen plan and ticket without writes', () => {
    reset(); const result = read();
    assert.equal(result.ok, true); assert.equal(result.ticket, 456); assert.equal(result.s.risk, 10);
    assert.equal(env.saved.length, 0); assert.equal(env.opens[0].flags, 5); assert.equal(env.handles.size, 0);
});
check('read legacy plan as two targets without migration', () => {
    reset(state({ version: 1, stage: 2 })); const result = read();
    assert.equal(result.ok, true); assert.deepEqual(loadedPlan(result.s), plan()); assert.equal(env.saved.length, 0);
});
check('read never adopts a position without journal', () => {
    reset(state(), { files: {} }); assert.equal(read().ok, false); assert.equal(env.opens.length, 0);
});
check('read excludes other symbol or strategy', () => {
    reset(); assert.equal(read(42, 'OTHER').ok, false); assert.equal(read(42, 'TEST', 999).ok, false);
});
check('read rejects a locked, damaged, or mismatching journal', () => {
    reset(state(), { failOpen: true }); assert.equal(read().ok, false);
    reset(); env.files['journal:42'].valid = false; assert.equal(read().ok, false);
    reset(state({ magic: 999 })); assert.equal(read().ok, false);
});
check('read rechecks position existence after loading', () => {
    reset(state(), { onLoad: () => { env.positions = []; } }); assert.equal(read().ok, false);
});
check('enumeration is stable sorted and excludes unmanaged positions', () => {
    reset(state(), { positions: [position({ id: 80, ticket: 800 }), position({ id: 7, ticket: 70 }), position(),
        position({ id: 9, ticket: 90, magic: 999 }), position({ id: 11, ticket: 110, symbol: 'OTHER' }),
        position({ id: 15, ticket: 150 })] });
    env.files['journal:7'] = { valid: true, state: state({ identifier: 7, version: 1 }) };
    env.files['journal:80'] = { valid: true, state: state({ identifier: 80 }) };
    assert.equal(context.RRNextManagedPosition('TEST', 123, 0), 7);
    assert.equal(context.RRNextManagedPosition('TEST', 123, 7), 42);
    assert.equal(context.RRNextManagedPosition('TEST', 123, 42), 80);
    assert.equal(context.RRNextManagedPosition('TEST', 123, 80), 0);
});
check('save appends new future plan and preserves all execution fields', () => {
    const original = state(); reset(original);
    assert.equal(apply().ok, true); assert.equal(env.opens[0].flags, 7); assert.equal(env.saved.length, 1);
    const saved = env.saved[0];
    assert.deepEqual(loadedPlan(saved), plan([[2.5, 40, 1], [6, 60]]));
    for (const key of Object.keys(original)) {
        if (['target_count', 'target_r', 'target_percent', 'target_be', 'first_r', 'final_r', 'percent', 'move_be', 'checksum'].includes(key)) continue;
        assert.deepEqual(saved[key], original[key], `frozen/execution field ${key}`);
    }
    assert.equal(read().s.final_r, 6, 'a subsequent read observes the persisted plan');
});
check('completed triggered prefix and BE request are kept after editing future rows', () => {
    const original = state({ stage: 1, be_requested: 1, be_done: 1 });
    reset(original, { positions: [position({ volume: 0.5 })], bid: 125, ask: 125.2 });
    assert.equal(apply(plan([[2, 50, 1], [4, 20], [6, 30]])).ok, true);
    assert.equal(env.saved[0].stage, 1); assert.equal(env.saved[0].be_requested, 1); assert.equal(env.saved[0].be_done, 1);
});
check('future rows can be removed without retaining stale array values', () => {
    reset(); assert.equal(apply(plan([[6, 100]])).ok, true);
    assert.equal(env.saved[0].target_count, 1); assert.equal(env.saved[0].target_r[1], 0);
    assert.equal(env.saved[0].target_percent[1], 0); assert.equal(env.saved[0].target_be[1], 0);
});
check('v1 editing is refused and does not migrate journal', () => {
    reset(state({ version: 1 })); assert.equal(apply().ok, false);
});
check('pending or blocked execution is refused', () => {
    reset(state({ pending: 1, pending_order: 200 })); assert.equal(apply().ok, false);
    reset(state({ blocked: 1 })); assert.equal(apply().ok, false);
});
check('plan checksum and stage are checked under exclusive file lock', () => {
    reset(); assert.equal(apply(undefined, { checksum: 1 }).ok, false);
    reset(); assert.equal(apply(undefined, { stage: 1 }).ok, false);
});
check('another editor saving first invalidates a stale draft', () => {
    const baseline = state(); reset(baseline); assert.equal(apply().ok, true);
    env.saved = []; assert.equal(apply(plan([[3, 50, 1], [7, 50]]), { baseline }).ok, false);
});
check('already triggered R, percentage and BE cannot change', () => {
    for (const rows of [[[2.1, 50, 1], [6, 50]], [[2, 40, 1], [6, 60]], [[2, 50, 0], [6, 50]]]) {
        reset(state({ stage: 1, be_requested: 1 }), { positions: [position({ volume: 0.5 })], bid: 125, ask: 125.2 });
        assert.equal(apply(plan(rows)).ok, false);
    }
});
check('triggered rows cannot be removed or bypassed with a final-only plan', () => {
    reset(state({ stage: 1 }), { positions: [position({ volume: 0.5 })] });
    assert.equal(apply(plan([[6, 100]])).ok, false);
});
check('stage with an unfinished cumulative reduction cannot be edited', () => {
    reset(state({ stage: 1 }), { positions: [position({ volume: 0.7 })], bid: 125, ask: 125.2 });
    assert.equal(apply(plan([[2, 50, 1], [6, 50]])).ok, false);
});
check('fully triggered final stage is refused even after a partial final fill', () => {
    reset(state({ stage: 2 }), { positions: [position({ volume: 0.1 })] }); assert.equal(apply().ok, false);
});
check('external add, reversal, opening-order or opening-price changes are refused', () => {
    for (const overrides of [{ mixed: true }, { inVolume: 1.1 }, { openingOrder: 101 },
        { positions: [position({ volume: 1.1 })] }, { positions: [position({ direction: -1 })] },
        { positions: [position({ entry: 100.1 })] }]) {
        reset(state(), overrides); assert.equal(apply().ok, false);
    }
});
check('unavailable history and a position disappearing during history lookup are refused', () => {
    reset(state(), { hasHistory: false }); assert.equal(apply().ok, false);
    reset(state(), { onHistory: () => { env.positions = []; } }); assert.equal(apply().ok, false);
});
check('manual reduction counts toward later cumulative targets', () => {
    reset(state(), { positions: [position({ volume: 0.6 })] });
    assert.equal(apply(plan([[2.5, 30, 1], [4, 30], [6, 40]])).ok, true);
    assert.equal(env.saved[0].initial_volume, 1);
});
check('current remainder is used to reject a future partial below minimum', () => {
    reset(state(), { positions: [position({ volume: 0.65 })], minimum: 0.1 });
    assert.equal(apply(plan([[2.5, 40, 1], [6, 60]])).ok, false);
});
check('future final target closes the exact remainder after manual reductions', () => {
    reset(state(), { positions: [position({ volume: 0.35 })], minimum: 0.1 });
    assert.equal(apply(plan([[2.5, 30, 1], [6, 70]])).ok, true);
});
check('zero-percent BE nodes remain editable when no reduction is needed', () => {
    const s = state({ stage: 1, target_percent: [0, 100, ...Array(18).fill(0)], percent: 0, be_requested: 1 });
    reset(s, { bid: 125, ask: 125.2 });
    assert.equal(apply(plan([[2, 0, 1], [4, 50], [6, 50]])).ok, true);
});
check('old target just reached prevents moving it away before manager latches it', () => {
    reset(state(), { bid: 120, ask: 120.2 }); assert.equal(apply().ok, false);
});
check('old sell target uses executable Ask when detecting just-reached race', () => {
    reset(state({ direction: -1 }), { positions: [position({ direction: -1 })], bid: 79.9, ask: 80.1 });
    assert.equal(apply().ok, true);
    reset(state({ direction: -1 }), { positions: [position({ direction: -1 })], bid: 79.9, ask: 80 });
    assert.equal(apply().ok, false);
});
check('new target behind, at, or less than one tick ahead of price is rejected', () => {
    for (const multiple of [1.8, 1.9]) {
        reset(); assert.equal(apply(plan([[multiple, 50, 1], [6, 50]])).ok, false);
    }
    reset(state(), { bid: 119.005, ask: 119.015 });
    assert.equal(apply(plan([[1.901, 50, 1], [6, 50]])).ok, false);
});
check('one legal tick ahead is accepted for buy and sell', () => {
    reset(); assert.equal(apply(plan([[1.901, 50, 1], [6, 50]])).ok, true);
    reset(state({ direction: -1 }), { positions: [position({ direction: -1 })], bid: 80.8, ask: 81 });
    assert.equal(apply(plan([[1.901, 50, 1], [6, 50]])).ok, true);
});
check('negative or overflow target price is rejected', () => {
    reset(state({ direction: -1 }), { positions: [position({ direction: -1 })], bid: 81, ask: 81.2 });
    assert.equal(apply(plan([[2.5, 50, 1], [11, 50]])).ok, false);
    reset(); assert.equal(apply(plan([[2.5, 50, 1], [Number.MAX_VALUE, 50]])).ok, false);
});
check('disconnected terminal or invalid quote cannot approve target placement', () => {
    for (const overrides of [{ connected: false }, { hasQuote: false }, { bid: 0 }, { ask: NaN }, { ask: 118 }, { tickSize: 0 }]) {
        reset(state(), overrides); assert.equal(apply().ok, false);
    }
});
check('all targets must total 100 and preserve ordering', () => {
    for (const rows of [[[2.5, 40], [6, 50]], [[6, 50], [2.5, 50]], [[2.5, 0], [6, 100]]]) {
        reset(); assert.equal(apply(plan(rows)).ok, false);
    }
});
check('exclusive lock failure does not modify any state', () => {
    reset(state(), { failOpen: true }); assert.equal(apply().ok, false); assert.equal(env.saveAttempts, 0);
});
check('save failure reports failure without mutating the prior state', () => {
    const original = state(); reset(original, { failSave: true });
    assert.equal(apply().ok, false); assert.deepEqual(env.files['journal:42'].state, original);
});
check('missing or invalid journal cannot be silently created or repaired', () => {
    reset(state(), { files: {} }); assert.equal(apply().ok, false); assert.equal(env.opens.length, 0);
    reset(); env.files['journal:42'].valid = false; assert.equal(apply().ok, false);
});

process.stdout.write(`\n${passed} live-plan tests passed against production APIs.\n`);
process.stdout.write('Scope: in-memory MT5 boundaries; no real positions, journal files, or trading requests.\n');
