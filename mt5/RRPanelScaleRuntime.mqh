void RRApplyPanelTheme(CPositionSizeCalculator *dialog)
{
    if (DetectedColorMode)
    {
        int total = ObjectsTotal(ChartID());
        for (int i = 0; i < total; i++)
        {
            string obj_name = ObjectName(ChartID(), i);
            if (StringSubstr(obj_name, 0, StringLen(dialog.Name())) != dialog.Name()) continue; // Skip non-panel objects.
            if (obj_name == dialog.Name() + "Back")
            {

                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, DARKMODE_BG_DARK_COLOR);
            }
            if (obj_name == dialog.Name() + "Caption")
            {
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, DARKMODE_BG_DARK_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_COLOR, DARKMODE_CONTROL_BRODER_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BORDER_COLOR, DARKMODE_BG_DARK_COLOR);
            }
            else if (obj_name == dialog.Name() + "ClientBack")
            {
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_COLOR, DARKMODE_MAIN_AREA_BORDER_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, DARKMODE_MAIN_AREA_BG_COLOR);
            }
            else if (obj_name == dialog.Name() + "m_BtnEntry") // Long/Short
            {
                if (sets.TradeDirection == Long)
                {
                    ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, LongButtonColorAdjusted);
                }
                else if (sets.TradeDirection == Short)
                {
                    ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, ShortButtonColorAdjusted);
                }
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BORDER_COLOR, DARKMODE_CONTROL_BRODER_COLOR);
            }
            else if ((obj_name == dialog.Name() + "m_BtnMainTrade") || (obj_name == dialog.Name() + "m_BtnTrade") || (obj_name == dialog.Name() + "m_OutsideTradeButton")) // Any of the Trade buttons (Main tab, Trading tab, outside).
            {
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, TradeButtonColorAdjusted);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BORDER_COLOR, DARKMODE_CONTROL_BRODER_COLOR);
            }
            else if (StringSubstr(obj_name, 0, StringLen(dialog.Name() + "m_Edt")) == dialog.Name() + "m_Edt")
            {
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, DARKMODE_EDIT_BG_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BORDER_COLOR, DARKMODE_CONTROL_BRODER_COLOR);
            }
            else if (StringSubstr(obj_name, 0, StringLen(dialog.Name() + "m_Btn")) == dialog.Name() + "m_Btn")
            {
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, DARKMODE_BUTTON_BG_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BORDER_COLOR, DARKMODE_CONTROL_BRODER_COLOR);
            }
            else if (StringSubstr(obj_name, 0, StringLen(dialog.Name() + "m_Chk")) == dialog.Name() + "m_Chk")
            {
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_COLOR, DARKMODE_TEXT_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, DARKMODE_MAIN_AREA_BG_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BORDER_COLOR, DARKMODE_MAIN_AREA_BG_COLOR);
            }
            else if (StringSubstr(obj_name, 0, StringLen(dialog.Name() + "m_Rgp")) == dialog.Name() + "m_Rgp")
            {
                if (ObjectGetInteger(ChartID(), obj_name, OBJPROP_TYPE) == OBJ_RECTANGLE_LABEL) ObjectSetInteger(ChartID(), obj_name, OBJPROP_COLOR, DARKMODE_MAIN_AREA_BG_COLOR);
                else ObjectSetInteger(ChartID(), obj_name, OBJPROP_COLOR, DARKMODE_TEXT_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BGCOLOR, DARKMODE_MAIN_AREA_BG_COLOR);
                ObjectSetInteger(ChartID(), obj_name, OBJPROP_BORDER_COLOR, DARKMODE_MAIN_AREA_BG_COLOR);
            }
            else
            {
                if (obj_name == dialog.Name() + "m_LblURL") ObjectSetInteger(ChartID(), obj_name, OBJPROP_COLOR, 0x224400);
                else ObjectSetInteger(ChartID(), obj_name, OBJPROP_COLOR, DARKMODE_TEXT_COLOR);
            }
        }
    }

}

// Reserve an unused native dialog prefix before creating any chart objects.
// The standard library generates its prefix with the next rand() call.
bool RRPanelScaleReservePrefix()
{
    int total = ObjectsTotal(ChartID());
    for (int attempt = 0; attempt < 100; attempt++)
    {
        int seed = (int)(GetTickCount() + 7919 * attempt + RRPanelScaleIdBase);
        MathSrand(seed);
        string prefix = IntegerToString(rand(), 5, '0');
        bool occupied = false;
        for (int i = 0; i < total; i++)
            if (StringFind(ObjectName(ChartID(), i), prefix) == 0) { occupied = true; break; }
        if (occupied) continue;
        MathSrand(seed);
        return true;
    }
    return false;
}

void RRApplyPanelScale()
{
    if (RRPanelScalePending == 0 || RRPanelScaleBuilding || !RRPanelInitSucceeded ||
        CheckPointer(ExtDialog) != POINTER_DYNAMIC) return;
    int requested = RRPanelScalePending;
    RRPanelScalePending = 0;
    if (!RRPanelScaleValid(requested) || requested == RRPanelScalePercent) return;
    ulong started = GetTickCount64();
    CPositionSizeCalculator *previous = ExtDialog;
    previous.PrepareScaleDraft();
    Settings saved_settings = sets;
    int old_percent = RRPanelScalePercent;
    RRPanelScaleBuilding = true;
    RRPanelScalePercent = requested;
    ulong create_started = GetTickCount64();
    CPositionSizeCalculator *replacement = new CPositionSizeCalculator;
    bool ready = CheckPointer(replacement) == POINTER_DYNAMIC;
    if (ready) ready = RRPanelScaleReservePrefix();
    if (ready) ready = replacement.Create(0, "Position Sizer RR (ver. " + Version + ")", 0, previous.Left(), previous.Top());
    ulong create_ms = GetTickCount64() - create_started;
    sets = saved_settings;
    ulong restore_started = GetTickCount64();
    if (ready)
    {
        RRApplyPanelTheme(replacement);
        replacement.CopyScaleDraftFrom(previous);
        ready = replacement.RunForScale();
    }
    ulong restore_ms = GetTickCount64() - restore_started;
    if (!ready)
    {
        if (CheckPointer(replacement) == POINTER_DYNAMIC)
        {
            string failed_prefix = replacement.Name();
            replacement.Destroy();
            delete replacement;
            RRDeletePanelObjects(ChartID(), failed_prefix);
        }
        RRPanelScalePercent = old_percent;
        RRPanelScaleBuilding = false;
        sets = saved_settings;
        previous.FocusRRTargetLines();
        Print("[PS RR] 面板缩放失败，已保留原面板与全部交易状态。");
        ChartRedraw();
        return;
    }
    // Commit only a fully created/restored/runnable dialog. No EA lifecycle
    // callback, entry queue cancellation, account save, or journal mutation.
    ulong destroy_started = GetTickCount64();
    ExtDialog = replacement;
    string old_prefix = previous.Name();
    previous.Destroy();
    delete previous;
    RRDeletePanelObjects(ChartID(), old_prefix);
    ulong destroy_ms = GetTickCount64() - destroy_started;
    RRPanelScaleBuilding = false;
    ulong persist_started = GetTickCount64();
    ExtDialog.FocusRRTargetLines();
    ExtDialog.MoveOutsideTradeButton();
    ExtDialog.IniFileSave();
    if (!RRPanelScaleSave()) Print("[PS RR] 面板已缩放，但缩放偏好保存失败；重启后可能恢复旧比例。");
    ChartRedraw();
    PrintFormat("[PS RR UI] 缩放 %d%% -> %d%%：总计 %I64u ms（创建 %I64u / 恢复 %I64u / 清理 %I64u / 保存与绘制 %I64u）。",
        old_percent, RRPanelScalePercent, GetTickCount64() - started,
        create_ms, restore_ms, destroy_ms, GetTickCount64() - persist_started);
}
