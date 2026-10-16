// Chart annotations are read-only views of the saved plan. Never trade here.
#ifndef PS_RR_TARGET_LINES_MQH
#define PS_RR_TARGET_LINES_MQH

string RRLinePrefix = "PSRR_Targets_";
ulong RRLastLineRefresh = 0;
int RRLabelRows[];

string RRCompactNumber(const double value)
{
    string text = DoubleToString(value, 4);
    while (StringLen(text) > 0 && StringSubstr(text, StringLen(text) - 1) == "0")
        text = StringSubstr(text, 0, StringLen(text) - 1);
    if (StringSubstr(text, StringLen(text) - 1) == ".") text = StringSubstr(text, 0, StringLen(text) - 1);
    return text;
}

string RRTargetCaption(const string owner, const int index, const double multiple,
                       const double percent, const bool be, const double price,
                       const int digits, const bool triggered, const bool final_target,
                       const bool tp_pending, const bool paused)
{
    string text = owner + " | TP" + IntegerToString(index + 1) + " " + RRCompactNumber(multiple)
        + "R | " + DoubleToString(price, digits) + " | 平 " + RRCompactNumber(percent) + "%";
    if (be) text += " + BE";
    if (triggered) text += " [已触发]";
    else if (final_target && tp_pending) text += " [最终TP待同步]";
    else if (final_target && owner != "新仓预览") text += " [服务器TP]";
    if (paused) text += " [管理暂停]";
    return text;
}

void RRDeleteTargetLines()
{
    ObjectsDeleteAll(ChartID(), RRLinePrefix);
    RRLastLineRefresh = 0;
    ArrayResize(RRLabelRows, 0);
}

int RRPlaceTargetLabel(const int desired_y, const int height)
{
    int low = 22;
    int high = MathMax(low, height - 4);
    int desired = MathMax(low, MathMin(high, desired_y));
    for (int distance = 0; distance <= high - low; distance += 18)
    {
        for (int side = 0; side < 2; side++)
        {
            int candidate = desired + (side == 0 ? distance : -distance);
            if (candidate < low || candidate > high) continue;
            bool available = true;
            for (int i = 0; i < ArraySize(RRLabelRows); i++)
                if (MathAbs(candidate - RRLabelRows[i]) < 17) { available = false; break; }
            if (!available) continue;
            int count = ArraySize(RRLabelRows);
            ArrayResize(RRLabelRows, count + 1);
            RRLabelRows[count] = candidate;
            return candidate;
        }
    }
    return desired; // More labels than vertical pixels; prices remain on every line.
}

// Keep labels legible on light and dark charts without changing chart settings.
color RRTargetColor(const bool triggered, const bool be, const bool preview)
{
    color background = (color)ChartGetInteger(ChartID(), CHART_COLOR_BACKGROUND);
    int brightness = ((int)background & 255) + (((int)background >> 8) & 255) + (((int)background >> 16) & 255);
    bool light = brightness > 420;
    if (triggered) return light ? clrDimGray : clrSilver;
    if (preview) return light ? clrSlateBlue : clrLightSteelBlue;
    if (be) return light ? clrDarkOrange : clrGold;
    return light ? clrTeal : clrAqua;
}

void RRDrawTarget(const string key, const double price, const string caption,
                  const color shade, const bool triggered, const int ordinal)
{
    long chart = ChartID();
    string line = key + "_Line";
    if (ObjectFind(chart, line) < 0 && !ObjectCreate(chart, line, OBJ_HLINE, 0, 0, price)) return;
    ObjectSetDouble(chart, line, OBJPROP_PRICE, price);
    ObjectSetInteger(chart, line, OBJPROP_COLOR, shade);
    ObjectSetInteger(chart, line, OBJPROP_STYLE, triggered ? STYLE_DOT : STYLE_DASH);
    ObjectSetInteger(chart, line, OBJPROP_WIDTH, 1);
    ObjectSetInteger(chart, line, OBJPROP_SELECTABLE, false);
    ObjectSetInteger(chart, line, OBJPROP_SELECTED, false);
    ObjectSetInteger(chart, line, OBJPROP_HIDDEN, true);
    ObjectSetInteger(chart, line, OBJPROP_BACK, true);
    ObjectSetString(chart, line, OBJPROP_TEXT, caption);
    ObjectSetString(chart, line, OBJPROP_TOOLTIP, caption + "\n在分仓止盈页选择对应持仓修改；目标线不可拖动。");

    string label = key + "_Label";
    if (ObjectFind(chart, label) < 0 && !ObjectCreate(chart, label, OBJ_LABEL, 0, 0, 0)) return;
    int x = 0, y = 0;
    datetime time = iTime(_Symbol, _Period, 0);
    int height = (int)ChartGetInteger(chart, CHART_HEIGHT_IN_PIXELS, 0);
    string visible_caption = caption;
    bool located = time > 0 && ChartTimePriceToXY(chart, 0, time, price, x, y);
    if (!located)
    {
        ObjectSetString(chart, label, OBJPROP_TEXT, "");
        return;
    }
    if (y < 26) { y = 26; visible_caption = "↑ 图外 | " + caption; }
    else if (y > height - 20) { y = height - 20; visible_caption = "↓ 图外 | " + caption; }
    y = RRPlaceTargetLabel(y - 2, height);
    ObjectSetInteger(chart, label, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
    ObjectSetInteger(chart, label, OBJPROP_ANCHOR, ANCHOR_RIGHT_LOWER);
    ObjectSetInteger(chart, label, OBJPROP_XDISTANCE, 12);
    ObjectSetInteger(chart, label, OBJPROP_YDISTANCE, y);
    ObjectSetInteger(chart, label, OBJPROP_COLOR, shade);
    ObjectSetInteger(chart, label, OBJPROP_FONTSIZE, 9);
    ObjectSetInteger(chart, label, OBJPROP_SELECTABLE, false);
    ObjectSetInteger(chart, label, OBJPROP_HIDDEN, true);
    ObjectSetInteger(chart, label, OBJPROP_BACK, false);
    ObjectSetString(chart, label, OBJPROP_FONT, "Microsoft YaHei");
    ObjectSetString(chart, label, OBJPROP_TEXT, visible_caption);
    ObjectSetString(chart, label, OBJPROP_TOOLTIP, caption);
}

void RRPruneTargetRows(const string owner_prefix, const int count)
{
    for (int i = count; i < RR_MAX_TARGETS; i++)
    {
        string key = owner_prefix + IntegerToString(i);
        ObjectDelete(ChartID(), key + "_Line");
        ObjectDelete(ChartID(), key + "_Label");
    }
}

void RRRefreshTargetLines(const string symbol, const long magic, const double preview_entry,
                          const double preview_stop, const int preview_direction, const bool force = false)
{
    // Unlike the account manager, chart annotations never accept a wildcard:
    // another symbol's price has no meaning on this chart's vertical axis.
    if (symbol == "" || symbol != _Symbol) { RRDeleteTargetLines(); return; }
    if (!force && GetTickCount64() - RRLastLineRefresh < 500) return;
    RRLastLineRefresh = GetTickCount64();
    ArrayResize(RRLabelRows, 0);
    double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    if (!MathIsValidNumber(tick_size) || tick_size <= 0 || digits < 0) { RRDeleteTargetLines(); return; }
    string retained[];
    int owners = 0, ordinal = 0;
    for (int pos = PositionsTotal() - 1; pos >= 0; pos--)
    {
        ulong ticket = PositionGetTicket(pos);
        if (ticket == 0 || PositionGetString(POSITION_SYMBOL) != symbol) continue;
        long position_magic = PositionGetInteger(POSITION_MAGIC);
        ulong id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        if (!FileIsExist(RRFileName(id))) continue;
        string prefix = RRLinePrefix + IntegerToString(id) + "_";
        ArrayResize(retained, owners + 1);
        retained[owners++] = prefix;
        RRState state;
        string error;
        // A temporarily busy journal keeps its last annotations, rather than
        // making existing targets blink or displaying new-entry previews.
        if (!RRReadManagedPosition(symbol, position_magic, id, state, ticket, error)) continue;
        RRPlan plan;
        RRStatePlan(state, plan);
        if (!PositionSelectByTicket(ticket) || PositionGetString(POSITION_SYMBOL) != symbol) continue;
        double tp = PositionGetDouble(POSITION_TP);
        bool closes_all = RRStateClosesAll(state);
        double final_price = closes_all ? RRTargetPrice(state.direction, state.entry, state.risk, state.final_r, tick_size, digits) : 0;
        bool tp_pending = closes_all ? MathAbs(tp - final_price) > tick_size * 0.1 : tp != 0;
        string owner = "#" + IntegerToString(id);
        for (int i = 0; i < plan.count; i++)
        {
            double price = RRTargetPrice(state.direction, state.entry, state.risk, plan.targets[i].multiple, tick_size, digits);
            bool hit = state.version == 2 ? i < state.stage : (i == 0 ? state.stage >= 1 : state.stage >= 3);
            string caption = RRTargetCaption(owner, i, plan.targets[i].multiple, plan.targets[i].percent,
                plan.targets[i].move_be != 0, price, digits, hit, closes_all && i == plan.count - 1, tp_pending, state.blocked != 0 || !RR_Enable);
            if (!closes_all && i == plan.count - 1)
            {
                caption += " [计划后保留 " + RRCompactNumber(100.0 - RRPlanTotalPercent(plan)) + "%]";
                if (tp_pending) caption += " [旧TP待取消 " + DoubleToString(tp, digits) + "]";
                else caption += " [无全平TP]";
            }
            RRDrawTarget(prefix + IntegerToString(i), price, caption,
                RRTargetColor(hit, plan.targets[i].move_be != 0, false), hit, ordinal++);
        }
        RRPruneTargetRows(prefix, plan.count);
    }
    if (owners == 0 && RR_Enable && preview_entry > 0 && preview_stop > 0
        && preview_direction * (preview_entry - preview_stop) > 0)
    {
        string prefix = RRLinePrefix + "Preview_";
        ArrayResize(retained, 1);
        retained[owners++] = prefix;
        for (int i = 0; i < RRActivePlan.count; i++)
        {
            double price = RRTargetPrice(preview_direction, preview_entry, MathAbs(preview_entry - preview_stop),
                RRActivePlan.targets[i].multiple, tick_size, digits);
            string caption = RRTargetCaption("新仓预览", i, RRActivePlan.targets[i].multiple,
                RRActivePlan.targets[i].percent, RRActivePlan.targets[i].move_be != 0, price, digits, false, false, false, false);
            if (!RRPlanClosesAll(RRActivePlan) && i == RRActivePlan.count - 1)
                caption += " [计划后保留 " + RRCompactNumber(100.0 - RRPlanTotalPercent(RRActivePlan)) + "%]";
            RRDrawTarget(prefix + IntegerToString(i), price, caption, RRTargetColor(false, false, true), false, ordinal++);
        }
        RRPruneTargetRows(prefix, RRActivePlan.count);
    }
    for (int obj = ObjectsTotal(ChartID()) - 1; obj >= 0; obj--)
    {
        string name = ObjectName(ChartID(), obj);
        if (StringFind(name, RRLinePrefix) != 0) continue;
        bool keep = false;
        for (int i = 0; i < owners; i++) if (StringFind(name, retained[i]) == 0) { keep = true; break; }
        if (!keep) ObjectDelete(ChartID(), name);
    }
}
#endif
