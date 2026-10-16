// Actual production journal functions against an in-memory binary file boundary.
// Broker calls are outside this test; records are encoded from the MQL field
// declarations rather than a second copy of the journal layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/Position Sizer RR.mqh', import.meta.url), 'utf8');
const maxTargets = 20;
const widths = { uint: 4, int: 4, long: 8, ulong: 8, double: 8 };
function schema(name) {
    const text = new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\};`).exec(source)?.[1];
    assert.ok(text, `Missing production structure ${name}`);
    const fields = [...text.matchAll(/\b(uint|int|long|ulong|double)\s+(\w+)(?:\[(RR_MAX_TARGETS)\])?\s*;/g)]
        .map(([, type, field, array]) => ({ type, field, count: array ? maxTargets : 1, array: Boolean(array) }));
    return { fields, size: fields.reduce((size, f) => size + widths[f.type] * f.count, 0) };
}
const schemas = { RRLegacyState: schema('RRLegacyState'), RRState: schema('RRState') };
function struct(name) {
    if (name === 'RRPlan') return { __type: name, count: 0,
        targets: Array.from({ length: maxTargets }, () => ({ multiple: 0, percent: 0, move_be: 0 })) };
    return Object.fromEntries([['__type', name], ...schemas[name].fields.map(f =>
        [f.field, f.array ? Array(f.count).fill(0) : 0])]);
}
function encode(record) {
    const buffer = Buffer.alloc(schemas[record.__type].size);
    let offset = 0;
    for (const f of schemas[record.__type].fields) {
        for (const value of f.array ? record[f.field] : [record[f.field]]) {
            if (f.type === 'double') buffer.writeDoubleLE(value, offset);
            else if (f.type === 'uint') buffer.writeUInt32LE(value >>> 0, offset);
            else if (f.type === 'int') buffer.writeInt32LE(value, offset);
            else if (f.type === 'ulong') buffer.writeBigUInt64LE(BigInt(value), offset);
            else buffer.writeBigInt64LE(BigInt(value), offset);
            offset += widths[f.type];
        }
    }
    return buffer;
}
function decode(buffer, name) {
    const record = struct(name);
    let offset = 0;
    for (const f of schemas[name].fields) {
        const values = [];
        for (let i = 0; i < f.count; i++) {
            let value;
            if (f.type === 'double') value = buffer.readDoubleLE(offset);
            else if (f.type === 'uint') value = buffer.readUInt32LE(offset);
            else if (f.type === 'int') value = buffer.readInt32LE(offset);
            else if (f.type === 'ulong') value = Number(buffer.readBigUInt64LE(offset));
            else value = Number(buffer.readBigInt64LE(offset));
            values.push(value);
            offset += widths[f.type];
        }
        record[f.field] = f.array ? values : values[0];
    }
    return record;
}
function extract(name) {
    const match = new RegExp(`(?:void|bool|uint)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Missing production function ${name}`);
    let depth = 1;
    const start = match.index + match[0].length;
    let end = start;
    for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    const args = match[1].split(',').map(arg => {
        const found = /^\s*(?:const\s+)?(?:int|ulong|string|RRState|RRLegacyState)\s*&?\s*(\w+)\s*$/.exec(arg);
        assert.ok(found, `Unsupported argument in ${name}: ${arg}`);
        return found[1];
    });
    const body = source.slice(start, end - 1)
        .replace(/\b(RRState|RRLegacyState|RRPlan)\s+(\w+)\s*;/g, 'let $2 = __struct("$1");')
        .replace(/\b(?:uint|ulong|long|int|double|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/sizeof\(uint\)/g, '4')
        .replace(/sizeof\((RRLegacyState|RRState)\)/g, (_match, name) => String(schemas[name].size))
        .replace(/\((?:uint|long)\)/g, '')
        .replace('hash = (hash ^ StringGetCharacter(value, i)) * 16777619;',
            'hash = Math.imul(hash ^ StringGetCharacter(value, i), 16777619) >>> 0;');
    return `function ${name}(${args.join(', ')}) {${body}\n}`;
}

let env;
const context = vm.createContext({
    RR_MAX_TARGETS: maxTargets, SEEK_SET: 0, SEEK_END: 2, INT_VALUE: 4,
    __struct: struct,
    ZeroMemory: object => Object.assign(object, struct(object.__type)),
    MathIsValidNumber: Number.isFinite,
    StringLen: value => value.length,
    StringGetCharacter: (value, index) => value.charCodeAt(index),
    IntegerToString: String,
    DoubleToString: (value, digits) => value.toFixed(digits),
    StringFormat: (template, ...args) => {
        let next = 0;
        return template.replace(/%I64[ud]|%[ud]/g, () => String(args[next++]));
    },
    RRPlanValidate: () => env.planValid,
    RRNotice: message => env.notices.push(message),
    ResetLastError: () => { env.error = 0; },
    GetLastError: () => env.error,
    FileSize: () => env.bytes.length,
    FileSeek: (_handle, offset, mode) => {
        if (env.seekFails) return false;
        env.cursor = mode === 2 ? env.bytes.length + offset : offset;
        return env.cursor >= 0;
    },
    FileWriteStruct: (_handle, record) => {
        const encoded = encode(record);
        const writeSize = env.shortWrite ? encoded.length - 1 : encoded.length;
        const result = Buffer.alloc(Math.max(env.bytes.length, env.cursor + writeSize));
        env.bytes.copy(result);
        encoded.copy(result, env.cursor, 0, writeSize);
        env.bytes = result;
        env.cursor += writeSize;
        env.writtenTypes.push(record.__type);
        return writeSize;
    },
    FileReadStruct: (_handle, record) => {
        const size = schemas[record.__type].size;
        if (env.cursor + size > env.bytes.length) return 0;
        Object.assign(record, decode(env.bytes.subarray(env.cursor, env.cursor + size), record.__type));
        env.cursor += size;
        return size;
    },
    FileReadInteger: () => {
        const value = env.bytes.readUInt32LE(env.cursor);
        env.cursor += 4;
        return value;
    },
    FileFlush: () => { if (env.flushFails) env.error = 5001; },
});
vm.runInContext(['RRHash', 'RRChecksum', 'RRFromLegacy', 'RRToLegacy', 'RRSave', 'RRLoad'].map(extract).join('\n'), context);

function reset(overrides = {}) {
    env = { bytes: Buffer.alloc(0), cursor: 0, error: 0, seekFails: false, shortWrite: false,
        flushFails: false, planValid: true, notices: [], writtenTypes: [], ...overrides };
}
function state(version = 2, overrides = {}) {
    const s = struct('RRState');
    Object.assign(s, { version, identifier: 42, magic: 123, opening_order: 100, direction: 1,
        entry: 100, risk: 10, initial_volume: 1, first_r: 2, final_r: 5, percent: 50,
        move_be: 1, offset_points: 3, sequence: 7, last_request: 91, last_stop_request: 93 }, overrides);
    if (version === 2) {
        s.target_count = 3;
        s.target_r.splice(0, 3, 1, 2, 5);
        s.target_percent.splice(0, 3, 0, 50, 50);
        s.target_be.splice(0, 3, 1, 0, 0);
    }
    return s;
}
function load(expected = true) {
    const result = struct('RRState');
    assert.equal(context.RRLoad(1, result, 42), expected);
    return result;
}
function save(s, expected = true) {
    assert.equal(context.RRSave(1, s), expected);
}
let passed = 0;
function check(name, callback) {
    try { reset(); callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}

check('legacy scalar field order still matches the released schema', () => {
    assert.deepEqual(schemas.RRLegacyState.fields.map(f => f.field), [
        'version', 'identifier', 'magic', 'opening_order', 'direction', 'entry', 'risk', 'initial_volume',
        'first_r', 'final_r', 'percent', 'move_be', 'offset_points', 'stage', 'be_done', 'blocked',
        'sequence', 'pending', 'pending_order', 'before_volume', 'last_request', 'last_stop_request', 'checksum']);
    assert.equal(schemas.RRLegacyState.size, 144);
});
check('v2 retains scalar prefix and adds all 20 target slots', () => {
    assert.deepEqual(schemas.RRState.fields.slice(0, schemas.RRLegacyState.fields.length), schemas.RRLegacyState.fields);
    assert.equal(schemas.RRState.size, 552);
});
check('legacy conversion preserves every scalar and clears new target fields', () => {
    const legacy = struct('RRLegacyState');
    for (const [index, field] of schemas.RRLegacyState.fields.entries()) legacy[field.field] = index + 1;
    const converted = state(2);
    context.RRFromLegacy(legacy, converted);
    const roundTrip = struct('RRLegacyState');
    context.RRToLegacy(converted, roundTrip);
    assert.deepEqual(roundTrip, legacy);
    assert.equal(converted.target_count, 0); assert.equal(converted.be_requested, 0);
    assert.ok(converted.target_r.every(value => value === 0));
});
check('v1 save writes legacy bytes and v1 load restores pending close intent', () => {
    const s = state(1, { stage: 1, pending: 1, pending_order: 200, before_volume: 1 });
    save(s);
    assert.deepEqual(env.writtenTypes, ['RRLegacyState']); assert.equal(env.bytes.length, 144);
    const restored = load();
    for (const f of schemas.RRLegacyState.fields) assert.equal(restored[f.field], s[f.field]);
});
check('v1 append keeps the released record size and reads its last state', () => {
    const s = state(1); save(s); s.stage = 2; s.pending = 0; s.be_done = 0; save(s);
    assert.equal(env.bytes.length, 288); assert.equal(load().stage, 2);
});
check('v1 final-target latch survives reload', () => {
    const s = state(1, { stage: 3, pending: 1, pending_order: 202, before_volume: 0.5 });
    save(s); assert.equal(load().stage, 3); assert.equal(load().pending_order, 202);
});
check('v2 save and reload freeze every target and pending field', () => {
    const s = state(2, { stage: 2, be_requested: 1, pending: 1, pending_order: 210, before_volume: 0.8 });
    save(s); assert.deepEqual(env.writtenTypes, ['RRState']); assert.equal(env.bytes.length, 552);
    assert.deepEqual(load(), s);
});
check('v2 reads latest complete append, never the initial stage', () => {
    const s = state(2); save(s); s.stage = 3; s.be_requested = 1; save(s);
    assert.equal(env.bytes.length, 1104); assert.equal(load().stage, 3);
});
check('all unused target slots are checksum protected', () => {
    const s = state(2); const checksum = context.RRChecksum(s);
    s.target_r[19] = 99; assert.notEqual(context.RRChecksum(s), checksum);
});
check('BE trigger and last stop request participate in checksum', () => {
    const s = state(2); const checksum = context.RRChecksum(s);
    s.be_requested = 1; assert.notEqual(context.RRChecksum(s), checksum);
    s.be_requested = 0; s.last_stop_request++; assert.notEqual(context.RRChecksum(s), checksum);
});
check('record for another position is rejected', () => {
    const s = state(2, { identifier: 99 }); save(s); load(false);
});
check('unknown journal version is rejected', () => {
    save(state(2)); env.bytes.writeUInt32LE(9, 0); load(false);
});
check('checksum mismatch in a complete record is rejected', () => {
    save(state(2)); env.bytes[80] ^= 1; load(false);
});
check('torn v1 trailing record is rejected rather than replaying an old intent', () => {
    save(state(1)); env.bytes = Buffer.concat([env.bytes, Buffer.from([1])]); load(false);
});
check('torn v2 trailing record is rejected rather than replaying an old intent', () => {
    save(state(2)); env.bytes = env.bytes.subarray(0, env.bytes.length - 1); load(false);
});
check('empty and undersized files are rejected', () => {
    load(false); env.bytes = Buffer.from([1, 0, 0]); load(false);
});
check('invalid risk, entry and initial volume fail validation despite valid checksum', () => {
    for (const [field, value] of [['risk', 0], ['risk', NaN], ['entry', 0], ['entry', Infinity], ['initial_volume', 0]]) {
        reset(); save(state(2, { [field]: value })); load(false);
    }
});
check('invalid stage or pending flag is rejected', () => {
    for (const changed of [{ stage: -1 }, { stage: 4 }, { pending: 2 }, { sequence: -1 }, { direction: 0 }]) {
        reset(); save(state(2, changed)); load(false);
    }
});
check('v1 stage values above its original state machine are rejected', () => {
    save(state(1, { stage: 4 })); load(false);
});
check('invalid v2 target count is rejected before accessing target arrays', () => {
    for (const count of [0, 21]) {
        reset(); const s = state(2); s.target_count = count; save(s); load(false);
    }
});
check('v2 final R must agree with the frozen last target', () => {
    save(state(2, { final_r: 6 })); load(false);
});
check('v2 plan is revalidated during journal load', () => {
    save(state(2)); env.planValid = false; load(false);
});
check('short write fails and its torn journal is not accepted', () => {
    env.shortWrite = true; save(state(2), false); assert.ok(env.notices.length); load(false);
});
check('flush error prevents reporting a successful state save', () => {
    env.flushFails = true; save(state(2), false); assert.ok(env.notices.length);
});
check('seek failure does not append or claim success', () => {
    env.seekFails = true; save(state(2), false); assert.equal(env.bytes.length, 0);
});

process.stdout.write(`\n${passed} journal tests passed against production save/load and conversion functions.\n`);
process.stdout.write('Scope: binary schema and state decisions with a simulated MQL file boundary; native packing and durable storage still require terminal validation.\n');
