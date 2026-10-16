// A drag edits the saved exit plan. Broker execution remains in the managers.
#ifndef PS_RR_TARGET_DRAG_MQH
#define PS_RR_TARGET_DRAG_MQH

struct RRDragSnapshot
{
    string name;
    string symbol;
    string server;
    long account;
    ulong owner;
    long magic;
    bool parent;
    bool editable;
    bool editing;
    int index;
    int stage;
    uint plan_checksum;
    int direction;
    double entry;
    double risk;
    double price;
};
RRDragSnapshot RRDragLines[];
ulong RRDragFocusedOwner = 0;
bool RRDragFocusedParent = false;

void RRFocusTargetLines(const ulong owner, const bool parent)
{
    RRDragFocusedOwner = owner;
    RRDragFocusedParent = parent;
    // Selection can change between ticks. Update click priority immediately,
    // before the user starts dragging an overlapping line from the new owner.
    for (int i = 0; i < ArraySize(RRDragLines); i++)
        if (ObjectFind(ChartID(), RRDragLines[i].name) >= 0)
            ObjectSetInteger(ChartID(), RRDragLines[i].name, OBJPROP_ZORDER,
                RRTargetLinePriority(RRDragLines[i].name));
}

long RRTargetLinePriority(const string name)
{
    int slot = RRFindDragLine(name);
    if (slot < 0 || !RRDragLines[slot].editable) return 0;
    return RRDragLines[slot].owner == RRDragFocusedOwner && RRDragLines[slot].parent == RRDragFocusedParent ? 20 : 10;
}

bool RRTargetLineEditing(const string name)
{
    int slot = RRFindDragLine(name);
    return slot >= 0 && RRDragLines[slot].editing;
}

int RRFindDragLine(const string name)
{
    for (int i = 0; i < ArraySize(RRDragLines); i++)
        if (RRDragLines[i].name == name) return i;
    return -1;
}

void RRResetDragLines() { ArrayResize(RRDragLines, 0); }

void RRPruneDragLines()
{
    int kept = 0;
    for (int i = 0; i < ArraySize(RRDragLines); i++)
    {
        if (ObjectFind(ChartID(), RRDragLines[i].name) < 0) continue;
        if (kept != i) RRDragLines[kept] = RRDragLines[i];
        kept++;
    }
    ArrayResize(RRDragLines, kept);
}

void RRRememberTargetLine(const string name, const string symbol, const ulong owner,
                          const bool parent, const RRState &state, const RRPlan &plan,
                          const int index, const double price, const bool editable)
{
    int slot = RRFindDragLine(name);
    if (slot >= 0 && editable && ObjectFind(ChartID(), name) >= 0)
    {
        double actual = ObjectGetDouble(ChartID(), name, OBJPROP_PRICE);
        double tick = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
        if (ObjectGetInteger(ChartID(), name, OBJPROP_SELECTED)
            || (MathIsValidNumber(actual) && tick > 0 && MathAbs(actual - RRDragLines[slot].price) > tick * 1e-7))
        {
            RRDragLines[slot].editing = true;
            return;
        }
    }
    // Preserve the last displayed generation while selected. If its stage or
    // plan changes elsewhere, releasing the drag must reject the stale edit.
    if (slot < 0) { slot = ArraySize(RRDragLines); ArrayResize(RRDragLines, slot + 1); }
    RRDragSnapshot item;
    item.name = name; item.symbol = symbol; item.owner = owner; item.parent = parent;
    item.account = AccountInfoInteger(ACCOUNT_LOGIN); item.server = AccountInfoString(ACCOUNT_SERVER);
    item.magic = state.magic; item.editable = editable; item.editing = false; item.index = index;
    item.stage = state.stage; item.plan_checksum = RRPlanChecksum(plan);
    item.direction = state.direction; item.entry = state.entry; item.risk = state.risk; item.price = price;
    RRDragLines[slot] = item;
}

bool RRPlanAtDraggedPrice(const RRState &state, const int index, const double requested,
                          const string symbol, RRPlan &plan, double &legal_price, string &error)
{
    if (state.version != 2 || state.blocked != 0 || state.pending != 0
        || index < state.stage || index < 0 || index >= state.target_count)
    { error = "该目标已触发、正在退出或不可编辑。"; return false; }
    RRStatePlan(state, plan);
    double tick = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    double multiple;
    if (!RRTargetMultipleFromPrice(state.direction, state.entry, state.risk, requested, tick, digits, multiple, legal_price))
    { error = "目标价格无效，必须位于开仓价的盈利方向，并符合品种价格精度。"; return false; }
    // Keep the target's identity, percent and BE. Never reorder other stages.
    if (index > 0)
    {
        double previous = RRTargetPrice(state.direction, state.entry, state.risk, plan.targets[index - 1].multiple, tick, digits);
        if (state.direction * (legal_price - previous) < tick * (1.0 - 1e-7))
        { error = "此 TP 不能越过或重合前一个 TP；请保持目标的先后顺序。"; return false; }
    }
    if (index + 1 < plan.count)
    {
        double next = RRTargetPrice(state.direction, state.entry, state.risk, plan.targets[index + 1].multiple, tick, digits);
        if (state.direction * (next - legal_price) < tick * (1.0 - 1e-7))
        { error = "此 TP 不能越过或重合后一个 TP；可先移动后面的目标。"; return false; }
    }
    plan.targets[index].multiple = multiple;
    return RRPlanValidate(plan, error);
}

bool RRSaveDraggedTarget(const RRDragSnapshot &item, const double requested, double &legal_price, string &error)
{
    error = "";
    if (!item.editable || !RR_Enable || item.symbol != _Symbol
        || item.account != AccountInfoInteger(ACCOUNT_LOGIN) || item.server != AccountInfoString(ACCOUNT_SERVER))
    { error = "目标不可拖动，或账户、图表品种已变化；请使用当前持仓目标线。"; return false; }
    RRState current;
    if (item.parent)
    {
        string symbol;
        double remaining, server_tp;
        if (RBGroupBuilding(item.owner))
        { error = "父组尚在建仓或等待成交确认，请结束建仓后移动 TP。"; return false; }
        if (!RBReadManagedGroup(item.owner, current, symbol, remaining, server_tp, error)) return false;
        if (symbol != item.symbol || remaining <= 0 || current.magic != item.magic)
        { error = "父组已关闭或身份已变化，请刷新后再操作。"; return false; }
    }
    else
    {
        ulong ticket;
        if (RBIsChild(item.owner))
        { error = "该持仓属于父组，请移动父组的共同目标线。"; return false; }
        if (!RRReadManagedPosition(item.symbol, item.magic, item.owner, current, ticket, error)) return false;
    }
    RRPlan previous;
    RRStatePlan(current, previous);
    if (current.stage != item.stage || RRPlanChecksum(previous) != item.plan_checksum
        || current.entry != item.entry || current.risk != item.risk || current.direction != item.direction)
    { error = "拖动期间方案或触发阶段已变化，本次未覆盖新状态；请重新拖动。"; return false; }
    RRPlan updated;
    if (!RRPlanAtDraggedPrice(current, item.index, requested, item.symbol, updated, legal_price, error)) return false;
    // Existing APIs recheck quotes, identity, live volume and competing exits
    // under the same journal lock before persisting the new plan.
    if (item.parent)
        return RBApplyGroupPlan(item.owner, updated, item.plan_checksum, item.stage, error);
    return RRApplyPositionPlan(item.symbol, item.magic, item.owner, updated, item.plan_checksum, item.stage, error);
}

bool RRHandleTargetDrag(const string name, string &message, ulong &owner, bool &parent, bool &saved)
{
    owner = 0; parent = false; saved = false; message = "";
    if (StringFind(name, "PSRR_Targets_") != 0) return false;
    int slot = RRFindDragLine(name);
    if (slot < 0 || ObjectFind(ChartID(), name) < 0) return true; // Preview/label/stale event: no authority.
    RRDragSnapshot item = RRDragLines[slot];
    double requested = ObjectGetDouble(ChartID(), name, OBJPROP_PRICE);
    RRDragLines[slot].editing = false;
    if (requested == item.price)
    {
        ObjectSetInteger(ChartID(), name, OBJPROP_SELECTED, false);
        return true; // Selection/color-only properties change is not a TP edit.
    }
    owner = item.owner; parent = item.parent;
    double legal_price = item.price;
    if (ObjectGetInteger(ChartID(), name, OBJPROP_TYPE) != OBJ_HLINE)
        message = "目标线对象已改变，未修改止盈。";
    else saved = RRSaveDraggedTarget(item, requested, legal_price, message);
    // Restore a known saved price even if the following refresh finds a busy
    // journal. A rejected drop must never look like it has taken effect.
    ObjectSetInteger(ChartID(), name, OBJPROP_SELECTED, false);
    ObjectSetDouble(ChartID(), name, OBJPROP_PRICE, saved ? legal_price : item.price);
    if (saved) RRDragLines[slot].price = legal_price;
    if (saved)
        message = StringFormat("%s #%I64u 的 TP%d 已保存为 %s；比例和 BE 保持不变。",
            parent ? "父组" : "持仓", owner, item.index + 1,
            DoubleToString(legal_price, (int)SymbolInfoInteger(item.symbol, SYMBOL_DIGITS)));
    return true;
}
#endif
