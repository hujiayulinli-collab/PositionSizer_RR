// Pure calculations shared by the EA and regression tests.
#ifndef PS_RR_CORE_MQH
#define PS_RR_CORE_MQH

double RRPriceR(const int direction, const double entry, const double risk, const double bid, const double ask)
{
    if (risk <= 0) return 0;
    return direction * ((direction == 1 ? bid : ask) - entry) / risk;
}

double RRTargetPrice(const int direction, const double entry, const double risk, const double multiple, const double tick_size, const int digits)
{
    double price = entry + direction * risk * multiple;
    // Round away from entry, so the broker TP cannot trigger before the target R.
    if (tick_size > 0)
        price = (direction == 1 ? MathCeil(price / tick_size - 1e-8) : MathFloor(price / tick_size + 1e-8)) * tick_size;
    return NormalizeDouble(price, digits);
}

// Preserve a dragged legal price at full R precision. RRTargetPrice remains the
// single forward calculation used by chart lines and execution.
bool RRTargetMultipleFromPrice(const int direction, const double entry, const double risk,
                               const double requested, const double tick_size, const int digits,
                               double &multiple, double &legal_price)
{
    if ((direction != 1 && direction != -1) || digits < 0 || digits > 8
        || !MathIsValidNumber(entry) || entry <= 0 || !MathIsValidNumber(risk) || risk <= 0
        || !MathIsValidNumber(requested) || requested <= 0
        || !MathIsValidNumber(tick_size) || tick_size <= 0) return false;
    double units = requested / tick_size;
    if (!MathIsValidNumber(units)) return false;
    double rounded = NormalizeDouble(MathRound(units) * tick_size, digits);
    if (!MathIsValidNumber(rounded) || rounded <= 0 || direction * (rounded - entry) <= 0) return false;
    double candidate = direction * (rounded - entry) / risk;
    if (!MathIsValidNumber(candidate) || candidate <= 0) return false;
    double verified = RRTargetPrice(direction, entry, risk, candidate, tick_size, digits);
    // Never silently move an extra tick to conceal a precision mismatch.
    if (!MathIsValidNumber(verified) || MathAbs(verified - rounded) > tick_size * 0.1) return false;
    multiple = candidate;
    legal_price = rounded;
    return true;
}

bool RRTargetReached(const int direction, const double entry, const double risk, const double multiple,
                     const double bid, const double ask, const double tick_size, const int digits)
{
    if ((direction != 1 && direction != -1) || !MathIsValidNumber(entry) || entry <= 0
        || !MathIsValidNumber(risk) || risk <= 0 || !MathIsValidNumber(multiple) || multiple <= 0
        || !MathIsValidNumber(tick_size) || tick_size <= 0) return false;
    double price = (direction == 1 ? bid : ask);
    double target = RRTargetPrice(direction, entry, risk, multiple, tick_size, digits);
    if (!MathIsValidNumber(price) || price <= 0 || !MathIsValidNumber(target) || target <= 0) return false;
    // Compare the same legal tick price used by server TP, rather than dividing
    // by binary floating-point risk (which could report 1.99999999999988 at 2R).
    return (direction == 1 ? price >= target : price <= target);
}

double RRPartialLots(const double initial_volume, const double current_volume, const double percent, const double minimum, const double step)
{
    if (step <= 0 || minimum <= 0 || percent <= 0 || percent >= 100) return 0;
    double goal = MathFloor(initial_volume * percent / 100.0 / step + 1e-8) * step;
    double already_closed = MathMax(0.0, initial_volume - current_volume);
    double needed = MathFloor((goal - already_closed) / step + 1e-8) * step;
    if (needed < minimum - step * 1e-6 || current_volume - needed < minimum - step * 1e-6) return 0;
    return NormalizeDouble(needed, 8);
}

double RRBETarget(const int direction, const double entry, const double offset_points, const double point, const double tick_size, const int digits)
{
    double price = entry + direction * offset_points * point;
    if (tick_size > 0)
        price = (direction == 1 ? MathCeil(price / tick_size - 1e-8) : MathFloor(price / tick_size + 1e-8)) * tick_size;
    return NormalizeDouble(price, digits);
}

bool RRSLProtectsBE(const int direction, const double sl, const double target, const double tick_size)
{
    return sl > 0 && direction * (sl - target) >= -tick_size * 0.1;
}
#endif
