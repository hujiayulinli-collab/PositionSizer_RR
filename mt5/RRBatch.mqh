// Sequential market entries; one durable parent owns every child submission.
#ifndef PS_RR_BATCH_MQH
#define PS_RR_BATCH_MQH

bool RBSettingsReady = false;
ulong RBActiveParent = 0;
string RBOwnerAccount = "";
int RBAccountLock = INVALID_HANDLE;
ulong RBLastSendTick = 0;
string RBLastStatus = "分批开仓未启用";
bool RBCorruptJournal = false;

struct RBSettingsRecord
{
    uint version;
    int enabled;
    double child_max;
    int interval;
    int deviation;
    uint checksum;
};

string RBAccountKey()
{
    return IntegerToString(RRHash(AccountInfoString(ACCOUNT_SERVER))) + "_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
}
string RBDirectory() { return "PSRR_Batch\\" + RBAccountKey() + "\\"; }
string RBGroupFile(const ulong parent) { return RBDirectory() + IntegerToString(parent) + ".bin"; }
string RBAccountLockName() { return "PSRR_Settings\\BatchLock_" + RBAccountKey() + ".bin"; }
string RBSettingsFile() { return "PSRR_Settings\\Batch_" + RBAccountKey() + ".bin"; }
string RBGroupSymbol(const RBGroup &group) { return ShortArrayToString(group.symbol); }

bool RBAccountBusy()
{
    if (RBAccountLock != INVALID_HANDLE) return true;
    int handle = FileOpen(RBAccountLockName(), FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE) return true;
    FileClose(handle);
    ulong ids[]; RBCollectGroups(ids);
    for (int i = 0; i < ArraySize(ids); i++)
    {
        RBGroup g; string error;
        if (!RBReadGroup(ids[i], g, error) || g.pending != 0 || g.entry_state == RB_ENTRY_BUILDING) return true;
    }
    return false;
}

uint RBSettingsChecksum(const RBSettingsRecord &s)
{
    return RRHash(IntegerToString(s.version) + "|" + IntegerToString(s.enabled) + "|"
        + DoubleToString(s.child_max, 8) + "|" + IntegerToString(s.interval) + "|" + IntegerToString(s.deviation));
}
bool RBValidSettings(const double child_max, const int interval, const int deviation)
{
    return MathIsValidNumber(child_max) && child_max > 0 && child_max <= 1000000
        && interval >= 1 && interval <= 3600 && deviation >= 0 && deviation <= 100000000;
}
bool RBReadSettings(const int handle, RBSettingsRecord &s)
{
    ulong size = FileSize(handle);
    if (size < sizeof(RBSettingsRecord) || size % sizeof(RBSettingsRecord) != 0) return false;
    if (!FileSeek(handle, (long)(size - sizeof(RBSettingsRecord)), SEEK_SET)
        || FileReadStruct(handle, s) != sizeof(RBSettingsRecord)) return false;
    return s.version == 1 && (s.enabled == 0 || s.enabled == 1)
        && RBValidSettings(s.child_max, s.interval, s.deviation) && s.checksum == RBSettingsChecksum(s);
}
bool RBLoadSettings()
{
    RBSettingsReady = false;
    if (!FileIsExist(RBSettingsFile()))
    {
        RBEnabled = false; RBChildMaxLots = 5; RBIntervalSeconds = 1; RBMaxDeviationPoints = 0;
        RBSettingsReady = true; return true;
    }
    int handle = FileOpen(RBSettingsFile(), FILE_READ | FILE_BIN);
    if (handle == INVALID_HANDLE) return false;
    RBSettingsRecord s;
    bool ok = RBReadSettings(handle, s);
    FileClose(handle);
    if (!ok) return false;
    RBEnabled = s.enabled != 0; RBChildMaxLots = s.child_max;
    RBIntervalSeconds = s.interval; RBMaxDeviationPoints = s.deviation;
    RBSettingsReady = true;
    return true;
}
bool RBSaveSettings(bool enabled, double child_max, int interval, int deviation, string &error)
{
    error = "";
    if (!RBValidSettings(child_max, interval, deviation))
    { error = "每个子单手数须大于 0；间隔为 1–3600 秒，偏离点数不能为负。"; return false; }
    if (RBAccountBusy()) { error = "账户正在分批建仓，请先取消后续子单再修改。"; return false; }
    int handle = FileOpen(RBSettingsFile(), FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE) { error = "分批设置正被使用，稍后重试。"; return false; }
    RBSettingsRecord s;
    if (FileSize(handle) > 0 && !RBReadSettings(handle, s))
    { FileClose(handle); error = "分批设置校验失败，未覆盖原记录。"; return false; }
    ZeroMemory(s); s.version = 1; s.enabled = (int)enabled; s.child_max = child_max;
    s.interval = interval; s.deviation = deviation; s.checksum = RBSettingsChecksum(s);
    ResetLastError();
    bool ok = FileSeek(handle, 0, SEEK_END) && FileWriteStruct(handle, s) == sizeof(RBSettingsRecord);
    FileFlush(handle); ok = ok && GetLastError() == 0;
    RBSettingsRecord verified;
    ok = ok && RBReadSettings(handle, verified) && verified.checksum == s.checksum;
    FileClose(handle);
    if (!ok) { RBSettingsReady = false; error = "分批设置写入未确认，暂停新开仓。"; return false; }
    RBEnabled = enabled; RBChildMaxLots = child_max; RBIntervalSeconds = interval; RBMaxDeviationPoints = deviation;
    RBSettingsReady = true;
    return true;
}

uint RBGroupChecksum(const RBGroup &g)
{
    string value = StringFormat("%u|%I64u|%I64d|%u|%I64d|%d|", g.version, g.parent_id, g.account, g.server_hash, g.magic, g.direction);
    for (int i = 0; i < 64; i++) value += IntegerToString(g.symbol[i]) + ",";
    value += "|" + DoubleToString(g.planned_volume, 16) + "|" + DoubleToString(g.risk_budget, 16)
        + "|" + DoubleToString(g.stop_loss, 16) + "|" + DoubleToString(g.reference_price, 16)
        + "|" + DoubleToString(g.child_max_lots, 16) + "|" + IntegerToString(g.interval_seconds)
        + "|" + IntegerToString(g.max_deviation_points) + "|" + DoubleToString(g.commission_per_lot, 16)
        + "|" + IntegerToString(g.max_spread_points) + "|" + IntegerToString(g.slippage_points) + "|" + IntegerToString(g.close_opposite)
        + "|" + IntegerToString(g.max_trades_total) + "|" + IntegerToString(g.max_trades_symbol)
        + "|" + DoubleToString(g.max_volume_total, 16) + "|" + DoubleToString(g.max_volume_symbol, 16)
        + "|" + DoubleToString(g.max_risk_total_money, 16) + "|" + DoubleToString(g.max_risk_symbol_money, 16)
        + "|" + IntegerToString(g.created) + "|" + IntegerToString(g.child_count);
    for (int i = 0; i < RB_MAX_CHILDREN; i++)
        value += "|" + IntegerToString(g.child_id[i]) + "|" + IntegerToString(g.child_order[i])
            + "|" + DoubleToString(g.child_volume[i], 16) + "|" + DoubleToString(g.child_price[i], 16);
    value += "|" + IntegerToString(g.entry_state) + "|" + IntegerToString(g.pending) + "|" + IntegerToString(g.pending_index)
        + "|" + IntegerToString(g.pending_order) + "|" + DoubleToString(g.pending_volume, 16)
        + "|" + IntegerToString(g.last_request) + "|" + DoubleToString(g.filled_volume, 16)
        + "|" + DoubleToString(g.filled_value, 16) + "|" + DoubleToString(g.used_risk, 16)
        + "|" + IntegerToString(RRChecksum(g.exit_state)) + "|" + IntegerToString(g.exit_ready)
        + "|" + IntegerToString(g.manual_active) + "|" + DoubleToString(g.manual_target_remaining, 16)
        + "|" + IntegerToString(g.manual_created) + "|" + IntegerToString(g.manual_completed)
        + "|" + IntegerToString(g.risk_latched) + "|" + IntegerToString(g.sequence);
    return RRHash(value);
}
int RBLockGroup(ulong parent)
{
    if (parent == 0) return INVALID_HANDLE;
    return FileOpen(RBGroupFile(parent), FILE_READ | FILE_WRITE | FILE_BIN);
}
bool RBLoadGroup(int handle, RBGroup &g)
{
    ulong size = FileSize(handle);
    if (size < sizeof(RBGroup) || size % sizeof(RBGroup) != 0) return false;
    if (!FileSeek(handle, (long)(size - sizeof(RBGroup)), SEEK_SET) || FileReadStruct(handle, g) != sizeof(RBGroup)) return false;
    if (g.version != 1 || g.parent_id == 0 || g.account != AccountInfoInteger(ACCOUNT_LOGIN)
        || g.server_hash != RRHash(AccountInfoString(ACCOUNT_SERVER)) || g.checksum != RBGroupChecksum(g)
        || (g.direction != 1 && g.direction != -1) || g.symbol[63] != 0 || RBGroupSymbol(g) == ""
        || g.child_count < 0 || g.child_count > RB_MAX_CHILDREN || g.entry_state < 0 || g.entry_state > 3
        || (g.pending != 0 && g.pending != 1) || (g.exit_ready != 0 && g.exit_ready != 1)
        || (g.manual_active != 0 && g.manual_active != 1) || (g.risk_latched != 0 && g.risk_latched != 1)
        || !MathIsValidNumber(g.planned_volume) || g.planned_volume <= 0
        || !MathIsValidNumber(g.risk_budget) || g.risk_budget <= 0
        || !MathIsValidNumber(g.stop_loss) || g.stop_loss <= 0
        || !MathIsValidNumber(g.reference_price) || g.reference_price <= 0
        || !RBValidSettings(g.child_max_lots, g.interval_seconds, g.max_deviation_points)
        || !MathIsValidNumber(g.commission_per_lot) || g.commission_per_lot < 0
        || !MathIsValidNumber(g.filled_volume) || g.filled_volume < 0
        || !MathIsValidNumber(g.filled_value) || g.filled_value < 0
        || !MathIsValidNumber(g.used_risk) || g.used_risk < 0
        || !MathIsValidNumber(g.manual_target_remaining) || g.manual_target_remaining < 0
        || g.sequence < 0 || g.pending_index < 0 || g.pending_index >= RB_MAX_CHILDREN
        || g.slippage_points < 0 || g.max_spread_points < 0
        || (g.close_opposite != 0 && g.close_opposite != 1)
        || g.exit_state.stage < 0 || g.exit_state.stage > g.exit_state.target_count
        || (g.exit_state.blocked != 0 && g.exit_state.blocked != 1)
        || (g.exit_state.be_requested != 0 && g.exit_state.be_requested != 1)
        || (g.exit_state.be_done != 0 && g.exit_state.be_done != 1)
        || g.exit_state.offset_points < 0 || g.exit_state.offset_points > 100000000
        || (g.manual_active != 0 && g.manual_target_remaining >= g.filled_volume)
        || !MathIsValidNumber(g.pending_volume) || g.pending_volume < 0
        || (g.pending != 0 && (g.pending_volume <= 0 || g.child_count >= RB_MAX_CHILDREN || g.pending_index != g.child_count))
        || g.filled_volume > g.planned_volume + 1e-7) return false;
    double sum = 0, value = 0;
    for (int i = 0; i < g.child_count; i++)
    {
        if (g.child_id[i] == 0 || g.child_order[i] == 0 || !MathIsValidNumber(g.child_volume[i]) || g.child_volume[i] <= 0
            || !MathIsValidNumber(g.child_price[i]) || g.child_price[i] <= 0) return false;
        for (int j = 0; j < i; j++) if (g.child_id[i] == g.child_id[j]) return false;
        sum += g.child_volume[i]; value += g.child_volume[i] * g.child_price[i];
    }
    if (MathAbs(sum - g.filled_volume) > 1e-7 || MathAbs(value - g.filled_value) > MathMax(1e-7, value * 1e-12)) return false;
    if (g.exit_ready != 0 && (g.pending != 0 || g.entry_state == 0 || g.exit_state.version != 2
        || g.exit_state.initial_volume != g.filled_volume || g.exit_state.entry <= 0 || g.exit_state.risk <= 0)) return false;
    RRPlan plan;
    ZeroMemory(plan); plan.count = g.exit_state.target_count;
    if (plan.count < 1 || plan.count > RR_MAX_TARGETS) return false;
    for (int i = 0; i < plan.count; i++)
    { plan.targets[i].multiple = g.exit_state.target_r[i]; plan.targets[i].percent = g.exit_state.target_percent[i]; plan.targets[i].move_be = g.exit_state.target_be[i]; }
    string error;
    return RRPlanValidate(plan, error);
}
bool RBSaveGroup(int handle, RBGroup &g)
{
    g.sequence++; g.checksum = RBGroupChecksum(g);
    ResetLastError();
    bool ok = FileSeek(handle, 0, SEEK_END) && FileWriteStruct(handle, g) == sizeof(RBGroup);
    FileFlush(handle); ok = ok && GetLastError() == 0;
    if (!ok) { RBCorruptJournal = true; RBLastStatus = "父订单记录写入未确认，已停止后续下单；请核对成交记录。"; }
    return ok;
}
bool RBReadGroup(ulong parent, RBGroup &g, string &error)
{
    error = "";
    int handle = FileOpen(RBGroupFile(parent), FILE_READ | FILE_BIN);
    if (handle == INVALID_HANDLE) { error = "父订单记录正在使用或无法读取。"; return false; }
    bool ok = RBLoadGroup(handle, g) && g.parent_id == parent;
    FileClose(handle);
    if (!ok) error = "父订单记录校验失败，停止自动操作。";
    return ok;
}
int RBCollectGroups(ulong &ids[])
{
    ArrayResize(ids, 0);
    string file;
    long search = FileFindFirst(RBDirectory() + "*.bin", file);
    if (search == INVALID_HANDLE) return 0;
    do
    {
        int dot = StringFind(file, ".bin");
        if (dot <= 0) continue;
        ulong parent = (ulong)StringToInteger(StringSubstr(file, 0, dot));
        if (parent == 0) continue;
        // Include locked records in discovery; the caller waits for its lock.
        int n = ArraySize(ids); ArrayResize(ids, n + 1); ids[n] = parent;
    } while (FileFindNext(search, file));
    FileFindClose(search);
    return ArraySize(ids);
}

string RBChildComment(const RBGroup &g, const int index)
{
    return StringFormat("RB%I64X-%02X", g.parent_id, index + 1);
}
ulong RBCommentParent(const string comment)
{
    if (StringSubstr(comment, 0, 2) != "RB") return 0;
    int dash = StringFind(comment, "-", 2);
    if (dash < 3 || dash > 18 || StringLen(comment) != dash + 3) return 0;
    ulong id = 0;
    for (int i = 2; i < dash; i++)
    {
        ushort c = StringGetCharacter(comment, i);
        int n = c >= '0' && c <= '9' ? c - '0' : (c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1);
        if (n < 0) return 0;
        id = id * 16 + n;
    }
    return id;
}
ulong RBPositionParent(ulong identifier)
{
    if (identifier == 0) return 0;
    ulong ids[]; RBCollectGroups(ids);
    for (int i = 0; i < ArraySize(ids); i++)
    {
        RBGroup g; string error;
        if (!RBReadGroup(ids[i], g, error)) continue;
        for (int j = 0; j < g.child_count; j++) if (g.child_id[j] == identifier) return g.parent_id;
        if (g.pending != 0 && RMSelectIdentifier(identifier) != 0
            && PositionGetString(POSITION_SYMBOL) == RBGroupSymbol(g) && PositionGetInteger(POSITION_MAGIC) == g.magic
            && PositionGetString(POSITION_COMMENT) == RBChildComment(g, g.pending_index)) return g.parent_id;
    }
    return 0;
}
bool RBIsChild(ulong identifier)
{
    if (RBPositionParent(identifier) != 0) return true;
    // A busy/torn *local account* parent must fail closed. A copied comment in
    // another account has no matching journal and is never adopted here.
    if (RMSelectIdentifier(identifier) == 0) return false;
    ulong parent = RBCommentParent(PositionGetString(POSITION_COMMENT));
    return parent != 0 && FileIsExist(RBGroupFile(parent));
}
bool RBGroupBuilding(ulong parent)
{
    RBGroup g; string error;
    return !RBReadGroup(parent, g, error) || g.entry_state == RB_ENTRY_BUILDING || g.pending != 0;
}
bool RBEntryActive() { return RBActiveParent != 0; }
string RBStatusText() { return RBLastStatus; }

bool RBFreezeExit(RBGroup &g)
{
    if (g.exit_ready != 0) return true;
    if (g.entry_state == RB_ENTRY_BUILDING || g.pending != 0 || g.filled_volume <= 0) return false;
    g.exit_state.entry = g.filled_value / g.filled_volume;
    g.exit_state.risk = g.direction * (g.exit_state.entry - g.stop_loss);
    if (!MathIsValidNumber(g.exit_state.risk) || g.exit_state.risk <= 0) return false;
    g.exit_state.initial_volume = g.filled_volume;
    g.exit_state.opening_order = g.child_count > 0 ? g.child_order[0] : 0;
    g.exit_ready = 1;
    return true;
}
void RBStopGroupEntry(RBGroup &g)
{
    if (g.entry_state == RB_ENTRY_BUILDING) g.entry_state = RB_ENTRY_CANCELLED;
    RBFreezeExit(g);
}
void RBReleaseOwner()
{
    RBActiveParent = 0;
    RBOwnerAccount = "";
    if (RBAccountLock != INVALID_HANDLE) { FileClose(RBAccountLock); RBAccountLock = INVALID_HANDLE; }
    RCTradeLeave();
}
void RBCancelEntry()
{
    if (RBActiveParent == 0) return;
    // On account-change deinitialization the terminal may already report the
    // new login. Never create the old parent's filename in that new namespace.
    if (RBOwnerAccount != RBAccountKey()) { RBReleaseOwner(); return; }
    int handle = RBLockGroup(RBActiveParent);
    if (handle == INVALID_HANDLE) { RBLastStatus = "父订单正在处理，稍后重试取消。"; return; }
    RBGroup g;
    if (!RBLoadGroup(handle, g)) { RBCorruptJournal = true; FileClose(handle); RBReleaseOwner(); return; }
    RBStopGroupEntry(g);
    RBSaveGroup(handle, g);
    RBLastStatus = "父 #" + IntegerToString(g.parent_id) + " 已取消后续开仓；已有子单继续受保护。";
    FileClose(handle);
    RBReleaseOwner();
}

double RBNextVolume(const double planned, const double filled, const double budget, const double used,
                    const double per_lot_risk, const double child_cap, const double broker_cap,
                    const double minimum, const double step)
{
    if (!MathIsValidNumber(planned) || !MathIsValidNumber(filled) || !MathIsValidNumber(budget)
        || !MathIsValidNumber(used) || !MathIsValidNumber(per_lot_risk) || !MathIsValidNumber(child_cap)
        || !MathIsValidNumber(broker_cap) || !MathIsValidNumber(minimum) || !MathIsValidNumber(step)
        || planned <= filled || filled < 0 || budget <= used || used < 0 || per_lot_risk <= 0
        || child_cap <= 0 || broker_cap <= 0 || minimum <= 0 || step <= 0) return 0;
    double volume = MathMin(MathMin(planned - filled, (budget - used) / per_lot_risk), MathMin(child_cap, broker_cap));
    volume = NormalizeDouble(MathFloor(volume / step + 1e-8) * step, 8);
    // Tolerance only absorbs representation noise; it never permits one extra step.
    if (volume < minimum - step * 1e-7 || volume > planned - filled + step * 1e-7
        || volume * per_lot_risk > budget - used + 1e-7) return 0;
    return volume;
}
bool RBSpacingReady(const ulong now, const ulong previous, const int seconds)
{
    return previous == 0 || (now >= previous && now - previous >= (ulong)seconds * 1000);
}
bool RBRiskAtSL(const RBGroup &g, const double volume, const double price, double &money)
{
    money = 0;
    double profit = 0;
    if (!MathIsValidNumber(volume) || volume <= 0 || !MathIsValidNumber(price) || price <= 0
        || g.direction * (price - g.stop_loss) <= 0
        || !OrderCalcProfit(g.direction == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, RBGroupSymbol(g), volume, price, g.stop_loss, profit)
        || !MathIsValidNumber(profit)) return false;
    money = MathMax(0, -profit) + g.commission_per_lot * volume;
    return MathIsValidNumber(money) && money > 0;
}

int RBDirectionForOrder(const long type)
{
    if (type == ORDER_TYPE_BUY || type == ORDER_TYPE_BUY_LIMIT || type == ORDER_TYPE_BUY_STOP || type == ORDER_TYPE_BUY_STOP_LIMIT) return 1;
    if (type == ORDER_TYPE_SELL || type == ORDER_TYPE_SELL_LIMIT || type == ORDER_TYPE_SELL_STOP || type == ORDER_TYPE_SELL_STOP_LIMIT) return -1;
    return 0;
}
// Count actual account exposure, including pending orders and manual positions.
// Re-evaluate each child; a different chart/copy program may change it mid-batch.
bool RBCheckExposure(const RBGroup &g, const double volume, const double added_risk, string &error)
{
    string symbol = RBGroupSymbol(g);
    int count = 0, symbol_count = 0;
    double total = 0, symbol_total = 0, direction_total = 0, risk_total = 0, risk_symbol = 0;
    bool risk_unknown = false;
    for (int pass = 0; pass < 2; pass++)
    {
        int n = pass == 0 ? PositionsTotal() : OrdersTotal();
        for (int i = 0; i < n; i++)
        {
            ulong ticket = pass == 0 ? PositionGetTicket(i) : OrderGetTicket(i);
            if (ticket == 0) continue;
            string item_symbol = pass == 0 ? PositionGetString(POSITION_SYMBOL) : OrderGetString(ORDER_SYMBOL);
            double lots = pass == 0 ? PositionGetDouble(POSITION_VOLUME) : OrderGetDouble(ORDER_VOLUME_CURRENT);
            double sl = pass == 0 ? PositionGetDouble(POSITION_SL) : OrderGetDouble(ORDER_SL);
            double price = pass == 0 ? PositionGetDouble(POSITION_PRICE_OPEN) : OrderGetDouble(ORDER_PRICE_OPEN);
            int direction = pass == 0 ? (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1)
                : RBDirectionForOrder(OrderGetInteger(ORDER_TYPE));
            bool same = item_symbol == symbol;
            count++; total += lots;
            if (same)
            {
                symbol_count++; symbol_total += lots;
                if (direction == g.direction) direction_total += lots;
                if (g.close_opposite != 0 && direction != 0 && direction != g.direction)
                { error = "出现同品种反向仓或反向挂单，停止后续子单。"; return false; }
            }
            if (g.max_risk_total_money > 0 || (same && g.max_risk_symbol_money > 0))
            {
                double profit = 0;
                if (sl <= 0 || price <= 0 || direction == 0
                    || !OrderCalcProfit(direction == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, item_symbol, lots, price, sl, profit)
                    || !MathIsValidNumber(profit)) risk_unknown = true;
                else { double risk = MathMax(0, -profit); risk_total += risk; if (same) risk_symbol += risk; }
            }
        }
    }
    double broker_limit = SymbolInfoDouble(symbol, SYMBOL_VOLUME_LIMIT);
    if ((g.max_trades_total > 0 && count + 1 > g.max_trades_total)
        || (g.max_trades_symbol > 0 && symbol_count + 1 > g.max_trades_symbol))
    { error = "已达到账户/品种持仓数量上限，停止后续子单。"; return false; }
    if ((g.max_volume_total > 0 && total + volume > g.max_volume_total + 1e-8)
        || (g.max_volume_symbol > 0 && symbol_total + volume > g.max_volume_symbol + 1e-8)
        || (broker_limit > 0 && direction_total + volume > broker_limit + 1e-8))
    { error = "已达到账户/品种累计手数上限，不能用拆单绕过。"; return false; }
    if (risk_unknown || (g.max_risk_total_money > 0 && risk_total + added_risk > g.max_risk_total_money + 1e-7)
        || (g.max_risk_symbol_money > 0 && risk_symbol + added_risk > g.max_risk_symbol_money + 1e-7))
    { error = "当前持仓风险无法确认或超过账户/品种风险上限。"; return false; }
    return true;
}

bool RBExistingChildrenSafe(const RBGroup &g, string &error)
{
    string symbol = RBGroupSymbol(g);
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    for (int i = 0; i < g.child_count; i++)
    {
        if (RMSelectIdentifier(g.child_id[i]) == 0)
        { error = "已有子单离场，停止补开剩余子单。"; return false; }
        if (PositionGetString(POSITION_SYMBOL) != symbol || PositionGetInteger(POSITION_MAGIC) != g.magic
            || (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1) != g.direction
            || MathAbs(PositionGetDouble(POSITION_VOLUME) - g.child_volume[i]) > step * 1e-6
            || RMPositionExitActive(g.child_id[i]) || RGPositionExitLatched(g.child_id[i]))
        { error = "已有子单被减仓或正被平仓，停止后续子单。"; return false; }
        double sl = PositionGetDouble(POSITION_SL);
        if (sl <= 0 || g.direction * (sl - g.stop_loss) < -tick_size * 0.1)
        { error = "已有子单止损缺失或被放宽，停止后续子单。"; return false; }
    }
    return true;
}

// Resolve exactly one persisted intent. A missing/unknown reply is NEVER resent.
bool RBResolvePending(RBGroup &g, string &error)
{
    if (g.pending == 0) return true;
    error = "等待子单成交与止损确认";
    ulong order = g.pending_order;
    string symbol = RBGroupSymbol(g), comment = RBChildComment(g, g.pending_index);
    if (!HistorySelect((datetime)MathMax(0, g.created - 60), TimeCurrent() + 60)) return false;
    if (order == 0)
    {
        for (int i = 0; i < OrdersTotal(); i++)
        {
            ulong candidate = OrderGetTicket(i);
            if (candidate != 0 && OrderGetString(ORDER_SYMBOL) == symbol && OrderGetInteger(ORDER_MAGIC) == g.magic
                && OrderGetString(ORDER_COMMENT) == comment)
            { if (order != 0 && order != candidate) { error = "子单匹配到多个订单，需人工核对。"; return false; } order = candidate; }
        }
        for (int i = 0; i < HistoryOrdersTotal(); i++)
        {
            ulong candidate = HistoryOrderGetTicket(i);
            if (HistoryOrderGetString(candidate, ORDER_SYMBOL) == symbol && HistoryOrderGetInteger(candidate, ORDER_MAGIC) == g.magic
                && HistoryOrderGetString(candidate, ORDER_COMMENT) == comment)
            { if (order != 0 && order != candidate) { error = "子单匹配到多个历史订单，需人工核对。"; return false; } order = candidate; }
        }
    }
    if (order == 0) { error = "子单结果尚未确认；不会重复发送，请核对订单历史。"; return false; }
    g.pending_order = order;
    if (OrderSelect(order) || !HistoryOrderSelect(order)) return false;
    long state = HistoryOrderGetInteger(order, ORDER_STATE);
    if (state != ORDER_STATE_FILLED && state != ORDER_STATE_CANCELED && state != ORDER_STATE_REJECTED && state != ORDER_STATE_EXPIRED) return false;
    if (HistoryOrderGetString(order, ORDER_SYMBOL) != symbol || HistoryOrderGetInteger(order, ORDER_MAGIC) != g.magic
        || RBDirectionForOrder(HistoryOrderGetInteger(order, ORDER_TYPE)) != g.direction)
    { error = "成交订单身份不符，停止自动续开。"; return false; }
    // HistoryOrderSelect resets only the order list; refresh the whole deal list.
    if (!HistorySelect((datetime)MathMax(0, g.created - 60), TimeCurrent() + 60)) return false;
    double volume = 0, value = 0, entry_cost = 0; ulong identifier = 0;
    for (int i = 0; i < HistoryDealsTotal(); i++)
    {
        ulong deal = HistoryDealGetTicket(i);
        if ((ulong)HistoryDealGetInteger(deal, DEAL_ORDER) != order) continue;
        long type = HistoryDealGetInteger(deal, DEAL_TYPE);
        if (type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
        ulong id = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
        if (HistoryDealGetInteger(deal, DEAL_ENTRY) != DEAL_ENTRY_IN || (type == DEAL_TYPE_BUY ? 1 : -1) != g.direction
            || id == 0 || (identifier != 0 && identifier != id))
        { error = "子单存在混合成交，停止自动续开。"; return false; }
        identifier = id;
        double lots = HistoryDealGetDouble(deal, DEAL_VOLUME), price = HistoryDealGetDouble(deal, DEAL_PRICE);
        if (!MathIsValidNumber(lots) || lots <= 0 || !MathIsValidNumber(price) || price <= 0) return false;
        double fee = HistoryDealGetDouble(deal, DEAL_COMMISSION) + HistoryDealGetDouble(deal, DEAL_FEE);
        if (!MathIsValidNumber(fee)) return false;
        entry_cost += MathMax(0, -fee);
        volume += lots; value += lots * price;
    }
    double initial = HistoryOrderGetDouble(order, ORDER_VOLUME_INITIAL), remaining = HistoryOrderGetDouble(order, ORDER_VOLUME_CURRENT);
    double expected = initial - remaining, step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    if (state == ORDER_STATE_FILLED) expected = initial;
    if (step <= 0 || MathAbs(expected - volume) > step * 1e-6 || volume > g.pending_volume + step * 1e-6) return false;
    if (volume == 0)
    {
        g.pending = 0; g.entry_state = RB_ENTRY_STOPPED;
        error = "子单未成交，已停止后续开仓。"; RBFreezeExit(g); return true;
    }
    int index = g.child_count;
    if (index >= RB_MAX_CHILDREN || index != g.pending_index) return false;
    double risk = 0;
    if (!RBRiskAtSL(g, volume, value / volume, risk)) { error = "无法计算实际成交风险，等待核对。"; return false; }
    // Do not let a commission estimate hide a larger charged opening fee.
    risk += MathMax(0, entry_cost - g.commission_per_lot * volume / 2);
    g.child_id[index] = identifier; g.child_order[index] = order;
    g.child_volume[index] = volume; g.child_price[index] = value / volume;
    g.child_count++; g.filled_volume += volume; g.filled_value += value; g.used_risk += risk;
    g.pending = 0; g.pending_order = 0; g.pending_volume = 0;
    if (!RBExistingChildrenSafe(g, error)) g.entry_state = RB_ENTRY_STOPPED;
    if (g.used_risk >= g.risk_budget - 1e-7 || g.filled_volume >= g.planned_volume - step * 1e-6)
        g.entry_state = g.entry_state == RB_ENTRY_BUILDING ? RB_ENTRY_COMPLETE : g.entry_state;
    RBFreezeExit(g);
    return true;
}

bool RBQueue(double total_volume, string &error)
{
    error = "";
    if (!RBLoadSettings() || !RBSettingsReady || !RBEnabled) { error = "分批设置无效或未启用。"; return false; }
    if (RBEntryActive() || RBCorruptJournal) { error = "已有建仓任务或记录异常，请先核对。"; return false; }
    if (!RR_Enable || sets.EntryType != Instant || AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING
        || sets.DoNotApplyStopLoss || sets.TakeProfitsNumber != 1)
    { error = "分批父订单仅支持开启分仓止盈的对冲账户市价单，并须带止损。"; return false; }
    if (!RRCanTrade() || !RGCanOpen(sets.MagicNumber)) { error = "当前交易权限或亏损保护不允许开仓。"; return false; }
    string symbol = SymbolForTrading;
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN), step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double maximum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX), tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    if (!MathIsValidNumber(total_volume) || total_volume < minimum || minimum <= 0 || step <= 0 || maximum < minimum
        || tick_size <= 0 || StringLen(symbol) > 63 || RBChildMaxLots < minimum
        || MathAbs(total_volume / step - MathRound(total_volume / step)) > 1e-6)
    { error = "计划手数或子单上限不符合该品种最小手数/步进。"; return false; }
    double cap = MathFloor(MathMin(maximum, RBChildMaxLots) / step + 1e-8) * step;
    if (cap < minimum || MathCeil(total_volume / cap - 1e-8) > RB_MAX_CHILDREN)
    { error = "单组最多 64 个子单，请提高子单上限或减少总手数。"; return false; }
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask <= tick.bid || tick.time <= 0)
    { error = "当前报价无效。"; return false; }
    RBGroup g; ZeroMemory(g);
    g.version = 1; g.account = AccountInfoInteger(ACCOUNT_LOGIN); g.server_hash = RRHash(AccountInfoString(ACCOUNT_SERVER));
    g.magic = sets.MagicNumber; g.direction = sets.TradeDirection == Long ? 1 : -1;
    StringToShortArray(symbol, g.symbol, 0, 63); g.symbol[63] = 0;
    g.planned_volume = total_volume; g.risk_budget = RiskMoney;
    g.stop_loss = sets.StopLossLevel; g.reference_price = g.direction == 1 ? tick.ask : tick.bid;
    g.child_max_lots = RBChildMaxLots; g.interval_seconds = RBIntervalSeconds; g.max_deviation_points = RBMaxDeviationPoints;
    g.commission_per_lot = CalculateCommission() * 2;
    g.max_spread_points = sets.MaxSpread; g.slippage_points = (int)MathMax(0, sets.MaxSlippage); g.close_opposite = (int)RCCloseOpposite;
    g.max_trades_total = sets.MaxNumberOfTradesTotal; g.max_trades_symbol = sets.MaxNumberOfTradesPerSymbol;
    g.max_volume_total = sets.MaxPositionSizeTotal; g.max_volume_symbol = sets.MaxPositionSizePerSymbol;
    g.max_risk_total_money = AccSize * sets.MaxRiskTotal / 100; g.max_risk_symbol_money = AccSize * sets.MaxRiskPerSymbol / 100;
    g.created = (long)TimeCurrent();
    if (!MathIsValidNumber(g.risk_budget) || g.risk_budget <= 0 || !MathIsValidNumber(g.stop_loss) || g.stop_loss <= 0
        || !MathIsValidNumber(g.commission_per_lot) || g.commission_per_lot < 0
        || g.direction * (g.reference_price - g.stop_loss) <= 0
        || MathAbs(g.stop_loss / tick_size - MathRound(g.stop_loss / tick_size)) > 1e-5)
    { error = "整组风险预算或止损价无效，请检查主页面。"; return false; }
    double initial_risk = 0;
    if (!RBRiskAtSL(g, total_volume, g.reference_price, initial_risk) || !RBCheckExposure(g, total_volume, initial_risk, error)) return false;
    RBAccountLock = FileOpen(RBAccountLockName(), FILE_READ | FILE_WRITE | FILE_BIN);
    if (RBAccountLock == INVALID_HANDLE) { error = "账户已有另一个分批开仓任务。"; return false; }
    // Reject unresolved historical intents even when their original owner exited.
    ulong previous[]; RBCollectGroups(previous);
    for (int i = 0; i < ArraySize(previous); i++)
    {
        RBGroup old; string message;
        if (!RBReadGroup(previous[i], old, message) || old.pending != 0 || old.entry_state == RB_ENTRY_BUILDING)
        { error = "之前的父订单尚未结清/确认，请先核对成交。"; RBReleaseOwner(); return false; }
    }
    g.parent_id = (ulong)TimeLocal() * 1000000 + GetTickCount64() % 1000000;
    while (FileIsExist(RBGroupFile(g.parent_id))) g.parent_id++;
    g.exit_state.version = 2; g.exit_state.identifier = g.parent_id; g.exit_state.magic = g.magic; g.exit_state.direction = g.direction;
    g.exit_state.target_count = RRActivePlan.count; g.exit_state.offset_points = RR_BEOffsetPoints;
    for (int i = 0; i < RRActivePlan.count; i++)
    {
        g.exit_state.target_r[i] = RRActivePlan.targets[i].multiple;
        g.exit_state.target_percent[i] = RRActivePlan.targets[i].percent;
        g.exit_state.target_be[i] = RRActivePlan.targets[i].move_be;
    }
    g.exit_state.first_r = g.exit_state.target_r[0]; g.exit_state.final_r = g.exit_state.target_r[g.exit_state.target_count - 1];
    g.exit_state.percent = g.exit_state.target_percent[0]; g.exit_state.move_be = g.exit_state.target_be[0];
    if (!RCReserveEntryVolume(total_volume)) { error = "计划总量超过已确认反向开仓预算。"; RBReleaseOwner(); return false; }
    int handle = RBLockGroup(g.parent_id);
    if (handle == INVALID_HANDLE) { error = "无法建立父订单记录，未发送子单。"; RBReleaseOwner(); return false; }
    bool ok = RBSaveGroup(handle, g); FileClose(handle);
    if (!ok) { error = "父订单记录保存未确认，未发送子单。"; RBReleaseOwner(); return false; }
    RBActiveParent = g.parent_id; RBOwnerAccount = RBAccountKey(); RBLastSendTick = 0;
    RBLastStatus = "父 #" + IntegerToString(g.parent_id) + " 已登记；计划 " + DoubleToString(g.planned_volume, 2) + " 手，每单≤" + DoubleToString(g.child_max_lots, 2) + " 手。";
    Print("[PS RR Batch] ", RBLastStatus);
    return true;
}

bool RBDefiniteEntryReject(const uint code)
{
    // MetaQuotes trade-server return codes. TIMEOUT, CONNECTION, ERROR and
    // LOCKED are intentionally absent: they require historical reconciliation.
    // https://www.mql5.com/en/docs/constants/errorswarnings/enum_trade_return_codes
    return code == TRADE_RETCODE_REQUOTE || code == TRADE_RETCODE_REJECT || code == TRADE_RETCODE_CANCEL
        || code == TRADE_RETCODE_INVALID || code == TRADE_RETCODE_INVALID_VOLUME || code == TRADE_RETCODE_INVALID_PRICE
        || code == TRADE_RETCODE_INVALID_STOPS || code == TRADE_RETCODE_TRADE_DISABLED || code == TRADE_RETCODE_MARKET_CLOSED
        || code == TRADE_RETCODE_NO_MONEY || code == TRADE_RETCODE_PRICE_CHANGED || code == TRADE_RETCODE_PRICE_OFF
        || code == TRADE_RETCODE_INVALID_EXPIRATION || code == TRADE_RETCODE_TOO_MANY_REQUESTS
        || code == TRADE_RETCODE_SERVER_DISABLES_AT || code == TRADE_RETCODE_CLIENT_DISABLES_AT
        || code == TRADE_RETCODE_INVALID_FILL || code == TRADE_RETCODE_ONLY_REAL || code == TRADE_RETCODE_LIMIT_ORDERS
        || code == TRADE_RETCODE_LIMIT_VOLUME || code == TRADE_RETCODE_INVALID_ORDER || code == TRADE_RETCODE_LIMIT_POSITIONS
        || code == TRADE_RETCODE_LONG_ONLY || code == TRADE_RETCODE_SHORT_ONLY || code == TRADE_RETCODE_CLOSE_ONLY
        || code == TRADE_RETCODE_HEDGE_PROHIBITED;
}

bool RBSendNext(const int handle, RBGroup &g, string &error)
{
    string symbol = RBGroupSymbol(g);
    if (g.entry_state != RB_ENTRY_BUILDING || g.pending != 0 || g.risk_latched != 0) return false;
    if (!RBExistingChildrenSafe(g, error)) return false;
    if (g.child_count >= RB_MAX_CHILDREN) { error = "已达到 64 个子单上限。"; return false; }
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask <= tick.bid || tick.time <= 0
        || TimeCurrent() - tick.time > 15) { error = "报价过期或无效，停止后续子单。"; return false; }
    double point = SymbolInfoDouble(symbol, SYMBOL_POINT), minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), maximum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    double price = g.direction == 1 ? tick.ask : tick.bid;
    if (point <= 0 || (g.max_spread_points > 0 && (tick.ask - tick.bid) / point > g.max_spread_points + 1e-7))
    { error = "点差超过设置上限，停止后续子单。"; return false; }
    if (g.max_deviation_points > 0 && g.direction * (price - g.reference_price) > g.max_deviation_points * point + point * 1e-7)
    { error = "入场价已向不利方向偏离上限，停止后续子单。"; return false; }
    double unit_risk = 0;
    if (!RBRiskAtSL(g, 1, price, unit_risk)) { error = "当前价到止损风险无法确认。"; return false; }
    double volume = RBNextVolume(g.planned_volume, g.filled_volume, g.risk_budget, g.used_risk,
        unit_risk, g.child_max_lots, maximum, minimum, step);
    if (volume <= 0) { g.entry_state = RB_ENTRY_COMPLETE; error = "剩余预算/手数不足一个合法子单，建仓结束。"; return false; }
    if (!RBCheckExposure(g, volume, volume * unit_risk, error)) return false;
    long mode = SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
    if (mode == SYMBOL_TRADE_MODE_DISABLED || mode == SYMBOL_TRADE_MODE_CLOSEONLY
        || (mode == SYMBOL_TRADE_MODE_LONGONLY && g.direction == -1) || (mode == SYMBOL_TRADE_MODE_SHORTONLY && g.direction == 1))
    { error = "品种当前不允许该方向开仓。"; return false; }
    double stop_distance = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;
    if (g.direction * ((g.direction == 1 ? tick.bid : tick.ask) - g.stop_loss) < stop_distance)
    { error = "共同止损不符合当前最小止损距离，停止开仓。"; return false; }
    MqlTradeRequest request; MqlTradeResult result; MqlTradeCheckResult check;
    ZeroMemory(request); ZeroMemory(result); ZeroMemory(check);
    request.action = TRADE_ACTION_DEAL; request.symbol = symbol; request.magic = g.magic;
    request.type = g.direction == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
    request.volume = volume; request.price = price; request.sl = g.stop_loss; request.tp = 0;
    request.deviation = (ulong)g.slippage_points;
    request.comment = RBChildComment(g, g.child_count);
    long fill = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE), execution = SymbolInfoInteger(symbol, SYMBOL_TRADE_EXEMODE);
    if ((fill & SYMBOL_FILLING_FOK) != 0 || execution == SYMBOL_TRADE_EXECUTION_INSTANT || execution == SYMBOL_TRADE_EXECUTION_REQUEST)
        request.type_filling = ORDER_FILLING_FOK;
    else if ((fill & SYMBOL_FILLING_IOC) != 0) request.type_filling = ORDER_FILLING_IOC;
    else if (execution != SYMBOL_TRADE_EXECUTION_MARKET) request.type_filling = ORDER_FILLING_RETURN;
    else { error = "无法确定品种成交模式，未发送子单。"; return false; }
    if (!OrderCheck(request, check) || (check.retcode != 0 && check.retcode != TRADE_RETCODE_DONE))
    { error = "子单预检查未通过：" + check.comment; return false; }
    // Intent is durable before the only send. Every response (even a timeout or
    // local error) must subsequently be reconciled unless the server definitively
    // refused an uncreated order. This intent is never retried.
    g.pending = 1; g.pending_index = g.child_count; g.pending_order = 0; g.pending_volume = volume;
    g.last_request = (long)TimeCurrent();
    if (!RBSaveGroup(handle, g)) { error = "子单意图写入失败，未发送。"; return false; }
    RBLastSendTick = GetTickCount64();
    bool sent = OrderSend(request, result);
    g.pending_order = result.order;
    if (!sent || (result.retcode != TRADE_RETCODE_DONE && result.retcode != TRADE_RETCODE_DONE_PARTIAL && result.retcode != TRADE_RETCODE_PLACED))
    {
        g.entry_state = RB_ENTRY_STOPPED;
        if (result.order == 0 && result.deal == 0 && RBDefiniteEntryReject(result.retcode))
        { g.pending = 0; g.pending_volume = 0; RBFreezeExit(g); }
        error = "子单返回 " + IntegerToString(result.retcode) + "，停止续开并核对成交：" + result.comment;
    }
    else error = "子单已提交，等待成交/止损确认。";
    return RBSaveGroup(handle, g);
}

void RBManageEntry()
{
    if (RBActiveParent != 0 && RBOwnerAccount != RBAccountKey()) RBReleaseOwner();
    // RGCanOpen invokes the guard: call outside all parent locks.
    bool allowed = !RBCorruptJournal && RRCanTrade();
    if (RBActiveParent != 0 && allowed) allowed = RGCanOpen(sets.MagicNumber);
    ulong ids[]; RBCollectGroups(ids);
    for (int i = 0; i < ArraySize(ids); i++)
    {
        int handle = RBLockGroup(ids[i]);
        if (handle == INVALID_HANDLE) continue;
        RBGroup g;
        if (!RBLoadGroup(handle, g))
        {
            RBCorruptJournal = true; RBLastStatus = "父订单记录校验失败，暂停新开仓。";
            FileClose(handle); if (ids[i] == RBActiveParent) RBReleaseOwner(); continue;
        }
        bool owner = g.parent_id == RBActiveParent && RBAccountLock != INVALID_HANDLE;
        string message;
        if (!owner && g.entry_state == RB_ENTRY_BUILDING)
        {
            // An interrupted shutdown may have released the account lock while
            // a second chart briefly held this group file. An exclusive probe
            // distinguishes that orphan from another live owner; never resume it.
            int orphan_lock = FileOpen(RBAccountLockName(), FILE_READ | FILE_WRITE | FILE_BIN);
            if (orphan_lock != INVALID_HANDLE)
            {
                RBStopGroupEntry(g);
                bool saved = RBSaveGroup(handle, g);
                FileClose(orphan_lock);
                if (!saved) { FileClose(handle); continue; }
            }
        }
        if (owner && g.entry_state == RB_ENTRY_BUILDING
            && (!allowed || g.account != AccountInfoInteger(ACCOUNT_LOGIN) || g.server_hash != RRHash(AccountInfoString(ACCOUNT_SERVER))
                || AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING || g.risk_latched != 0))
        {
            // Persist cancellation even while a child is in flight. A transient
            // guard/permission failure cannot revive this queue on a later tick.
            g.entry_state = RB_ENTRY_STOPPED;
            RBFreezeExit(g);
            if (!RBSaveGroup(handle, g)) { FileClose(handle); RBReleaseOwner(); continue; }
        }
        if (g.pending != 0)
        {
            ulong previous_order = g.pending_order;
            if (!RBResolvePending(g, message))
            {
                if (previous_order != g.pending_order) RBSaveGroup(handle, g);
                if (owner) RBLastStatus = "父 #" + IntegerToString(g.parent_id) + "：" + message;
                FileClose(handle); continue;
            }
            if (!RBSaveGroup(handle, g)) { FileClose(handle); if (owner) RBReleaseOwner(); continue; }
        }
        if (owner && g.entry_state == RB_ENTRY_BUILDING)
        {
            if (!allowed || g.account != AccountInfoInteger(ACCOUNT_LOGIN) || g.server_hash != RRHash(AccountInfoString(ACCOUNT_SERVER))
                || AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING || g.risk_latched != 0)
            { g.entry_state = RB_ENTRY_STOPPED; message = "交易权限或亏损保护变化，停止后续子单。"; }
            else if (RBSpacingReady(GetTickCount64(), RBLastSendTick, g.interval_seconds))
            {
                if (!RBSendNext(handle, g, message) && g.entry_state == RB_ENTRY_BUILDING)
                    g.entry_state = RB_ENTRY_STOPPED;
            }
            if (g.entry_state != RB_ENTRY_BUILDING)
            { RBFreezeExit(g); RBSaveGroup(handle, g); }
        }
        if (owner)
        {
            RBLastStatus = "父 #" + IntegerToString(g.parent_id) + " 已成交 " + DoubleToString(g.filled_volume, 2)
                + "/" + DoubleToString(g.planned_volume, 2) + " 手（" + IntegerToString(g.child_count) + " 子单）"
                + (message == "" ? "" : "；" + message);
        }
        bool finished = owner && g.entry_state != RB_ENTRY_BUILDING && g.pending == 0;
        FileClose(handle);
        if (finished) RBReleaseOwner();
    }
}

void RBInit()
{
    RBActiveParent = 0; RBOwnerAccount = ""; RBLastSendTick = 0; RBCorruptJournal = false;
    if (!RBLoadSettings()) RBLastStatus = "分批设置读取失败，暂停分批开仓。";
    else RBLastStatus = RBEnabled ? "分批开仓已启用；点击交易建立父订单。" : "分批开仓未启用";
    // Only the process acquiring the account lock may mark an abandoned queue.
    // A different live chart can continue its own queue without being cancelled.
    int owner = FileOpen(RBAccountLockName(), FILE_READ | FILE_WRITE | FILE_BIN);
    if (owner == INVALID_HANDLE) return;
    ulong ids[]; RBCollectGroups(ids);
    for (int i = 0; i < ArraySize(ids); i++)
    {
        int handle = RBLockGroup(ids[i]);
        if (handle == INVALID_HANDLE) continue;
        RBGroup g;
        if (!RBLoadGroup(handle, g)) { RBCorruptJournal = true; FileClose(handle); continue; }
        if (g.entry_state == RB_ENTRY_BUILDING)
        {
            RBStopGroupEntry(g); RBSaveGroup(handle, g);
            RBLastStatus = "父 #" + IntegerToString(g.parent_id) + "：重启后取消未发送子单，仅恢复已有持仓管理。";
        }
        FileClose(handle);
    }
    FileClose(owner);
}
void RBShutdown()
{
    RBCancelEntry();
    RBReleaseOwner();
}
#endif
