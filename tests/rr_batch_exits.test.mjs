// Exercise the actual parent exit functions against simulated MT5 state.
// No terminal files, network calls or real orders are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../mt5/RRBatchExits.mqh', import.meta.url), 'utf8');
const core = readFileSync(new URL('../mt5/RRCore.mqh', import.meta.url), 'utf8');
const ordinary = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const plans = readFileSync(new URL('../mt5/RRPlan.mqh', import.meta.url), 'utf8');
const clone = x => structuredClone(x);
const refs = { RBPickClose: [5], RBGroupVolumes: [1, 2, 4], RBGroupNet: [1],
    RBReadGroup: [2], RBReadManagedGroup: [2, 3, 4, 5], RBApplyGroupPlanLocked: [5],
    RBRegisterGroupClose: [3], RMRequestClose: [3], RGExitPosition: [3],
    RRPlanValidate: [1], RRPositionPlanPricesSafe: [3], RRHistory: [1, 2, 3] };
function refCalls(body) {
    const re = new RegExp('\\b(' + Object.keys(refs).join('|') + ')\\s*\\(', 'g');
    let match;
    const edits = [];
    while ((match = re.exec(body))) {
        const begin = re.lastIndex, parts = [];
        let depth = 0, start = begin, end = begin, quote = '';
        for (; end < body.length; end++) {
            const ch = body[end];
            if (quote) { if (ch === quote && body[end - 1] !== '\\') quote = ''; continue; }
            if (ch === '"' || ch === "'") { quote = ch; continue; }
            if (ch === '(' || ch === '{' || ch === '[') depth++;
            if (ch === ')' && depth === 0) { parts.push(body.slice(start, end)); break; }
            if (ch === ')' || ch === '}' || ch === ']') depth--;
            if (ch === ',' && depth === 0) { parts.push(body.slice(start, end)); start = end + 1; }
        }
        for (const index of refs[match[1]]) {
            const arg = parts[index]?.trim();
            assert.ok(arg, `${match[1]} reference ${index}`);
            parts[index] = arg.endsWith('.value') ? arg.slice(0, -6)
                : `{ get value() { return ${arg}; }, set value(v) { ${arg} = v; } }`;
        }
        edits.push([begin, end, parts.join(',')]);
        re.lastIndex = end;
    }
    for (const [start, end, text] of edits.reverse()) body = body.slice(0, start) + text + body.slice(end);
    return body;
}
function extract(name, text = source) {
    const match = new RegExp(`(?:bool|double|void|int)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(text);
    assert.ok(match, `Missing production function ${name}`);
    let depth = 1, start = match.index + match[0].length, end = start;
    for (; end < text.length && depth; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
    }
    const signature = match[1].trim() ? match[1].split(',') : [];
    const args = signature.map(arg => arg.trim().match(/(\w+)(?:\[\])?$/)[1]);
    const scalarRefs = signature.flatMap((arg, i) => /\b(?:double|string)\s*&/.test(arg) && !arg.includes('[]') ? [args[i]] : []);
    let body = text.slice(start, end - 1)
        .replace(/\bdouble remaining, (tp|server_tp), volumes\[RB_MAX_CHILDREN\];/g, 'let remaining = 0, $1 = 0, volumes = Array(64).fill(0);')
        .replace(/\bdouble (\w+)\[RB_MAX_CHILDREN\];/g, 'let $1 = Array(64).fill(0);')
        .replace(/\bRBGroup updated = g;/g, 'let updated = clone(g);')
        .replace(/\b(?:RBGroup|MqlTick|RRPlan) (\w+);/g, 'let $1 = {};')
        .replace(/\bMqlTrade(?:Request|Result) (\w+) = \{\}/g, 'let $1 = {}')
        .replace(/\b(?:const\s+)?(?:int|long|uint|ulong|double|bool|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;|,))/g, 'let ')
        .replace(/\((?:double|long|ulong|int)\)/g, '')
        .replace(/\bg = updated;/g, 'Object.assign(g, clone(updated));')
        .replace(/\bstate = g.exit_state;/g, 'Object.assign(state, clone(g.exit_state));');
    for (const out of scalarRefs) body = body.replace(new RegExp('\\b' + out + '\\b', 'g'), out + '.value');
    body = refCalls(body);
    return `function ${name}(${args.join(',')}) { ${body}\n}`;
}
function plan(rows = [[2, 50, 1], [5, 50, 0]]) {
    return { count: rows.length, targets: Array.from({ length: 20 }, (_, i) => ({
        multiple: rows[i]?.[0] ?? 0, percent: rows[i]?.[1] ?? 0, move_be: rows[i]?.[2] ?? 0 })) };
}
function group(volumes = [0.01, 0.01]) {
    const p = plan(), total = volumes.reduce((a, b) => a + b, 0);
    return { parent_id: 700, magic: 123, symbol: 'TEST', direction: 1, entry_state: 1, pending: 0,
        filled_volume: total, filled_value: total * 100, reference_price: 100, stop_loss: 90,
        risk_budget: 500, child_count: volumes.length, child_id: volumes.map((_, i) => i + 1),
        child_order: volumes.map((_, i) => i + 2001), child_volume: [...volumes], child_price: volumes.map(() => 100), exit_ready: 1,
        manual_active: 0, manual_target_remaining: 0, manual_created: 0, manual_completed: 0,
        risk_latched: 0, exit_state: { version: 2, identifier: 700, direction: 1, magic: 123,
            entry: 100, risk: 10, initial_volume: total, target_count: p.count,
            target_r: p.targets.map(x => x.multiple), target_percent: p.targets.map(x => x.percent),
            target_be: p.targets.map(x => x.move_be), stage: 0, be_requested: 0, be_done: 0,
            offset_points: 0, blocked: 0, last_stop_request: 0, first_r: 2, final_r: 5, percent: 50, move_be: 1 } };
}
let env;
const constants = ['SYMBOL_VOLUME_STEP', 'SYMBOL_VOLUME_MIN', 'SYMBOL_TRADE_TICK_SIZE', 'SYMBOL_POINT',
    'SYMBOL_DIGITS', 'SYMBOL_TRADE_STOPS_LEVEL', 'SYMBOL_TRADE_FREEZE_LEVEL', 'POSITION_TYPE',
    'POSITION_TYPE_BUY', 'POSITION_SYMBOL', 'POSITION_MAGIC', 'POSITION_VOLUME', 'POSITION_PRICE_OPEN',
    'POSITION_TP', 'POSITION_SL', 'POSITION_PROFIT', 'POSITION_SWAP', 'DEAL_POSITION_ID',
    'DEAL_PROFIT', 'DEAL_SWAP', 'DEAL_COMMISSION', 'DEAL_FEE', 'TRADE_ACTION_SLTP',
    'TRADE_RETCODE_DONE', 'TRADE_RETCODE_NO_CHANGES'];
const context = vm.createContext({ ...Object.fromEntries(constants.map(x => [x, x])),
    RB_MAX_CHILDREN: 64, RR_MAX_TARGETS: 20, RB_ENTRY_BUILDING: 0, RR_Enable: true,
    MathMin: Math.min, MathMax: Math.max, MathAbs: Math.abs, MathFloor: Math.floor, MathCeil: Math.ceil,
    MathIsValidNumber: Number.isFinite, NormalizeDouble: (n, d) => Number(n.toFixed(d)), clone,
    ArrayInitialize: (arr, value) => arr.fill(value), TimeLocal: () => env.time,
    StringFormat: (fmt, ...args) => fmt + ' ' + args.join(' '),
    SymbolInfoDouble: (_symbol, property) => ({ SYMBOL_VOLUME_STEP: env.step, SYMBOL_VOLUME_MIN: env.minimum,
        SYMBOL_TRADE_TICK_SIZE: 0.01, SYMBOL_POINT: 0.01 })[property],
    SymbolInfoInteger: (_symbol, property) => property === 'SYMBOL_DIGITS' ? 2 : 0,
    SymbolInfoTick: (_symbol, tick) => { Object.assign(tick, env.tick); return env.quote; },
    RBGroupSymbol: g => g.symbol,
    RMSelectIdentifier: id => { env.selected = env.positions.get(id); return env.selected?.ticket ?? 0; },
    PositionGetString: key => env.selected?.[key] ?? '',
    PositionGetDouble: key => env.selected?.[key] ?? 0,
    PositionGetInteger: key => env.selected?.[key] ?? 0,
    RMPositionExitActive: id => env.busy.has(id),
    RMExitSettled: () => false, // Pending journals require real history; exercised in rr_manual_execution.
    RRHistory: (id, order, volume, mixed) => {
        order.value = id + 2000; volume.value = env.initialVolumes[id - 1]; mixed.value = env.mixed;
        return !env.historyUnavailable;
    },
    RGPositionExitLatched: id => env.guards.has(id),
    RBSaveGroup: (_handle, g) => { if (env.failSave) return false; env.saves.push(clone(g)); env.saved = clone(g); return true; },
    RBStopGroupEntry: g => { g.entry_state = 2; },
    RBFreezeExit: g => { if (!g.pending) g.exit_ready = 1; return !!g.exit_ready; },
    RDPlayRiskAlert: text => env.alerts.push(text),
    RGExitPosition: (ticket, key, magic) => { env.guardRequests.push({ ticket, key, magic }); return true; },
    RRNotice: text => env.notices.push(text), RRCanTrade: () => env.canTrade,
    OrderSend: (req, result) => {
        env.stopRequests.push(clone(req)); result.retcode = env.stopReject ? 'FAIL' : 'TRADE_RETCODE_DONE';
        if (env.applyStops && !env.stopReject) {
            const pos = [...env.positions.values()].find(p => p.ticket === req.position);
            assert.ok(pos, 'the simulated server only modifies an existing child ticket');
            pos.POSITION_SL = req.sl; pos.POSITION_TP = req.tp;
        }
        return !env.stopReject;
    },
    RMRequestClose: (id, percent, magic, error, direction) => {
        env.requests.push({ id, percent, magic, direction });
        if (env.reject) { error.value = 'wait'; return false; }
        env.busy.add(id); return true;
    },
    RRPlanChecksum: p => JSON.stringify(p),
    RRStatePlan: (s, p) => Object.assign(p, plan(s.target_r.slice(0, s.target_count).map((r, i) => [r, s.target_percent[i], s.target_be[i]]))),
    RRPositionPlanPricesSafe: (_s, _p, _symbol, error) => { if (!env.pricesSafe) error.value = 'crossed'; return env.pricesSafe; },
    HistorySelectByPosition: id => { env.history = env.histories.get(id); return env.history !== undefined; },
    HistoryDealsTotal: () => env.history.length,
    HistoryDealGetTicket: index => env.history[index].ticket,
    HistoryDealGetInteger: (ticket, key) => env.history.find(d => d.ticket === ticket)[key] ?? 0,
    HistoryDealGetDouble: (ticket, key) => env.history.find(d => d.ticket === ticket)[key] ?? 0,
});
for (const name of ['RRTargetPrice', 'RRTargetReached', 'RRBETarget', 'RRSLProtectsBE']) vm.runInContext(extract(name, core), context);
for (const name of ['RRPlanTotalPercent', 'RRPlanClosesAll', 'RRPlanValidate']) vm.runInContext(extract(name, plans), context);
vm.runInContext(extract('RRStateClosesAll', ordinary), context);
for (const name of ['RBClosedGoal', 'RBManualTarget', 'RBPickClose', 'RBReductionPossible', 'RBSelectSafeChild', 'RBGroupVolumes',
    'RBGroupCloseBusy', 'RBGroupGuardLatched', 'RBGroupNet', 'RBApplyGroupPlanLocked', 'RBRegisterGroupClose',
    'RBUpdateGroupStops', 'RBManageGroupRisk', 'RBManageGroupLocked']) vm.runInContext(extract(name), context, { filename: name });
function reset(volumes = [0.01, 0.01]) {
    const g = group(volumes);
    env = { initialVolumes: [...volumes], mixed: false, historyUnavailable: false, time: 100, step: 0.01, minimum: 0.01, tick: { bid: 100, ask: 100.01 }, quote: true,
        canTrade: false, failSave: false, pricesSafe: true, reject: false, busy: new Set(), guards: new Set(),
        requests: [], saves: [], stopRequests: [], guardRequests: [], alerts: [], notices: [], positions: new Map(), histories: new Map() };
    for (let i = 0; i < volumes.length; i++) {
        env.positions.set(i + 1, { ticket: i + 101, POSITION_TYPE: 'POSITION_TYPE_BUY', POSITION_SYMBOL: 'TEST',
            POSITION_MAGIC: 123, POSITION_VOLUME: volumes[i], POSITION_PRICE_OPEN: 100, POSITION_SL: 90,
            POSITION_TP: 0, POSITION_PROFIT: 0, POSITION_SWAP: 0 });
        env.histories.set(i + 1, [{ ticket: i + 1001, DEAL_POSITION_ID: i + 1, DEAL_COMMISSION: -0.01 }]);
    }
    context.RR_Enable = true;
    return g;
}
function finishRequest() {
    const req = env.requests.at(-1), pos = env.positions.get(req.id);
    pos.POSITION_VOLUME = Number((pos.POSITION_VOLUME * (1 - req.percent / 100)).toFixed(8));
    if (pos.POSITION_VOLUME <= 0) env.positions.delete(req.id);
    env.busy.delete(req.id);
}
// A second EA instance has independent compiled functions but shares the broker
// and parent journal boundaries. Each turn reloads the journal, just as the
// production RBManageGroups does after acquiring the exclusive parent lock.
function secondManagerInstance() {
    const instance = vm.createContext({ ...context });
    for (const name of ['RRTargetPrice', 'RRTargetReached', 'RRBETarget', 'RRSLProtectsBE']) vm.runInContext(extract(name, core), instance);
    for (const name of ['RRPlanTotalPercent', 'RRPlanClosesAll', 'RRPlanValidate']) vm.runInContext(extract(name, plans), instance);
    vm.runInContext(extract('RRStateClosesAll', ordinary), instance);
    for (const name of ['RBClosedGoal', 'RBManualTarget', 'RBPickClose', 'RBReductionPossible', 'RBSelectSafeChild', 'RBGroupVolumes',
        'RBGroupCloseBusy', 'RBGroupGuardLatched', 'RBGroupNet', 'RBApplyGroupPlanLocked', 'RBRegisterGroupClose',
        'RBUpdateGroupStops', 'RBManageGroupRisk', 'RBManageGroupLocked']) vm.runInContext(extract(name), instance);
    return instance;
}
function sharedParentTurn(instance) {
    const loaded = clone(env.saved);
    instance.RBManageGroupLocked(1, loaded);
    return loaded;
}
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
check('group 50% of two minimum children closes one full child', () => {
    const g = reset(); g.exit_state.stage = 1;
    context.RBManageGroupLocked(1, g);
    assert.equal(env.requests.length, 1); assert.equal(env.requests[0].percent, 100);
    finishRequest(); context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 1);
});
check('manual percentage uses current group remainder and freezes the target', () => {
    const g = reset([1, 0.6]), error = {};
    assert.equal(context.RBRegisterGroupClose(1, g, 25, error), true);
    assert.equal(g.manual_target_remaining, 1.2);
    context.RBManageGroupLocked(1, g); finishRequest(); context.RBManageGroupLocked(1, g);
    assert.equal(g.manual_active, 0); env.time += 3;
    assert.equal(context.RBRegisterGroupClose(1, g, 25, error), true);
    assert.equal(g.manual_target_remaining, 0.9);
});
check('partial execution and reload keep the original fixed target', () => {
    let g = reset([0.4, 0.4, 0.4]); context.RBRegisterGroupClose(1, g, 75, {});
    context.RBManageGroupLocked(1, g); finishRequest();
    g = clone(env.saved); context.RBManageGroupLocked(1, g); finishRequest();
    context.RBManageGroupLocked(1, g); finishRequest(); context.RBManageGroupLocked(1, g);
    assert.equal(g.manual_active, 0);
    assert.ok(Math.abs([...env.positions.values()].reduce((s, p) => s + p.POSITION_VOLUME, 0) - 0.3) < 1e-8);
});
check('pending child journals stop any second child reduction', () => {
    const g = reset([1, 1]); context.RBRegisterGroupClose(1, g, 100, {});
    context.RBManageGroupLocked(1, g); context.RBManageGroupLocked(1, g);
    assert.equal(env.requests.length, 1);
    env.positions.delete(1); context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 1);
});
check('external reductions count toward automatic cumulative percentages', () => {
    const g = reset([1, 1]); env.positions.get(1).POSITION_VOLUME = 0.3; g.exit_state.stage = 1;
    context.RBManageGroupLocked(1, g);
    assert.equal(env.requests[0].percent, 100); finishRequest();
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 1);
});
check('external reduction completes a queued manual target without another close', () => {
    const g = reset([1, 1]); context.RBRegisterGroupClose(1, g, 50, {});
    env.positions.delete(1); context.RBManageGroupLocked(1, g);
    assert.equal(g.manual_active, 0); assert.equal(env.requests.length, 0);
});
check('manual target is not queued if durable parent save fails', () => {
    const g = reset(); env.failSave = true;
    assert.equal(context.RBRegisterGroupClose(1, g, 50, {}), false);
    assert.equal(g.manual_active, 0); assert.equal(env.requests.length, 0);
});
check('failed child registration retains parent intent for later retry', () => {
    const g = reset([1, 1]); context.RBRegisterGroupClose(1, g, 50, {}); env.reject = true;
    context.RBManageGroupLocked(1, g); assert.equal(g.manual_active, 1);
    env.reject = false; context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 2);
});
check('entry in progress and ambiguous entry reject all manual exits', () => {
    for (const overrides of [{ entry_state: 0 }, { pending: 1 }, { exit_ready: 0 }]) {
        const g = Object.assign(reset(), overrides); assert.equal(context.RBRegisterGroupClose(1, g, 100, {}), false);
    }
});
check('manual duplicate and two second debounce are rejected', () => {
    const g = reset([1]); assert.equal(context.RBRegisterGroupClose(1, g, 25, {}), true);
    assert.equal(context.RBRegisterGroupClose(1, g, 25, {}), false);
    context.RBManageGroupLocked(1, g); finishRequest(); context.RBManageGroupLocked(1, g);
    assert.equal(context.RBRegisterGroupClose(1, g, 25, {}), false);
});
check('invalid and substep percentages cannot create tasks', () => {
    for (const percent of [0, -1, 101, NaN, Infinity, 0.1]) {
        const g = reset(); assert.equal(context.RBRegisterGroupClose(1, g, percent, {}), false);
    }
});
check('legally sized group residual is retained with min greater than step', () => {
    reset(); const lots = {};
    const index = context.RBPickClose([0.2, 0.15], 2, 0.25, 0.1, 0.01, lots);
    assert.equal(index, 1); assert.equal(lots.value, 0.15);
    assert.equal(context.RBReductionPossible([0.2, 0.15], 2, 0.25, 0.1, 0.01), true);
});
check('group target never rounds above the requested percentage', () => {
    reset(); assert.equal(context.RBManualTarget(0.03, 50, 0.01), 0.02);
    assert.equal(context.RBReductionPossible([0.15], 1, 0.1, 0.1, 0.01), false);
});
check('zero percent BE latches without a reduction', () => {
    const g = reset([1]); g.exit_state.target_percent = [0, 50]; env.tick = { bid: 120, ask: 120.01 };
    context.RBManageGroupLocked(1, g);
    assert.equal(g.exit_state.stage, 1); assert.equal(g.exit_state.be_requested, 1); assert.equal(env.requests.length, 0);
    env.tick = { bid: 110, ask: 110.01 }; context.RBManageGroupLocked(1, g);
    assert.equal(g.exit_state.be_requested, 1);
});
check('crossing several targets persists final stage before first reduction', () => {
    const g = reset([1, 1]); env.tick = { bid: 151, ask: 151.01 };
    context.RBManageGroupLocked(1, g);
    assert.equal(env.saves[0].exit_state.stage, 2); assert.equal(env.requests[0].percent, 100);
});
check('failed target persistence sends no child request', () => {
    const g = reset([1]); env.tick = { bid: 121, ask: 121.01 }; env.failSave = true;
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 0);
});
check('unfinished last percentage retains group remainder', () => {
    const g = reset([1, 1]); g.exit_state.target_percent = [50, 25]; g.exit_state.stage = 2;
    context.RBManageGroupLocked(1, g); finishRequest(); context.RBManageGroupLocked(1, g); finishRequest();
    context.RBManageGroupLocked(1, g); assert.equal(env.positions.get(2).POSITION_VOLUME, 0.5);
});
check('parent net adds all realized child P/L, costs and floating losses', () => {
    const g = reset([1, 1]); env.positions.delete(1);
    Object.assign(env.histories.get(1)[0], { DEAL_PROFIT: -200, DEAL_SWAP: -1, DEAL_COMMISSION: -2, DEAL_FEE: -1 });
    Object.assign(env.positions.get(2), { POSITION_PROFIT: -290, POSITION_SWAP: -6 });
    env.histories.get(2)[0].DEAL_COMMISSION = 0;
    const net = {}; assert.equal(context.RBGroupNet(g, net), true); assert.equal(net.value, -500);
});
check('group loss budget cancels building and journals before emergency exits', () => {
    const g = reset([1, 1]); g.entry_state = 0; g.exit_ready = 0;
    env.positions.get(1).POSITION_PROFIT = -250; env.positions.get(2).POSITION_PROFIT = -250;
    context.RBManageGroupLocked(1, g);
    assert.equal(env.saved.risk_latched, 1); assert.equal(g.entry_state, 2);
    assert.equal(env.guardRequests.length, 2); assert.equal(env.requests.length, 0); assert.equal(env.alerts.length, 1);
    context.RBManageGroupLocked(1, g); assert.equal(env.alerts.length, 1);
});
check('risk latch survives reload and a price recovery', () => {
    let g = reset([1]); g.risk_latched = 1; g = clone(g);
    context.RBManageGroupLocked(1, g); assert.equal(env.guardRequests.length, 1);
});
check('risk journal failure prevents all emergency sends', () => {
    const g = reset([1]); env.positions.get(1).POSITION_PROFIT = -501; env.failSave = true;
    context.RBManageGroupLocked(1, g); assert.equal(env.guardRequests.length, 0); assert.equal(env.alerts.length, 0);
});
check('incomplete child history cannot manufacture a risk amount', () => {
    const g = reset([1]); env.histories.delete(1); const net = {};
    assert.equal(context.RBGroupNet(g, net), false); context.RBManageGroupRisk(1, g);
    assert.equal(env.guardRequests.length, 0);
});
check('active original guard has priority over group targets', () => {
    const g = reset([1, 1]); g.exit_state.stage = 1; env.guards.add(1);
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 0);
    env.positions.delete(1); context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 0);
});
check('disabled RR still executes explicitly queued manual exits', () => {
    const g = reset([1, 1]); context.RBRegisterGroupClose(1, g, 50, {}); context.RR_Enable = false;
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 1);
});
check('modified child identity blocks ordinary group management', () => {
    const g = reset([1]); env.positions.get(1).POSITION_PRICE_OPEN = 101;
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 0); assert.ok(env.notices.length > 0);
});
check('group TP reports inconsistency as minus one', () => {
    const g = reset([1, 1]); env.positions.get(2).POSITION_TP = 151;
    const remaining = {}, tp = {}; assert.equal(context.RBGroupVolumes(g, remaining, tp, Array(64), {}), true);
    assert.equal(remaining.value, 2); assert.equal(tp.value, -1);
});
check('BE modifies each ticket and never loosens an existing better SL', () => {
    const g = reset([1, 1]); env.canTrade = true; env.tick = { bid: 125, ask: 125.01 };
    g.exit_state.be_requested = 1; env.positions.get(1).POSITION_SL = 105;
    context.RBUpdateGroupStops(1, g);
    assert.equal(env.stopRequests.length, 1); assert.equal(env.stopRequests[0].position, 102);
    assert.equal(env.stopRequests[0].sl, 100); assert.equal(env.stopRequests[0].tp, 0);
});
check('retained remainder clears every child TP but keeps SL', () => {
    const g = reset([1, 1]); env.canTrade = true; g.exit_state.target_percent = [50, 25];
    for (const pos of env.positions.values()) pos.POSITION_TP = 150;
    context.RBUpdateGroupStops(1, g);
    assert.equal(env.stopRequests.length, 2); assert.ok(env.stopRequests.every(r => r.tp === 0 && r.sl === 90));
});
check('full-exit plan removes legacy child TPs without changing SL or unrelated positions', () => {
    const g = reset([1, 1]); env.canTrade = true;
    for (const pos of env.positions.values()) pos.POSITION_TP = 150;
    env.positions.get(1).POSITION_SL = 105;
    env.positions.set(99, { ticket: 999, POSITION_TP: 170, POSITION_SL: 80 });
    context.RBUpdateGroupStops(1, g);
    assert.deepEqual(env.stopRequests.map(r => [r.position, r.sl, r.tp]), [[101, 105, 0], [102, 90, 0]]);
    assert.equal(env.positions.get(99).POSITION_TP, 170);
    assert.equal(env.requests.length, 0, 'removing server TP alone never registers a close');
});
check('disabled RR does not remove an existing parent server TP', () => {
    const g = reset([1]); env.canTrade = true; env.positions.get(1).POSITION_TP = 150; context.RR_Enable = false;
    context.RBUpdateGroupStops(1, g);
    assert.equal(env.stopRequests.length, 0); assert.equal(env.saves.length, 0);
});
check('legacy TP removal retries after rejection and never reinstalls a server target', () => {
    const g = reset([1]); env.canTrade = true; env.stopReject = true; env.positions.get(1).POSITION_TP = 150;
    context.RBUpdateGroupStops(1, g); env.time += 1; context.RBUpdateGroupStops(1, g);
    assert.equal(env.stopRequests.length, 1);
    env.time += 3; env.stopReject = false; context.RBUpdateGroupStops(1, g);
    assert.equal(env.stopRequests.length, 2); assert.ok(env.stopRequests.every(r => r.tp === 0 && r.sl === 90));
    env.positions.get(1).POSITION_TP = 0; env.time += 3; context.RBUpdateGroupStops(1, g);
    assert.equal(env.stopRequests.length, 2); assert.equal(env.requests.length, 0);
});
check('two current instances share durable parent stages without installing TP or duplicating child exits', () => {
    const g = reset([3, 3, 3, 3]); env.canTrade = true; env.applyStops = true;
    env.saved = clone(g);
    const second = secondManagerInstance(), instances = [context, second];
    let turn = 0;
    const poll = () => {
        env.time += 3;
        const result = sharedParentTurn(instances[turn++ % 2]);
        assert.ok([...env.positions.values()].every(p => p.POSITION_TP === 0));
        assert.ok(env.stopRequests.every(r => r.tp === 0));
        return result;
    };
    for (let i = 0; i < 4; i++) poll();
    assert.equal(env.requests.length, 0); assert.equal(env.stopRequests.length, 0);
    env.tick = { bid: 120, ask: 120.01 };
    poll(); assert.equal(env.saved.exit_state.stage, 1); assert.equal(env.requests.length, 1);
    poll(); assert.equal(env.requests.length, 1, 'the other chart waits for the same pending child');
    finishRequest(); poll(); assert.equal(env.requests.length, 2);
    poll(); assert.equal(env.requests.length, 2);
    finishRequest();
    for (let i = 0; i < 4; i++) poll();
    assert.equal(env.requests.length, 2);
    assert.equal([...env.positions.values()].reduce((sum, p) => sum + p.POSITION_VOLUME, 0), 6);
    assert.ok([...env.positions.values()].every(p => p.POSITION_SL === 100));
    env.tick = { bid: 150, ask: 150.01 };
    poll(); assert.equal(env.saved.exit_state.stage, 2); assert.equal(env.requests.length, 3);
    poll(); assert.equal(env.requests.length, 3);
    finishRequest(); poll(); assert.equal(env.requests.length, 4);
    poll(); assert.equal(env.requests.length, 4);
    finishRequest(); poll(); poll();
    assert.equal(env.positions.size, 0);
    assert.deepEqual(env.requests.map(r => [r.id, r.percent]), [[1, 100], [2, 100], [3, 100], [4, 100]]);
});
check('an external writer can reintroduce final TP but current shared managers clear it without weakening SL or BE', () => {
    for (const direction of [1, -1]) {
        const g = reset([1, 1]); env.canTrade = true; env.applyStops = true;
        g.direction = direction; g.exit_state.direction = direction;
        g.exit_state.target_percent = [0, 100];
        const type = direction === 1 ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL';
        const initialSL = direction === 1 ? 90 : 110;
        for (const p of env.positions.values()) Object.assign(p, { POSITION_TYPE: type, POSITION_SL: initialSL });
        env.saved = clone(g); const second = secondManagerInstance();
        const finalTP = direction === 1 ? 150 : 50;
        for (const p of env.positions.values()) p.POSITION_TP = finalTP;
        sharedParentTurn(context);
        assert.ok([...env.positions.values()].every(p => p.POSITION_TP === 0 && p.POSITION_SL === initialSL));
        assert.equal(env.requests.length, 0);
        env.saved.exit_state.stage = 1; env.saved.exit_state.be_requested = 1; env.saved.exit_state.be_done = 1;
        env.positions.get(1).POSITION_SL = 100;
        env.positions.get(2).POSITION_SL = direction === 1 ? 105 : 95;
        env.tick = direction === 1 ? { bid: 125, ask: 125.01 } : { bid: 74.99, ask: 75 };
        for (const p of env.positions.values()) p.POSITION_TP = finalTP;
        env.time += 1; sharedParentTurn(second);
        assert.equal(env.stopRequests.length, 2, 'the shared stop throttle also covers a different chart');
        assert.ok([...env.positions.values()].every(p => p.POSITION_TP === finalTP));
        env.time += 2; sharedParentTurn(context);
        assert.equal(env.stopRequests.length, 4);
        assert.deepEqual([...env.positions.values()].map(p => [p.POSITION_SL, p.POSITION_TP]),
            [[100, 0], [direction === 1 ? 105 : 95, 0]]);
        for (let i = 0; i < 4; i++) { env.time += 3; sharedParentTurn(i % 2 ? context : second); }
        assert.equal(env.stopRequests.length, 4, 'without another external write TP stays absent');
        assert.equal(env.requests.length, 0); assert.equal(env.saved.exit_state.stage, 1);
        assert.equal(env.saved.exit_state.be_requested, 1); assert.equal(env.saved.exit_state.be_done, 1);
    }
});
check('buy final virtual TP waits for bid then closes every remaining child serially across reload', () => {
    let g = reset([3, 3, 3, 3]); env.canTrade = true;
    g.exit_state.stage = 1; g.exit_state.be_requested = 1; g.exit_state.be_done = 1;
    env.positions.delete(1); env.positions.delete(2);
    for (const pos of env.positions.values()) pos.POSITION_SL = 100;
    env.tick = { bid: 149.99, ask: 150 }; context.RBManageGroupLocked(1, g);
    assert.equal(env.requests.length, 0, 'ask touching buy TP is not executable');
    env.tick = { bid: 150, ask: 150.01 }; context.RBManageGroupLocked(1, g);
    assert.equal(g.exit_state.stage, 2); assert.equal(env.saved.exit_state.stage, 2);
    assert.deepEqual(env.requests.map(r => [r.id, r.percent]), [[3, 100]]);
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 1, 'pending close does not duplicate');
    g = clone(env.saved); finishRequest(); context.RBManageGroupLocked(1, g);
    assert.deepEqual(env.requests.map(r => [r.id, r.percent]), [[3, 100], [4, 100]]);
    finishRequest(); context.RBManageGroupLocked(1, g);
    assert.equal(env.positions.size, 0); assert.equal(env.requests.length, 2); assert.equal(env.stopRequests.length, 0);
});
check('sell final virtual TP waits for ask and requests the remaining child market close', () => {
    const g = reset([3, 3]); g.direction = -1; g.exit_state.direction = -1;
    g.exit_state.stage = 1; env.positions.delete(1);
    Object.assign(env.positions.get(2), { POSITION_TYPE: 'POSITION_TYPE_SELL', POSITION_SL: 100 });
    env.tick = { bid: 49.99, ask: 50.01 }; context.RBManageGroupLocked(1, g);
    assert.equal(env.requests.length, 0, 'bid touching sell TP is not executable');
    env.tick = { bid: 49.99, ask: 50 }; context.RBManageGroupLocked(1, g);
    assert.equal(g.exit_state.stage, 2); assert.equal(env.requests[0].percent, 100); assert.equal(env.requests[0].direction, -1);
    finishRequest(); context.RBManageGroupLocked(1, g); assert.equal(env.positions.size, 0); assert.equal(env.requests.length, 1);
});
check('failed BE is retried without sending another reduction', () => {
    const g = reset([1]); env.canTrade = true; env.stopReject = true; env.tick = { bid: 125, ask: 125.01 };
    g.exit_state.be_requested = 1; context.RBUpdateGroupStops(1, g); env.time += 4; context.RBUpdateGroupStops(1, g);
    assert.equal(env.stopRequests.length, 2); assert.equal(env.requests.length, 0); assert.equal(g.exit_state.be_done, 0);
});
check('untradeable or invalid quote does not erase protection', () => {
    const g = reset([1]); env.canTrade = true; env.quote = false;
    context.RBUpdateGroupStops(1, g); assert.equal(env.stopRequests.length, 0);
});
check('plan edit preserves frozen risk basis and triggered prefix', () => {
    const g = reset([1, 1]); g.exit_state.stage = 1; g.exit_state.be_requested = 1;
    env.positions.delete(1); const next = plan([[2, 50, 1], [6, 25, 0]]);
    const before = clone(g.exit_state), checksum = JSON.stringify(plan());
    assert.equal(context.RBApplyGroupPlanLocked(1, g, next, checksum, 1, {}), true);
    for (const key of ['initial_volume', 'entry', 'risk', 'stage', 'be_requested']) assert.equal(g.exit_state[key], before[key]);
    assert.equal(g.exit_state.final_r, 6); assert.equal(g.exit_state.target_percent[1], 25);
});
check('plan edits reject stale stage/checksum and altered triggered rows', () => {
    for (const [checksum, stage, next] of [['stale', 1, plan()], [JSON.stringify(plan()), 0, plan()],
        [JSON.stringify(plan()), 1, plan([[2, 40, 1], [5, 50, 0]])]]) {
        const g = reset([1, 1]); g.exit_state.stage = 1; env.positions.delete(1);
        assert.equal(context.RBApplyGroupPlanLocked(1, g, next, checksum, stage, {}), false);
    }
});
check('plan edits reject current child jobs and incomplete target exits', () => {
    const g = reset([1, 1]); g.exit_state.stage = 1;
    assert.equal(context.RBApplyGroupPlanLocked(1, g, plan(), JSON.stringify(plan()), 1, {}), false);
    env.positions.delete(1); env.busy.add(2);
    assert.equal(context.RBApplyGroupPlanLocked(1, g, plan(), JSON.stringify(plan()), 1, {}), false);
});
check('plan edit rejects newly crossed targets before durable mutation', () => {
    const g = reset([1]); env.pricesSafe = false;
    assert.equal(context.RBApplyGroupPlanLocked(1, g, plan([[3, 50, 1], [7, 50, 0]]), JSON.stringify(plan()), 0, {}), false);
    assert.equal(env.saves.length, 0);
});
check('plan edit supports tiny children by allocating group-level targets', () => {
    const g = reset();
    assert.equal(context.RBApplyGroupPlanLocked(1, g, plan([[3, 50, 1], [6, 50, 0]]), JSON.stringify(plan()), 0, {}), true);
});
check('plan save failure leaves the original target set unchanged', () => {
    const g = reset([1]); env.failSave = true;
    assert.equal(context.RBApplyGroupPlanLocked(1, g, plan([[3, 50, 1], [7, 50, 0]]), JSON.stringify(plan()), 0, {}), false);
    assert.equal(g.exit_state.final_r, 5);
});
check('missing history pauses management and retries without a permanent block', () => {
    const g = reset([1, 1]); g.exit_state.stage = 1; env.historyUnavailable = true;
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 0); assert.equal(g.exit_state.blocked, 0);
    env.historyUnavailable = false; context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 1);
});
check('add then remove between ticks remains detectable from child history', () => {
    const g = reset([1, 1]); g.exit_state.stage = 1; env.mixed = true;
    context.RBManageGroupLocked(1, g); assert.equal(env.requests.length, 0);
});
check('risk cannot close an enlarged or repriced child under the original parent', () => {
    for (const changes of [{ POSITION_VOLUME: 2 }, { POSITION_PRICE_OPEN: 101 }, { POSITION_MAGIC: 999 },
        { POSITION_SYMBOL: 'OTHER' }, { POSITION_TYPE: 'POSITION_TYPE_SELL' }]) {
        const g = reset([1]); Object.assign(env.positions.get(1), changes, { POSITION_PROFIT: -501 });
        context.RBManageGroupLocked(1, g); assert.equal(env.guardRequests.length, 0); assert.equal(g.risk_latched, 0);
    }
});
check('latched group risk closes only verified children when another child changes', () => {
    const g = reset([1, 1]); g.risk_latched = 1; env.positions.get(1).POSITION_VOLUME = 2;
    context.RBManageGroupLocked(1, g);
    assert.equal(env.guardRequests.length, 1); assert.equal(env.guardRequests[0].ticket, 102);
});
check('risk refuses a child whose entry history was enlarged then reduced', () => {
    const g = reset([1]); env.initialVolumes[0] = 2; env.positions.get(1).POSITION_PROFIT = -501;
    context.RBManageGroupLocked(1, g); assert.equal(env.guardRequests.length, 0);
    g.risk_latched = 1; context.RBManageGroupLocked(1, g); assert.equal(env.guardRequests.length, 0);
});
check('already synchronized protection does not append idle parent records', () => {
    const g = reset([1, 1]); env.canTrade = true;
    context.RBUpdateGroupStops(1, g); env.time += 10; context.RBUpdateGroupStops(1, g);
    assert.equal(env.saves.length, 0); assert.equal(env.stopRequests.length, 0);
});
check('a stop journal failure prevents this cycle from dispatching a reduction', () => {
    const g = reset([1]); g.exit_state.stage = 1; g.exit_state.be_requested = 1;
    env.canTrade = true; env.tick = { bid: 125, ask: 125.01 }; env.failSave = true;
    context.RBManageGroupLocked(1, g); assert.equal(env.stopRequests.length, 0); assert.equal(env.requests.length, 0);
});
check('sell targets use ask and BE preserves a better lower sell stop', () => {
    const g = reset([1, 1]); g.direction = -1; g.exit_state.direction = -1; g.exit_state.final_r = 5;
    for (const pos of env.positions.values()) Object.assign(pos, { POSITION_TYPE: 'POSITION_TYPE_SELL', POSITION_SL: 110 });
    env.positions.get(1).POSITION_SL = 95; env.canTrade = true;
    env.tick = { bid: 79.99, ask: 80.01 }; context.RBManageGroupLocked(1, g); assert.equal(g.exit_state.stage, 0);
    env.tick = { bid: 79.99, ask: 80 }; context.RBManageGroupLocked(1, g);
    assert.equal(g.exit_state.stage, 1); assert.equal(env.stopRequests.length, 1);
    assert.equal(env.stopRequests[0].position, 102); assert.equal(env.stopRequests[0].sl, 100);
});
console.log(`${passed} batch group exit checks passed`);
