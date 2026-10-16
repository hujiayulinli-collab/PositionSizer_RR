// Run production plan persistence/common-copy functions against an in-memory
// file boundary. This never accesses MT5 files, a terminal, or a trading account.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const planSource = readFileSync(new URL('../mt5/RRPlan.mqh', import.meta.url), 'utf8');
const centralSource = readFileSync(new URL('../mt5/RRCentral.mqh', import.meta.url), 'utf8');
function extract(source, name) {
    const match = new RegExp(`(?:bool|double|void|uint|string)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, name); const start = match.index + match[0].length; let end = start, depth = 1;
    for (; depth && end < source.length; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
    const args = match[1].split(',').filter(s => s.trim()).map(s => s.trim().split(/\s+/).at(-1).replace('&', ''));
    const body = source.slice(start, end - 1)
        .replace(/hash = \(hash \^ \(uint\)StringGetCharacter\(([^)]+)\)\) \* 16777619;/g, 'hash = Math.imul(hash ^ StringGetCharacter($1), 16777619) >>> 0;')
        .replace(/\bRRPlanRecord\s+(\w+)\s*;/g, 'let $1 = emptyRecord();')
        .replace(/\bRRPlan\s+(\w+)\s*;/g, 'let $1 = emptyPlan();')
        .replace(/\b(?:double|int|uint|bool|string)\s+(?=\w+\s*(?:=|;))/g, 'let ')
        .replace(/sizeof\(RRPlanRecord\)/g, 'RECORD_SIZE')
        .replace(/\(int\)be/g, 'Number(be)')
        .replace(/\berror\s*=/g, 'error.value =')
        .replace(/plan = record.plan;/g, 'Object.assign(plan, structuredClone(record.plan));')
        .replace(/record.plan = plan;/g, 'record.plan = structuredClone(plan);')
        .replace(/RRActivePlan = plan;/g, 'RRActivePlan = structuredClone(plan);');
    return `function ${name}(${args.join(',')}) {${body}}`;
}
const emptyPlan = () => ({ count: 0, targets: Array.from({ length: 20 }, () => ({ multiple: 0, percent: 0, move_be: 0 })) });
const emptyRecord = () => ({ version: 0, plan: emptyPlan(), checksum: 0 });
function plan(rows = [[2, 50, 1], [5, 50, 0]]) {
    const p = emptyPlan(); p.count = rows.length;
    rows.forEach(([multiple, percent, move_be = 0], i) => p.targets[i] = { multiple, percent, move_be }); return p;
}
function fixture() {
    const s = {
        RR_MAX_TARGETS: 20, RRActivePlan: emptyPlan(), RECORD_SIZE: 512,
        ACCOUNT_SERVER: 'server', ACCOUNT_LOGIN: 'login', account: 12345678n, server: 'Broker-Demo', chart: 987654321987654n, _Symbol: 'AUDUSD',
        FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, FILE_REWRITE: 8, INVALID_HANDLE: -1,
        files: new Map(), handles: new Map(), nextHandle: 1, busy: new Set(), writes: [], moves: [], reads: [], lastError: 0,
        failWrite: false, failFlush: false, failMove: false, failTempOpen: false,
        RCCommon: {}, RCCommonReady: false, RCCommonAccount: 0, RCCommonServer: '', sets: {},
        AccountInfoInteger: () => s.account, AccountInfoString: () => s.server, ChartID: () => s.chart,
        IntegerToString: String, DoubleToString: (n, digits) => n.toFixed(digits), StringLen: s => s.length,
        StringGetCharacter: (s, i) => s.charCodeAt(i), StringFormat: (text, ...values) => `${text} ${values.join(' ')}`,
        MathIsValidNumber: Number.isFinite, Math, emptyPlan, emptyRecord, structuredClone,
        ZeroMemory: value => Object.assign(value, 'version' in value ? emptyRecord() : emptyPlan()),
        ResetLastError: () => s.lastError = 0, GetLastError: () => s.lastError,
        FileIsExist: name => s.files.has(name),
        FileOpen: (name, flags) => {
            if (s.busy.has(name) || [...s.handles.values()].includes(name) || (s.failTempOpen && name.endsWith('.tmp'))) return -1;
            if ((flags & 2) && (!(flags & 1) || !s.files.has(name))) s.files.set(name, { record: emptyRecord(), size: 0 });
            if (!s.files.has(name)) return -1;
            const handle = s.nextHandle++; s.handles.set(handle, name); return handle;
        },
        FileSize: handle => s.files.get(s.handles.get(handle)).size,
        FileReadStruct: (handle, record) => {
            const name = s.handles.get(handle), file = s.files.get(name); s.reads.push(name);
            Object.assign(record, structuredClone(file.record)); return file.readBytes ?? file.size;
        },
        FileWriteStruct: (handle, record) => {
            const name = s.handles.get(handle); const size = s.failWrite ? 8 : s.RECORD_SIZE;
            s.files.set(name, { record: structuredClone(record), size }); s.writes.push(name); return size;
        },
        FileFlush: handle => { if (s.failFlush) s.lastError = 99; if (s.afterFlush) s.afterFlush(s.handles.get(handle)); },
        FileClose: handle => s.handles.delete(handle),
        FileMove: (from, _common, to, flags) => {
            s.moves.push({ from, to, flags }); if (s.beforeMove) s.beforeMove(from, to);
            if (s.failMove || !s.files.has(from) || (s.files.has(to) && !(flags & s.FILE_REWRITE))) return false;
            s.files.set(to, s.files.get(from)); s.files.delete(from); return true;
        },
    };
    vm.createContext(s);
    for (const name of ['RRPlanValidate', 'RRPlanDefaults', 'RRPlanChecksum', 'RRLegacyPlanFileName', 'RRPlanFileName', 'RRPlanRead', 'RRPlanSaveUnlocked', 'RRPlanApply', 'RRPlanInitialize'])
        vm.runInContext(extract(planSource, name), s);
    for (const name of ['RCCaptureCommon', 'RCApplyCommon']) vm.runInContext(extract(centralSource, name), s);
    s.record = p => ({ version: 1, plan: structuredClone(p), checksum: s.RRPlanChecksum(p) });
    s.put = (name, p = plan(), changes = {}) => s.files.set(name, { record: { ...s.record(p), ...changes }, size: s.RECORD_SIZE });
    s.init = (first = 2, percent = 50, final = 5, be = true) => { s.error = { value: '' }; return s.RRPlanInitialize(first, percent, final, be, s.error); };
    s.apply = p => { s.error = { value: '' }; return s.RRPlanApply(p, s.error); };
    return s;
}
let count = 0;
function check(name, fn) { fn(); console.log(`ok ${++count} - ${name}`); }
check('shared default filename is stable across chart and trading symbol', () => {
    const s = fixture(), name = s.RRPlanFileName(); s.chart = 55n; s._Symbol = 'XAUUSD.pro';
    assert.equal(s.RRPlanFileName(), name); assert.match(name, /RRPlan_Account_\d+_12345678\.bin$/);
});
check('shared default is isolated by both account login and broker server', () => {
    const s = fixture(), first = s.RRPlanFileName(); s.account = 87654321n; const second = s.RRPlanFileName();
    s.account = 12345678n; s.server = 'Broker-Live'; const third = s.RRPlanFileName();
    assert.equal(new Set([first, second, third]).size, 3);
});
check('filename preserves large account/chart identifiers without floating point truncation', () => {
    const s = fixture(); s.account = 12345678901234567n; assert.match(s.RRPlanFileName(), /_12345678901234567\.bin$/);
    assert.match(s.RRLegacyPlanFileName(), /_987654321987654_\d+\.bin$/);
});
check('legacy migration lookup remains specific to original chart and symbol', () => {
    const s = fixture(), first = s.RRLegacyPlanFileName(); s._Symbol = 'XAUUSD'; const second = s.RRLegacyPlanFileName();
    s.chart = 2n; assert.equal(new Set([first, second, s.RRLegacyPlanFileName()]).size, 3);
});
check('first installation persists validated input defaults to the account shared record', () => {
    const s = fixture(); assert.equal(s.init(1.5, 40, 6, false), true);
    const f = s.files.get(s.RRPlanFileName()); assert.equal(f.record.plan.targets[0].multiple, 1.5);
    assert.equal(f.record.plan.targets[0].percent, 40); assert.equal(f.record.plan.targets[0].move_be, 0);
    assert.equal(f.record.plan.targets[1].percent, 60); assert.equal(s.moves.length, 1); assert.equal(s.handles.size, 0);
});
check('first old-symbol migration carries custom targets and independent BE flags exactly', () => {
    const s = fixture(), old = plan([[1.25, 0, 1], [2.5, 30, 0], [7.125, 45, 1]]), legacy = s.RRLegacyPlanFileName();
    s.put(legacy, old); assert.equal(s.init(), true); assert.deepEqual(s.RRActivePlan, old);
    assert.deepEqual(s.files.get(s.RRPlanFileName()).record.plan, old); assert.equal(s.files.has(legacy), true);
});
check('existing shared plan wins over differing old-symbol file and current input defaults', () => {
    const s = fixture(), saved = plan([[4, 25, 1], [9, 50, 0]]); s.put(s.RRPlanFileName(), saved); s.put(s.RRLegacyPlanFileName(), plan());
    assert.equal(s.init(1, 80, 3, false), true); assert.deepEqual(s.RRActivePlan, saved);
    assert.equal(s.writes.length, 0); assert.equal(s.moves.length, 0); assert.deepEqual(s.reads, [s.RRPlanFileName()]);
});
check('second symbol or chart loads shared migration instead of importing its own old plan', () => {
    const s = fixture(), first = plan([[3, 20, 1], [8, 30, 1]]); s.put(s.RRLegacyPlanFileName(), first); assert.equal(s.init(), true);
    s._Symbol = 'EURUSD.a'; s.chart = 99n; s.put(s.RRLegacyPlanFileName(), plan([[2, 100, 0]])); const writes = s.writes.length;
    assert.equal(s.init(), true); assert.deepEqual(s.RRActivePlan, first); assert.equal(s.writes.length, writes);
});
check('corrupt existing shared plan is rejected without falling back to legacy or overwriting', () => {
    const s = fixture(); s.put(s.RRPlanFileName(), plan(), { checksum: 1 }); s.put(s.RRLegacyPlanFileName(), plan([[7, 100, 1]]));
    assert.equal(s.init(), false); assert.match(s.error.value, /校验失败/); assert.equal(s.writes.length, 0); assert.equal(s.moves.length, 0);
});
check('busy shared file cannot silently migrate or install fallback defaults', () => {
    const s = fixture(); s.put(s.RRPlanFileName()); s.busy.add(s.RRPlanFileName());
    assert.equal(s.init(), false); assert.match(s.error.value, /无法读取/); assert.equal(s.writes.length, 0);
});
check('legacy checksum failure aborts first migration without creating shared file', () => {
    const s = fixture(); s.put(s.RRLegacyPlanFileName(), plan(), { checksum: 123 });
    assert.equal(s.init(), false); assert.equal(s.files.has(s.RRPlanFileName()), false); assert.equal(s.writes.length, 0);
});
check('wrong version, record size, short read and invalid targets all block migration', () => {
    for (const damage of ['version', 'size', 'read', 'targets']) {
        const s = fixture(), name = s.RRLegacyPlanFileName(); s.put(name); const f = s.files.get(name);
        if (damage === 'version') f.record.version = 7;
        if (damage === 'size') f.size--;
        if (damage === 'read') f.readBytes = 10;
        if (damage === 'targets') f.record.plan.targets[1].multiple = 0;
        assert.equal(s.init(), false, damage); assert.equal(s.files.has(s.RRPlanFileName()), false); assert.equal(s.handles.size, 0);
    }
});
check('invalid initial inputs cannot create a shared default', () => {
    const s = fixture(); assert.equal(s.init(5, 50, 2), false); assert.equal(s.writes.length, 0); assert.equal(s.files.has(s.RRPlanFileName()), false);
});
check('incomplete write, flush error and failed rename preserve already saved shared plan', () => {
    for (const flag of ['failWrite', 'failFlush', 'failMove', 'failTempOpen']) {
        const s = fixture(); assert.equal(s.init(), true); const before = structuredClone(s.files.get(s.RRPlanFileName()));
        const active = structuredClone(s.RRActivePlan); s[flag] = true;
        assert.equal(s.apply(plan([[8, 100, 1]])), false, flag);
        assert.deepEqual(s.files.get(s.RRPlanFileName()), before); assert.deepEqual(s.RRActivePlan, active); assert.equal(s.handles.size, 0);
    }
});
check('corruption after flush fails verified temporary read before shared replacement', () => {
    const s = fixture(); assert.equal(s.init(), true); const before = structuredClone(s.files.get(s.RRPlanFileName()));
    s.afterFlush = name => s.files.get(name).record.checksum = 0;
    assert.equal(s.apply(plan([[6, 100, 1]])), false); assert.deepEqual(s.files.get(s.RRPlanFileName()), before);
});
check('account switch installs or reads that account plan without overwriting the earlier account', () => {
    const s = fixture(); assert.equal(s.init(1, 40, 4), true); const accountA = s.RRPlanFileName(), before = structuredClone(s.files.get(accountA));
    s.account = 9n; assert.equal(s.init(3, 60, 7), true); assert.notEqual(s.RRPlanFileName(), accountA);
    assert.equal(s.RRActivePlan.targets[0].multiple, 3); assert.deepEqual(s.files.get(accountA), before);
    s.account = 12345678n; assert.equal(s.init(), true); assert.equal(s.RRActivePlan.targets[0].multiple, 1);
});
check('first migration cannot race through another chart holding the shared plan lock', () => {
    const s = fixture(), name = s.RRPlanFileName(), lock = s.FileOpen(name + '.lock', 1 | 2 | 4);
    s.put(s.RRLegacyPlanFileName(), plan([[9, 100, 1]])); assert.equal(s.init(), false); assert.equal(s.writes.length, 0);
    const winner = plan([[3, 60, 1]]); s.put(name, winner); s.FileClose(lock);
    assert.equal(s.init(), true); assert.deepEqual(s.RRActivePlan, winner); assert.equal(s.writes.length, 0);
});
check('concurrent save lock failure preserves both saved plan and local active baseline', () => {
    const s = fixture(); assert.equal(s.init(), true); const original = structuredClone(s.RRActivePlan);
    const lock = s.FileOpen(s.RRPlanFileName() + '.lock', 1 | 2 | 4); assert.equal(s.apply(plan([[9, 100, 1]])), false);
    assert.deepEqual(s.RRActivePlan, original); assert.deepEqual(s.files.get(s.RRPlanFileName()).record.plan, original); s.FileClose(lock);
});
check('stale panel cannot overwrite a shared default saved by another chart', () => {
    const s = fixture(); assert.equal(s.init(), true); const original = structuredClone(s.RRActivePlan), newer = plan([[4, 60, 1]]);
    s.put(s.RRPlanFileName(), newer); const writes = s.writes.length;
    assert.equal(s.apply(plan([[9, 100, 1]])), false); assert.match(s.error.value, /其他面板/);
    assert.deepEqual(s.RRActivePlan, original); assert.deepEqual(s.files.get(s.RRPlanFileName()).record.plan, newer); assert.equal(s.writes.length, writes);
});
check('explicitly reloading the newer shared baseline allows a subsequent guarded save', () => {
    const s = fixture(); assert.equal(s.init(), true); s.put(s.RRPlanFileName(), plan([[4, 60, 1]]));
    assert.equal(s.RRPlanRead(s.RRPlanFileName(), s.RRActivePlan, { value: '' }), true);
    const next = plan([[5, 75, 1]]); assert.equal(s.apply(next), true); assert.deepEqual(s.RRActivePlan, next);
});

const common = {
    Risk: 0.7, MoneyRisk: 250, UseMoneyInsteadOfPercentage: true, RiskFromPositionSize: false, PositionSize: 0.35,
    AccountButton: 1, CustomBalance: 50000, IncludeOrders: 2, IgnoreOrdersWithoutSL: true, IgnoreOrdersWithoutTP: false,
    IncludeSymbols: 1, IncludeDirections: 2, CustomLeverage: 30, MagicNumber: 880066, Commentary: 'shared risk',
    DisableTradingWhenLinesAreHidden: true, MaxSlippage: 4, MaxSpread: 30, MaxEntrySLDistance: 900, MinEntrySLDistance: 15,
    MaxRiskPercentage: 1.5, MaxMarginPerc: 20, SubtractPositions: true, SubtractPendingOrders: false,
    DoNotApplyStopLoss: false, DoNotApplyTakeProfit: true, AskForConfirmation: false, CommentAutoSuffix: true,
    MaxNumberOfTradesTotal: 5, MaxNumberOfTradesPerSymbol: 2, MaxPositionSizeTotal: 4, MaxPositionSizePerSymbol: 1.2,
    MaxRiskTotal: 750, MaxRiskPerSymbol: 300, MaxMarginPercTotal: 60, MaxMarginPercPerSymbol: 20,
    ExpiryMinutes: 45, TrailingStopPoints: 15, BreakEvenPoints: 20,
};
const symbolA = { EntryLevel: 4300, StopLossLevel: 4290, TakeProfitLevel: 4350, StopPriceLevel: 4301,
    StopLoss: 100, TakeProfit: 500, CommissionPerLot: 7, CommissionType: 0, TP: [4350, 4370], TPShare: [50, 50],
    TradeDirection: 1, EntryType: 0, ATRMultiplierSL: 1.5, ATRMultiplierTP: 3, ATRPeriod: 14 };
const symbolB = { EntryLevel: 1.1, StopLossLevel: 1.09, TakeProfitLevel: 1.13, StopPriceLevel: 1.101,
    StopLoss: 50, TakeProfit: 100, CommissionPerLot: 0.02, CommissionType: 1, TP: [1.12, 1.13], TPShare: [30, 70],
    TradeDirection: -1, EntryType: 2, ATRMultiplierSL: 2, ATRMultiplierTP: 4, ATRPeriod: 20 };
check('capture freezes account common controls by value', () => {
    const s = fixture(); s.sets = { ...common, ...structuredClone(symbolA) }; s.RCCaptureCommon();
    s.sets.Risk = 9; s.sets.MagicNumber = 1; assert.equal(s.RCCommon.Risk, 0.7); assert.equal(s.RCCommon.MagicNumber, 880066);
    assert.equal(s.RCCommonReady, true); assert.equal(s.RCCommonAccount, s.account); assert.equal(s.RCCommonServer, s.server);
});
check('common controls restore across symbols including risk mode, magic and trading limits', () => {
    const s = fixture(); s.sets = { ...common, ...structuredClone(symbolA) }; s.RCCaptureCommon(); s._Symbol = 'EURUSD.a';
    s.sets = { ...Object.fromEntries(Object.keys(common).map(key => [key, null])), ...structuredClone(symbolB) };
    assert.equal(s.RCApplyCommon(), true);
    for (const [key, value] of Object.entries(common)) assert.equal(s.sets[key], value, key);
});
check('restoring common controls preserves the new symbol absolute entry, stop, TP and pending stop price', () => {
    const s = fixture(); s.sets = { ...common, ...structuredClone(symbolA) }; s.RCCaptureCommon(); s.sets = structuredClone(symbolB);
    assert.equal(s.RCApplyCommon(), true);
    for (const key of ['EntryLevel', 'StopLossLevel', 'TakeProfitLevel', 'StopPriceLevel', 'TP', 'TPShare']) assert.deepEqual(s.sets[key], symbolB[key]);
});
check('symbol commissions, stop distances, direction and ATR parameters do not leak across symbols', () => {
    const s = fixture(); s.sets = { ...common, ...structuredClone(symbolA) }; s.RCCaptureCommon(); s.sets = structuredClone(symbolB); s.RCApplyCommon();
    for (const key of ['CommissionPerLot', 'CommissionType', 'StopLoss', 'TakeProfit', 'TradeDirection', 'EntryType', 'ATRMultiplierSL', 'ATRMultiplierTP', 'ATRPeriod'])
        assert.equal(s.sets[key], symbolB[key], key);
});
check('uncaptured common state cannot overwrite currently loaded controls', () => {
    const s = fixture(); s.sets = { ...common, ...structuredClone(symbolB) }; const before = structuredClone(s.sets);
    assert.equal(s.RCApplyCommon(), false); assert.deepEqual(s.sets, before);
});
check('different account login prevents common control application without partially writing any fields', () => {
    const s = fixture(); s.sets = { ...common }; s.RCCaptureCommon(); s.account = 9n; s.sets = { Risk: 2, MagicNumber: 99, ...structuredClone(symbolB) };
    const before = structuredClone(s.sets); assert.equal(s.RCApplyCommon(), false); assert.deepEqual(s.sets, before);
});
check('same login on a different broker server cannot inherit common control values', () => {
    const s = fixture(); s.sets = { ...common }; s.RCCaptureCommon(); s.server = 'Broker-Live'; s.sets = { Risk: 2, MagicNumber: 99 };
    assert.equal(s.RCApplyCommon(), false); assert.deepEqual(s.sets, { Risk: 2, MagicNumber: 99 });
});
check('subsequent capture carries the newly edited risk while each symbol keeps its own prices', () => {
    const s = fixture(); s.sets = { ...common, ...structuredClone(symbolA) }; s.RCCaptureCommon(); s.sets = structuredClone(symbolB); s.RCApplyCommon();
    s.sets.Risk = 0.3; s.sets.MoneyRisk = 100; s.RCCaptureCommon(); s.sets = structuredClone(symbolA); s.RCApplyCommon();
    assert.equal(s.sets.Risk, 0.3); assert.equal(s.sets.MoneyRisk, 100); assert.equal(s.sets.EntryLevel, symbolA.EntryLevel);
    assert.equal(s.sets.CommissionPerLot, symbolA.CommissionPerLot);
});
console.log(`RR shared settings: ${count} production-function tests passed.`);
