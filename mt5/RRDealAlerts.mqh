// Notifications only. This module never opens, modifies, or closes a trade.
#ifndef PS_RR_DEAL_ALERTS_MQH
#define PS_RR_DEAL_ALERTS_MQH

input group "成交与亏损提示音"
input(name="启用整个账户的实际成交提示音") bool RDEnableTradeSound = true;
input(name="实际成交提示音（Sounds 内 WAV）") string RDTradeSound = "ok.wav";
input(name="亏损限额报警音（Sounds 内 WAV）") string RDLossSound = "alert.wav";

// Independent of the original panel's DisableTradingSounds: that option only
// controls its order-submission sounds, not actual broker-confirmed fills.
// Every matching DEAL_ADD event is queued once locally. A temporarily missing
// history row stays queued, with bounded work per timer and no history scan.
ulong RDPendingDeals[];
int RDPendingCursor = 0;
string RDAccountKey = "";
long RDStartedServerMs = 0;
ulong RDLastErrorNotice = 0;
bool RDHasErrorNotice = false;

uint RDHash(const string text)
{
    uint hash = 2166136261;
    for (int i = 0; i < StringLen(text); i++)
        hash = (hash ^ (uint)StringGetCharacter(text, i)) * 16777619;
    return hash;
}

string RDAccountPrefix()
{
    // Even a 20-digit deal identifier keeps the complete variable name < 64.
    return "PSRR_DA_" + IntegerToString(RDHash(AccountInfoString(ACCOUNT_SERVER)))
        + "_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
}

void RDInitAlerts()
{
    RDAccountKey = RDAccountPrefix();
    RDStartedServerMs = (long)TimeCurrent() * 1000;
    ArrayResize(RDPendingDeals, 0);
    RDPendingCursor = 0;
    RDLastErrorNotice = 0;
    RDHasErrorNotice = false;
    // Do not delete shared terminal markers: another chart may still use them.
    // Do not inspect or replay historical fills at initialization/reload.
}

void RDSyncAlertAccount()
{
    if (RDAccountKey != RDAccountPrefix()) RDInitAlerts();
}

void RDNotice(const string message)
{
    ulong now = GetTickCount64();
    if (RDHasErrorNotice && now - RDLastErrorNotice < 30000) return;
    RDHasErrorNotice = true;
    RDLastErrorNotice = now;
    Print("[PS RR 声音] ", message);
}

bool RDPlayFile(const string filename, const string purpose)
{
    if (StringLen(filename) == 0)
    {
        RDNotice(purpose + "声音文件为空；请在参数中选择 Sounds 目录内的 WAV 文件。");
        return false; // PlaySound(NULL/empty) must not stop another alert.
    }
    ResetLastError();
    if (PlaySound(filename)) return true;
    RDNotice(purpose + "声音文件无法播放：" + filename + "；请检查终端 Sounds 目录及 WAV 格式。错误 " + IntegerToString(GetLastError()));
    return false;
}

// 1 = reserved; 0 = another event already owns this short sound window;
// -1 = terminal-global-variable error (caller can retry or still alert).
int RDClaimSoundWindow(const string key, const int milliseconds, const bool extend = false)
{
    // Unlike Check()+Set(0), Temp() cannot reset a marker created by a racing
    // chart. Conditional writes then atomically select exactly one owner.
    if (!GlobalVariableTemp(key))
    {
        RDNotice("无法建立共享声音状态，将继续重试。错误 " + IntegerToString(GetLastError()));
        return -1;
    }
    for (int attempt = 0; attempt < 4; attempt++)
    {
        ResetLastError();
        double previous = GlobalVariableGet(key);
        if (GetLastError() != 0) return -1;
        double now = (double)GetTickCount64();
        if (!extend && previous > now) return 0;
        double until = MathMax(previous, now + milliseconds);
        if (GlobalVariableSetOnCondition(key, until, previous)) return 1;
    }
    RDNotice("共享声音状态正忙；本次提示将合并或稍后重试。");
    return -1;
}

// True means that this queued event is fully handled (including a sound merged
// into another recent fill). False keeps it pending for a later timer tick.
bool RDTryDealAlert(const ulong deal)
{
    if (!HistoryDealSelect(deal)) return false;
    long type = HistoryDealGetInteger(deal, DEAL_TYPE);
    if (type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) return true;
    long deal_time = HistoryDealGetInteger(deal, DEAL_TIME_MSC);
    if (RDStartedServerMs > 0 && deal_time > 0 && deal_time < RDStartedServerMs) return true;

    string audio_key = RDAccountKey + "_Audio";
    string deal_key = RDAccountKey + "_D" + StringFormat("%I64u", deal);
    if (!GlobalVariableTemp(audio_key) || !GlobalVariableTemp(deal_key))
    {
        RDNotice("无法保存成交提示去重状态，将继续重试。错误 " + IntegerToString(GetLastError()));
        return false;
    }
    if (!GlobalVariableSetOnCondition(deal_key, 1.0, 0.0))
    {
        ResetLastError();
        double claimed = GlobalVariableGet(deal_key);
        return GetLastError() == 0 && claimed == 1.0;
    }
    // All charts share one 700 ms window. Multiple partial fills/close bursts
    // are one audible event, rather than repeated overlapping playback.
    int sound_slot = RDClaimSoundWindow(audio_key, 700);
    if (sound_slot != 0) RDPlayFile(RDTradeSound, "实际成交");
    return true;
}

void RDOnTransaction(const MqlTradeTransaction &trans, const long magic)
{
    RDSyncAlertAccount();
    // magic intentionally does not filter: the default covers the entire
    // account, including manual closes whose deal magic can differ.
    if (!RDEnableTradeSound || trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal == 0) return;
    if (trans.deal_type != DEAL_TYPE_BUY && trans.deal_type != DEAL_TYPE_SELL) return;
    for (int i = 0; i < ArraySize(RDPendingDeals); i++)
        if (RDPendingDeals[i] == trans.deal) return;
    int count = ArraySize(RDPendingDeals);
    if (ArrayResize(RDPendingDeals, count + 1) != count + 1)
    {
        RDNotice("成交提示队列内存不足，成交记录仍以账户历史为准。");
        return;
    }
    RDPendingDeals[count] = trans.deal;
}

void RDFlushAlerts(const long magic)
{
    RDSyncAlertAccount();
    if (!RDEnableTradeSound)
    {
        ArrayResize(RDPendingDeals, 0);
        RDPendingCursor = 0;
        return;
    }
    int budget = MathMin(ArraySize(RDPendingDeals), 128);
    for (int attempt = 0; attempt < budget && ArraySize(RDPendingDeals) > 0; attempt++)
    {
        int count = ArraySize(RDPendingDeals);
        if (RDPendingCursor >= count) RDPendingCursor = 0;
        if (RDTryDealAlert(RDPendingDeals[RDPendingCursor]))
        {
            for (int i = RDPendingCursor; i < count - 1; i++) RDPendingDeals[i] = RDPendingDeals[i + 1];
            ArrayResize(RDPendingDeals, count - 1);
        }
        else RDPendingCursor++; // An unreadable row must not starve later fills.
    }
}

void RDPlayRiskAlert(const string message)
{
    RDSyncAlertAccount();
    // The risk engine owns persistent once-per-breach/day latching. This short
    // shared guard is additional protection against duplicate chart callbacks.
    string key = RDAccountKey + "_R" + IntegerToString(RDHash(message));
    if (RDClaimSoundWindow(key, 2000) == 0) return;
    RDClaimSoundWindow(RDAccountKey + "_Audio", 2000, true);
    // Alert can have its own terminal-configured sound. Call it first, then
    // request the distinct risk WAV; subsequent forced-close fills are merged
    // for two seconds so their ordinary sound does not replace the risk alarm.
    Alert(message);
    RDPlayFile(RDLossSound, "亏损限额报警");
}
#endif
