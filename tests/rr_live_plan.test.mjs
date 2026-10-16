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
        if (env.onOpen) env.onOpen();
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
    SymbolInfoDouble: (symbol, key) => {
        env.symbolReads.push(symbol); const rules = env.symbolRules[symbol] ?? env;
        return ({ SYMBOL_VOLUME_STEP: rules.step, SYMBOL_VOLUME_MIN: rules.minimum, SYMBOL_TRADE_TICK_SIZE: rules.tickSize })[key];
    },
    SymbolInfoInteger: symbol => (env.symbolRules[symbol] ?? env).digits,
    SymbolInfoTick: (symbol, tick) => { const rules = env.symbolRules[symbol] ?? env;
        Object.assign(tick, { bid: rules.bid, ask: rules.ask }); return rules.hasQuote; },
    RGPositionExitLatched: id => env.riskExits.has(id), RMPositionExitActive: id => env.manualExits.has(id),
    PrintFormat: (...args) => env.notices.push(args),
    OrderSend: () => { throw new Error('Editing must never send a trade request'); },
});
for (const name of ['RRTargetPrice', 'RRTargetReached']) vm.runInContext(extract(core, name), context);
for (const name of ['RRPlanTotalPercent', 'RRPlanClosesAll', 'RRPlanValidate', 'RRPlanChecksum']) vm.runInContext(extract(plans, name), context);
for (const name of ['RRStateClosesAll', 'RRSelectManagedPosition', 'RRStatePlan', 'RRReadManagedPosition', 'RRNextManagedPosition',
    'RRPositionPlanPricesSafe', 'RRApplyPositionPlanLocked', 'RRApplyPositionPlan'])
    vm.runInContext(extract(manager, name), context, { filename: `production:${name}` });

function reset(s = state(), overrides = {}) {
    env = { positions: [position()], files: { 'journal:42': { valid: true, state: copy(s) } }, selected: undefined,
        locked: new Set(), handles: new Map(), handle: 0, opens: [], closed: [], saved: [], saveAttempts: 0,
        failOpen: false, failSave: false, openingOrder: 100, inVolume: 1, mixed: false, hasHistory: true,
        step: 0.01, minimum: 0.01, tickSize: 0.01, digits: 2, connected: true, hasQuote: true,
        bid: 119, ask: 119.2, notices: [], symbolRules: {}, symbolReads: [], riskExits: new Set(), manualExits: new Set(), ...overrides };
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
check('targets cannot exceed 100 or violate ordering and BE rules', () => {
    for (const rows of [[[2.5, 60], [6, 50]], [[6, 50], [2.5, 50]], [[2.5, 0], [6, 100]]]) {
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

function completedRunner(overrides = {}) {
    return state({ target_count: 1, target_r: [2, ...Array(19).fill(0)], target_percent: [50, ...Array(19).fill(0)],
        target_be: [1, ...Array(19).fill(0)], first_r: 2, final_r: 2, percent: 50, stage: 1, be_requested: 1, ...overrides });
}
check('a live full-exit plan may be edited into a runner without changing frozen state', () => {
    reset(); assert.equal(apply(plan([[2.5, 50, 1]])).ok, true);
    assert.equal(context.RRStateClosesAll(env.saved[0]), false); assert.equal(env.saved[0].initial_volume, 1);
});
check('completed runner may save exactly its triggered prefix without adding targets', () => {
    reset(completedRunner(), { positions: [position({ volume: 0.5 })], bid: 130, ask: 130.2 });
    assert.equal(apply(plan([[2, 50, 1]])).ok, true);
    assert.equal(env.saved[0].stage, 1); assert.equal(env.saved[0].target_count, 1);
    assert.equal(env.saved[0].be_requested, 1); assert.equal(env.saved[0].sequence, 7);
});
check('completed runner can append future partial targets while retaining remainder', () => {
    reset(completedRunner(), { positions: [position({ volume: 0.5 })], bid: 130, ask: 130.2 });
    assert.equal(apply(plan([[2, 50, 1], [4, 25]])).ok, true);
    assert.equal(context.RRStateClosesAll(env.saved[0]), false); assert.equal(env.saved[0].stage, 1);
});
check('completed runner can append a full-exit remainder target', () => {
    reset(completedRunner(), { positions: [position({ volume: 0.5 })], bid: 130, ask: 130.2 });
    assert.equal(apply(plan([[2, 50, 1], [4, 20], [6, 30]])).ok, true);
    assert.equal(context.RRStateClosesAll(env.saved[0]), true); assert.equal(env.saved[0].final_r, 6);
});
check('runner append rejects a target already passed and accepts a future target', () => {
    reset(completedRunner(), { positions: [position({ volume: 0.5 })], bid: 145, ask: 145.2 });
    assert.equal(apply(plan([[2, 50, 1], [4, 25]])).ok, false);
    reset(completedRunner(), { positions: [position({ volume: 0.5 })], bid: 145, ask: 145.2 });
    assert.equal(apply(plan([[2, 50, 1], [5, 25]])).ok, true);
});
check('completed runner prefix cannot change or exceed total 100 on append', () => {
    for (const rows of [[[2, 40, 1], [4, 25]], [[2, 50, 0], [4, 25]], [[2, 50, 1], [4, 60]]]) {
        reset(completedRunner(), { positions: [position({ volume: 0.5 })], bid: 130, ask: 130.2 });
        assert.equal(apply(plan(rows)).ok, false);
    }
});
check('future full-exit node can be removed to retain an already reduced runner', () => {
    reset(state({ stage: 1, be_requested: 1 }), { positions: [position({ volume: 0.5 })], bid: 130, ask: 130.2 });
    assert.equal(apply(plan([[2, 50, 1]])).ok, true); assert.equal(context.RRStateClosesAll(env.saved[0]), false);
});
check('just-reached old full-exit node cannot be deleted to rescue a runner', () => {
    reset(state({ stage: 1, be_requested: 1 }), { positions: [position({ volume: 0.5 })], bid: 150, ask: 150.2 });
    assert.equal(apply(plan([[2, 50, 1]])).ok, false);
});
check('runner last partial must satisfy current-volume minimum rather than force full close', () => {
    reset(state(), { positions: [position({ volume: 0.35 })], minimum: 0.1 });
    assert.equal(apply(plan([[2.5, 70, 1]])).ok, false);
    reset(state(), { positions: [position({ volume: 0.35 })], minimum: 0.1 });
    assert.equal(apply(plan([[2.5, 60, 1]])).ok, true);
});
check('all-zero BE-only live plan saves without scheduling any reduction', () => {
    reset(); assert.equal(apply(plan([[2.5, 0, 1], [6, 0, 1]])).ok, true);
    assert.equal(context.RRStateClosesAll(env.saved[0]), false);
});
check('unfinished runner reduction still blocks editing when all targets triggered', () => {
    reset(completedRunner(), { positions: [position({ volume: 0.7 })], bid: 130, ask: 130.2 });
    assert.equal(apply(plan([[2, 50, 1], [4, 20]])).ok, false);
});
check('near-100 full-exit stage still owes the final lot step and cannot be edited', () => {
    reset(state({ stage: 2, target_percent: [50, 49.99999995, ...Array(18).fill(0)] }),
        { positions: [position({ volume: 0.01 })], bid: 145, ask: 145.2 });
    assert.equal(apply(plan([[2, 50, 1], [5, 49.99999995]])).ok, false);
});

check('wildcard read finds managed positions on another symbol without adopting other magic', () => {
    reset(state(), { positions: [position({ symbol: 'EURUSD' })] });
    assert.equal(read(42, '').ok, true); assert.equal(read(42, 'TEST').ok, false); assert.equal(read(42, '', 999).ok, false);
    assert.equal(env.saved.length, 0);
});
check('wildcard next position enumerates readable journals across symbols in identifier order', () => {
    reset(); env.positions.push(position({ id: 77, ticket: 777, symbol: 'EURUSD' }), position({ id: 66, ticket: 666, symbol: 'GBPUSD', magic: 999 }));
    env.files['journal:77'] = { valid: true, state: state({ identifier: 77 }) };
    env.files['journal:66'] = { valid: true, state: state({ identifier: 66, magic: 999 }) };
    assert.equal(context.RRNextManagedPosition('', 123, 0), 42);
    assert.equal(context.RRNextManagedPosition('', 123, 42), 77);
    assert.equal(context.RRNextManagedPosition('TEST', 123, 42), 0);
});
check('wildcard plan apply resolves actual selected symbol and preserves frozen and execution fields', () => {
    reset(state(), { positions: [position({ symbol: 'EURUSD' })] });
    const before = copy(env.files['journal:42'].state);
    assert.equal(apply(undefined, { symbol: '' }).ok, true);
    assert.ok(env.symbolReads.length > 0 && env.symbolReads.every(s => s === 'EURUSD'));
    const after = env.saved[0];
    for (const key of ['identifier', 'magic', 'opening_order', 'direction', 'entry', 'risk', 'initial_volume',
        'offset_points', 'stage', 'be_done', 'blocked', 'sequence', 'pending', 'pending_order', 'before_volume',
        'last_request', 'last_stop_request', 'be_requested']) assert.deepEqual(after[key], before[key], key);
});
check('off-chart plan edit obeys that position symbol minimum rather than current chart rules', () => {
    reset(state(), { positions: [position({ symbol: 'COARSE' })], symbolRules: {
        COARSE: { step: 0.1, minimum: 0.6, tickSize: 0.1, digits: 1, bid: 119, ask: 119.2, hasQuote: true },
    } });
    assert.equal(apply(plan([[2.5, 50, 1], [6, 50]]), { symbol: '' }).ok, false);
    assert.ok(env.symbolReads.every(s => s === 'COARSE'));
});
check('selected managed position can use its actual magic independently from the panel new-entry magic', () => {
    reset(state({ magic: 999 }), { positions: [position({ symbol: 'EURUSD', magic: 999 })] });
    assert.equal(apply(undefined, { symbol: '', magic: 999 }).ok, true);
});
check('risk and manual exits prevent plan edits before opening a writable journal', () => {
    for (const field of ['riskExits', 'manualExits']) {
        reset(); env[field].add(42); assert.equal(apply().ok, false); assert.equal(env.opens.length, 0);
    }
});
check('manual exit intent arising during journal lock acquisition prevents plan writes', () => {
    reset(); env.onOpen = () => env.manualExits.add(42);
    assert.equal(apply().ok, false); assert.equal(env.saveAttempts, 0); assert.equal(env.handles.size, 0);
});

process.stdout.write(`\n${passed} live-plan tests passed against production APIs.\n`);
process.stdout.write('Scope: in-memory MT5 boundaries; no real positions, journal files, or trading requests.\n');
