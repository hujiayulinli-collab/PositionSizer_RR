// Runs the actual RRProcess/RRResolvePending bodies against an in-memory MT5
// boundary. This validates decisions, not real journal IO or broker execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const manager = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const core = readFileSync(new URL('../mt5/RRCore.mqh', import.meta.url), 'utf8');

function extract(source, name) {
    const match = new RegExp(`(?:void|bool|double)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Missing function ${name}`);
    let depth = 1;
    const start = match.index + match[0].length;
    let end = start;
    for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    assert.equal(depth, 0);
    const parameters = match[1].split(',').filter(parameter => parameter.trim()).map(parameter => {
        const arg = /^\s*(?:const\s+)?(?:int|double|bool|ulong|long|string|RRState)\s*&?\s*(\w+)\s*$/.exec(parameter);
        assert.ok(arg, `Unsupported argument: ${parameter}`);
        return arg[1];
    });
    let body = source.slice(start, end - 1)
        .replace(/\bRRState\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bMqlTick\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bMqlTrade(?:Request|Result|CheckResult)\s+(\w+)\s*=\s*\{\}/g, 'let $1 = {}')
        .replace(/\b(?:const\s+)?(?:double|int|bool|ulong|long|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:long|double|int|ulong)\)/g, '');
    // MQL primitive output references require an explicit JS adapter. It writes
    // only the fixture's history fields; the production branch logic is intact.
    body = body.replace('RRHistory(s.identifier, opening_order, in_volume, mixed)',
        'RRHistory(s.identifier, value => { opening_order = value.opening_order; in_volume = value.in_volume; mixed = value.mixed; })');
    body = body.replace('RRHistory(id, opening_order, in_volume, mixed)',
        'RRHistory(id, value => { opening_order = value.opening_order; in_volume = value.in_volume; mixed = value.mixed; })');
    return `function ${name}(${parameters.join(', ')}) {${body}\n}`;
}

const constants = ['POSITION_VOLUME', 'POSITION_PRICE_OPEN', 'POSITION_TYPE', 'POSITION_TYPE_BUY',
    'SYMBOL_VOLUME_STEP', 'SYMBOL_VOLUME_MIN', 'SYMBOL_TRADE_TICK_SIZE', 'ORDER_COMMENT', 'ORDER_MAGIC',
    'ORDER_STATE', 'ORDER_STATE_FILLED', 'ORDER_STATE_CANCELED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED',
    'ORDER_VOLUME_INITIAL', 'ORDER_VOLUME_CURRENT', 'POSITION_SL', 'POSITION_TP', 'SYMBOL_POINT',
    'SYMBOL_DIGITS', 'SYMBOL_TRADE_STOPS_LEVEL', 'SYMBOL_TRADE_FREEZE_LEVEL', 'TRADE_ACTION_SLTP',
    'TRADE_RETCODE_DONE', 'TRADE_RETCODE_NO_CHANGES', 'POSITION_IDENTIFIER', 'POSITION_MAGIC',
    'POSITION_SYMBOL', 'ORDER_SYMBOL', 'ORDER_SL', 'FILE_READ', 'FILE_BIN', 'INVALID_HANDLE'];
let env;
const context = vm.createContext({
    RBIsChild: () => false,
    RR_MAX_TARGETS: 20,
    ...Object.fromEntries(constants.map(name => [name, name])),
    MathFloor: Math.floor, MathCeil: Math.ceil, MathAbs: Math.abs, MathMax: Math.max, MathIsValidNumber: Number.isFinite,
    NormalizeDouble: (value, digits) => Number(value.toFixed(digits)),
    PositionSelectByTicket: () => env.exists,
    PositionGetDouble: name => ({ POSITION_VOLUME: env.volume, POSITION_PRICE_OPEN: env.entry,
        POSITION_SL: env.sl, POSITION_TP: env.tp })[name],
    PositionGetInteger: property => property === 'POSITION_TYPE'
        ? (env.direction === 1 ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL')
        : property === 'POSITION_MAGIC' ? (env.selectedPosition?.magic ?? 123) : (env.selectedPosition?.id ?? 42),
    PositionGetString: () => env.selectedPosition?.symbol ?? 'TEST',
    PositionsTotal: () => env.positions.length,
    PositionGetTicket: index => {
        env.selectedPosition = env.positions[index];
        return env.selectedPosition?.ticket ?? 0;
    },
    OrdersTotal: () => env.orders.filter(order => order.active).length,
    OrderGetTicket: index => {
        env.selectedOrder = env.orders.filter(order => order.active)[index];
        return env.selectedOrder?.ticket ?? 0;
    },
    OrderGetString: () => env.selectedOrder?.symbol ?? 'TEST',
    OrderGetInteger: () => env.selectedOrder?.magic ?? 123,
    RRWasExisting: id => env.existingIDs.includes(id),
    RRFileName: id => String(id),
    FileIsExist: name => Object.hasOwn(env.journals, name),
    FileOpen: name => env.lockedJournal ? 'INVALID_HANDLE' : name,
    FileClose: handle => env.closedFiles.push(handle),
    RRLoad: (handle, output) => {
        Object.assign(output, env.journals[handle]?.state);
        return env.journals[handle]?.valid ?? false;
    },
    DoubleToString: (value, digits) => value.toFixed(digits),
    ZeroMemory: value => {
        for (const key of Object.keys(value)) delete value[key];
        Object.assign(value, { stage: 0, pending: 0, sequence: 0, be_requested: 0, be_done: 0,
            target_r: Array(20).fill(0), target_percent: Array(20).fill(0), target_be: Array(20).fill(0) });
    },
    RRActivePlan: null,
    RR_BEOffsetPoints: 0,
    SymbolInfoDouble: (_symbol, name) => ({ SYMBOL_VOLUME_STEP: env.step, SYMBOL_VOLUME_MIN: env.minimum,
        SYMBOL_TRADE_TICK_SIZE: env.tickSize, SYMBOL_POINT: env.point })[name],
    SymbolInfoInteger: (_symbol, name) => ({ SYMBOL_DIGITS: env.digits, SYMBOL_TRADE_STOPS_LEVEL: env.stopsLevel,
        SYMBOL_TRADE_FREEZE_LEVEL: env.freezeLevel })[name],
    SymbolInfoTick: (_symbol, tick) => {
        Object.assign(tick, { bid: env.bid, ask: env.ask });
        return env.hasQuote;
    },
    RRHistory: (_id, output) => {
        output({ opening_order: env.openingOrder, in_volume: env.inVolume, mixed: env.mixed });
        return env.hasHistory;
    },
    RRSave: (_handle, state) => {
        env.saveAttempts++;
        if (env.saveFails) return false;
        env.saved.push(structuredClone(state));
        return true;
    },
    RRClose: (_handle, _state, ticket, symbol, volume) => env.closes.push({ ticket, symbol, volume }),
    RRUpdateStops: (_handle, state) => env.stops.push({ stage: state.stage, risk: state.risk }),
    RRNotice: message => env.notices.push(message),
    PrintFormat: (...args) => env.notices.push(args),
    StringFormat: (...args) => args.join(' '),
    RRRequestComment: state => `RR${state.identifier}-${state.sequence}`,
    TimeLocal: () => env.now,
    HistorySelectByPosition: () => env.hasHistory,
    HistoryOrdersTotal: () => env.orders.length,
    HistoryOrderGetTicket: index => env.orders[index].ticket,
    HistoryOrderGetString: ticket => env.orders.find(order => order.ticket === ticket)?.comment ?? '',
    HistoryOrderGetInteger: (ticket, property) => {
        const order = env.orders.find(order => order.ticket === ticket);
        return property === 'ORDER_MAGIC' ? order?.magic : order?.state;
    },
    HistoryOrderGetDouble: (ticket, property) => {
        const order = env.orders.find(order => order.ticket === ticket);
        if (property === 'ORDER_SL') return order?.sl ?? 0;
        return property === 'ORDER_VOLUME_INITIAL' ? order?.initial : order?.remaining;
    },
    OrderSelect: ticket => env.orders.some(order => order.ticket === ticket && order.active),
    HistoryOrderSelect: ticket => env.orders.some(order => order.ticket === ticket && !order.active),
    RRCanTrade: () => env.canTrade,
    OrderSend: (request, result) => {
        env.sent.push(structuredClone(request));
        Object.assign(result, { retcode: env.retcode, comment: 'fixture' });
        return env.sendSuccess;
    },
});
vm.runInContext([
    extract(core, 'RRPriceR'), extract(core, 'RRPartialLots'), extract(core, 'RRTargetReached'),
    extract(core, 'RRTargetPrice'), extract(core, 'RRBETarget'), extract(core, 'RRSLProtectsBE'),
    extract(manager, 'RRStateClosesAll'), extract(manager, 'RRResolvePending'), extract(manager, 'RRProcessMulti'), extract(manager, 'RRProcess'),
    extract(manager, 'RRPlanCanEdit'), extract(manager, 'RRCapture'),
    extract(manager, 'RRUpdateStops').replace('function RRUpdateStops(', 'function RRUpdateStopsActual('),
].join('\n'), context);

function state(overrides = {}) {
    return { version: 1, identifier: 42, magic: 123, opening_order: 100, direction: 1, entry: 100, risk: 10,
        initial_volume: 1, first_r: 2, final_r: 5, percent: 50, move_be: 1, offset_points: 0,
        stage: 0, be_done: 0, blocked: 0, pending: 0, pending_order: 0, before_volume: 0,
        last_request: 0, last_stop_request: 0, sequence: 1, ...overrides };
}
function resetEnvironment(overrides = {}) {
    env = { exists: true, volume: 1, entry: 100, direction: 1, step: 0.01, minimum: 0.01,
        tickSize: 0.01, bid: 119, ask: 119.2, hasQuote: true, hasHistory: true, openingOrder: 100,
        inVolume: 1, mixed: false, saveFails: false, now: 100, orders: [], saved: [],
        closes: [], stops: [], notices: [], saveAttempts: 0, sl: 90, tp: 140, point: 0.01, digits: 2,
        stopsLevel: 0, freezeLevel: 0, canTrade: true, sent: [], sendSuccess: true,
        retcode: 'TRADE_RETCODE_DONE', positions: [], existingIDs: [], journals: {}, closedFiles: [],
        lockedJournal: false, ...overrides };
}
function run(s, overrides = {}) {
    resetEnvironment(overrides);
    context.RRProcess(7, s, 456, 'TEST');
    return env;
}
function runStops(s, overrides = {}) {
    resetEnvironment(overrides);
    context.RRUpdateStopsActual(7, s, 456, 'TEST');
    return env;
}
function filledOrder(overrides = {}) {
    return { ticket: 200, comment: 'RR42-1', magic: 123, state: 'ORDER_STATE_FILLED',
        initial: 0.5, remaining: 0, active: false, ...overrides };
}
let passed = 0;
function check(name, callback) {
    try { callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}

check('below 2R updates stops without reducing', () => {
    const s = state(); const result = run(s);
    assert.equal(s.stage, 0); assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 1);
});
check('2R intent is saved before requesting half close', () => {
    const s = state(); const result = run(s, { bid: 120, ask: 120.2 });
    assert.equal(s.stage, 1); assert.equal(result.saved[0].stage, 1);
    assert.equal(result.closes[0].volume, 0.5); assert.equal(result.stops.length, 0);
});
check('first partial fill is topped up only to the initial half', () => {
    const result = run(state({ stage: 1 }), { volume: 0.7 });
    assert.equal(result.closes.length, 1); assert.equal(result.closes[0].volume, 0.2);
});
check('confirmed half moves to BE stage and does not close twice', () => {
    const s = state({ stage: 1 }); const result = run(s, { volume: 0.5 });
    assert.equal(s.stage, 2); assert.equal(result.closes.length, 0); assert.equal(result.stops[0].stage, 2);
});
check('reload after completed partial keeps fixed risk and no second close', () => {
    const s = state({ stage: 1 }); const first = run(s, { volume: 0.5 });
    const loaded = structuredClone(first.saved.at(-1));
    const result = run(loaded, { volume: 0.5, bid: 125, ask: 125.2 });
    assert.equal(result.closes.length, 0); assert.equal(result.stops[0].risk, 10);
});
check('gap beyond 5R bypasses first-stage partial', () => {
    const s = state(); const result = run(s, { bid: 155, ask: 155.2 });
    assert.equal(s.stage, 3); assert.equal(result.closes.length, 1); assert.equal(result.closes[0].volume, 1);
});
check('latched final stage keeps attempting the remaining quantity', () => {
    const result = run(state({ stage: 3 }), { volume: 0.3, bid: 145, ask: 145.2 });
    assert.equal(result.closes[0].volume, 0.3);
});
check('sell Bid crossing 2R cannot trigger before Ask', () => {
    const s = state({ direction: -1 });
    const result = run(s, { direction: -1, bid: 79.9, ask: 80.1 });
    assert.equal(s.stage, 0); assert.equal(result.closes.length, 0);
});
check('sell Ask crossing 2R triggers first reduction', () => {
    const s = state({ direction: -1 });
    const result = run(s, { direction: -1, bid: 79.8, ask: 80 });
    assert.equal(s.stage, 1); assert.equal(result.closes[0].volume, 0.5);
});
check('unsplittable minimum lot stays before BE', () => {
    const s = state({ initial_volume: 0.01 });
    const result = run(s, { volume: 0.01, inVolume: 0.01, bid: 120, ask: 120.2 });
    assert.equal(s.stage, 1); assert.equal(result.closes.length, 0); assert.equal(result.stops[0].stage, 1);
});
check('unsplittable minimum lot can still exit at final target', () => {
    const result = run(state({ stage: 1, initial_volume: 0.01 }),
        { volume: 0.01, inVolume: 0.01, bid: 150, ask: 150.2 });
    assert.equal(result.closes[0].volume, 0.01);
});
check('persistence failure before first trigger prevents close', () => {
    const result = run(state(), { bid: 120, ask: 120.2, saveFails: true });
    assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 0);
});
check('persistence failure before final trigger prevents close', () => {
    const result = run(state(), { bid: 150, ask: 150.2, saveFails: true });
    assert.equal(result.closes.length, 0);
});
check('unknown pending result prevents both repeated close and BE', () => {
    const result = run(state({ stage: 1, pending: 1, before_volume: 1 }), { volume: 0.5 });
    assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 0);
});
check('active close order is not counted as completed', () => {
    const result = run(state({ stage: 1, pending: 1, pending_order: 200, before_volume: 1 }),
        { volume: 0.5, orders: [filledOrder({ active: true })] });
    assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 0);
});
check('filled order still waits for position volume confirmation', () => {
    const s = state({ stage: 1, pending: 1, pending_order: 200, before_volume: 1 });
    const result = run(s, { volume: 1, orders: [filledOrder()] });
    assert.equal(s.pending, 1); assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 0);
});
check('filled order plus reduced volume clears pending and sets BE stage', () => {
    const s = state({ stage: 1, pending: 1, pending_order: 200, before_volume: 1 });
    const result = run(s, { volume: 0.5, orders: [filledOrder()] });
    assert.equal(s.pending, 0); assert.equal(s.stage, 2); assert.equal(result.closes.length, 0);
    assert.equal(result.stops[0].stage, 2);
});
check('missing result order ticket recovers exact comment and magic', () => {
    const s = state({ stage: 1, pending: 1, before_volume: 1 });
    const result = run(s, { volume: 0.5, orders: [filledOrder()] });
    assert.equal(s.pending, 0); assert.equal(s.stage, 2); assert.equal(result.closes.length, 0);
});
check('different magic cannot clear an ambiguous pending intent', () => {
    const s = state({ stage: 1, pending: 1, before_volume: 1 });
    const result = run(s, { volume: 0.5, orders: [filledOrder({ magic: 999 })] });
    assert.equal(s.pending, 1); assert.equal(result.stops.length, 0);
});
check('cancelled IOC order accounts for filled portion then tops up', () => {
    const s = state({ stage: 1, pending: 1, pending_order: 200, before_volume: 1 });
    const result = run(s, { volume: 0.8, orders: [filledOrder({ state: 'ORDER_STATE_CANCELED', remaining: 0.3 })] });
    assert.equal(s.pending, 0); assert.equal(result.closes[0].volume, 0.3);
});
check('extra opening deal freezes netting plan even after volume returns', () => {
    const s = state(); const result = run(s, { volume: 1, inVolume: 1.5, mixed: true });
    assert.equal(s.blocked, 1); assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 0);
});
check('direction reversal freezes old state', () => {
    const s = state(); const result = run(s, { direction: -1 });
    assert.equal(s.blocked, 1); assert.equal(result.closes.length, 0);
});
check('changed entry freezes old risk', () => {
    const s = state(); const result = run(s, { entry: 101 });
    assert.equal(s.blocked, 1); assert.equal(result.stops.length, 0);
});
check('already blocked state never modifies or closes', () => {
    const result = run(state({ blocked: 1 }), { bid: 150, ask: 150.2 });
    assert.equal(result.saveAttempts, 0); assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 0);
});

check('stage zero installs fixed final TP while preserving initial SL', () => {
    const result = runStops(state());
    assert.equal(result.sent[0].sl, 90); assert.equal(result.sent[0].tp, 150);
    assert.equal(result.sent[0].position, 456);
});
check('stage one cannot apply BE before reduction confirmed', () => {
    const result = runStops(state({ stage: 1 }));
    assert.equal(result.sent[0].sl, 90);
});
check('stage two applies buy BE and final TP', () => {
    const result = runStops(state({ stage: 2 }), { volume: 0.5 });
    assert.equal(result.sent[0].sl, 100); assert.equal(result.sent[0].tp, 150);
});
check('stage two applies sell BE and final TP', () => {
    const result = runStops(state({ stage: 2, direction: -1 }),
        { direction: -1, sl: 110, tp: 60, bid: 79.8, ask: 80 });
    assert.equal(result.sent[0].sl, 100); assert.equal(result.sent[0].tp, 50);
});
check('existing more profitable stop is not weakened', () => {
    const result = runStops(state({ stage: 2 }), { sl: 105 });
    assert.equal(result.sent[0].sl, 105); assert.equal(result.sent[0].tp, 150);
});
check('BE offset uses points and rounds outward to tick', () => {
    const result = runStops(state({ stage: 2, offset_points: 5 }), { tickSize: 0.25 });
    assert.equal(result.sent[0].sl, 100.25);
});
check('freeze restriction defers BE without altering initial SL', () => {
    const result = runStops(state({ stage: 2 }), { freezeLevel: 2000 });
    assert.equal(result.sent[0].sl, 90); assert.equal(result.sent[0].tp, 150);
});
check('stop modification save failure sends no request', () => {
    const result = runStops(state({ stage: 2 }), { saveFails: true });
    assert.equal(result.sent.length, 0);
});
check('already correct SL and TP create neither request nor journal write', () => {
    const result = runStops(state({ stage: 2 }), { sl: 100, tp: 150 });
    assert.equal(result.sent.length, 0); assert.equal(result.saveAttempts, 0);
});
check('failed BE retry is throttled and never submits a close', () => {
    const s = state({ stage: 2 });
    const result = runStops(s, { sendSuccess: false, retcode: 'TRADE_RETCODE_INVALID_STOPS' });
    assert.equal(result.sent.length, 1);
    env.now += 2;
    context.RRUpdateStopsActual(7, s, 456, 'TEST');
    assert.equal(result.sent.length, 1);
    env.now += 1;
    context.RRUpdateStopsActual(7, s, 456, 'TEST');
    assert.equal(result.sent.length, 2); assert.equal(result.closes.length, 0);
});

function multiState(overrides = {}) {
    return state({ version: 2, target_count: 4, target_r: [1, 2, 3, 5],
        target_percent: [0, 25, 25, 50], target_be: [1, 0, 1, 0],
        stage: 0, be_requested: 0, ...overrides });
}

check('multi zero-percent BE target is latched without reducing volume', () => {
    const s = multiState(); const result = run(s, { bid: 110, ask: 110.2 });
    assert.equal(s.stage, 1); assert.equal(s.be_requested, 1);
    assert.equal(result.saved[0].be_requested, 1); assert.equal(result.closes.length, 0);
    assert.equal(result.stops.length, 1);
});
check('multi target percent is measured against initial volume', () => {
    const s = multiState(); const result = run(s, { bid: 120, ask: 120.2 });
    assert.equal(s.stage, 2); assert.equal(result.closes[0].volume, 0.25);
});
check('multi gap accumulates crossed targets into one reduction', () => {
    const s = multiState(); const result = run(s, { bid: 135, ask: 135.2 });
    assert.equal(s.stage, 3); assert.equal(s.be_requested, 1);
    assert.equal(result.closes.length, 1); assert.equal(result.closes[0].volume, 0.5);
});
check('multi gap to final closes entire remainder', () => {
    const s = multiState(); const result = run(s, { bid: 155, ask: 155.2, volume: 0.75 });
    assert.equal(s.stage, 4); assert.equal(result.closes[0].volume, 0.75);
});
check('multi later target accounts for already completed prior reductions', () => {
    const s = multiState({ stage: 2, be_requested: 1 });
    const result = run(s, { bid: 130, ask: 130.2, volume: 0.75 });
    assert.equal(result.closes[0].volume, 0.25);
});
check('multi repeated tick after completed reduction does not close twice', () => {
    const result = run(multiState({ stage: 3, be_requested: 1 }),
        { bid: 135, ask: 135.2, volume: 0.5 });
    assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 1);
});
check('multi rounded cumulative targets prevent repeated per-node rounding loss', () => {
    const s = multiState({ initial_volume: 0.1, target_count: 3,
        target_r: [1, 2, 5], target_percent: [33, 33, 34], target_be: [0, 0, 0] });
    const result = run(s, { bid: 125, ask: 125.2, inVolume: 0.1, volume: 0.07 });
    assert.equal(result.closes[0].volume, 0.03);
});
check('multi 34/33/33 of 0.03 lots closes 0.01 at each cumulative target', () => {
    const s = multiState({ initial_volume: 0.03, target_count: 3,
        target_r: [1, 2, 5], target_percent: [34, 33, 33], target_be: [0, 0, 0] });
    assert.equal(run(s, { bid: 110, ask: 110.2, inVolume: 0.03, volume: 0.03 }).closes[0].volume, 0.01);
    assert.equal(run(s, { bid: 120, ask: 120.2, inVolume: 0.03, volume: 0.02 }).closes[0].volume, 0.01);
    assert.equal(run(s, { bid: 150, ask: 150.2, inVolume: 0.03, volume: 0.01 }).closes[0].volume, 0.01);
});
check('multi manual partial reduction counts toward cumulative goal', () => {
    const result = run(multiState(), { bid: 135, ask: 135.2, volume: 0.4 });
    assert.equal(result.closes.length, 0);
});
check('multi BE trigger and reduction target survive a retracement', () => {
    const s = multiState(); const first = run(s, { bid: 130, ask: 130.2 });
    const loaded = structuredClone(first.saved.at(-1));
    const result = run(loaded, { bid: 115, ask: 115.2, volume: 0.8 });
    assert.equal(loaded.stage, 3); assert.equal(loaded.be_requested, 1);
    assert.equal(result.closes[0].volume, 0.3);
});
check('multi pending reduction does not swallow later BE trigger', () => {
    const s = multiState({ stage: 2, be_requested: 0, target_be: [0, 0, 1, 0],
        pending: 1, pending_order: 200, before_volume: 1 });
    const result = run(s, { bid: 130, ask: 130.2, orders: [filledOrder({ active: true })] });
    assert.equal(s.stage, 3); assert.equal(s.be_requested, 1);
    assert.equal(result.saved[0].be_requested, 1); assert.equal(result.stops.length, 1);
    assert.equal(result.closes.length, 0);
});
check('multi pending reduction does not swallow final target before retracement', () => {
    const s = multiState({ stage: 2, pending: 1, pending_order: 200, before_volume: 1 });
    const first = run(s, { bid: 155, ask: 155.2, orders: [filledOrder({ active: true })] });
    assert.equal(s.stage, 4); assert.equal(first.closes.length, 0);
    const result = run(s, { bid: 115, ask: 115.2, volume: 0.5, orders: [filledOrder()] });
    assert.equal(s.pending, 0); assert.equal(result.closes[0].volume, 0.5);
});
check('multi unknown request remains pending while stops can advance', () => {
    const s = multiState({ pending: 1, before_volume: 1 });
    const result = run(s, { bid: 130, ask: 130.2, volume: 0.75 });
    assert.equal(s.pending, 1); assert.equal(s.stage, 3);
    assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 1);
});
check('multi partial IOC fill tops up only cumulative amount still needed', () => {
    const s = multiState({ stage: 3, pending: 1, pending_order: 200, before_volume: 1 });
    const result = run(s, { bid: 135, ask: 135.2, volume: 0.8,
        orders: [filledOrder({ state: 'ORDER_STATE_CANCELED', remaining: 0.3 })] });
    assert.equal(s.pending, 0); assert.equal(result.closes[0].volume, 0.3);
});
check('multi trigger save failure prevents BE request and close', () => {
    const result = run(multiState(), { bid: 130, ask: 130.2, saveFails: true });
    assert.equal(result.stops.length, 0); assert.equal(result.closes.length, 0);
});
check('multi untradeable partial volume still activates selected BE', () => {
    const s = multiState({ initial_volume: 0.01 });
    const result = run(s, { bid: 130, ask: 130.2, volume: 0.01, inVolume: 0.01 });
    assert.equal(s.be_requested, 1); assert.equal(result.closes.length, 0);
    assert.equal(result.stops.length, 1);
});
check('multi one-target plan closes all volume at its target', () => {
    const s = multiState({ target_count: 1, target_r: [3], target_percent: [100],
        target_be: [0], final_r: 3 });
    const result = run(s, { bid: 130, ask: 130.2 });
    assert.equal(result.closes[0].volume, 1);
});
check('multi twenty targets are processed in one gap safely', () => {
    const s = multiState({ target_count: 20, target_r: Array.from({ length: 20 }, (_, i) => i + 1),
        target_percent: Array(20).fill(5), target_be: Array.from({ length: 20 }, (_, i) => i === 17 ? 1 : 0),
        final_r: 20 });
    const result = run(s, { bid: 290, ask: 290.2 });
    assert.equal(s.stage, 19); assert.equal(s.be_requested, 1); assert.equal(result.closes[0].volume, 0.95);
});
check('multi sell target uses Ask and does not fire early', () => {
    const s = multiState({ direction: -1 });
    const result = run(s, { direction: -1, bid: 79.8, ask: 80.1 });
    assert.equal(s.stage, 1); assert.equal(result.closes.length, 0);
});
check('multi sell targets accumulate when Ask crosses threshold', () => {
    const s = multiState({ direction: -1 });
    const result = run(s, { direction: -1, bid: 69.8, ask: 70 });
    assert.equal(s.stage, 3); assert.equal(result.closes[0].volume, 0.5);
});
check('multi opening additions block both closes and BE changes', () => {
    const s = multiState(); const result = run(s, { bid: 155, ask: 155.2, inVolume: 1.5, mixed: true });
    assert.equal(s.blocked, 1); assert.equal(result.stops.length, 0); assert.equal(result.closes.length, 0);
});
check('multi stage alone does not set BE when no selected target was hit', () => {
    const result = runStops(multiState({ stage: 3, be_requested: 0 }));
    assert.equal(result.sent[0].sl, 90);
});
check('multi zero-percent first target applies BE before any reduction', () => {
    const result = runStops(multiState({ stage: 1, be_requested: 1 }));
    assert.equal(result.sent[0].sl, 100);
});
check('multi BE with a pending close still applies stop independently', () => {
    const result = runStops(multiState({ stage: 3, be_requested: 1, pending: 1 }));
    assert.equal(result.sent[0].sl, 100); assert.equal(result.closes.length, 0);
});
check('multi BE protection never weakens a better existing stop', () => {
    const result = runStops(multiState({ be_requested: 1 }), { sl: 110 });
    assert.equal(result.sent[0].sl, 110);
});
check('multi BE blocked by freeze distance retries after price recovers', () => {
    const s = multiState({ stage: 1, be_requested: 1 });
    const first = runStops(s, { bid: 100.1, ask: 100.3, freezeLevel: 20 });
    assert.equal(first.sent[0].sl, 90);
    const result = runStops(s, { bid: 110, ask: 110.2, now: 104 });
    assert.equal(result.sent[0].sl, 100);
});

function runCanEdit(overrides = {}) {
    resetEnvironment(overrides);
    return context.RRPlanCanEdit('TEST', 123, '');
}
const activeOrder = { ticket: 100, symbol: 'TEST', magic: 123, active: true };
const newPosition = { ticket: 456, symbol: 'TEST', magic: 123, id: 42 };
check('plan edit is allowed when no same-strategy order or new position exists', () => {
    assert.equal(runCanEdit(), true);
});
check('plan edit is blocked while same-strategy pending order exists', () => {
    assert.equal(runCanEdit({ orders: [activeOrder] }), false);
});
check('plan edit ignores pending orders belonging to another strategy', () => {
    assert.equal(runCanEdit({ orders: [{ ...activeOrder, magic: 999 }] }), true);
    assert.equal(runCanEdit({ orders: [{ ...activeOrder, symbol: 'OTHER' }] }), true);
});
check('plan edit is blocked between a new fill and its first saved capture', () => {
    assert.equal(runCanEdit({ positions: [newPosition] }), false);
});
check('plan edit ignores historical positions that were never adopted', () => {
    assert.equal(runCanEdit({ positions: [newPosition], existingIDs: [42] }), true);
});
check('plan edit is allowed after new position has a valid frozen journal', () => {
    assert.equal(runCanEdit({ positions: [newPosition], journals: {
        42: { valid: true, state: state({ version: 2 }) },
    } }), true);
    assert.deepEqual(env.closedFiles, ['42']);
});
check('plan edit is blocked for incomplete journal even if position existed at startup', () => {
    assert.equal(runCanEdit({ positions: [newPosition], existingIDs: [42], journals: {
        42: { valid: false, state: state() },
    } }), false);
    assert.deepEqual(env.closedFiles, ['42']);
});
check('plan edit is blocked for locked journal or mismatching recorded magic', () => {
    assert.equal(runCanEdit({ positions: [newPosition], lockedJournal: true, journals: {
        42: { valid: true, state: state() },
    } }), false);
    assert.equal(runCanEdit({ positions: [newPosition], journals: {
        42: { valid: true, state: state({ magic: 999 }) },
    } }), false);
});
check('plan edit ignores positions outside symbol and magic scope', () => {
    assert.equal(runCanEdit({ positions: [{ ...newPosition, magic: 999 }] }), true);
    assert.equal(runCanEdit({ positions: [{ ...newPosition, symbol: 'OTHER' }] }), true);
});

function capture(overrides = {}) {
    resetEnvironment({ orders: [{ ticket: 100, sl: 90, active: false }], ...overrides });
    context.RRActivePlan = { count: 3, targets: [
        { multiple: 1, percent: 0, move_be: 1 },
        { multiple: 2.5, percent: 40, move_be: 0 },
        { multiple: 6, percent: 60, move_be: 1 },
    ] };
    const s = {};
    return { ok: context.RRCapture(456, s), s };
}
check('new capture freezes complete target list and actual initial risk', () => {
    const { ok, s } = capture();
    assert.equal(ok, true); assert.equal(s.version, 2); assert.equal(s.target_count, 3);
    assert.equal(s.entry, 100); assert.equal(s.risk, 10); assert.equal(s.initial_volume, 1);
    assert.deepEqual(s.target_r.slice(0, 3), [1, 2.5, 6]);
    assert.deepEqual(s.target_percent.slice(0, 3), [0, 40, 60]);
    assert.deepEqual(s.target_be.slice(0, 3), [1, 0, 1]);
    assert.equal(s.final_r, 6); assert.equal(s.stage, 0); assert.equal(s.be_requested, 0);
});
check('editing active plan cannot change already captured position plan', () => {
    const { s } = capture();
    context.RRActivePlan.targets[1].multiple = 8;
    context.RRActivePlan.targets[1].percent = 70;
    context.RRActivePlan.targets[0].move_be = 0;
    assert.equal(s.target_r[1], 2.5); assert.equal(s.target_percent[1], 40); assert.equal(s.target_be[0], 1);
});
check('capture refuses arbitrary historical positions and incomplete opening fills', () => {
    assert.equal(capture({ existingIDs: [42] }).ok, false);
    assert.equal(capture({ orders: [{ ticket: 100, sl: 90, active: true }] }).ok, false);
});
check('capture uses new-position initial stop only when history order has none', () => {
    const { ok, s } = capture({ orders: [{ ticket: 100, sl: 0, active: false }], sl: 92 });
    assert.equal(ok, true); assert.equal(s.risk, 8);
});
check('capture refuses positions without a protective initial stop', () => {
    assert.equal(capture({ orders: [{ ticket: 100, sl: 0, active: false }], sl: 0 }).ok, false);
    assert.equal(capture({ orders: [{ ticket: 100, sl: 101, active: false }] }).ok, false);
});

for (const version of [1, 2]) {
    const exactState = () => state({ version, direction: -1, entry: 4341.74, risk: 7.680000000000291,
        initial_volume: 0.32, target_count: 2, target_r: [2, 5], target_percent: [50, 50], target_be: [1, 0], be_requested: 0 });
    const exactQuote = { direction: -1, entry: 4341.74, inVolume: 0.32, volume: 0.32, bid: 4326.36, ask: 4326.38 };
    check(`v${version} exact XAU 2R price latches and reduces 0.16 without an extra tick`, () => {
        const s = exactState(); const result = run(s, exactQuote);
        assert.equal(s.stage, 1); assert.equal(result.closes[0].volume, 0.16);
        if (version === 2) assert.equal(s.be_requested, 1);
    });
    check(`v${version} XAU one tick before 2R does not reduce`, () => {
        const s = exactState(); const result = run(s, { ...exactQuote, bid: 4326.37, ask: 4326.39 });
        assert.equal(s.stage, 0); assert.equal(result.closes.length, 0);
    });
    check(`v${version} exact XAU 5R price closes all remaining volume`, () => {
        const s = exactState(); const result = run(s, { ...exactQuote, volume: 0.16, bid: 4303.32, ask: 4303.34 });
        assert.equal(s.stage, version === 1 ? 3 : 2); assert.equal(result.closes[0].volume, 0.16);
    });
}

check('edited future plan executes new target and retains initial-volume basis', () => {
    const s = multiState({ stage: 1, initial_volume: 1, target_count: 3,
        target_r: [2, 4, 6], target_percent: [50, 20, 30], target_be: [1, 0, 0], be_requested: 1, final_r: 6 });
    const result = run(s, { bid: 140, ask: 140.2, volume: 0.5 });
    assert.equal(s.stage, 2); assert.equal(result.closes[0].volume, 0.2); assert.equal(s.risk, 10);
});
check('edited final TP synchronizes through existing stop flow and preserves SL', () => {
    const result = runStops(multiState({ final_r: 6, stage: 1, be_requested: 1 }), { sl: 102, tp: 150 });
    assert.equal(result.sent[0].tp, 160); assert.equal(result.sent[0].sl, 102);
});

function runner(overrides = {}) {
    return multiState({ target_count: 2, target_r: [2, 5], target_percent: [30, 20], target_be: [1, 0],
        first_r: 2, final_r: 5, percent: 30, ...overrides });
}
check('runner last target closes only allocated cumulative share', () => {
    const s = runner(); const result = run(s, { bid: 155, ask: 155.2 });
    assert.equal(s.stage, 2); assert.equal(result.closes[0].volume, 0.5); assert.equal(s.be_requested, 1);
});
check('runner single 50 percent target does not close the entire position', () => {
    const s = runner({ target_count: 1, target_r: [2], target_percent: [50], target_be: [1], final_r: 2 });
    const result = run(s, { bid: 120, ask: 120.2 });
    assert.equal(s.stage, 1); assert.equal(result.closes[0].volume, 0.5);
});
check('completed runner remains open on repeated ticks and beyond last target', () => {
    const s = runner({ stage: 2, be_requested: 1 });
    for (const bid of [160, 200, 110]) {
        const result = run(s, { bid, ask: bid + 0.2, volume: 0.5 });
        assert.equal(result.closes.length, 0); assert.equal(result.stops.length, 1);
    }
});
check('runner last target tops up only cumulative quantity after earlier and manual reductions', () => {
    const s = runner({ stage: 1, be_requested: 1 });
    const result = run(s, { bid: 150, ask: 150.2, volume: 0.6 });
    assert.equal(result.closes[0].volume, 0.1); assert.equal(s.stage, 2);
});
check('runner already manually reduced beyond plan never reduces again', () => {
    const result = run(runner({ stage: 2, be_requested: 1 }), { bid: 180, ask: 180.2, volume: 0.4 });
    assert.equal(result.closes.length, 0);
});
check('runner fractional final percentage rounds down and leaves one lot step', () => {
    const s = runner({ initial_volume: 0.03, target_percent: [34, 33], stage: 1, be_requested: 1 });
    const result = run(s, { bid: 150, ask: 150.2, volume: 0.02, inVolume: 0.03 });
    assert.equal(result.closes[0].volume, 0.01);
});
check('all-zero BE-only runner never submits a close even after every target', () => {
    const s = runner({ target_percent: [0, 0], target_be: [1, 1] });
    const result = run(s, { bid: 180, ask: 180.2 });
    assert.equal(s.stage, 2); assert.equal(s.be_requested, 1); assert.equal(result.closes.length, 0);
});
check('runner final BE-only node keeps the earlier cumulative close goal', () => {
    const s = runner({ target_percent: [50, 0], target_be: [0, 1], stage: 1 });
    const result = run(s, { bid: 150, ask: 150.2, volume: 0.5 });
    assert.equal(s.be_requested, 1); assert.equal(s.stage, 2); assert.equal(result.closes.length, 0);
});
check('runner pending close confirms without turning last target into a full exit', () => {
    const s = runner({ stage: 2, be_requested: 1, pending: 1, pending_order: 200, before_volume: 1 });
    const result = run(s, { volume: 0.5, bid: 160, ask: 160.2, orders: [filledOrder()] });
    assert.equal(s.pending, 0); assert.equal(result.closes.length, 0);
});
check('runner removes old full-exit server TP while retaining initial SL', () => {
    const result = runStops(runner(), { sl: 90, tp: 150 });
    assert.equal(result.sent[0].tp, 0); assert.equal(result.sent[0].sl, 90);
});
check('runner TP clearing can accompany BE without loosening an existing better SL', () => {
    const result = runStops(runner({ stage: 2, be_requested: 1 }), { sl: 102, tp: 150, bid: 160, ask: 160.2 });
    assert.equal(result.sent[0].tp, 0); assert.equal(result.sent[0].sl, 102);
});
check('runner TP clearing is not blocked by target distance or opposite side math', () => {
    const result = runStops(runner({ direction: -1 }), { direction: -1, sl: 110, tp: 50,
        bid: 50.1, ask: 50.3, stopsLevel: 500, freezeLevel: 500 });
    assert.equal(result.sent[0].tp, 0); assert.equal(result.sent[0].sl, 110);
});
check('runner no-TP state does not repeatedly write or send while BE already protected', () => {
    const result = runStops(runner({ stage: 2, be_requested: 1 }), { sl: 100, tp: 0 });
    assert.equal(result.sent.length, 0); assert.equal(result.saveAttempts, 0);
});
check('runner clearing failure remains retryable and is throttled', () => {
    const s = runner();
    const first = runStops(s, { sl: 90, tp: 150, retcode: 'TRADE_RETCODE_REJECT', sendSuccess: false, now: 100 });
    assert.equal(first.sent[0].tp, 0); assert.equal(s.last_stop_request, 100);
    assert.equal(runStops(s, { sl: 90, tp: 150, now: 101 }).sent.length, 0);
    assert.equal(runStops(s, { sl: 90, tp: 150, now: 104 }).sent[0].tp, 0);
});
check('runner TP clear waits for trading permission and persistent intent', () => {
    assert.equal(runStops(runner(), { canTrade: false, tp: 150 }).sent.length, 0);
    assert.equal(runStops(runner(), { saveFails: true, tp: 150 }).sent.length, 0);
});
check('legacy remains a full-exit plan regardless of absent v2 percentage arrays', () => {
    assert.equal(context.RRStateClosesAll(state()), true);
    const result = runStops(state(), { tp: 0 }); assert.equal(result.sent[0].tp, 150);
});
check('previously valid near-100 v2 plan still closes the exact remainder', () => {
    const s = runner({ target_percent: [30, 69.99999995] });
    assert.equal(context.RRStateClosesAll(s), true);
    assert.equal(run(s, { bid: 150, ask: 150.2, volume: 0.65 }).closes[0].volume, 0.65);
});

// Whole-account fixture: real capture, target decisions, stop updates and close
// request builders; only MT5/account/file/broker boundaries are substituted.
function multiSymbolFixture() {
    const b = { account: 11, server: 'Demo', now: 100, tick: 1000, reason: 0,
        positions: [], journals: new Map(), handles: new Map(), nextHandle: 1, sends: [], saves: [],
        symbolReads: [], manual: new Set(), risk: new Set(), orders: [], afterOpen: null };
    const symbols = {
        XAUUSD: { step: 0.1, minimum: 0.1, maximum: 5, tickSize: 0.1, point: 0.01, digits: 2, bid: 2020, ask: 2020.1, fill: 1 },
        EURUSD: { step: 0.01, minimum: 0.01, maximum: 1, tickSize: 0.00001, point: 0.00001, digits: 5, bid: 1.0799, ask: 1.08, fill: 2 },
    };
    const extraConstants = ['ACCOUNT_LOGIN', 'ACCOUNT_SERVER', 'SYMBOL_VOLUME_MAX', 'TRADE_ACTION_DEAL',
        'ORDER_TYPE_SELL', 'ORDER_TYPE_BUY', 'SYMBOL_FILLING_MODE', 'SYMBOL_TRADE_EXEMODE',
        'SYMBOL_TRADE_EXECUTION_INSTANT', 'SYMBOL_TRADE_EXECUTION_REQUEST', 'ORDER_FILLING_FOK', 'ORDER_FILLING_IOC', 'DEAL_ORDER'];
    const c = vm.createContext({
        ...Object.fromEntries([...constants, ...extraConstants].map(name => [name, name])),
        FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, INVALID_HANDLE: -1, SYMBOL_FILLING_FOK: 1, SYMBOL_FILLING_IOC: 2,
        RR_MAX_TARGETS: 20, RR_Enable: true, RR_BEOffsetPoints: 0, RR_DeviationPoints: 20,
        RR_FirstTarget: 2, RR_ClosePercent: 50, RR_FinalTarget: 5, RR_MoveToBE: true,
        RBIsChild: id => b.batchChildren?.has(id) || false,
        RRAccount: 11, RRServer: 'Demo', RRLastRun: 0, RRExistingIDs: [], RRHasSnapshot: true, REASON_CHARTCHANGE: 3,
        RRActivePlan: { count: 2, targets: [{ multiple: 2, percent: 50, move_be: 1 }, { multiple: 5, percent: 50, move_be: 0 }] },
        AccountInfoInteger: () => b.account, AccountInfoString: () => b.server,
        TimeLocal: () => b.now, GetTickCount64: () => b.tick, UninitializeReason: () => b.reason,
        ArrayResize: (array, length) => { array.length = length; }, ArraySize: array => array.length,
        MathFloor: Math.floor, MathCeil: Math.ceil, MathAbs: Math.abs, MathMax: Math.max, MathMin: Math.min,
        MathIsValidNumber: Number.isFinite, NormalizeDouble: (v, d) => Number(v.toFixed(d)),
        DoubleToString: (v, d) => v.toFixed(d), StringFormat: (...args) => args.join(' '), PrintFormat: () => {}, Print: () => {},
        RRPlanInitialize: () => true, RRPlanTotalPercent: () => 100, RRPlanFinalR: () => 5, RRPlanClosesAll: () => true,
        PositionsTotal: () => b.positions.length,
        PositionGetTicket: index => { b.selected = b.positions[index]; return b.selected?.ticket ?? 0; },
        PositionSelectByTicket: ticket => Boolean(b.selected = b.positions.find(p => p.ticket === ticket)),
        PositionGetString: () => b.selected?.symbol,
        PositionGetInteger: key => ({ POSITION_IDENTIFIER: b.selected?.id, POSITION_MAGIC: b.selected?.magic,
            POSITION_TYPE: b.selected?.direction === 1 ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL' })[key],
        PositionGetDouble: key => ({ POSITION_VOLUME: b.selected?.volume, POSITION_PRICE_OPEN: b.selected?.entry,
            POSITION_SL: b.selected?.sl, POSITION_TP: b.selected?.tp })[key],
        SymbolInfoDouble: (symbol, key) => {
            b.symbolReads.push({ symbol, key }); assert.ok(symbols[symbol], `actual symbol required, got ${symbol}`);
            const p = symbols[symbol]; return ({ SYMBOL_VOLUME_STEP: p.step, SYMBOL_VOLUME_MIN: p.minimum,
                SYMBOL_VOLUME_MAX: p.maximum, SYMBOL_TRADE_TICK_SIZE: p.tickSize, SYMBOL_POINT: p.point })[key];
        },
        SymbolInfoInteger: (symbol, key) => {
            const p = symbols[symbol]; assert.ok(p, `actual symbol required, got ${symbol}`);
            return ({ SYMBOL_DIGITS: p.digits, SYMBOL_FILLING_MODE: p.fill, SYMBOL_TRADE_EXEMODE: 'market',
                SYMBOL_TRADE_STOPS_LEVEL: 0, SYMBOL_TRADE_FREEZE_LEVEL: 0 })[key];
        },
        SymbolInfoTick: (symbol, tick) => { const p = symbols[symbol]; Object.assign(tick, { bid: p.bid, ask: p.ask }); return p.quoteOK !== false; },
        RRHistory: (id, set) => { const p = b.positions.find(p => p.id === id);
            if (!p || p.historyOK === false) return false;
            set({ opening_order: p.id + 10000, in_volume: p.initial ?? p.volume, mixed: false }); return true; },
        OrderSelect: () => false, HistoryOrderSelect: () => true,
        HistoryOrderGetDouble: (order, key) => key === 'ORDER_SL' ? b.positions.find(p => p.id + 10000 === order)?.sl : 0,
        RRFileName: id => `${b.server}/${b.account}/${id}`,
        FileIsExist: name => b.journals.has(name),
        FileOpen: name => { const h = b.nextHandle++; b.handles.set(h, name);
            if (!b.journals.has(name)) b.journals.set(name, null);
            b.afterOpen?.(name); return h; },
        FileSize: h => b.journals.get(b.handles.get(h)) ? 1 : 0,
        FileClose: h => b.handles.delete(h),
        RRSave: (h, s) => { b.journals.set(b.handles.get(h), structuredClone(s)); b.saves.push(structuredClone(s)); return true; },
        RRLoad: (h, s) => { const stored = b.journals.get(b.handles.get(h)); if (!stored) return false; Object.assign(s, structuredClone(stored)); return true; },
        ZeroMemory: value => { for (const key of Object.keys(value)) delete value[key]; Object.assign(value, {
            stage: 0, pending: 0, pending_order: 0, sequence: 0, be_requested: 0, be_done: 0, last_request: 0, last_stop_request: 0,
            target_r: Array(20).fill(0), target_percent: Array(20).fill(0), target_be: Array(20).fill(0) }); },
        RGPositionExitLatched: id => b.risk.has(id), RMPositionExitActive: id => b.manual.has(id),
        RRCanTrade: () => true, RRDefiniteReject: () => false,
        RRResolvePending: (_h, s) => s.pending === 0,
        RRRequestComment: s => `RR${s.identifier}-${s.sequence}`, RRNotice: () => {},
        OrderCheck: () => true,
        OrderSend: (request, result) => {
            b.sends.push(structuredClone(request)); Object.assign(result, { order: 99999, deal: 0, retcode: 'TRADE_RETCODE_DONE' }); return true;
        },
    });
    for (const name of ['RRTargetPrice', 'RRTargetReached', 'RRPartialLots', 'RRBETarget', 'RRSLProtectsBE']) vm.runInContext(extract(core, name), c);
    for (const name of ['RRSnapshotExisting', 'RRWasExisting', 'RRValidateInputs', 'RRCapture', 'RRStateClosesAll',
        'RRClose', 'RRUpdateStops', 'RRProcessMulti', 'RRProcess', 'RRSwitchCanSnapshot', 'RRManage']) vm.runInContext(extract(manager, name), c);
    const add = (id, symbol = 'XAUUSD', overrides = {}) => {
        const p = { id, ticket: id + 100, symbol, magic: 123, direction: symbol === 'XAUUSD' ? 1 : -1,
            entry: symbol === 'XAUUSD' ? 2000 : 1.1, sl: symbol === 'XAUUSD' ? 1990 : 1.11,
            volume: symbol === 'XAUUSD' ? 1 : 0.03, tp: 0, ...overrides };
        b.positions.push(p); return p;
    };
    return { b, c, symbols, add, deals: () => b.sends.filter(r => r.action === 'TRADE_ACTION_DEAL') };
}
check('global manager uses each actual symbol for frozen risk, close price, lot step, fill policy and BE', () => {
    const f = multiSymbolFixture(); f.add(1); f.add(2, 'EURUSD'); f.add(3, 'EURUSD', { magic: 999 });
    f.c.RRManage('', 123);
    const requests = f.deals().sort((a, b) => a.position - b.position);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(r => [r.symbol, r.volume, r.price, r.type_filling]), [
        ['XAUUSD', 0.5, 2020, 'ORDER_FILLING_FOK'], ['EURUSD', 0.01, 1.08, 'ORDER_FILLING_IOC']]);
    const gold = f.b.journals.get(f.c.RRFileName(1)), eur = f.b.journals.get(f.c.RRFileName(2));
    assert.equal(gold.entry, 2000); assert.equal(gold.risk, 10); assert.equal(eur.entry, 1.1);
    assert.ok(Math.abs(eur.risk - 0.01) < 1e-10);
    assert.deepEqual(f.b.sends.filter(r => r.action === 'TRADE_ACTION_SLTP').map(r => [r.symbol, r.sl, r.tp]).sort(),
        [['EURUSD', 1.1, 1.05], ['XAUUSD', 2000, 2050]]);
    assert.equal(f.b.journals.has(f.c.RRFileName(3)), false); assert.equal(f.b.handles.size, 0);
});
check('nonempty selector retains symbol filtering in the global-capable manager', () => {
    const f = multiSymbolFixture(); f.add(1); f.add(2, 'EURUSD'); f.c.RRManage('EURUSD', 123);
    assert.deepEqual(f.deals().map(r => r.symbol), ['EURUSD']); assert.equal(f.b.journals.size, 1);
});
check('off-chart missing quotes skip that symbol while another symbol still reaches its target', () => {
    const f = multiSymbolFixture(); f.add(1); f.add(2, 'EURUSD'); f.symbols.EURUSD.quoteOK = false;
    f.c.RRManage('', 123); assert.deepEqual(f.deals().map(r => r.symbol), ['XAUUSD']);
    assert.equal(f.b.journals.get(f.c.RRFileName(2)).stage, 0);
});
check('actual off-chart minimum lot prevents a rounded but too-small partial reduction', () => {
    const f = multiSymbolFixture(); f.add(1); f.add(2, 'EURUSD'); f.symbols.EURUSD.minimum = 0.02;
    f.c.RRManage('', 123); assert.deepEqual(f.deals().map(r => r.symbol), ['XAUUSD']);
});
check('manual exit ownership skips RR before creating its journal', () => {
    const f = multiSymbolFixture(); f.add(1); f.b.manual.add(1); f.c.RRManage('', 123);
    assert.equal(f.b.journals.size, 0); assert.equal(f.b.sends.length, 0);
});
check('manual exit registration between the first check and RR journal lock cannot reach a send', () => {
    const f = multiSymbolFixture(); f.add(1); f.b.afterOpen = () => f.b.manual.add(1); f.c.RRManage('', 123);
    assert.equal(f.b.sends.length, 0); assert.equal(f.b.saves.length, 0); assert.equal(f.b.handles.size, 0);
});
check('global manager retains existing persisted targets and execution state on subsequent passes', () => {
    const f = multiSymbolFixture(); f.add(1); f.add(2, 'EURUSD'); f.c.RRManage('', 123);
    const before = structuredClone([...f.b.journals]);
    f.c.RRActivePlan.targets[0].multiple = 3; f.b.tick += 300; f.c.RRManage('', 123);
    assert.deepEqual([...f.b.journals], before); assert.equal(f.deals().length, 2);
});
check('chart-symbol reinitialization preserves the cold-start exclusion boundary and unprocessed new fills', () => {
    const f = multiSymbolFixture(); f.add(1); f.c.RRSnapshotExisting(); f.add(2, 'EURUSD');
    f.b.reason = f.c.REASON_CHARTCHANGE; assert.equal(f.c.RRValidateInputs(), true);
    assert.deepEqual(Array.from(f.c.RRExistingIDs), [1]); f.c.RRManage('', 123);
    assert.equal(f.b.journals.has(f.c.RRFileName(1)), false);
    assert.equal(f.b.journals.has(f.c.RRFileName(2)), true);
});
check('cold load and account changes still snapshot preexisting positions rather than adopting them', () => {
    for (const mode of ['cold', 'account']) {
        const f = multiSymbolFixture(); f.add(1); f.c.RRSnapshotExisting(); f.add(2, 'EURUSD');
        f.b.reason = f.c.REASON_CHARTCHANGE;
        if (mode === 'cold') f.c.RRHasSnapshot = false; else f.b.account = 22;
        assert.equal(f.c.RRValidateInputs(), true); assert.deepEqual(Array.from(f.c.RRExistingIDs), [1, 2]);
        f.c.RRManage('', 123); assert.equal(f.b.journals.size, 0);
    }
});
check('switch snapshot preflight checks all new positions but permits pure pending orders and historical positions', () => {
    const f = multiSymbolFixture(); f.b.orders.push({ ticket: 900, symbol: 'EURUSD' });
    assert.equal(f.c.RRSwitchCanSnapshot(123, ''), true);
    f.add(1); f.c.RRSnapshotExisting(); f.add(2, 'EURUSD');
    assert.equal(f.c.RRSwitchCanSnapshot(123, ''), false);
    f.c.RRManage('', 123); assert.equal(f.c.RRSwitchCanSnapshot(123, ''), true); assert.equal(f.b.handles.size, 0);
});
check('shared default-plan edit guard includes pending orders on every symbol', () => {
    resetEnvironment({ orders: [{ ticket: 1, active: true, symbol: 'EURUSD', magic: 123 }] });
    assert.equal(context.RRPlanCanEdit('', 123, ''), false);
    assert.equal(context.RRPlanCanEdit('TEST', 123, ''), true);
});
check('shared default-plan edit guard includes off-chart new fills until their journal is frozen', () => {
    resetEnvironment({ positions: [{ ticket: 100, id: 42, symbol: 'EURUSD', magic: 123 }] });
    assert.equal(context.RRPlanCanEdit('', 123, ''), false);
    assert.equal(context.RRPlanCanEdit('TEST', 123, ''), true);
    env.journals['42'] = { valid: true, state: { magic: 123 } };
    assert.equal(context.RRPlanCanEdit('', 123, ''), true);
});
check('global manager resumes old-Magic frozen journals while new captures keep current entry Magic', () => {
    const f = multiSymbolFixture(); f.add(1); const old = f.add(2, 'EURUSD', { magic: 999 });
    const frozen = {}; assert.equal(f.c.RRCapture(old.ticket, frozen), true);
    f.b.journals.set(f.c.RRFileName(old.id), structuredClone(frozen));
    f.add(3, 'EURUSD', { magic: 999 }); f.add(4, 'EURUSD', { magic: 0 });
    f.c.RRManage('', 123);
    assert.deepEqual(f.deals().map(r => [r.symbol, r.magic]).sort(), [['EURUSD', 999], ['XAUUSD', 123]]);
    assert.equal(f.b.journals.has(f.c.RRFileName(3)), false); assert.equal(f.b.journals.has(f.c.RRFileName(4)), false);
    const saved = f.b.journals.get(f.c.RRFileName(old.id));
    assert.equal(saved.magic, 999); assert.equal(saved.entry, frozen.entry); assert.equal(saved.risk, frozen.risk);
    assert.deepEqual(saved.target_r, frozen.target_r);
});
check('empty other-Magic journal never grants authority to capture an unrelated position', () => {
    const f = multiSymbolFixture(); f.add(1, 'EURUSD', { magic: 999 }); f.b.journals.set(f.c.RRFileName(1), null);
    f.c.RRManage('', 123);
    assert.equal(f.b.sends.length, 0); assert.equal(f.b.saves.length, 0); assert.equal(f.b.journals.get(f.c.RRFileName(1)), null);
});
check('global resume requires the persisted journal Magic to match the actual position', () => {
    const f = multiSymbolFixture(); const p = f.add(1, 'EURUSD', { magic: 999 }); const frozen = {};
    assert.equal(f.c.RRCapture(p.ticket, frozen), true); frozen.magic = 123;
    f.b.journals.set(f.c.RRFileName(1), frozen); f.c.RRManage('', 123);
    assert.equal(f.b.sends.length, 0); assert.equal(f.b.saves.length, 0);
});
check('nonempty symbol selector retains original Magic scope even for an old-Magic valid journal', () => {
    const f = multiSymbolFixture(); const p = f.add(1, 'EURUSD', { magic: 999 }); const frozen = {};
    assert.equal(f.c.RRCapture(p.ticket, frozen), true); f.b.journals.set(f.c.RRFileName(1), frozen);
    f.c.RRManage('EURUSD', 123); assert.equal(f.b.sends.length, 0); assert.equal(f.b.saves.length, 0);
});
check('zero entry Magic cannot enroll a new manual position even when the panel setting matches', () => {
    for (const emptyJournal of [false, true]) {
        const f = multiSymbolFixture(); f.add(1, 'EURUSD', { magic: 0 });
        if (emptyJournal) f.b.journals.set(f.c.RRFileName(1), null);
        f.c.RRManage('', 0); assert.equal(f.b.sends.length, 0); assert.equal(f.b.saves.length, 0);
        assert.equal(f.b.journals.has(f.c.RRFileName(1)), emptyJournal);
    }
});


check('ordinary manager never captures or exits a child owned by a parent group', () => {
    const f=multiSymbolFixture();f.add(1);f.b.batchChildren=new Set([1]);f.c.RRManage('',123);
    assert.equal(f.b.journals.size,0);assert.equal(f.b.sends.length,0);
});

process.stdout.write(`\n${passed} manager tests passed against production management, capture, execution and reinitialization functions.\n`);
process.stdout.write('Scope: simulated MT5 boundaries; no real trading requests, terminal compilation or journal IO.\n');
