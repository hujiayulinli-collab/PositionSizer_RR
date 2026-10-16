// Parent exits use one frozen volume/price basis and the existing durable child
// exit journals. Include after RRBatch.mqh and RRManualExecution.mqh.
#ifndef PS_RR_BATCH_EXITS_MQH
#define PS_RR_BATCH_EXITS_MQH
ulong RBLastGroupRun = 0;

double RBClosedGoal(const RRState &s, const double step)
{
    if (step <= 0 || s.initial_volume <= 0) return 0;
    if (s.stage == s.target_count && RRStateClosesAll(s)) return s.initial_volume;
    double percent = 0;
    for (int i = 0; i < s.stage; i++) percent += s.target_percent[i];
    return NormalizeDouble(MathFloor(s.initial_volume * percent / 100.0 / step + 1e-8) * step, 8);
}

// Floor once at the GROUP level. A full smallest child can satisfy a group
// partial exit, even when applying that percentage to every child would be zero.
double RBManualTarget(const double remaining, const double percent, const double step)
{
    if (!MathIsValidNumber(remaining) || remaining <= 0 || !MathIsValidNumber(percent)
        || percent <= 0 || percent > 100 || !MathIsValidNumber(step) || step <= 0) return -1;
    if (percent == 100) return 0;
    double close = MathFloor(remaining * percent / 100.0 / step + 1e-8) * step;
    if (close < step * 0.5) return -1;
    return NormalizeDouble(remaining - close, 8);
}

// Return a legal child reduction without exceeding the outstanding group goal.
// Exact single-child matches are preferred; otherwise avoid a final fragment
// smaller than minimum where a smaller, legal reduction is available.
int RBPickClose(const double &volumes[], const int count, const double wanted,
                const double minimum, const double step, double &lots)
{
    lots = 0;
    if (count < 1 || count > RB_MAX_CHILDREN || wanted < minimum - step * 0.1
        || minimum <= 0 || step <= 0) return -1;
    int selected = -1;
    for (int i = 0; i < count; i++)
    {
        double current = volumes[i];
        if (current <= 0) continue;
        double candidate = MathFloor(MathMin(current, wanted) / step + 1e-8) * step;
        if (candidate < current - step * 0.1 && current - candidate < minimum - step * 0.1)
            candidate = MathFloor((current - minimum) / step + 1e-8) * step;
        if (candidate < minimum - step * 0.1) continue;
        if (wanted - candidate > step * 0.1 && wanted - candidate < minimum - step * 0.1)
        {
            double reduced = MathFloor(MathMin(wanted - minimum, current - minimum) / step + 1e-8) * step;
            if (reduced >= minimum - step * 0.1 && current - reduced >= minimum - step * 0.1)
                candidate = reduced;
        }
        if (candidate > lots)
        { lots = NormalizeDouble(candidate, 8); selected = i; }
        if (MathAbs(wanted - lots) <= step * 0.1) return selected;
    }
    return selected;
}

bool RBReductionPossible(const double &volumes[], const int count, const double wanted,
                         const double minimum, const double step)
{
    if (wanted <= step * 0.1) return true;
    double simulated[RB_MAX_CHILDREN];
    ArrayInitialize(simulated, 0);
    for (int i = 0; i < count; i++) simulated[i] = volumes[i];
    double pending = wanted;
    for (int j = 0; j < RB_MAX_CHILDREN * 2 && pending > step * 0.1; j++)
    {
        double lots;
        int index = RBPickClose(simulated, count, pending, minimum, step, lots);
        if (index < 0 || lots <= 0) return false;
        simulated[index] = NormalizeDouble(simulated[index] - lots, 8);
        pending = NormalizeDouble(pending - lots, 8);
    }
    return pending <= step * 0.1;
}

bool RBSelectSafeChild(const RBGroup &g, const int index)
{
    if (index < 0 || index >= g.child_count || g.child_id[index] == 0) return false;
    string symbol = RBGroupSymbol(g);
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    if (step <= 0 || tick_size <= 0) return false;
    ulong opening_order;
    double in_volume;
    bool mixed;
    if (!RRHistory(g.child_id[index], opening_order, in_volume, mixed) || mixed
        || opening_order != g.child_order[index] || MathAbs(in_volume - g.child_volume[index]) > step * 0.1
        || RMSelectIdentifier(g.child_id[index]) == 0) return false;
    int direction = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
    double volume = PositionGetDouble(POSITION_VOLUME);
    return PositionGetString(POSITION_SYMBOL) == symbol && PositionGetInteger(POSITION_MAGIC) == g.magic
        && direction == g.direction && MathIsValidNumber(volume) && volume > 0
        && volume <= g.child_volume[index] + step * 0.1
        && MathAbs(PositionGetDouble(POSITION_PRICE_OPEN) - g.child_price[index]) <= tick_size * 0.1;
}

bool RBGroupVolumes(const RBGroup &g, double &remaining, double &server_tp,
                     double &volumes[], string &error)
{
    remaining = 0; server_tp = 0;
    ArrayInitialize(volumes, 0);
    string symbol = RBGroupSymbol(g);
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    if (step <= 0 || tick_size <= 0)
    { error = "父订单品种的手数或价格规则尚不可用。"; return false; }
    bool first = true;
    for (int i = 0; i < g.child_count; i++)
    {
        if (g.child_id[i] == 0) continue;
        if (RMSelectIdentifier(g.child_id[i]) == 0) continue;
        if (!RBSelectSafeChild(g, i))
        { error = "子单身份、初始成交量或历史尚无法核对，暂停该父订单并等待核对。"; return false; }
        double volume = PositionGetDouble(POSITION_VOLUME);
        volumes[i] = volume;
        remaining += volume;
        double tp = PositionGetDouble(POSITION_TP);
        if (first) { server_tp = tp; first = false; }
        else if (MathAbs(server_tp - tp) > tick_size * 0.1) server_tp = -1;
    }
    remaining = NormalizeDouble(remaining, 8);
    return true;
}

bool RBGroupCloseBusy(const RBGroup &g)
{
    for (int i = 0; i < g.child_count; i++)
        if (g.child_id[i] != 0 && RMPositionExitActive(g.child_id[i])) return true;
    return false;
}

bool RBGroupGuardLatched(const RBGroup &g)
{
    for (int i = 0; i < g.child_count; i++)
        if (g.child_id[i] != 0 && RGPositionExitLatched(g.child_id[i])
            && RMSelectIdentifier(g.child_id[i]) != 0) return true;
    return false;
}

// Closed child P/L is retained. The budget applies to the trading idea, not to
// each currently open ticket. History is required before evaluating the total.
bool RBGroupNet(const RBGroup &g, double &net)
{
    net = 0;
    for (int i = 0; i < g.child_count; i++)
    {
        ulong id = g.child_id[i];
        if (id == 0) continue;
        ulong opening_order;
        double in_volume;
        bool mixed;
        double step = SymbolInfoDouble(RBGroupSymbol(g), SYMBOL_VOLUME_STEP);
        if (step <= 0 || !RRHistory(id, opening_order, in_volume, mixed) || mixed
            || opening_order != g.child_order[i] || MathAbs(in_volume - g.child_volume[i]) > step * 0.1) return false;
        if (RMSelectIdentifier(id) != 0 && !RBSelectSafeChild(g, i)) return false;
        if (!HistorySelectByPosition(id)) return false;
        int count = HistoryDealsTotal();
        if (count == 0) return false;
        for (int d = 0; d < count; d++)
        {
            ulong deal = HistoryDealGetTicket(d);
            if (deal == 0 || (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID) != id) return false;
            net += HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_SWAP)
                + HistoryDealGetDouble(deal, DEAL_COMMISSION) + HistoryDealGetDouble(deal, DEAL_FEE);
        }
        if (RMSelectIdentifier(id) != 0)
            net += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
    }
    return MathIsValidNumber(net);
}

bool RBReadManagedGroup(const ulong parent, RRState &state, string &symbol,
                        double &remaining, double &server_tp, string &error)
{
    error = "";
    RBGroup g;
    if (!RBReadGroup(parent, g, error)) return false;
    symbol = RBGroupSymbol(g);
    double volumes[RB_MAX_CHILDREN];
    if (!RBGroupVolumes(g, remaining, server_tp, volumes, error)) return false;
    state = g.exit_state;
    if (g.exit_ready == 0)
    {
        state.entry = g.filled_volume > 0 ? g.filled_value / g.filled_volume : g.reference_price;
        state.risk = MathAbs(state.entry - g.stop_loss);
        state.initial_volume = g.filled_volume;
    }
    state.identifier = parent;
    state.version = 2;
    state.checksum = RRChecksum(state);
    return true;
}

bool RBApplyGroupPlanLocked(const int handle, RBGroup &g, const RRPlan &plan,
                            const uint expected_checksum, const int expected_stage, string &error)
{
    if (g.exit_ready == 0 || g.entry_state == RB_ENTRY_BUILDING || g.pending != 0)
    { error = "父订单仍在建仓或等待成交确认，请结束建仓后编辑止盈。"; return false; }
    if (g.risk_latched != 0 || g.exit_state.blocked != 0 || RBGroupGuardLatched(g))
    { error = "父订单正在执行风控或已暂停，不能修改止盈。"; return false; }
    if (g.manual_active != 0 || RBGroupCloseBusy(g))
    { error = "整组减仓尚未完成，请等待后重新加载。"; return false; }
    RRPlan previous;
    RRStatePlan(g.exit_state, previous);
    if (g.exit_state.stage != expected_stage || RRPlanChecksum(previous) != expected_checksum)
    { error = "父订单方案或触发阶段已变化，请重新加载。"; return false; }
    if (!RRPlanValidate(plan, error)) return false;
    if (plan.count < g.exit_state.stage)
    { error = "已触发的目标不能删除。"; return false; }
    for (int i = 0; i < g.exit_state.stage; i++)
        if (plan.targets[i].multiple != g.exit_state.target_r[i]
            || plan.targets[i].percent != g.exit_state.target_percent[i]
            || plan.targets[i].move_be != g.exit_state.target_be[i])
        { error = "已触发目标的 R、比例及 BE 不能修改。"; return false; }
    string symbol = RBGroupSymbol(g);
    double remaining, tp, volumes[RB_MAX_CHILDREN];
    if (!RBGroupVolumes(g, remaining, tp, volumes, error)) return false;
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    if (remaining <= 0 || minimum <= 0)
    { error = "父订单已无余仓，或券商手数规则无效。"; return false; }
    double closed = MathMax(0.0, g.exit_state.initial_volume - remaining);
    if (closed < RBClosedGoal(g.exit_state, step) - step * 0.1)
    { error = "已触发目标的减仓尚未完成，请稍后再修改。"; return false; }
    if (!RRPositionPlanPricesSafe(g.exit_state, plan, symbol, error)) return false;
    // Validate future cumulative cuts against the actual child distribution.
    double cumulative = 0;
    for (int i = 0; i < plan.count; i++)
    {
        cumulative += plan.targets[i].percent;
        if (i < g.exit_state.stage) continue;
        double goal = RRPlanClosesAll(plan) && i == plan.count - 1 ? g.exit_state.initial_volume
            : MathFloor(g.exit_state.initial_volume * cumulative / 100.0 / step + 1e-8) * step;
        double wanted = MathMax(0.0, goal - closed);
        for (int j = 0; wanted > step * 0.1 && j < RB_MAX_CHILDREN * 2; j++)
        {
            double lots;
            int index = RBPickClose(volumes, g.child_count, wanted, minimum, step, lots);
            if (index < 0)
            { error = StringFormat("第 %d 项按现有子单无法满足最小手数，请调整比例。", i + 1); return false; }
            volumes[index] = NormalizeDouble(volumes[index] - lots, 8);
            wanted = NormalizeDouble(wanted - lots, 8);
            closed += lots;
        }
        if (wanted > step * 0.1)
        { error = "目标减仓无法分配为合法子订单手数。"; return false; }
    }
    RBGroup updated = g;
    updated.exit_state.target_count = plan.count;
    for (int i = 0; i < RR_MAX_TARGETS; i++)
    {
        updated.exit_state.target_r[i] = i < plan.count ? plan.targets[i].multiple : 0;
        updated.exit_state.target_percent[i] = i < plan.count ? plan.targets[i].percent : 0;
        updated.exit_state.target_be[i] = i < plan.count ? plan.targets[i].move_be : 0;
    }
    updated.exit_state.first_r = updated.exit_state.target_r[0];
    updated.exit_state.final_r = updated.exit_state.target_r[plan.count - 1];
    updated.exit_state.percent = updated.exit_state.target_percent[0];
    updated.exit_state.move_be = updated.exit_state.target_be[0];
    if (!RBSaveGroup(handle, updated))
    { error = "父订单止盈保存未确认，停止后续操作。"; return false; }
    g = updated;
    return true;
}

bool RBApplyGroupPlan(const ulong parent, const RRPlan &plan,
                      const uint expected_checksum, const int expected_stage, string &error)
{
    error = "";
    int handle = RBLockGroup(parent);
    if (handle == INVALID_HANDLE)
    { error = "父订单正被其他图表处理，请稍后重试。"; return false; }
    RBGroup g;
    bool ok = RBLoadGroup(handle, g);
    if (!ok || g.parent_id != parent)
    { error = "父订单记录无法核对，停止修改。"; ok = false; }
    else ok = RBApplyGroupPlanLocked(handle, g, plan, expected_checksum, expected_stage, error);
    FileClose(handle);
    return ok;
}

bool RBRegisterGroupClose(const int handle, RBGroup &g, const double percent, string &error)
{
    if (g.exit_ready == 0 || g.entry_state == RB_ENTRY_BUILDING || g.pending != 0)
    { error = "请先取消后续建仓，并等待当前子单确认，再操作整组平仓。"; return false; }
    if (g.risk_latched != 0 || g.exit_state.blocked != 0 || RBGroupGuardLatched(g))
    { error = "该父订单已有风控任务或已暂停，将优先处理保护。"; return false; }
    if (g.manual_active != 0 || RBGroupCloseBusy(g))
    { error = "父订单已有减仓任务，请等待完成，勿重复点击。"; return false; }
    if (g.manual_completed > 0 && (long)TimeLocal() - g.manual_completed < 2)
    { error = "上次整组平仓刚完成，请稍后再确认新的比例。"; return false; }
    string symbol = RBGroupSymbol(g);
    double remaining, tp, volumes[RB_MAX_CHILDREN];
    if (!RBGroupVolumes(g, remaining, tp, volumes, error)) return false;
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double target = RBManualTarget(remaining, percent, step);
    if (target < 0 || !RBReductionPossible(volumes, g.child_count, remaining - target, minimum, step))
    { error = "请输入大于 0、不超过 100 的比例，并满足整组最小平仓手数。"; return false; }
    RBGroup updated = g;
    updated.manual_active = 1;
    updated.manual_target_remaining = target;
    updated.manual_created = (long)TimeLocal();
    updated.manual_completed = 0;
    if (!RBSaveGroup(handle, updated))
    { error = "整组平仓目标保存未确认，未发送平仓。"; return false; }
    g = updated;
    error = StringFormat("已登记父订单 #%I64u 平仓 %.2f%%，固定目标余仓 %.8f 手。", g.parent_id, percent, target);
    return true;
}

bool RBRequestGroupClose(const ulong parent, const double percent, string &error)
{
    error = "";
    int handle = RBLockGroup(parent);
    if (handle == INVALID_HANDLE)
    { error = "父订单正在处理，请稍后重试。"; return false; }
    RBGroup g;
    bool ok = RBLoadGroup(handle, g);
    if (!ok || g.parent_id != parent)
    { error = "父订单记录无法核对，停止平仓。"; ok = false; }
    else ok = RBRegisterGroupClose(handle, g, percent, error);
    FileClose(handle);
    return ok;
}

bool RBUpdateGroupStops(const int handle, RBGroup &g)
{
    if (!RRCanTrade() || (long)TimeLocal() - g.exit_state.last_stop_request < 3) return true;
    string symbol = RBGroupSymbol(g);
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    if (tick_size <= 0 || point <= 0) return true;
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask < tick.bid) return true;
    double current = g.direction == 1 ? tick.bid : tick.ask;
    double distance = (double)MathMax(SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL),
        SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL)) * point + tick_size;
    double desired_tp = RRStateClosesAll(g.exit_state) ? RRTargetPrice(g.direction, g.exit_state.entry,
        g.exit_state.risk, g.exit_state.final_r, tick_size, digits) : 0;
    double be = RRBETarget(g.direction, g.exit_state.entry, g.exit_state.offset_points, point, tick_size, digits);
    bool saved_stamp = false;
    bool all_be = g.exit_state.be_requested != 0;
    for (int i = 0; i < g.child_count; i++)
    {
        ulong ticket = g.child_id[i] == 0 ? 0 : RMSelectIdentifier(g.child_id[i]);
        if (ticket == 0) continue;
        if (!RBSelectSafeChild(g, i)) { all_be = false; continue; }
        if (RGPositionExitLatched(g.child_id[i])) { all_be = false; continue; }
        double old_sl = PositionGetDouble(POSITION_SL);
        double old_tp = PositionGetDouble(POSITION_TP);
        double sl = old_sl, tp = old_tp;
        if (desired_tp == 0) tp = 0;
        else if (g.direction * (desired_tp - current) >= distance) tp = desired_tp;
        if (g.exit_state.be_requested != 0 && !RRSLProtectsBE(g.direction, old_sl, be, tick_size))
        {
            all_be = false;
            if (g.direction * (current - be) >= distance) sl = be;
        }
        if (MathAbs(sl - old_sl) <= tick_size * 0.1 && MathAbs(tp - old_tp) <= tick_size * 0.1) continue;
        if (!saved_stamp)
        {
            g.exit_state.last_stop_request = (long)TimeLocal();
            if (!RBSaveGroup(handle, g)) return false;
            saved_stamp = true;
        }
        MqlTradeRequest request = {};
        MqlTradeResult result = {};
        request.action = TRADE_ACTION_SLTP;
        request.position = ticket;
        request.symbol = symbol;
        request.magic = (ulong)g.magic;
        request.sl = sl;
        request.tp = tp;
        bool sent = OrderSend(request, result);
        if (!sent || (result.retcode != TRADE_RETCODE_DONE && result.retcode != TRADE_RETCODE_NO_CHANGES))
            RRNotice(StringFormat("父订单 #%I64u 子单 #%I64u 更新保护未确认，稍后重试。", g.parent_id, ticket));
    }
    if (all_be && g.exit_state.be_done == 0)
    { g.exit_state.be_done = 1; return RBSaveGroup(handle, g); }
    return true;
}

bool RBManageGroupRisk(const int handle, RBGroup &g)
{
    double net;
    if (g.risk_latched == 0 && RBGroupNet(g, net) && g.risk_budget > 0 && net <= -g.risk_budget)
    {
        g.risk_latched = 1;
        RBStopGroupEntry(g);
        RBFreezeExit(g);
        if (!RBSaveGroup(handle, g)) return true;
        RDPlayRiskAlert(StringFormat("父订单 #%I64u 整组亏损 %.2f，达到额度 %.2f；停止建仓并强制平仓。",
            g.parent_id, -net, g.risk_budget));
    }
    if (g.risk_latched == 0) return false;
    for (int i = 0; i < g.child_count; i++)
    {
        ulong ticket = g.child_id[i] == 0 ? 0 : RMSelectIdentifier(g.child_id[i]);
        if (ticket == 0) continue;
        if (!RBSelectSafeChild(g, i))
        {
            RRNotice(StringFormat("父订单 #%I64u 子单 #%I64u 身份或初始成交历史无法核对，暂不强平该子单。", g.parent_id, ticket));
            continue;
        }
        string status;
        RGExitPosition(ticket, StringFormat("batch_loss_%I64u", g.parent_id), g.magic, status);
    }
    return true;
}

void RBManageGroupLocked(const int handle, RBGroup &g)
{
    if (RBManageGroupRisk(handle, g)) return;
    if (g.exit_ready == 0 || g.entry_state == RB_ENTRY_BUILDING || g.pending != 0 || g.exit_state.blocked != 0) return;
    string symbol = RBGroupSymbol(g);
    double remaining, server_tp, volumes[RB_MAX_CHILDREN];
    string error;
    if (!RBGroupVolumes(g, remaining, server_tp, volumes, error))
    {
        // Missing history/quotes can be transient. The identity/history checks
        // remain fail-closed on every retry without permanently latching those
        // temporary connectivity failures as a changed child identity.
        RRNotice(error);
        return;
    }
    if (RBGroupGuardLatched(g)) return; // Existing account/position guard owns exits.
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    if (minimum <= 0 || step <= 0) return;
    if (RR_Enable && remaining > 0)
    {
        MqlTick tick;
        double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
        int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
        if (SymbolInfoTick(symbol, tick) && tick.bid > 0 && tick.ask >= tick.bid)
        {
            int previous = g.exit_state.stage;
            while (g.exit_state.stage < g.exit_state.target_count && RRTargetReached(g.direction,
                g.exit_state.entry, g.exit_state.risk, g.exit_state.target_r[g.exit_state.stage],
                tick.bid, tick.ask, tick_size, digits))
            {
                if (g.exit_state.target_be[g.exit_state.stage] != 0) g.exit_state.be_requested = 1;
                g.exit_state.stage++;
            }
            if (previous != g.exit_state.stage && !RBSaveGroup(handle, g)) return;
        }
        if (!RBUpdateGroupStops(handle, g)) return;
    }
    // A task can be complete at the broker while its journal awaits history.
    // No other child request is registered until every prior RM job is settled.
    if (RBGroupCloseBusy(g)) return;
    // SL/TP synchronization or another manager may have changed the position
    // snapshot. Re-read all live child volumes before choosing a reduction.
    if (!RBGroupVolumes(g, remaining, server_tp, volumes, error)) return;
    if (g.manual_active != 0 && remaining <= g.manual_target_remaining + step * 0.1)
    {
        g.manual_active = 0;
        g.manual_completed = (long)TimeLocal();
        if (!RBSaveGroup(handle, g)) return;
    }
    double target = remaining;
    if (RR_Enable) target = MathMin(target, MathMax(0.0, g.exit_state.initial_volume - RBClosedGoal(g.exit_state, step)));
    if (g.manual_active != 0) target = MathMin(target, g.manual_target_remaining);
    double wanted = NormalizeDouble(remaining - target, 8);
    if (wanted <= step * 0.1) return;
    double lots;
    int index = RBPickClose(volumes, g.child_count, wanted, minimum, step, lots);
    if (index < 0) return;
    // RM persists its own intent before sending; the parent target was already
    // flushed. A crash between these steps cannot reset the percentage basis.
    double percent = lots >= volumes[index] - step * 0.1 ? 100.0 : lots / volumes[index] * 100.0;
    RMRequestClose(g.child_id[index], percent, g.magic, error, g.direction);
}

void RBManageGroups()
{
    ulong now = GetTickCount64();
    if (now - RBLastGroupRun < 250) return;
    RBLastGroupRun = now;
    ulong ids[];
    RBCollectGroups(ids);
    for (int i = 0; i < ArraySize(ids); i++)
    {
        int handle = RBLockGroup(ids[i]);
        if (handle == INVALID_HANDLE) continue;
        RBGroup g;
        if (RBLoadGroup(handle, g) && g.parent_id == ids[i]) RBManageGroupLocked(handle, g);
        FileClose(handle);
    }
}
#endif
