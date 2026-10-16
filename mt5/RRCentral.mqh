// Account-wide position management and serialized reverse entries.
#ifndef PS_RR_CENTRAL_MQH
#define PS_RR_CENTRAL_MQH
bool RCCloseOpposite = false;
bool RCSettingsReady = false;
string RCPendingStatus = "";
bool RCReversePending = false;
bool RCResuming = false;
int RCEntryLock = INVALID_HANDLE;
string RCQueuedSymbol = "", RCQueuedFingerprint = "", RCQueuedServer = "";
long RCQueuedAccount = 0;
int RCQueuedDirection = 0;
double RCQueuedVolume = 0;
ulong RCQueuedIDs[];

struct RCOptionRecord { uint version; int enabled; uint checksum; };
string RCOptionFile()
{
    return "PSRR_Settings\\Reverse_" + IntegerToString(RRHash(AccountInfoString(ACCOUNT_SERVER)))
        + "_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".bin";
}
bool RCReadOption(const int handle, RCOptionRecord &record)
{
    FileSeek(handle, 0, SEEK_SET);
    if (FileSize(handle) != sizeof(RCOptionRecord) || FileReadStruct(handle, record) != sizeof(RCOptionRecord)) return false;
    return record.version == 1 && (record.enabled == 0 || record.enabled == 1)
        && record.checksum == (uint)(0x52435631 ^ record.enabled);
}
bool RCLoadOption()
{
    RCSettingsReady = false;
    if (!FileIsExist(RCOptionFile()))
    { RCCloseOpposite = false; RCSettingsReady = true; return true; }
    int handle = FileOpen(RCOptionFile(), FILE_READ | FILE_BIN);
    if (handle == INVALID_HANDLE) return false;
    RCOptionRecord record;
    bool ok = RCReadOption(handle, record);
    FileClose(handle);
    if (!ok) return false;
    RCCloseOpposite = record.enabled != 0;
    RCSettingsReady = true;
    return true;
}
void RCCancelReverse()
{
    bool had_pending = RCReversePending;
    RCReversePending = false;
    RCResuming = false;
    ArrayResize(RCQueuedIDs, 0);
    if (RCEntryLock != INVALID_HANDLE) { FileClose(RCEntryLock); RCEntryLock = INVALID_HANDLE; }
    RCPendingStatus = "";
    if (had_pending) Print("[PS RR] 已取消后续反向开仓；已登记的平仓任务继续完成。");
}
bool RCSetCloseOpposite(const bool enabled, string &error)
{
    error = "";
    int handle = FileOpen(RCOptionFile(), FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE) { error = "反向开仓设置正在使用中或无法保存，请稍后再试。"; return false; }
    RCOptionRecord record;
    if (FileSize(handle) > 0 && !RCReadOption(handle, record))
    { FileClose(handle); error = "反向开仓设置文件校验失败，未覆盖原文件。"; return false; }
    ZeroMemory(record);
    record.version = 1; record.enabled = (int)enabled;
    record.checksum = (uint)(0x52435631 ^ record.enabled);
    FileSeek(handle, 0, SEEK_SET); ResetLastError();
    bool ok = FileWriteStruct(handle, record) == sizeof(RCOptionRecord);
    FileFlush(handle);
    ok = ok && GetLastError() == 0;
    RCOptionRecord verified;
    ok = ok && RCReadOption(handle, verified) && verified.enabled == record.enabled;
    FileClose(handle);
    if (!ok) { RCSettingsReady = false; error = "设置保存失败，暂停开新仓，请稍后重试。"; return false; }
    RCCloseOpposite = enabled; RCSettingsReady = true;
    if (!enabled) RCCancelReverse();
    return true;
}

bool RCSelectedOpposite()
{
    return PositionGetString(POSITION_SYMBOL) == SymbolForTrading
        && (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1)
            != (sets.TradeDirection == Long ? 1 : -1);
}
bool RCHasOpposite()
{
    for (int i = PositionsTotal() - 1; i >= 0; i--)
        if (PositionGetTicket(i) != 0 && RCSelectedOpposite()) return true;
    return false;
}
bool RCHasOppositeOrder()
{
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        if (OrderGetTicket(i) == 0 || OrderGetString(ORDER_SYMBOL) != SymbolForTrading) continue;
        ENUM_ORDER_TYPE type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
        int direction = 0;
        if (type == ORDER_TYPE_BUY || type == ORDER_TYPE_BUY_LIMIT || type == ORDER_TYPE_BUY_STOP || type == ORDER_TYPE_BUY_STOP_LIMIT) direction = 1;
        if (type == ORDER_TYPE_SELL || type == ORDER_TYPE_SELL_LIMIT || type == ORDER_TYPE_SELL_STOP || type == ORDER_TYPE_SELL_STOP_LIMIT) direction = -1;
        if (direction != 0 && direction != (sets.TradeDirection == Long ? 1 : -1)) return true;
    }
    return false;
}
string RCFingerprint()
{
    // Live market entry/derived TP and calculated risk outputs are intentionally
    // excluded. User inputs, direction, SL and the exit plan must stay frozen.
    return SymbolForTrading + "|" + IntegerToString(sets.MagicNumber) + "|"
        + IntegerToString((int)sets.TradeDirection) + "|" + IntegerToString((int)sets.EntryType)
        + "|" + DoubleToString(sets.EntryType == Instant ? 0 : sets.EntryLevel, 16)
        + "|" + DoubleToString(ShowATROptions && sets.ATRMultiplierSL > 0 ? 0 : (sets.SLDistanceInPoints ? sets.StopLoss : sets.StopLossLevel), 16) + "|" + DoubleToString(sets.StopPriceLevel, 16)
        + "|" + IntegerToString((int)sets.UseMoneyInsteadOfPercentage) + "|" + IntegerToString((int)sets.RiskFromPositionSize)
        + "|" + DoubleToString(sets.RiskFromPositionSize ? sets.PositionSize : (sets.UseMoneyInsteadOfPercentage ? sets.MoneyRisk : sets.Risk), 8)
        + "|" + IntegerToString((int)sets.SLDistanceInPoints) + "|" + DoubleToString(sets.ATRMultiplierSL, 8)
        + "|" + IntegerToString(sets.ATRPeriod) + "|" + IntegerToString((int)sets.ATRTimeframe)
        + "|" + IntegerToString((int)sets.SpreadAdjustmentSL)
        + "|" + IntegerToString(sets.TakeProfitsNumber) + "|" + IntegerToString(RRPlanChecksum(RRActivePlan))
        + "|" + DoubleToString(RR_Enable ? 0 : ((ShowATROptions && sets.ATRMultiplierTP > 0) ? sets.ATRMultiplierTP : (sets.TPDistanceInPoints ? sets.TakeProfit : (sets.TPLockedOnSL ? sets.TPMultiplier : sets.TakeProfitLevel))), 16)
        + "|" + IntegerToString((int)sets.TPDistanceInPoints) + "|" + IntegerToString((int)sets.TPLockedOnSL)
        + "|" + IntegerToString((int)sets.DoNotApplyStopLoss) + "|" + IntegerToString((int)sets.DoNotApplyTakeProfit);
}
bool RCPreparingReverse()
{
    return RCCloseOpposite && !RCResuming && RCHasOpposite();
}
// Final per-send budget. Consume before sending, even if the response is unknown;
// the queued entry must never automatically try an uncertain submission again.
bool RCReserveEntryVolume(const double volume)
{
    if (!RCResuming) return true;
    double step = SymbolInfoDouble(SymbolForTrading, SYMBOL_VOLUME_STEP);
    if (!MathIsValidNumber(volume) || !MathIsValidNumber(step) || step <= 0 || volume <= 0
        || volume > RCQueuedVolume + step * 1e-6)
    { Alert("重新计算的开仓量超出已确认手数，本次不开新仓，请重新核对。"); return false; }
    RCQueuedVolume = MathMax(0, RCQueuedVolume - volume);
    return true;
}
bool RCTradeEnter()
{
    if (RCReversePending && !RCResuming)
    { Alert("正在平反向仓，请等待，或在交易页取消后续开仓。"); return false; }
    if (!RCLoadOption()) { Alert("反向开仓设置读取失败，暂不开新仓。"); return false; }
    if (RCResuming) return RCEntryLock != INVALID_HANDLE && RCCloseOpposite;
    if (RR_Enable)
    {
        RRPlan latest; string error;
        if (!RRPlanRead(RRPlanFileName(), latest, error))
        { Alert("新仓共用止盈方案读取失败，暂不开新仓：", error); return false; }
        RRActivePlan = latest;
    }
    string name = "PSRR_Settings\\EntryLock_" + IntegerToString(RRHash(AccountInfoString(ACCOUNT_SERVER)))
        + "_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + IntegerToString(RRHash(SymbolForTrading)) + ".bin";
    RCEntryLock = FileOpen(name, FILE_READ | FILE_WRITE | FILE_BIN);
    if (RCEntryLock == INVALID_HANDLE) { Alert("该品种正在由另一个面板处理开仓，请稍后再试。"); return false; }
    if (RCCloseOpposite && RCHasOppositeOrder())
    { Alert("该品种有反向挂单，请先处理挂单再开仓，避免挂单成交后再次形成对锁。"); FileClose(RCEntryLock); RCEntryLock = INVALID_HANDLE; return false; }
    return true;
}
void RCTradeLeave()
{
    if (!RCReversePending && RCEntryLock != INVALID_HANDLE)
    { FileClose(RCEntryLock); RCEntryLock = INVALID_HANDLE; }
}
bool RCEntryClear()
{
    if (!RCCloseOpposite) return true;
    if (RCHasOpposite() || RCHasOppositeOrder())
    { Alert("反向仓或反向挂单尚未清空，本次不开新仓。"); return false; }
    return true;
}
// true stops this Trade invocation. Durable close jobs continue from the timer.
bool RCQueueReverse(const double volume)
{
    if (!RCCloseOpposite || !RCHasOpposite()) return false;
    if (RCResuming) { Alert("等待期间出现反向仓，本次后续开仓已取消。"); return true; }
    if (sets.TakeProfitsNumber != 1 || !RRCanSplitVolume(volume))
    { Alert("反向开仓请使用一笔开仓；多个止盈目标请在分仓止盈页设置。"); return true; }
    if (!RRCanTrade() || !RGCanOpen(sets.MagicNumber) || RCHasOppositeOrder()) return true;
    ArrayResize(RCQueuedIDs, 0);
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if (PositionGetTicket(i) == 0 || !RCSelectedOpposite()) continue;
        ulong identifier = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        if (RMPositionExitActive(identifier) || RGPositionExitLatched(identifier))
        { Alert("反向仓已有平仓任务，请待其完成后重新开仓。"); ArrayResize(RCQueuedIDs, 0); return true; }
        int size = ArraySize(RCQueuedIDs); ArrayResize(RCQueuedIDs, size + 1); RCQueuedIDs[size] = identifier;
    }
    if (ArraySize(RCQueuedIDs) == 0)
    { Alert("原反向仓刚已变化，请重新检查并点击交易。"); return true; }
    RCQueuedSymbol = SymbolForTrading; RCQueuedFingerprint = RCFingerprint();
    RCQueuedAccount = AccountInfoInteger(ACCOUNT_LOGIN); RCQueuedServer = AccountInfoString(ACCOUNT_SERVER);
    RCQueuedDirection = sets.TradeDirection == Long ? 1 : -1; RCQueuedVolume = volume;
    for (int i = 0; i < ArraySize(RCQueuedIDs); i++)
    {
        string error;
        if (RMSelectIdentifier(RCQueuedIDs[i]) == 0 || !RCSelectedOpposite()
            || !RMRequestClose(RCQueuedIDs[i], 100, sets.MagicNumber, error, -RCQueuedDirection))
        {
            Alert("反向平仓登记未全部成功，本次后续开仓已取消。已登记的平仓仍会完成：", error);
            ArrayResize(RCQueuedIDs, 0); return true;
        }
    }
    RCReversePending = true;
    RCPendingStatus = "等待全部反向仓平完，再提交新单";
    return true;
}
void RCManageReverse()
{
    if (!RCReversePending) return;
    if (!RCLoadOption() || !RCCloseOpposite || AccountInfoInteger(ACCOUNT_LOGIN) != RCQueuedAccount
        || AccountInfoString(ACCOUNT_SERVER) != RCQueuedServer || SymbolForTrading != RCQueuedSymbol
        || RCFingerprint() != RCQueuedFingerprint || !RGCanOpen(sets.MagicNumber) || RCHasOppositeOrder())
    { RCCancelReverse(); Alert("设置、品种或风控状态变化，已取消后续反向开仓。已登记的平仓继续完成。"); return; }
    for (int i = 0; i < ArraySize(RCQueuedIDs); i++)
        {
        if (RGPositionExitLatched(RCQueuedIDs[i]))
        { RCCancelReverse(); Alert("亏损保护已接管反向仓，取消后续开仓。"); return; }
        if (RGPositionIdentifierExists(RCQueuedIDs[i]) || !RMExitSettled(RCQueuedIDs[i])) return;
    }
    if (RCHasOpposite()) { RCCancelReverse(); Alert("等待期间出现新的反向仓，已取消后续开仓。"); return; }
    RCResuming = true;
    RCPendingStatus = "反向仓已平完，正在重新检查开仓条件";
    Trade(); // Full original preflight runs again; size cannot exceed queued size.
    RCResuming = false;
    RCReversePending = false;
    RCTradeLeave();
    ArrayResize(RCQueuedIDs, 0);
    RCPendingStatus = "";
}


// Shared controls follow this panel across symbols. Absolute prices, instrument
// commissions and symbol-specific stop distances retain each symbol's own file.
struct RCCommonSettings
{
    double Risk;
    double MoneyRisk;
    bool UseMoneyInsteadOfPercentage;
    bool RiskFromPositionSize;
    double PositionSize;
    ACCOUNT_BUTTON AccountButton;
    double CustomBalance;
    INCLUDE_ORDERS IncludeOrders;
    bool IgnoreOrdersWithoutSL;
    bool IgnoreOrdersWithoutTP;
    INCLUDE_SYMBOLS IncludeSymbols;
    INCLUDE_DIRECTIONS IncludeDirections;
    double CustomLeverage;
    int MagicNumber;
    string Commentary;
    bool DisableTradingWhenLinesAreHidden;
    int MaxSlippage;
    int MaxSpread;
    int MaxEntrySLDistance;
    int MinEntrySLDistance;
    double MaxRiskPercentage;
    double MaxMarginPerc;
    bool SubtractPositions;
    bool SubtractPendingOrders;
    bool DoNotApplyStopLoss;
    bool DoNotApplyTakeProfit;
    bool AskForConfirmation;
    bool CommentAutoSuffix;
    int MaxNumberOfTradesTotal;
    int MaxNumberOfTradesPerSymbol;
    double MaxPositionSizeTotal;
    double MaxPositionSizePerSymbol;
    double MaxRiskTotal;
    double MaxRiskPerSymbol;
    double MaxMarginPercTotal;
    double MaxMarginPercPerSymbol;
    int ExpiryMinutes;
    int TrailingStopPoints;
    int BreakEvenPoints;
};
RCCommonSettings RCCommon;
bool RCCommonReady = false;
long RCCommonAccount = 0;
string RCCommonServer = "";
void RCCaptureCommon()
{
    RCCommon.Risk = sets.Risk;
    RCCommon.MoneyRisk = sets.MoneyRisk;
    RCCommon.UseMoneyInsteadOfPercentage = sets.UseMoneyInsteadOfPercentage;
    RCCommon.RiskFromPositionSize = sets.RiskFromPositionSize;
    RCCommon.PositionSize = sets.PositionSize;
    RCCommon.AccountButton = sets.AccountButton;
    RCCommon.CustomBalance = sets.CustomBalance;
    RCCommon.IncludeOrders = sets.IncludeOrders;
    RCCommon.IgnoreOrdersWithoutSL = sets.IgnoreOrdersWithoutSL;
    RCCommon.IgnoreOrdersWithoutTP = sets.IgnoreOrdersWithoutTP;
    RCCommon.IncludeSymbols = sets.IncludeSymbols;
    RCCommon.IncludeDirections = sets.IncludeDirections;
    RCCommon.CustomLeverage = sets.CustomLeverage;
    RCCommon.MagicNumber = sets.MagicNumber;
    RCCommon.Commentary = sets.Commentary;
    RCCommon.DisableTradingWhenLinesAreHidden = sets.DisableTradingWhenLinesAreHidden;
    RCCommon.MaxSlippage = sets.MaxSlippage;
    RCCommon.MaxSpread = sets.MaxSpread;
    RCCommon.MaxEntrySLDistance = sets.MaxEntrySLDistance;
    RCCommon.MinEntrySLDistance = sets.MinEntrySLDistance;
    RCCommon.MaxRiskPercentage = sets.MaxRiskPercentage;
    RCCommon.MaxMarginPerc = sets.MaxMarginPerc;
    RCCommon.SubtractPositions = sets.SubtractPositions;
    RCCommon.SubtractPendingOrders = sets.SubtractPendingOrders;
    RCCommon.DoNotApplyStopLoss = sets.DoNotApplyStopLoss;
    RCCommon.DoNotApplyTakeProfit = sets.DoNotApplyTakeProfit;
    RCCommon.AskForConfirmation = sets.AskForConfirmation;
    RCCommon.CommentAutoSuffix = sets.CommentAutoSuffix;
    RCCommon.MaxNumberOfTradesTotal = sets.MaxNumberOfTradesTotal;
    RCCommon.MaxNumberOfTradesPerSymbol = sets.MaxNumberOfTradesPerSymbol;
    RCCommon.MaxPositionSizeTotal = sets.MaxPositionSizeTotal;
    RCCommon.MaxPositionSizePerSymbol = sets.MaxPositionSizePerSymbol;
    RCCommon.MaxRiskTotal = sets.MaxRiskTotal;
    RCCommon.MaxRiskPerSymbol = sets.MaxRiskPerSymbol;
    RCCommon.MaxMarginPercTotal = sets.MaxMarginPercTotal;
    RCCommon.MaxMarginPercPerSymbol = sets.MaxMarginPercPerSymbol;
    RCCommon.ExpiryMinutes = sets.ExpiryMinutes;
    RCCommon.TrailingStopPoints = sets.TrailingStopPoints;
    RCCommon.BreakEvenPoints = sets.BreakEvenPoints;
    RCCommonAccount = AccountInfoInteger(ACCOUNT_LOGIN);
    RCCommonServer = AccountInfoString(ACCOUNT_SERVER);
    RCCommonReady = true;
}
bool RCApplyCommon()
{
    if (!RCCommonReady || RCCommonAccount != AccountInfoInteger(ACCOUNT_LOGIN)
        || RCCommonServer != AccountInfoString(ACCOUNT_SERVER)) return false;
    sets.Risk = RCCommon.Risk;
    sets.MoneyRisk = RCCommon.MoneyRisk;
    sets.UseMoneyInsteadOfPercentage = RCCommon.UseMoneyInsteadOfPercentage;
    sets.RiskFromPositionSize = RCCommon.RiskFromPositionSize;
    sets.PositionSize = RCCommon.PositionSize;
    sets.AccountButton = RCCommon.AccountButton;
    sets.CustomBalance = RCCommon.CustomBalance;
    sets.IncludeOrders = RCCommon.IncludeOrders;
    sets.IgnoreOrdersWithoutSL = RCCommon.IgnoreOrdersWithoutSL;
    sets.IgnoreOrdersWithoutTP = RCCommon.IgnoreOrdersWithoutTP;
    sets.IncludeSymbols = RCCommon.IncludeSymbols;
    sets.IncludeDirections = RCCommon.IncludeDirections;
    sets.CustomLeverage = RCCommon.CustomLeverage;
    sets.MagicNumber = RCCommon.MagicNumber;
    sets.Commentary = RCCommon.Commentary;
    sets.DisableTradingWhenLinesAreHidden = RCCommon.DisableTradingWhenLinesAreHidden;
    sets.MaxSlippage = RCCommon.MaxSlippage;
    sets.MaxSpread = RCCommon.MaxSpread;
    sets.MaxEntrySLDistance = RCCommon.MaxEntrySLDistance;
    sets.MinEntrySLDistance = RCCommon.MinEntrySLDistance;
    sets.MaxRiskPercentage = RCCommon.MaxRiskPercentage;
    sets.MaxMarginPerc = RCCommon.MaxMarginPerc;
    sets.SubtractPositions = RCCommon.SubtractPositions;
    sets.SubtractPendingOrders = RCCommon.SubtractPendingOrders;
    sets.DoNotApplyStopLoss = RCCommon.DoNotApplyStopLoss;
    sets.DoNotApplyTakeProfit = RCCommon.DoNotApplyTakeProfit;
    sets.AskForConfirmation = RCCommon.AskForConfirmation;
    sets.CommentAutoSuffix = RCCommon.CommentAutoSuffix;
    sets.MaxNumberOfTradesTotal = RCCommon.MaxNumberOfTradesTotal;
    sets.MaxNumberOfTradesPerSymbol = RCCommon.MaxNumberOfTradesPerSymbol;
    sets.MaxPositionSizeTotal = RCCommon.MaxPositionSizeTotal;
    sets.MaxPositionSizePerSymbol = RCCommon.MaxPositionSizePerSymbol;
    sets.MaxRiskTotal = RCCommon.MaxRiskTotal;
    sets.MaxRiskPerSymbol = RCCommon.MaxRiskPerSymbol;
    sets.MaxMarginPercTotal = RCCommon.MaxMarginPercTotal;
    sets.MaxMarginPercPerSymbol = RCCommon.MaxMarginPercPerSymbol;
    sets.ExpiryMinutes = RCCommon.ExpiryMinutes;
    sets.TrailingStopPoints = RCCommon.TrailingStopPoints;
    sets.BreakEvenPoints = RCCommon.BreakEvenPoints;
    return true;
}
#endif
