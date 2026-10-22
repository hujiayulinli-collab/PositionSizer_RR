// Execute the production entry gate, calculator limits, entry lock and full
// trading route against in-memory broker boundaries. No terminal is touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const trading = readFileSync(new URL('../mt5/Position Sizer Trading.mqh', import.meta.url), 'utf8');
const calculator = readFileSync(new URL('../mt5/Position Sizer.mqh', import.meta.url), 'utf8');
const central = readFileSync(new URL('../mt5/RRCentral.mqh', import.meta.url), 'utf8');
function extract(source, name) {
    const signature = new RegExp(`(?:bool|double|void) ${name}\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(signature, `Production ${name} exists`);
    const start = signature.index + signature[0].length;
    let depth = 1, end = start;
    for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    const args = signature[1].split(',').filter(a => a.trim()).map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    const body = source.slice(start, end - 1)
        .replace(/\b(?:RRPlan|MqlTradeResult)\s+(\w+)\s*;/g, 'let $1 = {};')
        .replace(/\b(?:double|ulong|ENUM_\w+)\s+(\w+\[\](?:,\s*\w+\[\])*)\s*;/g,
            (_, vars) => `let ${vars.replace(/\b(\w+)\[\]/g, '$1 = []')};`)
        .replace(/\bCTrade\s+\*Trade;/g, 'let Trade;')
        .replace(/\b(?:const\s+)?(?:double|bool|int|long|ulong|datetime|string|ENUM_\w+)\s+(?=\w+\s*(?:=|;|,))/g, 'let ')
        .replace(/\((?:ENUM_\w+|int|ulong|long|datetime)\)/g, '')
        .replace(/\bdelete Trade;/g, '/* in-memory trade object */');
    return `function ${name}(${args.join(',')}) {${body}}`;
}
function fixture(options = {}) {
    const s = {
        Instant: 0, Pending: 1, StopLimit: 2, Short: -1, Long: 1,
        RBEnabled: true, RR_Enable: true, savedBatch: true, settingsReadable: true,
        requested: 12, positions: [], orders: [], sends: [], batches: [], alerts: [], messages: [],
        events: [], guards: true, nettingSlot: true, entryClear: true, reserveAllowed: true,
        reverseQueued: false, preparingReverse: false, batchActive: false, accountBusy: false,
        confirmationAllowed: true, confirmEffect: null, volumeLimit: Infinity,
        marginMode: 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING',
        MinLot: 0.01, MaxLot: 20, LotStep: 0.01, LotStep_digits: 2, _Digits: 2,
        SymbolForTrading: 'EURUSD', _Symbol: 'EURUSD', bid: 100, ask: 100.02,
        CalculateUnadjustedPositionSize: false, SurpassBrokerMaxPositionSize: false,
        IgnoreMarketExecutionMode: false, WarningSL: '', DefaultCommentBalance: false,
        ShowFusesOnTrading: false, ShowMaxParametersOnTrading: false,
        RCResuming: false, RCQueuedVolume: 100, RCReversePending: false,
        RCCloseOpposite: false, RCEntryLock: -1, INVALID_HANDLE: -1,
        RRActivePlan: {}, AccSize: 50000, AccountCurrency: 'USD', PositionMargin: 0,
        Balance: 0, Equity: 1, Balance_minus_Risk: 2, DisableTradingSounds: true,
        sets: { EntryType: 1, TradeDirection: 1, EntryLevel: 99, StopLossLevel: 98, TakeProfitLevel: 104,
            StopPriceLevel: 101, MagicNumber: 123, TakeProfitsNumber: 1, ExpiryMinutes: 30,
            MaxSlippage: 20, AskForConfirmation: true, Commentary: 'original-comment', CommentAutoSuffix: false,
            DoNotApplyStopLoss: false, DoNotApplyTakeProfit: false, TrailingStopPoints: 0,
            BreakEvenPoints: 0, AccountButton: 0, SubtractPendingOrders: false, SubtractPositions: false },
        ...options,
    };
    const constants = new Set((trading + central).match(/\b(?:TRANSLATION|ACCOUNT|SYMBOL|ORDER|POSITION|TERMINAL|MQL|FILE|TIME|MB)_[A-Z_]+\b/g));
    for (const key of constants) s[key] = key;
    Object.assign(s, {
        MB_OKCANCEL: 1, MB_ICONWARNING: 2, IDCANCEL: 2, TIME_DATE: 1, TIME_MINUTES: 2, TIME_SECONDS: 4,
        MathAbs: Math.abs, MathRound: Math.round, MathFloor: Math.floor, MathMin: Math.min,
        NormalizeDouble: (n, d) => Number(n.toFixed(d)), DoubleToString: (n, d = 2) => n.toFixed(d),
        IntegerToString: String, FormatDouble: String, StringSubstr: (v, start) => v.slice(start),
        Period: () => 5, EnumToString: String, OrderTypeToString: String, Print: () => {},
        Alert: (...message) => s.alerts.push(message.join('')), TimeCurrent: () => 1000, TimeToString: String,
        AccountInfoString: () => 'USD', AccountInfoInteger: () => s.marginMode,
        SymbolInfoDouble: (_, key) => ({ SYMBOL_BID: s.bid, SYMBOL_ASK: s.ask, SYMBOL_TRADE_TICK_SIZE: 0.01,
            SYMBOL_VOLUME_STEP: s.LotStep, SYMBOL_VOLUME_MIN: s.MinLot })[key],
        SymbolInfoInteger: (_, key) => key === 'SYMBOL_TRADE_EXEMODE' ? 'SYMBOL_TRADE_EXECUTION_INSTANT' : 'SYMBOL_FILLING_FOK',
        RGCanOpen: () => { s.events.push('guard'); return s.guards; },
        RBLoadSettings: () => { s.events.push('settings'); s.RBEnabled = s.savedBatch; return s.settingsReadable; },
        RRPlanValidate: () => true, RRPlanVolumeValid: () => true, RRPlanTotalPercent: () => 100,
        RRNettingSlotAvailable: () => s.nettingSlot,
        RBQueue: volume => { s.batches.push(volume); return true; },
        TerminalInfoInteger: () => true, MQLInfoInteger: () => true,
        RCPreparingReverse: () => s.preparingReverse,
        RCQueueReverse: volume => { s.events.push(`reverse:${volume}`); return s.reverseQueued; },
        RCEntryClear: () => s.entryClear, RCReserveEntryVolume: () => s.reserveAllowed,
        MaxVolumeCheck: volume => Math.min(volume, s.volumeLimit),
        PositionSizeToArray: volume => { s.ArrayPositionSize = [volume]; },
        ArrayResize: (array, size) => { array.length = size; },
        RGManage: () => false, RRManage: () => { throw Error('No live RR manager in route fixture'); },
        MessageBox: message => { s.messages.push(message); s.confirmEffect?.(); return s.confirmationAllowed ? 1 : 2; },
        RBEntryActive: () => s.batchActive, RBAccountBusy: () => s.accountBusy,
        RCLoadOption: () => true, RRPlanRead: () => true, RRPlanFileName: () => 'memory-plan',
        RRHash: () => 1, FileOpen: () => 7, FileClose: () => {}, RCHasOppositeOrder: () => false,
    });
    s.CTrade = class {
        SetDeviationInPoints(value) { s.deviation = value; }
        SetExpertMagicNumber(value) { s.magic = value; }
        SetTypeFilling(value) { s.filling = value; }
        OrderOpen(symbol, type, volume, limitPrice, price, sl, tp, expiryType, expiry, comment) {
            s.sends.push({ symbol, type, volume, limitPrice, price, sl, tp, expiryType, expiry, comment }); return true;
        }
        PositionOpen() { throw Error('Unexpected direct market order'); }
        ResultOrder() { return 12345; }
    };
    s.ExtDialog = { RefreshValues: () => {
        s.OutputPositionSize = s.BrokerizePositionSize(s.requested);
        s.OutputRiskMoney = s.OutputPositionSize * 10;
        s.ArrayPositionSize = [s.OutputPositionSize];
    } };
    vm.createContext(s);
    for (const name of ['BrokerizePositionSize', 'AdjustPositionSizeByMinMaxStep']) vm.runInContext(extract(calculator, name), s);
    for (const name of ['RRNewOrderTakeProfit', 'RRBeforeTrade', 'RRCanSplitVolume', 'CheckConfirmation', 'RCTradeCore', 'Trade'])
        vm.runInContext(extract(trading, name), s);
    for (const name of ['RCTradeEnter', 'RCTradeLeave']) vm.runInContext(extract(central, name), s);
    s.ExtDialog.RefreshValues();
    return s;
}
let count = 0;
function check(name, callback) { callback(); console.log(`ok ${++count} - ${name}`); }
const pendingCases = [
    ['BUY_LIMIT', 1, 1, 99], ['BUY_STOP', 1, 1, 101], ['BUY_STOP_LIMIT', 2, 1, 99],
    ['SELL_LIMIT', 1, -1, 101], ['SELL_STOP', 1, -1, 99], ['SELL_STOP_LIMIT', 2, -1, 101],
];
for (const [type, entryType, direction, entry] of pendingCases) check(`batch enabled sends ordinary ${type} with original price, SL and expiry`, () => {
    const s = fixture(); Object.assign(s.sets, { EntryType: entryType, TradeDirection: direction,
        EntryLevel: entry, StopLossLevel: direction === 1 ? 98 : 102, StopPriceLevel: direction === 1 ? 101 : 99 });
    s.Trade();
    assert.equal(s.sends.length, 1); assert.deepEqual(s.batches, []);
    assert.equal(s.sends[0].type, `ORDER_TYPE_${type}`); assert.equal(s.sends[0].volume, 12);
    assert.equal(s.sends[0].price, entryType === 2 ? s.sets.StopPriceLevel : entry);
    assert.equal(s.sends[0].limitPrice, entryType === 2 ? entry : 0);
    assert.equal(s.sends[0].sl, s.sets.StopLossLevel); assert.equal(s.sends[0].tp, 0);
    assert.equal(s.sends[0].expiry, 2800); assert.equal(s.sends[0].expiryType, 'ORDER_TIME_SPECIFIED');
    assert.equal(s.sends[0].comment, 'original-comment'); assert.equal(s.magic, 123);
});
for (const entryType of [1, 2]) check(`batch option leaves pending type ${entryType} display, confirmation and send capped at broker maximum`, () => {
    const s = fixture({ requested: 40 }); s.sets.EntryType = entryType; s.Trade();
    assert.equal(s.OutputPositionSize, 20); assert.equal(s.OutputRiskMoney, 200);
    assert.equal(s.AdjustPositionSizeByMinMaxStep(40), 20);
    assert.match(s.messages[0], /TRANSLATION_MESSAGE_SIZE: 20.00/);
    assert.match(s.messages[0], /TRANSLATION_LABEL_RISK: 200.00/);
    assert.equal(s.sends.length, 1); assert.equal(s.sends[0].volume, 20); assert.deepEqual(s.batches, []);
});
check('market batch retains total size above broker maximum and queues a parent', () => {
    const s = fixture({ requested: 40 }); s.sets.EntryType = s.Instant; s.Trade();
    assert.equal(s.OutputPositionSize, 40); assert.equal(s.AdjustPositionSizeByMinMaxStep(40), 40);
    assert.match(s.messages[0], /TRANSLATION_MESSAGE_SIZE: 40.00/);
    assert.deepEqual(s.batches, [40]); assert.deepEqual(s.sends, []);
});
check('switching market to pending reapplies the broker cap before confirming', () => {
    const s = fixture({ requested: 40 }); s.sets.EntryType = s.Instant; s.ExtDialog.RefreshValues();
    assert.equal(s.OutputPositionSize, 40); s.sets.EntryType = s.Pending; s.Trade();
    assert.equal(s.OutputPositionSize, 20); assert.equal(s.sends[0].volume, 20);
    assert.match(s.messages[0], /TRANSLATION_MESSAGE_SIZE: 20.00/);
});
check('shared batch enable reload affects only market sizing and preserves pending submission', () => {
    for (const entryType of [0, 1, 2]) {
        const s = fixture({ RBEnabled: false, savedBatch: true, requested: 40 });
        s.sets.EntryType = entryType; s.Trade();
        assert.equal(s.RBEnabled, true);
        assert.equal(s.OutputPositionSize, entryType === 0 ? 40 : 20);
        assert.equal(s.batches.length, entryType === 0 ? 1 : 0);
        assert.equal(s.sends.length, entryType === 0 ? 0 : 1);
    }
});
check('RR disabled keeps ordinary pending SL and TP despite saved batch mode', () => {
    for (const entryType of [1, 2]) {
        const s = fixture({ RR_Enable: false }); s.sets.EntryType = entryType; s.Trade();
        assert.equal(s.sends.length, 1); assert.equal(s.sends[0].sl, 98); assert.equal(s.sends[0].tp, 104);
        assert.deepEqual(s.batches, []);
    }
});
check('batch market still refuses RR-disabled and non-hedging configurations', () => {
    for (const options of [{ RR_Enable: false }, { marginMode: 'ACCOUNT_MARGIN_MODE_RETAIL_NETTING' }]) {
        const s = fixture(options); s.sets.EntryType = s.Instant; s.Trade();
        assert.deepEqual(s.sends, []); assert.deepEqual(s.batches, []); assert.match(s.alerts[0], /市价分批开仓需要/);
    }
});
check('pending on an available netting slot is not rejected by the batch-only hedging rule', () => {
    const s = fixture({ marginMode: 'ACCOUNT_MARGIN_MODE_RETAIL_NETTING' }); s.Trade();
    assert.equal(s.sends.length, 1); assert.deepEqual(s.batches, []);
});
check('unreadable shared batch settings still block all order types', () => {
    for (const entryType of [0, 1, 2]) {
        const s = fixture({ settingsReadable: false }); s.sets.EntryType = entryType; s.Trade();
        assert.deepEqual(s.sends, []); assert.deepEqual(s.batches, []); assert.match(s.alerts[0], /读取失败/);
    }
});
check('existing parent entry or account lock blocks pending before preflight and confirmation', () => {
    for (const options of [{ batchActive: true }, { accountBusy: true }]) {
        const s = fixture(options); s.Trade();
        assert.deepEqual(s.events, []); assert.deepEqual(s.messages, []); assert.deepEqual(s.sends, []);
        assert.match(s.alerts[0], /正在分批开仓/);
    }
});
check('money guard blocks pending before settings reload', () => {
    const s = fixture({ guards: false }); s.Trade();
    assert.deepEqual(s.events, ['guard']); assert.deepEqual(s.sends, []);
});
check('a daily loss block arising during confirmation prevents pending submission', () => {
    const s = fixture(); s.confirmEffect = () => { s.guards = false; }; s.Trade();
    assert.equal(s.messages.length, 1); assert.deepEqual(s.sends, []);
});
check('pending submission still honors netting slot, reverse-clear and reserved-volume checks', () => {
    for (const key of ['nettingSlot', 'entryClear', 'reserveAllowed']) {
        const s = fixture(); s.confirmEffect = () => { s[key] = false; }; s.Trade();
        assert.equal(s.messages.length, 1); assert.deepEqual(s.sends, []);
    }
});
check('reverse close defers pending entry instead of submitting while opposite positions exist', () => {
    const s = fixture({ reverseQueued: true, preparingReverse: true }); s.Trade();
    assert.ok(s.events.includes('reverse:12')); assert.deepEqual(s.sends, []); assert.deepEqual(s.batches, []);
});
check('cancelling confirmation creates neither pending order nor batch', () => {
    const s = fixture({ confirmationAllowed: false }); s.Trade();
    assert.equal(s.messages.length, 1); assert.deepEqual(s.sends, []); assert.deepEqual(s.batches, []);
});
check('normal pending volume restrictions still reduce confirmation and submitted volume together', () => {
    const s = fixture({ volumeLimit: 7.5 }); s.Trade();
    assert.match(s.messages[0], /TRANSLATION_MESSAGE_SIZE: 7.50/); assert.equal(s.sends[0].volume, 7.5);
});
check('legacy explicit SurpassBrokerMaxPositionSize keeps its original non-RR pending split behavior', () => {
    const s = fixture({ RR_Enable: false, SurpassBrokerMaxPositionSize: true, requested: 40 }); s.Trade();
    assert.equal(s.OutputPositionSize, 40); assert.equal(s.AdjustPositionSizeByMinMaxStep(40), 40);
    assert.equal(s.sends.length, 2); assert.deepEqual(s.sends.map(order => order.volume), [20, 20]);
    assert.deepEqual(s.batches, []);
});
check('RR pending still rejects the incompatible legacy SurpassBrokerMaxPositionSize option', () => {
    const s = fixture({ SurpassBrokerMaxPositionSize: true }); s.Trade();
    assert.deepEqual(s.sends, []); assert.match(s.alerts[0], /SurpassBrokerMaxPositionSize/);
});
check('pending lot-step alignment remains intact with batch mode enabled', () => {
    const s = fixture({ requested: 10.637 }); s.Trade();
    assert.equal(s.OutputPositionSize, 10.63); assert.equal(s.sends[0].volume, 10.63);
    assert.equal(s.AdjustPositionSizeByMinMaxStep(10.637), 10.63);
});
console.log(`${count} pending entry routing checks passed`);
