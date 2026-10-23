// Only the dialog is replaced. Trading managers and journals remain live.
string RRScaleBitmapKeys[], RRScaleBitmapNames[];

string RRScaleBitmap(const string original)
{
    if (original == "" || RRPanelScalePercent == 100) return original;
    string key = IntegerToString(RRPanelScalePercent) + "|" + original;
    for (int i = 0; i < ArraySize(RRScaleBitmapKeys); i++)
        if (RRScaleBitmapKeys[i] == key) return RRScaleBitmapNames[i];
    uint pixels[], width = 0, height = 0;
    if (!ResourceReadImage(original, pixels, width, height) || width == 0 || height == 0) return original;
    int scaled_width = (int)MathMax(1, RRPanelScalePixels((int)width));
    int scaled_height = (int)MathMax(1, RRPanelScalePixels((int)height));
    uint scaled[];
    if (ArrayResize(scaled, scaled_width * scaled_height) != scaled_width * scaled_height) return original;
    for (int y = 0; y < scaled_height; y++)
        for (int x = 0; x < scaled_width; x++)
            scaled[y * scaled_width + x] = pixels[(int)(y * height / scaled_height) * width + (int)(x * width / scaled_width)];
    int index = ArraySize(RRScaleBitmapKeys);
    string name = "::PSRR_PanelScale_" + IntegerToString(index);
    if (!ResourceCreate(name, scaled, scaled_width, scaled_height, 0, 0, 0, COLOR_FORMAT_ARGB_NORMALIZE)) return original;
    ArrayResize(RRScaleBitmapKeys, index + 1);
    ArrayResize(RRScaleBitmapNames, index + 1);
    RRScaleBitmapKeys[index] = key;
    RRScaleBitmapNames[index] = name;
    return name;
}

void RRScalePanelBitmaps(CWnd *root)
{
    CBmpButton *button = dynamic_cast<CBmpButton *>(root);
    if (button != NULL && RRPanelScalePercent != 100)
    {
        int width = button.Width(), height = button.Height();
        // Read the applied bitmap so dark/high-DPI variants remain selected.
        string off = ObjectGetString(ChartID(), button.Name(), OBJPROP_BMPFILE, 0);
        string on = ObjectGetString(ChartID(), button.Name(), OBJPROP_BMPFILE, 1);
        string passive = button.BmpPassiveName(), active = button.BmpActiveName();
        button.BmpNames(RRScaleBitmap(off), RRScaleBitmap(on));
        if (passive != "") button.BmpPassiveName(RRScaleBitmap(passive));
        if (active != "") button.BmpActiveName(RRScaleBitmap(active));
        button.Size(width, height); // Accessors can change internal rectangle.
    }
    CWndContainer *container = dynamic_cast<CWndContainer *>(root);
    if (container != NULL)
        for (int i = 0; i < container.ControlsTotal(); i++) RRScalePanelBitmaps(container.Control(i));
}

void RRScaleShiftList(CPanelList *list, const int offset)
{
    for (CStringForList *item = list.GetFirstNode(); item != NULL; item = list.GetNextNode())
        item.Obj.Move(item.Obj.Left(), item.Obj.Top() + offset);
}

bool CPositionSizeCalculator::CreatePanelScaleControls()
{
    int offset = (int)MathRound(26 * m_DPIScale);
    RRScaleShiftList(MainTabList, offset);
    RRScaleShiftList(RiskTabList, offset);
    RRScaleShiftList(MarginTabList, offset);
    RRScaleShiftList(SwapsTabList, offset);
    RRScaleShiftList(TradingTabList, offset);
    RRScaleShiftList(RRTabList, offset);
    RRScaleShiftList(GuardTabList, offset);
    int x = first_column_start;
    int y = (int)MathRound(33 * m_DPIScale);
    int h = element_height;
    if (!LabelCreate(PersistentList, m_LblScale, x + (int)MathRound(159 * m_DPIScale), y, x + (int)MathRound(307 * m_DPIScale), y + h, "m_LblScale", "面板缩放")) return false;
    int unit = (int)MathRound(37 * m_DPIScale);
    if (!ButtonCreate(PersistentList, m_BtnScaleDown, x, y, x + unit, y + h, "m_BtnScaleDown", "-", "缩小 25%；仅影响当前图表面板")) return false;
    x += unit + (int)MathRound(4 * m_DPIScale);
    if (!ButtonCreate(PersistentList, m_BtnScaleReset, x, y, x + (int)MathRound(62 * m_DPIScale), y + h, "m_BtnScaleReset", IntegerToString(RRPanelScalePercent) + "%", "点击恢复 100%")) return false;
    x += (int)MathRound(66 * m_DPIScale);
    if (!ButtonCreate(PersistentList, m_BtnScaleUp, x, y, x + unit, y + h, "m_BtnScaleUp", "+", "放大 25%；范围 75%–200%")) return false;
    m_LblScale.FontSize(RRPanelScaleFont(9));
    m_BtnScaleDown.FontSize(RRPanelScaleFont(9));
    m_BtnScaleReset.FontSize(RRPanelScaleFont(9));
    m_BtnScaleUp.FontSize(RRPanelScaleFont(9));
    if (RRPanelScalePercent == 75) m_BtnScaleDown.Disable();
    if (RRPanelScalePercent == 200) m_BtnScaleUp.Disable();
    return true;
}

void CPositionSizeCalculator::PrepareScaleDraft()
{
    if (m_rr_visible) CaptureRRPage();
    if (m_guard_visible) CaptureGuardDraft();
    m_CmbRRPosition.CloseDropDown();
}

// Match stable suffixes, never control IDs or a random dialog prefix.
CWnd *RRScaleFindControl(CWnd *root, const string name)
{
    if (root == NULL) return NULL;
    if (root.Name() == name) return root;
    CWndContainer *container = dynamic_cast<CWndContainer *>(root);
    if (container == NULL) return NULL;
    for (int i = 0; i < container.ControlsTotal(); i++)
    {
        CWnd *found = RRScaleFindControl(container.Control(i), name);
        if (found != NULL) return found;
    }
    return NULL;
}

void RRScaleCopyControls(CWnd *source, CWnd *destination, const string from_prefix, const string to_prefix)
{
    if (source == NULL || destination == NULL) return;
    string suffix = StringSubstr(source.Name(), StringLen(from_prefix));
    string target_name = to_prefix + suffix;
    CWnd *target = destination;
    if (target.Name() != target_name) target = RRScaleFindControl(destination, target_name);
    if (target != NULL && StringFind(suffix, "m_BtnScale") != 0 && suffix != "m_LblScale")
    {
        CEdit *edit = dynamic_cast<CEdit *>(source);
        CEdit *target_edit = dynamic_cast<CEdit *>(target);
        if (edit != NULL && target_edit != NULL)
        {
            target_edit.Text(edit.Text());
            target_edit.PropFlags(edit.PropFlags());
            target_edit.ReadOnly(edit.ReadOnly());
            target_edit.TextAlign(edit.TextAlign());
            if (edit.IsEnabled()) target_edit.Enable(); else target_edit.Disable();
        }
        CCheckBox *checkbox = dynamic_cast<CCheckBox *>(source);
        CCheckBox *target_checkbox = dynamic_cast<CCheckBox *>(target);
        if (checkbox != NULL && target_checkbox != NULL) target_checkbox.Checked(checkbox.Checked());
        CHorizontalRadioGroup *radio = dynamic_cast<CHorizontalRadioGroup *>(source);
        CHorizontalRadioGroup *target_radio = dynamic_cast<CHorizontalRadioGroup *>(target);
        if (radio != NULL && target_radio != NULL) target_radio.Value(radio.Value());
    }
    CWndContainer *container = dynamic_cast<CWndContainer *>(source);
    CWndContainer *target_container = dynamic_cast<CWndContainer *>(target);
    if (container != NULL)
        for (int i = 0; i < container.ControlsTotal(); i++)
        {
            CWnd *child = container.Control(i);
            CWnd *candidate = destination;
            // A fresh panel normally has the same control hierarchy. Walk it
            // once in parallel, checking names before copying any state. A
            // changed/reordered optional list falls back to the name lookup.
            if (child != NULL && target_container != NULL && i < target_container.ControlsTotal())
            {
                CWnd *peer = target_container.Control(i);
                if (peer != NULL && peer.Name() == to_prefix + StringSubstr(child.Name(), StringLen(from_prefix)))
                    candidate = peer;
            }
            RRScaleCopyControls(child, candidate, from_prefix, to_prefix);
        }
}

void CPositionSizeCalculator::CopyScaleDraftFrom(CPositionSizeCalculator &source)
{
    m_FileName = source.m_FileName;
    ATR_handle = source.ATR_handle;
    m_rr_page = source.m_rr_page;
    m_rr_count = source.m_rr_count;
    m_rr_expected_stage = source.m_rr_expected_stage;
    m_rr_live_stage = source.m_rr_live_stage;
    m_rr_stale = source.m_rr_stale;
    m_rr_readonly = source.m_rr_readonly;
    m_rr_dirty = source.m_rr_dirty;
    m_rr_position_id = source.m_rr_position_id;
    m_rr_group_id = source.m_rr_group_id;
    m_rr_last_refresh = source.m_rr_last_refresh;
    m_rr_expected_checksum = source.m_rr_expected_checksum;
    m_rr_state = source.m_rr_state;
    m_rr_loaded_plan = source.m_rr_loaded_plan;
    m_rr_has_plan = source.m_rr_has_plan;
    m_rr_position_magic = source.m_rr_position_magic;
    m_rr_position_symbol = source.m_rr_position_symbol;
    m_rr_position_choices = "";
    for (int i = 0; i < RR_MAX_TARGETS; i++)
    {
        m_rr_multiple[i] = source.m_rr_multiple[i];
        m_rr_percent[i] = source.m_rr_percent[i];
        m_rr_original_multiple[i] = source.m_rr_original_multiple[i];
        m_rr_source_index[i] = source.m_rr_source_index[i];
        m_rr_be[i] = source.m_rr_be[i];
    }
    m_trade_batch_page = source.m_trade_batch_page;
    m_batch_feedback = source.m_batch_feedback;
    m_batch_feedback_error = source.m_batch_feedback_error;
    m_trade_controls_refresh = source.m_trade_controls_refresh;
    m_guard_draft = source.m_guard_draft;
    m_guard_saved = source.m_guard_saved;
    m_guard_dirty = source.m_guard_dirty;
    m_guard_stale = source.m_guard_stale;
    m_guard_revision = source.m_guard_revision;
    m_guard_last_refresh = source.m_guard_last_refresh;
    m_guard_account_key = source.m_guard_account_key;
    RenderRRPage();
    UpdateRRModeLabels();
    // Ordinary refresh deliberately refuses to replace a pending user choice.
    // Seed the restored selection before refreshing so that guard still works.
    long selected = m_rr_group_id != 0 ? -(long)m_rr_group_id : (long)m_rr_position_id;
    if (selected != 0)
    {
        m_CmbRRPosition.ItemAdd(source.m_CmbRRPosition.Select(), selected);
        m_CmbRRPosition.SelectByValue(selected);
    }
    RefreshRRPositionChoices();
    RenderGuardDraft();
    MoveAndResize();
    // Restore actual edit strings last, including incomplete numeric inputs.
    RRScaleCopyControls(GetPointer(source), GetPointer(this), source.Name(), Name());
    m_LblRRStatus.Text(source.m_LblRRStatus.Text());
    m_LblRRStatus2.Text(source.m_LblRRStatus2.Text());
    m_LblRRStatus.Color(source.m_LblRRStatus.Color());
    m_LblRRStatus2.Color(source.m_LblRRStatus2.Color());
    m_LblGuardStatus.Text(source.m_LblGuardStatus.Text());
    m_LblGuardStatus2.Text(source.m_LblGuardStatus2.Text());
    m_LblGuardStatus.Color(source.m_LblGuardStatus.Color());
    m_LblGuardStatus2.Color(source.m_LblGuardStatus2.Color());
    remember_left = source.Left();
    remember_top = source.Top();
    Move(remember_left, remember_top);
    KeepScaleControlsReachable();
    FixatePanelPosition();
    if (source.IsMinimized()) Minimize();
}

bool CPositionSizeCalculator::RunForScale()
{
    // Do not run the wrapper that deletes the old dialog before commit.
    if (!CAppDialog::Run()) return false;
    RRPanelScaleIdBase += CONTROLS_MAXIMUM_ID;
    Id(RRPanelScaleIdBase);
    return true;
}

void CPositionSizeCalculator::KeepScaleControlsReachable()
{
    if (!m_controls_ready) return;
    int chart_width = (int)ChartGetInteger(ChartID(), CHART_WIDTH_IN_PIXELS);
    int chart_height = (int)ChartGetInteger(ChartID(), CHART_HEIGHT_IN_PIXELS);
    if (chart_width <= 0 || chart_height <= 0) return;
    int top_limit = (int)MathMax(0, chart_height - (m_BtnScaleUp.Bottom() - Top()) - 8);
    int left_limit = (int)MathMax(0, chart_width - Width());
    int x = (int)MathMax(0, MathMin(Left(), left_limit));
    int y = (int)MathMax(0, MathMin(Top(), top_limit));
    if (x != Left() || y != Top()) Move(x, y);
    remember_left = Left(); remember_top = Top();
    FixatePanelPosition();
}
