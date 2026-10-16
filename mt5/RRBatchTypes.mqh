// Fixed-layout parent/child journal. Append a new version rather than changing
// this record after release. No dynamic strings/arrays may enter the disk POD.
#ifndef PS_RR_BATCH_TYPES_MQH
#define PS_RR_BATCH_TYPES_MQH
#define RB_MAX_CHILDREN 64
#define RB_ENTRY_BUILDING 0
#define RB_ENTRY_COMPLETE 1
#define RB_ENTRY_CANCELLED 2
#define RB_ENTRY_STOPPED 3

struct RBGroup
{
    uint version;
    ulong parent_id;
    long account;
    uint server_hash;
    long magic;
    int direction;
    ushort symbol[64];
    double planned_volume;
    double risk_budget;
    double stop_loss;
    double reference_price;
    double child_max_lots;
    int interval_seconds;
    int max_deviation_points;
    double commission_per_lot; // Frozen round-trip estimate in account currency.
    int max_spread_points;
    int slippage_points;
    int close_opposite;
    int max_trades_total;
    int max_trades_symbol;
    double max_volume_total;
    double max_volume_symbol;
    double max_risk_total_money;
    double max_risk_symbol_money;
    long created;
    int child_count;
    ulong child_id[RB_MAX_CHILDREN];
    ulong child_order[RB_MAX_CHILDREN];
    double child_volume[RB_MAX_CHILDREN];
    double child_price[RB_MAX_CHILDREN];
    int entry_state;
    int pending;
    int pending_index;
    ulong pending_order;
    double pending_volume;
    long last_request;
    double filled_volume;
    double filled_value;
    double used_risk;
    RRState exit_state;
    int exit_ready;
    int manual_active;
    double manual_target_remaining;
    long manual_created;
    long manual_completed;
    int risk_latched;
    int sequence;
    uint checksum;
};

bool RBEnabled = false;
double RBChildMaxLots = 5;
int RBIntervalSeconds = 1;
int RBMaxDeviationPoints = 0;

bool RBLoadSettings();
bool RBSaveSettings(bool enabled, double child_max, int interval, int deviation, string &error);
bool RBEntryActive();
bool RBAccountBusy();
string RBStatusText();
void RBCancelEntry();
void RBInit();
void RBShutdown();
void RBManageEntry();
bool RBQueue(double total_volume, string &error);
bool RBIsChild(ulong identifier);
ulong RBPositionParent(ulong identifier);
int RBCollectGroups(ulong &ids[]);
bool RBReadGroup(ulong parent, RBGroup &group, string &error);
int RBLockGroup(ulong parent);
bool RBLoadGroup(int handle, RBGroup &group);
bool RBSaveGroup(int handle, RBGroup &group);
string RBGroupSymbol(const RBGroup &group);
bool RBGroupBuilding(ulong parent);
bool RBFreezeExit(RBGroup &group);
void RBStopGroupEntry(RBGroup &group);
#endif
