// Account-wide selection and explicit trading actions. Draft edits never send orders.
bool CPositionSizeCalculator::ComboBoxCreate(CPanelList *list, CRRPanelComboBox &combo, int x1, int y1, int x2, int y2, string name)
{
    combo.ListViewItems(6);
    if (!combo.Create(m_chart_id, m_name + name, m_subwin, x1, y1, x2, y2)) return false;
    if (!Add(combo)) return false;
    list.CreateListElementByName(combo, name);
    ObjectSetInteger(m_chart_id, m_name + name + "Edit", OBJPROP_FONTSIZE, RRPanelScaleFont(9));
    return true;
}

bool CPositionSizeCalculator::CreateTradeControlOptions()
{
    int x = first_column_start;
    int right = x + (int)MathRound(307 * m_DPIScale);
    int h = element_height;
    // Reserve a row above the original trading controls for the two subpages.
    for (CStringForList *obj = TradingTabList.GetFirstNode(); obj != NULL; obj = TradingTabList.GetNextNode())
        obj.Obj.Move(obj.Obj.Left(), obj.Obj.Top() + (int)MathRound(24 * m_DPIScale));
    int page_y = (int)MathRound(42 * m_DPIScale);
    if (!ButtonCreate(TradingTabList, m_BtnTradeRegularPage, x, page_y, x + (int)MathRound(151 * m_DPIScale), page_y + h, "m_BtnTradeRegularPage", "常规交易")) return false;
    if (!ButtonCreate(TradingTabList, m_BtnTradeBatchPage, x + (int)MathRound(160 * m_DPIScale), page_y, right, page_y + h, "m_BtnTradeBatchPage", "分批开仓")) return false;
    m_BtnTradeRegularPage.FontSize(RRPanelScaleFont(9)); m_BtnTradeBatchPage.FontSize(RRPanelScaleFont(9));
    int y = m_ChkAskForConfirmation.Top() - ClientAreaTop() + (int)MathRound(24 * m_DPIScale);
    if (!CheckBoxCreate(TradingTabList, m_ChkCloseOpposite, x, y, right, y + h, "m_ChkCloseOpposite", "反向开仓先平同品种全部反向仓", "包含手动单和其他 EA；确认全部平完后才继续新开仓")) return false;
    m_ChkCloseOpposite.Checked(RCCloseOpposite);
    ObjectSetInteger(m_chart_id, m_name + "m_ChkCloseOppositeLabel", OBJPROP_FONTSIZE, RRPanelScaleFont(9));
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblReverseStatus, x, y, x + (int)MathRound(215 * m_DPIScale), y + h, "m_LblReverseStatus", "")) return false;
    if (!ButtonCreate(TradingTabList, m_BtnCancelReverse, x + (int)MathRound(220 * m_DPIScale), y, right, y + h, "m_BtnCancelReverse", "取消后续开仓")) return false;
    m_LblReverseStatus.FontSize(RRPanelScaleFont(9));
    m_BtnCancelReverse.FontSize(RRPanelScaleFont(9));
    y += (int)MathRound(24 * m_DPIScale);
    if (!CheckBoxCreate(TradingTabList, m_ChkBatchEnabled, x, y, right, y + h, "m_ChkBatchEnabled", "启用父订单分批开仓（市价 / 对冲）", "仅市价分批；挂单正常提交、不拆子单。统一子单上限；保存后生效，不修改正在执行的父订单")) return false;
    m_ChkBatchEnabled.Checked(RBEnabled);
    ObjectSetInteger(m_chart_id, m_name + "m_ChkBatchEnabledLabel", OBJPROP_FONTSIZE, RRPanelScaleFont(9));
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblBatchLots, x, y, x + (int)MathRound(80 * m_DPIScale), y + h, "m_LblBatchLots", "子单上限(手)")) return false;
    if (!EditCreate(TradingTabList, m_EdtBatchLots, x + (int)MathRound(84 * m_DPIScale), y, x + (int)MathRound(140 * m_DPIScale), y + h, "m_EdtBatchLots", DoubleToString(RBChildMaxLots, CountDecimalPlaces(RBChildMaxLots)))) return false;
    if (!LabelCreate(TradingTabList, m_LblBatchInterval, x + (int)MathRound(153 * m_DPIScale), y, x + (int)MathRound(239 * m_DPIScale), y + h, "m_LblBatchInterval", "间隔（毫秒）")) return false;
    if (!EditCreate(TradingTabList, m_EdtBatchInterval, x + (int)MathRound(246 * m_DPIScale), y, right, y + h, "m_EdtBatchInterval", IntegerToString(RBIntervalMilliseconds))) return false;
    ObjectSetString(m_chart_id, m_name + "m_EdtBatchInterval", OBJPROP_TOOLTIP, "最短发单间隔：100毫秒=0.1秒；仍须等待上一子单成交和止损确认。保存仅影响新父订单。");
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblBatchDeviation, x, y, x + (int)MathRound(239 * m_DPIScale), y + h, "m_LblBatchDeviation", "最大入场偏离（点，0 关闭）")) return false;
    if (!EditCreate(TradingTabList, m_EdtBatchDeviation, x + (int)MathRound(246 * m_DPIScale), y, right, y + h, "m_EdtBatchDeviation", IntegerToString(RBMaxDeviationPoints))) return false;
    y += (int)MathRound(24 * m_DPIScale);
    if (!ButtonCreate(TradingTabList, m_BtnBatchSave, x, y, x + (int)MathRound(151 * m_DPIScale), y + h, "m_BtnBatchSave", "保存并应用分批设置")) return false;
    if (!ButtonCreate(TradingTabList, m_BtnBatchCancel, x + (int)MathRound(160 * m_DPIScale), y, right, y + h, "m_BtnBatchCancel", "取消剩余开仓")) return false;
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblBatchStatus, x, y, right, y + h, "m_LblBatchStatus", "")) return false;
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblBatchStatus2, x, y, right, y + h, "m_LblBatchStatus2", "")) return false;
    y += (int)MathRound(24 * m_DPIScale);
    if (!LabelCreate(TradingTabList, m_LblBatchStatus3, x, y, right, y + h, "m_LblBatchStatus3", "")) return false;
    m_LblBatchLots.FontSize(RRPanelScaleFont(9)); m_LblBatchInterval.FontSize(RRPanelScaleFont(9)); m_LblBatchDeviation.FontSize(RRPanelScaleFont(9));
    m_BtnBatchSave.FontSize(RRPanelScaleFont(9)); m_BtnBatchCancel.FontSize(RRPanelScaleFont(9));
    m_LblBatchStatus.FontSize(RRPanelScaleFont(9)); m_LblBatchStatus2.FontSize(RRPanelScaleFont(9)); m_LblBatchStatus3.FontSize(RRPanelScaleFont(9));
    RefreshBatchStatus();
    return true;
}


void CPositionSizeCalculator::OnClickTradeRegularPage()
{
    if (!m_controls_ready || !m_trade_batch_page) return;
    m_trade_batch_page = false;
    MoveAndResize();
    ChartRedraw();
}

void CPositionSizeCalculator::OnClickTradeBatchPage()
{
    if (!m_controls_ready || m_trade_batch_page) return;
    m_trade_batch_page = true;
    MoveAndResize();
    ChartRedraw();
}

void CPositionSizeCalculator::RefreshTradingSubpage()
{
    if (!m_controls_ready) return;
    bool visible = sets.SelectedTab == TradingTab && !m_minimized;
    for (CStringForList *obj = TradingTabList.GetFirstNode(); obj != NULL; obj = TradingTabList.GetNextNode())
    {
        bool shared = obj.Name == "m_BtnTrade" || obj.Name == "m_BtnTradeRegularPage" || obj.Name == "m_BtnTradeBatchPage";
        bool batch = StringFind(obj.Name, "Batch") >= 0;
        if (visible && !obj.Hidden && (shared || batch == m_trade_batch_page)) obj.Obj.Show();
        else obj.Obj.Hide();
    }
    m_BtnTradeRegularPage.ColorBackground(m_trade_batch_page ? CONTROLS_BUTTON_COLOR_DISABLE : CONTROLS_BUTTON_COLOR_ENABLE);
    m_BtnTradeBatchPage.ColorBackground(m_trade_batch_page ? CONTROLS_BUTTON_COLOR_ENABLE : CONTROLS_BUTTON_COLOR_DISABLE);
}

void CPositionSizeCalculator::LayoutTradingSubpage()
{
    if (!m_controls_ready) return;
    int row = (int)MathRound(24 * m_DPIScale);
    int top = ClientAreaTop() + (int)MathRound(68 * m_DPIScale);
    m_BtnTradeRegularPage.Move(m_BtnTradeRegularPage.Left(), top);
    m_BtnTradeBatchPage.Move(m_BtnTradeBatchPage.Left(), top);
    m_BtnTrade.Move(m_BtnTrade.Left(), top + row);
    m_ChkCloseOpposite.Move(m_ChkCloseOpposite.Left(), m_ChkAskForConfirmation.Top() + row);
    m_LblReverseStatus.Move(m_LblReverseStatus.Left(), m_ChkAskForConfirmation.Top() + 2 * row);
    m_BtnCancelReverse.Move(m_BtnCancelReverse.Left(), m_LblReverseStatus.Top());
    top = m_BtnTrade.Top();
    m_ChkBatchEnabled.Move(m_ChkBatchEnabled.Left(), top + row);
    m_LblBatchLots.Move(m_LblBatchLots.Left(), top + 2 * row);
    m_EdtBatchLots.Move(m_EdtBatchLots.Left(), m_LblBatchLots.Top());
    m_LblBatchInterval.Move(m_LblBatchInterval.Left(), m_LblBatchLots.Top());
    m_EdtBatchInterval.Move(m_EdtBatchInterval.Left(), m_LblBatchLots.Top());
    m_LblBatchDeviation.Move(m_LblBatchDeviation.Left(), top + 3 * row);
    m_EdtBatchDeviation.Move(m_EdtBatchDeviation.Left(), m_LblBatchDeviation.Top());
    m_BtnBatchSave.Move(m_BtnBatchSave.Left(), top + 4 * row);
    m_BtnBatchCancel.Move(m_BtnBatchCancel.Left(), m_BtnBatchSave.Top());
    m_LblBatchStatus.Move(m_LblBatchStatus.Left(), top + 5 * row);
    m_LblBatchStatus2.Move(m_LblBatchStatus2.Left(), top + 6 * row);
    m_LblBatchStatus3.Move(m_LblBatchStatus3.Left(), top + 7 * row);
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
    RefreshBatchStatus();
    // Cancellation only stops the queued entry; accepted exits continue.
    if (RCReversePending) m_BtnCancelReverse.Enable(); else m_BtnCancelReverse.Disable();
}


void CPositionSizeCalculator::OnClickBatchSave()
{
    double lots, interval, deviation;
    if (!RRPlanParseNumber(m_EdtBatchLots.Text(), lots) || lots <= 0 ||
        !RRPlanParseNumber(m_EdtBatchInterval.Text(), interval) || interval < 100 || interval > 3600000 || interval != MathFloor(interval) ||
        !RRPlanParseNumber(m_EdtBatchDeviation.Text(), deviation) || deviation < 0 || deviation > 2147483647 || deviation != MathFloor(deviation))
    {
        m_batch_feedback = "每子手数须大于0；间隔100–3600000整数毫秒；偏离填非负整数点。";
        m_batch_feedback_error = true;
        RefreshBatchStatus(); return;
    }
    string error;
    if (!RBSaveSettings(m_ChkBatchEnabled.Checked(), lots, (int)interval, (int)deviation, error))
    {
        m_batch_feedback = error; m_batch_feedback_error = true;
        RefreshBatchStatus(); return;
    }
    m_batch_feedback = "分批设置已保存，仅影响新父订单；挂单正常提交、不拆子单。100毫秒=0.1秒，仍等成交与止损确认。";
    m_batch_feedback_error = false;
    RefreshValues();
    RefreshBatchStatus();
}

void CPositionSizeCalculator::OnClickBatchCancel()
{
    RBCancelEntry();
    if (RBEntryActive())
    {
        m_batch_feedback = "取消尚未完成，请稍后重试。";
        m_batch_feedback_error = true;
    }
    else
    {
        m_batch_feedback = "已取消尚未发送的子单；已成交仓位继续保留。";
        m_batch_feedback_error = false;
    }
    RefreshBatchStatus();
}

void CPositionSizeCalculator::RefreshBatchStatus()
{
    // Do not reload edits here: timers must preserve unfinished settings drafts.
    string status = RBStatusText();
    if (status == "") status = RBEnabled ? "分批已启用：仅市价分批；挂单正常提交、不拆子单。" : "分批未启用；填写后点击保存并应用。";
    if (m_batch_feedback != "") status = m_batch_feedback_error ? m_batch_feedback + " · " + status : status + " · " + m_batch_feedback;
    m_LblBatchStatus.Text(StringSubstr(status, 0, 25));
    m_LblBatchStatus2.Text(StringSubstr(status, 25, 25));
    m_LblBatchStatus3.Text(StringSubstr(status, 50, 25));
    m_LblBatchStatus.Color(m_batch_feedback_error ? clrFireBrick : clrDarkSlateGray);
    m_LblBatchStatus2.Color(m_batch_feedback_error ? clrFireBrick : clrDarkSlateGray);
    m_LblBatchStatus3.Color(m_batch_feedback_error ? clrFireBrick : clrDarkSlateGray);
    ObjectSetString(ChartID(), m_name + "m_LblBatchStatus", OBJPROP_TOOLTIP, status);
    ObjectSetString(ChartID(), m_name + "m_LblBatchStatus2", OBJPROP_TOOLTIP, status);
    ObjectSetString(ChartID(), m_name + "m_LblBatchStatus3", OBJPROP_TOOLTIP, status);
    if (RBEntryActive()) m_BtnBatchCancel.Enable(); else m_BtnBatchCancel.Disable();
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
    long selected = m_rr_group_id != 0 ? -(long)m_rr_group_id : (long)m_rr_position_id;
    if (m_CmbRRPosition.Value() != selected) return;
    ulong groups[];
    int group_count = RBCollectGroups(groups);
    string group_labels[];
    ArrayResize(group_labels, group_count);
    string signature = "";
    for (int i = 0; i < group_count; i++)
    {
        RRState state;
        string symbol, error;
        double remaining, server_tp;
        bool readable = RBReadManagedGroup(groups[i], state, symbol, remaining, server_tp, error);
        bool building = RBGroupBuilding(groups[i]);
        bool ended = readable && remaining <= 0 && !building;
        // Keep the selected historical group identifiable, without listing the
        // account's entire archive on every future trade.
        if (ended && groups[i] != m_rr_group_id) { group_labels[i] = ""; continue; }
        group_labels[i] = (readable ? symbol : "父订单") + " · 父ID " + IntegerToString((long)groups[i]) + (ended ? " · 已结束" : "");
        signature += group_labels[i] + "|";
    }
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket == 0) continue;
        signature += IntegerToString(PositionGetInteger(POSITION_IDENTIFIER)) + ":" + IntegerToString(ticket) + ":" + PositionGetString(POSITION_SYMBOL) + ":" + IntegerToString(PositionGetInteger(POSITION_TYPE)) + "|";
    }
    if (signature == m_rr_position_choices) return;
    m_rr_position_choices = signature;
    m_CmbRRPosition.ItemsClear();
    m_CmbRRPosition.AddItem("选择持仓 / 父订单（整个账户）", 0);
    bool found = false;
    for (int i = 0; i < group_count; i++)
    {
        if (group_labels[i] == "") continue;
        m_CmbRRPosition.AddItem(group_labels[i], -(long)groups[i]);
        if (groups[i] == m_rr_group_id) found = true;
    }
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket == 0) continue;
        long identifier = PositionGetInteger(POSITION_IDENTIFIER);
        string label = PositionGetString(POSITION_SYMBOL) + " #" + IntegerToString(ticket) + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? " 买入" : " 卖出");
        ulong parent = RBPositionParent((ulong)identifier);
        if (parent != 0) label += " · 子单 父" + IntegerToString((long)parent);
        m_CmbRRPosition.AddItem(label, identifier);
        if ((ulong)identifier == m_rr_position_id && m_rr_group_id == 0) found = true;
    }
    if (!found && selected != 0) m_CmbRRPosition.AddItem(m_rr_position_symbol + " · 已关闭 / 请撤销草稿", selected);
    m_CmbRRPosition.SelectByValue(selected);
}

void CPositionSizeCalculator::OnChangeRRPosition()
{
    long value = m_CmbRRPosition.Value();
    long selected = m_rr_group_id != 0 ? -(long)m_rr_group_id : (long)m_rr_position_id;
    if (value == selected) return;
    CaptureRRPage();
    if (value == 0 || m_rr_dirty)
    {
        m_CmbRRPosition.SelectByValue(selected);
        if (m_rr_dirty) SetRRStatus("请先保存或撤销草稿，再切换持仓。", true);
        return;
    }
    bool loaded = value < 0 ? LoadRRGroupDraft((ulong)(-value)) : LoadRRPositionDraft((ulong)value);
    if (!loaded) m_CmbRRPosition.SelectByValue(selected);
}

void CPositionSizeCalculator::RefreshRRManualAction()
{
    bool selected = m_rr_group_id != 0 || (m_rr_position_id != 0 && SelectRRPanelPosition(m_rr_position_id));
    // The action remains clickable without a selection, but only opens a chooser.
    m_BtnRRManualClose.Enable();
    m_BtnRRManualClose.Text(selected ? "按比例平仓" : "先选择持仓");
    m_LblRRManualInfo.Text(selected ? "每次按当前余仓；下方目标按初始仓位。" : "未选中有效持仓：请先选择上方订单。");
    m_LblRRManualInfo.Color(selected ? clrDarkSlateGray : clrFireBrick);
    if (m_rr_group_id == 0 && m_rr_position_id != 0 && RBPositionParent(m_rr_position_id) != 0)
    {
        m_BtnRRManualClose.Text("请选父订单");
        m_LblRRManualInfo.Text("此为子单；请选父ID " + IntegerToString((long)RBPositionParent(m_rr_position_id)));
    }
}

void CPositionSizeCalculator::OnClickRRManualClose()
{
    if (m_rr_group_id == 0 && (m_rr_position_id == 0 || !SelectRRPanelPosition(m_rr_position_id)))
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
    if (m_rr_position_id != 0 && RBPositionParent(m_rr_position_id) != 0)
    {
        SetRRStatus("此单属于父订单；请在列表选择父ID统一按比例平仓。", true); return;
    }
    string error;
    bool accepted = m_rr_group_id != 0 ? RBRequestGroupClose(m_rr_group_id, percent, error) : RMRequestClose(m_rr_position_id, percent, sets.MagicNumber, error);
    if (!accepted)
    {
        m_LblRRManualInfo.Text(StringSubstr(error, 0, 25));
        m_LblRRManualInfo.Color(clrFireBrick);
        SetRRStatus(error, true); return;
    }
    m_LblRRManualInfo.Text("已登记平当前余仓 " + DoubleToString(percent, CountDecimalPlaces(percent)) + "% · 等待成交");
    SetRRStatus("已登记按点击时余仓的 " + DoubleToString(percent, CountDecimalPlaces(percent)) + "% 平仓；以成交回报为准。");
    m_rr_last_refresh = 0;
}
