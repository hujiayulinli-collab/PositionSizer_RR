// The guard editor owns a text draft. Only an explicit Save publishes settings.
bool CPositionSizeCalculator::CreateGuardControls()
{
    int x = first_column_start;
    int right = x + (int)MathRound(307 * m_DPIScale);
    int edit_x = x + (int)MathRound(173 * m_DPIScale);
    int sound_x = x + (int)MathRound(83 * m_DPIScale);
    int h = element_height;
    int y = (int)MathRound(39 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardUnit, x, y, right, y + h, "m_LblGuardUnit", "")) return false;
    y = (int)MathRound(65 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardSingle, x, y, edit_x, y + h, "m_LblGuardSingle", "单笔最大亏损")) return false;
    if (!EditCreate(GuardTabList, m_EdtGuardSingle, edit_x, y, right, y + h, "m_EdtGuardSingle", "0", "账户货币金额；0=关闭。单笔浮动盈亏含持仓隔夜费。")) return false;
    y = (int)MathRound(92 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardScope, x, y, sound_x, y + h, "m_LblGuardScope", "单笔范围")) return false;
    if (!ButtonCreate(GuardTabList, m_BtnGuardScope, x + (int)MathRound(112 * m_DPIScale), y, right, y + h, "m_BtnGuardScope", "本 EA（所有品种）")) return false;
    y = (int)MathRound(119 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardDaily, x, y, edit_x, y + h, "m_LblGuardDaily", "每日最大亏损")) return false;
    if (!EditCreate(GuardTabList, m_EdtGuardDaily, edit_x, y, right, y + h, "m_EdtGuardDaily", "0", "全账户：今日已实现交易净盈亏＋所有当前持仓浮动盈亏；按服务器日期。")) return false;
    y = (int)MathRound(146 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardDailyInfo, x, y, right, y + h, "m_LblGuardDailyInfo", "每日全账户撤单清仓；调低额度可能立即强平。")) return false;
    y = (int)MathRound(166 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardDailyInfo2, x, y, right, y + h, "m_LblGuardDailyInfo2", "修改不解除已触发退出或当日锁定。")) return false;
    y = (int)MathRound(194 * m_DPIScale);
    if (!CheckBoxCreate(GuardTabList, m_ChkGuardTradeSound, x, y, right, y + h, "m_ChkGuardTradeSound", "成交提示音（全账户）", "开仓、止盈、止损、手动和平仓成交均提示；短时间多笔成交合并提示。")) return false;
    y = (int)MathRound(221 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardTradeSound, x, y, sound_x, y + h, "m_LblGuardTradeSound", "成交音")) return false;
    if (!EditCreate(GuardTabList, m_EdtGuardTradeSound, sound_x, y, right, y + h, "m_EdtGuardTradeSound", "ok.wav", "终端 Sounds 文件夹内的 WAV 文件名；这里不播放预览声音。")) return false;
    y = (int)MathRound(248 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardLossSound, x, y, sound_x, y + h, "m_LblGuardLossSound", "亏损报警音")) return false;
    if (!EditCreate(GuardTabList, m_EdtGuardLossSound, sound_x, y, right, y + h, "m_EdtGuardLossSound", "alert.wav", "亏损保护触发时的 WAV 文件名；关闭成交音不会关闭亏损报警。")) return false;
    y = (int)MathRound(277 * m_DPIScale);
    if (!CheckBoxCreate(GuardTabList, m_ChkGuardShowStatus, x, y, right, y + h, "m_ChkGuardShowStatus", "在图表显示保护状态", "只控制图表角落的状态文字，不关闭亏损保护。")) return false;
    y = (int)MathRound(307 * m_DPIScale);
    if (!ButtonCreate(GuardTabList, m_BtnGuardSave, x, y, x + (int)MathRound(150 * m_DPIScale), y + h, "m_BtnGuardSave", "保存并应用")) return false;
    if (!ButtonCreate(GuardTabList, m_BtnGuardReset, x + (int)MathRound(159 * m_DPIScale), y, right, y + h, "m_BtnGuardReset", "撤销 / 重新载入")) return false;
    y = (int)MathRound(337 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardRealized, x, y, right, y + h, "m_LblGuardRealized", "今日已实现：等待数据")) return false;
    y = (int)MathRound(358 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardFloating, x, y, right, y + h, "m_LblGuardFloating", "当前浮动：等待数据")) return false;
    y = (int)MathRound(379 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardRemaining, x, y, right, y + h, "m_LblGuardRemaining", "每日剩余额度：等待数据")) return false;
    y = (int)MathRound(402 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardState, x, y, right, y + h, "m_LblGuardState", "")) return false;
    y += (int)MathRound(21 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardState2, x, y, right, y + h, "m_LblGuardState2", "")) return false;
    y = (int)MathRound(451 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardStatus, x, y, right, y + h, "m_LblGuardStatus", "")) return false;
    y += (int)MathRound(21 * m_DPIScale);
    if (!LabelCreate(GuardTabList, m_LblGuardStatus2, x, y, right, y + h, "m_LblGuardStatus2", "")) return false;
    m_LblGuardUnit.FontSize(9); m_LblGuardSingle.FontSize(9); m_LblGuardScope.FontSize(9); m_LblGuardDaily.FontSize(9);
    m_LblGuardDailyInfo.FontSize(9); m_LblGuardDailyInfo2.FontSize(9);
    m_LblGuardTradeSound.FontSize(9); m_LblGuardLossSound.FontSize(9);
    m_LblGuardRealized.FontSize(9); m_LblGuardFloating.FontSize(9); m_LblGuardRemaining.FontSize(9);
    m_LblGuardState.FontSize(9); m_LblGuardState2.FontSize(9); m_LblGuardStatus.FontSize(9); m_LblGuardStatus2.FontSize(9);
    m_BtnGuardScope.FontSize(9); m_BtnGuardSave.FontSize(9); m_BtnGuardReset.FontSize(9);
    m_EdtGuardSingle.TextAlign(ALIGN_RIGHT); m_EdtGuardDaily.TextAlign(ALIGN_RIGHT);
    m_EdtGuardTradeSound.TextAlign(ALIGN_LEFT); m_EdtGuardLossSound.TextAlign(ALIGN_LEFT);
    LoadGuardDraft();
    return true;
}

bool CPositionSizeCalculator::GuardSettingsEditable()
{
    if (RGSettingsAccountKey != RGSettingsCurrentKey()) return false;
    if (RGSettingsReady) return true;
    // A first-run invalid legacy default must be repairable from this page.
    // Existing/busy/corrupt saved records are never replaced by this exception.
    return RGSettingsHaveDefaults && RGSettingsRevision == 0 && RGSettingsAccountKey != "" &&
        RGSettingsAccountKey == RGSettingsCurrentKey() && !FileIsExist(RGSettingsFileName());
}

void CPositionSizeCalculator::LoadGuardDraft()
{
    if (!GuardSettingsEditable())
    {
        m_BtnGuardSave.Disable();
        SetGuardStatus("设置暂不可读：" + RGSettingsError, true);
        return;
    }
    m_guard_draft.single = DoubleToString(RGCurrentPositionLossLimit, CountDecimalPlaces(RGCurrentPositionLossLimit));
    m_guard_draft.daily = DoubleToString(RGCurrentDailyLossLimit, CountDecimalPlaces(RGCurrentDailyLossLimit));
    m_guard_draft.scope = RGCurrentPositionScope;
    m_guard_draft.show_status = RGCurrentShowStatus;
    m_guard_draft.sound = RDCurrentEnableTradeSound;
    m_guard_draft.trade_wav = RDCurrentTradeSound;
    m_guard_draft.loss_wav = RDCurrentLossSound;
    m_guard_saved = m_guard_draft;
    m_guard_revision = RGSettingsRevision;
    m_guard_account_key = RGSettingsAccountKey;
    m_guard_dirty = false;
    m_guard_stale = false;
    RenderGuardDraft();
    SetGuardStatus(RGSettingsReady ? "已载入本账户设置；修改后点击保存并应用。" : "初始参数无效，可在本页修改并保存。", !RGSettingsReady);
}

void CPositionSizeCalculator::RenderGuardDraft()
{
    m_EdtGuardSingle.Text(m_guard_draft.single);
    m_EdtGuardDaily.Text(m_guard_draft.daily);
    m_EdtGuardTradeSound.Text(m_guard_draft.trade_wav);
    m_EdtGuardLossSound.Text(m_guard_draft.loss_wav);
    m_ChkGuardShowStatus.Checked(m_guard_draft.show_status);
    m_ChkGuardTradeSound.Checked(m_guard_draft.sound);
    m_BtnGuardScope.Text(m_guard_draft.scope == RG_ENTIRE_ACCOUNT ? "整个账户（含手动单）" : "本 EA（所有品种）");
    if (GuardSettingsEditable() && !m_guard_stale) m_BtnGuardSave.Enable(); else m_BtnGuardSave.Disable();
}

void CPositionSizeCalculator::CaptureGuardDraft()
{
    m_guard_draft.single = m_EdtGuardSingle.Text();
    m_guard_draft.daily = m_EdtGuardDaily.Text();
    m_guard_draft.trade_wav = m_EdtGuardTradeSound.Text();
    m_guard_draft.loss_wav = m_EdtGuardLossSound.Text();
    m_guard_draft.show_status = m_ChkGuardShowStatus.Checked();
    m_guard_draft.sound = m_ChkGuardTradeSound.Checked();
    m_guard_dirty = m_guard_draft.single != m_guard_saved.single || m_guard_draft.daily != m_guard_saved.daily ||
        m_guard_draft.scope != m_guard_saved.scope || m_guard_draft.show_status != m_guard_saved.show_status ||
        m_guard_draft.sound != m_guard_saved.sound || m_guard_draft.trade_wav != m_guard_saved.trade_wav || m_guard_draft.loss_wav != m_guard_saved.loss_wav;
}

void CPositionSizeCalculator::SetGuardStatus(const string text, const bool error = false)
{
    m_LblGuardStatus.Text(StringSubstr(text, 0, 25));
    m_LblGuardStatus2.Text(StringSubstr(text, 25, 25));
    m_LblGuardStatus.Color(error ? clrFireBrick : clrDarkSlateGray);
    m_LblGuardStatus2.Color(error ? clrFireBrick : clrDarkSlateGray);
    ObjectSetString(ChartID(), m_name + "m_LblGuardStatus", OBJPROP_TOOLTIP, text);
    ObjectSetString(ChartID(), m_name + "m_LblGuardStatus2", OBJPROP_TOOLTIP, text);
    ChartRedraw();
}

void CPositionSizeCalculator::OnGuardDraftChanged()
{
    CaptureGuardDraft();
    if (!m_guard_stale) SetGuardStatus(m_guard_dirty ? "有未保存修改；当前仍按已保存的设置执行。" : "草稿与已保存设置相同。");
}

void CPositionSizeCalculator::OnClickBtnGuardScope()
{
    CaptureGuardDraft();
    m_guard_draft.scope = m_guard_draft.scope == RG_OWN_MAGIC ? RG_ENTIRE_ACCOUNT : RG_OWN_MAGIC;
    m_BtnGuardScope.Text(m_guard_draft.scope == RG_ENTIRE_ACCOUNT ? "整个账户（含手动单）" : "本 EA（所有品种）");
    OnGuardDraftChanged();
}

void CPositionSizeCalculator::OnClickBtnGuardReset()
{
    RGSyncSettings();
    LoadGuardDraft();
    m_guard_last_refresh = 0;
    RefreshGuardLiveStatus();
}

void CPositionSizeCalculator::OnClickBtnGuardSave()
{
    if (!GuardSettingsEditable())
    {
        SetGuardStatus("设置暂不可读：" + RGSettingsError, true);
        return;
    }
    if (m_guard_account_key != RGSettingsAccountKey)
    {
        LoadGuardDraft();
        SetGuardStatus("账户已切换，已重新载入；请核对后再保存。", true);
        return;
    }
    CaptureGuardDraft();
    if (m_guard_stale || m_guard_revision != RGSettingsRevision)
    {
        m_guard_stale = true;
        m_BtnGuardSave.Disable();
        SetGuardStatus("其他图表已更新设置；请撤销并重新载入。", true);
        return;
    }
    double single;
    double daily;
    if (!RRPlanParseNumber(m_guard_draft.single, single) || !RRPlanParseNumber(m_guard_draft.daily, daily))
    {
        SetGuardStatus("亏损金额须为非负数字；0=关闭，小数用 .。", true);
        return;
    }
    string error;
    if (!RGSaveSettings(single, m_guard_draft.scope, daily, m_guard_draft.show_status, m_guard_draft.sound,
        m_guard_draft.trade_wav, m_guard_draft.loss_wav, m_guard_revision, error))
    {
        SetGuardStatus(error, true);
        return;
    }
    LoadGuardDraft();
    SetGuardStatus(RGDailyLocked ? "设置已保存；当天已触发的保护锁仍然有效。" : "设置已保存并应用到本账户；立即开始检查。");
    m_guard_last_refresh = 0;
    RefreshGuardLiveStatus();
    // No direct manager/trade call here: normal timer/tick checks use the new
    // settings, including any immediately applicable loss threshold.
}

void CPositionSizeCalculator::RefreshGuardLiveStatus()
{
    if (!m_controls_ready) return;
    ulong now = GetTickCount64();
    if (m_guard_last_refresh != 0 && now - m_guard_last_refresh < 500) return;
    m_guard_last_refresh = now;
    // Detect changes even with this tab hidden so account drafts cannot leak
    // across account switches. Capture text before comparing shared revisions.
    if (m_guard_account_key != RGSettingsCurrentKey() && !GuardSettingsEditable())
    {
        ZeroMemory(m_guard_draft);
        m_guard_saved = m_guard_draft;
        m_guard_account_key = "";
        m_guard_dirty = false;
        m_guard_stale = true;
        RenderGuardDraft();
    }
    if (GuardSettingsEditable())
    {
        if (m_guard_account_key != RGSettingsAccountKey)
        {
            LoadGuardDraft();
            SetGuardStatus("账户已切换，已载入该账户的保护设置。");
        }
        else if (m_guard_revision != RGSettingsRevision && !m_guard_stale)
        {
            CaptureGuardDraft();
            if (m_guard_dirty)
            {
                m_guard_stale = true;
                SetGuardStatus("其他图表已修改设置；草稿保留，撤销后重载。", true);
            }
            else LoadGuardDraft();
        }
    }
    if (GuardSettingsEditable() && !m_guard_stale) m_BtnGuardSave.Enable(); else m_BtnGuardSave.Disable();
    if (!GuardSettingsEditable()) SetGuardStatus("设置暂不可读：" + RGSettingsError, true);
    string currency = AccountInfoString(ACCOUNT_CURRENCY);
    m_LblGuardUnit.Text("单位 " + currency + "；0=关闭；保存即用于当前持仓。");
    if (RGSnapshotReady)
    {
        m_LblGuardRealized.Text("今日已实现：" + DoubleToString(RGRealized, 2) + " " + currency);
        m_LblGuardFloating.Text("当前浮动：" + DoubleToString(RGFloating, 2) + " " + currency);
        string remaining = RGCurrentDailyLossLimit > 0 ? DoubleToString(MathMax(0, RGCurrentDailyLossLimit + RGRealized + RGFloating), 2) + " " + currency : "未启用";
        m_LblGuardRemaining.Text("每日剩余额度（已生效）：" + remaining);
    }
    else
    {
        m_LblGuardRealized.Text("今日已实现：等待数据");
        m_LblGuardFloating.Text("当前浮动：等待数据");
        m_LblGuardRemaining.Text("每日剩余额度：等待数据");
    }
    string state = RGDailyLocked ? "当天已锁定；" + RGStatus : RGStatus;
    m_LblGuardState.Text(StringSubstr(state, 0, 25));
    m_LblGuardState2.Text(StringSubstr(state, 25, 25));
    m_LblGuardState.Color(RGDailyLocked || RGEntryBlocked ? clrFireBrick : clrDarkSlateGray);
    m_LblGuardState2.Color(RGDailyLocked || RGEntryBlocked ? clrFireBrick : clrDarkSlateGray);
    ObjectSetString(ChartID(), m_name + "m_LblGuardState", OBJPROP_TOOLTIP, state);
    ObjectSetString(ChartID(), m_name + "m_LblGuardState2", OBJPROP_TOOLTIP, state);
}

void CPositionSizeCalculator::HideGuard()
{
    if (m_guard_visible) CaptureGuardDraft();
    m_guard_visible = false;
    if (CheckPointer(GuardTabList) == POINTER_INVALID) return;
    m_BtnTabGuard.ColorBackground(CONTROLS_BUTTON_COLOR_DISABLE);
    for (CStringForList *obj = GuardTabList.GetFirstNode(); obj != NULL; obj = GuardTabList.GetNextNode()) obj.Obj.Hide();
}

void CPositionSizeCalculator::ShowGuard()
{
    m_BtnTabGuard.ColorBackground(CONTROLS_BUTTON_COLOR_ENABLE);
    for (CStringForList *obj = GuardTabList.GetFirstNode(); obj != NULL; obj = GuardTabList.GetNextNode()) obj.Obj.Show();
    m_guard_visible = true;
    RenderGuardDraft();
    m_guard_last_refresh = 0;
    RefreshGuardLiveStatus();
    m_LblURL.Show();
}

void CPositionSizeCalculator::OnClickBtnTabGuard()
{
    if (sets.SelectedTab == GuardTab) return;
    sets.SelectedTab = GuardTab;
    HideMain(); HideRisk(); HideMargin(); HideSwaps(); HideTrading(); HideRR();
    ShowGuard();
    MoveAndResize();
    ChartRedraw();
}
