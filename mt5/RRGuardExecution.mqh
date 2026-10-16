// Durable emergency execution, separate from ordinary RR position journals.
// Include after Position Sizer RR.mqh. The caller decides which objects trigger.
#ifndef PS_RR_GUARD_EXECUTION_MQH
#define PS_RR_GUARD_EXECUTION_MQH

// Implemented by the guard/controller: audible notification immediately after
// durable creation, before any potentially blocking broker request.
void RGOnPositionLatched(const ulong ticket);

struct RGExecutionState
{
    uint version;
    int kind;                 // 1 = position identifier; 2 = pending order ticket.
    ulong identifier;
    ulong initial_ticket;
    long manager_magic;
    uint symbol_hash;
    uint trigger_hash;
    int direction;
    int sequence;
    int pending;
    int complete;
    ulong pending_order;
    double before_volume;
    double requested_volume;
    long last_request;
    uint checksum;
};

string RGExecutionFile(const int kind, const ulong identifier)
{
    return StringFormat("PSRR_Guard\\%u_%I64d\\%s_%I64u.bin", RRHash(AccountInfoString(ACCOUNT_SERVER)),
        AccountInfoInteger(ACCOUNT_LOGIN), kind == 1 ? "position" : "order", identifier);
}

bool RGPositionExitLatched(const ulong identifier)
{
    // Even an unreadable/torn record prevents ordinary RR from issuing a close.
    return identifier != 0 && FileIsExist(RGExecutionFile(1, identifier));
}

bool RGOrderCancelLatched(const ulong ticket)
{
    return ticket != 0 && FileIsExist(RGExecutionFile(2, ticket));
}

bool RGPositionIdentifierExists(const ulong identifier)
{
    for (int i = PositionsTotal() - 1; i >= 0; i--)
        if (PositionGetTicket(i) != 0 && (ulong)PositionGetInteger(POSITION_IDENTIFIER) == identifier) return true;
    return false;
}

uint RGExecutionChecksum(const RGExecutionState &s)
{
    string value = StringFormat("%u|%d|%I64u|%I64u|%I64d|%u|%u|%d|%d|%d|%d|%I64u|",
        s.version, s.kind, s.identifier, s.initial_ticket, s.manager_magic, s.symbol_hash,
        s.trigger_hash, s.direction, s.sequence, s.pending, s.complete, s.pending_order);
    value += DoubleToString(s.before_volume, 8) + "|" + DoubleToString(s.requested_volume, 8)
        + "|" + IntegerToString(s.last_request);
    return RRHash(value);
}

bool RGExecutionSave(const int handle, RGExecutionState &s, string &status)
{
    s.checksum = RGExecutionChecksum(s);
    ResetLastError();
    if (!FileSeek(handle, 0, SEEK_END))
    { status = "风控执行记录无法定位，已停止发送请求。"; return false; }
    uint written = FileWriteStruct(handle, s);
    FileFlush(handle);
    if (written != sizeof(RGExecutionState) || GetLastError() != 0)
    { status = "风控执行记录保存失败，已停止发送请求；请检查磁盘和文件权限。"; return false; }
    return true;
}

bool RGExecutionLoad(const int handle, const int kind, const ulong identifier, RGExecutionState &s)
{
    ulong size = FileSize(handle);
    if (size < sizeof(RGExecutionState) || size % sizeof(RGExecutionState) != 0) return false;
    if (!FileSeek(handle, (long)(size - sizeof(RGExecutionState)), SEEK_SET)
        || FileReadStruct(handle, s) != sizeof(RGExecutionState)) return false;
    return s.version == 1 && s.kind == kind && s.identifier == identifier && s.initial_ticket != 0
        && s.checksum == RGExecutionChecksum(s) && s.sequence >= 0
        && (s.pending == 0 || s.pending == 1) && (s.complete == 0 || s.complete == 1)
        && !(s.pending != 0 && s.complete != 0)
        && (kind == 2 || s.direction == 1 || s.direction == -1)
        && MathIsValidNumber(s.before_volume) && s.before_volume >= 0
        && MathIsValidNumber(s.requested_volume) && s.requested_volume >= 0;
}

bool RGOpenExecution(const int kind, const ulong identifier, const ulong ticket, const string symbol,
                     const int direction, const string trigger_key, const long manager_magic,
                     int &handle, RGExecutionState &s, bool &first_trigger, string &status)
{
    first_trigger = false;
    string filename = RGExecutionFile(kind, identifier);
    bool exists = FileIsExist(filename);
    if (!exists && trigger_key == "")
    { status = "该对象没有已保存的风控触发记录。"; return false; }
    handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE)
    { status = "风控执行记录正被其他图表处理，稍后重试。"; return false; }
    if (FileSize(handle) != 0)
    {
        if (RGExecutionLoad(handle, kind, identifier, s)) return true;
        status = "风控执行记录损坏或不兼容，已停止重发；请核对成交历史。";
        FileClose(handle);
        handle = INVALID_HANDLE;
        return false;
    }
    // An existing empty record may be a failed/torn first latch. Never invent
    // a fresh sequence for it, even when a trigger is raised again.
    if (exists)
    {
        status = "风控执行记录不完整，已停止重发；请核对成交历史。";
        FileClose(handle);
        handle = INVALID_HANDLE;
        return false;
    }
    ZeroMemory(s);
    s.version = 1;
    s.kind = kind;
    s.identifier = identifier;
    s.initial_ticket = ticket;
    s.manager_magic = manager_magic;
    s.symbol_hash = RRHash(symbol);
    s.trigger_hash = RRHash(trigger_key);
    s.direction = direction;
    if (!RGExecutionSave(handle, s, status))
    {
        FileClose(handle);
        handle = INVALID_HANDLE;
        return false;
    }
    first_trigger = true;
    return true;
}

string RGExecutionComment(const RGExecutionState &s)
{
    return StringFormat("RG%I64X-%d", s.identifier, s.sequence);
}

bool RGTerminalOrderState(const long order_state)
{
    return order_state == ORDER_STATE_FILLED || order_state == ORDER_STATE_CANCELED
        || order_state == ORDER_STATE_REJECTED || order_state == ORDER_STATE_EXPIRED;
}

// A terminal order and its reflected volume are required. Elapsed time and a
// smaller volume alone never prove that an ambiguous request did not execute.
bool RGCloseConfirmed(const ulong identifier, const long magic, const string comment,
                       const ulong known_order, const double before_volume, const double current_volume,
                       const double step, const long current_update_msc, ulong &resolved_order)
{
    resolved_order = known_order;
    if (resolved_order == 0 && HistorySelectByPosition(identifier))
        for (int i = HistoryOrdersTotal() - 1; i >= 0; i--)
        {
            ulong candidate = HistoryOrderGetTicket(i);
            if (HistoryOrderGetString(candidate, ORDER_COMMENT) == comment
                && HistoryOrderGetInteger(candidate, ORDER_MAGIC) == magic)
            {
                resolved_order = candidate;
                break;
            }
        }
    if (resolved_order == 0 || OrderSelect(resolved_order) || !HistoryOrderSelect(resolved_order)) return false;
    if ((ulong)HistoryOrderGetInteger(resolved_order, ORDER_POSITION_ID) != identifier
        || !RGTerminalOrderState(HistoryOrderGetInteger(resolved_order, ORDER_STATE))) return false;
    double filled = HistoryOrderGetDouble(resolved_order, ORDER_VOLUME_INITIAL)
        - HistoryOrderGetDouble(resolved_order, ORDER_VOLUME_CURRENT);
    if (!MathIsValidNumber(filled) || filled < -step * 0.1) return false;
    if (current_volume <= before_volume - MathMax(0.0, filled) + step * 0.1) return true;
    // An external addition/reversal can make the volume comparison impossible.
    // A live position update strictly after this terminal order's completion proves
    // that this snapshot is no longer the pre-close cache; recompute from it.
    long done_msc = HistoryOrderGetInteger(resolved_order, ORDER_TIME_DONE_MSC);
    return done_msc > 0 && current_update_msc > done_msc;
}

bool RGOrdinaryExitReady(const int rr_handle, const ulong identifier, const double volume,
                         const double step, string &status)
{
    // RRManage can create an empty journal before its under-lock latch recheck.
    // No ordinary request can exist without a saved intent, so an empty file
    // held exclusively is safe; non-empty malformed records still fail closed.
    if (rr_handle == -2 || FileSize(rr_handle) == 0) return true;
    RRState ordinary;
    if (!RRLoad(rr_handle, ordinary, identifier))
    { status = "普通 RR 记录无法确认，风控等待核对，避免重复平仓。"; return false; }
    if (ordinary.pending == 0) return true;
    ulong resolved_order;
    if (!RGCloseConfirmed(identifier, ordinary.magic, RRRequestComment(ordinary), ordinary.pending_order,
        ordinary.before_volume, volume, step, PositionGetInteger(POSITION_TIME_UPDATE_MSC), resolved_order))
    { status = "等待普通 RR 上次平仓确认，风控不会叠加平仓请求。"; return false; }
    return true;
}

bool RGCompleteExecution(const int handle, RGExecutionState &s, string &status)
{
    if (s.complete != 0) return true;
    s.complete = 1;
    s.pending = 0;
    s.pending_order = 0;
    return RGExecutionSave(handle, s, status);
}

bool RGExitPositionLocked(const int handle, RGExecutionState &s, const ulong ticket, const string symbol,
                          const int rr_handle, string &status)
{
    if (s.complete != 0)
    { status = "该持仓的风控退出记录已完成，不会接管新仓。"; return true; }
    if (!PositionSelectByTicket(ticket))
    {
        if (RGPositionIdentifierExists(s.identifier))
        { status = "持仓票号已变化，下次按当前票号继续退出。"; return false; }
        if (!RGCompleteExecution(handle, s, status)) return false;
        status = "目标持仓已不存在，退出完成。";
        return true;
    }
    if ((ulong)PositionGetInteger(POSITION_IDENTIFIER) != s.identifier || RRHash(PositionGetString(POSITION_SYMBOL)) != s.symbol_hash)
    { status = "持仓身份已变化，不会对新仓发送请求。"; return false; }
    int direction = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
    double volume = PositionGetDouble(POSITION_VOLUME);
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double maximum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    if (!MathIsValidNumber(volume) || volume <= 0 || !MathIsValidNumber(step) || step <= 0
        || !MathIsValidNumber(minimum) || minimum <= 0 || !MathIsValidNumber(maximum) || maximum < minimum)
    { status = "持仓手数或券商手数规则无效，等待重试。"; return false; }
    if (!RGOrdinaryExitReady(rr_handle, s.identifier, volume, step, status)) return false;
    if (s.pending != 0)
    {
        ulong resolved_order;
        if (!RGCloseConfirmed(s.identifier, s.manager_magic, RGExecutionComment(s), s.pending_order,
            s.before_volume, volume, step, PositionGetInteger(POSITION_TIME_UPDATE_MSC), resolved_order))
        { status = "风控平仓已发送，等待确认；不会因超时重复发单。"; return false; }
        s.pending = 0;
        s.pending_order = 0;
        if (!RGExecutionSave(handle, s, status)) return false;
    }
    // Netting reversals may retain the identifier. Only rebind the current
    // direction after every ordinary/emergency close is conclusively settled.
    if (direction != s.direction)
    {
        s.direction = direction;
        if (!RGExecutionSave(handle, s, status)) return false;
    }
    if (!RRCanTrade())
    { status = "退出触发已保存；等待联网及自动交易权限恢复。"; return false; }
    if ((long)TimeLocal() - s.last_request < 3)
    { status = "退出触发已保存，等待下一次执行重试。"; return false; }
    double requested = MathFloor(MathMin(volume, maximum) / step + 1e-8) * step;
    if (volume - requested > step * 0.1 && volume - requested < minimum - step * 0.1)
        requested = MathFloor((volume - minimum) / step + 1e-8) * step;
    if (requested < minimum - step * 0.1)
    { status = "余仓不符合券商最小平仓量，请人工处理。"; return false; }
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask <= 0)
    { status = "暂无有效平仓报价，退出触发仍保留。"; return false; }
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    request.action = TRADE_ACTION_DEAL;
    request.position = ticket;
    request.symbol = symbol;
    request.magic = (ulong)s.manager_magic;
    request.volume = NormalizeDouble(requested, 8);
    request.type = s.direction == 1 ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
    request.price = s.direction == 1 ? tick.bid : tick.ask;
    request.deviation = RR_DeviationPoints;
    long fill = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
    long execution = SymbolInfoInteger(symbol, SYMBOL_TRADE_EXEMODE);
    if ((fill & SYMBOL_FILLING_FOK) != 0 || execution == SYMBOL_TRADE_EXECUTION_INSTANT || execution == SYMBOL_TRADE_EXECUTION_REQUEST)
        request.type_filling = ORDER_FILLING_FOK;
    else if ((fill & SYMBOL_FILLING_IOC) != 0) request.type_filling = ORDER_FILLING_IOC;
    else
    { status = "券商不支持 FOK/IOC 平仓，退出触发仍保留，请人工处理。"; return false; }
    if (s.sequence == 2147483647)
    { status = "风控请求序号已耗尽，停止重发。"; return false; }
    request.comment = StringFormat("RG%I64X-%d", s.identifier, s.sequence + 1);
    MqlTradeCheckResult check = {};
    if (!OrderCheck(request, check))
    {
        s.last_request = (long)TimeLocal();
        if (!RGExecutionSave(handle, s, status)) return false;
        status = StringFormat("风控平仓预检查未通过：%u %s，稍后重试。", check.retcode, check.comment);
        return false;
    }
    // Re-read after preflight: cap volume and bind the exact ticket/identifier.
    if (!PositionSelectByTicket(ticket))
    {
        if (RGPositionIdentifierExists(s.identifier))
        { status = "平仓前票号已变化，下次重新核对当前持仓。"; return false; }
        if (!RGCompleteExecution(handle, s, status)) return false;
        status = "目标持仓已平仓，退出完成。";
        return true;
    }
    if ((ulong)PositionGetInteger(POSITION_IDENTIFIER) != s.identifier
        || (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1) != s.direction
        || MathAbs(PositionGetDouble(POSITION_VOLUME) - volume) > step * 0.1)
    { status = "平仓前持仓发生变化，本次不发单，下次重新核对。"; return false; }
    s.sequence++;
    s.pending = 1;
    s.pending_order = 0;
    s.before_volume = volume;
    s.requested_volume = request.volume;
    s.last_request = (long)TimeLocal();
    if (!RGExecutionSave(handle, s, status)) return false;
    bool sent = OrderSend(request, result);
    s.pending_order = result.order;
    if (s.pending_order == 0 && result.deal != 0 && HistoryDealSelect(result.deal))
        s.pending_order = (ulong)HistoryDealGetInteger(result.deal, DEAL_ORDER);
    if (RRDefiniteReject(result.retcode))
    {
        s.pending = 0;
        s.pending_order = 0;
    }
    if (!RGExecutionSave(handle, s, status)) return false;
    status = s.pending != 0 ? "风控平仓请求已登记，等待成交确认。"
        : StringFormat("风控平仓被拒绝：%u %s，稍后重试。", result.retcode, result.comment);
    PrintFormat("[PS RR Guard] 仓位 %I64u 紧急退出 %.8f 手：sent=%s, retcode=%u %s", s.identifier,
        request.volume, sent ? "true" : "false", result.retcode, result.comment);
    return false;
}

// true = object is complete; false = draining/waiting/blocked. first_trigger is
// true exactly once, after the initial latch is durably saved, even without AT.
bool RGExitPosition(const ulong ticket, const string trigger_key, const long manager_magic,
                    string &status, bool &first_trigger)
{
    first_trigger = false;
    status = "";
    if (!PositionSelectByTicket(ticket))
    { status = "目标持仓已不存在，退出完成。"; return true; }
    ulong identifier = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
    string symbol = PositionGetString(POSITION_SYMBOL);
    int direction = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
    RGExecutionState s;
    int handle = INVALID_HANDLE;
    if (!RGOpenExecution(1, identifier, ticket, symbol, direction, trigger_key, manager_magic, handle, s, first_trigger, status)) return false;
    if (first_trigger) RGOnPositionLatched(ticket);
    int rr_handle = -2;
    string rr_filename = RRFileName(identifier);
    if (FileIsExist(rr_filename))
    {
        // Holding this read-only exclusive handle serializes against ordinary
        // RR's intent+send transaction. Never alter the RR position journal.
        rr_handle = FileOpen(rr_filename, FILE_READ | FILE_BIN);
        if (rr_handle == INVALID_HANDLE)
        {
            FileClose(handle);
            status = "普通 RR 正在处理该持仓，风控退出已登记，稍后重试。";
            return false;
        }
    }
    bool complete = RGExitPositionLocked(handle, s, ticket, symbol, rr_handle, status);
    if (rr_handle != -2) FileClose(rr_handle);
    FileClose(handle);
    return complete;
}

bool RGExitPosition(const ulong ticket, const string trigger_key, const long manager_magic, string &status)
{
    bool first_trigger;
    return RGExitPosition(ticket, trigger_key, manager_magic, status, first_trigger);
}

bool RGIsPendingOrderType(const long type)
{
    return type == ORDER_TYPE_BUY_LIMIT || type == ORDER_TYPE_SELL_LIMIT
        || type == ORDER_TYPE_BUY_STOP || type == ORDER_TYPE_SELL_STOP
        || type == ORDER_TYPE_BUY_STOP_LIMIT || type == ORDER_TYPE_SELL_STOP_LIMIT;
}

bool RGCancelOrderLocked(const int handle, RGExecutionState &s, string &status)
{
    if (s.complete != 0) { status = "该挂单已处理完成。"; return true; }
    if (!OrderSelect(s.identifier))
    {
        if (!HistoryOrderSelect(s.identifier) || !RGTerminalOrderState(HistoryOrderGetInteger(s.identifier, ORDER_STATE)))
        { status = "挂单已不在活动列表，等待交易历史确认，不会重复撤单。"; return false; }
        if (!RGCompleteExecution(handle, s, status)) return false;
        status = "挂单已结束；若已成交，持仓由风控继续检查。";
        return true;
    }
    if (RRHash(OrderGetString(ORDER_SYMBOL)) != s.symbol_hash || !RGIsPendingOrderType(OrderGetInteger(ORDER_TYPE)))
    { status = "挂单身份或类型已变化，本次不发请求。"; return false; }
    if (s.pending != 0)
    { status = "风控撤单已发送，等待确认；不会因超时重复发送。"; return false; }
    if (!RRCanTrade())
    { status = "撤单触发已保存；等待联网及自动交易权限恢复。"; return false; }
    if ((long)TimeLocal() - s.last_request < 3)
    { status = "撤单触发已保存，等待下一次执行重试。"; return false; }
    if (s.sequence == 2147483647)
    { status = "风控请求序号已耗尽，停止重发。"; return false; }
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    request.action = TRADE_ACTION_REMOVE;
    request.order = s.identifier;
    request.symbol = OrderGetString(ORDER_SYMBOL);
    request.magic = (ulong)s.manager_magic;
    s.sequence++;
    request.comment = RGExecutionComment(s);
    s.pending = 1;
    s.last_request = (long)TimeLocal();
    if (!RGExecutionSave(handle, s, status)) return false;
    bool sent = OrderSend(request, result);
    if (RRDefiniteReject(result.retcode)) s.pending = 0;
    if (!RGExecutionSave(handle, s, status)) return false;
    status = s.pending != 0 ? "风控撤单请求已登记，等待服务器确认。"
        : StringFormat("风控撤单被拒绝：%u %s，稍后重试。", result.retcode, result.comment);
    PrintFormat("[PS RR Guard] 挂单 %I64u 撤单：sent=%s, retcode=%u %s", s.identifier, sent ? "true" : "false", result.retcode, result.comment);
    return false;
}

bool RGCancelOrder(const ulong ticket, const string trigger_key, string &status, bool &first_trigger)
{
    first_trigger = false;
    status = "";
    bool active = OrderSelect(ticket);
    string symbol = "";
    long magic = 0;
    if (active)
    {
        if (!RGIsPendingOrderType(OrderGetInteger(ORDER_TYPE)))
        { status = "该订单不是待成交挂单，无需撤销。"; return true; }
        symbol = OrderGetString(ORDER_SYMBOL);
        magic = OrderGetInteger(ORDER_MAGIC);
    }
    else if (!RGOrderCancelLatched(ticket))
    {
        if (HistoryOrderSelect(ticket) && RGTerminalOrderState(HistoryOrderGetInteger(ticket, ORDER_STATE)))
        { status = "该挂单已结束，无需撤销。"; return true; }
        status = "暂时无法确认该挂单状态。";
        return false;
    }
    RGExecutionState s;
    int handle = INVALID_HANDLE;
    if (!RGOpenExecution(2, ticket, ticket, symbol, 0, trigger_key, magic, handle, s, first_trigger, status)) return false;
    bool complete = RGCancelOrderLocked(handle, s, status);
    FileClose(handle);
    return complete;
}

bool RGCancelOrder(const ulong ticket, const string trigger_key, string &status)
{
    bool first_trigger;
    return RGCancelOrder(ticket, trigger_key, status, first_trigger);
}
#endif
