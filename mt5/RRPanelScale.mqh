// UI-only preference. Never part of trade/group journals or account settings.
#ifndef PS_RR_PANEL_SCALE_MQH
#define PS_RR_PANEL_SCALE_MQH
int RRPanelScalePercent = 100;
int RRPanelScalePending = 0;
long RRPanelScaleIdBase = 0;
bool RRPanelScaleBuilding = false;

bool RRPanelScaleValid(const int percent)
{
    return percent >= 75 && percent <= 200 && percent % 25 == 0;
}

int RRPanelScalePixels(const int pixels)
{
    return (int)MathRound(pixels * RRPanelScalePercent / 100.0);
}

int RRPanelScaleFont(const int points)
{
    return (int)MathMax(6, MathRound(points * RRPanelScalePercent / 100.0));
}

string RRPanelScaleFileName()
{
    return "PSRR_Settings\\PanelScale_" + IntegerToString(ChartID()) + ".txt";
}

void RRPanelScaleLoad()
{
    RRPanelScalePercent = 100;
    RRPanelScalePending = 0;
    int handle = FileOpen(RRPanelScaleFileName(), FILE_READ | FILE_TXT | FILE_ANSI);
    if (handle == INVALID_HANDLE) return;
    string header = FileReadString(handle);
    string text = FileReadString(handle);
    FileClose(handle);
    int percent = (int)StringToInteger(text);
    if (header == "PSRR_PANEL_SCALE_V1" && text == IntegerToString(percent) && RRPanelScaleValid(percent))
        RRPanelScalePercent = percent;
}

bool RRPanelScaleSave()
{
    if (!RRPanelScaleValid(RRPanelScalePercent)) return false;
    FolderCreate("PSRR_Settings");
    string path = RRPanelScaleFileName();
    string temporary = path + ".tmp";
    int handle = FileOpen(temporary, FILE_WRITE | FILE_TXT | FILE_ANSI);
    if (handle == INVALID_HANDLE) return false;
    bool written = FileWrite(handle, "PSRR_PANEL_SCALE_V1") > 0 &&
                   FileWrite(handle, IntegerToString(RRPanelScalePercent)) > 0;
    FileFlush(handle);
    FileClose(handle);
    if (!written) return false;
    return FileMove(temporary, 0, path, FILE_REWRITE);
}

void RRPanelScaleRequest(const int percent)
{
    if (!RRPanelScaleBuilding && RRPanelScaleValid(percent) && percent != RRPanelScalePercent)
        RRPanelScalePending = percent;
}

// Standard controls cache dropdown/list row heights during construction.
// Define their geometry before including implementations, then create a fresh
// dialog at the desired scale. Native control hit rectangles match rendering.
#include <Controls\Defines.mqh>
#undef CONTROLS_FONT_SIZE
#define CONTROLS_FONT_SIZE (RRPanelScaleFont(10))
#undef CONTROLS_BUTTON_SIZE
#define CONTROLS_BUTTON_SIZE (RRPanelScalePixels(16))
#undef CONTROLS_SCROLL_SIZE
#define CONTROLS_SCROLL_SIZE (RRPanelScalePixels(18))
#undef CONTROLS_SCROLL_THUMB_SIZE
#define CONTROLS_SCROLL_THUMB_SIZE (RRPanelScalePixels(22))
#undef CONTROLS_RADIO_BUTTON_X_OFF
#define CONTROLS_RADIO_BUTTON_X_OFF (RRPanelScalePixels(3))
#undef CONTROLS_RADIO_BUTTON_Y_OFF
#define CONTROLS_RADIO_BUTTON_Y_OFF (RRPanelScalePixels(3))
#undef CONTROLS_RADIO_LABEL_X_OFF
#define CONTROLS_RADIO_LABEL_X_OFF (RRPanelScalePixels(20))
#undef CONTROLS_CHECK_BUTTON_X_OFF
#define CONTROLS_CHECK_BUTTON_X_OFF (RRPanelScalePixels(3))
#undef CONTROLS_CHECK_BUTTON_Y_OFF
#define CONTROLS_CHECK_BUTTON_Y_OFF (RRPanelScalePixels(3))
#undef CONTROLS_CHECK_LABEL_X_OFF
#define CONTROLS_CHECK_LABEL_X_OFF (RRPanelScalePixels(20))
#undef CONTROLS_COMBO_BUTTON_X_OFF
#define CONTROLS_COMBO_BUTTON_X_OFF (RRPanelScalePixels(2))
#undef CONTROLS_COMBO_MIN_HEIGHT
#define CONTROLS_COMBO_MIN_HEIGHT (RRPanelScalePixels(18))
#undef CONTROLS_COMBO_ITEM_HEIGHT
#define CONTROLS_COMBO_ITEM_HEIGHT (RRPanelScalePixels(18))
#undef CONTROLS_LIST_ITEM_HEIGHT
#define CONTROLS_LIST_ITEM_HEIGHT (RRPanelScalePixels(18))
#undef CONTROLS_DIALOG_CAPTION_HEIGHT
#define CONTROLS_DIALOG_CAPTION_HEIGHT (RRPanelScalePixels(22))
#undef CONTROLS_DIALOG_BUTTON_OFF
#define CONTROLS_DIALOG_BUTTON_OFF (RRPanelScalePixels(3))
#undef CONTROLS_DIALOG_CLIENT_OFF
#define CONTROLS_DIALOG_CLIENT_OFF (RRPanelScalePixels(2))
#undef CONTROLS_DIALOG_MINIMIZE_WIDTH
#define CONTROLS_DIALOG_MINIMIZE_WIDTH (RRPanelScalePixels(100))
#endif
