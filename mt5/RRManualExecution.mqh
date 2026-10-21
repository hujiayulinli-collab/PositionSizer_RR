// User-selected, durable partial exits. Include after RRGuardExecution.mqh.
#ifndef PS_RR_MANUAL_EXECUTION_MQH
#define PS_RR_MANUAL_EXECUTION_MQH

bool RGCanOpen(const long magic);

struct RMExecutionState
{
    uint version;
    ulong identifier;
    ulong initial_ticket;
    long manager_magic;
    uint symbol_hash;
    int direction;
    int generation;
    int sequence;
    int pending;
    int complete;
    int blocked;
    ulong pending_order;
    double initial_volume;
    double target_remaining;
    double observed_volume;
    double before_volume;
    double requested_volume;
    long created;
    long completed;
    long last_request;
    uint checksum;
};

string RMExecutionFile(const ulong identifier)
{
    return StringFormat("PSRR_Manual\\%u_%I64d\\%I64u.bin", RRHash(AccountInfoString(ACCOUNT_SERVER)),
        AccountInfoInteger(ACCOUNT_LOGIN), identifier);
}

uint RMExecutionChecksum(const RMExecutionState &s)
{
    string value = StringFormat("%u|%I64u|%I64u|%I64d|%u|%d|%d|%d|%d|%d|%d|%I64u|",
        s.version, s.identifier, s.initial_ticket, s.manager_magic, s.symbol_hash, s.direction,
        s.generation, s.sequence, s.pending, s.complete, s.blocked, s.pending_order);
    value += DoubleToString(s.initial_volume, 8) + "|" + DoubleToString(s.target_remaining, 8)
        + "|" + DoubleToString(s.observed_volume, 8) + "|" + DoubleToString(s.before_volume, 8)
        + "|" + DoubleToString(s.requested_volume, 8) + "|" + IntegerToString(s.created)
        + "|" + IntegerToString(s.completed) + "|" + IntegerToString(s.last_request);
    return RRHash(value);
}

bool RMExecutionSave(const int handle, RMExecutionState &s, string &error)
{
    s.checksum = RMExecutionChecksum(s);
    ResetLastError();
    if (!FileSeek(handle, 0, SEEK_END))
    { error = "手动平仓记录无法定位，停止发送。"; return false; }
    uint written = FileWriteStruct(handle, s);
    FileFlush(handle);
    if (written != sizeof(RMExecutionState) || GetLastError() != 0)
    { error = "手动平仓记录保存未确认，停止发送；请核对记录及成交历史。"; return false; }
    return true;
}

bool RMExecutionLoad(const int handle, const ulong identifier, RMExecutionState &s)
{
    ulong size = FileSize(handle);
    if (size < sizeof(RMExecutionState) || size % sizeof(RMExecutionState) != 0) return false;
    if (!FileSeek(handle, (long)(size - sizeof(RMExecutionState)), SEEK_SET)
        || FileReadStruct(handle, s) != sizeof(RMExecutionState)) return false;
    return s.version == 1 && s.identifier == identifier && s.initial_ticket != 0
        && s.checksum == RMExecutionChecksum(s) && (s.direction == 1 || s.direction == -1)
        && s.generation > 0 && s.sequence >= 0 && (s.pending == 0 || s.pending == 1)
        && (s.complete == 0 || s.complete == 1) && (s.blocked == 0 || s.blocked == 1)
        && !(s.pending != 0 && s.complete != 0)
        && MathIsValidNumber(s.initial_volume) && s.initial_volume > 0
        && MathIsValidNumber(s.target_remaining) && s.target_remaining >= 0 && s.target_remaining < s.initial_volume
        && MathIsValidNumber(s.observed_volume) && s.observed_volume >= 0
        && MathIsValidNumber(s.before_volume) && s.before_volume >= 0
        && MathIsValidNumber(s.requested_volume) && s.requested_volume >= 0;
}

ulong RMSelectIdentifier(const ulong identifier)
{
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if (ticket != 0 && (ulong)PositionGetInteger(POSITION_IDENTIFIER) == identifier) return ticket;
    }
    return 0;
}

bool RMPositionExitActive(const ulong identifier)
{
    string filename = RMExecutionFile(identifier);
    if (identifier == 0 || !FileIsExist(filename)) return false;
    int handle = FileOpen(filename, FILE_READ | FILE_BIN);
    if (handle == INVALID_HANDLE) return true;
    RMExecutionState s;
    bool valid = RMExecutionLoad(handle, identifier, s);
    FileClose(handle);
    return !valid || s.complete == 0;
}

string RMExecutionComment(const RMExecutionState &s)
{
    // Sequence never resets between generations; comments remain <=31 chars.
    return StringFormat("RM%I64X-%X", s.identifier, s.sequence);
}

bool RMComplete(const int handle, RMExecutionState &s, string &error)
{
    s.complete = 1;
    s.pending = 0;
    s.pending_order = 0;
    s.completed = (long)TimeLocal();
    return RMExecutionSave(handle, s, error);
}

// Controller barrier for reverse entries and parent groups: no position AND no
// unresolved manual close. Unlike a status query this may settle a vanished task.
bool RMExitSettled(const ulong identifier)
{
    if (identifier == 0 || RMSelectIdentifier(identifier) != 0) return false;
    string filename = RMExecutionFile(identifier);
    if (!FileIsExist(filename)) return true;
    int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE) return false;
    RMExecutionState s;
    bool ready = RMExecutionLoad(handle, identifier, s);
    if (ready && s.pending != 0)
    {
        ulong resolved_order;
        ready = RGCloseConfirmed(identifier, s.manager_magic, RMExecutionComment(s), s.pending_order,
            s.before_volume, 0, 0.00000001, 0, resolved_order);
    }
    if (ready) ready = RMSelectIdentifier(identifier) == 0;
    string status;
    if (ready && s.complete == 0) ready = RMComplete(handle, s, status);
    FileClose(handle);
    return ready;
}

// Called by the money-stop executor under its own lock and ordinary RR lock.
// A durable risk latch prevents a manual sender from starting another request
// after we release this file. Busy locks never wait and cannot deadlock.
bool RMGuardExitReady(const ulong identifier, const double volume, const double step, string &status)
{
    string filename = RMExecutionFile(identifier);
    if (!FileIsExist(filename)) return true;
    int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE)
    { status = "手动平仓正在处理，风控稍后重试。"; return false; }
    RMExecutionState s;
    bool ready = RMExecutionLoad(handle, identifier, s);
    if (!ready) status = "手动平仓记录无法确认，风控等待核对，避免重复平仓。";
    if (ready && s.pending != 0)
    {
        ulong resolved_order;
        ready = RGCloseConfirmed(identifier, s.manager_magic, RMExecutionComment(s), s.pending_order,
            s.before_volume, volume, step, PositionGetInteger(POSITION_TIME_UPDATE_MSC), resolved_order);
        if (!ready) status = "等待手动平仓成交确认，风控不会叠加平仓请求。";
    }
    if (ready && s.complete == 0 && RGPositionExitLatched(identifier)) ready = RMComplete(handle, s, status);
    FileClose(handle);
    return ready;
}

bool RMTargetRemaining(const double volume, const double percent, const double minimum,
                       const double step, double &target, string &error)
{
    if (!MathIsValidNumber(percent) || percent <= 0 || percent > 100
        || !MathIsValidNumber(volume) || volume <= 0 || !MathIsValidNumber(minimum) || minimum <= 0
        || !MathIsValidNumber(step) || step <= 0)
    { error = "平仓比例必须大于 0 且不超过 100，持仓及手数规则须有效。"; return false; }
    if (percent == 100) { target = 0; return true; }
    double requested = MathFloor(volume * percent / 100.0 / step + 1e-8) * step;
    if (volume - requested < minimum - step * 0.1)
        requested = MathFloor((volume - minimum) / step + 1e-8) * step;
    if (requested < minimum - step * 0.1 || requested >= volume - step * 0.1)
    { error = "该比例取整后不足最小平仓手数，或无法保留合法余仓；请调整比例。"; return false; }
    target = NormalizeDouble(volume - requested, 8);
    return true;
}

// The caller holds the ordinary RR file (if any) before opening this journal.
bool RMRegisterLocked(const int handle, const bool exists, const ulong identifier,
                      const double percent, const long manager_magic, string &error, const int expected_direction,
                      bool &write_attempted)
{
    write_attempted = false;
    RMExecutionState s;
    ZeroMemory(s);
    if (FileSize(handle) != 0 || exists)
    {
        if (!RMExecutionLoad(handle, identifier, s))
        { error = "手动平仓记录损坏或不完整，已停止登记；请核对成交历史。"; return false; }
        if (s.complete == 0)
        { error = "所选持仓已有手动平仓任务，请等待完成，勿重复点击。"; return false; }
        if ((long)TimeLocal() - s.completed < 2)
        { error = "上次手动平仓刚完成，请稍后再确认新的比例。"; return false; }
    }
    ulong ticket = RMSelectIdentifier(identifier);
    if (ticket == 0 || RGPositionExitLatched(identifier))
    { error = "持仓或风控状态已变化，请刷新后核对。"; return false; }
    int direction = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
    if (expected_direction != 0 && direction != expected_direction)
    { error = "所选持仓已改变方向，本次不登记平仓，请刷新后重新确认。"; return false; }
    string symbol = PositionGetString(POSITION_SYMBOL);
    double volume = PositionGetDouble(POSITION_VOLUME);
    double target = 0;
    if (!RMTargetRemaining(volume, percent, SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN),
        SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), target, error)) return false;
    if (s.generation == 2147483647 || s.sequence == 2147483647)
    { error = "手动平仓请求序号已耗尽。"; return false; }
    s.version = 1; s.identifier = identifier; s.initial_ticket = ticket; s.manager_magic = manager_magic;
    s.symbol_hash = RRHash(symbol); s.direction = direction;
    s.generation++; s.pending = 0; s.complete = 0; s.blocked = 0; s.pending_order = 0;
    s.initial_volume = volume; s.target_remaining = target; s.observed_volume = volume;
    s.before_volume = 0; s.requested_volume = 0; s.created = (long)TimeLocal(); s.completed = 0; s.last_request = 0;
    write_attempted = true;
    if (!RMExecutionSave(handle, s, error)) return false;
    error = StringFormat("已登记手动平仓，目标余仓 %.8f 手；等待执行确认。", target);
    return true;
}

// Register only; no manual broker request is sent by this UI-facing function.
// RGCanOpen can execute an already-triggered, higher-priority money stop.
bool RMRequestClose(const ulong identifier, const double percent, const long manager_magic, string &error,
                    const int expected_direction = 0)
{
    error = "";
    if (expected_direction != 0 && expected_direction != 1 && expected_direction != -1)
    { error = "指定的平仓方向无效。"; return false; }
    if (!RGCanOpen(manager_magic))
    { error = "亏损保护已阻止新手动任务，将优先处理已登记的退出。"; return false; }
    ulong initial_ticket = identifier == 0 ? 0 : RMSelectIdentifier(identifier);
    if (initial_ticket == 0)
    { error = "所选持仓已不存在，请刷新持仓列表。"; return false; }
    if (RGPositionExitLatched(identifier))
    { error = "所选持仓已有风控退出任务，将优先执行风控。"; return false; }
    if (expected_direction != 0 && (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1) != expected_direction)
    { error = "所选持仓已改变方向，本次不登记平仓，请刷新后重新确认。"; return false; }
    string symbol = PositionGetString(POSITION_SYMBOL);
    int initial_direction = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
    double initial_volume = PositionGetDouble(POSITION_VOLUME);
    double target = 0;
    if (!RMTargetRemaining(initial_volume, percent, SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN),
        SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), target, error)) return false;
    // Check normal pending before creating a manual file. A routine lock or
    // reconciliation failure must not leave an empty blocking file.
    int rr_handle = -2;
    string rr_filename = RRFileName(identifier);
    if (FileIsExist(rr_filename)) rr_handle = FileOpen(rr_filename, FILE_READ | FILE_BIN);
    if (rr_handle == INVALID_HANDLE)
    { error = "普通 RR 正在处理所选持仓，请稍后重试。"; return false; }
    bool ready = RGOrdinaryExitReady(rr_handle, identifier, PositionGetDouble(POSITION_VOLUME),
        SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), error);
    if (!ready) { if (rr_handle != -2) FileClose(rr_handle); return false; }
    string filename = RMExecutionFile(identifier);
    bool exists = FileIsExist(filename);
    int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
    if (handle == INVALID_HANDLE)
    {
        if (rr_handle != -2) FileClose(rr_handle);
        error = "其他图表正在处理所选持仓，请稍后重试。"; return false;
    }
    bool write_attempted = false;
    bool ok = RMRegisterLocked(handle, exists, identifier, percent, manager_magic, error, expected_direction, write_attempted);
    if (!ok && !exists && !write_attempted && FileSize(handle) == 0)
    {
        // A rejected snapshot has no request to recover. Seal its newly created
        // placeholder as a valid, completed no-request generation while still
        // holding the file. Never delete after unlock: another chart could have
        // opened/filled the same filename between close and deletion.
        RMExecutionState cancelled;
        ZeroMemory(cancelled);
        cancelled.version = 1; cancelled.identifier = identifier; cancelled.initial_ticket = initial_ticket;
        cancelled.manager_magic = manager_magic; cancelled.symbol_hash = RRHash(symbol);
        cancelled.direction = initial_direction; cancelled.generation = 1; cancelled.complete = 1;
        cancelled.initial_volume = initial_volume; cancelled.target_remaining = target;
        cancelled.observed_volume = initial_volume; cancelled.created = (long)TimeLocal();
        cancelled.completed = cancelled.created;
        RMExecutionSave(handle, cancelled, error);
    }
    FileClose(handle);
    if (rr_handle != -2) FileClose(rr_handle);
    return ok;
}

bool RMProcessLocked(const int handle, RMExecutionState &s, const int rr_handle, string &status)
{
    if (s.complete != 0) return true;
    ulong ticket = RMSelectIdentifier(s.identifier);
    if (ticket == 0)
    {
        // An absent position is not proof that an outstanding ambiguous order
        // has terminated. A later same-ID swap reopening must remain protected.
        if (s.pending != 0)
        {
            ulong resolved_order;
            if (!RGCloseConfirmed(s.identifier, s.manager_magic, RMExecutionComment(s), s.pending_order,
                s.before_volume, 0, 0.00000001, 0, resolved_order))
            { status = "持仓暂不可见，等待已发手动平仓请求的历史确认。"; return false; }
        }
        return RMComplete(handle, s, status);
    }
    string symbol = PositionGetString(POSITION_SYMBOL);
    int direction = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
    double volume = PositionGetDouble(POSITION_VOLUME);
    double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
    double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double maximum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    if (RRHash(symbol) != s.symbol_hash || !MathIsValidNumber(volume) || volume <= 0
        || !MathIsValidNumber(step) || step <= 0 || !MathIsValidNumber(minimum) || minimum <= 0
        || !MathIsValidNumber(maximum) || maximum < minimum)
    { status = "持仓身份或券商手数规则无法确认，暂不发送。"; return false; }
    if (!RGOrdinaryExitReady(rr_handle, s.identifier, volume, step, status)) return false;
    if (s.pending != 0)
    {
        ulong resolved_order;
        if (!RGCloseConfirmed(s.identifier, s.manager_magic, RMExecutionComment(s), s.pending_order,
            s.before_volume, volume, step, PositionGetInteger(POSITION_TIME_UPDATE_MSC), resolved_order))
        { status = "手动平仓等待成交确认，不会因超时重复发送。"; return false; }
        double filled = HistoryOrderGetDouble(resolved_order, ORDER_VOLUME_INITIAL)
            - HistoryOrderGetDouble(resolved_order, ORDER_VOLUME_CURRENT);
        if (volume > s.before_volume - MathMax(0.0, filled) + step * 0.1) s.blocked = 1;
        s.pending = 0; s.pending_order = 0;
        if (!RMExecutionSave(handle, s, status)) return false;
    }
    if (RGPositionExitLatched(s.identifier)) return RMComplete(handle, s, status);
    if (s.blocked == 0 && (direction != s.direction || volume > s.observed_volume + step * 0.1))
    {
        s.blocked = 1;
        if (!RMExecutionSave(handle, s, status)) return false;
    }
    if (s.blocked != 0)
    {
        status = "登记后持仓有加仓或反转，手动平仓已暂停；请人工核对。"; return false;
    }
    if (volume <= s.target_remaining + step * 0.1) return RMComplete(handle, s, status);
    if (volume < s.observed_volume - step * 0.1)
    { s.observed_volume = volume; if (!RMExecutionSave(handle, s, status)) return false; }
    if (!RRCanTrade())
    { status = "手动平仓任务已保存，等待联网和自动交易权限恢复。"; return false; }
    if ((long)TimeLocal() - s.last_request < 3) return false;
    double requested = MathFloor(MathMin(volume - s.target_remaining, maximum) / step + 1e-8) * step;
    double shortfall = volume - s.target_remaining - requested;
    if (shortfall > step * 0.1 && shortfall < minimum - step * 0.1)
        requested = MathFloor((volume - s.target_remaining - minimum) / step + 1e-8) * step;
    if (volume - requested > step * 0.1 && volume - requested < minimum - step * 0.1)
        requested = MathFloor((volume - minimum) / step + 1e-8) * step;
    if (requested < minimum - step * 0.1)
    { status = "待平手数不足券商最小量，任务暂停等待核对。"; return false; }
    MqlTick tick;
    if (!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask <= 0) return false;
    MqlTradeRequest request = {};
    MqlTradeResult result = {};
    request.action = TRADE_ACTION_DEAL; request.position = ticket; request.symbol = symbol;
    request.magic = (ulong)s.manager_magic; request.volume = NormalizeDouble(requested, 8);
    request.type = s.direction == 1 ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
    request.price = s.direction == 1 ? tick.bid : tick.ask; request.deviation = RR_DeviationPoints;
    long fill = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
    long execution = SymbolInfoInteger(symbol, SYMBOL_TRADE_EXEMODE);
    if ((fill & SYMBOL_FILLING_FOK) != 0 || execution == SYMBOL_TRADE_EXECUTION_INSTANT || execution == SYMBOL_TRADE_EXECUTION_REQUEST)
        request.type_filling = ORDER_FILLING_FOK;
    else if ((fill & SYMBOL_FILLING_IOC) != 0) request.type_filling = ORDER_FILLING_IOC;
    else { status = "券商不支持 FOK/IOC 平仓，请人工处理。"; return false; }
    if (s.sequence == 2147483647) return false;
    request.comment = StringFormat("RM%I64X-%X", s.identifier, s.sequence + 1);
    MqlTradeCheckResult check = {};
    if (!OrderCheck(request, check))
    {
        s.last_request = (long)TimeLocal();
        if (!RMExecutionSave(handle, s, status)) return false;
        status = StringFormat("手动平仓预检查未通过：%u %s，稍后重试。", check.retcode, check.comment); return false;
    }
    if (!PositionSelectByTicket(ticket) || (ulong)PositionGetInteger(POSITION_IDENTIFIER) != s.identifier
        || (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1) != s.direction
        || MathAbs(PositionGetDouble(POSITION_VOLUME) - volume) > step * 0.1
        || RGPositionExitLatched(s.identifier))
    { status = "持仓或风控状态刚发生变化，本次暂不发送。"; return false; }
    s.sequence++; s.pending = 1; s.pending_order = 0; s.before_volume = volume;
    s.requested_volume = request.volume; s.last_request = (long)TimeLocal();
    if (!RMExecutionSave(handle, s, status)) return false;
    bool sent = OrderSend(request, result);
    s.pending_order = result.order;
    if (s.pending_order == 0 && result.deal != 0 && HistoryDealSelect(result.deal))
        s.pending_order = (ulong)HistoryDealGetInteger(result.deal, DEAL_ORDER);
    if (RRDefiniteReject(result.retcode)) { s.pending = 0; s.pending_order = 0; }
    if (!RMExecutionSave(handle, s, status)) return false;
    status = s.pending != 0 ? "手动平仓请求已登记，等待成交确认。" : "手动平仓请求被拒绝，任务保留并稍后重试。";
    PrintFormat("[PS RR Manual] 仓位 %I64u 第 %d 次操作，平仓 %.8f 手，目标余仓 %.8f：sent=%s, retcode=%u %s",
        s.identifier, s.generation, request.volume, s.target_remaining, sent ? "true" : "false", result.retcode, result.comment);
    return false;
}

void RMManage()
{
    // Current positions identify restartable tasks without scanning unrelated
    // account files. A disappeared position never causes a new-position send.
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        if (PositionGetTicket(i) == 0) continue;
        ulong identifier = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
        string filename = RMExecutionFile(identifier);
        if (!FileIsExist(filename)) continue;
        int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_BIN);
        if (handle == INVALID_HANDLE) continue;
        RMExecutionState s;
        if (!RMExecutionLoad(handle, identifier, s) || s.complete != 0) { FileClose(handle); continue; }
        int rr_handle = -2;
        string rr_filename = RRFileName(identifier);
        if (FileIsExist(rr_filename)) rr_handle = FileOpen(rr_filename, FILE_READ | FILE_BIN);
        if (rr_handle == INVALID_HANDLE) { FileClose(handle); continue; }
        string status;
        RMProcessLocked(handle, s, rr_handle, status);
        if (rr_handle != -2) FileClose(rr_handle);
        FileClose(handle);
    }
}
#endif
