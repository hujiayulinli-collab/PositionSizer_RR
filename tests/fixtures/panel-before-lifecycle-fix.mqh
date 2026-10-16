// Exact lifecycle methods extracted from the supplied unmodified Position Sizer 3.14 source.

// This fixture preserves the former early virtual callback failure for regression testing.

void CPositionSizeCalculator::Maximize()
{
    if (!NoPanelMaximization)
    {
        sets.IsPanelMinimized = false;
        CAppDialog::Maximize();
    }
    else if (m_minimized) CAppDialog::Minimize();

    HideRisk();
    HideMargin();
    HideMain();
    HideSwaps();
    HideTrading();

    if (!m_minimized)
    {
        if (sets.SelectedTab == MainTab) ShowMain();
        else if (sets.SelectedTab == RiskTab) ShowRisk();
        else if (sets.SelectedTab == MarginTab) ShowMargin();
        else if (sets.SelectedTab == SwapsTab) ShowSwaps();
        else if (sets.SelectedTab == TradingTab) ShowTrading();
    }

    MoveAndResize();
    if (remember_left != -1) Move(remember_left, remember_top);
}

void CPositionSizeCalculator::Minimize()
{
    CAppDialog::Minimize();
    sets.IsPanelMinimized = true;
    if (remember_left != -1)
    {
        Move(remember_left, remember_top);
        m_min_rect.Move(remember_left, remember_top);
    }
    IniFileSave();
}

void CPositionSizeCalculator::HideShowMaximize()
{
    // Remember the panel's location.
    remember_left = Left();
    remember_top = Top();

// A weird fix for a weird bug. The TP line will get deselected by CWndContainer::Hide().
bool tp_line_selected = ObjectGetInteger(ChartID(), ObjectPrefix + "TakeProfitLine", OBJPROP_SELECTED);
    Hide();
ObjectSetInteger(ChartID(), ObjectPrefix + "TakeProfitLine", OBJPROP_SELECTED, tp_line_selected);
    Show();
    NoPanelMaximization = true;
    Maximize();
}

void CPositionSizeCalculator::InitVariables()
{
    LinesSelectedStatus = 0;
    remember_left = -1;
    remember_top = -1;
    MaxTakeProfitsNumber = 1;
    ChartWidth = ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
    CheckboxOnFile = "";
    CheckboxOffFile = "";
    RadiogroupOnFile = "";
    RadiogroupOffFile = "";
}

CPositionSizeCalculator::~CPositionSizeCalculator(void)
{
    delete MainTabList;
    delete RiskTabList;
    delete MarginTabList;
    delete SwapsTabList;
    delete TradingTabList;
    delete PersistentList;
}

void CPositionSizeCalculator::HideMain()
{
    m_BtnTabMain.ColorBackground(CONTROLS_BUTTON_COLOR_DISABLE);
    for (CStringForList * obj = MainTabList.GetFirstNode(); obj != NULL; obj = MainTabList.GetNextNode())
    {
        obj.Obj.Hide();
    }
}

void CPositionSizeCalculator::HideRisk()
{
    m_BtnTabRisk.ColorBackground(CONTROLS_BUTTON_COLOR_DISABLE);
    for (CStringForList * obj = RiskTabList.GetFirstNode(); obj != NULL; obj = RiskTabList.GetNextNode())
    {
        obj.Obj.Hide();
    }
}

void CPositionSizeCalculator::HideMargin()
{
    m_BtnTabMargin.ColorBackground(CONTROLS_BUTTON_COLOR_DISABLE);
    for (CStringForList * obj = MarginTabList.GetFirstNode(); obj != NULL; obj = MarginTabList.GetNextNode())
    {
        obj.Obj.Hide();
    }
}

void CPositionSizeCalculator::HideSwaps()
{
    m_BtnTabSwaps.ColorBackground(CONTROLS_BUTTON_COLOR_DISABLE);
    for (CStringForList * obj = SwapsTabList.GetFirstNode(); obj != NULL; obj = SwapsTabList.GetNextNode())
    {
        obj.Obj.Hide();
    }
}

void CPositionSizeCalculator::HideTrading()
{
    m_BtnTabTrading.ColorBackground(CONTROLS_BUTTON_COLOR_DISABLE);
    for (CStringForList * obj = TradingTabList.GetFirstNode(); obj != NULL; obj = TradingTabList.GetNextNode())
    {
        obj.Obj.Hide();
    }
}
