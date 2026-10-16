// Recover only this extension's orphaned GUI objects. Never touch orders,
// positions, another EA's panel, or user drawings with unrelated names.
#ifndef PS_RR_PANEL_RECOVERY_MQH
#define PS_RR_PANEL_RECOVERY_MQH

bool RRIsDialogPrefix(const string prefix)
{
    // CAppDialog::CreateInstanceId() uses rand() formatted as five digits.
    if (StringLen(prefix) != 5) return false;
    for (int i = 0; i < 5; i++)
    {
        ushort c = StringGetCharacter(prefix, i);
        if (c < '0' || c > '9') return false;
    }
    return true;
}

string RROrphanPrefix(const string object_name, const string caption)
{
    if (StringFind(caption, "Position Sizer RR (ver. ") != 0) return "";
    if (StringLen(object_name) != 12 || StringSubstr(object_name, 5) != "Caption") return "";
    string prefix = StringSubstr(object_name, 0, 5);
    return RRIsDialogPrefix(prefix) ? prefix : "";
}

bool RRIsDialogObject(const string object_name, const string prefix)
{
    if (!RRIsDialogPrefix(prefix) || StringFind(object_name, prefix) != 0) return false;
    string suffix = StringSubstr(object_name, 5);
    return suffix == "Border" || suffix == "Back" || suffix == "Caption"
        || suffix == "Close" || suffix == "MinMax"
        || StringFind(suffix, "Client") == 0 || StringFind(suffix, "m_") == 0;
}

bool RRIsDialogObjectType(const long object_type)
{
    // A coincidentally matching name must never turn a price line or other
    // user drawing into an owned GUI object.
    return object_type == OBJ_RECTANGLE_LABEL || object_type == OBJ_LABEL
        || object_type == OBJ_EDIT || object_type == OBJ_BUTTON
        || object_type == OBJ_BITMAP_LABEL;
}

int RRDeletePanelObjects(const long chart, const string prefix)
{
    if (!RRIsDialogPrefix(prefix)) return 0;
    int removed = 0;
    for (int i = ObjectsTotal(chart) - 1; i >= 0; i--)
    {
        string name = ObjectName(chart, i);
        if (RRIsDialogObject(name, prefix)
            && RRIsDialogObjectType(ObjectGetInteger(chart, name, OBJPROP_TYPE))
            && ObjectDelete(chart, name)) removed++;
    }
    return removed;
}

void RRClearOrphanPanels()
{
    // Called before creating this instance; a chart can run only one EA.
    int removed = 0;
    for (int i = ObjectsTotal(ChartID()) - 1; i >= 0; i--)
    {
        string name = ObjectName(ChartID(), i);
        if (!RRIsDialogObjectType(ObjectGetInteger(ChartID(), name, OBJPROP_TYPE))) continue;
        string prefix = RROrphanPrefix(name, ObjectGetString(ChartID(), name, OBJPROP_TEXT));
        if (prefix == "") continue;
        int count = RRDeletePanelObjects(ChartID(), prefix);
        removed += count;
        if (count > 0) i = ObjectsTotal(ChartID());
    }
    if (removed > 0)
    {
        ChartRedraw();
        PrintFormat("[PS RR] 已清理 %d 个旧版 RR 残留面板对象。", removed);
    }
}
#endif
