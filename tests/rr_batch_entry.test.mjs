// Execute production batch arithmetic, recovery and submission bodies with MT5
// dependencies replaced by in-memory fixtures. No terminal/account is touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRBatch.mqh', import.meta.url), 'utf8');
const types = readFileSync(new URL('../mt5/RRBatchTypes.mqh', import.meta.url), 'utf8');
function bodyOf(name) {
    const match = new RegExp(`(?:bool|double|void|string|ulong|int|uint)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Production ${name} exists`);
    let depth = 1, end = match.index + match[0].length;
    const start = end;
    for (; depth; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
    return { args: match[1].split(',').filter(x => x.trim()).map(x => /(\w+)\s*(?:\[\])?$/.exec(x.trim())[1]), body: source.slice(start, end - 1) };
}
function translate(name) {
    const fn = bodyOf(name);
    let body = fn.body
        .replace(/\b(?:MqlTick|MqlTradeRequest|MqlTradeResult|MqlTradeCheckResult|RBGroup|RBSettingsRecord)\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\bRRPlan\s+(\w+)\s*;/g, 'let $1 = { targets: Array.from({length: 20}, () => ({})) };')
        .replace(/sizeof\((?:RBSettingsRecord|RBGroup)\)/g, '1')
        .replace(/\bulong\s+(\w+)\[\]\s*;/g, 'let $1 = [];')
        .replace(/\b(?:const\s+)?(?:int|long|uint|ulong|double|bool|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\((?:int|long|uint|ulong|double|datetime)\)/g, '')
        .replace(/\berror\s*=/g, 'error.value =');
    if (name === 'RBResolvePending') {
        body = body.replace('let risk = 0;', 'let risk = { value: 0 };').replace('g.used_risk += risk;', 'g.used_risk += risk.value;')
            .replace('risk += MathMax', 'risk.value += MathMax');
    }
    if (name === 'RBSendNext') {
        body = body.replace('let unit_risk = 0;', 'let unit_risk = { value: 0 };')
            .replace('unit_risk, g.child_max_lots', 'unit_risk.value, g.child_max_lots')
            .replace('volume * unit_risk, error', 'volume * unit_risk.value, error');
    }
    if (name === 'RBManageEntry') body = body.replace('let message;', 'let message = { value: "" };')
        .replace(' + message;', ' + message.value;')
        .replace(/\bmessage\s*=/g, 'message.value =')
        .replace('let message.value =', 'let message =')
        .replace('message == ""', 'message.value == ""').replace(' + message)', ' + message.value)');
    return `function ${name}(${fn.args.join(',')}) { ${body} }`;
}
const symbols = [...new Set(source.match(/\b(?:ORDER|DEAL|POSITION|ACCOUNT|SYMBOL|TRADE|FILE|SEEK)_[A-Z_]+\b/g))];
let env;
function group(overrides = {}) {
    return { version: 1, parent_id: 123, account: 1, server_hash: 7, magic: 99, direction: 1,
        symbol: 'EURUSD', planned_volume: 40, risk_budget: 500, stop_loss: 99, reference_price: 100,
        child_max_lots: 5, interval_seconds: 1, max_deviation_points: 0, commission_per_lot: 0,
        max_spread_points: 0, slippage_points: 20, close_opposite: 0, created: 1000,
        child_count: 0, child_id: [], child_order: [], child_volume: [], child_price: [],
        entry_state: 0, pending: 0, pending_index: 0, pending_order: 0, pending_volume: 0,
        filled_volume: 0, filled_value: 0, used_risk: 0, exit_ready: 0, risk_latched: 0,
        exit_state: { version: 2, entry: 0, risk: 0, initial_volume: 0 }, ...overrides };
}
function reset(overrides = {}) {
    env = { now: 1005, tickNow: 10000, step: .01, min: .01, max: 20, point: .01, bid: 99.99, ask: 100,
        riskPerLot: 12.5, safety: true, riskKnown: true, exposure: true, historyReady: true,
        orders: [], deals: [], positions: [], events: [], saveOK: true, sendOK: true, retcode: 'TRADE_RETCODE_DONE',
        checkOK: true, records: [], loadOK: true, canTrade: true, guardAllowed: true, accountKey:'7_1', ...overrides };
    Object.assign(context, { RBActiveParent: 0, RBOwnerAccount:'7_1', RBAccountLock: -1, RBCorruptJournal: false, RBLastSendTick: 0 });
}
const context = vm.createContext({
    ...Object.fromEntries(symbols.map(key => [key, key])),
    RB_MAX_CHILDREN: 64, RB_ENTRY_BUILDING: 0, RB_ENTRY_COMPLETE: 1, RB_ENTRY_CANCELLED: 2, RB_ENTRY_STOPPED: 3,
    INVALID_HANDLE: -1, RBLastSendTick: 0, RBActiveParent: 0, RBOwnerAccount:'7_1', RBCorruptJournal: false, RBAccountLock: -1,
    RBEnabled: true, RBLastStatus: '', sets: { MaxSlippage: 20 }, SYMBOL_FILLING_FOK: 1, SYMBOL_FILLING_IOC: 2,
    MathIsValidNumber: Number.isFinite, MathMin: Math.min, MathMax: Math.max, MathFloor: Math.floor,
    MathAbs: Math.abs, NormalizeDouble: (v, d) => Number(v.toFixed(d)), DoubleToString: (v, d) => v.toFixed(d),
    IntegerToString: String, ArraySize: a => a.length, ZeroMemory: o => { for (const key of Object.keys(o)) delete o[key]; },
    GetTickCount64: () => env.tickNow, TimeCurrent: () => env.now,
    RBGroupSymbol: g => g.symbol,
    RBChildComment: (g, index) => `RB${g.parent_id.toString(16).toUpperCase()}-${(index + 1).toString(16).toUpperCase().padStart(2, '0')}`,
    RBRiskAtSL: (g, volume, price, out) => { out.value = volume * env.riskPerLot; return env.riskKnown; },
    RBExistingChildrenSafe: () => env.safety,
    RBCheckExposure: () => env.exposure,
    SymbolInfoDouble: (symbol, property) => ({ SYMBOL_VOLUME_STEP: env.step, SYMBOL_VOLUME_MIN: env.min,
        SYMBOL_VOLUME_MAX: env.max, SYMBOL_POINT: env.point })[property] ?? 0,
    SymbolInfoInteger: (symbol, property) => ({ SYMBOL_TRADE_MODE: 'SYMBOL_TRADE_MODE_FULL',
        SYMBOL_TRADE_STOPS_LEVEL: 1, SYMBOL_FILLING_MODE: 2, SYMBOL_TRADE_EXEMODE: 'SYMBOL_TRADE_EXECUTION_MARKET' })[property] ?? 0,
    SymbolInfoTick: (symbol, tick) => { Object.assign(tick, { bid: env.bid, ask: env.ask, time: env.now }); return true; },
    HistorySelect: () => env.historyReady,
    OrdersTotal: () => env.orders.filter(o => o.active).length,
    OrderGetTicket: i => { env.order = env.orders.filter(o => o.active)[i]; return env.order?.ticket ?? 0; },
    OrderGetString: key => env.order?.[key], OrderGetInteger: key => env.order?.[key],
    OrderSelect: id => Boolean(env.orders.find(o => o.ticket === id && o.active)),
    HistoryOrderSelect: id => Boolean(env.orders.find(o => o.ticket === id && !o.active)),
    HistoryOrdersTotal: () => env.orders.filter(o => !o.active).length,
    HistoryOrderGetTicket: i => env.orders.filter(o => !o.active)[i]?.ticket ?? 0,
    HistoryOrderGetString: (id, key) => env.orders.find(o => o.ticket === id)?.[key],
    HistoryOrderGetInteger: (id, key) => env.orders.find(o => o.ticket === id)?.[key],
    HistoryOrderGetDouble: (id, key) => env.orders.find(o => o.ticket === id)?.[key] ?? 0,
    HistoryDealsTotal: () => env.deals.length, HistoryDealGetTicket: i => env.deals[i].ticket,
    HistoryDealGetInteger: (id, key) => env.deals.find(d => d.ticket === id)?.[key],
    HistoryDealGetDouble: (id, key) => env.deals.find(d => d.ticket === id)?.[key] ?? 0,
    RBSaveGroup: (handle, g) => {
        env.events.push(['save', g.pending, g.child_count]);
        const index=env.records.findIndex(record=>record.parent_id===g.parent_id);
        if(env.saveOK && index>=0) env.records[index]=structuredClone(g);
        return env.saveOK;
    },
    OrderCheck: (request, check) => { env.events.push(['check']); check.retcode = 'TRADE_RETCODE_DONE'; return env.checkOK; },
    OrderSend: (request, result) => {
        env.events.push(['send', structuredClone(request)]); result.order = env.resultOrder ?? 900; result.deal = 0; result.retcode = env.retcode; result.comment = 'test';
        return env.sendOK;
    },
    RBLoadSettings: () => true,
    FileOpen: () => env.ownerBusy ? -1 : 77,
    FileClose: handle => env.events.push(['close', handle]),
    RBAccountLockName: () => 'account-lock',
    RBAccountKey: () => env.accountKey,
    RBCollectGroups: ids => { ids.push(...env.records.map(g => g.parent_id)); return ids.length; },
    RBLockGroup: id => { env.events.push(['group-lock',id]); return id; },
    RBLoadGroup: (id, g) => { Object.assign(g, structuredClone(env.records.find(g => g.parent_id === id))); return env.loadOK; },
    RRCanTrade: () => env.canTrade, RGCanOpen: () => env.guardAllowed,
    RRHash: () => 7, AccountInfoString: () => 'test',
    AccountInfoInteger: key => key === 'ACCOUNT_MARGIN_MODE' ? 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING' : 1,
    RCTradeLeave: () => env.events.push(['leave']),
});
for (const name of ['RBNextVolume', 'RBSpacingReady', 'RBValidSettings', 'RBStoredIntervalMilliseconds', 'RBGroupIntervalMilliseconds', 'RBDirectionForOrder', 'RBFreezeExit',
    'RBStopGroupEntry', 'RBResolvePending', 'RBDefiniteEntryReject', 'RBSendNext', 'RBReleaseOwner', 'RBCancelEntry', 'RBManageEntry', 'RBInit']) vm.runInContext(translate(name), context);
let checks = 0;
function test(name, fn) { reset(); fn(); console.log(`PASS ${++checks}: ${name}`); }
const error = () => ({ value: '' });
function fill(g, volume = 5, opts = {}) {
    const order = { ticket: 900, active: false, ORDER_SYMBOL: g.symbol, ORDER_MAGIC: g.magic,
        ORDER_COMMENT: context.RBChildComment(g, g.pending_index), ORDER_TYPE: 'ORDER_TYPE_BUY',
        ORDER_STATE: 'ORDER_STATE_FILLED', ORDER_VOLUME_INITIAL: volume, ORDER_VOLUME_CURRENT: 0, ...opts };
    env.orders = [order];
    env.deals = [{ ticket: 901, DEAL_ORDER: 900, DEAL_TYPE: 'DEAL_TYPE_BUY', DEAL_ENTRY: 'DEAL_ENTRY_IN',
        DEAL_POSITION_ID: 501, DEAL_VOLUME: volume, DEAL_PRICE: 100 }];
}

test('40 lots at 5-lot cap is eight confirmed children, never capped to broker maximum 20', () => {
    let filled = 0, used = 0;
    for (let i = 0; i < 8; i++) { const n = context.RBNextVolume(40, filled, 500, used, 12.5, 5, 20, .01, .01); assert.equal(n, 5); filled += n; used += n * 12.5; }
    assert.equal(filled, 40); assert.equal(context.RBNextVolume(40, filled, 500, used, 12.5, 5, 20, .01, .01), 0);
});
test('remaining risk shrinks the next child after adverse fills', () => assert.equal(context.RBNextVolume(40, 35, 500, 480, 20, 5, 20, .01, .01), 1));
test('cannot exceed confirmed total even when price improves', () => assert.equal(context.RBNextVolume(40, 39.9, 500, 100, 1, 5, 20, .01, .01), .1));
test('broker per-order maximum remains binding', () => assert.equal(context.RBNextVolume(40, 0, 500, 0, 10, 50, 10, .01, .01), 10));
test('nonstep child cap floors downward', () => assert.equal(context.RBNextVolume(40, 0, 500, 0, 10, .555, 20, .01, .01), .55));
test('fractional final child need not equal full child size', () => assert.equal(context.RBNextVolume(10.3, 10, 500, 100, 10, 5, 20, .01, .01), .3));
test('risk below minimum lot stops rather than overfilling', () => assert.equal(context.RBNextVolume(40, 0, 500, 499.99, 10, 5, 20, .01, .01), 0));
for (const [label, values] of [ ['NaN', [NaN,0,500,0,10,5,20,.01,.01]], ['negative used', [40,0,500,-1,10,5,20,.01,.01]],
    ['zero step', [40,0,500,0,10,5,20,.01,0]], ['zero risk', [40,0,500,0,0,5,20,.01,.01]],
    ['infinite cap', [40,0,500,0,10,Infinity,20,.01,.01]], ['overshot risk', [40,5,500,501,10,5,20,.01,.01]] ])
    test(`invalid budget input ${label} fails closed`, () => assert.equal(context.RBNextVolume(...values), 0));
test('spacing enforces 1000ms, independent of wall-clock second boundary', () => { assert.equal(context.RBSpacingReady(2000,1999,1000),false); assert.equal(context.RBSpacingReady(2998,1999,1000),false); assert.equal(context.RBSpacingReady(2999,1999,1000),true); });
test('100ms spacing rejects 99ms and permits exactly 100ms', () => { assert.equal(context.RBSpacingReady(2098,1999,100),false); assert.equal(context.RBSpacingReady(2099,1999,100),true); });
test('clock reversal does not release spacing gate', () => assert.equal(context.RBSpacingReady(999,1000,100),false));
test('first child is eligible immediately', () => assert.equal(context.RBSpacingReady(999,0,100),true));
test('interval settings enforce 100–3600000ms including both boundaries', () => {
    for(const interval of [-1,0,1,99,3600001]) assert.equal(context.RBValidSettings(5,interval,0),false);
    for(const interval of [100,250,1000,3600000]) assert.equal(context.RBValidSettings(5,interval,0),true);
    assert.equal(context.RBSpacingReady(1000,0,0),false);
});
test('invalid lot/deviation settings rejected', () => { assert.equal(context.RBValidSettings(0,100,0),false); assert.equal(context.RBValidSettings(NaN,100,0),false); assert.equal(context.RBValidSettings(5,100,-1),false); });
test('legacy group seconds and new group milliseconds have separate interpretation', () => {
    assert.equal(context.RBGroupIntervalMilliseconds(group({version:1,interval_seconds:1})),1000);
    assert.equal(context.RBGroupIntervalMilliseconds(group({version:1,interval_seconds:3600})),3600000);
    assert.equal(context.RBGroupIntervalMilliseconds(group({version:2,interval_seconds:100})),100);
    assert.equal(context.RBGroupIntervalMilliseconds(group({version:2,interval_seconds:1000})),1000);
    for(const [version,interval] of [[1,0],[1,3601],[1,2147483647],[2,1],[2,99],[2,3600001],[3,100]])
        assert.equal(context.RBStoredIntervalMilliseconds(version,interval),0);
});

test('entry submits intent first then one request with immediate SL and parent child comment', () => {
    const g = group(); assert.equal(context.RBSendNext(1,g,error()),true);
    assert.deepEqual(env.events.map(e=>e[0]),['check','save','send','save']);
    const request = env.events.find(e=>e[0]==='send')[1]; assert.equal(request.sl,99); assert.equal(request.tp,0); assert.equal(request.volume,5); assert.equal(request.comment,'RB7B-01'); assert.equal(g.pending,1);
});
test('unresolved prior request can never be resubmitted', () => { const g=group({pending:1,pending_volume:5}); assert.equal(context.RBSendNext(1,g,error()),false); assert.equal(env.events.length,0); });
test('failed durable intent results in zero sends', () => { env.saveOK=false; assert.equal(context.RBSendNext(1,group(),error()),false); assert.equal(env.events.some(e=>e[0]==='send'),false); });
test('precheck failure has no intent and no send', () => { env.checkOK=false; assert.equal(context.RBSendNext(1,group(),error()),false); assert.deepEqual(env.events.map(e=>e[0]),['check']); });
test('unknown send result leaves pending intent and stops continuation', () => { env.sendOK=false; env.retcode='TRADE_RETCODE_TIMEOUT'; const g=group(); context.RBSendNext(1,g,error()); assert.equal(g.pending,1); assert.equal(g.entry_state,3); context.RBSendNext(1,g,error()); assert.equal(env.events.filter(e=>e[0]==='send').length,1); });
test('known accepted partial result still requires history confirmation', () => { env.retcode='TRADE_RETCODE_DONE_PARTIAL'; const g=group(); context.RBSendNext(1,g,error()); assert.equal(g.pending,1); assert.equal(g.filled_volume,0); });
for (const code of ['TRADE_RETCODE_INVALID_STOPS', 'TRADE_RETCODE_NO_MONEY', 'TRADE_RETCODE_LIMIT_VOLUME', 'TRADE_RETCODE_HEDGE_PROHIBITED'])
    test(`definitive ${code} rejection stops without an immortal unknown intent`, () => {
        env.resultOrder=0; env.retcode=code; const g=group(); context.RBSendNext(1,g,error());
        assert.equal(g.pending,0); assert.equal(g.entry_state,3); assert.equal(env.events.filter(e=>e[0]==='send').length,1);
    });
test('inconsistent rejection containing an order ID still requires reconciliation', () => {
    env.retcode='TRADE_RETCODE_INVALID_STOPS'; const g=group(); context.RBSendNext(1,g,error()); assert.equal(g.pending,1);
});
test('missing or relaxed SL on previous child prevents another request', () => { env.safety=false; const g=group({child_count:1}); assert.equal(context.RBSendNext(1,g,error()),false); assert.equal(env.events.length,0); });
test('latched group risk prevents another request', () => { assert.equal(context.RBSendNext(1,group({risk_latched:1}),error()),false); assert.equal(env.events.length,0); });
test('exposure limit stops without a send', () => { env.exposure=false; assert.equal(context.RBSendNext(1,group(),error()),false); assert.equal(env.events.length,0); });
test('adverse price deviation stops without a send', () => { env.ask=100.11; assert.equal(context.RBSendNext(1,group({max_deviation_points:10}),error()),false); assert.equal(env.events.length,0); });
test('favorable price change is permitted by adverse-only guard', () => { env.ask=99.9; env.bid=99.89; assert.equal(context.RBSendNext(1,group({max_deviation_points:10}),error()),true); });
test('spread guard stops without a send', () => { env.bid=99.8; assert.equal(context.RBSendNext(1,group({max_spread_points:10}),error()),false); });
test('zero remaining budget completes without sending', () => { const g=group({used_risk:500}); assert.equal(context.RBSendNext(1,g,error()),false); assert.equal(g.entry_state,1); assert.equal(env.events.length,0); });

test('terminal filled order is counted only once', () => {
    const g=group({pending:1,pending_index:0,pending_order:900,pending_volume:5}); fill(g);
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.child_count,1); assert.equal(g.filled_volume,5); assert.equal(g.used_risk,62.5);
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.child_count,1);
});
test('multiple fill deals aggregate actual weighted fill price', () => {
    const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g); env.deals[0].DEAL_VOLUME=2;
    env.deals.push({...env.deals[0],ticket:902,DEAL_VOLUME:3,DEAL_PRICE:101});
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.child_price[0],100.6); assert.equal(g.filled_value,503);
});
test('cancelled partial order books only actual fills', () => {
    const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g,2,{ORDER_STATE:'ORDER_STATE_CANCELED',ORDER_VOLUME_INITIAL:5,ORDER_VOLUME_CURRENT:3});
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.filled_volume,2); assert.equal(g.pending,0);
});
test('active order remains unresolved even with partial deals', () => {
    const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g,2,{active:true,ORDER_VOLUME_INITIAL:5});
    assert.equal(context.RBResolvePending(g,error()),false); assert.equal(g.filled_volume,0); assert.equal(g.pending,1);
});
test('history/deal volume mismatch waits instead of assuming completion', () => {
    const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g); env.deals[0].DEAL_VOLUME=3;
    assert.equal(context.RBResolvePending(g,error()),false); assert.equal(g.child_count,0);
});
test('unknown reply finds exactly matching comment in history', () => {
    const g=group({pending:1,pending_order:0,pending_volume:5}); fill(g); assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.child_order[0],900);
});
test('unknown reply without history remains pending and never sends', () => {
    const g=group({pending:1,pending_order:0,pending_volume:5}); assert.equal(context.RBResolvePending(g,error()),false); assert.equal(g.pending,1); assert.equal(env.events.length,0);
});
test('ambiguous matching orders do not choose one', () => {
    const g=group({pending:1,pending_order:0,pending_volume:5}); fill(g); env.orders.push({...env.orders[0],ticket:902}); assert.equal(context.RBResolvePending(g,error()),false); assert.equal(g.child_count,0);
});
test('mixed position IDs fail closed', () => {
    const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g); env.deals[0].DEAL_VOLUME=2;
    env.deals.push({...env.deals[0],ticket:902,DEAL_VOLUME:3,DEAL_POSITION_ID:777}); assert.equal(context.RBResolvePending(g,error()),false);
});
test('SL verification failure after fill records child but cancels future entries', () => {
    env.safety=false; const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g);
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.child_count,1); assert.equal(g.entry_state,3); assert.equal(g.exit_ready,1);
});
test('actual risk over budget freezes filled group and does not refill', () => {
    env.riskPerLot=101; const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g);
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.used_risk,505); assert.equal(g.entry_state,1); assert.equal(g.exit_ready,1);
});
test('charged opening commissions above estimate consume actual risk budget', () => {
    const g=group({pending:1,pending_order:900,pending_volume:5,commission_per_lot:2}); fill(g);
    env.deals[0].DEAL_COMMISSION=-10; env.deals[0].DEAL_FEE=-2;
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.used_risk,69.5);
});
test('zero-fill rejection ends queue', () => {
    const g=group({pending:1,pending_order:900,pending_volume:5}); fill(g,5,{ORDER_STATE:'ORDER_STATE_REJECTED',ORDER_VOLUME_CURRENT:5}); env.deals=[];
    assert.equal(context.RBResolvePending(g,error()),true); assert.equal(g.pending,0); assert.equal(g.entry_state,3); assert.equal(g.child_count,0);
});
test('exit plan cannot freeze while intent is unresolved', () => assert.equal(context.RBFreezeExit(group({entry_state:2,pending:1,filled_volume:5,filled_value:500})),false));
test('cancel freezes actual weighted entry and initial group volume', () => {
    const g=group({filled_volume:10,filled_value:1005,child_count:2,child_order:[10,11]}); context.RBStopGroupEntry(g);
    assert.equal(g.entry_state,2); assert.equal(g.exit_ready,1); assert.equal(g.exit_state.entry,100.5); assert.equal(g.exit_state.risk,1.5); assert.equal(g.exit_state.initial_volume,10);
});
test('cold restart cancels unsubmitted children instead of resuming', () => {
    env.records=[group({filled_volume:5,filled_value:500,child_count:1,child_order:[900]})]; context.RBInit();
    assert.equal(context.RBActiveParent,0); assert.equal(env.events.filter(e=>e[0]==='save').length,1); assert.equal(env.events.some(e=>e[0]==='send'),false);
    assert.equal(env.records[0].entry_state,2); assert.equal(env.records[0].exit_ready,1);
});
test('restart cannot cancel a queue owned by another live panel', () => {
    env.ownerBusy=true; env.records=[group()]; context.RBInit(); assert.equal(env.events.length,0);
});
for (const reason of ['guardAllowed','canTrade']) test(`${reason} lost during unresolved child durably cancels continuation`, () => {
    const g=group({pending:1,pending_order:0,pending_volume:5}); env.records=[g];
    context.RBActiveParent=123; context.RBAccountLock=77; env[reason]=false;
    context.RBManageEntry(); assert.equal(env.records[0].entry_state,3); assert.equal(env.records[0].pending,1);
    env[reason]=true; fill(g); context.RBManageEntry();
    assert.equal(env.records[0].child_count,1); assert.equal(env.records[0].exit_ready,1);
    assert.equal(context.RBActiveParent,0); assert.equal(env.events.some(e=>e[0]==='send'),false);
});
test('permission failure between confirmed children freezes exits before releasing owner', () => {
    env.records=[group({child_count:1,child_id:[501],child_order:[900],child_volume:[5],child_price:[100],filled_volume:5,filled_value:500})];
    context.RBActiveParent=123; context.RBAccountLock=77; env.canTrade=false;
    context.RBManageEntry(); assert.equal(env.records[0].entry_state,3); assert.equal(env.records[0].exit_ready,1);
    assert.equal(context.RBActiveParent,0); assert.equal(env.events.some(e=>e[0]==='send'),false);
});
test('account change during shutdown never creates old parent in new account namespace', () => {
    context.RBActiveParent=123; context.RBAccountLock=77; env.accountKey='7_2'; context.RBCancelEntry();
    assert.equal(context.RBActiveParent,0); assert.equal(env.events.some(e=>e[0]==='group-lock'),false);
    assert.equal(env.events.some(e=>e[0]==='save'),false);
});
test('account change during manage releases old ownership without reading old parent in new account', () => {
    context.RBActiveParent=123; context.RBAccountLock=77; env.accountKey='7_2'; context.RBManageEntry();
    assert.equal(context.RBActiveParent,0); assert.equal(env.events.some(e=>e[0]==='group-lock'),false);
});
test('running second panel cancels an orphan after its owner disappears', () => {
    env.records=[group({child_count:1,child_id:[501],child_order:[900],child_volume:[5],child_price:[100],filled_volume:5,filled_value:500})];
    context.RBManageEntry(); assert.equal(env.records[0].entry_state,2); assert.equal(env.records[0].exit_ready,1);
    assert.equal(env.events.some(e=>e[0]==='send'),false);
});
test('100ms queue sends only at the boundary and then waits for final fill', () => {
    env.records=[group({version:2,interval_seconds:100})];
    context.RBActiveParent=123; context.RBAccountLock=77; context.RBLastSendTick=10000;
    env.tickNow=10099; context.RBManageEntry(); assert.equal(env.events.some(e=>e[0]==='send'),false);
    env.tickNow=10100; context.RBManageEntry(); assert.equal(env.events.filter(e=>e[0]==='send').length,1);
    assert.equal(context.RBLastSendTick,10100);
    env.tickNow=10200; context.RBManageEntry(); env.tickNow=50000; context.RBManageEntry();
    assert.equal(env.events.filter(e=>e[0]==='send').length,1); assert.equal(env.records[0].pending,1);
});
test('slow confirmation releases at most one child without catching up missed slots', () => {
    const g=group({version:2,interval_seconds:100,pending:1,pending_order:900,pending_volume:5});
    env.records=[g]; context.RBActiveParent=123; context.RBAccountLock=77; context.RBLastSendTick=10000;
    env.tickNow=50000; context.RBManageEntry(); assert.equal(env.events.some(e=>e[0]==='send'),false);
    fill(g); context.RBManageEntry(); assert.equal(env.events.filter(e=>e[0]==='send').length,1);
    assert.equal(context.RBLastSendTick,50000); assert.equal(env.records[0].child_count,1);
    env.orders=[]; env.deals=[]; context.RBManageEntry(); env.tickNow=50099; context.RBManageEntry();
    assert.equal(env.events.filter(e=>e[0]==='send').length,1);
});
test('100ms queue cannot continue after the confirmed previous fill has unsafe SL', () => {
    const g=group({version:2,interval_seconds:100,pending:1,pending_order:900,pending_volume:5});
    env.records=[g]; context.RBActiveParent=123; context.RBAccountLock=77; context.RBLastSendTick=10000;
    env.tickNow=10100; fill(g); env.safety=false; context.RBManageEntry();
    assert.equal(env.events.some(e=>e[0]==='send'),false); assert.equal(env.records[0].entry_state,3);
});
test('legacy one-second queue does not become a one-millisecond queue', () => {
    env.records=[group({version:1,interval_seconds:1})];
    context.RBActiveParent=123; context.RBAccountLock=77; context.RBLastSendTick=10000;
    for(const tick of [10001,10100,10999]) { env.tickNow=tick; context.RBManageEntry(); }
    assert.equal(env.events.some(e=>e[0]==='send'),false);
    env.tickNow=11000; context.RBManageEntry(); assert.equal(env.events.filter(e=>e[0]==='send').length,1);
});
test('100ms queue remains cancelled on cold restart with no automatic resubmission', () => {
    env.records=[group({version:2,interval_seconds:100,filled_volume:5,filled_value:500,child_count:1,child_order:[900]})];
    context.RBInit();assert.equal(context.RBActiveParent,0);assert.equal(env.records[0].entry_state,2);
    assert.equal(env.records[0].version,2);assert.equal(env.records[0].interval_seconds,100);
    assert.equal(env.events.some(e=>e[0]==='send'),false);
});

// Exercise actual settings read/load/append and parent checksum validation with
// a record-sized in-memory file. The record itself stays in the persisted unit.
function diskFixture() {
    const disk={ records:[], exists:false, cursor:0, busy:false, writeOK:true };
    const hash=value=>{ let h=2166136261; for(const c of String(value)) h=Math.imul(h^c.charCodeAt(0),16777619)>>>0; return h; };
    const c=vm.createContext({ ...Object.fromEntries(symbols.map(key=>[key,key])), INVALID_HANDLE:-1,
        RB_MAX_CHILDREN:64,RR_MAX_TARGETS:20,RBEnabled:false,RBChildMaxLots:5,RBIntervalMilliseconds:1000,RBMaxDeviationPoints:0,RBSettingsReady:false,RBCorruptJournal:false,RBLastStatus:'',
        MathIsValidNumber:Number.isFinite,MathAbs:Math.abs,MathMax:Math.max,DoubleToString:(v,d)=>v.toFixed(d),IntegerToString:String,
        RRHash:hash,RRChecksum:()=>77,StringFormat:(format,...args)=>{let i=0;return format.replace(/%(?:I64[ud]|[ud])/g,()=>args[i++]);},
        AccountInfoInteger:()=>1,AccountInfoString:()=>'test',RBSettingsFile:()=>'settings',RBAccountBusy:()=>disk.busy,
        FileIsExist:()=>disk.exists,FileOpen:()=>1,FileClose:()=>{},FileSize:()=>disk.records.length,
        FileSeek:(handle,offset,origin)=>{disk.cursor=origin==='SEEK_END'?disk.records.length+offset:offset;return true;},
        FileReadStruct:(handle,target)=>{if(!disk.records[disk.cursor])return 0;Object.assign(target,structuredClone(disk.records[disk.cursor]));return 1;},
        FileWriteStruct:(handle,value)=>{if(!disk.writeOK)return 0;disk.records[disk.cursor]=structuredClone(value);disk.cursor++;disk.exists=true;return 1;},
        FileFlush:()=>{},ResetLastError:()=>{},GetLastError:()=>0,
        ZeroMemory:value=>{for(const key of Object.keys(value))if(key!=='targets')delete value[key];},
        RBGroupSymbol:g=>String.fromCharCode(...g.symbol.filter(c=>c!==0)),RRPlanValidate:()=>true,
    });
    for(const name of ['RBValidSettings','RBStoredIntervalMilliseconds','RBGroupIntervalMilliseconds','RBSettingsChecksum',
        'RBReadSettings','RBLoadSettings','RBSaveSettings','RBGroupChecksum','RBLoadGroup','RBSaveGroup']) vm.runInContext(translate(name),c);
    function settings(version,interval,overrides={}) {
        const s={version,enabled:1,child_max:5,interval,deviation:20,...overrides};s.checksum=c.RBSettingsChecksum(s);return s;
    }
    function parent(version,interval) {
        const g={};
        for(const m of types.slice(types.indexOf('struct RBGroup'),types.indexOf('bool RBEnabled')).matchAll(/\b(?:uint|ulong|long|int|double|ushort)\s+(\w+)(\[[^\]]+\])?;/g))
            g[m[1]]=m[2]?Array(64).fill(0):0;
        Object.assign(g,{version,parent_id:123,account:1,server_hash:hash('test'),magic:99,direction:1,planned_volume:40,
            risk_budget:500,stop_loss:99,reference_price:100,child_max_lots:5,interval_seconds:interval});
        [...'EURUSD'].forEach((v,i)=>{g.symbol[i]=v.charCodeAt(0);});
        g.exit_state={stage:0,target_count:1,blocked:0,be_requested:0,be_done:0,offset_points:0,
            target_r:[2],target_percent:[100],target_be:[0]};
        g.checksum=c.RBGroupChecksum(g);return g;
    }
    return {disk,c,settings,parent};
}
test('settings v1 checksum is validated in seconds then loaded as milliseconds', () => {
    const {disk,c,settings}=diskFixture();disk.exists=true;disk.records=[settings(1,1)];
    const original=structuredClone(disk.records[0]);assert.equal(c.RBLoadSettings(),true);
    assert.equal(c.RBIntervalMilliseconds,1000);assert.equal(c.RBSettingsReady,true); assert.deepEqual(disk.records[0],original);
    disk.records=[settings(1,3600)];assert.equal(c.RBLoadSettings(),true);assert.equal(c.RBIntervalMilliseconds,3600000);
});
test('default settings keep 1000ms and saved v2 settings keep exact milliseconds', () => {
    const {disk,c}=diskFixture();assert.equal(c.RBLoadSettings(),true);assert.equal(c.RBIntervalMilliseconds,1000);
    assert.equal(c.RBSaveSettings(true,5,100,0,error()),true);
    assert.equal(disk.records[0].version,2);assert.equal(disk.records[0].interval,100);assert.equal(c.RBIntervalMilliseconds,100);
    c.RBIntervalMilliseconds=9999;assert.equal(c.RBLoadSettings(),true);assert.equal(c.RBIntervalMilliseconds,100);
});
test('saving after v1 appends v2 without rewriting the legacy record or checksum', () => {
    const {disk,c,settings}=diskFixture();disk.exists=true;disk.records=[settings(1,2)];
    const original=structuredClone(disk.records[0]);assert.equal(c.RBLoadSettings(),true);assert.equal(c.RBIntervalMilliseconds,2000);
    assert.equal(c.RBSaveSettings(true,5,250,0,error()),true);assert.equal(disk.records.length,2);
    assert.deepEqual(disk.records[0],original);assert.equal(disk.records[1].version,2);assert.equal(disk.records[1].interval,250);
    assert.equal(c.RBLoadSettings(),true);assert.equal(c.RBIntervalMilliseconds,250);
});
test('invalid settings version, unit, or checksum fails closed before runtime use', () => {
    for(const [version,interval] of [[1,0],[1,3601],[2,99],[2,3600001],[3,100]]) {
        const {disk,c,settings}=diskFixture();disk.exists=true;disk.records=[settings(version,interval)];
        assert.equal(c.RBLoadSettings(),false);assert.equal(c.RBSettingsReady,false);assert.equal(c.RBIntervalMilliseconds,1000);
    }
    const {disk,c,settings}=diskFixture();disk.exists=true;disk.records=[settings(1,1)];disk.records[0].interval=1000;
    assert.equal(c.RBLoadSettings(),false);assert.equal(c.RBSaveSettings(true,5,100,0,error()),false);assert.equal(disk.records.length,1);
});
test('parent journals accept both versions while keeping checksums over raw stored units', () => {
    const {disk,c,parent}=diskFixture();const old=parent(1,1);disk.records=[old];const loaded={};
    assert.equal(c.RBLoadGroup(1,loaded),true);assert.equal(loaded.interval_seconds,1);assert.equal(c.RBGroupIntervalMilliseconds(loaded),1000);
    const changed={...old,interval_seconds:1000};assert.notEqual(c.RBGroupChecksum(changed),old.checksum);
    disk.records=[changed];assert.equal(c.RBLoadGroup(1,{}),false);
    disk.records=[parent(2,100)];assert.equal(c.RBLoadGroup(1,loaded),true);assert.equal(c.RBGroupIntervalMilliseconds(loaded),100);
    for(const [version,interval] of [[1,3601],[2,1],[2,99],[3,100]]){disk.records=[parent(version,interval)];assert.equal(c.RBLoadGroup(1,{}),false);}
});
test('updating a legacy parent appends the same v1 seconds format and checksum', () => {
    const {disk,c,parent}=diskFixture();const original=parent(1,2);disk.records=[structuredClone(original)];const loaded={};
    assert.equal(c.RBLoadGroup(1,loaded),true);loaded.entry_state=2;
    assert.equal(c.RBSaveGroup(1,loaded),true);assert.equal(disk.records.length,2);assert.deepEqual(disk.records[0],original);
    assert.equal(disk.records[1].version,1);assert.equal(disk.records[1].interval_seconds,2);
    assert.equal(disk.records[1].checksum,c.RBGroupChecksum(disk.records[1]));
    const latest={};assert.equal(c.RBLoadGroup(1,latest),true);assert.equal(latest.entry_state,2);
    assert.equal(c.RBGroupIntervalMilliseconds(latest),2000);
});
test('new parent freezes the v2 millisecond setting without changing disk field layout', () => {
    assert.match(bodyOf('RBQueue').body,/g\.version = 2/);assert.match(bodyOf('RBQueue').body,/g\.interval_seconds = RBIntervalMilliseconds/);
    assert.match(types,/int interval_seconds;/);assert.doesNotMatch(types,/int interval_milliseconds;/);
});

test('parent journal includes manual/risk exit state in checksum', () => {
    for(const field of ['manual_active','manual_target_remaining','manual_created','manual_completed','risk_latched']) {
        assert.ok(types.includes(field)); assert.ok(bodyOf('RBGroupChecksum').body.includes(`g.${field}`));
    }
});
console.log(`${checks} batch-entry checks passed.`);
