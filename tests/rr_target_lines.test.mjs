import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../mt5/RRTargetLines.mqh', import.meta.url), 'utf8');
const core = readFileSync(new URL('../mt5/RRCore.mqh', import.meta.url), 'utf8');
const planSource = readFileSync(new URL('../mt5/RRPlan.mqh', import.meta.url), 'utf8');
function extract(text, name) {
    const signature = new RegExp(`(?:void|bool|double|string|color|int) ${name}\\(([^)]*)\\)\\s*\\{`).exec(text);
    assert.ok(signature, name);
    let depth = 1, end = signature.index + signature[0].length, start = end;
    for (; depth && end < text.length; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
    }
    const args = signature[1].split(',').map(a => a.trim().replace(/^(?:const\s+)?\w+\s+&?/, ''));
    let body = text.slice(start, end - 1)
        .replace(/\bstring retained\[\];/, 'let retained = [];')
        .replace(/\bRRState state;/, 'let state = {};')
        .replace(/\bRRPlan plan;/, 'let plan = {};')
        .replace(/\b(?:string|int|ulong|long|bool|double|datetime|color)\s+(\w+)\s*;/g, 'let $1;')
        .replace(/\b(?:string|int|ulong|long|bool|double|datetime|color)\s+(?=\w+\s*=)/g, 'let ')
        .replace(/\((?:ulong|int|long|color)\)/g, '');
    return `function ${name}(${args.join(',')}) {${body}}`;
}
function fixture() {
    const objects = new Map();
    const plan = { count: 2, targets: [{ multiple: 2, percent: 50, move_be: 1 }, { multiple: 5, percent: 50, move_be: 0 }] };
    const ctx = {
        RRLinePrefix: 'PSRR_Targets_', RRLastLineRefresh: 0, RRLabelRows: [], RR_MAX_TARGETS: 20, RR_Enable: true,
        _Symbol: 'XAUUSD', _Period: 5, RRActivePlan: plan,
        SYMBOL_TRADE_TICK_SIZE: 1, SYMBOL_DIGITS: 2, POSITION_SYMBOL: 3, POSITION_MAGIC: 4,
        POSITION_IDENTIFIER: 5, POSITION_TP: 6, time: 1000, rows: [], positions: [], objects,
        ChartID: () => 1, GetTickCount64: () => ctx.time,
        SymbolInfoDouble: symbol => (ctx.rules[symbol] ?? ctx.rules.XAUUSD).tickSize,
        SymbolInfoInteger: symbol => (ctx.rules[symbol] ?? ctx.rules.XAUUSD).digits,
        rules: { XAUUSD: { tickSize: 0.01, digits: 2 }, EURUSD: { tickSize: 0.00001, digits: 5 } },
        DoubleToString: (n, digits) => n.toFixed(digits), IntegerToString: String,
        StringLen: s => s.length, StringSubstr: (s, from, length) => length === undefined ? s.slice(from) : s.substr(from, length),
        StringFind: (s, part) => s.indexOf(part), MathAbs: Math.abs, MathCeil: Math.ceil, MathFloor: Math.floor,
        MathIsValidNumber: Number.isFinite,
        MathMax: Math.max, MathMin: Math.min, ArraySize: a => a.length,
        NormalizeDouble: (v, digits) => Number(v.toFixed(digits)), ArrayResize: (a, n) => { a.length = n; },
        RRFileName: id => id, FileIsExist: id => ctx.positions.some(p => p.id === id && p.journal),
        PositionsTotal: () => ctx.positions.length,
        PositionGetTicket: i => { ctx.selected = ctx.positions[i]; return ctx.selected?.ticket || 0; },
        PositionGetString: () => ctx.selected.symbol,
        PositionGetInteger: key => key === 4 ? ctx.selected.magic : ctx.selected.id,
        PositionGetDouble: () => ctx.selected.tp,
        PositionSelectByTicket: ticket => !!(ctx.selected = ctx.positions.find(p => p.ticket === ticket)),
        RRReadManagedPosition: (symbol, magic, id, state) => {
            const p = ctx.positions.find(p => p.id === id);
            if (!p || p.busy || p.magic !== magic || p.state.magic !== magic) return false;
            Object.assign(state, structuredClone(p.state)); return true;
        },
        RRStatePlan: (state, target) => Object.assign(target, structuredClone(state.plan)),
        RRStateClosesAll: state => state.version === 1 || ctx.RRPlanClosesAll(state.plan),
        RRTargetColor: (hit, be, preview) => ({ hit, be, preview }),
        RRDrawTarget: (key, price, caption, color, hit) => {
            ctx.rows.push({ key, price, caption, color, hit });
            objects.set(key + '_Line', { price }); objects.set(key + '_Label', { caption });
        },
        ObjectsTotal: () => objects.size, ObjectName: (_, index) => [...objects.keys()][index],
        ObjectDelete: (_, name) => objects.delete(name),
        ObjectsDeleteAll: (_, prefix) => { for (const k of objects.keys()) if (k.startsWith(prefix)) objects.delete(k); },
    };
    vm.createContext(ctx);
    vm.runInContext(extract(core, 'RRTargetPrice'), ctx);
    for (const name of ['RRPlanTotalPercent', 'RRPlanClosesAll']) vm.runInContext(extract(planSource, name), ctx);
    for (const name of ['RRCompactNumber', 'RRTargetCaption', 'RRDeleteTargetLines', 'RRPlaceTargetLabel', 'RRPruneTargetRows', 'RRRefreshTargetLines'])
        vm.runInContext(extract(source, name), ctx);
    ctx.refresh = () => { ctx.rows = []; ctx.RRRefreshTargetLines('XAUUSD', 123, 4336.71, 4349.42, -1, true); };
    ctx.position = (id = 42) => ({
        id, ticket: id + 100, journal: true, magic: 123, symbol: 'XAUUSD', tp: 4303.34,
        state: { version: 2, magic: 123, direction: -1, entry: 4341.74, risk: 4349.42 - 4341.74, final_r: 5, stage: 0, blocked: 0, plan: structuredClone(plan) },
    });
    return ctx;
}
let count = 0;
function check(name, test) { test(); console.log(`ok ${++count} - ${name}`); }
check('managed target uses frozen fill rather than current calculator entry', () => {
    const s = fixture(); s.positions.push(s.position()); s.refresh();
    assert.deepEqual(s.rows.map(r => r.price), [4326.38, 4303.34]);
    assert.match(s.rows[0].caption, /#42.*TP1 2R.*4326.38.*50% \+ BE/);
    assert.match(s.rows[1].caption, /服务器TP/);
});
check('all matching managed positions have separate names', () => {
    const s = fixture(); s.positions.push(s.position(42), s.position(43)); s.refresh();
    assert.equal(s.rows.length, 4); assert.equal(new Set(s.rows.map(r => r.key)).size, 4);
});
check('triggered target stays at original level with triggered status', () => {
    const s = fixture(); const p = s.position(); p.state.stage = 1; s.positions.push(p); s.refresh();
    assert.equal(s.rows[0].hit, true); assert.equal(s.rows[1].hit, false);
    assert.match(s.rows[0].caption, /已触发/);
});
check('pending final TP synchronization is never labeled server TP', () => {
    const s = fixture(); const p = s.position(); p.tp = 4300; s.positions.push(p); s.refresh();
    assert.match(s.rows[1].caption, /最终TP待同步/); assert.doesNotMatch(s.rows[1].caption, /服务器TP/);
});
check('disabled manager still displays existing plans as paused', () => {
    const s = fixture(); s.RR_Enable = false; s.positions.push(s.position()); s.refresh();
    assert.equal(s.rows.length, 2); assert.match(s.rows[0].caption, /管理暂停/);
});
check('no managed position shows clearly labeled preview', () => {
    const s = fixture(); s.refresh(); assert.equal(s.rows.length, 2);
    assert.match(s.rows[0].caption, /^新仓预览/); assert.equal(s.rows[0].price, 4311.29);
});
check('invalid preview stop produces no invented targets', () => {
    const s = fixture(); s.RRRefreshTargetLines('XAUUSD', 123, 100, 90, -1, true); assert.equal(s.rows.length, 0);
});
check('unmanaged positions do not produce adoption annotations', () => {
    const s = fixture(); const p = s.position(); p.journal = false; s.positions.push(p); s.refresh();
    assert.ok(s.rows.every(r => r.key.includes('Preview')));
});
check('wrong symbol and mismatching journal Magic are excluded', () => {
    const s = fixture(); const a = s.position(), b = s.position(43); a.magic = 999; b.symbol = 'EURUSD';
    s.positions.push(a, b); s.refresh(); assert.ok(s.rows.every(r => r.key.includes('Preview')));
});
check('closed position and preview swap remove only owned objects', () => {
    const s = fixture(); s.objects.set('user_manual_line', {}); s.refresh(); s.positions.push(s.position()); s.refresh();
    assert.ok(![...s.objects.keys()].some(k => k.includes('Preview')));
    s.positions = []; s.refresh(); assert.ok(![...s.objects.keys()].some(k => k.includes('_42_')));
    assert.ok(s.objects.has('user_manual_line'));
});
check('busy journal retains existing annotations and suppresses preview', () => {
    const s = fixture(); const p = s.position(); s.positions.push(p); s.refresh(); p.busy = true; s.refresh();
    assert.equal(s.rows.length, 0); assert.equal(s.objects.size, 4);
});
check('deleting a future target removes obsolete chart rows', () => {
    const s = fixture(); const p = s.position(); s.positions.push(p); s.refresh();
    p.state.plan.count = 1; p.state.plan.targets[0] = { multiple: 5, percent: 100, move_be: 0 }; s.refresh();
    assert.equal(s.objects.size, 2); assert.ok(!s.objects.has('PSRR_Targets_42_1_Line'));
});
check('legacy trigger stages map correctly to both chart targets', () => {
    const s = fixture(); const p = s.position(); p.state.version = 1; p.state.stage = 2; s.positions.push(p); s.refresh();
    assert.deepEqual(s.rows.map(r => r.hit), [true, false]);
    p.state.stage = 3; s.refresh(); assert.deepEqual(s.rows.map(r => r.hit), [true, true]);
});
check('deinitialization removes only RR target annotations', () => {
    const s = fixture(); s.objects.set('manual', {}); s.refresh(); s.RRDeleteTargetLines();
    assert.deepEqual([...s.objects.keys()], ['manual']);
});
check('labels use compact percentages without trailing decimal zeros', () => {
    const s = fixture(); assert.equal(s.RRCompactNumber(0), '0'); assert.equal(s.RRCompactNumber(33.25), '33.25');
});
check('twenty close or offscreen target labels occupy separate visible rows', () => {
    const s = fixture(); const rows = Array.from({ length: 20 }, () => s.RRPlaceTargetLabel(5, 500));
    assert.equal(new Set(rows).size, 20);
    assert.ok(rows.every(y => y >= 22 && y <= 496));
    for (let i = 1; i < rows.length; i++) assert.ok(Math.abs(rows[i] - rows[i - 1]) >= 17);
});
check('chart module contains no trade or journal write actions', () => {
    assert.doesNotMatch(source, /\b(?:OrderSend|OrderCheck|RRSave|RRClose|FileWriteStruct|RRApplyPositionPlan)\s*\(/);
    assert.match(source, /OBJPROP_SELECTABLE, false/);
});
check('runner final partial target never claims a full server TP', () => {
    const s = fixture(); const p = s.position(); p.state.plan.targets[1].percent = 25; p.tp = 0;
    s.positions.push(p); s.refresh();
    assert.match(s.rows[1].caption, /平 25%.*计划后保留 25%.*无全平TP/);
    assert.doesNotMatch(s.rows[1].caption, /服务器TP|最终TP待同步/);
});
check('old full TP is explicitly pending cancellation on a saved runner', () => {
    const s = fixture(); const p = s.position(); p.state.plan.targets[1].percent = 25;
    s.positions.push(p); s.refresh();
    assert.match(s.rows[1].caption, /旧TP待取消 4303.34/);
    assert.doesNotMatch(s.rows[1].caption, /无全平TP/);
});
check('runner retains completed target marks after all targets have triggered', () => {
    const s = fixture(); const p = s.position(); p.state.plan.targets[1].percent = 25; p.state.stage = 2; p.tp = 0;
    s.positions.push(p); s.refresh();
    assert.ok(s.rows.every(r => r.hit)); assert.match(s.rows[1].caption, /已触发.*计划后保留 25%/);
});
check('new runner preview clearly shows retained share', () => {
    const s = fixture(); s.RRActivePlan.targets[1].percent = 25; s.refresh();
    assert.match(s.rows[1].caption, /新仓预览.*计划后保留 25%/);
});
check('BE-only runner labels show no invented forced close', () => {
    const s = fixture(); const p = s.position(); p.state.plan = { count: 1, targets: [{ multiple: 2, percent: 0, move_be: 1 }] }; p.tp = 0;
    s.positions.push(p); s.refresh();
    assert.match(s.rows[0].caption, /平 0% \+ BE.*保留 100%.*无全平TP/);
});
check('global manager wildcard never puts all-symbol prices on a single chart', () => {
    const s = fixture(); s.positions.push(s.position()); s.refresh();
    s.rows = []; s.RRRefreshTargetLines('', 123, 4336.71, 4349.42, -1, false);
    assert.equal(s.rows.length, 0); assert.equal(s.objects.size, 0);
});
check('changing to another chart symbol prunes old annotations even during the refresh throttle', () => {
    const s = fixture(); s.positions.push(s.position()); s.refresh(); s.rows = [];
    s._Symbol = 'EURUSD'; s.RRRefreshTargetLines('XAUUSD', 123, 4336.71, 4349.42, -1, false);
    assert.equal(s.rows.length, 0); assert.equal(s.objects.size, 0);
});
check('current chart draws only its matching positions using its own tick and digit rules', () => {
    const s = fixture(); const gold = s.position(42), eur = s.position(43);
    eur.symbol = 'EURUSD'; eur.tp = 1.09823;
    Object.assign(eur.state, { direction: 1, entry: 1.08323, risk: 0.003 });
    s.positions.push(gold, eur); s._Symbol = 'EURUSD';
    s.RRRefreshTargetLines('EURUSD', 123, 0, 0, 1, true);
    assert.deepEqual(s.rows.map(r => r.price), [1.08923, 1.09823]);
    assert.ok(s.rows.every(r => r.key.includes('_43_'))); assert.match(s.rows[0].caption, /1\.08923/);
});
check('invalid current symbol price step removes stale targets instead of drawing invalid prices', () => {
    const s = fixture(); s.positions.push(s.position()); s.refresh(); s.rows = [];
    s.rules.XAUUSD.tickSize = 0; s.RRRefreshTargetLines('XAUUSD', 123, 100, 90, 1, true);
    assert.equal(s.rows.length, 0); assert.equal(s.objects.size, 0);
});
check('valid old-Magic journals keep their current-chart annotations after entry Magic changes', () => {
    const s = fixture(); const p = s.position(); p.magic = 999; p.state.magic = 999;
    s.positions.push(p); s.refresh();
    assert.equal(s.rows.length, 2); assert.ok(s.rows.every(r => r.key.includes('_42_')));
    assert.deepEqual(s.rows.map(r => r.price), [4326.38, 4303.34]);
});
check('manual and unrelated positions without journals are never adopted into target annotations', () => {
    const s = fixture(); const a = s.position(42), b = s.position(43);
    a.magic = 0; a.journal = false; b.magic = 999; b.journal = false; s.positions.push(a, b); s.refresh();
    assert.ok(s.rows.every(r => r.key.includes('Preview')));
});
console.log(`${count} chart annotations checks passed`);
