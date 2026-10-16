// RR extension for EarnForex Position Sizer. Original panel copyrights retained.
#ifndef POSITION_SIZER_RR_MQH
#define POSITION_SIZER_RR_MQH
#include "RRCore.mqh"

input group "分仓止盈 / RR exit manager"
input(name="启用分仓止盈") bool RR_Enable = true;
input(name="第一目标 R 倍数") double RR_FirstTarget = 2.0;
input(name="第一目标平掉初始仓位百分比") double RR_ClosePercent = 50.0;
input(name="最终全平 R 倍数") double RR_FinalTarget = 5.0;
input(name="第一目标减仓完成后设保本") bool RR_MoveToBE = true;
input(name="保本价额外盈利点数（非点差）") int RR_BEOffsetPoints = 0;
input(name="平仓允许偏差（points）") uint RR_DeviationPoints = 20;

// Append-only per-position journal, held with an exclusive file handle during
// management. Intent is flushed BEFORE sending any close. A torn journal or an
// ambiguous broker reply fails closed rather than guessing and closing twice.
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
    if (!RR_Enable) return true;
    if (!MathIsValidNumber(RR_FirstTarget) || !MathIsValidNumber(RR_FinalTarget) || !MathIsValidNumber(RR_ClosePercent)
        || RR_FirstTarget <= 0 || RR_FinalTarget <= RR_FirstTarget || RR_ClosePercent <= 0 || RR_ClosePercent >= 100 || RR_BEOffsetPoints < 0)
    {
        Print("[PS RR] 参数无效：0 < 第一目标 < 最终目标；0 < 平仓百分比 < 100；保本偏移 >= 0。");
        return false;
    }
    PrintFormat("[PS RR] 已启用：%.2fR 平 %.2f%%，%.2fR 全平。仅接管新仓及已有 RR 记录的仓位。", RR_FirstTarget, RR_ClosePercent, RR_FinalTarget);
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
    uint written = FileWriteStruct(handle, s);
    FileFlush(handle);
    if (written != sizeof(RRState) || GetLastError() != 0)
    {
        RRNotice("状态保存失败，停止发送交易请求。请检查 MQL5/Files 的写入权限及磁盘空间。");
        return false;
    }
    return true;
}

bool RRLoad(const int handle, RRState &s, const ulong id)
{
    ulong size = FileSize(handle);
    if (size < sizeof(RRState) || size % sizeof(RRState) != 0) return false;
    if (!FileSeek(handle, (long)(size - sizeof(RRState)), SEEK_SET)) return false;
    if (FileReadStruct(handle, s) != sizeof(RRState)) return false;
    return s.version == 1 && s.identifier == id && s.checksum == RRChecksum(s)
        && MathIsValidNumber(s.risk) && s.risk > 0 && s.initial_volume > 0
        && (s.direction == 1 || s.direction == -1) && s.stage >= 0 && s.stage <= 3;
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
    s.version = 1;
    s.identifier = id;
    s.magic = PositionGetInteger(POSITION_MAGIC);
    s.opening_order = opening_order;
    s.direction = direction;
    s.entry = entry;
    s.risk = direction * (entry - original_sl);
    s.initial_volume = in_volume;
    s.first_r = RR_FirstTarget;
    s.final_r = RR_FinalTarget;
    s.percent = RR_ClosePercent;
    s.move_be = (int)RR_MoveToBE;
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
    double desired_tp = RRTargetPrice(s.direction, s.entry, s.risk, s.final_r, tick_size, digits);
    double distance = (double)MathMax(SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL), SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL)) * point + tick_size;
    if (MathAbs(old_tp - desired_tp) > tick_size * 0.1 && s.direction * (desired_tp - current_price) >= distance)
        tp = desired_tp;
    if (s.stage >= 2 && s.move_be != 0)
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

void RRProcess(const int handle, RRState &s, const ulong ticket, const string symbol)
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
    if (!RRResolvePending(handle, s, volume, step)) return;
    if (!PositionSelectByTicket(ticket)) return;
    volume = PositionGetDouble(POSITION_VOLUME);
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask <= 0) return;
    double r = RRPriceR(s.direction, s.entry, s.risk, tick.bid, tick.ask);
    // A gap directly to the last target closes the remainder in one action.
    if (s.stage == 3 || r >= s.final_r)
    {
        if (s.stage != 3)
        {
            s.stage = 3;
            if (!RRSave(handle, s)) return;
        }
        RRClose(handle, s, ticket, symbol, volume);
        return;
    }
    if (s.stage == 0 && r >= s.first_r)
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
