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
    int offset = (int)MathRound(52 * m_DPIScale);
    // Make room above the existing calculator without changing any price controls.
    for (CStringForList *obj = MainTabList.GetFirstNode(); obj != NULL; obj = MainTabList.GetNextNode())
        obj.Obj.Move(obj.Obj.Left(), obj.Obj.Top() + offset);
    int y = (int)MathRound(39 * m_DPIScale);
    if (!ComboBoxCreate(MainTabList, m_CmbTradeSymbol, x, y, x + (int)MathRound(116 * m_DPIScale), y + h, "m_CmbTradeSymbol")) return false;
    if (!EditCreate(MainTabList, m_EdtTradeSymbol, x + (int)MathRound(122 * m_DPIScale), y, x + (int)MathRound(226 * m_DPIScale), y + h, "m_EdtTradeSymbol", SymbolForTrading, "输入券商完整品种代码，也可从左侧选择")) return false;
    if (!ButtonCreate(MainTabList, m_BtnSwitchSymbol, x + (int)MathRound(232 * m_DPIScale), y, right, y + h, "m_BtnSwitchSymbol", "切换品种")) return false;
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(MainTabList, m_LblSymbolStatus, x, y, right, y + h, "m_LblSymbolStatus", "当前图表 / 下单品种：" + SymbolForTrading)) return false;
    m_EdtTradeSymbol.TextAlign(ALIGN_LEFT);
    m_trade_view_symbol = SymbolForTrading;
    m_BtnSwitchSymbol.FontSize(9);
    m_LblSymbolStatus.FontSize(9);
    // TP add/remove walks this list from StopPrice onward. Keep the selector
    // before those rows so adding targets never moves it into the calculator.
    MainTabList.MoveListElementByName("m_CmbTradeSymbol", 0);
    MainTabList.MoveListElementByName("m_EdtTradeSymbol", 1);
    MainTabList.MoveListElementByName("m_BtnSwitchSymbol", 2);
    MainTabList.MoveListElementByName("m_LblSymbolStatus", 3);

    y = m_ChkAskForConfirmation.Top() - ClientAreaTop() + (int)MathRound(24 * m_DPIScale);
    if (!CheckBoxCreate(TradingTabList, m_ChkCloseOpposite, x, y, right, y + h, "m_ChkCloseOpposite", "反向开仓先平同品种全部反向仓", "包含手动单和其他 EA；确认全部平完后才继续新开仓")) return false;
    m_ChkCloseOpposite.Checked(RCCloseOpposite);
    ObjectSetInteger(m_chart_id, m_name + "m_ChkCloseOppositeLabel", OBJPROP_FONTSIZE, 9);
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblReverseStatus, x, y, x + (int)MathRound(215 * m_DPIScale), y + h, "m_LblReverseStatus", "")) return false;
    if (!ButtonCreate(TradingTabList, m_BtnCancelReverse, x + (int)MathRound(220 * m_DPIScale), y, right, y + h, "m_BtnCancelReverse", "取消后续开仓")) return false;
    m_LblReverseStatus.FontSize(9);
    m_BtnCancelReverse.FontSize(9);
    RefreshTradeSymbolChoices();
    return true;
}

void CPositionSizeCalculator::RefreshTradeSymbolChoices()
{
    // Keep an open menu stable and let a queued selection event finish first.
    if (m_CmbTradeSymbol.Expanded()) return;
    if (m_CmbTradeSymbol.Value() > 0 && m_CmbTradeSymbol.Select() != m_trade_symbol_selection) return;
    string signature = "";
    for (int i = 0; i < SymbolsTotal(true); i++) signature += SymbolName(i, true) + "|";
    if (signature == m_trade_symbol_choices) return;
    m_trade_symbol_choices = signature;
    m_CmbTradeSymbol.ItemsClear();
    m_CmbTradeSymbol.AddItem("市场报价品种", 0);
    for (int i = 0; i < SymbolsTotal(true); i++) m_CmbTradeSymbol.AddItem(SymbolName(i, true), i + 1);
    // Selecting the placeholder emits ON_CHANGE, which deliberately does nothing.
    m_CmbTradeSymbol.Select(0);
}

void CPositionSizeCalculator::OnChangeTradeSymbol()
{
    if (m_CmbTradeSymbol.Value() <= 0) return;
    m_trade_symbol_selection = m_CmbTradeSymbol.Select();
    m_EdtTradeSymbol.Text(m_trade_symbol_selection);
}

bool CPositionSizeCalculator::HasRRDraftChanges()
{
    if (!m_controls_ready) return false;
    CaptureRRPage();
    return m_rr_dirty;
}

void CPositionSizeCalculator::OnClickSwitchSymbol()
{
    CaptureGuardDraft();
    if (HasRRDraftChanges() || m_guard_dirty)
    {
        m_LblSymbolStatus.Text("请先保存或撤销止盈 / 亏损保护草稿。");
        m_LblSymbolStatus.Color(clrFireBrick);
        return;
    }
    string symbol = m_EdtTradeSymbol.Text();
    StringTrimLeft(symbol);
    StringTrimRight(symbol);
    string error;
    bool accepted = RCSwitchSymbol(symbol, error);
    string status = accepted ? "正在切换图表及下单品种：" + symbol : error;
    m_LblSymbolStatus.Text(StringSubstr(status, 0, 29));
    m_LblSymbolStatus.Color(accepted ? clrDarkSlateGray : clrFireBrick);
    ObjectSetString(ChartID(), m_name + "m_LblSymbolStatus", OBJPROP_TOOLTIP, status);
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
    if (m_trade_view_symbol != SymbolForTrading)
    {
        m_trade_view_symbol = SymbolForTrading;
        m_EdtTradeSymbol.Text(SymbolForTrading);
        m_LblSymbolStatus.Text("当前图表 / 下单品种：" + SymbolForTrading);
        m_LblSymbolStatus.Color(clrDarkSlateGray);
    }
    if (!m_minimized && sets.SelectedTab == MainTab) RefreshTradeSymbolChoices();
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

void CPositionSizeCalculator::OnChangeRRClosePercent()
{
    long percentage = m_CmbRRClosePercent.Value();
    if (percentage > 0) m_EdtRRClosePercent.Text(IntegerToString(percentage));
}

void CPositionSizeCalculator::OnClickRRManualClose()
{
    double percent;
    if (m_rr_position_id == 0) { SetRRStatus("请先从下拉列表选择要平仓的持仓。", true); return; }
    if (!RRPlanParseNumber(m_EdtRRClosePercent.Text(), percent) || percent <= 0 || percent > 100)
    { SetRRStatus("平仓比例请输入大于 0 且不超过 100 的数字。", true); return; }
    string error;
    if (!RMRequestClose(m_rr_position_id, percent, sets.MagicNumber, error)) { SetRRStatus(error, true); return; }
    SetRRStatus("已提交按点击时余仓的 " + DoubleToString(percent, CountDecimalPlaces(percent)) + "% 平仓；以成交回报为准。");
    m_rr_last_refresh = 0;
}
