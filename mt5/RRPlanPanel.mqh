// Editable RR plan tab. The string draft preserves unfinished numeric input
// while paging; the trading engine receives only a validated, saved RRPlan.
bool CPositionSizeCalculator::CreateRRControls()
{
    int x = first_column_start;
    int right = x + (int)MathRound(307 * m_DPIScale);
    int h = element_height;
    int y = (int)MathRound(39 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRMode, x, y, right, y + h, "m_LblRRMode", "新仓方案")) return false;
    y += (int)MathRound(22 * m_DPIScale);
    if (!ButtonCreate(RRTabList, m_BtnRRNewPlan, x, y, x + (int)MathRound(112 * m_DPIScale), y + h, "m_BtnRRNewPlan", "新仓方案")) return false;
    if (!ButtonCreate(RRTabList, m_BtnRRPosition, x + (int)MathRound(120 * m_DPIScale), y, right, y + h, "m_BtnRRPosition", "选择 / 下一持仓")) return false;
    m_BtnRRNewPlan.FontSize(9);
    m_BtnRRPosition.FontSize(9);
    y = (int)MathRound(87 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRInfo, x, y, right, y + h, "m_LblRRInfo", "平仓比例按初始仓位，未安排比例继续保留。")) return false;
    y += (int)MathRound(21 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRBEInfo, x, y, right, y + h, "m_LblRRBEInfo", "BE = 目标触发时把止损移至开仓价。")) return false;
    y += (int)MathRound(21 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRPositionInfo, x, y, right, y + h, "m_LblRRPositionInfo", "价格为新单预览；持仓使用实际成交价。")) return false;
    m_LblRRMode.FontSize(9);
    m_LblRRInfo.FontSize(9);
    m_LblRRBEInfo.FontSize(9);
    m_LblRRPositionInfo.FontSize(9);
    y = (int)MathRound(153 * m_DPIScale);
    int r_x = x + (int)MathRound(29 * m_DPIScale);
    int p_x = x + (int)MathRound(105 * m_DPIScale);
    int b_x = x + (int)MathRound(185 * m_DPIScale);
    int d_x = x + (int)MathRound(266 * m_DPIScale);
    int edit_w = (int)MathRound(63 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRHeadingR, r_x, y, r_x + edit_w, y + h, "m_LblRRHeadingR", "目标 (R)")) return false;
    if (!LabelCreate(RRTabList, m_LblRRHeadingPercent, p_x, y, p_x + edit_w, y + h, "m_LblRRHeadingPercent", "平仓 (%)")) return false;
    if (!LabelCreate(RRTabList, m_LblRRHeadingBE, b_x, y, d_x, y + h, "m_LblRRHeadingBE", "BreakEven")) return false;
    m_LblRRHeadingR.FontSize(9);
    m_LblRRHeadingPercent.FontSize(9);
    m_LblRRHeadingBE.FontSize(9);
    for (int row = 0; row < 5; row++)
    {
        y = (int)MathRound((179 + row * 44) * m_DPIScale);
        string suffix = IntegerToString(row);
        if (!LabelCreate(RRTabList, m_LblRRNumber[row], x, y, r_x, y + h, "m_LblRRNumber" + suffix, "")) return false;
        if (!EditCreate(RRTabList, m_EdtRRMultiple[row], r_x, y, r_x + edit_w, y + h, "m_EdtRRMultiple" + suffix, "", "目标距离 = 初始止损距离 × R")) return false;
        if (!EditCreate(RRTabList, m_EdtRRPercent[row], p_x, y, p_x + edit_w, y + h, "m_EdtRRPercent" + suffix, "", "该目标平掉初始仓位的百分比；0% 配合 BE 可只上保护")) return false;
        if (!CheckBoxCreate(RRTabList, m_ChkRRBreakEven[row], b_x + (int)MathRound(15 * m_DPIScale), y, d_x, y + h, "m_ChkRRBreakEven" + suffix, "BE", "触发该目标后，把剩余仓位的止损移至开仓价")) return false;
        if (!ButtonCreate(RRTabList, m_BtnRRDelete[row], d_x, y, right, y + h, "m_BtnRRDelete" + suffix, "删除")) return false;
        int price_y = y + (int)MathRound(21 * m_DPIScale);
        if (!LabelCreate(RRTabList, m_LblRRPrice[row], r_x, price_y, right, price_y + h, "m_LblRRPrice" + suffix, "")) return false;
        m_EdtRRMultiple[row].TextAlign(ALIGN_RIGHT);
        m_EdtRRPercent[row].TextAlign(ALIGN_RIGHT);
        m_BtnRRDelete[row].FontSize(9);
        m_LblRRPrice[row].FontSize(9);
    }
    y = (int)MathRound(403 * m_DPIScale);
    if (!ButtonCreate(RRTabList, m_BtnRRPrevious, x, y, x + (int)MathRound(52 * m_DPIScale), y + h, "m_BtnRRPrevious", "上一页")) return false;
    if (!LabelCreate(RRTabList, m_LblRRPage, x + (int)MathRound(59 * m_DPIScale), y, x + (int)MathRound(138 * m_DPIScale), y + h, "m_LblRRPage", "")) return false;
    if (!ButtonCreate(RRTabList, m_BtnRRNext, x + (int)MathRound(139 * m_DPIScale), y, x + (int)MathRound(191 * m_DPIScale), y + h, "m_BtnRRNext", "下一页")) return false;
    if (!ButtonCreate(RRTabList, m_BtnRRAdd, x + (int)MathRound(203 * m_DPIScale), y, right, y + h, "m_BtnRRAdd", "+ 添加止盈")) return false;
    m_BtnRRPrevious.FontSize(9);
    m_BtnRRNext.FontSize(9);
    m_LblRRPage.FontSize(9);
    y = (int)MathRound(432 * m_DPIScale);
    if (!ButtonCreate(RRTabList, m_BtnRRSave, x, y, x + (int)MathRound(151 * m_DPIScale), y + h, "m_BtnRRSave", "保存新仓方案")) return false;
    if (!ButtonCreate(RRTabList, m_BtnRRReset, x + (int)MathRound(160 * m_DPIScale), y, right, y + h, "m_BtnRRReset", "撤销未保存修改")) return false;
    m_BtnRRSave.FontSize(9);
    m_BtnRRReset.FontSize(9);
    y = (int)MathRound(461 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRStatus, x, y, right, y + h, "m_LblRRStatus", "")) return false;
    y += (int)MathRound(21 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRStatus2, x, y, right, y + h, "m_LblRRStatus2", "")) return false;
    m_LblRRStatus.FontSize(9);
    m_LblRRStatus2.FontSize(9);
    LoadRRDraft();
    SetRRStatus("已载入已保存方案，可添加最多 20 个目标。");
    return true;
}

void CPositionSizeCalculator::LoadRRDraft()
{
    m_rr_position_id = 0;
    m_rr_expected_stage = 0;
    m_rr_live_stage = 0;
    m_rr_expected_checksum = 0;
    m_rr_stale = false;
    m_rr_readonly = false;
    ZeroMemory(m_rr_state);
    FillRRDraft(RRActivePlan);
    UpdateRRModeLabels();
}

void CPositionSizeCalculator::FillRRDraft(const RRPlan &plan)
{
    m_rr_loaded_plan = plan;
    m_rr_count = plan.count;
    m_rr_page = 0;
    m_rr_dirty = false;
    for (int i = 0; i < m_rr_count; i++)
    {
        m_rr_multiple[i] = DoubleToString(plan.targets[i].multiple, CountDecimalPlaces(plan.targets[i].multiple));
        m_rr_percent[i] = DoubleToString(plan.targets[i].percent, CountDecimalPlaces(plan.targets[i].percent));
        m_rr_be[i] = (plan.targets[i].move_be != 0);
    }
    RenderRRPage();
}

bool CPositionSizeCalculator::LoadRRPositionDraft(const ulong identifier)
{
    RRState state;
    ulong ticket;
    string error;
    if (!RRReadManagedPosition(SymbolForTrading, sets.MagicNumber, identifier, state, ticket, error))
    {
        SetRRStatus(error, true);
        return false;
    }
    RRPlan plan;
    RRStatePlan(state, plan);
    m_rr_position_id = identifier;
    m_rr_state = state;
    m_rr_expected_checksum = RRPlanChecksum(plan);
    m_rr_expected_stage = state.stage;
    m_rr_live_stage = state.version == 2 ? state.stage : (state.stage >= 3 ? 2 : (state.stage >= 1 ? 1 : 0));
    m_rr_stale = false;
    m_rr_readonly = (state.version != 2 || state.blocked != 0);
    FillRRDraft(plan);
    UpdateRRModeLabels();
    m_rr_last_refresh = 0;
    RefreshRRLiveStatus();
    if (state.version != 2) SetRRStatus("旧版持仓仅供查看，继续按原规则管理。", true);
    else if (state.blocked != 0) SetRRStatus("此仓位的自动管理已暂停，请先核对专家日志。", true);
    else SetRRStatus("已载入该持仓方案；已触发的目标不可修改。");
    return true;
}

void CPositionSizeCalculator::UpdateRRModeLabels()
{
    if (m_rr_position_id == 0)
    {
        m_LblRRMode.Text(RR_Enable ? "新仓方案 · 分仓止盈已启用" : "新仓方案 · RR_Enable 已关闭");
        m_LblRRBEInfo.Text("比例按初始仓位；仅勾 BE 的目标触发时上保护。");
        m_BtnRRSave.Text("保存新仓方案");
    }
    else
    {
        m_LblRRMode.Text("持仓 #" + IntegerToString(m_rr_position_id) + (m_rr_readonly ? " · 只读" : ""));
        int digits = (int)SymbolInfoInteger(SymbolForTrading, SYMBOL_DIGITS);
        m_LblRRBEInfo.Text("入场 " + DoubleToString(m_rr_state.entry, digits) + " · 1R " + DoubleToString(m_rr_state.risk, digits));
        m_BtnRRSave.Text("应用到该持仓");
    }
    RefreshRRPlanSummary();
}

void CPositionSizeCalculator::OnClickBtnRRNewPlan()
{
    if (m_rr_position_id == 0) return;
    CaptureRRPage();
    if (m_rr_dirty) { SetRRStatus("请先应用或撤销草稿，再切换方案。", true); return; }
    LoadRRDraft();
    SetRRStatus("已切换新仓方案；保存不会修改现有持仓。");
}

void CPositionSizeCalculator::OnClickBtnRRPosition()
{
    CaptureRRPage();
    if (m_rr_dirty) { SetRRStatus("请先保存或撤销草稿，再切换持仓。", true); return; }
    ulong next_id = RRNextManagedPosition(SymbolForTrading, sets.MagicNumber, m_rr_position_id);
    if (next_id == 0 && m_rr_position_id != 0) next_id = RRNextManagedPosition(SymbolForTrading, sets.MagicNumber, 0);
    if (next_id == 0)
    {
        SetRRStatus("当前品种没有本 EA 可读取的持仓。", true);
        return;
    }
    if (next_id == m_rr_position_id)
    {
        SetRRStatus("当前只有这一笔持仓；撤销按钮可重新载入。");
        return;
    }
    LoadRRPositionDraft(next_id);
}

void CPositionSizeCalculator::CaptureRRPage()
{
    for (int row = 0; row < 5; row++)
    {
        int index = m_rr_page * 5 + row;
        if (index >= m_rr_count) break;
        if (m_rr_readonly || m_rr_stale || (m_rr_position_id != 0 && index < m_rr_expected_stage)) continue;
        if (m_rr_multiple[index] != m_EdtRRMultiple[row].Text() || m_rr_percent[index] != m_EdtRRPercent[row].Text() || m_rr_be[index] != m_ChkRRBreakEven[row].Checked()) m_rr_dirty = true;
        m_rr_multiple[index] = m_EdtRRMultiple[row].Text();
        m_rr_percent[index] = m_EdtRRPercent[row].Text();
        m_rr_be[index] = m_ChkRRBreakEven[row].Checked();
    }
}

void CPositionSizeCalculator::RenderRRPage()
{
    int pages = (m_rr_count + 4) / 5;
    if (pages < 1) pages = 1;
    if (m_rr_page >= pages) m_rr_page = pages - 1;
    m_LblRRPage.Text(IntegerToString(m_rr_page + 1) + "/" + IntegerToString(pages) + " · " + IntegerToString(m_rr_count) + "项");
    for (int row = 0; row < 5; row++)
    {
        int index = m_rr_page * 5 + row;
        bool visible = (index < m_rr_count) && m_rr_visible && !m_minimized;
        m_LblRRNumber[row].Visible(visible);
        m_LblRRPrice[row].Visible(visible);
        m_EdtRRMultiple[row].Visible(visible);
        m_EdtRRPercent[row].Visible(visible);
        m_ChkRRBreakEven[row].Visible(visible);
        m_BtnRRDelete[row].Visible(visible);
        if (index >= m_rr_count) continue;
        m_LblRRNumber[row].Text(IntegerToString(index + 1));
        m_EdtRRMultiple[row].Text(m_rr_multiple[index]);
        m_EdtRRPercent[row].Text(m_rr_percent[index]);
        m_ChkRRBreakEven[row].Checked(m_rr_be[index]);
        bool editable = !m_rr_readonly && !m_rr_stale && (m_rr_position_id == 0 || index >= m_rr_live_stage);
        m_EdtRRMultiple[row].ReadOnly(!editable);
        m_EdtRRPercent[row].ReadOnly(!editable);
        if (editable) { m_ChkRRBreakEven[row].Enable(); m_BtnRRDelete[row].Enable(); }
        else { m_ChkRRBreakEven[row].Disable(); m_BtnRRDelete[row].Disable(); }
    }
    if (m_rr_page > 0) m_BtnRRPrevious.Enable(); else m_BtnRRPrevious.Disable();
    if (m_rr_page + 1 < pages) m_BtnRRNext.Enable(); else m_BtnRRNext.Disable();
    if (m_rr_count < RR_MAX_TARGETS && !m_rr_readonly && !m_rr_stale) m_BtnRRAdd.Enable(); else m_BtnRRAdd.Disable();
    if (!m_rr_readonly && !m_rr_stale) m_BtnRRSave.Enable(); else m_BtnRRSave.Disable();
    RefreshRRTargetPrices();
    ChartRedraw();
}

void CPositionSizeCalculator::RefreshRRTargetPrices()
{
    int digits = (int)SymbolInfoInteger(SymbolForTrading, SYMBOL_DIGITS);
    double tick = SymbolInfoDouble(SymbolForTrading, SYMBOL_TRADE_TICK_SIZE);
    double entry = m_rr_position_id == 0 ? sets.EntryLevel : m_rr_state.entry;
    double risk = m_rr_position_id == 0 ? MathAbs(sets.EntryLevel - sets.StopLossLevel) : m_rr_state.risk;
    int direction = m_rr_position_id == 0 ? (sets.EntryLevel >= sets.StopLossLevel ? 1 : -1) : m_rr_state.direction;
    RRPlan saved;
    ZeroMemory(saved);
    if (m_rr_position_id != 0) RRStatePlan(m_rr_state, saved);
    for (int row = 0; row < 5; row++)
    {
        int index = m_rr_page * 5 + row;
        if (index >= m_rr_count) break;
        double multiple;
        if (!RRPlanParseNumber(m_EdtRRMultiple[row].Text(), multiple) || multiple <= 0 || risk <= 0)
        {
            m_LblRRPrice[row].Text("目标价：请输入有效 R 和初始止损。");
            continue;
        }
        double price = RRTargetPrice(direction, entry, risk, multiple, tick, digits);
        string label = (m_rr_position_id == 0 ? "新仓预览 " : "目标价 ") + DoubleToString(price, digits);
        if (m_rr_position_id != 0)
        {
            if (index < m_rr_live_stage) label += " · 已触发";
            else if (index >= saved.count || multiple != saved.targets[index].multiple) label = "草稿价 " + DoubleToString(price, digits) + " · 未应用";
            else label += " · 待触发";
        }
        m_LblRRPrice[row].Text(label);
        m_LblRRPrice[row].Color(m_rr_position_id != 0 && index < m_rr_live_stage ? clrDimGray : clrDarkSlateGray);
    }
    RefreshRRPlanSummary();
}

void CPositionSizeCalculator::RefreshRRPlanSummary()
{
    // Read the visible edits directly so a timer updates totals during typing
    // without capturing unfinished text or replacing any edit/checkbox value.
    RRPlan summary;
    ZeroMemory(summary);
    summary.count = m_rr_count;
    bool draft = m_rr_dirty || m_rr_stale || m_rr_count != m_rr_loaded_plan.count;
    for (int index = 0; index < m_rr_count; index++)
    {
        string percentage = m_rr_percent[index];
        int row = index - m_rr_page * 5;
        if (row >= 0 && row < 5) percentage = m_EdtRRPercent[row].Text();
        if (m_rr_position_id != 0 && index < m_rr_expected_stage)
            summary.targets[index].percent = m_rr_loaded_plan.targets[index].percent;
        else if (!RRPlanParseNumber(percentage, summary.targets[index].percent))
        {
            m_LblRRInfo.Text("草稿比例未填完整；已保存方案保持不变。");
            m_LblRRInfo.Color(clrFireBrick);
            return;
        }
        if (index >= m_rr_loaded_plan.count || summary.targets[index].percent != m_rr_loaded_plan.targets[index].percent) draft = true;
    }
    double total = RRPlanTotalPercent(summary);
    if (total > 100.0000001)
    {
        m_LblRRInfo.Text("草稿已安排 " + DoubleToString(total, CountDecimalPlaces(total)) + "% · 超出 100%");
        m_LblRRInfo.Color(clrFireBrick);
        return;
    }
    double retained = RRPlanClosesAll(summary) ? 0 : MathMax(0.0, 100.0 - total);
    string label = (draft ? "草稿 " : "已安排 ") + DoubleToString(total, CountDecimalPlaces(total)) + "% / 保留 " + DoubleToString(retained, CountDecimalPlaces(retained)) + "%";
    if (draft)
    {
        double applied = RRPlanTotalPercent(m_rr_loaded_plan);
        label += "（已用 " + DoubleToString(applied, CountDecimalPlaces(applied)) + "%）";
    }
    else if (m_rr_position_id != 0) label += " · 初始 " + DoubleToString(m_rr_state.initial_volume, CountDecimalPlaces(m_rr_state.initial_volume)) + " 手";
    m_LblRRInfo.Text(label);
    m_LblRRInfo.Color(clrDarkSlateGray);
    if (m_rr_position_id == 0)
        m_LblRRPositionInfo.Text(retained > 0 ? "保留部分不设全平 TP；可手动处理或再加目标。" : "所有目标合计平仓 100%，最后目标为全平 TP。");
}

void CPositionSizeCalculator::RefreshRRLiveStatus()
{
    if (!m_controls_ready || !m_rr_visible || m_minimized) return;
    ulong now = GetTickCount64();
    if (m_rr_last_refresh != 0 && now - m_rr_last_refresh < 500) return;
    m_rr_last_refresh = now;
    RefreshRRTargetPrices();
    if (m_rr_position_id == 0) return;
    RRState current;
    ulong ticket;
    string error;
    if (!RRReadManagedPosition(SymbolForTrading, sets.MagicNumber, m_rr_position_id, current, ticket, error))
    {
        // A temporary journal lock can fail the read. Preserve every draft value;
        // saving is guarded again by the engine against a closed/changed position.
        m_LblRRPositionInfo.Text("仓位状态暂不可读；重试中，草稿已保留。");
        return;
    }
    RRPlan plan;
    RRStatePlan(current, plan);
    bool changed = (current.stage != m_rr_expected_stage || RRPlanChecksum(plan) != m_rr_expected_checksum || current.blocked != m_rr_state.blocked);
    if (changed && !m_rr_stale)
    {
        CaptureRRPage();
        m_rr_stale = true;
        m_rr_live_stage = current.version == 2 ? current.stage : (current.stage >= 3 ? 2 : (current.stage >= 1 ? 1 : 0));
        RenderRRPage();
        SetRRStatus("仓位已触发或方案已变化；请点撤销重新载入。", true);
    }
    if (!PositionSelectByTicket(ticket)) return;
    int digits = (int)SymbolInfoInteger(SymbolForTrading, SYMBOL_DIGITS);
    double volume = PositionGetDouble(POSITION_VOLUME);
    double actual_tp = PositionGetDouble(POSITION_TP);
    double tick = SymbolInfoDouble(SymbolForTrading, SYMBOL_TRADE_TICK_SIZE);
    string tp_status;
    if (RRStateClosesAll(current))
    {
        double final_price = RRTargetPrice(current.direction, current.entry, current.risk, plan.targets[plan.count - 1].multiple, tick, digits);
        tp_status = (MathAbs(actual_tp - final_price) < tick * 0.5 ? "TP已同步 " : "TP待同步 ") + DoubleToString(actual_tp, digits);
    }
    else tp_status = actual_tp == 0 ? "全平TP已取消" : "旧TP待取消 " + DoubleToString(actual_tp, digits);
    m_LblRRPositionInfo.Text("余仓 " + DoubleToString(volume, CountDecimalPlaces(volume)) + " 手 · " + tp_status);
    RefreshRRTargetPrices();
}

void CPositionSizeCalculator::SetRRStatus(const string text, const bool error = false)
{
    // Labels do not wrap in the standard control library.
    m_LblRRStatus.Text(StringSubstr(text, 0, 25));
    m_LblRRStatus2.Text(StringSubstr(text, 25, 25));
    m_LblRRStatus.Color(error ? clrFireBrick : clrDarkSlateGray);
    m_LblRRStatus2.Color(error ? clrFireBrick : clrDarkSlateGray);
    ObjectSetString(ChartID(), m_name + "m_LblRRStatus", OBJPROP_TOOLTIP, text);
    ObjectSetString(ChartID(), m_name + "m_LblRRStatus2", OBJPROP_TOOLTIP, text);
    ChartRedraw();
}

void CPositionSizeCalculator::HideRR()
{
    if (m_rr_visible) CaptureRRPage();
    m_rr_visible = false;
    if (CheckPointer(RRTabList) == POINTER_INVALID) return;
    m_BtnTabRR.ColorBackground(CONTROLS_BUTTON_COLOR_DISABLE);
    for (CStringForList *obj = RRTabList.GetFirstNode(); obj != NULL; obj = RRTabList.GetNextNode()) obj.Obj.Hide();
}

void CPositionSizeCalculator::ShowRR()
{
    m_BtnTabRR.ColorBackground(CONTROLS_BUTTON_COLOR_ENABLE);
    for (CStringForList *obj = RRTabList.GetFirstNode(); obj != NULL; obj = RRTabList.GetNextNode()) obj.Obj.Show();
    m_rr_visible = true;
    RenderRRPage();
    m_rr_last_refresh = 0;
    RefreshRRLiveStatus();
    m_LblURL.Show();
}

void CPositionSizeCalculator::OnClickBtnTabRR()
{
    if (sets.SelectedTab == RRTargetsTab) return;
    sets.SelectedTab = RRTargetsTab;
    HideMain();
    HideRisk();
    HideMargin();
    HideSwaps();
    HideTrading();
    ShowRR();
    MoveAndResize();
    ChartRedraw();
}

void CPositionSizeCalculator::OnClickBtnRRAdd()
{
    if (m_rr_count >= RR_MAX_TARGETS || m_rr_readonly || m_rr_stale) return;
    CaptureRRPage();
    double next_r = 1;
    double previous_r;
    if ((m_rr_count > 0) && RRPlanParseNumber(m_rr_multiple[m_rr_count - 1], previous_r)) next_r = previous_r + 1;
    m_rr_multiple[m_rr_count] = DoubleToString(next_r, CountDecimalPlaces(next_r));
    m_rr_percent[m_rr_count] = "0";
    m_rr_be[m_rr_count] = false;
    m_rr_count++;
    m_rr_dirty = true;
    m_rr_page = (m_rr_count - 1) / 5;
    RenderRRPage();
    SetRRStatus("已添加目标；填写 R、比例和 BE 后保存。");
}

void CPositionSizeCalculator::OnClickBtnRRDelete(const int row)
{
    int index = m_rr_page * 5 + row;
    if (index >= m_rr_count || m_rr_readonly || m_rr_stale || (m_rr_position_id != 0 && index < m_rr_expected_stage)) return;
    if (m_rr_count == 1)
    {
        SetRRStatus("至少保留一个止盈目标。", true);
        return;
    }
    CaptureRRPage();
    for (int i = index; i < m_rr_count - 1; i++)
    {
        m_rr_multiple[i] = m_rr_multiple[i + 1];
        m_rr_percent[i] = m_rr_percent[i + 1];
        m_rr_be[i] = m_rr_be[i + 1];
    }
    m_rr_count--;
    m_rr_dirty = true;
    RenderRRPage();
    SetRRStatus("已删除目标；调整平仓比例后保存方案。");
}

void CPositionSizeCalculator::OnClickBtnRRPrevious()
{
    if (m_rr_page == 0) return;
    CaptureRRPage();
    m_rr_page--;
    RenderRRPage();
}

void CPositionSizeCalculator::OnClickBtnRRNext()
{
    if ((m_rr_page + 1) * 5 >= m_rr_count) return;
    CaptureRRPage();
    m_rr_page++;
    RenderRRPage();
}

void CPositionSizeCalculator::OnClickBtnRRReset()
{
    if (m_rr_position_id != 0)
    {
        ulong ticket;
        if (!RRSelectManagedPosition(SymbolForTrading, sets.MagicNumber, m_rr_position_id, ticket))
        {
            LoadRRDraft();
            SetRRStatus("持仓已关闭或不再匹配；已撤销草稿，回到新仓方案。");
        }
        else LoadRRPositionDraft(m_rr_position_id);
    }
    else { LoadRRDraft(); SetRRStatus("已恢复已保存的新仓方案。"); }
}

void CPositionSizeCalculator::OnClickBtnRRSave()
{
    if (m_rr_readonly || m_rr_stale)
    {
        SetRRStatus(m_rr_stale ? "仓位状态已变化，请点撤销重新载入。" : "此仓位当前仅可查看。", true);
        return;
    }
    CaptureRRPage();
    RRPlan draft;
    ZeroMemory(draft);
    draft.count = m_rr_count;
    for (int i = 0; i < m_rr_count; i++)
    {
        if (m_rr_position_id != 0 && i < m_rr_expected_stage)
        {
            draft.targets[i] = m_rr_loaded_plan.targets[i];
            continue;
        }
        if (!RRPlanParseNumber(m_rr_multiple[i], draft.targets[i].multiple) || !RRPlanParseNumber(m_rr_percent[i], draft.targets[i].percent))
        {
            SetRRStatus("第 " + IntegerToString(i + 1) + " 个目标请输入有效数字（小数用 .）。", true);
            return;
        }
        draft.targets[i].move_be = m_rr_be[i] ? 1 : 0;
    }
    string error;
    if (m_rr_position_id != 0)
    {
        if (!RRApplyPositionPlan(SymbolForTrading, sets.MagicNumber, m_rr_position_id, draft, m_rr_expected_checksum, m_rr_expected_stage, error))
        {
            SetRRStatus(error, true);
            return;
        }
        if (LoadRRPositionDraft(m_rr_position_id)) SetRRStatus(RRPlanClosesAll(draft) ? "持仓方案已保存；最终 TP 待服务器同步。" : "方案已保存；将取消全平 TP，未安排比例继续保留。");
        return;
    }
    if (!RRPlanCanEdit(SymbolForTrading, sets.MagicNumber, error) || !RRPlanApply(draft, error))
    {
        SetRRStatus(error, true);
        return;
    }
    if (RR_Enable)
    {
        sets.TPMultiplier = RRPlanFinalR();
        ProcessTPChange(false);
        RefreshValues();
    }
    SaveSettingsOnDisk(SymbolForTrading);
    m_rr_dirty = false;
    m_rr_loaded_plan = draft;
    RefreshRRPlanSummary();
    SetRRStatus(!RR_Enable ? "方案已保存；请开启 RR_Enable 后使用。" : (RRPlanClosesAll(draft) ? "方案已保存，仅应用于之后的新仓。" : "新仓方案已保存；保留余仓，不设置全平 TP。"));
}
