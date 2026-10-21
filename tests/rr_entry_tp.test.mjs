// Execute the production entry-price preparation and confirmation code with
// in-memory MT5 boundaries. This runner cannot open or modify any real order.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../mt5/Position Sizer Trading.mqh', import.meta.url), 'utf8');
const planSource = readFileSync(new URL('../mt5/RRPlan.mqh', import.meta.url), 'utf8');
function adapt(body) {
    return body.replace(/\b(?:string|double|bool|int)\s+(\w+)\s*;/g, "let $1 = '';")
        .replace(/\b(?:string|double|bool|int)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\(ENUM_TIMEFRAMES\)/g, '');
}
function extract(text, name) {
    const signature = new RegExp(`(?:double|bool) ${name}\\(([^)]*)\\)\\s*\\{`).exec(text);
    assert.ok(signature, name);
    let end = signature.index + signature[0].length, start = end, depth = 1;
    for (; depth && end < text.length; end++) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; }
    const args = signature[1].split(',').filter(a => a.trim()).map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    return `function ${name}(${args.join(',')}) {${adapt(text.slice(start, end - 1))}}`;
}
function fixture(total = 75, enabled = true) {
    const ctx = {
        RR_Enable: enabled, RR_MAX_TARGETS: 20,
        RRActivePlan: { count: 2, targets: [{ percent: 50 }, { percent: total - 50 }] },
        sets: { TakeProfitLevel: 150, EntryLevel: 100, StopLossLevel: 90, TakeProfitsNumber: 1,
            AccountButton: 0, EntryType: 1, DoNotApplyTakeProfit: false, DoNotApplyStopLoss: false,
            MagicNumber: 123, TrailingStopPoints: 0, BreakEvenPoints: 0 },
        SYMBOL_TRADE_EXECUTION_MARKET: 1, Execution_Mode: 2, IgnoreMarketExecutionMode: false, Instant: 1, StopLimit: 2,
        TP: [150], j: 0, ArrayPositionSize: [0.32], _Digits: 2, LotStep_digits: 2,
        NormalizeDouble: (n, d) => Number(n.toFixed(d)), DoubleToString: (n, d = 2) => n.toFixed(d),
        AccountInfoString: () => 'USD', ACCOUNT_CURRENCY: 0, AccountInfoInteger: () => 2,
        ACCOUNT_MARGIN_MODE: 1, ACCOUNT_MARGIN_MODE_RETAIL_HEDGING: 2, SYMBOL_TRADE_TICK_SIZE: 1,
        SymbolInfoDouble: () => 0.01, MathAbs: Math.abs, RBEnabled: false, SurpassBrokerMaxPositionSize: false,
        RGCanOpen: () => true, RBLoadSettings: () => true, RRPlanValidate: () => true,
        RRNettingSlotAvailable: () => true, ExtDialog: { RefreshValues: () => {} },
        Alert: message => { ctx.alert = message; },
        SymbolForTrading: 'XAUUSD', _Symbol: 'XAUUSD', Period: () => 5, EnumToString: () => 'PERIOD_M5', StringSubstr: (s, n) => s.slice(n),
        OrderTypeToString: () => 'BUY', FormatDouble: String, AccSize: 1000, AccountCurrency: 'USD', OutputRiskMoney: 10,
        PositionMargin: 20, Balance: 0, Equity: 1, Balance_minus_Risk: 2,
        MB_OKCANCEL: 1, MB_ICONWARNING: 2, IDCANCEL: 2, TIME_DATE: 1, TIME_MINUTES: 2, TIME_SECONDS: 4,
        TimeToString: () => '', MessageBox: message => { ctx.message = message; return 1; }, Print: () => {},
    };
    for (const constant of new Set(source.match(/\bTRANSLATION_\w+/g))) ctx[constant] = constant;
    vm.createContext(ctx);
    for (const name of ['RRPlanTotalPercent', 'RRPlanClosesAll']) vm.runInContext(extract(planSource, name), ctx);
    for (const name of ['RRNewOrderTakeProfit', 'CheckConfirmation', 'RRBeforeTrade']) vm.runInContext(extract(source, name), ctx);
    return ctx;
}
function initializeTP(ctx) {
    const line = source.match(/TP\[0\] = RRNewOrderTakeProfit\(sets.TakeProfitLevel\);/);
    assert.ok(line, 'Single-position entry must transform the preview TP before either entry branch');
    vm.runInContext(line[0], ctx);
}
let count = 0;
function check(name, callback) { callback(); console.log(`ok ${++count} - ${name}`); }
check('runner entry uses TP zero while keeping the last target preview intact', () => {
    const s = fixture(); initializeTP(s); assert.equal(s.TP[0], 0); assert.equal(s.sets.TakeProfitLevel, 150);
});
check('full-exit RR entry also uses virtual TP and keeps preview separate', () => {
    const s = fixture(100); initializeTP(s); assert.equal(s.TP[0], 0); assert.equal(s.sets.TakeProfitLevel, 150);
});
check('RR-disabled original entry preserves the ordinary TP', () => {
    const s = fixture(75, false); initializeTP(s); assert.equal(s.TP[0], 150);
});
const marketPrep = source.slice(source.indexOf('double order_sl = sets.StopLossLevel;'), source.indexOf('if ((order_tp != 0)'));
assert.ok(marketPrep.includes('double order_tp = NormalizeDouble(TP[j], _Digits);'));
for (const execution of [1, 2]) for (const total of [75, 100]) {
    check(`market and deferred stop application retain virtual TP zero, mode ${execution}, total ${total}`, () => {
        const s = fixture(total); s.Execution_Mode = execution; initializeTP(s);
        const afterFill = source.match(/if \(!sets.DoNotApplyTakeProfit\) tp = TP\[j\];/)[0];
        vm.runInContext(`function prepare() {${adapt(marketPrep)} ${afterFill} return { order_tp, tp, order_sl, sl };} result = prepare();`, s);
        assert.equal(s.result.order_tp, 0); assert.equal(s.result.tp, 0); assert.equal(s.result.sl, 90);
        assert.equal(s.result.order_sl, execution === 1 ? 0 : 90);
    });
}
for (const total of [75, 100]) check(`pending order retains virtual TP zero and initial SL, total ${total}`, () => {
    const s = fixture(total); initializeTP(s);
    const start = source.indexOf('double tp = NormalizeDouble(TP[j], _Digits);');
    const end = source.indexOf('if ((tp != 0)', start);
    vm.runInContext(`function prepare() {${adapt(source.slice(start, end))} return { tp, sl };} result = prepare();`, s);
    assert.equal(s.result.tp, 0); assert.equal(s.result.sl, 90);
});
check('both confirmation call sites pass the same transformed TP', () => {
    const calls = [...source.matchAll(/CheckConfirmation\(ot, PositionSize, sets.StopLossLevel, RRNewOrderTakeProfit\(sets.TakeProfitLevel\)/g)];
    assert.equal(calls.length, 2);
});
check('runner confirmation explains virtual TP, retained share and terminal requirement', () => {
    const s = fixture(); s.CheckConfirmation(0, 0.32, 90, 0);
    assert.match(s.message, /平 75.00% \/ 保留 25.00%/);
    assert.match(s.message, /不设置服务器 TP/);
    assert.match(s.message, /到价后由 EA 市价平仓/);
    assert.match(s.message, /需保持 MT5\/EA 运行/);
    assert.match(s.message, /BE 按勾选目标触发/);
    assert.doesNotMatch(s.message, /TRANSLATION_LABEL_TAKEPROFIT:/);
});
check('full-exit RR confirmation describes market execution rather than a server TP', () => {
    const s = fixture(100); s.CheckConfirmation(0, 0.32, 90, 160);
    assert.match(s.message, /平 100.00% \/ 保留 0.00%/);
    assert.match(s.message, /到价后由 EA 市价平仓/);
    assert.doesNotMatch(s.message, /TRANSLATION_LABEL_TAKEPROFIT:/);
});
check('RR-disabled confirmation preserves the original actual server TP', () => {
    const s = fixture(100, false); s.CheckConfirmation(0, 0.32, 90, 160);
    assert.match(s.message, /TRANSLATION_LABEL_TAKEPROFIT: 160.00/);
});
check('virtual TP entry permits DoNotApplyTakeProfit but still requires server SL and a valid target preview', () => {
    const s = fixture(100); s.sets.DoNotApplyTakeProfit = true;
    assert.equal(s.RRBeforeTrade(), true);
    initializeTP(s);
    for (const execution of [1, 2]) {
        s.Execution_Mode = execution;
        const afterFill = source.match(/if \(!sets.DoNotApplyTakeProfit\) tp = TP\[j\];/)[0];
        vm.runInContext(`function prepare() {${adapt(marketPrep)} ${afterFill} return { order_tp, tp, sl };} result = prepare();`, s);
        assert.equal(s.result.order_tp, 0); assert.equal(s.result.tp, 0); assert.equal(s.result.sl, 90);
    }
    s.sets.DoNotApplyStopLoss = true; assert.equal(s.RRBeforeTrade(), false); assert.match(s.alert, /服务器止损/);
    s.sets.DoNotApplyStopLoss = false; s.sets.StopLossLevel = 0; assert.equal(s.RRBeforeTrade(), false);
    s.sets.StopLossLevel = 90; s.sets.TakeProfitLevel = 0; assert.equal(s.RRBeforeTrade(), false);
});
check('BE-only entry has no forced server TP and clearly retains 100 percent', () => {
    const s = fixture(); s.RRActivePlan = { count: 1, targets: [{ percent: 0 }] }; initializeTP(s);
    assert.equal(s.TP[0], 0); s.CheckConfirmation(0, 0.32, 90, 0);
    assert.match(s.message, /平 0.00% \/ 保留 100.00%/);
});
console.log(`${count} entry TP checks passed`);
