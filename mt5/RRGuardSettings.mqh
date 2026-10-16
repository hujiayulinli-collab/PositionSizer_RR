// Account-scoped panel settings. Explicit Save is the only file-creation path.
// Depends on RRHash and RRGuardInputs.mqh's Current runtime variables.
#ifndef PS_RR_GUARD_SETTINGS_MQH
#define PS_RR_GUARD_SETTINGS_MQH
#define RG_SETTINGS_WAV_CAPACITY 129

struct RGSettingsRecord
{
    uint version;
    long account;
    uint server_hash;
    uint revision;
    double single_loss;
    double daily_loss;
    int scope;
    int show_status;
    int trade_sound;
    uint trade_length;
    uint loss_length;
    ushort trade_wav[RG_SETTINGS_WAV_CAPACITY];
    ushort loss_wav[RG_SETTINGS_WAV_CAPACITY];
    uint checksum;
};

uint RGSettingsRevision = 0;
bool RGSettingsReady = false;
string RGSettingsError = "";
string RGSettingsAccountKey = "";
RGSettingsRecord RGSettingsDefaults;
bool RGSettingsHaveDefaults = false;

string RGSettingsCurrentKey()
{
    return AccountInfoString(ACCOUNT_SERVER) + "|" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
}

string RGSettingsFileName()
{
    return StringFormat("PSRR_Guard\\%u_%I64d\\settings.bin", RRHash(AccountInfoString(ACCOUNT_SERVER)), AccountInfoInteger(ACCOUNT_LOGIN));
}

bool RGSettingsPathSegmentValid(const string segment)
{
    if (segment == "" || segment == "." || segment == "..") return false;
    string trimmed = segment;
    StringTrimLeft(trimmed);
    StringTrimRight(trimmed);
    if (trimmed != segment || StringSubstr(segment, StringLen(segment) - 1) == ".") return false;
    string base = segment;
    int dot = StringFind(base, ".");
    if (dot >= 0) base = StringSubstr(base, 0, dot);
    StringToLower(base);
    if (base == "con" || base == "prn" || base == "aux" || base == "nul") return false;
    if (StringLen(base) == 4 && (StringSubstr(base, 0, 3) == "com" || StringSubstr(base, 0, 3) == "lpt"))
    {
        ushort last = StringGetCharacter(base, 3);
        if (last >= 49 && last <= 57) return false;
    }
    return true;
}

bool RGSettingsWavValid(const string filename)
{
    int length = StringLen(filename);
    if (length < 5 || length >= RG_SETTINGS_WAV_CAPACITY) return false;
    string lower = filename;
    StringToLower(lower);
    if (StringSubstr(lower, length - 4) != ".wav") return false;
    int segment_start = 0;
    for (int i = 0; i < length; i++)
    {
        ushort ch = StringGetCharacter(filename, i);
        // Relative paths inside Sounds only; no device, drive, traversal,
        // wildcard, control/newline or alternate-stream syntax.
        if (ch < 32 || ch == 127 || ch == 8232 || ch == 8233
            || ch == 60 || ch == 62 || ch == 58 || ch == 34 || ch == 124 || ch == 63 || ch == 42) return false;
        if (ch == 47 || ch == 92)
        {
            if (!RGSettingsPathSegmentValid(StringSubstr(filename, segment_start, i - segment_start))) return false;
            segment_start = i + 1;
        }
    }
    string final_segment = StringSubstr(filename, segment_start);
    return StringLen(final_segment) > 4 && RGSettingsPathSegmentValid(final_segment);
}

bool RGSettingsValuesValid(const double single, const int scope, const double daily, const int show,
                           const int sound, const string trade_wav, const string loss_wav, string &error)
{
    error = "";
    if (!MathIsValidNumber(single) || single < 0 || !MathIsValidNumber(daily) || daily < 0)
    { error = "亏损额度必须为有限的非负金额；0 表示关闭。"; return false; }
    if (scope != RG_OWN_MAGIC && scope != RG_ENTIRE_ACCOUNT)
    { error = "单笔保护范围无效，请选择本 EA 或整个账户。"; return false; }
    if ((show != 0 && show != 1) || (sound != 0 && sound != 1))
    { error = "显示或声音开关无效。"; return false; }
    if (!RGSettingsWavValid(trade_wav) || !RGSettingsWavValid(loss_wav))
    { error = "声音须为 Sounds 目录内的相对 WAV 文件路径，长度 1 至 128；不能含换行、上级目录或无效文件字符。"; return false; }
    return true;
}

void RGSettingsBuildRecord(const double single, const RG_POSITION_SCOPE scope, const double daily,
                           const bool show, const bool sound, const string trade_wav, const string loss_wav,
                           const uint revision, RGSettingsRecord &s)
{
    ZeroMemory(s);
    s.version = 1;
    s.account = AccountInfoInteger(ACCOUNT_LOGIN);
    s.server_hash = RRHash(AccountInfoString(ACCOUNT_SERVER));
    s.revision = revision;
    s.single_loss = single;
    s.daily_loss = daily;
    s.scope = (int)scope;
    s.show_status = (int)show;
    s.trade_sound = (int)sound;
    s.trade_length = (uint)StringLen(trade_wav);
    s.loss_length = (uint)StringLen(loss_wav);
    for (uint i = 0; i < s.trade_length && i < RG_SETTINGS_WAV_CAPACITY - 1; i++) s.trade_wav[i] = StringGetCharacter(trade_wav, i);
    for (uint i = 0; i < s.loss_length && i < RG_SETTINGS_WAV_CAPACITY - 1; i++) s.loss_wav[i] = StringGetCharacter(loss_wav, i);
}

uint RGSettingsChecksum(const RGSettingsRecord &s)
{
    string value = StringFormat("%u|%I64d|%u|%u|", s.version, s.account, s.server_hash, s.revision)
        + DoubleToString(s.single_loss, 16) + "|" + DoubleToString(s.daily_loss, 16)
        + StringFormat("|%d|%d|%d|%u|%u|", s.scope, s.show_status, s.trade_sound, s.trade_length, s.loss_length);
    // Include zero padding: no unchecked data is hidden in unused array slots.
    for (int i = 0; i < RG_SETTINGS_WAV_CAPACITY; i++)
        value += IntegerToString(s.trade_wav[i]) + "," + IntegerToString(s.loss_wav[i]) + "|";
    return RRHash(value);
}

bool RGSettingsRecordValid(const RGSettingsRecord &s, string &error)
{
    if (s.version != 1 || s.account <= 0 || s.account != AccountInfoInteger(ACCOUNT_LOGIN)
        || s.server_hash != RRHash(AccountInfoString(ACCOUNT_SERVER)) || s.revision == 0
        || s.trade_length < 1 || s.trade_length >= RG_SETTINGS_WAV_CAPACITY
        || s.loss_length < 1 || s.loss_length >= RG_SETTINGS_WAV_CAPACITY || s.checksum != RGSettingsChecksum(s))
    { error = "设置记录损坏、账户不匹配或版本不兼容。"; return false; }
    for (uint i = s.trade_length; i < RG_SETTINGS_WAV_CAPACITY; i++)
        if (s.trade_wav[i] != 0) { error = "成交声音记录不完整。"; return false; }
    for (uint i = s.loss_length; i < RG_SETTINGS_WAV_CAPACITY; i++)
        if (s.loss_wav[i] != 0) { error = "亏损声音记录不完整。"; return false; }
    string trade_wav = ShortArrayToString(s.trade_wav, 0, s.trade_length);
    string loss_wav = ShortArrayToString(s.loss_wav, 0, s.loss_length);
    if ((uint)StringLen(trade_wav) != s.trade_length || (uint)StringLen(loss_wav) != s.loss_length)
    { error = "声音路径包含无效的内嵌结束字符。"; return false; }
    return RGSettingsValuesValid(s.single_loss, s.scope, s.daily_loss, s.show_status, s.trade_sound, trade_wav, loss_wav, error);
}

bool RGReadSettingsJournal(const int handle, RGSettingsRecord &s, string &error)
{
    ulong size = FileSize(handle);
    if (size < sizeof(RGSettingsRecord) || size % sizeof(RGSettingsRecord) != 0
        || !FileSeek(handle, (long)(size - sizeof(RGSettingsRecord)), SEEK_SET)
        || FileReadStruct(handle, s) != sizeof(RGSettingsRecord))
    { error = "设置记录不完整或无法读取；请勿覆盖该记录。"; return false; }
    if (!RGSettingsRecordValid(s, error)) return false;
    if ((ulong)s.revision != size / sizeof(RGSettingsRecord))
    { error = "设置记录的版本序列不完整。"; return false; }
    return true;
}

void RGApplySettingsRecord(const RGSettingsRecord &s)
{
    RGCurrentPositionLossLimit = s.single_loss;
    RGCurrentPositionScope = (RG_POSITION_SCOPE)s.scope;
    RGCurrentDailyLossLimit = s.daily_loss;
    RGCurrentShowStatus = s.show_status != 0;
    RDCurrentEnableTradeSound = s.trade_sound != 0;
    RDCurrentTradeSound = s.trade_length > 0 && s.trade_length < RG_SETTINGS_WAV_CAPACITY ? ShortArrayToString(s.trade_wav, 0, s.trade_length) : "";
    RDCurrentLossSound = s.loss_length > 0 && s.loss_length < RG_SETTINGS_WAV_CAPACITY ? ShortArrayToString(s.loss_wav, 0, s.loss_length) : "";
    RGSettingsRevision = s.revision;
}

bool RGSyncSettings()
{
    string key = RGSettingsCurrentKey();
    if (!RGSettingsHaveDefaults)
    { RGSettingsReady = false; RGSettingsError = "设置尚未初始化。"; return false; }
    if (key != RGSettingsAccountKey)
    {
        // Never use another account's saved amounts while loading this one.
        RGApplySettingsRecord(RGSettingsDefaults);
        RGSettingsAccountKey = key;
        RGSettingsReady = false;
    }
    string error;
    if (AccountInfoInteger(ACCOUNT_LOGIN) <= 0 || AccountInfoString(ACCOUNT_SERVER) == "")
    { RGSettingsReady = false; RGSettingsError = "等待有效交易账户信息。"; return false; }
    string filename = RGSettingsFileName();
    if (!FileIsExist(filename))
    {
        if (RGSettingsRevision != 0)
        { RGSettingsReady = false; RGSettingsError = "已保存的设置记录消失，保留当前值并暂停新增风险。"; return false; }
        RGSettingsReady = RGSettingsValuesValid(RGCurrentPositionLossLimit, (int)RGCurrentPositionScope,
            RGCurrentDailyLossLimit, (int)RGCurrentShowStatus, (int)RDCurrentEnableTradeSound,
            RDCurrentTradeSound, RDCurrentLossSound, error);
        RGSettingsError = error;
        return RGSettingsReady;
    }
    int handle = FileOpen(filename, FILE_READ | FILE_BIN);
    if (handle == INVALID_HANDLE)
    { RGSettingsReady = false; RGSettingsError = "账户设置正被其他图表保存或无法读取，稍后重试。"; return false; }
    RGSettingsRecord record;
    bool valid = RGReadSettingsJournal(handle, record, error);
    FileClose(handle);
    if (!valid || key != RGSettingsCurrentKey())
    {
        RGSettingsReady = false;
        RGSettingsError = valid ? "读取期间账户已变化，请重新加载设置。" : error;
        return false;
    }
    if (record.revision < RGSettingsRevision)
    { RGSettingsReady = false; RGSettingsError = "账户设置版本发生回退，保留当前值并暂停新增风险。"; return false; }
    RGApplySettingsRecord(record);
    RGSettingsAccountKey = key;
    RGSettingsReady = true;
    RGSettingsError = "";
    return true;
}

bool RGInitSettings()
{
    // Root copies the original F7 input values to the seven Current variables
    // before calling this. Only an explicit panel save creates settings.bin.
    RGSettingsBuildRecord(RGCurrentPositionLossLimit, RGCurrentPositionScope, RGCurrentDailyLossLimit,
        RGCurrentShowStatus, RDCurrentEnableTradeSound, RDCurrentTradeSound, RDCurrentLossSound, 0, RGSettingsDefaults);
    RGSettingsHaveDefaults = true;
    RGSettingsRevision = 0;
    RGSettingsReady = false;
    RGSettingsAccountKey = RGSettingsCurrentKey();
    RGSettingsError = "";
    return RGSyncSettings();
}

bool RGSaveSettings(const double single, const RG_POSITION_SCOPE scope, const double daily, const bool show,
                     const bool sound, const string trade_wav, const string loss_wav,
                     const uint expected_revision, string &error)
{
    if (!RGSettingsValuesValid(single, (int)scope, daily, (int)show, (int)sound, trade_wav, loss_wav, error)) return false;
    string key = RGSettingsCurrentKey();
    if (!RGSettingsHaveDefaults || key != RGSettingsAccountKey || AccountInfoInteger(ACCOUNT_LOGIN) <= 0
        || AccountInfoString(ACCOUNT_SERVER) == "")
    { error = "账户已变化或设置尚未初始化，请重新加载后保存。"; return false; }
    string filename = RGSettingsFileName();
    bool exists = FileIsExist(filename);
    if (!exists && expected_revision != 0)
    { error = "原设置记录已变化，请重新加载后保存。"; return false; }
    if (key != RGSettingsCurrentKey())
    { error = "保存前账户已变化，请重新加载。"; return false; }
    int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE)
    { error = "账户设置正被其他图表使用或不可写，请稍候重试。"; return false; }
    RGSettingsRecord previous;
    ZeroMemory(previous);
    bool ok = true;
    if (exists || FileSize(handle) != 0) ok = RGReadSettingsJournal(handle, previous, error);
    if (!ok)
    {
        FileClose(handle); RGSettingsReady = false; RGSettingsError = error;
        return false;
    }
    if (previous.revision != expected_revision || previous.revision == 4294967295)
    {
        FileClose(handle);
        error = "设置已被另一张图表修改或版本号已用尽，请重新加载后保存。";
        return false;
    }
    RGSettingsRecord record;
    RGSettingsBuildRecord(single, scope, daily, show, sound, trade_wav, loss_wav, previous.revision + 1, record);
    record.checksum = RGSettingsChecksum(record);
    if (key != RGSettingsCurrentKey())
    {
        FileClose(handle); error = "保存期间账户已变化，未应用草稿。";
        return false;
    }
    ResetLastError();
    ok = FileSeek(handle, 0, SEEK_END);
    if (ok) ok = FileWriteStruct(handle, record) == sizeof(RGSettingsRecord);
    if (ok) { FileFlush(handle); ok = GetLastError() == 0; }
    RGSettingsRecord verified;
    ZeroMemory(verified);
    if (ok) ok = RGReadSettingsJournal(handle, verified, error)
        && verified.revision == record.revision && verified.checksum == record.checksum;
    FileClose(handle);
    if (!ok || key != RGSettingsCurrentKey())
    {
        error = !ok ? "保存结果未确认，当前运行值暂未更改；请重新载入核对设置记录。" : "保存期间账户已变化，尚未应用草稿；请重新载入核对。";
        RGSettingsReady = false; RGSettingsError = error;
        return false;
    }
    // Publish all seven values only after durable, verified write and unlock.
    RGApplySettingsRecord(verified);
    RGSettingsRevision = verified.revision;
    RGSettingsAccountKey = key;
    RGSettingsReady = true;
    RGSettingsError = "";
    error = "";
    return true;
}
#endif
