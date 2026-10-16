// Execute production RRPlan functions. The adapter only handles MQL syntax and
// output references; validation and volume arithmetic come from the EA source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/RRPlan.mqh', import.meta.url), 'utf8');
const maxMatch = /#define\s+RR_MAX_TARGETS\s+(\d+)/.exec(source);
assert.ok(maxMatch, 'Missing production target-count limit');
const maxTargets = Number(maxMatch[1]);

function extract(name) {
    const match = new RegExp(`(?:bool|double|void)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(source);
    assert.ok(match, `Missing production function ${name}`);
    const start = match.index + match[0].length;
    let end = start;
    let depth = 1;
    for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
    }
    assert.equal(depth, 0, `Unclosed function ${name}`);
    const parameters = match[1].trim() ? match[1].split(',').map(parameter => {
        const parsed = /^\s*(?:const\s+)?(?:RRPlan|string|double|bool)\s*&?\s*(\w+)\s*$/.exec(parameter);
        assert.ok(parsed, `Unsupported parameter in ${name}: ${parameter}`);
        return parsed[1];
    }) : [];
    let body = source.slice(start, end - 1)
        .replace(/\b(?:const\s+)?(?:double|int|ushort|bool|string)\s+(?=[A-Za-z_]\w*\s*(?:=|;))/g, 'let ')
        .replace(/\(int\)(\w+)/g, 'Number($1)')
        .replace(/\berror\s*=/g, 'error.value =');
    if (name === 'RRPlanParseNumber') {
        body = body.replace('StringTrimLeft(text);', 'text = text.trimStart();')
            .replace('StringTrimRight(text);', 'text = text.trimEnd();')
            .replace(/'([.0-9])'/g, (_match, character) => String(character.charCodeAt(0)))
            .replace(/\bvalue\b/g, 'value.value');
    }
    return `function ${name}(${parameters.join(', ')}) {${body}\n}`;
}

function emptyPlan() {
    return { count: 0, targets: Array.from({ length: maxTargets }, () => ({ multiple: 0, percent: 0, move_be: 0 })) };
}
function plan(rows) {
    const result = emptyPlan();
    result.count = rows.length;
    rows.forEach(([multiple, percent, move_be = 0], index) => {
        result.targets[index] = { multiple, percent, move_be };
    });
    return result;
}
const context = vm.createContext({
    RR_MAX_TARGETS: maxTargets,
    RRActivePlan: emptyPlan(),
    MathAbs: Math.abs,
    MathFloor: Math.floor,
    MathIsValidNumber: Number.isFinite,
    StringLen: text => text.length,
    StringGetCharacter: (text, index) => text.charCodeAt(index),
    StringToDouble: Number,
    StringFormat: (message, ...args) => `${message} ${args.join(' ')}`,
    ZeroMemory: object => Object.assign(object, emptyPlan()),
});
for (const name of ['RRPlanParseNumber', 'RRPlanValidate', 'RRPlanCheckVolume', 'RRPlanVolumeValid', 'RRPlanFinalR', 'RRPlanDefaults']) {
    vm.runInContext(extract(name), context, { filename: `RRPlan.mqh:${name}` });
}

let passed = 0;
function check(name, callback) {
    try { callback(); passed++; process.stdout.write(`PASS ${name}\n`); }
    catch (error) { throw new Error(`FAIL ${name}: ${error.message}`, { cause: error }); }
}
function valid(value, expected = true) {
    const error = { value: 'stale error' };
    assert.equal(context.RRPlanValidate(value, error), expected);
    assert.equal(error.value.length > 0, !expected, 'failure should explain the invalid plan');
}
function volume(value, amount, minimum, step, expected = true) {
    const error = { value: '' };
    assert.equal(context.RRPlanCheckVolume(value, amount, minimum, step, error), expected);
    assert.equal(error.value.length > 0, !expected, 'failure should explain the volume restriction');
}
function parse(text, expected) {
    const result = { value: -123 };
    const success = context.RRPlanParseNumber(text, result);
    if (expected === false) assert.equal(success, false);
    else { assert.equal(success, true); assert.equal(result.value, expected); }
}

check('target limit is exactly 20', () => assert.equal(maxTargets, 20));
check('single final exit is valid', () => valid(plan([[5, 100]])));
check('legacy two-target default is valid', () => valid(plan([[2, 50, 1], [5, 50]])));
check('zero-percent BE node is valid', () => valid(plan([[1, 0, 1], [2, 50], [5, 50]])));
check('multiple zero-percent BE nodes are valid', () => valid(plan([[1, 0, 1], [1.5, 0, 1], [2, 100]])));
check('20 targets are valid', () => valid(plan(Array.from({ length: 20 }, (_value, index) => [index + 1, 5, index % 2]))));
check('empty plan is rejected', () => valid(emptyPlan(), false));
check('negative target count is rejected', () => valid({ ...emptyPlan(), count: -1 }, false));
check('more than 20 targets is rejected', () => valid(plan(Array.from({ length: 21 }, (_value, index) => [index + 1, 100 / 21])), false));
check('R must be strictly positive', () => valid(plan([[0, 100]]), false));
check('negative R is rejected', () => valid(plan([[-1, 100]]), false));
check('equal R targets are rejected', () => valid(plan([[2, 50], [2, 50]]), false));
check('descending R targets are rejected', () => valid(plan([[3, 50], [2, 50]]), false));
check('nonfinite R values are rejected', () => {
    for (const value of [NaN, Infinity, -Infinity]) valid(plan([[value, 100]]), false);
});
check('negative percentages are rejected', () => valid(plan([[1, -1], [2, 100]]), false));
check('percentages above 100 are rejected', () => valid(plan([[1, 101]]), false));
check('nonfinite percentages are rejected', () => {
    for (const value of [NaN, Infinity, -Infinity]) valid(plan([[1, value]]), false);
});
check('zero-percent row without BE is rejected', () => valid(plan([[1, 0], [2, 100]]), false));
check('invalid BE flag is rejected', () => {
    for (const value of [-1, 2, 0.5]) valid(plan([[1, 100, value]]), false);
});
check('percentages below 100 are rejected', () => valid(plan([[1, 30], [2, 60]]), false));
check('percentages above 100 are rejected', () => valid(plan([[1, 70], [2, 40]]), false));
check('decimal percentages with a valid total pass', () => valid(plan([[1, 33.33], [2, 33.33], [3, 33.34]])));
check('tiny total rounding error is tolerated', () => valid(plan([[1, 30], [2, 69.99999995]])));
check('material total error is rejected', () => valid(plan([[1, 30], [2, 69.99999]]), false));
check('100 percent before the final row is rejected', () => valid(plan([[1, 100], [2, 0, 1]]), false));
check('unreachable trailing BE-only node is rejected', () => valid(plan([[1, 50], [2, 50], [3, 0, 1]]), false));

check('single final exit accepts the minimum lot', () => volume(plan([[5, 100]]), 0.01, 0.01, 0.01));
check('BE-only node does not require a partial close lot', () => volume(plan([[1, 0, 1], [5, 100]]), 0.01, 0.01, 0.01));
check('two-target minimum lot split is rejected', () => volume(plan([[2, 50], [5, 50]]), 0.01, 0.01, 0.01, false));
check('two-target two-step volume can split', () => volume(plan([[2, 50], [5, 50]]), 0.02, 0.01, 0.01));
check('cumulative percentages distribute fractional steps', () => volume(plan([[1, 34], [2, 33], [3, 33]]), 0.03, 0.01, 0.01));
check('positive target rounding to zero is rejected', () => volume(plan([[1, 33], [2, 33], [3, 34]]), 0.03, 0.01, 0.01, false));
check('zero BE row between reductions preserves cumulative allocation', () => volume(plan([[1, 34], [2, 0, 1], [3, 33], [4, 33]]), 0.03, 0.01, 0.01));
check('each nonzero stage must satisfy broker minimum', () => volume(plan([[1, 25], [2, 25], [3, 50]]), 0.1, 0.05, 0.01, false));
check('remainder below minimum is rejected', () => volume(plan([[1, 90], [2, 10]]), 0.1, 0.05, 0.01, false));
check('whole-contract volume is supported', () => volume(plan([[1, 34], [2, 33], [3, 33]]), 3, 1, 1));
check('20 executable target quantities are accepted', () => volume(plan(Array.from({ length: 20 }, (_value, index) => [index + 1, 5])), 0.2, 0.01, 0.01));
check('invalid or nonfinite volume parameters are rejected', () => {
    const p = plan([[5, 100]]);
    for (const args of [[0, 0.01, 0.01], [-1, 0.01, 0.01], [NaN, 0.01, 0.01], [Infinity, 0.01, 0.01],
        [1, 0, 0.01], [1, NaN, 0.01], [1, Infinity, 0.01], [1, 0.01, 0], [1, 0.01, -1], [1, 0.01, NaN], [1, 0.01, Infinity]]) {
        volume(p, ...args, false);
    }
});
check('invalid plan cannot bypass volume checks', () => volume(plan([[1, 0], [2, 100]]), 1, 0.01, 0.01, false));

check('plain and fractional numbers parse', () => {
    for (const [text, value] of [['0', 0], ['2', 2], ['2.5', 2.5], ['.5', 0.5], ['5.', 5], ['0002.50', 2.5], ['  1.75  ', 1.75]]) parse(text, value);
});
check('empty, malformed, signed or decorated numbers are rejected', () => {
    for (const text of ['', ' ', '.', '..', '1.2.3', '-1', '+2', '2R', '50%', '1,5', '1e3', 'NaN', 'Infinity', '１２', '1 2']) parse(text, false);
});
check('numeric overflow is rejected', () => parse('9'.repeat(400), false));
check('parsing does not itself ban zero used for BE rows', () => parse('0.0', 0));
check('defaults preserve original-volume shares and BE', () => {
    context.RRPlanDefaults(2, 40, 5, true);
    const p = context.RRActivePlan;
    assert.equal(p.count, 2);
    assert.equal(p.targets[0].multiple, 2);
    assert.equal(p.targets[0].percent, 40);
    assert.equal(p.targets[0].move_be, 1);
    assert.equal(p.targets[1].multiple, 5);
    assert.equal(p.targets[1].percent, 60);
    assert.equal(p.targets[1].move_be, 0);
    valid(p);
});
check('final R comes from active plan', () => {
    context.RRActivePlan = plan([[1, 0, 1], [3, 25], [7.5, 75]]);
    assert.equal(context.RRPlanFinalR(), 7.5);
});
check('invalid active target count has no final R', () => {
    context.RRActivePlan = emptyPlan();
    assert.equal(context.RRPlanFinalR(), 0);
    context.RRActivePlan.count = 21;
    assert.equal(context.RRPlanFinalR(), 0);
});
check('active-plan volume wrapper uses the same validated plan', () => {
    context.RRActivePlan = plan([[1, 0, 1], [5, 100]]);
    assert.equal(context.RRPlanVolumeValid(0.01, 0.01, 0.01, { value: '' }), true);
    context.RRActivePlan = plan([[2, 50], [5, 50]]);
    assert.equal(context.RRPlanVolumeValid(0.01, 0.01, 0.01, { value: '' }), false);
});
check('all 1..20 equal-share target counts handle exact step quantities', () => {
    for (let count = 1; count <= maxTargets; count++) {
        const rows = Array.from({ length: count }, (_value, index) => [index + 1, 100 / count]);
        for (const step of [0.01, 0.1, 0.25, 1]) {
            volume(plan(rows), count * step, step, step);
        }
    }
});

process.stdout.write(`\n${passed} tests passed against production RRPlan.mqh functions.\n`);
process.stdout.write('Scope: input validation and planned quantities; broker execution and binary file durability are tested separately.\n');
