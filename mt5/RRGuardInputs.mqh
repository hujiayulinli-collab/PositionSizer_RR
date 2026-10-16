// Keep 1.40 input identifiers so existing presets can seed the first panel
// draft. Once saved, the account's panel settings override these defaults.
#ifndef PSRR_GUARD_INPUTS_MQH
#define PSRR_GUARD_INPUTS_MQH
enum RG_POSITION_SCOPE
{
    RG_OWN_MAGIC = 0, // 本 EA 的 Magic，所有品种
    RG_ENTIRE_ACCOUNT = 1 // 整个账户的所有持仓
};
input group "亏损保护首次默认值（平时请在面板“亏损保护”页设置）"
input(name="首次默认：每笔持仓最大浮亏金额") double RGPositionLossLimit = 0;
input(name="首次默认：单笔保护范围") RG_POSITION_SCOPE RGPositionScope = RG_OWN_MAGIC;
input(name="首次默认：每日亏损金额") double RGDailyLossLimit = 0;
input(name="首次默认：显示图表状态") bool RGShowStatus = true;
input group "声音首次默认值（平时请在面板“亏损保护”页设置）"
input(name="首次默认：整个账户成交提示音") bool RDEnableTradeSound = true;
input(name="首次默认：成交 WAV 文件") string RDTradeSound = "ok.wav";
input(name="首次默认：亏损报警 WAV 文件") string RDLossSound = "alert.wav";

double RGCurrentPositionLossLimit = 0;
RG_POSITION_SCOPE RGCurrentPositionScope = RG_OWN_MAGIC;
double RGCurrentDailyLossLimit = 0;
bool RGCurrentShowStatus = true;
bool RDCurrentEnableTradeSound = true;
string RDCurrentTradeSound = "ok.wav";
string RDCurrentLossSound = "alert.wav";

void RGUseInputDefaults()
{
    RGCurrentPositionLossLimit = RGPositionLossLimit;
    RGCurrentPositionScope = RGPositionScope;
    RGCurrentDailyLossLimit = RGDailyLossLimit;
    RGCurrentShowStatus = RGShowStatus;
    RDCurrentEnableTradeSound = RDEnableTradeSound;
    RDCurrentTradeSound = RDTradeSound;
    RDCurrentLossSound = RDLossSound;
}
#endif
