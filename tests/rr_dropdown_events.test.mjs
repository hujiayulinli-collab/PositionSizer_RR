// Execute the production event boundary with inert controls. The small dialog
// fixture models only CAppDialog's documented focus/top-window routing and
// reverse child traversal; it does not emulate MT5 rendering or validate live UI.
// No terminal, account, chart objects, sounds, or trading API are accessed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/Position Sizer RR.mq5', import.meta.url), 'utf8');
function body(name, input = source) {
    const match = new RegExp(`(?:void|bool) ${name}\\([^)]*\\)\\s*\\{`).exec(input);
    assert.ok(match, `production ${name} exists`);
    const start = match.index + match[0].length;
    let depth = 1, end = start;
    for (; depth && end < input.length; end++) {
        if (input[end] === '{') depth++;
        if (input[end] === '}') depth--;
    }
    return input.slice(start, end - 1);
}
const dispatch = `function dispatch(id, lparam, dparam, sparam) { ${body('RRDispatchPanelEvent')} }`;
const events = {
    CHARTEVENT_MOUSE_MOVE: 1, CHARTEVENT_OBJECT_CLICK: 2, CHARTEVENT_OBJECT_CHANGE: 3,
    CHARTEVENT_CHART_CHANGE: 4, CHARTEVENT_CLICK: 5, CHARTEVENT_CUSTOM: 1000,
};
const BRING_TO_TOP = events.CHARTEVENT_CUSTOM + 14;
const FOCUS_SET = events.CHARTEVENT_CUSTOM + 9;
const CHANGE = events.CHARTEVENT_CUSTOM + 4;

function fixture() {
    const s = { ...events, calls: [], top: null, focused: null, selected: 0, coveredClicks: 0,
        defaultCalls: 0, nativeRedraws: 0, expanded: true };
    // The button is later in the container than the combo, matching the page's
    // overlap. Ordinary child dispatch therefore visits the covered button first.
    const inside = (x, y) => x >= 20 && x <= 320 && y >= 150 && y <= 170;
    s.popup = { id: 42, mouse: (x, y, flags) => {
        if (!s.expanded || !inside(x, y)) return false;
        if (flags & 1) s.selected++;
        return true;
    } };
    s.covered = { mouse: (x, y, flags) => {
        if (!inside(x, y)) return false;
        if (flags & 1) s.coveredClicks++;
        return true;
    } };
    const childrenMouse = (x, y, flags) => s.covered.mouse(x, y, flags) || s.popup.mouse(x, y, flags);
    s.ExtDialog = {
        OnEvent(id, x, y, flags) {
            s.defaultCalls++;
            return id === events.CHARTEVENT_MOUSE_MOVE ? childrenMouse(x, y, Number(flags)) : false;
        },
        ChartEvent(id, x, y, flags) {
            s.calls.push(['chart', id, x, y, flags]);
            if (id === events.CHARTEVENT_OBJECT_CLICK) return;
            if (id === BRING_TO_TOP) { s.top = x === s.popup.id ? s.popup : null; return; }
            if (id === FOCUS_SET) { s.focused = x === s.popup.id ? s.popup : null; return; }
            if (id === events.CHARTEVENT_MOUSE_MOVE) {
                if (s.top?.mouse(x, y, Number(flags))) { s.nativeRedraws++; return; }
                if (childrenMouse(x, y, Number(flags))) s.nativeRedraws++;
                return;
            }
            s.ExtDialog.OnEvent(id, x, y, flags);
        },
        FocusRRTargetLines() { s.calls.push(['priority', s.top?.id || 0, s.focused?.id || 0]); },
    };
    s.ChartRedraw = () => s.calls.push(['redraw']);
    vm.runInContext(dispatch, vm.createContext(s));
    return s;
}
let count = 0;
function check(name, test) { test(); count++; console.log(`ok ${count} - ${name}`); }

check('production OnChartEvent uses the native dispatcher exactly once without direct OnEvent fallback', () => {
    const handler = body('OnChartEvent');
    assert.equal((handler.match(/RRDispatchPanelEvent\(id, lparam, dparam, sparam\)/g) || []).length, 1);
    assert.doesNotMatch(handler, /ExtDialog\.OnEvent\(/);
});
check('object edits preserve all event arguments and focus priorities after native dispatch', () => {
    const s = fixture(); s.dispatch(events.CHARTEVENT_OBJECT_CHANGE, 987654321, 1.2345, '持仓 #291094669');
    assert.deepEqual(s.calls, [['chart', 3, 987654321, 1.2345, '持仓 #291094669'], ['priority', 0, 0]]);
    assert.equal(s.defaultCalls, 1);
});
check('chart changes stay excluded from the native automatic minimization path', () => {
    const s = fixture(); s.dispatch(events.CHARTEVENT_CHART_CHANGE, 0, 0, '');
    assert.deepEqual(s.calls, []); assert.equal(s.defaultCalls, 0);
});
check('mouse moves are delivered once without rescanning all priorities or forced application redraw', () => {
    const s = fixture(); s.dispatch(events.CHARTEVENT_MOUSE_MOVE, 10, 20, '0');
    assert.deepEqual(s.calls, [['chart', 1, 10, 20, '0']]); assert.equal(s.defaultCalls, 0);
});
check('bring-to-top custom event reaches native routing before priority refresh and redraw', () => {
    const s = fixture(); s.dispatch(BRING_TO_TOP, 42, 0, '');
    assert.equal(s.top, s.popup); assert.equal(s.defaultCalls, 0);
    assert.deepEqual(s.calls, [['chart', BRING_TO_TOP, 42, 0, ''], ['priority', 42, 0], ['redraw']]);
});
check('mouse-focus custom event reaches native focus management', () => {
    const s = fixture(); s.dispatch(FOCUS_SET, 42, 0, '');
    assert.equal(s.focused, s.popup); assert.equal(s.defaultCalls, 0);
    assert.deepEqual(s.calls.at(-2), ['priority', 0, 42]);
});
check('overlapping row receives the mouse press across its width without activating the covered close button', () => {
    for (const x of [21, 80, 170, 319]) {
        const s = fixture(); s.dispatch(BRING_TO_TOP, 42, 0, '');
        s.dispatch(events.CHARTEVENT_MOUSE_MOVE, x, 160, '1');
        assert.equal(s.selected, 1); assert.equal(s.coveredClicks, 0); assert.equal(s.defaultCalls, 0);
        assert.equal(s.nativeRedraws, 1);
    }
    // Regression witness: bypassing ChartEvent loses the popup priority even
    // when its visual objects have high Z-order. Covered controls consume it.
    const old = fixture(); old.ExtDialog.OnEvent(BRING_TO_TOP, 42, 0, '');
    old.ExtDialog.OnEvent(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    assert.equal(old.selected, 0); assert.equal(old.coveredClicks, 1);
});
check('closing the popup lets its retained native top-window reference fall through to the visible covered control', () => {
    const s = fixture(); s.dispatch(BRING_TO_TOP, 42, 0, ''); s.expanded = false;
    s.dispatch(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    assert.equal(s.top, s.popup); assert.equal(s.selected, 0); assert.equal(s.coveredClicks, 1);
    assert.equal(s.defaultCalls, 0);
});
check('native object-click exclusion prevents a second action after a handled mouse press', () => {
    const s = fixture(); s.dispatch(BRING_TO_TOP, 42, 0, '');
    s.dispatch(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    s.dispatch(events.CHARTEVENT_OBJECT_CLICK, 170, 160, 'PS_m_CmbRRPositionListItem1');
    assert.equal(s.selected, 1); assert.equal(s.coveredClicks, 0); assert.equal(s.defaultCalls, 0);
});
check('ordinary custom changes still reach standard OnEvent exactly once and redraw', () => {
    const s = fixture(); s.dispatch(CHANGE, 42, 0, '');
    assert.equal(s.defaultCalls, 1); assert.deepEqual(s.calls.at(-1), ['redraw']);
});

for (const [name, filename, method] of [
    ['dialog', '../mt5/RRPlanPanel.mqh', 'CPositionSizeCalculator::OnMouseEvent'],
    ['holding chooser', '../mt5/Position Sizer.mqh', 'OnMouseEvent'],
]) {
    check(`${name} native mouse override preserves visible event traversal and rejects a hidden container`, () => {
        const input = readFileSync(new URL(filename, import.meta.url), 'utf8');
        const implementation = body(method, input)
            .replace(/\b(?:long|double|string)\s+(?=\w+\s*=)/g, 'let ')
            .replace(/(?:CComboBox::)?OnEvent\(/g, 'forwardEvent(');
        // A hidden later-created widget occupies the same rectangle. The native
        // OnEvent contract skips it; raw OnMouseEvent child traversal would not.
        const controls = [{ visible: true, presses: 0 }, { visible: false, presses: 0 }];
        const s = { ...events, visible: true, calls: [], IntegerToString: String };
        s.IsVisible = () => s.visible;
        s.forwardEvent = (...args) => {
            s.calls.push(args);
            for (const control of [...controls].reverse()) {
                if (!control.visible) continue;
                control.presses++; return true;
            }
            return false;
        };
        vm.runInContext(`function mouse(x, y, flags) { ${implementation} }`, vm.createContext(s));
        assert.equal(s.mouse(165, 163, 17), true);
        assert.deepEqual(s.calls, [[events.CHARTEVENT_MOUSE_MOVE, 165, 163, '17']]);
        assert.deepEqual(controls.map(control => control.presses), [1, 0]);
        s.visible = false; assert.equal(s.mouse(165, 163, 17), false);
        assert.equal(s.calls.length, 1); assert.deepEqual(controls.map(control => control.presses), [1, 0]);
        s.visible = true; controls[0].visible = false;
        assert.equal(s.mouse(165, 163, 17), false, 'unhandled mouse event remains unhandled');
        assert.equal(s.calls.length, 2);
    });
}

console.log(`RR dropdown events: ${count} offline production-boundary tests passed; live MT5 UI not exercised.`);
