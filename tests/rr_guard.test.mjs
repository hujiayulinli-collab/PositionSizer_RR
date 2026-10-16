// Execute actual guard methods against an in-memory account/file/executor boundary.
// These tests never open MT5, write its data directory, play sounds, or send orders.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRGuard.mqh', import.meta.url), 'utf8');
function extract(name) {
    const signature = new RegExp(`(?:void|bool|long|uint|string) ${name}\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(signature, `Production ${name}`);
    let depth = 1, end = signature.index + signature[0].length, start = end;
    for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    const args = signature[1].split(',').filter(Boolean).map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    const body = source.slice(start, end - 1)
        .replace(/sizeof\(RGDayState\)/g, 'RGDAY_SIZE')
        .replace(/\bMqlDateTime d;/g, 'let d = {};')
        .replace(/\bRGDayState s;/g, 'let s = makeDay();')
        .replace(/\b(?:const\s+)?(?:double|long|ulong|uint|int|string|bool|datetime)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:const\s+)?(?:double|long|ulong|uint|int|string|bool|datetime)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\((?:ulong|long|uint|int|datetime)\)/g, '')
        .replace('RGCancelOrder(ticket, RGDailyLocked ? "daily" : "", status)', 'RGCancelOrder(ticket, RGDailyLocked ? "daily" : "", value => status = value)')
        .replace('RGExitPosition(ticket, trigger, magic, status, first)', 'RGExitPosition(ticket, trigger, magic, value => status = value, value => first = value)');
    return `function ${name}(${args.join(',')}) {${body}}`;
}
const makeDay = () => ({ version: 0, account: 0, server_hash: 0, day: 0, locked: 0, drained: 0, limit: 0, trigger_net: 0, checksum: 0 });
function broker() {
    return { account: 1001, server: 'Demo', currency: 'USD', balance: 10000,
        now: Date.UTC(2026, 9, 1, 12) / 1000, tick: 1000,
        positions: [], orders: [], deals: [], files: new Map(), handles: new Map(), nextHandle: 1,
        openCalls: 0, historyCalls: 0, historyOK: true, writeOK: true, flushOK: true, openOK: true,
        executorAllowed: true, exitLatches: new Set(), cancelLatches: new Set(), executions: [], alerts: [], notices: [] };
}
function fixture(b = broker()) {
    const types = ['BUY', 'SELL', 'COMMISSION', 'COMMISSION_DAILY', 'COMMISSION_MONTHLY', 'COMMISSION_AGENT_DAILY', 'COMMISSION_AGENT_MONTHLY',
        'BALANCE', 'CREDIT', 'CHARGE', 'CORRECTION', 'BONUS', 'INTEREST', 'DIVIDEND', 'DIVIDEND_FRANKED', 'TAX', 'BUY_CANCELED', 'SELL_CANCELED'];
    const s = {
        RG_OWN_MAGIC: 0, RG_ENTIRE_ACCOUNT: 1, RGPositionScope: 0, RGPositionLossLimit: 0, RGDailyLossLimit: 0, RGShowStatus: true, RR_Enable: true,
        RGAccount: 0, RGServer: '', RGHistoryDirty: true, RGSnapshotReady: false, RGDailyLocked: false, RGEntryBlocked: false,
        RGRealized: 0, RGFloating: 0, RGCachedBalance: 0, RGCachedDay: 0, RGHistoryAt: 0, RGStatus: '', RGLastError: '',
        ACCOUNT_LOGIN: 'account', ACCOUNT_SERVER: 'server', ACCOUNT_CURRENCY: 'currency', ACCOUNT_BALANCE: 'balance',
        POSITION_MAGIC: 'magic', POSITION_IDENTIFIER: 'id', POSITION_PROFIT: 'profit', POSITION_SWAP: 'swap',
        DEAL_TYPE: 'type', DEAL_PROFIT: 'profit', DEAL_SWAP: 'swap', DEAL_COMMISSION: 'commission', DEAL_FEE: 'fee',
        FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, INVALID_HANDLE: -1, SEEK_END: 2, RGDAY_SIZE: 52,
        makeDay, MathIsValidNumber: Number.isFinite, MathMax: Math.max,
        GetTickCount64: () => b.tick, TimeCurrent: () => b.now,
        TimeToStruct: (time, d) => { const date = new Date(time * 1000); if (Number.isNaN(date.getTime())) return false;
            Object.assign(d, { year: date.getUTCFullYear(), mon: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), min: date.getUTCMinutes(), sec: date.getUTCSeconds() }); return true; },
        StructToTime: d => Date.UTC(d.year, d.mon - 1, d.day, d.hour, d.min, d.sec) / 1000,
        AccountInfoInteger: prop => b[prop], AccountInfoString: prop => b[prop], AccountInfoDouble: prop => b[prop],
        RRHash: text => { let hash = 2166136261; for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0; return hash; },
        StringFormat: (pattern, ...values) => { let i = 0; return pattern.replace(/%(?:I64[du]|u|d|s|\.2f)/g, token => token === '%.2f' ? Number(values[i++]).toFixed(2) : String(values[i++])); },
        DoubleToString: (n, digits = 8) => Number(n).toFixed(digits),
        ZeroMemory: obj => Object.assign(obj, makeDay()), ResetLastError: () => { s.lastError = 0; }, GetLastError: () => s.lastError || 0,
        FileIsExist: name => b.files.has(name),
        FileOpen: name => { b.openCalls++; if (!b.openOK) return -1; if (!b.files.has(name)) b.files.set(name, { records: [], extra: 0 });
            const handle = b.nextHandle++; b.handles.set(handle, { file: b.files.get(name), pos: 0 }); return handle; },
        FileSize: handle => { const f = b.handles.get(handle).file; return f.records.length * 52 + f.extra; },
        FileSeek: (handle, offset) => { const h = b.handles.get(handle); if (!h) return false; h.pos = s.FileSize(handle) + offset; return h.pos >= 0; },
        FileWriteStruct: (handle, state) => { if (!b.writeOK) return 0; b.handles.get(handle).file.records.push(structuredClone(state)); return 52; },
        FileReadStruct: (handle, state) => { const h = b.handles.get(handle), record = h.file.records[Math.floor(h.pos / 52)]; if (!record) return 0; Object.assign(state, structuredClone(record)); return 52; },
        FileFlush: () => { if (!b.flushOK) s.lastError = 5010; }, FileClose: handle => b.handles.delete(handle),
        HistorySelect: (from, to) => { b.historyCalls++; if (!b.historyOK) return false; s.selectedDeals = b.deals.filter(d => d.time >= from && d.time <= to); return true; },
        HistoryDealsTotal: () => s.selectedDeals.length,
        HistoryDealGetTicket: i => s.selectedDeals[i]?.ticket || 0,
        HistoryDealGetInteger: (id, prop) => b.deals.find(d => d.ticket === id)[prop],
        HistoryDealGetDouble: (id, prop) => b.deals.find(d => d.ticket === id)[prop] ?? 0,
        PositionsTotal: () => b.positions.length,
        PositionGetTicket: i => { s.position = b.positions[i]; return s.position?.ticket || 0; },
        PositionSelectByTicket: ticket => !!(s.position = b.positions.find(p => p.ticket === ticket)),
        PositionGetInteger: prop => s.position[prop],
        PositionGetDouble: prop => { if (b.positionReadHook) b.positionReadHook(prop); return s.position[prop] ?? 0; },
        OrdersTotal: () => b.orders.length, OrderGetTicket: i => b.orders[i]?.ticket || 0,
        RGOrderCancelLatched: id => b.cancelLatches.has(id), RGPositionExitLatched: id => b.exitLatches.has(id),
        RGCancelOrder: (ticket, trigger, setStatus) => {
            b.executions.push({ kind: 'cancel', ticket, trigger }); b.cancelLatches.add(ticket);
            if (!b.executorAllowed) { setStatus('算法交易未允许'); return false; }
            b.orders = b.orders.filter(o => o.ticket !== ticket); return true;
        },
        RGExitPosition: (ticket, trigger, magic, setStatus, setFirst) => {
            b.executions.push({ kind: 'close', ticket, trigger, magic }); const p = b.positions.find(p => p.ticket === ticket);
            const first = !b.exitLatches.has(p.id); b.exitLatches.add(p.id); setFirst(first);
            if (first) s.RGOnPositionLatched(ticket);
            if (!b.executorAllowed) { setStatus('算法交易未允许'); return false; }
            b.positions = b.positions.filter(p => p.ticket !== ticket); return true;
        },
        RDPlayRiskAlert: message => b.alerts.push(message), Alert: (...text) => b.alerts.push(text.join('')),
        Print: (...text) => b.notices.push(text.join('')), RRNotice: text => b.notices.push(text),
    };
    for (const [i, type] of types.entries()) s['DEAL_TYPE_' + type] = i;
    s.DEAL_DIVIDEND = s.DEAL_TYPE_DIVIDEND; s.DEAL_DIVIDEND_FRANKED = s.DEAL_TYPE_DIVIDEND_FRANKED; s.DEAL_TAX = s.DEAL_TYPE_TAX;
    vm.createContext(s);
    for (const name of ['RGDayStart', 'RGLimitHit', 'RGTradingDealType', 'RGPositionInScope', 'RGDailyFileName', 'RGDayChecksum',
        'RGSaveDay', 'RGLoadDay', 'RGAdvanceDay', 'RGReadSnapshot', 'RGResetContext', 'RGValidateInputs', 'RGOnPositionLatched', 'RGManage', 'RGCanOpen'])
        vm.runInContext(extract(name), s);
    s.deal = (ticket, profit = 0, extra = {}) => { const d = { ticket, type: s.DEAL_TYPE_SELL, time: b.now, profit, swap: 0, commission: 0, fee: 0, ...extra }; b.deals.push(d); return d; };
    s.pos = (ticket, profit = 0, extra = {}) => { const p = { ticket, id: ticket + 10000, magic: 42, symbol: 'XAUUSD', profit, swap: 0, ...extra }; b.positions.push(p); return p; };
    s.seed = (overrides = {}) => {
        const day = { ...makeDay(), version: 1, account: b.account, server_hash: s.RRHash(b.server), day: s.RGDayStart(b.now), ...overrides };
        day.checksum = s.RGDayChecksum(day); b.files.set(s.RGDailyFileName(), { records: [day], extra: 0 }); return day;
    };
    s.latest = () => b.files.get(s.RGDailyFileName())?.records.at(-1);
    return s;
}
let count = 0;
function check(name, test) { test(); console.log(`ok ${++count} - ${name}`); }

check('threshold is inclusive and zero/nonfinite limits cannot trigger', () => {
    const s = fixture(); assert.equal(s.RGLimitHit(-500, 500), true); assert.equal(s.RGLimitHit(-499.99, 500), false);
    for (const cap of [0, -1, NaN, Infinity]) assert.equal(s.RGLimitHit(-500, cap), false);
    assert.equal(s.RGLimitHit(NaN, 500), false);
});
check('server day normalization handles midnight and unavailable time', () => {
    const s = fixture(); assert.equal(s.RGDayStart(Date.UTC(2026, 9, 1, 23, 59, 59) / 1000), Date.UTC(2026, 9, 1) / 1000);
    assert.equal(s.RGDayStart(0), 0);
});
check('today accounting includes trade profit swap commission fee and excludes cash operations', () => {
    const b = broker(), s = fixture(b); s.deal(1, -200, { swap: -10, commission: -5, fee: -2 }); s.deal(2, 100, { type: s.DEAL_TYPE_BUY, commission: -3 });
    for (const type of [s.DEAL_TYPE_BALANCE, s.DEAL_TYPE_CREDIT, s.DEAL_TYPE_BONUS, s.DEAL_TYPE_CORRECTION]) s.deal(10 + type, 100000, { type });
    assert.equal(s.RGReadSnapshot(b.now, true), true); assert.equal(s.RGRealized, -120);
});
check('standalone daily monthly and agent commissions count as trading costs', () => {
    const b = broker(), s = fixture(b);
    for (const type of [s.DEAL_TYPE_COMMISSION, s.DEAL_TYPE_COMMISSION_DAILY, s.DEAL_TYPE_COMMISSION_MONTHLY, s.DEAL_TYPE_COMMISSION_AGENT_DAILY, s.DEAL_TYPE_COMMISSION_AGENT_MONTHLY]) s.deal(type + 1, -2, { type });
    s.RGReadSnapshot(b.now, true); assert.equal(s.RGRealized, -10);
});
check('separate charges interest dividends and tax all affect daily net', () => {
    const b = broker(), s = fixture(b); s.deal(1, -10, { type: s.DEAL_TYPE_CHARGE }); s.deal(2, -20, { type: s.DEAL_TYPE_INTEREST });
    s.deal(3, 30, { type: s.DEAL_DIVIDEND }); s.deal(4, 40, { type: s.DEAL_DIVIDEND_FRANKED }); s.deal(5, -5, { type: s.DEAL_TAX });
    s.RGReadSnapshot(b.now, true); assert.equal(s.RGRealized, 35);
});
check('canceled buy and sell deals do not masquerade as new trading profit or loss', () => {
    const b = broker(), s = fixture(b); s.deal(1, -100000, { type: s.DEAL_TYPE_BUY_CANCELED }); s.deal(2, 100000, { type: s.DEAL_TYPE_SELL_CANCELED });
    assert.equal(s.RGTradingDealType(s.DEAL_TYPE_BUY_CANCELED), false); assert.equal(s.RGTradingDealType(s.DEAL_TYPE_SELL_CANCELED), false);
    s.RGReadSnapshot(b.now, true); assert.equal(s.RGRealized, 0);
});
check('daily snapshot covers every symbol and magic rather than only manager trades', () => {
    const b = broker(), s = fixture(b); s.deal(1, -100, { symbol: 'EURUSD', magic: 0 }); s.deal(2, -200, { symbol: 'XAUUSD', magic: 777 });
    s.pos(10, -30, { magic: 0, symbol: 'GBPUSD' }); s.pos(11, -40, { magic: 777, symbol: 'BTCUSD' });
    s.RGReadSnapshot(b.now, true); assert.equal(s.RGRealized, -300); assert.equal(s.RGFloating, -70);
});
check('daily net includes current floating and overnight swap but excludes yesterday realized', () => {
    const b = broker(), s = fixture(b); s.deal(1, -900, { time: s.RGDayStart(b.now) - 1 }); s.deal(2, 100);
    s.pos(10, -300, { swap: -20, opened: b.now - 172800 }); s.RGReadSnapshot(b.now, true);
    assert.equal(s.RGRealized, 100); assert.equal(s.RGFloating, -320);
});
check('realized profit offsets realized loss before the daily threshold check', () => {
    const b = broker(), s = fixture(b); s.RGDailyLossLimit = 1000; s.deal(1, -1100); s.deal(2, 200); s.pos(10, 0);
    assert.equal(s.RGManage(42), true); assert.equal(s.RGDailyLocked, false); assert.equal(b.executions.length, 0);
});
check('minus 2500 realized plus minus 400 floating triggers exactly a 2900 cap', () => {
    const b = broker(), s = fixture(b); s.RGDailyLossLimit = 2900; s.deal(1, -2500); s.pos(10, -400);
    assert.equal(s.RGManage(42), false); assert.equal(s.RGDailyLocked, true); assert.equal(s.latest().trigger_net, -2900);
    assert.equal(s.latest().drained, 1); assert.equal(b.alerts.length, 1);
});
check('daily trigger cancels all-symbol all-magic pending orders before any position closes', () => {
    const b = broker(), s = fixture(b); s.RGDailyLossLimit = 500; s.deal(1, -503);
    s.pos(10, 1, { magic: 0 }); s.pos(11, 2, { magic: 777, symbol: 'EURUSD' });
    b.orders.push({ ticket: 20, magic: 0, symbol: 'GBPUSD' }, { ticket: 21, magic: 777, symbol: 'BTCUSD' }); s.RGManage(42);
    assert.deepEqual(b.executions.map(e => e.kind), ['cancel', 'cancel', 'close', 'close']);
    assert.equal(b.positions.length + b.orders.length, 0); assert.ok(b.executions.every(e => e.trigger === 'daily'));
});
check('single-position own-magic limit spans symbols and leaves unrelated exposure intact', () => {
    const b = broker(), s = fixture(b); s.RGPositionLossLimit = 500;
    s.pos(10, -500, { symbol: 'EURUSD' }); s.pos(11, -600, { symbol: 'XAUUSD', magic: 777 }); s.pos(12, -300, { swap: -200 });
    b.orders.push({ ticket: 20 }); s.RGManage(42);
    assert.deepEqual(b.executions.map(e => e.ticket).sort(), [10, 12]); assert.equal(b.orders.length, 1); assert.equal(b.positions[0].ticket, 11);
});
check('single-position entire-account scope includes manual and other-magic positions', () => {
    const b = broker(), s = fixture(b); s.RGPositionLossLimit = 500; s.RGPositionScope = s.RG_ENTIRE_ACCOUNT;
    s.pos(10, -500, { magic: 0 }); s.pos(11, -500, { magic: 777 }); s.RGManage(42);
    assert.equal(b.positions.length, 0); assert.equal(b.alerts.length, 2);
});
check('both caps disabled on a fresh install neither create a daily file nor block entry', () => {
    const b = broker(), s = fixture(b); b.openOK = false; b.historyOK = false; s.pos(10, -100000);
    assert.equal(s.RGCanOpen(42), true); assert.equal(b.openCalls, 0); assert.equal(b.files.size, 0); assert.equal(b.executions.length, 0);
});
check('single-position protection does not depend on creating an unused daily journal', () => {
    const b = broker(), s = fixture(b); s.RGPositionLossLimit = 500; b.openOK = false; s.pos(10, -500);
    assert.equal(s.RGManage(42), true); assert.equal(b.openCalls, 0); assert.equal(b.positions.length, 0);
});
check('disabled caps still honor an existing daily lock after restart and recovered PnL', () => {
    const b = broker(), s = fixture(b); s.seed({ locked: 1, limit: 500, trigger_net: -600 }); s.pos(10, 100);
    assert.equal(s.RGManage(42), false); assert.equal(b.positions.length, 0); assert.equal(b.alerts.length, 0); assert.equal(s.latest().locked, 1);
});
check('existing single-exit latch continues below threshold and after the cap is disabled', () => {
    const b = broker(), s = fixture(b); const p = s.pos(10, 100); b.exitLatches.add(p.id); s.RGManage(42);
    assert.equal(b.positions.length, 0); assert.equal(b.executions[0].trigger, '');
});
check('existing order-cancel latch continues without an active daily threshold', () => {
    const b = broker(), s = fixture(b); b.orders.push({ ticket: 20 }); b.cancelLatches.add(20); s.RGManage(42);
    assert.equal(b.orders.length, 0); assert.equal(b.executions[0].kind, 'cancel');
});
check('a fresh trigger never sends cancellation or close attempts when durable save fails', () => {
    const b = broker(), s = fixture(b); s.seed(); s.RGDailyLossLimit = 500; s.pos(10, -500); b.orders.push({ ticket: 20 }); b.writeOK = false;
    assert.equal(s.RGManage(42), false); assert.equal(b.executions.length, 0); assert.equal(b.alerts.length, 0); assert.equal(s.latest().locked, 0);
});
check('flush failure likewise blocks new trade execution attempts', () => {
    const b = broker(), s = fixture(b); s.seed(); s.RGDailyLossLimit = 500; s.pos(10, -500); b.flushOK = false;
    assert.equal(s.RGManage(42), false); assert.equal(b.executions.length, 0);
});
check('executor permission failure remains latched and resumes when execution becomes available', () => {
    const b = broker(), s = fixture(b); s.RGDailyLossLimit = 500; s.pos(10, -500); b.executorAllowed = false;
    assert.equal(s.RGManage(42), false); assert.equal(b.positions.length, 1); assert.equal(s.latest().locked, 1); assert.match(s.RGStatus, /算法交易未允许/);
    b.positions[0].profit = 100; b.executorAllowed = true; s.RGManage(42); assert.equal(b.positions.length, 0); assert.equal(b.alerts.length, 1);
});
check('day advance retains unfinished liquidation and clears only a fully drained old lock', () => {
    const s = fixture(); const state = s.seed({ locked: 1, drained: 0, limit: 500, trigger_net: -500 }); const next = state.day + 86400;
    assert.equal(s.RGAdvanceDay(state, next), false); assert.equal(state.locked, 1);
    state.drained = 1; assert.equal(s.RGAdvanceDay(state, next), true); assert.equal(state.day, next); assert.equal(state.locked, 0); assert.equal(state.limit, 0);
});
check('unfinished prior-day lock liquidates first then clears on the following manager pass', () => {
    const b = broker(), s = fixture(b); s.seed({ day: s.RGDayStart(b.now) - 86400, locked: 1, drained: 0, limit: 500, trigger_net: -500 }); s.pos(10, 100);
    assert.equal(s.RGManage(42), false); assert.equal(s.latest().drained, 1); assert.equal(s.latest().locked, 1);
    assert.equal(s.RGManage(42), true); assert.equal(s.latest().day, s.RGDayStart(b.now)); assert.equal(s.latest().locked, 0);
});
check('same-day drained lock closes newly added exposure without issuing another breach alert', () => {
    const b = broker(), s = fixture(b); s.seed({ locked: 1, drained: 1, limit: 500, trigger_net: -500 }); s.pos(10, 100); b.orders.push({ ticket: 20 });
    assert.equal(s.RGManage(42), false); assert.equal(b.positions.length + b.orders.length, 0); assert.equal(b.alerts.length, 0); assert.equal(s.latest().drained, 1);
});
check('fully drained prior-day lock resets before considering new day exposure', () => {
    const b = broker(), s = fixture(b); s.seed({ day: s.RGDayStart(b.now) - 86400, locked: 1, drained: 1, limit: 500, trigger_net: -500 }); s.pos(10, 100);
    assert.equal(s.RGManage(42), true); assert.equal(b.executions.length, 0); assert.equal(s.latest().locked, 0);
});
check('daily lock blocks RGCanOpen even when RR management itself is disabled', () => {
    const b = broker(), s = fixture(b); s.RR_Enable = false; s.seed({ locked: 1, drained: 1, limit: 500, trigger_net: -500 });
    assert.equal(s.RGCanOpen(42), false); assert.match(b.alerts.at(-1), /亏损保护/);
});
check('unavailable current history blocks fresh entry while an enabled daily cap is being checked', () => {
    const b = broker(), s = fixture(b); s.RGDailyLossLimit = 500; b.historyOK = false;
    assert.equal(s.RGCanOpen(42), false); assert.equal(b.executions.length, 0); assert.equal(s.RGSnapshotReady, false);
});
check('persisted daily liquidation continues even while account history is temporarily unavailable', () => {
    const b = broker(), s = fixture(b); s.seed({ locked: 1, limit: 500, trigger_net: -500 }); s.pos(10, 100); b.historyOK = false;
    assert.equal(s.RGManage(42), false); assert.equal(b.positions.length, 0);
});
check('snapshot cache still updates floating on each pass and refreshes history after one second', () => {
    const b = broker(), s = fixture(b); s.deal(1, -100); const p = s.pos(10, -10); s.RGReadSnapshot(b.now, false);
    p.profit = -20; b.tick += 999; s.RGReadSnapshot(b.now, false); assert.equal(b.historyCalls, 1); assert.equal(s.RGFloating, -20);
    b.tick += 1; s.RGReadSnapshot(b.now, false); assert.equal(b.historyCalls, 2);
});
check('server midnight invalidates yesterday history cache even inside its one-second window', () => {
    const b = broker(), s = fixture(b); b.now = Date.UTC(2026, 9, 1, 23, 59, 59) / 1000; s.deal(1, -500); s.RGReadSnapshot(b.now, false);
    b.now += 1; b.tick += 1; s.deal(2, -10); s.RGReadSnapshot(b.now, false);
    assert.equal(b.historyCalls, 2); assert.equal(s.RGRealized, -10);
});
check('balance change and dirty transaction force the history cache to refresh', () => {
    const b = broker(), s = fixture(b); s.RGReadSnapshot(b.now, false); b.balance += 100; s.RGReadSnapshot(b.now, false);
    s.RGHistoryDirty = true; s.RGReadSnapshot(b.now, false); assert.equal(b.historyCalls, 3);
});
check('snapshot rejects account mutation or nonfinite floating rather than publishing mixed totals', () => {
    const b = broker(), s = fixture(b); s.pos(10, -10); b.positionReadHook = () => { b.positionReadHook = null; b.balance += 10; };
    assert.equal(s.RGReadSnapshot(b.now, true), false); assert.equal(s.RGHistoryDirty, true);
    b.positions[0].profit = NaN; assert.equal(s.RGReadSnapshot(b.now, true), false);
});
check('corrupt day journal or future server date fails closed without sending exposure changes', () => {
    const b = broker(), s = fixture(b); s.seed({ locked: 1, limit: 500 }); s.latest().checksum ^= 1; s.pos(10, -1000);
    assert.equal(s.RGManage(42), false); assert.equal(b.executions.length, 0);
    s.seed({ day: s.RGDayStart(b.now) + 86400 }); assert.equal(s.RGManage(42), false); assert.equal(b.executions.length, 0);
});
check('truncated journal record is rejected and no guard execution starts', () => {
    const b = broker(), s = fixture(b); s.seed(); b.files.get(s.RGDailyFileName()).extra = 1; s.pos(10, -1000); s.RGDailyLossLimit = 500;
    assert.equal(s.RGManage(42), false); assert.equal(b.executions.length, 0);
});
check('account or broker changes reset cached totals and choose a different daily record', () => {
    const b = broker(), s = fixture(b); s.RGDailyLossLimit = 500; s.deal(1, -100); s.RGManage(42); const old = s.RGDailyFileName();
    b.account = 2002; b.server = 'Other'; b.deals = []; s.RGManage(42);
    assert.notEqual(s.RGDailyFileName(), old); assert.equal(s.RGRealized, 0); assert.equal(s.RGAccount, 2002);
});
check('input validation rejects negative nonfinite limits and unknown position scope', () => {
    const s = fixture(); assert.equal(s.RGValidateInputs(), true);
    s.RGPositionLossLimit = -1; assert.equal(s.RGValidateInputs(), false); s.RGPositionLossLimit = 0;
    s.RGDailyLossLimit = Infinity; assert.equal(s.RGValidateInputs(), false); s.RGDailyLossLimit = 0;
    s.RGPositionScope = 99; assert.equal(s.RGValidateInputs(), false);
});
console.log(`RR guard: ${count} production-method tests passed.`);
