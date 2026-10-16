// Actual settings functions with binary POD files simulated in memory.
// No terminal settings, journals, UI, or trading interfaces are accessed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRGuardSettings.mqh', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const capacity = Number(/#define RG_SETTINGS_WAV_CAPACITY (\d+)/.exec(source)[1]);
const fields = [.../struct RGSettingsRecord\s*\{([\s\S]*?)\};/.exec(source)[1]
    .matchAll(/\b(uint|int|long|double|ushort)\s+(\w+)(?:\[(RG_SETTINGS_WAV_CAPACITY)\])?\s*;/g)]
    .map(([, type, name, array]) => ({ type, name, count: array ? capacity : 1, array: Boolean(array) }));
const widths = { uint: 4, int: 4, long: 8, double: 8, ushort: 2 };
const recordSize = fields.reduce((size, f) => size + widths[f.type] * f.count, 0);
const record = () => Object.fromEntries(fields.map(f => [f.name, f.array ? Array(f.count).fill(0) : 0]));
function encode(s) {
    const bytes = Buffer.alloc(recordSize); let offset = 0;
    for (const f of fields) for (const value of f.array ? s[f.name] : [s[f.name]]) {
        if (f.type === 'uint') bytes.writeUInt32LE(value >>> 0, offset);
        else if (f.type === 'int') bytes.writeInt32LE(value, offset);
        else if (f.type === 'long') bytes.writeBigInt64LE(BigInt(value), offset);
        else if (f.type === 'double') bytes.writeDoubleLE(value, offset);
        else bytes.writeUInt16LE(value, offset);
        offset += widths[f.type];
    }
    return bytes;
}
function decode(bytes) {
    const s = record(); let offset = 0;
    for (const f of fields) for (let i = 0; i < f.count; i++) {
        let value;
        if (f.type === 'uint') value = bytes.readUInt32LE(offset);
        else if (f.type === 'int') value = bytes.readInt32LE(offset);
        else if (f.type === 'long') value = Number(bytes.readBigInt64LE(offset));
        else if (f.type === 'double') value = bytes.readDoubleLE(offset);
        else value = bytes.readUInt16LE(offset);
        if (f.array) s[f.name][i] = value; else s[f.name] = value;
        offset += widths[f.type];
    }
    return s;
}
function extract(name, text = source) {
    const match = new RegExp(`(?:bool|void|string|uint)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(text);
    assert.ok(match, `Missing production function ${name}`);
    const args = match[1].trim() ? match[1].split(',').map(arg => arg.trim().match(/(\w+)\s*$/)[1]) : [];
    let depth = 1, start = match.index + match[0].length, end = start;
    for (; end < text.length && depth; end++) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; }
    let body = text.slice(start, end - 1)
        .replace(/\bRGSettingsRecord\s+(\w+)\s*;/g, 'let $1 = makeRecord();')
        .replace(/\b(?:const\s+)?(?:int|long|uint|ulong|ushort|double|bool|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\(int\)(\w+(?:\.\w+)*)/g, 'Number($1)')
        .replace(/\((?:RG_POSITION_SCOPE|uint|ulong|long)\)/g, '')
        .replaceAll('sizeof(RGSettingsRecord)', String(recordSize))
        .replace(/let error\s*;/g, "let error = { value: '' };")
        .replace(/\berror\s*=/g, 'error.value =')
        .replace("let error.value = { value: '' };", "let error = { value: '' };")
        .replaceAll('RGSettingsError = error;', 'RGSettingsError = error.value;')
        .replaceAll(': error;', ': error.value;')
        .replace(/StringTrimLeft\((\w+)\);/g, '$1 = $1.trimStart();')
        .replace(/StringTrimRight\((\w+)\);/g, '$1 = $1.trimEnd();')
        .replace(/StringToLower\((\w+)\);/g, '$1 = $1.toLowerCase();');
    if (name === 'RGApplySettingsRecord') body = '__beforeApply();' + body;
    if (name === 'RRHash') body = body.replace('hash = (hash ^ StringGetCharacter(value, i)) * 16777619;',
        'hash = Math.imul(hash ^ StringGetCharacter(value, i), 16777619) >>> 0;');
    return `function ${name}(${args.join(',')}) {${body}\n}`;
}

let env;
const variables = ['RGCurrentPositionLossLimit', 'RGCurrentPositionScope', 'RGCurrentDailyLossLimit',
    'RGCurrentShowStatus', 'RDCurrentEnableTradeSound', 'RDCurrentTradeSound', 'RDCurrentLossSound'];
const defaults = [12, 0, 100, true, true, 'ok.wav', 'alert.wav'];
const functions = ['RGSettingsCurrentKey', 'RGSettingsFileName', 'RGSettingsPathSegmentValid', 'RGSettingsWavValid',
    'RGSettingsValuesValid', 'RGSettingsBuildRecord', 'RGSettingsChecksum', 'RGSettingsRecordValid',
    'RGReadSettingsJournal', 'RGApplySettingsRecord', 'RGSyncSettings', 'RGInitSettings', 'RGSaveSettings'];
const program = [extract('RRHash', engine), ...functions.map(name => extract(name))].join('\n');
function runtime(initial = defaults) {
    const ctx = vm.createContext({
        RG_SETTINGS_WAV_CAPACITY: capacity, RG_OWN_MAGIC: 0, RG_ENTIRE_ACCOUNT: 1,
        ACCOUNT_LOGIN: 'login', ACCOUNT_SERVER: 'server', FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4,
        INVALID_HANDLE: -1, SEEK_END: 2, SEEK_SET: 0,
        RGSettingsRevision: 0, RGSettingsReady: false, RGSettingsError: '', RGSettingsAccountKey: '',
        RGSettingsDefaults: record(), RGSettingsHaveDefaults: false,
        ...Object.fromEntries(variables.map((name, i) => [name, initial[i]])),
        makeRecord: record, ZeroMemory: target => Object.assign(target, record()),
        AccountInfoInteger: () => env.login, AccountInfoString: () => env.server,
        StringLen: text => text.length, StringGetCharacter: (text, index) => text.charCodeAt(index),
        StringSubstr: (text, start, length) => length === undefined ? text.slice(start) : text.slice(start, start + length),
        StringFind: (text, query) => text.indexOf(query), IntegerToString: String,
        DoubleToString: (value, digits) => value.toFixed(digits), MathIsValidNumber: Number.isFinite,
        StringFormat: (text, ...args) => { let i = 0; return text.replace(/%I64[du]|%[ud]/g, () => String(args[i++])); },
        ShortArrayToString: (array, start, count) => {
            assert.ok(start >= 0 && count >= 0 && start + count <= array.length, 'bounded fixed-string decode');
            const values = array.slice(start, start + count), zero = values.indexOf(0);
            return String.fromCharCode(...(zero < 0 ? values : values.slice(0, zero)));
        },
        __beforeApply: () => { assert.equal(env.handles.size, 0, 'publish only after releasing file locks'); env.applies++; },
        FileIsExist: path => Object.hasOwn(env.files, path),
        FileOpen: (path, flags) => {
            env.opens.push({ path, flags });
            if (env.busy.has(path) || env.failOpen) return -1;
            if (!env.files[path]) { if (!(flags & 2)) return -1; env.files[path] = Buffer.alloc(0); }
            const handle = ++env.nextHandle;
            env.handles.set(handle, { path, flags, cursor: 0 }); env.busy.add(path);
            return handle;
        },
        FileClose: handle => {
            assert.ok(env.handles.has(handle)); env.busy.delete(env.handles.get(handle).path); env.handles.delete(handle);
        },
        FileSize: handle => env.files[env.handles.get(handle).path].length,
        FileSeek: (handle, offset, origin) => {
            env.seeks++; if (env.failSeekAt === env.seeks) return false;
            const h = env.handles.get(handle); h.cursor = (origin === 2 ? env.files[h.path].length : 0) + offset;
            return h.cursor >= 0;
        },
        FileWriteStruct: (handle, s) => {
            const h = env.handles.get(handle), previous = env.files[h.path];
            assert.ok((h.flags & 2) !== 0 && env.busy.has(h.path));
            assert.ok(h.path.endsWith('settings.bin'), 'only independent settings journal may be written');
            env.writes++; const bytes = encode(s);
            const count = env.shortWrite ? recordSize - 1 : recordSize;
            if (env.corruptWrite) bytes[recordSize - 1] ^= 0x80;
            const after = Buffer.alloc(Math.max(previous.length, h.cursor + count));
            previous.copy(after); bytes.copy(after, h.cursor, 0, count); h.cursor += count;
            env.files[h.path] = after;
            return count;
        },
        FileReadStruct: (handle, s) => {
            env.reads++;
            if (env.failReadAt === env.reads) return 0;
            const h = env.handles.get(handle), bytes = env.files[h.path];
            if (h.cursor + recordSize > bytes.length) return 0;
            Object.assign(s, decode(bytes.subarray(h.cursor, h.cursor + recordSize)));
            if (env.onRead) env.onRead();
            return recordSize;
        },
        ResetLastError: () => { env.error = 0; }, GetLastError: () => env.error,
        FileFlush: () => { if (env.failFlush) env.error = 5; if (env.onFlush) env.onFlush(); },
    });
    vm.runInContext(program, ctx);
    return ctx;
}
let ctx;
function reset(initial = defaults) {
    env = { login: 1001, server: 'Broker-Server', files: {}, handles: new Map(), busy: new Set(), nextHandle: 0,
        opens: [], writes: 0, reads: 0, seeks: 0, error: 0, applies: 0,
        failOpen: false, shortWrite: false, failFlush: false, corruptWrite: false, failReadAt: 0, failSeekAt: 0 };
    ctx = runtime(initial);
}
const live = (c = ctx) => variables.map(name => c[name]);
function init(c = ctx) { const ok = c.RGInitSettings(); assert.equal(env.handles.size, 0); return ok; }
function sync(c = ctx) { const ok = c.RGSyncSettings(); assert.equal(env.handles.size, 0); return ok; }
function save(values = [25, 1, 200, false, false, 'fills/new.wav', '风险,报警.WAV'], revision = ctx.RGSettingsRevision, c = ctx) {
    const error = { value: 'stale' };
    const ok = c.RGSaveSettings(...values, revision, error);
    assert.equal(env.handles.size, 0); assert.equal(error.value.length > 0, !ok);
    return { ok, error: error.value };
}
function changeRecord(edit, checksum = true) {
    const filename = ctx.RGSettingsFileName(), bytes = env.files[filename];
    const start = bytes.length - recordSize, s = decode(bytes.subarray(start));
    edit(s); if (checksum) s.checksum = ctx.RGSettingsChecksum(s);
    encode(s).copy(bytes, start);
}
let passed = 0;
function check(name, callback) {
    try { reset(); callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}

check('first init and repeated sync keep input defaults without creating a journal', () => {
    assert.equal(init(), true); assert.equal(sync(), true); assert.deepEqual(live(), defaults);
    assert.equal(ctx.RGSettingsRevision, 0); assert.equal(ctx.RGSettingsReady, true);
    assert.equal(env.writes, 0); assert.equal(env.opens.length, 0); assert.equal(Object.keys(env.files).length, 0);
});
check('explicit first save validates, flushes, reads back and publishes every setting', () => {
    init(); const values = [25, 1, 200, false, false, 'fills/new.wav', '风险,报警.WAV'];
    assert.equal(save(values).ok, true); assert.deepEqual(live(), values);
    assert.equal(ctx.RGSettingsRevision, 1); assert.equal(env.files[ctx.RGSettingsFileName()].length, recordSize);
    assert.equal(env.reads, 1); assert.equal(env.applies, 1);
});
check('the POD record contains no dynamic strings and has bounded UTF-16 fields', () => {
    assert.equal(capacity, 129); assert.equal(recordSize, 576);
    assert.equal(fields.filter(f => f.array).length, 2);
    assert.ok(!/\bstring\b/.test(/struct RGSettingsRecord\s*\{([\s\S]*?)\};/.exec(source)[1]));
});
check('a restarted chart loads persisted settings instead of its different input defaults', () => {
    init(); save(); const expected = live(); const other = runtime([1, 0, 2, true, true, 'a.wav', 'b.wav']);
    assert.equal(init(other), true); assert.deepEqual(live(other), expected); assert.equal(other.RGSettingsRevision, 1);
    assert.equal(env.writes, 1, 'reading does not rewrite saved settings');
});
check('charts retain independent legacy defaults until the first explicit account save', () => {
    init(); const otherDefaults = [3, 1, 4, false, false, 'x.wav', 'y.wav'], other = runtime(otherDefaults);
    init(other); assert.deepEqual(live(), defaults); assert.deepEqual(live(other), otherDefaults);
    save(); sync(other); assert.deepEqual(live(other), live());
});
check('optimistic revision rejects another chart stale draft without changing its runtime', () => {
    init(); const other = runtime(); init(other); save(); const previous = live(other);
    assert.equal(save([50, 0, 300, true, true, 'a.wav', 'b.wav'], 0, other).ok, false);
    assert.deepEqual(live(other), previous); assert.equal(env.writes, 1);
    sync(other); assert.equal(other.RGSettingsRevision, 1);
});
check('second save appends revision two while preserving the first complete record', () => {
    init(); save(); const first = Buffer.from(env.files[ctx.RGSettingsFileName()]);
    const values = [0, 0, 0, true, true, 'ok.wav', 'alert.wav']; save(values);
    const bytes = env.files[ctx.RGSettingsFileName()];
    assert.equal(ctx.RGSettingsRevision, 2); assert.equal(bytes.length, recordSize * 2);
    assert.deepEqual(bytes.subarray(0, recordSize), first); assert.deepEqual(live(), values);
});
check('saving a lower or zero cap does not touch daily lock or emergency records', () => {
    init(); env.files['PSRR_Guard/daily.bin'] = Buffer.from('latched'); env.files['PSRR_Guard/position_42.bin'] = Buffer.from('pending');
    save([0, 0, 0, true, true, 'ok.wav', 'alert.wav']);
    assert.equal(env.files['PSRR_Guard/daily.bin'].toString(), 'latched');
    assert.equal(env.files['PSRR_Guard/position_42.bin'].toString(), 'pending');
});
check('negative and nonfinite caps are rejected before any write or live mutation', () => {
    init(); for (const value of [-1, NaN, Infinity, -Infinity]) {
        assert.equal(save([value, 0, 100, true, true, 'ok.wav', 'alert.wav']).ok, false);
        assert.equal(save([1, 0, value, true, true, 'ok.wav', 'alert.wav']).ok, false);
    }
    assert.equal(env.writes, 0); assert.deepEqual(live(), defaults); assert.equal(ctx.RGSettingsReady, true);
});
check('invalid scope is rejected without affecting active settings', () => {
    init(); for (const scope of [-1, 2, 99]) assert.equal(save([1, scope, 10, true, true, 'ok.wav', 'alert.wav']).ok, false);
    assert.deepEqual(live(), defaults); assert.equal(env.opens.length, 0);
});
check('WAV validation accepts Unicode, commas, spaces and relative subfolders', () => {
    for (const path of ['ok.wav', 'OK.WAV', '风险,报警.wav', 'My Sounds/alarm.wav', 'folder\\alarm.wav', 'fill (new).wav'])
        assert.equal(ctx.RGSettingsWavValid(path), true, path);
});
check('WAV validation rejects empty, non-WAV, traversal, absolute and invalid Windows names', () => {
    for (const path of ['', '.wav', 'sound.mp3', '../a.wav', 'a/../b.wav', 'C:\\a.wav', '/a.wav', '\\a.wav',
        'a//b.wav', 'a\\\\b.wav', './a.wav', 'a/./b.wav', ' ok.wav', 'ok.wav ', 'a./b.wav',
        'a?b.wav', 'a:b.wav', 'a|b.wav', 'a*b.wav', 'a<b.wav', 'a>b.wav', 'a"b.wav',
        'con.wav', 'AUX.wav', 'nul/a.wav', 'COM1.wav', 'lpt9.old.wav'])
        assert.equal(ctx.RGSettingsWavValid(path), false, path);
});
check('WAV validation rejects control characters and every newline form', () => {
    for (const text of ['a\nb.wav', 'a\rb.wav', 'a\r\nb.wav', 'a\tb.wav', 'a\0b.wav', 'a\u007fb.wav', 'a\u2028b.wav', 'a\u2029b.wav'])
        assert.equal(ctx.RGSettingsWavValid(text), false);
});
check('128 UTF-16 code units round trip but a 129-unit path is rejected', () => {
    init(); const path = 'a'.repeat(124) + '.wav'; assert.equal(path.length, 128);
    assert.equal(save([1, 0, 10, true, true, path, 'alert.wav']).ok, true);
    assert.equal(live()[5], path); const before = live();
    assert.equal(save([1, 0, 10, true, true, 'a'.repeat(125) + '.wav', 'alert.wav']).ok, false);
    assert.deepEqual(live(), before);
});
check('invalid sound fields cannot be saved even when trade sound is switched off', () => {
    init(); assert.equal(save([1, 0, 10, true, false, '', 'alert.wav']).ok, false);
    assert.equal(save([1, 0, 10, true, false, 'ok.wav', '']).ok, false); assert.equal(env.writes, 0);
});
check('invalid legacy defaults can be repaired through a first valid panel save', () => {
    reset([-1, 0, 100, true, true, '', 'alert.wav']); assert.equal(init(), false);
    assert.equal(env.writes, 0); assert.equal(Object.keys(env.files).length, 0); assert.equal(ctx.RGSettingsHaveDefaults, true);
    assert.equal(save([5, 1, 50, true, true, 'ok.wav', 'alert.wav'], 0).ok, true);
    assert.equal(ctx.RGSettingsReady, true); assert.equal(ctx.RGSettingsRevision, 1);
});
check('saved valid settings supersede invalid first-load inputs', () => {
    init(); save(); const other = runtime([-1, 55, -1, true, true, '', 'bad.mp3']);
    assert.equal(init(other), true); assert.deepEqual(live(other), live());
});
check('busy settings lock prevents writes and preserves live runtime', () => {
    init(); env.busy.add(ctx.RGSettingsFileName()); const before = live();
    assert.equal(save().ok, false); assert.deepEqual(live(), before); assert.equal(env.writes, 0);
});
check('sync lock failure marks not ready while preserving the last valid live settings', () => {
    init(); save(); const before = live(); env.busy.add(ctx.RGSettingsFileName());
    assert.equal(sync(), false); assert.deepEqual(live(), before); assert.equal(ctx.RGSettingsReady, false);
    env.busy.clear(); assert.equal(sync(), true);
});
check('short append leaves live settings unchanged and torn journal fails closed', () => {
    init(); save(); const before = live(); env.shortWrite = true;
    assert.equal(save(defaults).ok, false); assert.deepEqual(live(), before); assert.equal(ctx.RGSettingsReady, false);
    env.shortWrite = false; assert.equal(sync(), false); assert.deepEqual(live(), before);
});
check('flush failure reports ambiguity and a later reload may observe a full committed record', () => {
    init(); const before = live(); env.failFlush = true;
    const result = save(); assert.equal(result.ok, false); assert.match(result.error, /保存结果未确认/);
    assert.deepEqual(live(), before); env.failFlush = false;
    assert.equal(sync(), true); assert.equal(ctx.RGSettingsRevision, 1); assert.equal(ctx.RGCurrentPositionLossLimit, 25);
});
check('failed readback never publishes immediately and can be verified on explicit reload', () => {
    init(); env.failReadAt = 1; const before = live(); assert.equal(save().ok, false);
    assert.deepEqual(live(), before); env.failReadAt = 0; assert.equal(sync(), true);
    assert.equal(ctx.RGSettingsRevision, 1);
});
check('corrupt full write is rejected by readback checksum before publication', () => {
    init(); env.corruptWrite = true; assert.equal(save().ok, false); assert.deepEqual(live(), defaults);
    env.corruptWrite = false; assert.equal(sync(), false);
});
check('seek failure keeps active settings and releases every handle', () => {
    init(); env.failSeekAt = 1; assert.equal(save().ok, false); assert.deepEqual(live(), defaults); assert.equal(env.writes, 0);
});
check('existing empty journal is not overwritten as a first installation', () => {
    init(); env.files[ctx.RGSettingsFileName()] = Buffer.alloc(0);
    assert.equal(save().ok, false); assert.equal(env.writes, 0); assert.equal(sync(), false);
});
check('corrupt existing record cannot be overwritten with a new valid draft', () => {
    init(); save(); env.files[ctx.RGSettingsFileName()][0] ^= 1; const bytes = Buffer.from(env.files[ctx.RGSettingsFileName()]);
    assert.equal(save(defaults).ok, false); assert.deepEqual(env.files[ctx.RGSettingsFileName()], bytes);
});
check('valid checksum cannot bypass account or server binding', () => {
    for (const edit of [s => { s.account++; }, s => { s.server_hash++; }]) {
        reset(); init(); save(); changeRecord(edit); const before = live();
        assert.equal(sync(), false); assert.deepEqual(live(), before);
    }
});
check('valid checksum cannot bypass finite amounts, scope, or boolean validation', () => {
    for (const edit of [s => { s.single_loss = -1; }, s => { s.daily_loss = NaN; }, s => { s.scope = 2; },
        s => { s.show_status = 2; }, s => { s.trade_sound = -1; }]) {
        reset(); init(); save(); changeRecord(edit); assert.equal(sync(), false);
    }
});
check('fixed-string lengths and terminator padding are checked before decoding', () => {
    for (const edit of [s => { s.trade_length = 0; }, s => { s.trade_length = 129; },
        s => { s.loss_length = 999; }, s => { s.trade_wav[128] = 65; }, s => { s.loss_wav[128] = 65; }]) {
        reset(); init(); save(); changeRecord(edit); assert.equal(sync(), false);
    }
});
check('embedded NUL cannot hide unvalidated characters behind a valid WAV prefix', () => {
    init(); save([1, 0, 10, true, true, 'ok.wavxx', 'alert.wav']);
    // The deliberately invalid draft must not have created a record.
    assert.equal(env.writes, 0);
    save(); changeRecord(s => {
        s.trade_length = 9; s.trade_wav.fill(0); Array.from('ok.wav').forEach((ch, i) => { s.trade_wav[i] = ch.charCodeAt(0); });
        s.trade_wav[7] = 88; s.trade_wav[8] = 89;
    });
    assert.equal(sync(), false);
});
check('revision must agree with complete append-frame count', () => {
    init(); save(); changeRecord(s => { s.revision = 2; }); assert.equal(sync(), false);
});
check('rollback to an older complete journal does not lower a running revision', () => {
    init(); save(); const first = Buffer.from(env.files[ctx.RGSettingsFileName()]); save(defaults);
    const before = live(); env.files[ctx.RGSettingsFileName()] = first;
    assert.equal(sync(), false); assert.equal(ctx.RGSettingsRevision, 2); assert.deepEqual(live(), before);
});
check('a disappeared saved journal cannot silently restore defaults or create a fresh stale revision', () => {
    init(); save(); const before = live(); delete env.files[ctx.RGSettingsFileName()];
    assert.equal(sync(), false); assert.deepEqual(live(), before);
    assert.equal(save(defaults, 1).ok, false); assert.equal(Object.keys(env.files).length, 0);
});
check('switching accounts restores per-instance defaults until that account has a saved record', () => {
    init(); save(); const accountOne = live(); env.login = 1002;
    assert.equal(sync(), true); assert.deepEqual(live(), defaults); assert.equal(ctx.RGSettingsRevision, 0);
    assert.equal(save([7, 0, 70, true, true, 'a.wav', 'b.wav']).ok, true);
    env.login = 1001; assert.equal(sync(), true); assert.deepEqual(live(), accountOne);
});
check('same login on a different server does not inherit the prior server settings', () => {
    init(); save(); const oldFile = ctx.RGSettingsFileName(); env.server = 'Other-Server';
    assert.equal(sync(), true); assert.deepEqual(live(), defaults); assert.notEqual(ctx.RGSettingsFileName(), oldFile);
});
check('save rejects account changes before the panel has synchronized its account context', () => {
    init(); env.login = 1002; assert.equal(save().ok, false); assert.equal(env.writes, 0); assert.deepEqual(live(), defaults);
});
check('an account change during read cannot publish the old account record', () => {
    init(); save(); const before = live(); env.onRead = () => { env.login = 1002; };
    assert.equal(sync(), false); assert.deepEqual(live(), before); assert.equal(ctx.RGSettingsReady, false);
});
check('account change during commit preserves live values and reports unconfirmed application', () => {
    init(); const before = live(); env.onFlush = () => { env.login = 1002; };
    assert.equal(save().ok, false); assert.deepEqual(live(), before); assert.equal(ctx.RGSettingsReady, false);
});
check('no logged-in account cannot load or save account-bound settings', () => {
    env.login = 0; assert.equal(init(), false); assert.equal(save().ok, false); assert.equal(env.writes, 0);
});
check('oversized invalid input defaults cannot cause an out-of-bounds restore on account switch', () => {
    reset([0, 0, 0, true, true, 'a'.repeat(1000), 'alert.wav']); assert.equal(init(), false);
    env.login = 1002; assert.equal(sync(), false); assert.equal(ctx.RGSettingsReady, false);
    assert.equal(save(defaults, 0).ok, true);
});

process.stdout.write(`\n${passed} account-settings tests passed against production function bodies.\n`);
process.stdout.write('Scope: in-memory binary files and account context; no terminal files, UI or trades.\n');
