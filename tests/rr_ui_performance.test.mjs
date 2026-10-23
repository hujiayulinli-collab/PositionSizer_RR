// Execute the production slow-UI reporter at a deterministic clock/log boundary.
// No terminal, account, settings file, or network is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const entry = readFileSync(new URL('../mt5/Position Sizer RR.mq5', import.meta.url), 'utf8');
const signature = /void RRReportSlowUI\(const int slot, const string operation, const ulong started\)\s*\{/.exec(entry);
assert.ok(signature, 'Production RRReportSlowUI must exist');
let cursor = signature.index + signature[0].length, depth = 1;
const start = cursor;
for (; depth && cursor < entry.length; cursor++) {
    if (entry[cursor] === '{') depth++;
    if (entry[cursor] === '}') depth--;
}
assert.equal(depth, 0);
const body = entry.slice(start, cursor - 1);
const adapted = body.replace(/\bulong now\s*=/, 'let now =');
function fixture() {
    const output = [], sideEffects = [];
    const s = {
        now: 0n, RRSlowUILastLog: [0n, 0n, 0n], Version: 'test-version', _Symbol: 'TEST_SYMBOL', RRPanelScalePercent: 125,
        GetTickCount64: () => s.now,
        PrintFormat: (...args) => output.push(args),
    };
    for (const name of ['OrderSend', 'OrderSendAsync', 'RBCancelEntry', 'RGManage', 'RRManage', 'PlaySound',
        'FileOpen', 'FileWrite', 'FileDelete', 'ChartRedraw', 'ObjectSetInteger'])
        s[name] = (...args) => { sideEffects.push([name, ...args]); throw new Error(`Unexpected diagnostic side effect: ${name}`); };
    vm.createContext(s);
    vm.runInContext(`function RRReportSlowUI(slot, operation, started) {${adapted}}`, s);
    return { s, output, sideEffects };
}
let count = 0;
function check(name, action) { action(); console.log(`ok ${++count} - ${name}`); }

check('fast work below 250 ms remains silent and does not consume the rate limit', () => {
    const { s, output } = fixture();
    for (const duration of [0n, 1n, 100n, 249n]) {
        s.now = 10000n + duration; s.RRReportSlowUI(0, 'tick', 10000n);
    }
    assert.deepEqual(output, []); assert.deepEqual(s.RRSlowUILastLog, [0n, 0n, 0n]);
});
check('exactly 250 ms emits duration version symbol and scale once', () => {
    const { s, output } = fixture(); s.now = 10250n; s.RRReportSlowUI(1, 'timer', 10000n);
    assert.equal(output.length, 1);
    const [format, operation, elapsed, version, symbol, percent] = output[0];
    assert.match(format, /PS RR Perf.*耗时.*版本.*品种.*缩放/);
    assert.equal(operation, 'timer'); assert.equal(elapsed, 250n);
    assert.equal(version, 'test-version'); assert.equal(symbol, 'TEST_SYMBOL'); assert.equal(percent, 125);
    assert.equal(s.RRSlowUILastLog[1], 10250n);
});
check('repeated slow reports in one slot are throttled for exactly 30 seconds', () => {
    const { s, output } = fixture();
    s.now = 1000n; s.RRReportSlowUI(0, 'first', 700n);
    for (const now of [1001n, 15000n, 30999n]) {
        s.now = now; s.RRReportSlowUI(0, 'repeat', now - 300n);
    }
    assert.equal(output.length, 1); assert.equal(s.RRSlowUILastLog[0], 1000n);
    s.now = 31000n; s.RRReportSlowUI(0, 'boundary', 30750n);
    assert.equal(output.length, 2); assert.equal(output[1][1], 'boundary');
});
check('tick timer and event paths maintain independent rate-limit slots', () => {
    const { s, output } = fixture(); s.now = 1000n;
    for (const slot of [0, 1, 2]) s.RRReportSlowUI(slot, `path${slot}`, 700n);
    assert.equal(output.length, 3); assert.deepEqual(s.RRSlowUILastLog, [1000n, 1000n, 1000n]);
    s.now = 2000n;
    for (const slot of [0, 1, 2]) s.RRReportSlowUI(slot, `path${slot}`, 1500n);
    assert.equal(output.length, 3);
});
check('invalid slots are rejected before reading the clock or touching the array', () => {
    const { s, output } = fixture();
    s.GetTickCount64 = () => { throw new Error('Clock must not be read for an invalid slot'); };
    for (const slot of [-2147483648, -1, 3, 2147483647]) s.RRReportSlowUI(slot, 'invalid', 0n);
    assert.deepEqual(output, []); assert.deepEqual(s.RRSlowUILastLog, [0n, 0n, 0n]);
});
check('a backwards duration clock does not log an underflowed duration or change state', () => {
    const { s, output } = fixture(); s.now = 1000n; s.RRSlowUILastLog[0] = 500n;
    s.RRReportSlowUI(0, 'rollback during operation', 1001n);
    assert.deepEqual(output, []); assert.equal(s.RRSlowUILastLog[0], 500n);
});
check('a rate-limit clock rollback establishes a fresh baseline without unsigned arithmetic assumptions', () => {
    const { s, output } = fixture(); s.RRSlowUILastLog[2] = 100000n; s.now = 1000n;
    s.RRReportSlowUI(2, 'new clock epoch', 500n);
    assert.equal(output.length, 1); assert.equal(s.RRSlowUILastLog[2], 1000n);
    s.now = 2000n; s.RRReportSlowUI(2, 'limited again', 1000n);
    assert.equal(output.length, 1);
});
check('reporting has no trading file sound chart or settings side effects', () => {
    const { s, output, sideEffects } = fixture();
    for (const slot of [0, 1, 2]) { s.now = 1000n; s.RRReportSlowUI(slot, 'slow', 0n); }
    assert.equal(output.length, 3); assert.deepEqual(sideEffects, []);
    assert.doesNotMatch(body, /\b(?:AccountInfo\w*|Position\w*|Order\w*|File\w*|PlaySound|Chart\w*|Object\w*|RGManage|RRManage|RBManage\w*|RBCancelEntry)\s*\(/);
});

console.log(`RR UI performance: ${count} production-boundary tests passed.`);
