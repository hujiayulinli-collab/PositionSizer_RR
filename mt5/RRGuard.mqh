// Money loss limits. No trading signals; the guard only reduces exposure.
#ifndef PSRR_GUARD_MQH
#define PSRR_GUARD_MQH

struct RGDayState
{
    uint version;
    long account;
    uint server_hash;
    long day;
    int locked;
    int drained;
    double limit;
    double trigger_net;
    uint checksum;
};

long RGAccount = 0;
string RGServer = "";
bool RGHistoryDirty = true;
bool RGSnapshotReady = false;
bool RGDailyLocked = false;
bool RGEntryBlocked = false;
double RGRealized = 0;
double RGFloating = 0;
double RGCachedBalance = 0;
long RGCachedDay = 0;
ulong RGHistoryAt = 0;
string RGStatus = "等待首次检查";
string RGLastError = "";

long RGDayStart(const datetime now)
{
    MqlDateTime d;
    if (now <= 0 || !TimeToStruct(now, d)) return 0;
    d.hour = 0; d.min = 0; d.sec = 0;
    return (long)StructToTime(d);
}

bool RGLimitHit(const double net, const double limit)
{
    return MathIsValidNumber(net) && MathIsValidNumber(limit) && limit > 0 && net <= -limit;
}

bool RGTradingDealType(const long type)
{
    return type == DEAL_TYPE_BUY || type == DEAL_TYPE_SELL ||
        type == DEAL_TYPE_COMMISSION || type == DEAL_TYPE_COMMISSION_DAILY ||
        type == DEAL_TYPE_COMMISSION_MONTHLY || type == DEAL_TYPE_COMMISSION_AGENT_DAILY ||
        type == DEAL_TYPE_COMMISSION_AGENT_MONTHLY || type == DEAL_TYPE_CHARGE ||
        type == DEAL_TYPE_INTEREST || type == DEAL_DIVIDEND || type == DEAL_DIVIDEND_FRANKED || type == DEAL_TAX;
}

bool RGPositionInScope(const long position_magic, const long manager_magic)
{
    return RGCurrentPositionScope == RG_ENTIRE_ACCOUNT || position_magic == manager_magic;
}

string RGDailyFileName()
{
    return StringFormat("PSRR_Guard\\%u_%I64d\\daily.bin", RRHash(AccountInfoString(ACCOUNT_SERVER)), AccountInfoInteger(ACCOUNT_LOGIN));
}

uint RGDayChecksum(const RGDayState &s)
{
    return RRHash(StringFormat("%u|%I64d|%u|%I64d|%d|%d|", s.version, s.account, s.server_hash, s.day, s.locked, s.drained)
        + DoubleToString(s.limit, 16) + "|" + DoubleToString(s.trigger_net, 16));
}

bool RGSaveDay(const int handle, RGDayState &s)
{
    s.checksum = RGDayChecksum(s);
    if (!FileSeek(handle, 0, SEEK_END)) return false;
    ResetLastError();
    if (FileWriteStruct(handle, s) != sizeof(RGDayState)) return false;
    FileFlush(handle);
    return GetLastError() == 0;
}

bool RGLoadDay(const int handle, RGDayState &s, const long today)
{
    if (FileSize(handle) == 0)
    {
        ZeroMemory(s);
        s.version = 1; s.account = AccountInfoInteger(ACCOUNT_LOGIN);
        s.server_hash = RRHash(AccountInfoString(ACCOUNT_SERVER)); s.day = today;
        return RGSaveDay(handle, s);
    }
    if (FileSize(handle) % sizeof(RGDayState) != 0 || !FileSeek(handle, -(long)sizeof(RGDayState), SEEK_END)) return false;
    if (FileReadStruct(handle, s) != sizeof(RGDayState)) return false;
    return s.version == 1 && s.account == AccountInfoInteger(ACCOUNT_LOGIN) &&
        s.server_hash == RRHash(AccountInfoString(ACCOUNT_SERVER)) && s.day > 0 &&
        (s.locked == 0 || s.locked == 1) && (s.drained == 0 || s.drained == 1) &&
        MathIsValidNumber(s.limit) && MathIsValidNumber(s.trigger_net) &&
        (!s.locked || s.limit > 0) && s.checksum == RGDayChecksum(s);
}

// A previous day's unfinished liquidation must finish before the lock resets.
bool RGAdvanceDay(RGDayState &s, const long today)
{
    if (today <= s.day || (s.locked && !s.drained)) return false;
    s.day = today; s.locked = 0; s.drained = 0; s.limit = 0; s.trigger_net = 0;
    return true;
}

bool RGReadSnapshot(const datetime now, const bool force)
{
    const long today = RGDayStart(now);
    const double balance = AccountInfoDouble(ACCOUNT_BALANCE);
    const int positions_before = PositionsTotal();
    if (today == 0) return false;
    if (force || RGHistoryDirty || RGCachedDay != today || balance != RGCachedBalance || GetTickCount64() - RGHistoryAt >= 1000)
    {
        if (!HistorySelect((datetime)today, now)) return false;
        double realized = 0;
        const int count = HistoryDealsTotal();
        for (int i = 0; i < count; i++)
        {
            const ulong deal = HistoryDealGetTicket(i);
            if (deal == 0) return false;
            if (!RGTradingDealType(HistoryDealGetInteger(deal, DEAL_TYPE))) continue;
            realized += HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_SWAP)
                + HistoryDealGetDouble(deal, DEAL_COMMISSION) + HistoryDealGetDouble(deal, DEAL_FEE);
        }
        if (!MathIsValidNumber(realized)) return false;
        RGRealized = realized; RGCachedDay = today; RGCachedBalance = balance;
        RGHistoryAt = GetTickCount64(); RGHistoryDirty = false;
    }
    double floating = 0;
    for (int i = positions_before - 1; i >= 0; i--)
    {
        if (PositionGetTicket(i) == 0) { RGHistoryDirty = true; return false; }
        floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
    }
    // Retry next event if execution changed the account during the snapshot.
    if (positions_before != PositionsTotal() || balance != AccountInfoDouble(ACCOUNT_BALANCE) || !MathIsValidNumber(floating))
    {
        RGHistoryDirty = true;
        return false;
    }
    RGFloating = floating;
    return true;
}

void RGResetContext()
{
    RGAccount = AccountInfoInteger(ACCOUNT_LOGIN); RGServer = AccountInfoString(ACCOUNT_SERVER);
    RGHistoryDirty = true; RGSnapshotReady = false; RGDailyLocked = false; RGEntryBlocked = false;
    RGCachedDay = 0; RGHistoryAt = 0; RGRealized = 0; RGFloating = 0;
    RGLastError = ""; RGStatus = "等待首次检查";
}

bool RGValidateInputs()
{
    if (!MathIsValidNumber(RGCurrentPositionLossLimit) || RGCurrentPositionLossLimit < 0 ||
        !MathIsValidNumber(RGCurrentDailyLossLimit) || RGCurrentDailyLossLimit < 0 ||
        (RGCurrentPositionScope != RG_OWN_MAGIC && RGCurrentPositionScope != RG_ENTIRE_ACCOUNT))
    {
        Print("[PS RR Guard] 亏损金额必须为非负数；0 表示关闭。");
        return false;
    }
    return true;
}

// Called immediately after durable latching and before a possibly slow broker
// request. The account-wide daily trigger already issued its own alarm.
void RGOnPositionLatched(const ulong ticket)
{
    if (RGDailyLocked) return;
    double net = 0;
    if (PositionSelectByTicket(ticket)) net = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
    RDPlayRiskAlert(StringFormat("持仓 #%I64u 单笔亏损触发：浮动盈亏 %.2f，额度 %.2f %s；开始强制平仓。",
        ticket, net, RGCurrentPositionLossLimit, AccountInfoString(ACCOUNT_CURRENCY)));
}

// Runs independently of RR_Enable, before ordinary partial exits. The daily
// file is also an account-wide mutex, shared by all charts in this terminal.
bool RGManage(const long magic, const bool force = false)
{
    if (RGAccount != AccountInfoInteger(ACCOUNT_LOGIN) || RGServer != AccountInfoString(ACCOUNT_SERVER)) RGResetContext();
    // Panel drafts never reach the engine. Each cycle uses the last fully
    // persisted account settings; a settings error must not undo exit latches.
    const bool settings_ready = RGSyncSettings();
    RGEntryBlocked = false; RGLastError = "";
    const datetime now = TimeCurrent();
    const long today = RGDayStart(now);
    RGSnapshotReady = RGReadSnapshot(now, force);
    if (today == 0)
    {
        RGEntryBlocked = !settings_ready || RGCurrentDailyLossLimit > 0 || RGDailyLocked || FileIsExist(RGDailyFileName());
        RGStatus = "等待服务器时间";
        return !RGEntryBlocked;
    }
    // A new installation with daily protection disabled has no daily journal.
    // Existing records must still be read: lowering a limit to zero cannot
    // clear a trigger already latched earlier in the same day.
    const bool use_daily_record = (settings_ready && RGCurrentDailyLossLimit > 0) || FileIsExist(RGDailyFileName());
    const int handle = use_daily_record ? FileOpen(RGDailyFileName(), FILE_READ | FILE_WRITE | FILE_BIN) : INVALID_HANDLE;
    if (use_daily_record && handle == INVALID_HANDLE)
    {
        RGEntryBlocked = true; RGStatus = "保护记录忙或不可写，等待检查";
        return false;
    }
    RGDayState s;
    ZeroMemory(s);
    s.day = today;
    if (use_daily_record && (!RGLoadDay(handle, s, today) || today < s.day))
    {
        FileClose(handle); RGEntryBlocked = true; RGStatus = "保护记录异常，暂停新开仓；请核对日志";
        RRNotice("亏损保护记录损坏或服务器日期早于记录，已暂停新开仓。不要删除保护记录绕过限制。");
        return false;
    }
    bool changed = RGAdvanceDay(s, today);
    bool new_daily_trigger = false;
    if (settings_ready && !s.locked && RGSnapshotReady && RGLimitHit(RGRealized + RGFloating, RGCurrentDailyLossLimit))
    {
        s.locked = 1; s.drained = 0; s.limit = RGCurrentDailyLossLimit; s.trigger_net = RGRealized + RGFloating;
        changed = true; new_daily_trigger = true;
    }
    // Exposure added after a completed liquidation is also liquidated while
    // locked on that same day. A new day resets a fully drained old lock first.
    if (s.locked && s.drained && (PositionsTotal() > 0 || OrdersTotal() > 0)) { s.drained = 0; changed = true; }
    if (changed && !RGSaveDay(handle, s))
    {
        FileClose(handle); RGEntryBlocked = true; RGStatus = "无法保存亏损保护记录，暂停新开仓";
        return false;
    }
    RGDailyLocked = s.locked != 0;
    RGEntryBlocked = !settings_ready || RGDailyLocked || (RGCurrentDailyLossLimit > 0 && !RGSnapshotReady);
    if (new_daily_trigger)
        RDPlayRiskAlert(StringFormat("整个账户每日亏损触发：净盈亏 %.2f，额度 %.2f %s；取消挂单并清仓，当天锁定。",
            s.trigger_net, s.limit, AccountInfoString(ACCOUNT_CURRENCY)));

    bool exiting = false;
    // Cancel entry orders before closing positions, reducing refill risk.
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        const ulong ticket = OrderGetTicket(i);
        if (ticket == 0 || (!RGDailyLocked && !RGOrderCancelLatched(ticket))) continue;
        string status;
        if (!RGCancelOrder(ticket, RGDailyLocked ? "daily" : "", status)) { exiting = true; RGLastError = status; }
    }
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        const ulong ticket = PositionGetTicket(i);
        if (ticket == 0) continue;
        const ulong id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        const double net = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
        const bool single = settings_ready && RGPositionInScope(PositionGetInteger(POSITION_MAGIC), magic) && RGLimitHit(net, RGCurrentPositionLossLimit);
        if (!RGDailyLocked && !single && !RGPositionExitLatched(id)) continue;
        bool first = false;
        string status;
        const string trigger = RGDailyLocked ? "daily" : (single ? "position" : "");
        if (!RGExitPosition(ticket, trigger, magic, status, first)) { exiting = true; RGLastError = status; }
    }
    if (s.locked && !s.drained && PositionsTotal() == 0 && OrdersTotal() == 0)
    {
        s.drained = 1;
        if (!RGSaveDay(handle, s)) RGLastError = "清仓完成，状态保存失败，等待重试";
    }
    if (handle != INVALID_HANDLE) FileClose(handle);
    if (RGDailyLocked) RGStatus = s.drained ? "每日保护已触发：清仓完成，当天禁止新开仓" : "每日保护已触发：正在撤单 / 清仓";
    else if (exiting) RGStatus = "单笔保护执行中";
    else if (!RGSnapshotReady) RGStatus = "盈亏数据未就绪，等待历史同步";
    else RGStatus = "监控中";
    if (RGLastError != "") RGStatus += "；" + RGLastError;
    if (!settings_ready) RGStatus += "；设置未就绪：" + RGSettingsError;
    return !RGEntryBlocked;
}

bool RGCanOpen(const long magic)
{
    RGManage(magic, true);
    if (!RGEntryBlocked) return true;
    Alert("亏损保护：", RGStatus);
    return false;
}

void RGDeleteStatus()
{
    ObjectsDeleteAll(0, "PSRR_GuardStatus_");
}

void RGStatusLine(const int row, const string value, const color foreground)
{
    const string name = "PSRR_GuardStatus_" + IntegerToString(row);
    if (ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
    ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_LOWER);
    ObjectSetInteger(0, name, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
    ObjectSetInteger(0, name, OBJPROP_XDISTANCE, 12);
    ObjectSetInteger(0, name, OBJPROP_YDISTANCE, 12 + (2 - row) * 20);
    ObjectSetInteger(0, name, OBJPROP_COLOR, foreground);
    ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
    ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
    ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
    ObjectSetString(0, name, OBJPROP_FONT, "Microsoft YaHei");
    ObjectSetString(0, name, OBJPROP_TEXT, value);
}

void RGRefreshStatus()
{
    if (!RGCurrentShowStatus) { RGDeleteStatus(); return; }
    const string currency = AccountInfoString(ACCOUNT_CURRENCY);
    const string daily = RGCurrentDailyLossLimit > 0 ? DoubleToString(RGCurrentDailyLossLimit, 2) : "关闭";
    const string single = RGCurrentPositionLossLimit > 0 ? DoubleToString(RGCurrentPositionLossLimit, 2) : "关闭";
    RGStatusLine(0, "亏损保护 [" + currency + "]  单笔 " + single + (RGCurrentPositionScope == RG_ENTIRE_ACCOUNT ? "（全账户）" : "（本 EA Magic）")
        + " / 每日 " + daily + "（全账户，服务器日期）", clrDarkOrange);
    string numbers = "今日已实现 / 当前浮动 / 每日剩余额度：等待数据";
    if (RGSnapshotReady)
        numbers = "今日已实现 " + DoubleToString(RGRealized, 2) + " / 当前浮动 " + DoubleToString(RGFloating, 2)
            + " / 每日剩余额度 " + (RGCurrentDailyLossLimit > 0 ? DoubleToString(MathMax(0, RGCurrentDailyLossLimit + RGRealized + RGFloating), 2) : "未启用");
    RGStatusLine(1, numbers, clrDarkOrange);
    RGStatusLine(2, RGStatus, RGEntryBlocked || RGLastError != "" ? clrOrangeRed : clrDarkOrange);
}
#endif
