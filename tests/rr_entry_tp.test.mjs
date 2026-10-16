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
    const args = signature[1].split(',').map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    return `function ${name}(${args.join(',')}) {${adapt(text.slice(start, end - 1))}}`;
}
function fixture(total = 75, enabled = true) {
    const ctx = {
        RR_Enable: enabled, RR_MAX_TARGETS: 20,
        RRActivePlan: { count: 2, targets: [{ percent: 50 }, { percent: total - 50 }] },
        sets: { TakeProfitLevel: 150, EntryLevel: 100, StopLossLevel: 90, TakeProfitsNumber: 1,
            AccountButton: 0, EntryType: 1, DoNotApplyTakeProfit: false, DoNotApplyStopLoss: false },
        SYMBOL_TRADE_EXECUTION_MARKET: 1, Execution_Mode: 2, IgnoreMarketExecutionMode: false, Instant: 1, StopLimit: 2,
        TP: [150], j: 0, ArrayPositionSize: [0.32], _Digits: 2, LotStep_digits: 2,
        NormalizeDouble: (n, d) => Number(n.toFixed(d)), DoubleToString: (n, d = 2) => n.toFixed(d),
        AccountInfoString: () => 'USD', ACCOUNT_CURRENCY: 0,
        SymbolForTrading: 'XAUUSD', Period: () => 5, EnumToString: () => 'PERIOD_M5', StringSubstr: (s, n) => s.slice(n),
        OrderTypeToString: () => 'BUY', FormatDouble: String, AccSize: 1000, AccountCurrency: 'USD', OutputRiskMoney: 10,
        PositionMargin: 20, Balance: 0, Equity: 1, Balance_minus_Risk: 2,
        MB_OKCANCEL: 1, MB_ICONWARNING: 2, IDCANCEL: 2, TIME_DATE: 1, TIME_MINUTES: 2, TIME_SECONDS: 4,
        TimeToString: () => '', MessageBox: message => { ctx.message = message; return 1; }, Print: () => {},
    };
    for (const constant of new Set(source.match(/\bTRANSLATION_\w+/g))) ctx[constant] = constant;
    vm.createContext(ctx);
    for (const name of ['RRPlanTotalPercent', 'RRPlanClosesAll']) vm.runInContext(extract(planSource, name), ctx);
    for (const name of ['RRNewOrderTakeProfit', 'CheckConfirmation']) vm.runInContext(extract(source, name), ctx);
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
check('full-exit plan continues to install its server TP', () => {
    const s = fixture(100); initializeTP(s); assert.equal(s.TP[0], 150);
});
check('RR-disabled original entry preserves the ordinary TP', () => {
    const s = fixture(75, false); initializeTP(s); assert.equal(s.TP[0], 150);
});
const marketPrep = source.slice(source.indexOf('double order_sl = sets.StopLossLevel;'), source.indexOf('if ((order_tp != 0)'));
assert.ok(marketPrep.includes('double order_tp = NormalizeDouble(TP[j], _Digits);'));
for (const execution of [1, 2]) {
    check(`market TP preparation and deferred stop application retain runner TP zero, mode ${execution}`, () => {
        const s = fixture(); s.Execution_Mode = execution; initializeTP(s);
        const afterFill = source.match(/if \(!sets.DoNotApplyTakeProfit\) tp = TP\[j\];/)[0];
        vm.runInContext(`function prepare() {${adapt(marketPrep)} ${afterFill} return { order_tp, tp, order_sl, sl };} result = prepare();`, s);
        assert.equal(s.result.order_tp, 0); assert.equal(s.result.tp, 0); assert.equal(s.result.sl, 90);
        assert.equal(s.result.order_sl, execution === 1 ? 0 : 90);
    });
}
check('pending order preparation retains TP zero and initial SL', () => {
    const s = fixture(); initializeTP(s);
    const start = source.indexOf('double tp = NormalizeDouble(TP[j], _Digits);');
    const end = source.indexOf('if ((tp != 0)', start);
    vm.runInContext(`function prepare() {${adapt(source.slice(start, end))} return { tp, sl };} result = prepare();`, s);
    assert.equal(s.result.tp, 0); assert.equal(s.result.sl, 90);
});
check('both confirmation call sites pass the same transformed TP', () => {
    const calls = [...source.matchAll(/CheckConfirmation\(ot, PositionSize, sets.StopLossLevel, RRNewOrderTakeProfit\(sets.TakeProfitLevel\)/g)];
    assert.equal(calls.length, 2);
});
check('runner confirmation explains retained share and no server full TP', () => {
    const s = fixture(); s.CheckConfirmation(0, 0.32, 90, 0);
    assert.match(s.message, /平 75.00% \/ 保留 25.00%/);
    assert.match(s.message, /不设置服务器全平 TP/);
    assert.match(s.message, /BE 按勾选目标触发/);
    assert.doesNotMatch(s.message, /TRANSLATION_LABEL_TAKEPROFIT:/);
});
check('full-exit confirmation uses actual passed TP rather than stale preview', () => {
    const s = fixture(100); s.CheckConfirmation(0, 0.32, 90, 160);
    assert.match(s.message, /TRANSLATION_LABEL_TAKEPROFIT: 160.00/);
});
check('BE-only entry has no forced server TP and clearly retains 100 percent', () => {
    const s = fixture(); s.RRActivePlan = { count: 1, targets: [{ percent: 0 }] }; initializeTP(s);
    assert.equal(s.TP[0], 0); s.CheckConfirmation(0, 0.32, 90, 0);
    assert.match(s.message, /平 0.00% \/ 保留 100.00%/);
});
console.log(`${count} entry TP checks passed`);
