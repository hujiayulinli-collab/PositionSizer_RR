# 公开版本与历史记录

当前公开版本为 [v1.8.0](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.8.0)。本仓库同时保留14个早期版本，共15份版本快照；早期编号不用于推断新的公开版本先后顺序，请以“下载最新版”为准。

## 当前公开版

| 公开版本 | MT5 文件版本 | 内容 |
|---|---|---|
| [v1.8.0](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.8.0) | 1.800 | 合并内部1.72的最低100毫秒分批开仓与内部1.73的持仓下拉修复，统一面板和下载文件版本，保留此前全部功能。 |

面板显示1.8.0；MT5属性的1.800是同一公开版本的两段数字格式。旧内部编译版本3.212/3.213与上游3.14均不是新的公开版本号。

## 历史版本

历史版本保持原始源码与 EX5，可能包含后续版本已经修复的问题。GitHub 发布包补充了上游 Apache License 2.0 许可证与衍生项目归属说明，原始本地 ZIP 未修改。

| 版本 | MT5 文件版本 | 主要变化 |
|---|---|---|
| [v1.0](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.0) | 3.14 | 初版：按初始风险距离计算目标，支持 2R 平一半并移至 BE、5R 平掉余仓。 |
| [v1.01](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.01) | 3.141 | 修复加载后空白面板、导航器缺少运行实例、面板无法拖动或关闭，以及重启后残框留存。 |
| [v1.10](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.10) | 3.150 | 新增分仓止盈页面，可添加、删除和保存最多 20 个目标，每个目标独立设置 R、平仓比例和 BE。 |
| [v1.20](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.20) | 3.160 | 图表显示每笔持仓的 TP、目标价格、平仓比例和 BE；持仓过程中可选择订单并修改尚未触发的目标。 |
| [v1.30](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.30) | 3.170 | 止盈比例合计不足 100% 时保留余仓，已触发的 BE 继续有效；余仓可手动退出或继续添加目标。 |
| [v1.40](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.40) | 3.180 | 新增实际成交提示音、单笔浮亏保护和包含浮动盈亏的全账户每日亏损保护。 |
| [v1.50](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.50) | 3.190 | 新增亏损保护页面，直接填写单笔和每日亏损额度、选择管理范围及声音设置，保存后应用到当前持仓。 |
| [v1.60](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.60) | 3.200 | 增加同品种反向仓先平后开、按当前余仓比例手动平仓、全账户持仓下拉选择，以及单面板切换品种。 |
| [v1.61](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.61) | 3.201 | 未选择持仓时，比例平仓按钮显示“先选择持仓”，点击展开订单列表，明确选中后才登记平仓。 |
| [v1.62](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.62) | 3.202 | 移除快捷比例下拉框，手动输入框后显示 %；移除主页品种切换，开仓使用当前图表品种，保留全账户持仓选择。 |
| [v1.70](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.70) | 3.210 | 新增父交易组分批市价开仓，统一设置子单手数上限和最短间隔，按整组风险预算建仓并管理整组止盈、BE 与比例平仓。 |
| [v1.71](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.71) | 3.211 | 每条未触发 TP 线可单独拖到指定价格，松开即保存并自动反算 R，保留原平仓比例和 BE；父组继续共用一套目标。 |
| [v1.72（内部测试）](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.72) | 3.212 | 最低100毫秒分批开仓；已合并至公开版v1.8.0。保留旧秒设置与旧父组兼容、实际成交和止损确认屏障。 |
| [v1.73（内部测试）](https://github.com/hujiayulinli-collab/PositionSizer_RR/releases/tag/v1.73) | 3.213 | 持仓下拉点击修复；已合并至公开版v1.8.0。源码与附件保留供追溯，不再作为公开最新版。 |

每个 Release 提供对应版本的下载包。安装文件位于包内 `mt5/Position Sizer RR.ex5`；部分历史包多一层 `PositionSizer_RR` 目录。请同时阅读对应版本 README 和升级说明。

发布记录说明：版本功能来自各包自带的 README、升级说明及源码版本字段。本次整理未重新执行 MT5 界面或成交测试。
