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
    const parameters = match[1].split(',').map(parameter => {
        const arg = /^\s*(?:const\s+)?(?:int|double|bool|ulong|string|RRState)\s*&?\s*(\w+)\s*$/.exec(parameter);
        assert.ok(arg, `Unsupported argument: ${parameter}`);
        return arg[1];
    });
    let body = source.slice(start, end - 1)
        .replace(/\bMqlTick\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bMqlTrade(?:Request|Result)\s+(\w+)\s*=\s*\{\}/g, 'let $1 = {}')
        .replace(/\b(?:const\s+)?(?:double|int|bool|ulong|long|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:long|double|int|ulong)\)/g, '');
    // MQL primitive output references require an explicit JS adapter. It writes
    // only the fixture's history fields; the production branch logic is intact.
    body = body.replace('RRHistory(s.identifier, opening_order, in_volume, mixed)',
        'RRHistory(s.identifier, value => { opening_order = value.opening_order; in_volume = value.in_volume; mixed = value.mixed; })');
    return `function ${name}(${parameters.join(', ')}) {${body}\n}`;
}

const constants = ['POSITION_VOLUME', 'POSITION_PRICE_OPEN', 'POSITION_TYPE', 'POSITION_TYPE_BUY',
    'SYMBOL_VOLUME_STEP', 'SYMBOL_VOLUME_MIN', 'SYMBOL_TRADE_TICK_SIZE', 'ORDER_COMMENT', 'ORDER_MAGIC',
    'ORDER_STATE', 'ORDER_STATE_FILLED', 'ORDER_STATE_CANCELED', 'ORDER_STATE_REJECTED', 'ORDER_STATE_EXPIRED',
    'ORDER_VOLUME_INITIAL', 'ORDER_VOLUME_CURRENT', 'POSITION_SL', 'POSITION_TP', 'SYMBOL_POINT',
    'SYMBOL_DIGITS', 'SYMBOL_TRADE_STOPS_LEVEL', 'SYMBOL_TRADE_FREEZE_LEVEL', 'TRADE_ACTION_SLTP',
    'TRADE_RETCODE_DONE', 'TRADE_RETCODE_NO_CHANGES'];
let env;
const context = vm.createContext({
    ...Object.fromEntries(constants.map(name => [name, name])),
    MathFloor: Math.floor, MathCeil: Math.ceil, MathAbs: Math.abs, MathMax: Math.max,
    NormalizeDouble: (value, digits) => Number(value.toFixed(digits)),
    PositionSelectByTicket: () => env.exists,
    PositionGetDouble: name => ({ POSITION_VOLUME: env.volume, POSITION_PRICE_OPEN: env.entry,
        POSITION_SL: env.sl, POSITION_TP: env.tp })[name],
    PositionGetInteger: () => env.direction === 1 ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL',
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
    extract(core, 'RRPriceR'), extract(core, 'RRPartialLots'),
    extract(core, 'RRTargetPrice'), extract(core, 'RRBETarget'), extract(core, 'RRSLProtectsBE'),
    extract(manager, 'RRResolvePending'), extract(manager, 'RRProcess'),
    extract(manager, 'RRUpdateStops').replace('function RRUpdateStops(', 'function RRUpdateStopsActual('),
].join('\n'), context);

function state(overrides = {}) {
    return { identifier: 42, magic: 123, opening_order: 100, direction: 1, entry: 100, risk: 10,
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
        retcode: 'TRADE_RETCODE_DONE', ...overrides };
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

process.stdout.write(`\n${passed} manager tests passed against production RRProcess/RRResolvePending/RRUpdateStops.\n`);
process.stdout.write('Scope: simulated MT5 boundaries; no real trading requests, terminal compilation or journal IO.\n');
