// RR extension for EarnForex Position Sizer. Original panel copyrights retained.
#ifndef POSITION_SIZER_RR_MQH
#define POSITION_SIZER_RR_MQH
#include "RRCore.mqh"

input group "分仓止盈 / RR exit manager"
input(name="启用分仓止盈") bool RR_Enable = true;
input(name="首次方案：第一目标 R") double RR_FirstTarget = 2.0;
input(name="首次方案：第一目标平仓百分比") double RR_ClosePercent = 50.0;
input(name="首次方案：最终 R") double RR_FinalTarget = 5.0;
input(name="首次方案：第一目标触发 BE") bool RR_MoveToBE = true;
input(name="保本价额外盈利点数（非点差）") int RR_BEOffsetPoints = 0;
input(name="平仓允许偏差（points）") uint RR_DeviationPoints = 20;

// Append-only per-position journal, held with an exclusive file handle during
// management. Intent is flushed BEFORE sending any close. A torn journal or an
// ambiguous broker reply fails closed rather than guessing and closing twice.
// Exact version-1 disk layout: never append to or reorder this structure.
// Existing positions continue using their original plan and execution semantics.
struct RRLegacyState
{
    uint version;
    ulong identifier;
    long magic;
    ulong opening_order;
    int direction;
    double entry;
    double risk;
    double initial_volume;
    double first_r;
    double final_r;
    double percent;
    int move_be;
    int offset_points;
    int stage;                 // 0 waiting; 1 first hit; 2 reduced; 3 final hit
    int be_done;
    int blocked;
    int sequence;
    int pending;
    ulong pending_order;
    double before_volume;
    long last_request;
    long last_stop_request;
    uint checksum;
};

struct RRState
{
    uint version;
    ulong identifier;
    long magic;
    ulong opening_order;
    int direction;
    double entry;
    double risk;
    double initial_volume;
    double first_r;
    double final_r;
    double percent;
    int move_be;
    int offset_points;
    int stage; // v1: legacy 0..3; v2: number of triggered targets.
    int be_done;
    int blocked;
    int sequence;
    int pending;
    ulong pending_order;
    double before_volume;
    long last_request;
    long last_stop_request;
    uint checksum;
    int target_count;
    double target_r[RR_MAX_TARGETS];
    double target_percent[RR_MAX_TARGETS];
    int target_be[RR_MAX_TARGETS];
    int be_requested;
};

bool RRStateClosesAll(const RRState &s)
{
    if (s.version == 1) return true; // Never change legacy execution semantics.
    if (s.version != 2 || s.target_count < 1 || s.target_count > RR_MAX_TARGETS) return false;
    double total = 0;
    for (int i = 0; i < s.target_count; i++) total += s.target_percent[i];
    return total >= 100.0 - 1e-7;
}

void RRFromLegacy(const RRLegacyState &legacy, RRState &s)
{
    ZeroMemory(s);
    s.version = legacy.version;
    s.identifier = legacy.identifier;
    s.magic = legacy.magic;
    s.opening_order = legacy.opening_order;
    s.direction = legacy.direction;
    s.entry = legacy.entry;
    s.risk = legacy.risk;
    s.initial_volume = legacy.initial_volume;
    s.first_r = legacy.first_r;
    s.final_r = legacy.final_r;
    s.percent = legacy.percent;
    s.move_be = legacy.move_be;
    s.offset_points = legacy.offset_points;
    s.stage = legacy.stage;
    s.be_done = legacy.be_done;
    s.blocked = legacy.blocked;
    s.sequence = legacy.sequence;
    s.pending = legacy.pending;
    s.pending_order = legacy.pending_order;
    s.before_volume = legacy.before_volume;
    s.last_request = legacy.last_request;
    s.last_stop_request = legacy.last_stop_request;
    s.checksum = legacy.checksum;
}

void RRToLegacy(const RRState &s, RRLegacyState &legacy)
{
    ZeroMemory(legacy);
    legacy.version = s.version;
    legacy.identifier = s.identifier;
    legacy.magic = s.magic;
    legacy.opening_order = s.opening_order;
    legacy.direction = s.direction;
    legacy.entry = s.entry;
    legacy.risk = s.risk;
    legacy.initial_volume = s.initial_volume;
    legacy.first_r = s.first_r;
    legacy.final_r = s.final_r;
    legacy.percent = s.percent;
    legacy.move_be = s.move_be;
    legacy.offset_points = s.offset_points;
    legacy.stage = s.stage;
    legacy.be_done = s.be_done;
    legacy.blocked = s.blocked;
    legacy.sequence = s.sequence;
    legacy.pending = s.pending;
    legacy.pending_order = s.pending_order;
    legacy.before_volume = s.before_volume;
    legacy.last_request = s.last_request;
    legacy.last_stop_request = s.last_stop_request;
    legacy.checksum = s.checksum;
}

ulong RRExistingIDs[];
long RRAccount = 0;
string RRServer = "";
ulong RRLastRun = 0;
long RRLastNotice = 0;

uint RRHash(const string value)
{
    uint hash = 2166136261;
    for (int i = 0; i < StringLen(value); i++)
        hash = (hash ^ (uint)StringGetCharacter(value, i)) * 16777619;
    return hash;
}

uint RRChecksum(const RRState &s)
{
    string value = StringFormat("%u|%I64u|%I64d|%I64u|%d|", s.version, s.identifier, s.magic, s.opening_order, s.direction);
    value += DoubleToString(s.entry, 16) + "|" + DoubleToString(s.risk, 16) + "|" + DoubleToString(s.initial_volume, 8);
    value += "|" + DoubleToString(s.first_r, 8) + "|" + DoubleToString(s.final_r, 8) + "|" + DoubleToString(s.percent, 8);
    value += StringFormat("|%d|%d|%d|%d|%d|%d|%d|%I64u|", s.move_be, s.offset_points, s.stage, s.be_done, s.blocked, s.sequence, s.pending, s.pending_order);
    value += DoubleToString(s.before_volume, 8) + "|" + IntegerToString(s.last_request) + "|" + IntegerToString(s.last_stop_request);
    if (s.version == 2)
    {
        value += "|" + IntegerToString(s.target_count) + "|" + IntegerToString(s.be_requested);
        for (int i = 0; i < RR_MAX_TARGETS; i++)
            value += "|" + DoubleToString(s.target_r[i], 16) + "|" + DoubleToString(s.target_percent[i], 16) + "|" + IntegerToString(s.target_be[i]);
    }
    return RRHash(value);
}

void RRNotice(const string message)
{
    long now = (long)TimeLocal();
    if (now - RRLastNotice >= 30)
    {
        Print("[PS RR] ", message);
        RRLastNotice = now;
    }
}

void RRSnapshotExisting()
{
    RRAccount = AccountInfoInteger(ACCOUNT_LOGIN);
    RRServer = AccountInfoString(ACCOUNT_SERVER);
    ArrayResize(RRExistingIDs, PositionsTotal());
    int count = 0;
    for (int i = 0; i < PositionsTotal(); i++)
        if (PositionGetTicket(i) > 0)
        {
            if (count >= ArraySize(RRExistingIDs)) ArrayResize(RRExistingIDs, count + 1);
            RRExistingIDs[count++] = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        }
    ArrayResize(RRExistingIDs, count);
}

bool RRValidateInputs()
{
    RRSnapshotExisting();
    string error;
    if (!RRPlanInitialize(RR_FirstTarget, RR_ClosePercent, RR_FinalTarget, RR_MoveToBE, error))
    {
        Print("[PS RR] 止盈方案无效：", error);
        return false;
    }
    if (RR_BEOffsetPoints < 0)
    {
        Print("[PS RR] 保本偏移点数不能小于 0。");
        return false;
    }
    if (RR_Enable)
        PrintFormat("[PS RR] 已启用 %d 个止盈目标，合计 %.4f%%，最后 %.2fR，%s。每个新仓冻结开仓时的方案。",
            RRActivePlan.count, RRPlanTotalPercent(RRActivePlan), RRPlanFinalR(), RRPlanClosesAll(RRActivePlan) ? "全部退出" : "保留余仓继续持有");
    return true;
}

void RRShutdown()
{
    // Every state transition is already flushed; leave journals for recovery.
}

bool RRWasExisting(const ulong id)
{
    for (int i = 0; i < ArraySize(RRExistingIDs); i++)
        if (RRExistingIDs[i] == id) return true;
    return false;
}

string RRFileName(const ulong id)
{
    return StringFormat("PS_RR\\%u_%I64d\\%I64u.bin", RRHash(AccountInfoString(ACCOUNT_SERVER)), AccountInfoInteger(ACCOUNT_LOGIN), id);
}

bool RRSave(const int handle, RRState &s)
{
    s.checksum = RRChecksum(s);
    ResetLastError();
    if (!FileSeek(handle, 0, SEEK_END)) return false;
    uint written;
    uint expected;
    if (s.version == 1)
    {
        RRLegacyState legacy;
        RRToLegacy(s, legacy);
        written = FileWriteStruct(handle, legacy);
        expected = sizeof(RRLegacyState);
    }
    else if (s.version == 2)
    {
        written = FileWriteStruct(handle, s);
        expected = sizeof(RRState);
    }
    else return false;
    FileFlush(handle);
    if (written != expected || GetLastError() != 0)
    {
        RRNotice("状态保存失败，停止发送交易请求。请检查 MQL5/Files 的写入权限及磁盘空间。");
        return false;
    }
    return true;
}

bool RRLoad(const int handle, RRState &s, const ulong id)
{
    ulong size = FileSize(handle);
    if (size < sizeof(uint) || !FileSeek(handle, 0, SEEK_SET)) return false;
    uint version = (uint)FileReadInteger(handle, INT_VALUE);
    if (version == 1)
    {
        if (size < sizeof(RRLegacyState) || size % sizeof(RRLegacyState) != 0) return false;
        if (!FileSeek(handle, (long)(size - sizeof(RRLegacyState)), SEEK_SET)) return false;
        RRLegacyState legacy;
        if (FileReadStruct(handle, legacy) != sizeof(RRLegacyState)) return false;
        RRFromLegacy(legacy, s);
    }
    else if (version == 2)
    {
        if (size < sizeof(RRState) || size % sizeof(RRState) != 0) return false;
        if (!FileSeek(handle, (long)(size - sizeof(RRState)), SEEK_SET)) return false;
        if (FileReadStruct(handle, s) != sizeof(RRState)) return false;
    }
    else return false;
    if (s.version != version || s.identifier != id || s.checksum != RRChecksum(s)
        || !MathIsValidNumber(s.risk) || s.risk <= 0 || !MathIsValidNumber(s.initial_volume) || s.initial_volume <= 0
        || !MathIsValidNumber(s.entry) || s.entry <= 0 || (s.direction != 1 && s.direction != -1)
        || s.stage < 0 || (s.pending != 0 && s.pending != 1) || s.sequence < 0) return false;
    if (version == 1) return s.stage <= 3;
    if (s.target_count < 1 || s.target_count > RR_MAX_TARGETS || s.stage > s.target_count
        || (s.be_requested != 0 && s.be_requested != 1)) return false;
    RRPlan frozen;
    ZeroMemory(frozen);
    frozen.count = s.target_count;
    for (int i = 0; i < s.target_count; i++)
    {
        frozen.targets[i].multiple = s.target_r[i];
        frozen.targets[i].percent = s.target_percent[i];
        frozen.targets[i].move_be = s.target_be[i];
    }
    string error;
    return RRPlanValidate(frozen, error) && s.final_r == s.target_r[s.target_count - 1];
}

// History is authoritative for identifying additions/reversals, even if another
// strategy adds and then removes volume between two ticks of this EA.
bool RRHistory(const ulong id, ulong &opening_order, double &in_volume, bool &mixed)
{
    opening_order = 0;
    in_volume = 0;
    mixed = false;
    if (!HistorySelectByPosition(id)) return false;
    for (int i = 0; i < HistoryDealsTotal(); i++)
    {
        ulong deal = HistoryDealGetTicket(i);
        long type = HistoryDealGetInteger(deal, DEAL_TYPE);
        if (type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
        long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
        if (entry == DEAL_ENTRY_INOUT) mixed = true;
        if (entry != DEAL_ENTRY_IN) continue;
        ulong order = (ulong)HistoryDealGetInteger(deal, DEAL_ORDER);
        if (opening_order == 0) opening_order = order;
        if (opening_order != order) mixed = true;
        in_volume += HistoryDealGetDouble(deal, DEAL_VOLUME);
    }
    return opening_order != 0 && in_volume > 0;
}

bool RRCapture(const ulong ticket, RRState &s)
{
    if (!PositionSelectByTicket(ticket)) return false;
    ulong id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
    if (RRWasExisting(id)) return false;
    ulong opening_order;
    double in_volume;
    bool mixed;
    if (!RRHistory(id, opening_order, in_volume, mixed)) return false;
    // Wait for all fills of the opening order and for its history to arrive.
    if (OrderSelect(opening_order) || !HistoryOrderSelect(opening_order)) return false;
    double original_sl = HistoryOrderGetDouble(opening_order, ORDER_SL);
    if (!PositionSelectByTicket(ticket)) return false;
    double entry = PositionGetDouble(POSITION_PRICE_OPEN);
    double volume = PositionGetDouble(POSITION_VOLUME);
    double step = SymbolInfoDouble(PositionGetString(POSITION_SYMBOL), SYMBOL_VOLUME_STEP);
    int direction = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1);
    // Market execution can attach SL after the deal. Only for a newly observed
    // position may the current SL supply the initial risk if the order lacks it.
    if (original_sl <= 0) original_sl = PositionGetDouble(POSITION_SL);
    if (original_sl <= 0 || direction * (entry - original_sl) <= 0) return false;
    ZeroMemory(s);
    s.version = 2;
    s.identifier = id;
    s.magic = PositionGetInteger(POSITION_MAGIC);
    s.opening_order = opening_order;
    s.direction = direction;
    s.entry = entry;
    s.risk = direction * (entry - original_sl);
    s.initial_volume = in_volume;
    s.target_count = RRActivePlan.count;
    for (int i = 0; i < s.target_count; i++)
    {
        s.target_r[i] = RRActivePlan.targets[i].multiple;
        s.target_percent[i] = RRActivePlan.targets[i].percent;
        s.target_be[i] = RRActivePlan.targets[i].move_be;
    }
    s.first_r = s.target_r[0];
    s.final_r = s.target_r[s.target_count - 1];
    s.percent = s.target_percent[0];
    s.move_be = s.target_be[0];
    s.offset_points = RR_BEOffsetPoints;
    s.blocked = (int)(mixed || MathAbs(in_volume - volume) > step * 0.1);
    PrintFormat("[PS RR] 仓位 %I64u：初始价 %s，1R=%s，初始手数 %.8f，状态=%s", id,
                DoubleToString(entry, 8), DoubleToString(s.risk, 8), in_volume, s.blocked == 0 ? "管理中" : "已有混合成交，暂停");
    return true;
}

bool RRCanTrade()
{
    return TerminalInfoInteger(TERMINAL_CONNECTED) && TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
        && MQLInfoInteger(MQL_TRADE_ALLOWED) && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)
        && AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
}

string RRRequestComment(const RRState &s)
{
    // Hex keeps even a full 64-bit ID and a 10-digit sequence below 31 chars.
    return StringFormat("RR%I64X-%d", s.identifier, s.sequence);
}

bool RRResolvePending(const int handle, RRState &s, const double current_volume, const double step)
{
    if (s.pending == 0) return true;
    ulong order = s.pending_order;
    if (order == 0 && HistorySelectByPosition(s.identifier))
    {
        string comment = RRRequestComment(s);
        for (int i = HistoryOrdersTotal() - 1; i >= 0; i--)
        {
            ulong candidate = HistoryOrderGetTicket(i);
            if (HistoryOrderGetString(candidate, ORDER_COMMENT) == comment
                && HistoryOrderGetInteger(candidate, ORDER_MAGIC) == s.magic)
            {
                order = candidate;
                break;
            }
        }
    }
    if (order != 0 && !OrderSelect(order) && HistoryOrderSelect(order))
    {
        long state = HistoryOrderGetInteger(order, ORDER_STATE);
        if (state == ORDER_STATE_FILLED || state == ORDER_STATE_CANCELED || state == ORDER_STATE_REJECTED || state == ORDER_STATE_EXPIRED)
        {
            double filled = HistoryOrderGetDouble(order, ORDER_VOLUME_INITIAL) - HistoryOrderGetDouble(order, ORDER_VOLUME_CURRENT);
            if (current_volume <= s.before_volume - filled + step * 0.1)
            {
                s.pending = 0;
                s.pending_order = 0;
                return RRSave(handle, s);
            }
        }
    }
    if ((long)TimeLocal() - s.last_request > 30)
        RRNotice(StringFormat("仓位 %I64u 等待上次平仓请求确认；未确认前不会重复发单。若长期不恢复，请核对交易历史和日志。", s.identifier));
    return false;
}

bool RRDefiniteReject(const uint retcode)
{
    // Whitelist definite rejections. TIMEOUT/CONNECTION/ERROR and unknown replies
    // preserve the journal intent because the server might still execute it.
    return retcode == TRADE_RETCODE_REQUOTE || retcode == TRADE_RETCODE_REJECT
        || retcode == TRADE_RETCODE_CANCEL || retcode == TRADE_RETCODE_INVALID
        || retcode == TRADE_RETCODE_INVALID_VOLUME || retcode == TRADE_RETCODE_INVALID_PRICE
        || retcode == TRADE_RETCODE_INVALID_STOPS || retcode == TRADE_RETCODE_TRADE_DISABLED
        || retcode == TRADE_RETCODE_MARKET_CLOSED || retcode == TRADE_RETCODE_NO_MONEY
        || retcode == TRADE_RETCODE_PRICE_CHANGED || retcode == TRADE_RETCODE_PRICE_OFF
        || retcode == TRADE_RETCODE_TOO_MANY_REQUESTS || retcode == TRADE_RETCODE_INVALID_FILL
        || retcode == TRADE_RETCODE_FROZEN || retcode == TRADE_RETCODE_POSITION_CLOSED
        || retcode == TRADE_RETCODE_INVALID_CLOSE_VOLUME || retcode == TRADE_RETCODE_CLIENT_DISABLES_AT
        || retcode == TRADE_RETCODE_SERVER_DISABLES_AT;
}

void RRClose(const int handle, RRState &s, const ulong ticket, const string symbol, double volume)
{
    if (!RRCanTrade() || s.pending != 0 || (long)TimeLocal() - s.last_request < 3) return;
    if (!PositionSelectByTicket(ticket) || (ulong)PositionGetInteger(POSITION_IDENTIFIER) != s.identifier) return;
    int direction = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1);
    if (direction != s.direction) return;
    double current = PositionGetDouble(POSITION_VOLUME);
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double maximum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    volume = MathMin(volume, current);
    volume = MathFloor(MathMin(volume, maximum) / step + 1e-8) * step;
    if (volume < minimum - step * 0.1) return;
    if (current - volume > step * 0.1 && current - volume < minimum - step * 0.1)
        volume = MathFloor((current - minimum) / step + 1e-8) * step;
    if (volume < minimum - step * 0.1) return;
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick)) return;
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    request.action = TRADE_ACTION_DEAL;
    request.position = ticket; // Required to reduce the exact hedging position.
    request.symbol = symbol;
    request.magic = (ulong)s.magic;
    request.volume = NormalizeDouble(volume, 8);
    request.type = (s.direction == 1 ? ORDER_TYPE_SELL : ORDER_TYPE_BUY);
    request.price = (s.direction == 1 ? tick.bid : tick.ask);
    request.deviation = RR_DeviationPoints;
    long fill = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
    long execution = SymbolInfoInteger(symbol, SYMBOL_TRADE_EXEMODE);
    if ((fill & SYMBOL_FILLING_FOK) != 0 || execution == SYMBOL_TRADE_EXECUTION_INSTANT || execution == SYMBOL_TRADE_EXECUTION_REQUEST)
        request.type_filling = ORDER_FILLING_FOK;
    else if ((fill & SYMBOL_FILLING_IOC) != 0) request.type_filling = ORDER_FILLING_IOC;
    else
    {
        RRNotice("该品种没有可用的 FOK/IOC 平仓模式；自动市价分仓暂停。");
        return;
    }
    s.sequence++;
    request.comment = RRRequestComment(s);
    MqlTradeCheckResult check = {};
    if (!OrderCheck(request, check))
    {
        RRNotice(StringFormat("平仓预检查未通过：%u %s", check.retcode, check.comment));
        return;
    }
    s.pending = 1;
    s.pending_order = 0;
    s.before_volume = current;
    s.last_request = (long)TimeLocal();
    if (!RRSave(handle, s)) return;
    bool sent = OrderSend(request, result);
    s.pending_order = result.order;
    if (s.pending_order == 0 && result.deal != 0 && HistoryDealSelect(result.deal))
        s.pending_order = (ulong)HistoryDealGetInteger(result.deal, DEAL_ORDER);
    if (RRDefiniteReject(result.retcode))
    {
        s.pending = 0;
        s.pending_order = 0;
    }
    RRSave(handle, s);
    PrintFormat("[PS RR] 仓位 %I64u 平 %.8f 手：sent=%s, retcode=%u, %s", s.identifier, volume, sent ? "true" : "false", result.retcode, result.comment);
}

void RRUpdateStops(const int handle, RRState &s, const ulong ticket, const string symbol)
{
    if (!RRCanTrade() || !PositionSelectByTicket(ticket)) return;
    if ((long)TimeLocal() - s.last_stop_request < 3) return;
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick)) return;
    double current_price = (s.direction == 1 ? tick.bid : tick.ask);
    double old_sl = PositionGetDouble(POSITION_SL);
    double old_tp = PositionGetDouble(POSITION_TP);
    double sl = old_sl;
    double tp = old_tp;
    bool closes_all = RRStateClosesAll(s);
    double desired_tp = closes_all ? RRTargetPrice(s.direction, s.entry, s.risk, s.final_r, tick_size, digits) : 0;
    double distance = (double)MathMax(SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL), SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL)) * point + tick_size;
    // A retained remainder must not keep a server TP that would close it all.
    // Clearing TP is retried by the same idempotent SL/TP synchronization path.
    if (!closes_all) tp = 0;
    else if (MathAbs(old_tp - desired_tp) > tick_size * 0.1 && s.direction * (desired_tp - current_price) >= distance)
        tp = desired_tp;
    if ((s.version == 1 && s.stage >= 2 && s.move_be != 0) || (s.version == 2 && s.be_requested != 0))
    {
        double be = RRBETarget(s.direction, s.entry, s.offset_points, point, tick_size, digits);
        if (RRSLProtectsBE(s.direction, old_sl, be, tick_size)) s.be_done = 1;
        else if (s.direction * (current_price - be) >= distance) sl = be;
    }
    if (MathAbs(sl - old_sl) < tick_size * 0.1 && MathAbs(tp - old_tp) < tick_size * 0.1) return;
    // Stop modifications are idempotent. Failed BE can be retried independently
    // without executing the partial close again; never loosen an existing SL.
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    request.action = TRADE_ACTION_SLTP;
    request.position = ticket;
    request.symbol = symbol;
    request.magic = (ulong)s.magic;
    request.sl = sl;
    request.tp = tp;
    s.last_stop_request = (long)TimeLocal();
    if (!RRSave(handle, s)) return;
    bool sent = OrderSend(request, result);
    if (!sent || (result.retcode != TRADE_RETCODE_DONE && result.retcode != TRADE_RETCODE_NO_CHANGES))
        RRNotice(StringFormat("仓位 %I64u 更新 SL/TP 尚未成功：%u %s，将继续重试。", s.identifier, result.retcode, result.comment));
}

// Version 2: latch every crossed target before resolving outstanding closes.
// A BE trigger is independent of close completion and survives a later pullback.
void RRProcessMulti(const int handle, RRState &s, const ulong ticket, const string symbol)
{
    if (s.blocked != 0 || !PositionSelectByTicket(ticket)) return;
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    if (step <= 0 || minimum <= 0) return;
    double volume = PositionGetDouble(POSITION_VOLUME);
    double entry = PositionGetDouble(POSITION_PRICE_OPEN);
    int direction = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1);
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    ulong opening_order;
    double in_volume;
    bool mixed;
    if (!RRHistory(s.identifier, opening_order, in_volume, mixed)) return;
    if (mixed || opening_order != s.opening_order || MathAbs(in_volume - s.initial_volume) > step * 0.1
        || volume > s.initial_volume + step * 0.1 || direction != s.direction || MathAbs(entry - s.entry) > tick_size * 0.1)
    {
        s.blocked = 1;
        RRSave(handle, s);
        PrintFormat("[PS RR] 仓位 %I64u 检测到加仓/反转/开仓价变化，已暂停该仓位管理。", s.identifier);
        return;
    }
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask <= 0) return;
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    int previous_stage = s.stage;
    while (s.stage < s.target_count && RRTargetReached(s.direction, s.entry, s.risk, s.target_r[s.stage], tick.bid, tick.ask, tick_size, digits))
    {
        if (s.target_be[s.stage] != 0) s.be_requested = 1;
        s.stage++;
    }
    if (s.stage != previous_stage)
    {
        if (!RRSave(handle, s)) return;
        PrintFormat("[PS RR] 仓位 %I64u 已触发目标 %d/%d，BE=%s。", s.identifier, s.stage, s.target_count, s.be_requested != 0 ? "已触发" : "未触发");
    }
    // SL/TP changes do not reduce volume, so they are safe while a previous
    // market close is still awaiting broker confirmation.
    RRUpdateStops(handle, s, ticket, symbol);
    if (!PositionSelectByTicket(ticket)) return;
    volume = PositionGetDouble(POSITION_VOLUME);
    if (!RRResolvePending(handle, s, volume, step)) return;
    if (!PositionSelectByTicket(ticket)) return;
    volume = PositionGetDouble(POSITION_VOLUME);
    if (s.stage == s.target_count && RRStateClosesAll(s))
    {
        RRClose(handle, s, ticket, symbol, volume);
        return;
    }
    double percent = 0;
    for (int i = 0; i < s.stage; i++) percent += s.target_percent[i];
    if (percent <= 0) return;
    double goal = MathFloor(s.initial_volume * percent / 100.0 / step + 1e-8) * step;
    if (s.initial_volume - volume >= goal - step * 0.1) return;
    double close_volume = RRPartialLots(s.initial_volume, volume, percent, minimum, step);
    if (close_volume > 0) RRClose(handle, s, ticket, symbol, close_volume);
    else RRNotice(StringFormat("仓位 %I64u 累计减仓量暂不符合券商最小手数，等待后续目标；已触发的 BE 仍继续执行。", s.identifier));
}


void RRProcess(const int handle, RRState &s, const ulong ticket, const string symbol)
{
    if (s.version == 2)
    {
        RRProcessMulti(handle, s, ticket, symbol);
        return;
    }
    if (s.blocked != 0 || !PositionSelectByTicket(ticket)) return;
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    if (step <= 0 || minimum <= 0) return;
    double volume = PositionGetDouble(POSITION_VOLUME);
    double entry = PositionGetDouble(POSITION_PRICE_OPEN);
    int direction = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1);
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    ulong opening_order;
    double in_volume;
    bool mixed;
    if (!RRHistory(s.identifier, opening_order, in_volume, mixed)) return;
    if (mixed || opening_order != s.opening_order || MathAbs(in_volume - s.initial_volume) > step * 0.1
        || volume > s.initial_volume + step * 0.1 || direction != s.direction || MathAbs(entry - s.entry) > tick_size * 0.1)
    {
        s.blocked = 1;
        RRSave(handle, s);
        PrintFormat("[PS RR] 仓位 %I64u 检测到加仓/反转/开仓价变化，已暂停该仓位管理。", s.identifier);
        return;
    }
    if (!RRResolvePending(handle, s, volume, step)) return;
    if (!PositionSelectByTicket(ticket)) return;
    volume = PositionGetDouble(POSITION_VOLUME);
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask <= 0) return;
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    // A gap directly to the last target closes the remainder in one action.
    if (s.stage == 3 || RRTargetReached(s.direction, s.entry, s.risk, s.final_r, tick.bid, tick.ask, tick_size, digits))
    {
        if (s.stage != 3)
        {
            s.stage = 3;
            if (!RRSave(handle, s)) return;
        }
        RRClose(handle, s, ticket, symbol, volume);
        return;
    }
    if (s.stage == 0 && RRTargetReached(s.direction, s.entry, s.risk, s.first_r, tick.bid, tick.ask, tick_size, digits))
    {
        s.stage = 1;
        if (!RRSave(handle, s)) return;
    }
    if (s.stage == 1)
    {
        double goal = MathFloor(s.initial_volume * s.percent / 100.0 / step + 1e-8) * step;
        if (goal >= minimum - step * 0.1 && s.initial_volume - goal >= minimum - step * 0.1
            && s.initial_volume - volume >= goal - step * 0.1)
        {
            s.stage = 2;
            if (!RRSave(handle, s)) return;
            PrintFormat("[PS RR] 仓位 %I64u 第一阶段减仓完成；剩余 %.8f 手。", s.identifier, volume);
        }
        else
        {
            double close_volume = RRPartialLots(s.initial_volume, volume, s.percent, minimum, step);
            if (close_volume > 0)
            {
                RRClose(handle, s, ticket, symbol, close_volume);
                return;
            }
            RRNotice(StringFormat("仓位 %I64u 无法按券商最小手数完成分仓；保持当前止损，不提前设 BE，等待最终目标。", s.identifier));
        }
    }
    RRUpdateStops(handle, s, ticket, symbol);
}

// Read-only position selection never captures or adopts an unmanaged position.
bool RRSelectManagedPosition(const string symbol, const long magic, const ulong id, ulong &ticket)
{
    ticket = 0;
    if (id == 0) return false;
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong candidate = PositionGetTicket(i);
        if (candidate > 0 && PositionGetString(POSITION_SYMBOL) == symbol
            && PositionGetInteger(POSITION_MAGIC) == magic && (ulong)PositionGetInteger(POSITION_IDENTIFIER) == id)
        {
            ticket = candidate;
            return true;
        }
    }
    return false;
}

void RRStatePlan(const RRState &s, RRPlan &plan)
{
    ZeroMemory(plan);
    if (s.version == 1)
    {
        // Legacy plans may be displayed, but their execution semantics cannot
        // safely be converted to an editable v2 plan while a position is open.
        plan.count = 2;
        plan.targets[0].multiple = s.first_r;
        plan.targets[0].percent = s.percent;
        plan.targets[0].move_be = s.move_be;
        plan.targets[1].multiple = s.final_r;
        plan.targets[1].percent = 100.0 - s.percent;
        return;
    }
    if (s.version != 2 || s.target_count < 1 || s.target_count > RR_MAX_TARGETS) return;
    plan.count = s.target_count;
    for (int i = 0; i < plan.count; i++)
    {
        plan.targets[i].multiple = s.target_r[i];
        plan.targets[i].percent = s.target_percent[i];
        plan.targets[i].move_be = s.target_be[i];
    }
}

bool RRReadManagedPosition(const string symbol, const long magic, const ulong id, RRState &s, ulong &ticket, string &error)
{
    error = "";
    ZeroMemory(s);
    if (!RRSelectManagedPosition(symbol, magic, id, ticket))
    { error = "该持仓已平仓，或不属于当前品种和 MagicNumber。"; return false; }
    string filename = RRFileName(id);
    if (!FileIsExist(filename))
    { error = "该持仓没有已保存的 RR 记录，无法读取或编辑。"; return false; }
    int handle = FileOpen(filename, FILE_READ | FILE_BIN);
    if (handle == INVALID_HANDLE)
    { error = "持仓记录正被使用或无法读取，请稍候重试。"; return false; }
    bool valid = RRLoad(handle, s, id);
    FileClose(handle);
    if (!valid || s.magic != magic)
    { error = "持仓记录损坏或不匹配，请检查专家日志。"; return false; }
    if (!RRSelectManagedPosition(symbol, magic, id, ticket))
    { error = "该持仓已发生变化，请重新选择。"; return false; }
    return true;
}

// Ascending identifiers give the panel a stable sequence independent of MT5's
// position-list ordering. Zero means no later readable managed position.
ulong RRNextManagedPosition(const string symbol, const long magic, const ulong after_id)
{
    ulong next = 0;
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket == 0 || PositionGetString(POSITION_SYMBOL) != symbol || PositionGetInteger(POSITION_MAGIC) != magic) continue;
        ulong id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        if (id <= after_id || (next != 0 && id >= next)) continue;
        RRState s;
        string error;
        if (RRReadManagedPosition(symbol, magic, id, s, ticket, error)) next = id;
    }
    return next;
}

bool RRPositionPlanPricesSafe(const RRState &s, const RRPlan &plan, const string symbol, string &error)
{
    // Algo trading may be disabled while editing, but a disconnected terminal
    // cannot establish that targets are still in front of an executable quote.
    if (!TerminalInfoInteger(TERMINAL_CONNECTED))
    { error = "终端未连接，无法核对当前报价，请联网后保存。"; return false; }
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    MqlTick tick;
    if (!MathIsValidNumber(tick_size) || tick_size <= 0 || !SymbolInfoTick(symbol, tick)
        || !MathIsValidNumber(tick.bid) || !MathIsValidNumber(tick.ask) || tick.bid <= 0 || tick.ask <= 0 || tick.ask < tick.bid)
    { error = "当前报价或最小价格变动单位无效，请稍候重试。"; return false; }
    // The old plan owns a target that has just crossed, even before RRManage
    // has had its next tick/timer event. Editing must not erase that obligation.
    if (s.stage < s.target_count && RRTargetReached(s.direction, s.entry, s.risk, s.target_r[s.stage], tick.bid, tick.ask, tick_size, digits))
    { error = "原方案有目标刚刚到价，请等待该阶段处理完成后重新加载。"; return false; }
    double price = (s.direction == 1 ? tick.bid : tick.ask);
    for (int i = s.stage; i < plan.count; i++)
    {
        double target = RRTargetPrice(s.direction, s.entry, s.risk, plan.targets[i].multiple, tick_size, digits);
        if (!MathIsValidNumber(target) || target <= 0 || s.direction * (target - price) < tick_size * (1.0 - 1e-7))
        { error = StringFormat("第 %d 行：新目标价必须在当前可平仓报价前方至少一个最小跳动。", i + 1); return false; }
    }
    return true;
}

bool RRApplyPositionPlanLocked(const int handle, RRState &s, const ulong ticket, const string symbol,
                               const RRPlan &plan, const uint expected_plan_checksum, const int expected_stage, string &error)
{
    if (s.version != 2)
    { error = "旧版 RR v1 持仓仅支持查看，请按原方案完成该持仓。"; return false; }
    if (s.blocked != 0)
    { error = "该持仓管理已暂停，请先检查加仓、反转或成交记录。"; return false; }
    if (s.pending != 0)
    { error = "该持仓正在等待平仓确认，请等待确认后重新加载。"; return false; }
    RRPlan previous;
    RRStatePlan(s, previous);
    if (s.stage != expected_stage || RRPlanChecksum(previous) != expected_plan_checksum)
    { error = "持仓方案或触发阶段已变化，请重新加载后编辑。"; return false; }
    if (!RRPlanValidate(plan, error)) return false;
    if (plan.count < s.stage)
    { error = "已触发目标不能删除；余仓可以继续持有，也可以添加后续目标。"; return false; }
    for (int i = 0; i < s.stage; i++)
        if (plan.targets[i].multiple != s.target_r[i] || plan.targets[i].percent != s.target_percent[i] || plan.targets[i].move_be != s.target_be[i])
        { error = StringFormat("第 %d 行已触发，不能修改或删除。", i + 1); return false; }
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    if (!MathIsValidNumber(step) || step <= 0 || !MathIsValidNumber(minimum) || minimum <= 0
        || !MathIsValidNumber(tick_size) || tick_size <= 0)
    { error = "券商手数或价格规则无效，请稍候重试。"; return false; }
    ulong opening_order;
    double in_volume;
    bool mixed;
    if (!RRHistory(s.identifier, opening_order, in_volume, mixed))
    { error = "无法读取完整成交历史，请稍候重试。"; return false; }
    if (!PositionSelectByTicket(ticket) || (ulong)PositionGetInteger(POSITION_IDENTIFIER) != s.identifier
        || PositionGetString(POSITION_SYMBOL) != symbol || PositionGetInteger(POSITION_MAGIC) != s.magic)
    { error = "该持仓已发生变化，请重新选择。"; return false; }
    double volume = PositionGetDouble(POSITION_VOLUME);
    double entry = PositionGetDouble(POSITION_PRICE_OPEN);
    int direction = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1);
    if (mixed || opening_order != s.opening_order || MathAbs(in_volume - s.initial_volume) > step * 0.1
        || !MathIsValidNumber(volume) || volume <= 0 || volume > s.initial_volume + step * 0.1
        || direction != s.direction || MathAbs(entry - s.entry) > tick_size * 0.1)
    { error = "检测到加仓、反转或开仓价变化，不能编辑该持仓。"; return false; }
    double cumulative = 0;
    for (int i = 0; i < s.stage; i++) cumulative += s.target_percent[i];
    double closed = MathMax(0.0, s.initial_volume - volume);
    double reached_goal = (s.stage == s.target_count && RRStateClosesAll(s) ? s.initial_volume
        : MathFloor(s.initial_volume * cumulative / 100.0 / step + 1e-8) * step);
    if (closed < reached_goal - step * 0.1)
    { error = "已触发阶段的减仓尚未完成，请处理完成后重新加载。"; return false; }
    // Simulate only future cumulative reductions from the ACTUAL remaining
    // volume. Earlier manual reductions count toward every later target.
    bool closes_all = RRPlanClosesAll(plan);
    for (int i = s.stage; i < plan.count; i++)
    {
        cumulative += plan.targets[i].percent;
        if (plan.targets[i].percent == 0) continue;
        bool final_exit = closes_all && i == plan.count - 1;
        double goal = (final_exit ? s.initial_volume : MathFloor(s.initial_volume * cumulative / 100.0 / step + 1e-8) * step);
        double close_volume = goal - closed;
        if (close_volume <= step * 0.1) continue;
        double remainder = s.initial_volume - goal;
        if (close_volume < minimum - step * 1e-6 || (!final_exit && remainder < minimum - step * 1e-6))
        { error = StringFormat("第 %d 行：按当前余仓计算的减仓量或余仓小于券商最小手数，请调整比例。", i + 1); return false; }
        closed = goal;
    }
    if (!RRPositionPlanPricesSafe(s, plan, symbol, error)) return false;
    RRState updated = s;
    updated.target_count = plan.count;
    for (int i = 0; i < RR_MAX_TARGETS; i++)
    {
        updated.target_r[i] = (i < plan.count ? plan.targets[i].multiple : 0);
        updated.target_percent[i] = (i < plan.count ? plan.targets[i].percent : 0);
        updated.target_be[i] = (i < plan.count ? plan.targets[i].move_be : 0);
    }
    updated.first_r = updated.target_r[0];
    updated.final_r = updated.target_r[updated.target_count - 1];
    updated.percent = updated.target_percent[0];
    updated.move_be = updated.target_be[0];
    // All execution fields, including stage/BE/pending/sequence and the frozen
    // entry/risk/initial volume, remain exactly as loaded under this file lock.
    if (!RRSave(handle, updated))
    { error = "保存失败，无法确认新方案已持久化；请检查专家日志后再操作。"; return false; }
    s = updated;
    PrintFormat("[PS RR] 仓位 %I64u 已保存新方案，已触发 %d/%d；%s。", s.identifier, s.stage, s.target_count,
        RRStateClosesAll(s) ? "全平 TP 将由管理流程同步" : "保留余仓，服务器全平 TP 将由管理流程清除");
    error = "";
    return true;
}

bool RRApplyPositionPlan(const string symbol, const long magic, const ulong id, const RRPlan &plan,
                         const uint expected_plan_checksum, const int expected_stage, string &error)
{
    error = "";
    ulong ticket;
    if (!RRSelectManagedPosition(symbol, magic, id, ticket))
    { error = "该持仓已平仓，或不属于当前品种和 MagicNumber。"; return false; }
    string filename = RRFileName(id);
    if (!FileIsExist(filename))
    { error = "该持仓没有 RR 记录，不能通过编辑功能接管。"; return false; }
    // No FILE_SHARE_* flags: hold the same exclusive lock used by RRManage
    // throughout load, compare-and-swap validation and the durable append.
    int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE)
    { error = "持仓记录正被其他图表使用或无法写入，请稍候重试。"; return false; }
    RRState s;
    bool saved = false;
    if (!RRLoad(handle, s, id) || s.magic != magic)
        error = "持仓记录损坏或不匹配，不能保存。";
    else saved = RRApplyPositionPlanLocked(handle, s, ticket, symbol, plan, expected_plan_checksum, expected_stage, error);
    FileClose(handle);
    return saved;
}

// The panel cannot change the plan while a same-strategy order is waiting to
// fill, or between its first fill and durable capture of the frozen plan.
bool RRPlanCanEdit(const string symbol, const long magic, string &error)
{
    error = "";
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        ulong order = OrderGetTicket(i);
        if (order > 0 && OrderGetString(ORDER_SYMBOL) == symbol && OrderGetInteger(ORDER_MAGIC) == magic)
        {
            error = "该品种存在本 EA 未成交订单，请先等待成交或撤销订单后保存止盈方案。";
            return false;
        }
    }
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket == 0 || PositionGetString(POSITION_SYMBOL) != symbol || PositionGetInteger(POSITION_MAGIC) != magic) continue;
        ulong id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        string filename = RRFileName(id);
        if (!FileIsExist(filename))
        {
            if (RRWasExisting(id)) continue; // Historical positions were never adopted.
            error = "新仓的止盈方案尚未保存，请稍候再试；若未启用分仓管理，请先处理该订单。";
            return false;
        }
        int handle = FileOpen(filename, FILE_READ | FILE_BIN);
        if (handle == INVALID_HANDLE)
        {
            error = "仓位止盈记录正被其他图表使用或无法读取，请稍候重试。";
            return false;
        }
        RRState s;
        bool valid = RRLoad(handle, s, id);
        FileClose(handle);
        if (!valid || s.magic != magic)
        {
            error = "仓位止盈记录尚未完成或已损坏，保存方案前请先检查专家日志。";
            return false;
        }
    }
    return true;
}


void RRManage(const string symbol, const long magic)
{
    if (!RR_Enable) return;
    if (RRAccount != AccountInfoInteger(ACCOUNT_LOGIN) || RRServer != AccountInfoString(ACCOUNT_SERVER))
        RRSnapshotExisting();
    // Timer + tick handlers share this throttle; no recursive OnTrade calls.
    ulong now = GetTickCount64();
    if (now - RRLastRun < 250) return;
    RRLastRun = now;
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket == 0 || PositionGetString(POSITION_SYMBOL) != symbol || PositionGetInteger(POSITION_MAGIC) != magic) continue;
        ulong id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        string filename = RRFileName(id);
        if (!FileIsExist(filename) && RRWasExisting(id)) continue;
        int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
        if (handle == INVALID_HANDLE)
        {
            RRNotice("无法锁定 RR 状态文件（可能另一个图表正在处理）。本次不发单。");
            continue;
        }
        RRState s;
        bool ready = false;
        if (FileSize(handle) == 0)
        {
            if (RRCapture(ticket, s)) ready = RRSave(handle, s);
        }
        else
        {
            ready = RRLoad(handle, s, id);
            if (!ready) RRNotice("RR 状态文件损坏或版本不兼容；已暂停该仓位，切勿删除文件后让 EA 重复接管。");
        }
        if (ready && s.magic == magic) RRProcess(handle, s, ticket, symbol);
        FileClose(handle);
    }
}
#endif
