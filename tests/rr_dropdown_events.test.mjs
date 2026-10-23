// Execute the production event boundary with inert controls. The small dialog
// fixture models only CAppDialog's documented focus/top-window routing and
// reverse child traversal; it does not emulate MT5 rendering or validate live UI.
// No terminal, account, chart objects, sounds, or trading API are accessed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../mt5/Position Sizer RR.mq5', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../mt5/Position Sizer.mqh', import.meta.url), 'utf8')
    + '\n' + readFileSync(new URL('../mt5/RRPlanPanel.mqh', import.meta.url), 'utf8');
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
function adapt(input) {
    return input.replace(/\b(?:const\s+)?(?:bool|int|long|ulong|string)\s+(?=\w+\s*=)/g, 'let ');
}
const dragMethod = /bool CPositionSizeCalculator::RRPanelDragEvent\(/.test(panelSource)
    ? 'CPositionSizeCalculator::RRPanelDragEvent' : 'RRPanelDragEvent';
const dispatch = `
function RRPanelEventRelevant(id, lparam, sparam) { ${adapt(body('RRPanelEventRelevant'))} }
function RRPanelDragEvent(id, lparam, sparam) { ${adapt(body(dragMethod, panelSource))} }
function dispatch(id, lparam, dparam, sparam) { ${adapt(body('RRDispatchPanelEvent'))} }
`;
const events = {
    CHARTEVENT_MOUSE_MOVE: 1, CHARTEVENT_OBJECT_CLICK: 2, CHARTEVENT_OBJECT_CHANGE: 3,
    CHARTEVENT_CHART_CHANGE: 4, CHARTEVENT_CLICK: 5, CHARTEVENT_CUSTOM: 1000,
    CHARTEVENT_OBJECT_CREATE: 6, CHARTEVENT_OBJECT_DELETE: 7,
    ON_CLICK: 0, ON_CHANGE: 4, ON_MOUSE_FOCUS_SET: 9, ON_DRAG_START: 11,
    ON_DRAG_PROCESS: 12, ON_DRAG_END: 13, ON_BRING_TO_TOP: 14, ON_APP_CLOSE: 100,
    CONTROLS_MAXIMUM_ID: 10000, CONTROLS_INVALID_ID: -1,
};
const BRING_TO_TOP = events.CHARTEVENT_CUSTOM + 14;
const FOCUS_SET = events.CHARTEVENT_CUSTOM + 9;
const CHANGE = events.CHARTEVENT_CUSTOM + 4;
const PREFIX = '12345';
const BASE = 10000;
const POPUP_ID = BASE + 42;
const POPUP_NAME = PREFIX + 'm_CmbRRPosition';

function fixture() {
    const s = { ...events, calls: [], top: null, focused: null, selected: 0, coveredClicks: 0,
        defaultCalls: 0, nativeRedraws: 0, expanded: true, dragActive: false,
        restoredObjects: [], dragProcesses: 0, dragEnds: 0,
        StringFind: (text, search) => text.indexOf(search),
        StringLen: text => text.length,
        GetTickCount64: () => 1000, RRReportSlowUI: () => {},
        RRPanelInitSucceeded: true, POINTER_DYNAMIC: 'dynamic', POINTER_INVALID: 'invalid',
        CheckPointer: pointer => pointer ? 'dynamic' : 'invalid' };
    // The button is later in the container than the combo, matching the page's
    // overlap. Ordinary child dispatch therefore visits the covered button first.
    const inside = (x, y) => x >= 20 && x <= 320 && y >= 150 && y <= 170;
    s.popup = { id: POPUP_ID, mouse: (x, y, flags) => {
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
        Id: () => BASE,
        Name: () => PREFIX,
        RRPanelDragEvent: (...args) => s.RRPanelDragEvent(...args),
        RefreshRRPanelObjectPriority: name => s.calls.push(['restore-priority', name]),
        OnEvent(id, x, y, flags) {
            s.defaultCalls++;
            if (id === events.CHARTEVENT_OBJECT_DELETE) {
                s.restoredObjects.push(flags); return true;
            }
            if (id === events.CHARTEVENT_CUSTOM + events.ON_DRAG_PROCESS && s.dragActive) {
                s.dragProcesses++; return true;
            }
            if (id === events.CHARTEVENT_CUSTOM + events.ON_DRAG_END && s.dragActive) {
                s.dragEnds++; s.dragActive = false; return true;
            }
            if (id === CHANGE) return true;
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
            if (s.ExtDialog.OnEvent(id, x, y, flags)) s.nativeRedraws++;
        },
        FocusRRTargetLines() { s.calls.push(['priority', s.top?.id || 0, s.focused?.id || 0]); },
    };
    const drag = { Id: () => -1, Name: () => '' };
    Object.defineProperty(s, 'm_drag_object', { get: () => s.dragActive ? drag : null });
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
check('bring-to-top custom event reaches native routing before priority refresh without an extra redraw', () => {
    const s = fixture(); s.dispatch(BRING_TO_TOP, POPUP_ID, 0, POPUP_NAME);
    assert.equal(s.top, s.popup); assert.equal(s.defaultCalls, 0);
    assert.deepEqual(s.calls, [['chart', BRING_TO_TOP, POPUP_ID, 0, POPUP_NAME], ['priority', POPUP_ID, 0]]);
});
check('mouse-focus custom event reaches native focus management', () => {
    const s = fixture(); s.dispatch(FOCUS_SET, POPUP_ID, 0, POPUP_NAME);
    assert.equal(s.focused, s.popup); assert.equal(s.defaultCalls, 0);
    assert.deepEqual(s.calls.at(-1), ['priority', 0, POPUP_ID]);
});
check('overlapping row receives the mouse press across its width without activating the covered close button', () => {
    for (const x of [21, 80, 170, 319]) {
        const s = fixture(); s.dispatch(BRING_TO_TOP, POPUP_ID, 0, POPUP_NAME);
        s.dispatch(events.CHARTEVENT_MOUSE_MOVE, x, 160, '1');
        assert.equal(s.selected, 1); assert.equal(s.coveredClicks, 0); assert.equal(s.defaultCalls, 0);
        assert.equal(s.nativeRedraws, 1);
    }
    // Regression witness: bypassing ChartEvent loses the popup priority even
    // when its visual objects have high Z-order. Covered controls consume it.
    const old = fixture(); old.ExtDialog.OnEvent(BRING_TO_TOP, POPUP_ID, 0, POPUP_NAME);
    old.ExtDialog.OnEvent(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    assert.equal(old.selected, 0); assert.equal(old.coveredClicks, 1);
});
check('closing the popup lets its retained native top-window reference fall through to the visible covered control', () => {
    const s = fixture(); s.dispatch(BRING_TO_TOP, POPUP_ID, 0, POPUP_NAME); s.expanded = false;
    s.dispatch(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    assert.equal(s.top, s.popup); assert.equal(s.selected, 0); assert.equal(s.coveredClicks, 1);
    assert.equal(s.defaultCalls, 0);
});
check('native object-click exclusion prevents a second action after a handled mouse press', () => {
    const s = fixture(); s.dispatch(BRING_TO_TOP, POPUP_ID, 0, POPUP_NAME);
    s.dispatch(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    s.dispatch(events.CHARTEVENT_OBJECT_CLICK, 170, 160, 'PS_m_CmbRRPositionListItem1');
    assert.equal(s.selected, 1); assert.equal(s.coveredClicks, 0); assert.equal(s.defaultCalls, 0);
});
check('ordinary custom changes reach standard OnEvent exactly once with only native redraw', () => {
    const s = fixture(); s.dispatch(CHANGE, POPUP_ID, 0, POPUP_NAME);
    assert.equal(s.defaultCalls, 1); assert.equal(s.nativeRedraws, 1);
    assert.equal(s.calls.filter(call => call[0] === 'redraw').length, 0);
});

check('one thousand creation and retired-panel events produce no native dispatch, priority work, or redraw', () => {
    const s = fixture();
    for (let i = 0; i < 1000; i++) {
        s.dispatch(events.CHARTEVENT_OBJECT_CREATE, 0, 0, PREFIX + 'm_Object' + i);
        s.dispatch(events.CHARTEVENT_OBJECT_DELETE, 0, 0, '54321m_Object' + i);
        s.dispatch(CHANGE, BASE - 1, 0, POPUP_NAME);
        s.dispatch(CHANGE, POPUP_ID, 0, '54321m_CmbRRPosition');
    }
    assert.deepEqual(s.calls, []);
    assert.equal(s.defaultCalls, 0); assert.equal(s.nativeRedraws, 0);
    assert.deepEqual(s.restoredObjects, []);
    // Interaction must still work directly after draining that event storm.
    s.dispatch(BRING_TO_TOP, POPUP_ID, 0, POPUP_NAME);
    s.dispatch(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    assert.equal(s.selected, 1); assert.equal(s.coveredClicks, 0);
});
check('deleting an active panel object still reaches native object restoration exactly once', () => {
    const s = fixture(); const name = PREFIX + 'm_EdtRiskMIn';
    s.dispatch(events.CHARTEVENT_OBJECT_DELETE, 0, 0, name);
    assert.deepEqual(s.restoredObjects, [name]); assert.equal(s.defaultCalls, 1);
    assert.deepEqual(s.calls.find(call => call[0] === 'restore-priority'), ['restore-priority', name]);
    assert.equal(s.calls[0][0], 'chart', 'restore native object before restoring cached click priority');
    assert.equal(s.nativeRedraws, 1);
    assert.equal(s.calls.filter(call => call[0] === 'redraw').length, 0);
});
check('native control event filtering requires both the current ID band and current dialog prefix', () => {
    const s = fixture();
    for (const event of [CHANGE, BRING_TO_TOP, FOCUS_SET, events.CHARTEVENT_CUSTOM]) {
        for (const [id, name] of [[-1, POPUP_NAME], [BASE - 1, POPUP_NAME],
            [BASE + events.CONTROLS_MAXIMUM_ID, POPUP_NAME], [POPUP_ID, ''], [POPUP_ID, '54321m_CmbRRPosition']]) {
            s.dispatch(event, id, 0, name);
        }
    }
    assert.deepEqual(s.calls, []); assert.equal(s.nativeRedraws, 0);
    assert.equal(s.RRPanelEventRelevant(CHANGE, BASE, PREFIX), true);
    assert.equal(s.RRPanelEventRelevant(CHANGE, BASE + events.CONTROLS_MAXIMUM_ID - 1, POPUP_NAME), true);
    s.ExtDialog.Id = () => 0; // First attachment uses the standard native base.
    assert.equal(s.RRPanelEventRelevant(CHANGE, 42, POPUP_NAME), true);
    assert.equal(s.RRPanelEventRelevant(CHANGE, -1, POPUP_NAME), false,
        'pre-Run combo change cannot match an uncreated optional control with ID -1');
});
check('incomplete or absent panel cannot receive queued native notifications', () => {
    const s = fixture();
    s.RRPanelInitSucceeded = false;
    s.dispatch(CHANGE, POPUP_ID, 0, POPUP_NAME);
    s.dispatch(events.CHARTEVENT_MOUSE_MOVE, 170, 160, '1');
    s.RRPanelInitSucceeded = true; s.ExtDialog = null;
    s.dispatch(CHANGE, POPUP_ID, 0, POPUP_NAME);
    assert.deepEqual(s.calls, []); assert.equal(s.defaultCalls, 0);
});
check('anonymous transient drag process and end events remain valid only during a real native dialog drag', () => {
    const s = fixture(); const process = events.CHARTEVENT_CUSTOM + events.ON_DRAG_PROCESS;
    const end = events.CHARTEVENT_CUSTOM + events.ON_DRAG_END;
    s.dispatch(process, -1, 0, ''); s.dispatch(end, -1, 0, '');
    assert.deepEqual(s.calls, []);
    s.dragActive = true;
    s.dispatch(CHANGE, -1, 0, '');
    s.dispatch(process, -1, 0, 'foreign');
    s.dispatch(process, 0, 0, '');
    assert.deepEqual(s.calls, []);
    s.dispatch(process, -1, 0, '');
    assert.equal(s.dragProcesses, 1); assert.equal(s.dragActive, true);
    s.dispatch(end, -1, 0, '');
    assert.equal(s.dragEnds, 1); assert.equal(s.dragActive, false);
    const delivered = s.calls.length;
    s.dispatch(process, -1, 0, ''); s.dispatch(end, -1, 0, '');
    assert.equal(s.calls.length, delivered); assert.equal(s.nativeRedraws, 2);
});
check('external application-close and unknown custom events remain compatible without forced redraw', () => {
    const s = fixture();
    s.dispatch(events.CHARTEVENT_CUSTOM + events.ON_APP_CLOSE, 0, 0, 'Other indicator');
    s.dispatch(events.CHARTEVENT_CUSTOM + 432, -123, 7.5, 'External message');
    assert.equal(s.defaultCalls, 2);
    assert.equal(s.calls.filter(call => call[0] === 'chart').length, 2);
    assert.equal(s.calls.filter(call => call[0] === 'redraw').length, 0);
    assert.equal(s.nativeRedraws, 0);
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
