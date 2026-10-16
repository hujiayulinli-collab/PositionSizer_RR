// Execute the actual pure MQL function bodies with a deliberately small adapter.
// No strategy formulas are reimplemented in this runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const corePath = fileURLToPath(new URL('../mt5/RRCore.mqh', import.meta.url));
const source = readFileSync(corePath, 'utf8');
const names = ['RRPriceR', 'RRTargetPrice', 'RRTargetReached', 'RRPartialLots', 'RRBETarget', 'RRSLProtectsBE'];
const bodies = names.map(name => {
    const signature = new RegExp(`(?:double|bool)\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`, 'm').exec(source);
    assert.ok(signature, `Missing MQL function ${name}`);
    const start = signature.index + signature[0].length;
    let depth = 1;
    let end = start;
    for (; end < source.length && depth; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
    }
    assert.equal(depth, 0, `Unclosed MQL function ${name}`);
    const args = signature[1].split(',').map(arg => {
        const match = /^\s*(?:const\s+)?(?:int|double|bool)\s+(\w+)\s*$/.exec(arg);
        assert.ok(match, `Unsupported parameter syntax in ${name}: ${arg}`);
        return match[1];
    });
    const body = source.slice(start, end - 1)
        .replace(/\b(?:double|int|bool)\s+(?=[A-Za-z_]\w*\s*=)/g, 'let ');
    return `function ${name}(${args.join(', ')}) {${body}\n}`;
});

const context = vm.createContext({
    MathCeil: Math.ceil,
    MathFloor: Math.floor,
    MathMax: Math.max,
    MathIsValidNumber: Number.isFinite,
    NormalizeDouble: (value, digits) => Number(value.toFixed(digits)),
});
vm.runInContext(bodies.join('\n'), context, { filename: corePath });

let passed = 0;
function check(name, callback) {
    try {
        callback();
        passed++;
        process.stdout.write(`PASS ${name}\n`);
    } catch (error) {
        throw new Error(`FAIL ${name}: ${error.message}`, { cause: error });
    }
}
function near(actual, expected, epsilon = 1e-8) {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
        `expected ${expected}, received ${actual}`);
}

const { RRPriceR, RRTargetPrice, RRTargetReached, RRPartialLots, RRBETarget, RRSLProtectsBE } = context;

check('XAU sell triggers at exact 2R tick despite frozen binary risk', () => {
    assert.ok(RRPriceR(-1, 4341.74, 7.680000000000291, 4326.36, 4326.38) < 2);
    assert.equal(RRTargetReached(-1, 4341.74, 7.680000000000291, 2, 4326.36, 4326.38, 0.01, 2), true);
});
check('XAU sell triggers at exact 5R tick despite frozen binary risk', () =>
    assert.equal(RRTargetReached(-1, 4341.74, 7.680000000000291, 5, 4303.32, 4303.34, 0.01, 2), true));
check('sell Bid reaching alone does not trigger', () =>
    assert.equal(RRTargetReached(-1, 4341.74, 7.680000000000291, 2, 4326.38, 4326.39, 0.01, 2), false));
check('buy Ask reaching alone does not trigger', () =>
    assert.equal(RRTargetReached(1, 4341.74, 7.680000000000291, 2, 4357.09, 4357.10, 0.01, 2), false));
check('buy exact tick triggers despite binary risk', () =>
    assert.equal(RRTargetReached(1, 4341.74, 7.680000000000291, 2, 4357.10, 4357.11, 0.01, 2), true));
check('nonaligned target waits for outward legal tick', () => {
    assert.equal(RRTargetReached(1, 100, 0.03, 5, 100.15, 100.4, 0.25, 2), false);
    assert.equal(RRTargetReached(1, 100, 0.03, 5, 100.25, 100.5, 0.25, 2), true);
});
check('invalid target calculation cannot trigger', () => {
    assert.equal(RRTargetReached(0, 100, 10, 2, 120, 121, 0.01, 2), false);
    assert.equal(RRTargetReached(1, 100, 0, 2, 120, 121, 0.01, 2), false);
    assert.equal(RRTargetReached(1, 100, 10, 2, 120, 121, 0, 2), false);
    assert.equal(RRTargetReached(1, 100, 10, 2, NaN, 121, 0.01, 2), false);
});

check('buy reaches 2R at executable Bid', () => near(RRPriceR(1, 100, 10, 120, 120.5), 2));
check('buy Ask crossing alone does not reach 2R', () => assert.ok(RRPriceR(1, 100, 10, 119.5, 120) < 2));
check('sell reaches 2R at executable Ask', () => near(RRPriceR(-1, 100, 10, 79.5, 80), 2));
check('sell Bid crossing alone does not reach 2R', () => assert.ok(RRPriceR(-1, 100, 10, 80, 80.5) < 2));
check('buy loss has negative R', () => near(RRPriceR(1, 100, 10, 90, 90.5), -1));
check('sell loss has negative R', () => near(RRPriceR(-1, 100, 10, 109.5, 110), -1));
check('zero risk does not divide by zero', () => near(RRPriceR(1, 100, 0, 120, 120.5), 0));
check('negative risk is rejected', () => near(RRPriceR(-1, 100, -10, 79.5, 80), 0));
check('gap past final target reports more than 5R', () => assert.ok(RRPriceR(1, 100, 10, 155, 156) > 5));

check('buy 5R target', () => near(RRTargetPrice(1, 100, 10, 5, 0.01, 2), 150));
check('sell 5R target', () => near(RRTargetPrice(-1, 100, 10, 5, 0.01, 2), 50));
check('buy target rounds outwards to tick', () => near(RRTargetPrice(1, 100, 0.03, 5, 0.25, 2), 100.25));
check('sell target rounds outwards to tick', () => near(RRTargetPrice(-1, 100, 0.03, 5, 0.25, 2), 99.75));
check('already aligned target does not gain a tick', () => near(RRTargetPrice(1, 1.1, 0.001, 5, 0.00001, 5), 1.105));

check('one lot closes half', () => near(RRPartialLots(1, 1, 50, 0.01, 0.01), 0.5));
check('0.1 lots closes half despite binary precision', () => near(RRPartialLots(0.1, 0.1, 50, 0.01, 0.01), 0.05));
check('odd lot count rounds partial quantity down', () => near(RRPartialLots(0.03, 0.03, 50, 0.01, 0.01), 0.01));
check('previous reduction counts toward half', () => near(RRPartialLots(1, 0.8, 50, 0.01, 0.01), 0.3));
check('decimal previous reduction counts toward half', () => near(RRPartialLots(0.1, 0.09, 50, 0.01, 0.01), 0.04));
check('achieved half is not closed again', () => near(RRPartialLots(1, 0.5, 50, 0.01, 0.01), 0));
check('more than half already reduced is not closed again', () => near(RRPartialLots(1, 0.4, 50, 0.01, 0.01), 0));
check('minimum lot cannot be split', () => near(RRPartialLots(0.01, 0.01, 50, 0.01, 0.01), 0));
check('partial below broker minimum is rejected', () => near(RRPartialLots(0.1, 0.1, 40, 0.05, 0.01), 0));
check('remainder below broker minimum is rejected', () => near(RRPartialLots(0.1, 0.1, 90, 0.05, 0.01), 0));
check('whole-lot contract respects lot step', () => near(RRPartialLots(3, 3, 50, 1, 1), 1));
check('zero lot step is rejected', () => near(RRPartialLots(1, 1, 50, 0.01, 0), 0));
check('zero minimum is rejected', () => near(RRPartialLots(1, 1, 50, 0, 0.01), 0));
check('zero percent is rejected', () => near(RRPartialLots(1, 1, 0, 0.01, 0.01), 0));
check('100 percent is not treated as a partial', () => near(RRPartialLots(1, 1, 100, 0.01, 0.01), 0));

check('zero-offset buy BE is entry', () => near(RRBETarget(1, 100, 0, 0.01, 0.01, 2), 100));
check('buy BE offset is profitable', () => near(RRBETarget(1, 100, 5, 0.01, 0.01, 2), 100.05));
check('sell BE offset is profitable', () => near(RRBETarget(-1, 100, 5, 0.01, 0.01, 2), 99.95));
check('buy BE on fractional entry rounds to profitable side', () => near(RRBETarget(1, 100.03, 0, 0.01, 0.25, 2), 100.25));
check('sell BE on fractional entry rounds to profitable side', () => near(RRBETarget(-1, 100.03, 0, 0.01, 0.25, 2), 100));
check('missing stop does not protect BE', () => assert.equal(RRSLProtectsBE(1, 0, 100, 0.01), false));
check('buy stop at BE protects it', () => assert.equal(RRSLProtectsBE(1, 100, 100, 0.01), true));
check('sell stop at BE protects it', () => assert.equal(RRSLProtectsBE(-1, 100, 100, 0.01), true));
check('stronger buy stop should not be weakened', () => assert.equal(RRSLProtectsBE(1, 101, 100, 0.01), true));
check('stronger sell stop should not be weakened', () => assert.equal(RRSLProtectsBE(-1, 99, 100, 0.01), true));
check('buy stop one tick short of BE is not protected', () => assert.equal(RRSLProtectsBE(1, 99.99, 100, 0.01), false));
check('sell stop one tick short of BE is not protected', () => assert.equal(RRSLProtectsBE(-1, 100.01, 100, 0.01), false));

check('all whole-step partial sizes preserve minimum, step and idempotence', () => {
    for (const step of [0.01, 0.1, 0.25, 1]) {
        for (let units = 1; units <= 80; units++) {
            for (const percent of [10, 33, 50, 80, 99]) {
                const initial = units * step;
                const partial = RRPartialLots(initial, initial, percent, step, step);
                assert.ok(partial >= 0 && partial <= initial * percent / 100 + 1e-8);
                if (partial === 0) continue;
                assert.ok(partial >= step - 1e-8);
                assert.ok(initial - partial >= step - 1e-8);
                near(partial / step, Math.round(partial / step));
                near(RRPartialLots(initial, initial - partial, percent, step, step), 0);
            }
        }
    }
});

check('both directions: executable final price never precedes requested R', () => {
    for (const direction of [1, -1]) {
        for (const tick of [0.00001, 0.01, 0.25]) {
            for (const risk of [0.00023, 0.03, 0.77, 12.4]) {
                for (const multiple of [1.5, 2, 5]) {
                    const target = RRTargetPrice(direction, 100.12345, risk, multiple, tick, 5);
                    const achievedR = RRPriceR(direction, 100.12345, risk, target, target);
                    assert.ok(achievedR >= multiple - 1e-7, `${direction}, ${tick}, ${risk}, ${multiple}: ${achievedR}`);
                    near(target / tick, Math.round(target / tick), 1e-6);
                }
            }
        }
    }
});

process.stdout.write(`\n${passed} tests passed against ${corePath}\n`);
process.stdout.write('Scope: pure calculations only; terminal execution, persistence and broker behaviour require the demo scenarios in MANUAL_TESTS.md.\n');
