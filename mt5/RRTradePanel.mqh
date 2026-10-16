// Account-wide selection and explicit trading actions. Draft edits never send orders.
bool CPositionSizeCalculator::ComboBoxCreate(CPanelList *list, CRRPanelComboBox &combo, int x1, int y1, int x2, int y2, string name)
{
    combo.ListViewItems(6);
    if (!combo.Create(m_chart_id, m_name + name, m_subwin, x1, y1, x2, y2)) return false;
    if (!Add(combo)) return false;
    list.CreateListElementByName(combo, name);
    ObjectSetInteger(m_chart_id, m_name + name + "Edit", OBJPROP_FONTSIZE, 9);
    return true;
}

bool CPositionSizeCalculator::CreateTradeControlOptions()
{
    int x = first_column_start;
    int right = x + (int)MathRound(307 * m_DPIScale);
    int h = element_height;
    int y = m_ChkAskForConfirmation.Top() - ClientAreaTop() + (int)MathRound(24 * m_DPIScale);
    if (!CheckBoxCreate(TradingTabList, m_ChkCloseOpposite, x, y, right, y + h, "m_ChkCloseOpposite", "反向开仓先平同品种全部反向仓", "包含手动单和其他 EA；确认全部平完后才继续新开仓")) return false;
    m_ChkCloseOpposite.Checked(RCCloseOpposite);
    ObjectSetInteger(m_chart_id, m_name + "m_ChkCloseOppositeLabel", OBJPROP_FONTSIZE, 9);
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblReverseStatus, x, y, x + (int)MathRound(215 * m_DPIScale), y + h, "m_LblReverseStatus", "")) return false;
    if (!ButtonCreate(TradingTabList, m_BtnCancelReverse, x + (int)MathRound(220 * m_DPIScale), y, right, y + h, "m_BtnCancelReverse", "取消后续开仓")) return false;
    m_LblReverseStatus.FontSize(9);
    m_BtnCancelReverse.FontSize(9);
    return true;
}





void CPositionSizeCalculator::OnChangeCloseOpposite()
{
    bool enabled = m_ChkCloseOpposite.Checked();
    if (enabled == RCCloseOpposite) return;
    string error;
    if (!RCSetCloseOpposite(enabled, error))
    {
        m_ChkCloseOpposite.Checked(RCCloseOpposite);
        m_LblReverseStatus.Text(StringSubstr(error, 0, 19));
        ObjectSetString(ChartID(), m_name + "m_LblReverseStatus", OBJPROP_TOOLTIP, error);
        m_LblReverseStatus.Color(clrFireBrick);
    }
}

void CPositionSizeCalculator::OnClickCancelReverse()
{
    RCCancelReverse();
    m_trade_controls_refresh = 0;
    RefreshTradeControlStatus();
}

void CPositionSizeCalculator::RefreshTradeControlStatus()
{
    if (!m_controls_ready) return;
    ulong now = GetTickCount64();
    if (m_trade_controls_refresh != 0 && now - m_trade_controls_refresh < 500) return;
    m_trade_controls_refresh = now;
    m_ChkCloseOpposite.Checked(RCCloseOpposite);
    string status = RCPendingStatus;
    if (status == "") status = RCCloseOpposite ? "已启用：先平全部反向仓" : "未启用反向仓自动平仓";
    m_LblReverseStatus.Text(StringSubstr(status, 0, 19));
    m_LblReverseStatus.Color(clrDarkSlateGray);
    ObjectSetString(ChartID(), m_name + "m_LblReverseStatus", OBJPROP_TOOLTIP, status);
    // Cancellation only stops the queued entry; accepted exits continue.
    if (RCReversePending) m_BtnCancelReverse.Enable(); else m_BtnCancelReverse.Disable();
}

bool CPositionSizeCalculator::SelectRRPanelPosition(const ulong identifier)
{
    for (int i = 0; i < PositionsTotal(); i++)
    {
        if (PositionGetTicket(i) == 0) continue;
        if ((ulong)PositionGetInteger(POSITION_IDENTIFIER) == identifier) return true;
    }
    return false;
}

void CPositionSizeCalculator::RefreshRRPositionChoices()
{
    if (m_CmbRRPosition.Expanded()) return;
    if ((ulong)m_CmbRRPosition.Value() != m_rr_position_id) return;
    string signature = "";
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket == 0) continue;
        signature += IntegerToString(PositionGetInteger(POSITION_IDENTIFIER)) + ":" + IntegerToString(ticket) + ":" + PositionGetString(POSITION_SYMBOL) + ":" + IntegerToString(PositionGetInteger(POSITION_TYPE)) + "|";
    }
    if (signature == m_rr_position_choices) return;
    m_rr_position_choices = signature;
    m_CmbRRPosition.ItemsClear();
    m_CmbRRPosition.AddItem("选择持仓（整个账户）", 0);
    bool found = false;
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket == 0) continue;
        long identifier = PositionGetInteger(POSITION_IDENTIFIER);
        string label = PositionGetString(POSITION_SYMBOL) + " #" + IntegerToString(ticket) + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? " 买入" : " 卖出");
        m_CmbRRPosition.AddItem(label, identifier);
        if ((ulong)identifier == m_rr_position_id) found = true;
    }
    if (!found && m_rr_position_id != 0) m_CmbRRPosition.AddItem(m_rr_position_symbol + " · 已关闭 / 请撤销草稿", (long)m_rr_position_id);
    m_CmbRRPosition.SelectByValue((long)m_rr_position_id);
}

void CPositionSizeCalculator::OnChangeRRPosition()
{
    ulong identifier = (ulong)m_CmbRRPosition.Value();
    if (identifier == m_rr_position_id) return;
    CaptureRRPage();
    if (identifier == 0 || m_rr_dirty)
    {
        m_CmbRRPosition.SelectByValue((long)m_rr_position_id);
        if (m_rr_dirty) SetRRStatus("请先保存或撤销草稿，再切换持仓。", true);
        return;
    }
    if (!LoadRRPositionDraft(identifier)) m_CmbRRPosition.SelectByValue((long)m_rr_position_id);
}


void CPositionSizeCalculator::RefreshRRManualAction()
{
    bool selected = m_rr_position_id != 0 && SelectRRPanelPosition(m_rr_position_id);
    // The action remains clickable without a selection, but only opens a chooser.
    m_BtnRRManualClose.Enable();
    m_BtnRRManualClose.Text(selected ? "按比例平仓" : "先选择持仓");
    m_LblRRManualInfo.Text(selected ? "每次按当前余仓；下方目标按初始仓位。" : "未选中有效持仓：请先选择上方订单。");
    m_LblRRManualInfo.Color(selected ? clrDarkSlateGray : clrFireBrick);
}

void CPositionSizeCalculator::OnClickRRManualClose()
{
    if (m_rr_position_id == 0 || !SelectRRPanelPosition(m_rr_position_id))
    {
        RefreshRRManualAction();
        CaptureRRPage();
        if (m_rr_dirty)
        {
            m_LblRRManualInfo.Text("请先保存或撤销草稿，再选择持仓。");
            SetRRStatus("请先保存或撤销草稿，再从上方列表选择持仓。", true);
            return;
        }
        m_rr_position_choices = "";
        RefreshRRPositionChoices();
        if (PositionsTotal() == 0)
        {
            m_LblRRManualInfo.Text("当前账户没有持仓；挂单不属于持仓。");
            SetRRStatus("当前账户没有可平仓持仓；未成交挂单不属于持仓。", true);
            return;
        }
        SetRRStatus("请先从上方列表选择品种和订单号，再点击按比例平仓。", true);
        m_CmbRRPosition.OpenDropDown();
        return;
    }
    RefreshRRManualAction();
    double percent;
    if (!RRPlanParseNumber(m_EdtRRClosePercent.Text(), percent) || percent <= 0 || percent > 100)
    {
        m_LblRRManualInfo.Text("平仓比例须大于 0 且不超过 100。");
        m_LblRRManualInfo.Color(clrFireBrick);
        SetRRStatus("平仓比例请输入大于 0 且不超过 100 的数字。", true); return;
    }
    string error;
    if (!RMRequestClose(m_rr_position_id, percent, sets.MagicNumber, error))
    {
        m_LblRRManualInfo.Text(StringSubstr(error, 0, 25));
        m_LblRRManualInfo.Color(clrFireBrick);
        SetRRStatus(error, true); return;
    }
    m_LblRRManualInfo.Text("已登记平当前余仓 " + DoubleToString(percent, CountDecimalPlaces(percent)) + "% · 等待成交");
    SetRRStatus("已登记按点击时余仓的 " + DoubleToString(percent, CountDecimalPlaces(percent)) + "% 平仓；以成交回报为准。");
    m_rr_last_refresh = 0;
}
