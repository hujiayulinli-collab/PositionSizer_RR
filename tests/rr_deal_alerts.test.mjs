// Run production notification methods against in-memory MT5 boundaries only.
// No real audio, terminal, account, or trade request is used by this test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRDealAlerts.mqh', import.meta.url), 'utf8');
function extract(name) {
    const signature = new RegExp(`(?:void|bool|int|uint|string) ${name}\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(signature, `Production function ${name}`);
    let depth = 1, end = signature.index + signature[0].length, start = end;
    for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    const args = signature[1].split(',').filter(Boolean).map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    let body = source.slice(start, end - 1)
        .replace(/\b(?:int|uint|long|ulong|double|string|bool)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:int|uint|long|ulong|double|string|bool)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\((?:int|uint|long|ulong|double)\)/g, '')
        .replace('hash = (hash ^ StringGetCharacter(text, i)) * 16777619;', 'hash = Math.imul(hash ^ StringGetCharacter(text, i), 16777619) >>> 0;');
    return `function ${name}(${args.join(',')}) {${body}}`;
}
function terminal() {
    return { globals: new Map(), deals: new Map(), now: 1000, serverTime: 200000,
        account: 123, server: 'Demo-A', reads: [], output: [], failFiles: new Set(), tempFailure: false };
}
function fixture(t = terminal(), chart = 'a') {
    const s = {
        RDCurrentEnableTradeSound: true, RDCurrentTradeSound: 'ok.wav', RDCurrentLossSound: 'alert.wav',
        RDPendingDeals: [], RDPendingCursor: 0, RDAccountKey: '', RDStartedServerMs: 0,
        RDLastErrorNotice: 0, RDHasErrorNotice: false,
        ACCOUNT_SERVER: 'server', ACCOUNT_LOGIN: 'account', DEAL_TYPE: 'type', DEAL_TIME_MSC: 'time',
        DEAL_TYPE_BUY: 0, DEAL_TYPE_SELL: 1, TRADE_TRANSACTION_DEAL_ADD: 'deal_add', lastError: 0,
        AccountInfoString: prop => t[prop], AccountInfoInteger: prop => t[prop],
        StringLen: v => v.length, StringGetCharacter: (v, i) => v.charCodeAt(i),
        IntegerToString: String, StringFormat: (pattern, id) => String(id),
        MathMax: Math.max, MathMin: Math.min, GetTickCount64: () => t.now, TimeCurrent: () => t.serverTime,
        ArrayResize: (a, size) => { a.length = size; return size; }, ArraySize: a => a.length,
        ResetLastError: () => { s.lastError = 0; }, GetLastError: () => s.lastError,
        Print: (...args) => t.output.push({ chart, kind: 'log', text: args.join('') }),
        Alert: text => t.output.push({ chart, kind: 'alert', text }),
        PlaySound: file => { t.output.push({ chart, kind: 'sound', file }); if (t.failFiles.has(file)) { s.lastError = 5019; return false; } return true; },
        HistoryDealSelect: id => { t.reads.push(id); return t.deals.has(id) && t.deals.get(id).available !== false; },
        HistoryDealGetInteger: (id, prop) => t.deals.get(id)[prop],
        GlobalVariableTemp: key => {
            if (t.tempFailure) { s.lastError = 4501; return false; }
            if (!t.globals.has(key)) t.globals.set(key, 0); return true;
        },
        GlobalVariableGet: key => { if (!t.globals.has(key)) { s.lastError = 4501; return 0; } return t.globals.get(key); },
        GlobalVariableSetOnCondition: (key, value, expected) => {
            const hook = t.beforeCAS; if (hook) hook({ key, value, expected, chart });
            if (!t.globals.has(key)) { s.lastError = 4501; return false; }
            if (t.globals.get(key) !== expected) return false;
            t.globals.set(key, value); return true;
        },
    };
    vm.createContext(s);
    for (const name of ['RDHash', 'RDAccountPrefix', 'RDInitAlerts', 'RDSyncAlertAccount', 'RDNotice', 'RDPlayFile',
        'RDClaimSoundWindow', 'RDTryDealAlert', 'RDOnTransaction', 'RDFlushAlerts', 'RDPlayRiskAlert'])
        vm.runInContext(extract(name), s);
    s.RDInitAlerts();
    s.event = (id, type = 0, magic = 42) => s.RDOnTransaction({ type: 'deal_add', deal: id, deal_type: type }, magic);
    s.flush = () => s.RDFlushAlerts(42);
    s.add = (id, type = 0, extra = {}) => { t.deals.set(id, { type, time: t.serverTime * 1000, ...extra }); return id; };
    s.sounds = () => t.output.filter(e => e.kind === 'sound');
    return s;
}
let count = 0;
function check(name, test) { test(); console.log(`ok ${++count} - ${name}`); }

check('initialization does not scan history or replay existing deals', () => {
    const t = terminal(); t.deals.set(1, { type: 0, time: 1 }); const s = fixture(t); s.flush();
    assert.equal(t.reads.length, 0); assert.equal(s.sounds().length, 0);
});
check('only trade DEAL_ADD callbacks enter the queue', () => {
    const s = fixture();
    for (const type of ['order_add', 'order_delete', 'deal_update', 'request', 'position']) s.RDOnTransaction({ type, deal: 1, deal_type: 0 }, 42);
    s.event(2, 2); s.event(0); assert.equal(s.RDPendingDeals.length, 0);
});
check('transaction callback queues work without blocking on history or playing audio', () => {
    const t = terminal(); const s = fixture(t); s.event(s.add(1));
    assert.deepEqual([...s.RDPendingDeals], [1]); assert.equal(t.reads.length, 0); assert.equal(s.sounds().length, 0);
    s.flush(); assert.equal(s.sounds().length, 1); assert.equal(s.RDPendingDeals.length, 0);
});
check('actual buy and sell fills cover manual, EA, SL, TP, partial exit, and reversal reasons', () => {
    const t = terminal(); const s = fixture(t);
    for (const [i, reason] of ['manual', 'expert', 'sl', 'tp', 'partial', 'reverse'].entries()) {
        s.event(s.add(i + 1, i % 2, { magic: i, reason, entry: i % 3 }), i % 2, 9999); s.flush(); t.now += 701;
    }
    assert.equal(s.sounds().length, 6); assert.ok(s.sounds().every(e => e.file === 'ok.wav'));
});
check('history verifies type and excludes balance or credit records', () => {
    const s = fixture(); s.event(s.add(1, 2), 0); s.flush();
    assert.equal(s.sounds().length, 0); assert.equal(s.RDPendingDeals.length, 0);
});
check('temporarily unavailable history stays queued until the deal can be verified', () => {
    const t = terminal(); const s = fixture(t); s.event(1); s.flush(); s.flush();
    assert.deepEqual([...s.RDPendingDeals], [1]); assert.equal(s.sounds().length, 0);
    s.add(1); s.flush(); assert.equal(s.sounds().length, 1); assert.equal(s.RDPendingDeals.length, 0);
});
check('duplicate local callbacks and later duplicate delivery never replay a processed deal', () => {
    const t = terminal(); const s = fixture(t); s.add(1); s.event(1); s.event(1); assert.equal(s.RDPendingDeals.length, 1);
    s.flush(); t.now += 10000; s.event(1); s.flush(); assert.equal(s.sounds().length, 1);
});
check('two charts atomically deduplicate the same fill even outside the burst window', () => {
    const t = terminal(); const a = fixture(t, 'a'), b = fixture(t, 'b'); a.add(1); a.event(1); b.event(1);
    a.flush(); t.now += 5000; b.flush(); assert.equal(a.sounds().length, 1);
    assert.equal(a.RDPendingDeals.length + b.RDPendingDeals.length, 0);
});
check('interleaved chart claims have exactly one winner for a shared deal', () => {
    const t = terminal(); const a = fixture(t, 'a'), b = fixture(t, 'b'); a.add(1); a.event(1); b.event(1);
    t.beforeCAS = ({ key, chart }) => { if (chart === 'a' && key.endsWith('_D1')) { t.beforeCAS = null; b.flush(); } };
    a.flush(); assert.equal(a.sounds().length, 1); assert.equal(a.sounds()[0].chart, 'b');
});
check('different fills in a short account burst merge and a later fill sounds again', () => {
    const t = terminal(); const a = fixture(t, 'a'), b = fixture(t, 'b');
    a.event(a.add(1)); b.event(b.add(2, 1), 1); a.flush(); t.now += 699; b.flush();
    assert.equal(a.sounds().length, 1); t.now += 1; a.event(a.add(3)); a.flush(); assert.equal(a.sounds().length, 2);
});
check('sound-window CAS contention merges simultaneous different-deal playback', () => {
    const t = terminal(); const a = fixture(t, 'a'), b = fixture(t, 'b'); a.event(a.add(1)); b.event(b.add(2));
    t.beforeCAS = ({ key, chart }) => { if (chart === 'a' && key.endsWith('_Audio')) { t.beforeCAS = null; b.flush(); } };
    a.flush(); assert.equal(a.sounds().length, 1); assert.equal(a.sounds()[0].chart, 'b');
});
check('reload neither removes shared deduplication markers nor replays history', () => {
    const t = terminal(); const a = fixture(t); a.event(a.add(1)); a.flush(); t.now += 5000;
    const reads = t.reads.length, b = fixture(t, 'reload'); assert.equal(t.reads.length, reads);
    b.event(1); b.flush(); assert.equal(a.sounds().length, 1);
});
check('old historical add events are not replayed after initialization', () => {
    const s = fixture(); s.event(s.add(1, 0, { time: 199999000 })); s.flush(); assert.equal(s.sounds().length, 0);
});
check('account switch drops the former account queue and isolates identifiers', () => {
    const t = terminal(); const s = fixture(t); s.event(s.add(1)); s.flush(); s.event(2);
    t.account = 456; s.flush(); assert.equal(s.RDPendingDeals.length, 0); s.event(1); s.flush();
    assert.equal(s.sounds().length, 2); assert.ok([...t.globals.keys()].some(k => k.includes('_456_D1')));
});
check('same account identifier on a different broker server has independent deduplication', () => {
    const t = terminal(); const s = fixture(t); s.event(s.add(1)); s.flush(); const previous = s.RDAccountKey;
    t.server = 'Demo-B'; s.event(1); s.flush(); assert.notEqual(s.RDAccountKey, previous); assert.equal(s.sounds().length, 2);
});
check('unreadable history cannot starve later ready fills beyond the bounded batch', () => {
    const t = terminal(); const s = fixture(t); for (let i = 1; i <= 129; i++) s.event(i); s.add(129);
    s.flush(); assert.equal(t.reads.length, 128); assert.equal(s.sounds().length, 0);
    s.flush(); assert.equal(s.sounds().length, 1); assert.equal(s.RDPendingDeals.length, 128);
});
check('disabled trade sound ignores callbacks and clears queued work without disabling risk alerts', () => {
    const s = fixture(); s.event(1); s.RDCurrentEnableTradeSound = false; s.flush(); s.event(2);
    assert.equal(s.RDPendingDeals.length, 0); s.RDPlayRiskAlert('daily loss'); assert.equal(s.sounds()[0].file, 'alert.wav');
});
check('missing WAV logs an actionable error without replaying the same fill endlessly', () => {
    const t = terminal(); t.failFiles.add('missing.wav'); const s = fixture(t); s.RDCurrentTradeSound = 'missing.wav';
    s.event(s.add(1)); s.flush(); assert.match(t.output.find(e => e.kind === 'log').text, /Sounds.*WAV/);
    t.now += 1000; s.event(1); s.flush(); assert.equal(s.sounds().length, 1);
});
check('empty sound name never issues the PlaySound stop-playback sentinel', () => {
    const t = terminal(); const s = fixture(t); s.RDCurrentTradeSound = ''; s.event(s.add(1)); s.flush();
    assert.equal(s.sounds().length, 0); assert.match(t.output.find(e => e.kind === 'log').text, /文件为空/);
});
check('global variable creation failure keeps the deal queued for a safe retry', () => {
    const t = terminal(); const s = fixture(t); t.tempFailure = true; s.event(s.add(1)); s.flush();
    assert.equal(s.RDPendingDeals.length, 1); assert.equal(s.sounds().length, 0);
    t.tempFailure = false; s.flush(); assert.equal(s.sounds().length, 1); assert.equal(s.RDPendingDeals.length, 0);
});
check('risk alert overrides a recent fill and suppresses ordinary forced-close sound for two seconds', () => {
    const t = terminal(); const s = fixture(t); s.event(s.add(1)); s.flush(); s.RDPlayRiskAlert('daily loss');
    assert.deepEqual(t.output.filter(e => e.kind !== 'log').map(e => e.kind === 'sound' ? e.file : e.kind), ['ok.wav', 'alert', 'alert.wav']);
    t.now += 1999; s.event(s.add(2)); s.flush(); assert.equal(s.sounds().length, 2);
    t.now += 1; s.event(s.add(3)); s.flush(); assert.equal(s.sounds().length, 3);
});
check('duplicate risk callbacks across charts emit one Alert and one custom alarm', () => {
    const t = terminal(); const a = fixture(t, 'a'), b = fixture(t, 'b'); a.RDPlayRiskAlert('daily loss'); b.RDPlayRiskAlert('daily loss');
    assert.equal(t.output.filter(e => e.kind === 'alert').length, 1); assert.equal(a.sounds().length, 1);
});
check('distinct simultaneous loss conditions are independently reported', () => {
    const t = terminal(); const s = fixture(t); s.RDPlayRiskAlert('position 42'); s.RDPlayRiskAlert('daily loss');
    assert.equal(t.output.filter(e => e.kind === 'alert').length, 2);
});
check('risk Alert remains available even if shared notification state is unavailable', () => {
    const t = terminal(); const s = fixture(t); t.tempFailure = true; s.RDPlayRiskAlert('daily loss');
    assert.equal(t.output.filter(e => e.kind === 'alert').length, 1); assert.equal(s.sounds()[0].file, 'alert.wav');
});
check('64-bit deal identifiers remain exact in deduplication keys', () => {
    const t = terminal(); const s = fixture(t); const id = 18446744073709551615n; s.event(s.add(id)); s.flush();
    const key = [...t.globals.keys()].find(k => k.endsWith('_D' + id)); assert.ok(key); assert.ok(key.length < 64);
});
check('notification implementation has no trading or broad-history replay APIs', () => {
    assert.doesNotMatch(source, /\b(?:OrderSend|OrderSendAsync|PositionClose|PositionModify|OrderDelete|HistorySelect|HistoryDealsTotal|CTrade)\s*\(/);
});
check('successful submission cannot bypass the panel sound switch through the original success tone', () => {
    const trading = readFileSync(new URL('../mt5/Position Sizer Trading.mqh', import.meta.url), 'utf8');
    const branch = trading.match(/if \(!DisableTradingSounds && \(isOrderPlacementFailing \|\| !AtLeastOneOrderExecuted\)\)\s*PlaySound\("timeout.wav"\);/);
    assert.ok(branch, 'Only failed submission retains its legacy tone');
    const sounds = [];
    const s = vm.createContext({ DisableTradingSounds: false, RDCurrentEnableTradeSound: false,
        isOrderPlacementFailing: false, AtLeastOneOrderExecuted: true, PlaySound: file => sounds.push(file) });
    vm.runInContext(branch[0], s); assert.deepEqual(sounds, []);
    s.isOrderPlacementFailing = true; vm.runInContext(branch[0], s); assert.deepEqual(sounds, ['timeout.wav']);
});
console.log(`RR deal alerts: ${count} production-method tests passed.`);
