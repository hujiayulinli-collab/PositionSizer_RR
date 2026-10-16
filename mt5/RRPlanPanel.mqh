// Editable RR plan tab. The string draft preserves unfinished numeric input
// while paging; the trading engine receives only a validated, saved RRPlan.
bool CPositionSizeCalculator::CreateRRControls()
{
    int x = first_column_start;
    int right = x + (int)MathRound(307 * m_DPIScale);
    int h = element_height;
    int y = (int)MathRound(39 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRMode, x, y, right, y + h, "m_LblRRMode", RR_Enable ? "分仓止盈已启用" : "分仓止盈已关闭：请在参数中开启 RR_Enable")) return false;
    y += (int)MathRound(22 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRInfo, x, y, right, y + h, "m_LblRRInfo", "平仓比例按初始仓位，总计须为 100%。")) return false;
    y += (int)MathRound(22 * m_DPIScale);
    if (!LabelCreate(RRTabList, m_LblRRBEInfo, x, y, right, y + h, "m_LblRRBEInfo", "BE = 止损移至开仓价；修改仅用于新仓。")) return false;
    m_LblRRMode.FontSize(9);
    m_LblRRInfo.FontSize(9);
    m_LblRRBEInfo.FontSize(9);
    y = (int)MathRound(111 * m_DPIScale);
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
        y = (int)MathRound((135 + row * 26) * m_DPIScale);
        string suffix = IntegerToString(row);
        if (!LabelCreate(RRTabList, m_LblRRNumber[row], x, y, r_x, y + h, "m_LblRRNumber" + suffix, "")) return false;
        if (!EditCreate(RRTabList, m_EdtRRMultiple[row], r_x, y, r_x + edit_w, y + h, "m_EdtRRMultiple" + suffix, "", "目标距离 = 初始止损距离 × R")) return false;
        if (!EditCreate(RRTabList, m_EdtRRPercent[row], p_x, y, p_x + edit_w, y + h, "m_EdtRRPercent" + suffix, "", "该目标平掉初始仓位的百分比；0% 配合 BE 可只上保护")) return false;
        if (!CheckBoxCreate(RRTabList, m_ChkRRBreakEven[row], b_x + (int)MathRound(15 * m_DPIScale), y, d_x, y + h, "m_ChkRRBreakEven" + suffix, "BE", "触发该目标后，把剩余仓位的止损移至开仓价")) return false;
        if (!ButtonCreate(RRTabList, m_BtnRRDelete[row], d_x, y, right, y + h, "m_BtnRRDelete" + suffix, "删除")) return false;
        m_EdtRRMultiple[row].TextAlign(ALIGN_RIGHT);
        m_EdtRRPercent[row].TextAlign(ALIGN_RIGHT);
        m_BtnRRDelete[row].FontSize(9);
    }
    y = (int)MathRound(270 * m_DPIScale);
    if (!ButtonCreate(RRTabList, m_BtnRRPrevious, x, y, x + (int)MathRound(52 * m_DPIScale), y + h, "m_BtnRRPrevious", "上一页")) return false;
    if (!LabelCreate(RRTabList, m_LblRRPage, x + (int)MathRound(59 * m_DPIScale), y, x + (int)MathRound(138 * m_DPIScale), y + h, "m_LblRRPage", "")) return false;
    if (!ButtonCreate(RRTabList, m_BtnRRNext, x + (int)MathRound(139 * m_DPIScale), y, x + (int)MathRound(191 * m_DPIScale), y + h, "m_BtnRRNext", "下一页")) return false;
    if (!ButtonCreate(RRTabList, m_BtnRRAdd, x + (int)MathRound(203 * m_DPIScale), y, right, y + h, "m_BtnRRAdd", "+ 添加止盈")) return false;
    m_BtnRRPrevious.FontSize(9);
    m_BtnRRNext.FontSize(9);
    m_LblRRPage.FontSize(9);
    y = (int)MathRound(299 * m_DPIScale);
    if (!ButtonCreate(RRTabList, m_BtnRRSave, x, y, x + (int)MathRound(151 * m_DPIScale), y + h, "m_BtnRRSave", "保存方案")) return false;
    if (!ButtonCreate(RRTabList, m_BtnRRReset, x + (int)MathRound(160 * m_DPIScale), y, right, y + h, "m_BtnRRReset", "撤销未保存修改")) return false;
    y = (int)MathRound(329 * m_DPIScale);
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
    m_rr_count = RRActivePlan.count;
    m_rr_page = 0;
    for (int i = 0; i < m_rr_count; i++)
    {
        m_rr_multiple[i] = DoubleToString(RRActivePlan.targets[i].multiple, CountDecimalPlaces(RRActivePlan.targets[i].multiple));
        m_rr_percent[i] = DoubleToString(RRActivePlan.targets[i].percent, CountDecimalPlaces(RRActivePlan.targets[i].percent));
        m_rr_be[i] = (RRActivePlan.targets[i].move_be != 0);
    }
    RenderRRPage();
}

void CPositionSizeCalculator::CaptureRRPage()
{
    for (int row = 0; row < 5; row++)
    {
        int index = m_rr_page * 5 + row;
        if (index >= m_rr_count) break;
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
        m_EdtRRMultiple[row].Visible(visible);
        m_EdtRRPercent[row].Visible(visible);
        m_ChkRRBreakEven[row].Visible(visible);
        m_BtnRRDelete[row].Visible(visible);
        if (index >= m_rr_count) continue;
        m_LblRRNumber[row].Text(IntegerToString(index + 1));
        m_EdtRRMultiple[row].Text(m_rr_multiple[index]);
        m_EdtRRPercent[row].Text(m_rr_percent[index]);
        m_ChkRRBreakEven[row].Checked(m_rr_be[index]);
    }
    if (m_rr_page > 0) m_BtnRRPrevious.Enable(); else m_BtnRRPrevious.Disable();
    if (m_rr_page + 1 < pages) m_BtnRRNext.Enable(); else m_BtnRRNext.Disable();
    if (m_rr_count < RR_MAX_TARGETS) m_BtnRRAdd.Enable(); else m_BtnRRAdd.Disable();
    ChartRedraw();
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
    if (m_rr_count >= RR_MAX_TARGETS) return;
    CaptureRRPage();
    double next_r = 1;
    double previous_r;
    if ((m_rr_count > 0) && RRPlanParseNumber(m_rr_multiple[m_rr_count - 1], previous_r)) next_r = previous_r + 1;
    m_rr_multiple[m_rr_count] = DoubleToString(next_r, CountDecimalPlaces(next_r));
    m_rr_percent[m_rr_count] = "0";
    m_rr_be[m_rr_count] = false;
    m_rr_count++;
    m_rr_page = (m_rr_count - 1) / 5;
    RenderRRPage();
    SetRRStatus("已添加目标；填写 R、比例和 BE 后保存。");
}

void CPositionSizeCalculator::OnClickBtnRRDelete(const int row)
{
    int index = m_rr_page * 5 + row;
    if (index >= m_rr_count) return;
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
    LoadRRDraft();
    SetRRStatus("已恢复已保存方案。");
}

void CPositionSizeCalculator::OnClickBtnRRSave()
{
    CaptureRRPage();
    RRPlan draft;
    ZeroMemory(draft);
    draft.count = m_rr_count;
    for (int i = 0; i < m_rr_count; i++)
    {
        if (!RRPlanParseNumber(m_rr_multiple[i], draft.targets[i].multiple) || !RRPlanParseNumber(m_rr_percent[i], draft.targets[i].percent))
        {
            SetRRStatus("第 " + IntegerToString(i + 1) + " 个目标请输入有效数字（小数用 .）。", true);
            return;
        }
        draft.targets[i].move_be = m_rr_be[i] ? 1 : 0;
    }
    string error;
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
    SetRRStatus(RR_Enable ? "方案已保存，仅应用于之后的新仓。" : "方案已保存；请开启 RR_Enable 后使用。");
}
