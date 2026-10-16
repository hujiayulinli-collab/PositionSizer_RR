// Editable exit plans. Existing positions retain their own journaled snapshot.
#ifndef PS_RR_PLAN_MQH
#define PS_RR_PLAN_MQH
#define RR_MAX_TARGETS 20

struct RRTarget
{
    double multiple;
    double percent; // Percentage of ORIGINAL volume, never remaining volume.
    int move_be;
};
struct RRPlan
{
    int count;
    RRTarget targets[RR_MAX_TARGETS];
};
struct RRPlanRecord
{
    uint version;
    RRPlan plan;
    uint checksum;
};
RRPlan RRActivePlan;

double RRPlanTotalPercent(const RRPlan &plan)
{
    if (plan.count < 1 || plan.count > RR_MAX_TARGETS) return 0;
    double total = 0;
    for (int i = 0; i < plan.count; i++) total += plan.targets[i].percent;
    return total;
}

bool RRPlanClosesAll(const RRPlan &plan)
{
    // Preserve the percentage tolerance used by already-saved full-exit plans.
    return RRPlanTotalPercent(plan) >= 100.0 - 1e-7;
}

bool RRPlanParseNumber(string text, double &value)
{
    StringTrimLeft(text);
    StringTrimRight(text);
    if (StringLen(text) == 0) return false;
    int dots = 0;
    int digits = 0;
    for (int i = 0; i < StringLen(text); i++)
    {
        ushort ch = StringGetCharacter(text, i);
        if (ch == '.') { if (++dots > 1) return false; }
        else if (ch >= '0' && ch <= '9') digits++;
        else return false;
    }
    if (digits == 0) return false;
    value = StringToDouble(text);
    return MathIsValidNumber(value) && value >= 0;
}

bool RRPlanValidate(const RRPlan &plan, string &error)
{
    error = "";
    if (plan.count < 1 || plan.count > RR_MAX_TARGETS)
    { error = "请设置 1 至 20 个目标。"; return false; }
    double total = 0;
    double previous = 0;
    for (int i = 0; i < plan.count; i++)
    {
        double r = plan.targets[i].multiple;
        double percent = plan.targets[i].percent;
        if (!MathIsValidNumber(r) || r <= previous)
        { error = StringFormat("第 %d 行：R 必须大于 0，并按从小到大排列。", i + 1); return false; }
        if (!MathIsValidNumber(percent) || percent < 0 || percent > 100)
        { error = StringFormat("第 %d 行：平仓比例必须在 0%% 至 100%% 之间。", i + 1); return false; }
        if (plan.targets[i].move_be != 0 && plan.targets[i].move_be != 1)
        { error = "BE 选项无效。"; return false; }
        if (percent == 0 && plan.targets[i].move_be == 0)
        { error = StringFormat("第 %d 行：0%% 目标请勾选 BE，或填写平仓比例。", i + 1); return false; }
        total += percent;
        if (i < plan.count - 1 && total >= 100.0 - 1e-7)
        { error = "100% 必须在最后一个目标才达到。"; return false; }
        previous = r;
    }
    if (total > 100.0 + 1e-7)
    { error = StringFormat("平仓比例合计 %.4f%%，不能超过 100%%；不足 100%% 时保留余仓。", total); return false; }
    return true;
}

bool RRPlanCheckVolume(const RRPlan &plan, const double volume, const double minimum, const double step, string &error)
{
    if (!RRPlanValidate(plan, error)) return false;
    if (!MathIsValidNumber(volume) || !MathIsValidNumber(minimum) || !MathIsValidNumber(step)
        || step <= 0 || minimum <= 0 || volume < minimum - step * 1e-6)
    { error = "手数或券商最小手数无效。"; return false; }
    double cumulative = 0;
    double closed = 0;
    bool closes_all = RRPlanClosesAll(plan);
    for (int i = 0; i < plan.count; i++)
    {
        cumulative += plan.targets[i].percent;
        if (plan.targets[i].percent == 0) continue;
        bool final_exit = closes_all && i == plan.count - 1;
        double goal = (final_exit ? volume : MathFloor(volume * cumulative / 100.0 / step + 1e-8) * step);
        double close_volume = goal - closed;
        double remainder = volume - goal;
        if (close_volume < minimum - step * 1e-6 || (!final_exit && remainder < minimum - step * 1e-6))
        { error = StringFormat("第 %d 个目标的平仓量或余仓小于最小手数，请调整比例或手数。", i + 1); return false; }
        closed = goal;
    }
    return true;
}

bool RRPlanVolumeValid(const double volume, const double minimum, const double step, string &error)
{
    return RRPlanCheckVolume(RRActivePlan, volume, minimum, step, error);
}

double RRPlanFinalR()
{
    if (RRActivePlan.count < 1 || RRActivePlan.count > RR_MAX_TARGETS) return 0;
    return RRActivePlan.targets[RRActivePlan.count - 1].multiple;
}

void RRPlanDefaults(const double first, const double percent, const double final_r, const bool be)
{
    ZeroMemory(RRActivePlan);
    RRActivePlan.count = 2;
    RRActivePlan.targets[0].multiple = first;
    RRActivePlan.targets[0].percent = percent;
    RRActivePlan.targets[0].move_be = (int)be;
    RRActivePlan.targets[1].multiple = final_r;
    RRActivePlan.targets[1].percent = 100.0 - percent;
}

uint RRPlanChecksum(const RRPlan &plan)
{
    string value = IntegerToString(plan.count);
    for (int i = 0; i < plan.count; i++)
        value += "|" + DoubleToString(plan.targets[i].multiple, 16) + "|"
            + DoubleToString(plan.targets[i].percent, 16) + "|" + IntegerToString(plan.targets[i].move_be);
    uint hash = 2166136261;
    for (int i = 0; i < StringLen(value); i++)
        hash = (hash ^ (uint)StringGetCharacter(value, i)) * 16777619;
    return hash;
}

string RRPlanFileName()
{
    // Per chart and symbol, stable across terminal restarts/timeframe changes.
    uint hash = 2166136261;
    for (int i = 0; i < StringLen(_Symbol); i++)
        hash = (hash ^ (uint)StringGetCharacter(_Symbol, i)) * 16777619;
    return "PSRR_Settings\\RRPlan_" + IntegerToString(ChartID()) + "_" + IntegerToString(hash) + ".bin";
}

bool RRPlanRead(const string filename, RRPlan &plan, string &error)
{
    int handle = FileOpen(filename, FILE_READ | FILE_BIN);
    if (handle == INVALID_HANDLE) { error = "无法读取止盈方案文件。"; return false; }
    RRPlanRecord record;
    ZeroMemory(record);
    bool ok = FileSize(handle) == sizeof(RRPlanRecord);
    if (ok) ok = FileReadStruct(handle, record) == sizeof(RRPlanRecord);
    FileClose(handle);
    if (!ok || record.version != 1 || !RRPlanValidate(record.plan, error))
    { error = "止盈方案文件损坏或版本不兼容。"; return false; }
    if (record.checksum != RRPlanChecksum(record.plan))
    { error = "止盈方案文件校验失败。"; return false; }
    plan = record.plan;
    return true;
}

bool RRPlanApply(const RRPlan &plan, string &error)
{
    if (!RRPlanValidate(plan, error)) return false;
    RRPlanRecord record;
    ZeroMemory(record);
    record.version = 1;
    record.plan = plan;
    record.checksum = RRPlanChecksum(plan);
    string filename = RRPlanFileName();
    string temporary = filename + ".tmp";
    int handle = FileOpen(temporary, FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE) { error = "无法保存止盈方案，请检查文件权限。"; return false; }
    ResetLastError();
    uint written = FileWriteStruct(handle, record);
    FileFlush(handle);
    bool ok = written == sizeof(RRPlanRecord) && GetLastError() == 0;
    FileClose(handle);
    RRPlan verified;
    if (ok) ok = RRPlanRead(temporary, verified, error);
    if (!ok || !FileMove(temporary, 0, filename, FILE_REWRITE))
    { error = "止盈方案保存失败，原方案仍然有效。"; return false; }
    RRActivePlan = plan;
    error = "";
    return true;
}

bool RRPlanInitialize(const double first, const double percent, const double final_r, const bool be, string &error)
{
    RRPlanDefaults(first, percent, final_r, be);
    string filename = RRPlanFileName();
    if (FileIsExist(filename)) return RRPlanRead(filename, RRActivePlan, error);
    return RRPlanValidate(RRActivePlan, error);
}
#endif
