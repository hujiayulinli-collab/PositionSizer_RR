// An independent price editor avoids native MT5 trade-level hit testing.
#ifndef PS_RR_TARGET_EDITOR_MQH
#define PS_RR_TARGET_EDITOR_MQH

string RREditPrefix = "PSRR_Edit_";
bool RREditActive = false;
bool RREditPicking = false;
RRDragSnapshot RREditSnapshot;
double RREditScale = 1.0;
double RREditDpiScale = 1.0;
int RREditChartWidth = 0;

bool RRTargetEditorActive() { return RREditActive; }

void RRCloseTargetEditor()
{
    RREditActive = false;
    RREditPicking = false;
    ObjectsDeleteAll(ChartID(), RREditPrefix);
}

void RREditPlaceObject(const string suffix, const int x, const int y, const int width, const int height)
{
    string name = RREditPrefix + suffix;
    long chart = ChartID();
    int left = RREditChartWidth - (int)MathRound(x * RREditScale);
    int top = (int)MathRound(y * RREditScale);
    ObjectSetInteger(chart, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
    ObjectSetInteger(chart, name, OBJPROP_XDISTANCE, left);
    ObjectSetInteger(chart, name, OBJPROP_YDISTANCE, top);
    if (width > 0) ObjectSetInteger(chart, name, OBJPROP_XSIZE,
        MathMax(1, RREditChartWidth - (int)MathRound((x - width) * RREditScale) - left));
    if (height > 0) ObjectSetInteger(chart, name, OBJPROP_YSIZE,
        MathMax(1, (int)MathRound((y + height) * RREditScale) - top));
    // Font size is in points and the terminal already applies screen DPI.
    // Compensate only when available chart space caps the geometry scale.
    ObjectSetInteger(chart, name, OBJPROP_FONTSIZE, MathMax(1, (int)MathFloor(9.0 * RREditScale / RREditDpiScale + 1e-7)));
}

void RRResizeTargetEditor()
{
    if (!RREditActive) return;
    RREditChartWidth = (int)MathMax(1, ChartGetInteger(ChartID(), CHART_WIDTH_IN_PIXELS, 0));
    int chart_height = (int)MathMax(1, ChartGetInteger(ChartID(), CHART_HEIGHT_IN_PIXELS, 0));
    long dpi = TerminalInfoInteger(TERMINAL_SCREEN_DPI);
    RREditDpiScale = dpi > 0 ? (double)dpi / 96.0 : 1.0;
    // The 420 x 155 footprint includes margins, so narrow/short charts keep
    // every control reachable. Resizing never changes typed text or authority.
    RREditScale = MathMin(RREditDpiScale, MathMin((double)RREditChartWidth / 420.0, (double)chart_height / 155.0));
    RREditPlaceObject("Back", 410, 30, 400, 115);
    RREditPlaceObject("Title", 398, 38, 0, 0);
    RREditPlaceObject("Price", 398, 65, 145, 25);
    RREditPlaceObject("Pick", 246, 65, 86, 25);
    RREditPlaceObject("Save", 153, 65, 62, 25);
    RREditPlaceObject("Cancel", 84, 65, 62, 25);
    RREditPlaceObject("Status", 398, 102, 0, 0);
}

bool RREditObject(const string suffix, const ENUM_OBJECT type, const string text)
{
    string name = RREditPrefix + suffix;
    long chart = ChartID();
    if (!ObjectCreate(chart, name, type, 0, 0, 0)) return false;
    ObjectSetInteger(chart, name, OBJPROP_SELECTABLE, false);
    ObjectSetInteger(chart, name, OBJPROP_HIDDEN, true);
    ObjectSetInteger(chart, name, OBJPROP_BACK, false);
    ObjectSetInteger(chart, name, OBJPROP_ZORDER, suffix == "Back" ? 3000000 : 3000001);
    ObjectSetInteger(chart, name, OBJPROP_COLOR, clrBlack);
    ObjectSetInteger(chart, name, OBJPROP_BGCOLOR, clrWhiteSmoke);
    ObjectSetInteger(chart, name, OBJPROP_BORDER_COLOR, clrSlateGray);
    ObjectSetString(chart, name, OBJPROP_FONT, "Microsoft YaHei");
    ObjectSetString(chart, name, OBJPROP_TEXT, text);
    if (type == OBJ_LABEL) ObjectSetInteger(chart, name, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
    if (type == OBJ_EDIT) ObjectSetInteger(chart, name, OBJPROP_READONLY, false);
    return true;
}

void RREditStatus(const string text)
{
    string visible = StringLen(text) > 28 ? StringSubstr(text, 0, 28) + "…" : text;
    ObjectSetString(ChartID(), RREditPrefix + "Status", OBJPROP_TEXT, visible);
    ObjectSetString(ChartID(), RREditPrefix + "Status", OBJPROP_TOOLTIP, text);
}

bool RROpenTargetEditor(const string label, string &message)
{
    int length = StringLen(label);
    if (StringFind(label, "PSRR_Targets_") != 0 || length < 6
        || StringSubstr(label, length - 6) != "_Label") return false;
    string line = StringSubstr(label, 0, length - 6) + "_Line";
    int slot = RRFindDragLine(line);
    if (slot < 0 || !RRDragLines[slot].editable || !RR_Enable
        || ObjectFind(ChartID(), line) < 0) return true;
    // Freeze the visible generation; timer redraws must not replace its authority.
    RRDragSnapshot item = RRDragLines[slot];
    RRCloseTargetEditor();
    RREditSnapshot = item;
    string title = StringFormat("%s #%I64u · TP%d 改价",
        item.parent ? "父组" : "持仓", item.owner, item.index + 1);
    int digits = (int)SymbolInfoInteger(item.symbol, SYMBOL_DIGITS);
    bool ok = RREditObject("Back", OBJ_RECTANGLE_LABEL, "");
    ok = ok && RREditObject("Title", OBJ_LABEL, title);
    ok = ok && RREditObject("Price", OBJ_EDIT, DoubleToString(item.price, digits));
    ok = ok && RREditObject("Pick", OBJ_BUTTON, "图上选价");
    ok = ok && RREditObject("Save", OBJ_BUTTON, "保存");
    ok = ok && RREditObject("Cancel", OBJ_BUTTON, "取消");
    ok = ok && RREditObject("Status", OBJ_LABEL, "输入价格或图上选价；点击保存后生效。");
    if (!ok)
    {
        RRCloseTargetEditor();
        message = "TP 改价窗口创建失败，未修改止盈。";
        return true;
    }
    ObjectSetString(ChartID(), RREditPrefix + "Price", OBJPROP_TOOLTIP,
        "填写目标价格；保存时自动校准到品种最小价格单位。比例与 BE 保持不变。");
    RREditActive = true;
    RRResizeTargetEditor();
    return true;
}

bool RRParseEditorPrice(string text, double &price)
{
    StringTrimLeft(text);
    StringTrimRight(text);
    bool digit = false;
    bool dot = false;
    for (int i = 0; i < StringLen(text); i++)
    {
        ushort ch = StringGetCharacter(text, i);
        if (ch >= 48 && ch <= 57) digit = true;
        else if (ch == 46 && !dot) dot = true;
        else return false;
    }
    if (!digit) return false;
    price = StringToDouble(text);
    return MathIsValidNumber(price) && price > 0;
}

bool RREditHitBox(const int x, const int y)
{
    return x >= RREditChartWidth - (int)MathRound(410 * RREditScale)
        && x <= RREditChartWidth - (int)MathRound(10 * RREditScale)
        && y >= (int)MathRound(30 * RREditScale) && y <= (int)MathRound(145 * RREditScale);
}

bool RREditPointPrice(const int x, const int y, double &price)
{
    int width = (int)ChartGetInteger(ChartID(), CHART_WIDTH_IN_PIXELS, 0);
    int height = (int)ChartGetInteger(ChartID(), CHART_HEIGHT_IN_PIXELS, 0);
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    // Never pick a price through the editor itself.
    if (RREditHitBox(x, y)) return false;
    int window = -1;
    datetime time = 0;
    if (!ChartXYToTimePrice(ChartID(), x, y, window, time, price) || window != 0) return false;
    return MathIsValidNumber(price) && price > 0;
}

void RREditPreviewPrice(const double price)
{
    string name = RREditPrefix + "Preview";
    if (ObjectFind(ChartID(), name) < 0) ObjectCreate(ChartID(), name, OBJ_HLINE, 0, 0, price);
    ObjectSetDouble(ChartID(), name, OBJPROP_PRICE, price);
    ObjectSetInteger(ChartID(), name, OBJPROP_COLOR, clrMagenta);
    ObjectSetInteger(ChartID(), name, OBJPROP_STYLE, STYLE_DOT);
    ObjectSetInteger(ChartID(), name, OBJPROP_SELECTABLE, false);
    ObjectSetInteger(ChartID(), name, OBJPROP_HIDDEN, true);
    ObjectSetInteger(ChartID(), name, OBJPROP_BACK, true);
    ObjectSetInteger(ChartID(), name, OBJPROP_ZORDER, 0);
    ObjectSetString(ChartID(), name, OBJPROP_TOOLTIP, "选价预览：尚未保存");
}

bool RRHandleTargetEditorEvent(const int id, const long &lparam, const double &dparam,
                               const string &sparam, string &message, ulong &owner,
                               bool &parent, bool &saved)
{
    message = ""; owner = 0; parent = false; saved = false;
    if (id == CHARTEVENT_OBJECT_CLICK && RROpenTargetEditor(sparam, message)) return true;
    if (!RREditActive) return false;
    if (id == CHARTEVENT_CHART_CHANGE)
    {
        RRResizeTargetEditor();
        return false; // The calculator and target annotations also need resize.
    }
    if (id == CHARTEVENT_KEYDOWN)
    {
        if (lparam == 27) RRCloseTargetEditor();
        return true; // Typing in the editor must not trigger trade hotkeys.
    }
    // The standard dialog also handles raw mouse coordinates. Do not let a
    // covered calculator button receive an editor click before OBJECT_CLICK.
    if (id == CHARTEVENT_MOUSE_MOVE && RREditHitBox((int)lparam, (int)dparam)) return true;
    if (id == CHARTEVENT_OBJECT_CLICK && StringFind(sparam, RREditPrefix) == 0)
    {
        ObjectSetInteger(ChartID(), sparam, OBJPROP_STATE, false);
        if (sparam == RREditPrefix + "Cancel") RRCloseTargetEditor();
        else if (sparam == RREditPrefix + "Pick")
        {
            RREditPicking = !RREditPicking;
            RREditStatus(RREditPicking ? "移动鼠标预览；单击图表填价，再按保存。" : "已停止选价；点击保存后生效。");
        }
        else if (sparam == RREditPrefix + "Save")
        {
            RREditPicking = false;
            double requested = 0;
            if (!RRParseEditorPrice(ObjectGetString(ChartID(), RREditPrefix + "Price", OBJPROP_TEXT), requested))
            {
                message = "请输入有效的正数价格，只使用数字和小数点。";
                RREditStatus("价格格式无效；请重新输入。");
                return true;
            }
            owner = RREditSnapshot.owner; parent = RREditSnapshot.parent;
            double legal_price = RREditSnapshot.price;
            saved = RRSaveDraggedTarget(RREditSnapshot, requested, legal_price, message);
            if (saved)
            {
                if (ObjectFind(ChartID(), RREditSnapshot.name) >= 0)
                {
                    ObjectSetInteger(ChartID(), RREditSnapshot.name, OBJPROP_SELECTED, false);
                    ObjectSetDouble(ChartID(), RREditSnapshot.name, OBJPROP_PRICE, legal_price);
                }
                int slot = RRFindDragLine(RREditSnapshot.name);
                if (slot >= 0) { RRDragLines[slot].editing = false; RRDragLines[slot].price = legal_price; }
                message = StringFormat("%s #%I64u 的 TP%d 已保存为 %s；比例和 BE 保持不变。",
                    parent ? "父组" : "持仓", owner, RREditSnapshot.index + 1,
                    DoubleToString(legal_price, (int)SymbolInfoInteger(RREditSnapshot.symbol, SYMBOL_DIGITS)));
                RRCloseTargetEditor();
            }
            else RREditStatus("未保存：" + message);
        }
        return true;
    }
    if (RREditPicking && (id == CHARTEVENT_MOUSE_MOVE || id == CHARTEVENT_CLICK))
    {
        double price = 0;
        if (RREditPointPrice((int)lparam, (int)dparam, price))
        {
            RREditPreviewPrice(price);
            if (id == CHARTEVENT_CLICK)
            {
                ObjectSetString(ChartID(), RREditPrefix + "Price", OBJPROP_TEXT,
                    DoubleToString(price, (int)SymbolInfoInteger(RREditSnapshot.symbol, SYMBOL_DIGITS)));
                RREditPicking = false;
                RREditStatus("已选取价格；点击保存后生效。");
            }
        }
        return true;
    }
    // Keep the editor modal with respect to the EA panel; the native chart and
    // its trade levels are unchanged. Other target captions may still open a
    // different editor through the first branch above.
    return id == CHARTEVENT_MOUSE_MOVE || id == CHARTEVENT_CLICK || id == CHARTEVENT_OBJECT_CLICK
        || (id == CHARTEVENT_OBJECT_ENDEDIT && StringFind(sparam, RREditPrefix) == 0);
}
#endif
