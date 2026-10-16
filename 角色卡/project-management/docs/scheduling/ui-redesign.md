# 调度记录 — ui-redesign（界面视觉重设计：蓝图室方向，U1/U2 两批）

> 单写者：项目管理上下文（手工维护）。planRevision: 1
> 实施提案：[../design/2026-10-16_design_ui-redesign.md](../design/2026-10-16_design_ui-redesign.md)（**已批准：客户选定方向 B 蓝图室；实施与独立验证闭环 2026-10-16**）
> Mockup 参照：[ui-mockup-b-blueprint.html](../design/ui-mockup-b-blueprint.html)（视觉基准）
> 前置：批 2 已提交（`ef99479`/`b0ce23a`，2026-10-16，工作区干净）。

## 1. 任务与授权

- **任务**：UI 视觉重设计（纯视觉：不新增功能、不改交互行为）。客户原话「页面找个 UI 重新设计一下，太丑了」。
- **授权记录（2026-10-16，经协调者转呈的客户指令）**：客户选定 **方向 B 蓝图室**（无混搭）；字体策略维持现状；按两批实施（U1 设计系统落地 → U2 组件翻新）。
- **硬约束**：全部测试保持 119/119；四门槛不变；批末 project-test 独立验证 + **客户 GUI 目视**；全程不提交 git。

## 2. 节点表

| 节点 | 角色 | 交付物 | 写入范围 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| U1 | app-shell | 设计系统落地：`index.css` token 全部换值（蓝图室）+ 全局基础件（滚动条/焦点环/选区/skeleton）+ `tailwind.config.ts` 圆角收编（xl/2xl 入 token） | `frontend/src/index.css`、`frontend/tailwind.config.ts` | 批 2 已提交（满足） | **verified**（attempt 1；16 `--bp-*` primitives + 24 语义条唯一来源 + 26 `--ibm-*` 别名；旧值零残留；哈希 `3092146c…`/`8ba3291a…`；tsc=0、npm test 119/119） |
| U1b | graph-view | 设计系统落地：`theme.ts` 值级更新（状态五色/边色/节点类型/影响域/feature 面板） | `frontend/src/types/theme.ts` | —（与 U1 文件不交） | **verified**（attempt 1；45 颜色值 + 1 行头注释，diff 恰 29+/29− 纯值替换；旧色值 29 项零残留；哈希 `3fa860b2…`；tsc=0） |
| U2 | agent-pipeline | 组件翻新：`App.tsx`（工具条/空态）、`ChatPanel.tsx`（消息卡/输入/计划卡/硬编码色）、`ActionDialog.tsx`、`ActionPanel.tsx`（卡片/动作键/流式） | 对应 4 文件 | U1/U1b（token 先行） | **verified**（attempt 1；281+/215−；行为 token 计数零变化佐证；旧硬编码色清零；哈希 `7f00935e…`/`6c08d6d0…`/`47806d00…`/`f78496e9…`；遗留 PlanCard/ReviewCard → U2-Fc） |
| U2b | graph-view | 组件翻新：`MapCanvas.tsx`（画布底+网格/节点卡/连线/起点终点/图例）、`MapperView.tsx` | 对应 2 文件 | U1/U1b | **verified**（attempt 1；88+/64−；含顺带修复：`.bg-layer` 遮罩致网格从未显示（批前即存）、`--color-bg-hover` 悬空变量；哈希 `94e3cf27…`/`a6840158…`；发现两项→U2-Fa/U2-Fb） |
| U2c | app-shell | 组件翻新：`RightPanel.tsx`、`SettingsPanel.tsx`、`TitleBar.tsx` | 对应 3 文件 | U1/U1b | **verified**（attempt 1；9+/9−；TitleBar 核对零改动〔哈希与批 2 记录一致〕；补充收编 2 项；哈希 `66901a07…`/`c5f1ee50…`） |
| U2d | project-data | 组件翻新：`CodeViewer.tsx`（全文件硬编码色 + 语法高亮→蓝图室颜料族） | `frontend/src/components/CodeViewer.tsx` | U1/U1b | **verified**（attempt 1；22+/22−；旧值 13 项零残留；语法六色换 B 颜料；头条路径字取 text-secondary 裁定接受；哈希 `fcbb4f82…`） |
| U2e | project-management | i18n 文案清理（4 语言包：文案内 emoji 退场；键集合不变） | `frontend/src/i18n/*.json` | —（本上下文执行） | **verified**（本上下文执行；20 键 × 4 包值级去 emoji，键集合 150/包不变、每包 diff 恰 40 行、残留 emoji 零；全文可解析） |
| U2-Fa | graph-view | 收尾修复：MapperView 残余异族色收编（右列卡片/控制台）+ alpha 拼接非法 CSS（`c+'0d'` 等 4 处）改 `color-mix` | `frontend/src/components/MapperView.tsx` | U2b（已完成） | **verified**（attempt 1；14 处修复〔10 异族色 + 4 alpha→color-mix〕；旧色/拼接零残留；哈希 `7113d2d1…`） |
| U2-Fb | agent-pipeline | 收尾修复：ActionPanel alpha 拼接非法 CSS（`cc+'18'` 等）改 `color-mix` | `frontend/src/components/ActionPanel.tsx` | U2 | **已就地消解**（U2 重写 ActionPanel 时该模式随重写清除；本上下文复扫 ActionPanel/ActionDialog/ChatPanel/两卡 = alpha 拼接零残留） |
| U2-Fc | agent-pipeline | 收尾修复：PlanCard/ReviewCard 旧色收编 + 组件内残余文案 emoji 退场 + ActionDialog 动作键 emoji 图标退场 | `PlanCard.tsx`/`ReviewCard.tsx`/`ChatPanel.tsx`/`ActionDialog.tsx`（+ `ActionPanel.tsx`、`useAutoExec.ts` 必要触及） | U2（已完成） | **verified**（attempt 1；PlanCard/ReviewCard 旧色收编〔含 ReviewCard `+'20'` 拼接修复、一处三元按角色卡拆 if/else〕+ 文案 emoji 退场〔ChatPanel 12 处、useAutoExec 3 处〕+ 动作键 icon 置空并按渲染点安全跳过；哈希 `8ba8b82b…`/`2db71a40…`/`1b20468c…`/`0994986e…`；Section 1 彩色 emoji 零残留） |
| U2-Fd | graph-view | 收尾修复：MapperView 字符串内 emoji 退场（状态签/页签前缀共 28 处） | `frontend/src/components/MapperView.tsx` | U2-Fa（已完成） | **verified**（attempt 1；28+/28− 纯字符串替换；全文件彩色 emoji 零残留；哈希 `1734948f…`） |
| U2-Fe | app-shell | 保留项处置：`ResizeHandle.tsx` 两处旧悬停色 `#374151/15`→`rgba(27,42,68,.15)` | `frontend/src/components/ResizeHandle.tsx` | U-V（保留①） | **verified**（attempt 1；diff 恰 2 行、`#374151` 零残留；哈希 `c31a26d7…`；按不变式 #6 最小复验：tsc=0、npm test 119/119） |
| U-Icon | app-shell | 新图标替换：`icon-source.webp`→1024 PNG；替换根 `icon.png` + `frontend/public/icon.png`；删除无引用副本 `icon2.png` | `icon.png`、`icon2.png`（删除）、`frontend/public/icon.png` | —（治理已增补 Section 1） | **verified**（attempt 1；两处均 1024×1024 PNG、同哈希 `3a1c3b16…`；icon2.png 已删〔git 已跟踪、可回溯〕；引用链核对：dev 回退命中根、favicon/win.icon→public；mac icns 未配置〔跳过，可选后续〕。**boundary.md/.yaml 的 icon2.png 行已由治理同步移除**） |
| U-V | project-test | 批末独立验证（四门槛 + 冒烟 + 硬编码色遗留核查 + 行为零变更复核） | `frontend/test/project-test/**`（如需）、本角色 docs | U1…U2e | **verified**（attempt 1，reportId b2u-v-project-test-attempt1；结论「有保留」）：四门槛独立 ×5 全绿（119/119×2、tsc/build/check=0）；22/22 哈希三采样（pre/post/final）与清单逐字一致；彩色 emoji 零命中；hex/rgba 全量盘点全归 B 族（保留① ResizeHandle 批外旧色）；骨架 diff 逐项等价（含 8 项清单外发现全判定零行为变更）；图标核验通过；零改动证明齐。**保留处置**：① → 补批 U2-Fe；② `#000` 中性阴影、③ historyCtx 字节变化（✅/⬜→✓/○）为披露级，接受。**冒烟**：客户实例占用 19850/5173 → 未自起（不触碰；只读 health 200 旁证；客户进程自 16:08:56 组） |
| U-D | project-management | 收口（提案与记录、客户 GUI 目视清单） | 本角色 docs | U-V | **verified**（本上下文执行；见 seq 6 与 §5） |

**写集冲突**：U1/U1b 先行（token 与值层）；U2 各组角色文件互不相交，可并行；U2e（i18n）与其他不交。
**GUI 目视（客户）**：U1 后先给一次「重启应用即可看新观感」的时点提示（换肤级）；U2 后给完整目视清单（四区）。

## 3. 验收口径（来自提案 §5）

`npm test` 119/119、`tsc`=0、`build`=0、`check:electron`=0 → 启动冒烟 → **GUI 目视由客户确认** → 批末 project-test 在合并候选上独立验证（重点：四门槛、行为零变更、硬编码色替换面核查）。U1 中途检查：tsc + npm test（快速）。

## 4. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | 全部 | 客户选定方向 B 蓝图室（提案置 approved）；批 2 提交前置满足（`ef99479`/`b0ce23a`）；节点表与写集入档；**U1（app-shell）+ U1b（graph-view）并行派发** |
| 2 | 2026-10-16 | verification-passed | U1b | 本上下文核验通过：diff 恰为值替换（29+/29−，无结构/逻辑行）；45 值逐项对应规格清单；旧色值零残留（29 项自查）；哈希 `3fa860b2…` 与报告一致；tsc=0（agent 自检复述 + 本上下文范围核对）。U1b verified；U1（app-shell）仍在运行 |
| 3 | 2026-10-16 | verification-passed | U1 | 本上下文核验通过：16 `--bp-*` + 24 语义条唯一来源 + 26 `--ibm-*` 别名（名集合逐字未变）；index.css 旧值 17 项零残留；tailwind 圆角 xl/2xl 收编在册；哈希与报告一致；**tsc=0、npm test 119/119**。**U1 检查点达成：「重启应用即可看新观感」时点已报协调者**（换肤级：纸白+墨蓝+制图红底座；组件级旧色残留属预期，U2 处理）。另：U1 代理审计发现两处**存量**悬空变量引用（App.tsx:369/393 `--ibm-layer`、MapperView.tsx:136 `--color-bg-hover`，批前即存在）→ 归 U2/U2b 顺带修复。**U2 四路（agent-pipeline / graph-view / app-shell / project-data）+ U2e（i18n，本上下文）派发** |
| 4 | 2026-10-16 | verification-passed | U2b/U2c/U2d/U2e | 四路核验通过：U2b（88+/64−；含网格显示修复〔`.bg-layer` 遮罩——批前网格从未显示〕+ 悬空变量修复；发现残余异族色与 alpha 拼接非法 CSS 两问题 → U2-Fa/U2-Fb）；U2c（9+/9−；TitleBar 核对零改动）；U2d（22+/22−；旧值零残留）；U2e（20 键×4 包）。**U-Icon 派发**（客户「图标也换一下」）——治理已增补根 `icon.png`/`icon2.png` 入 app-shell Section 1；`icon2.png` 为逐字节相同、零引用副本（本上下文 grep 复核），裁定**删除**（引文可回溯；保持同步徒留困惑）；mac icns 未配置 → 按不扩原则跳过（可选后续）。**U2-Fa 派发**（graph-view 收尾） |
| 5 | 2026-10-16 | verification-passed | U2/U2-Fa/U2-Fc/U2-Fd/U-Icon | 全部核验通过（哈希/零残留/diff 范围/tsc 逐项复核）。**候选冻结**（22 文件清单 → `/tmp/b2u-v/hashes.txt`）；**批末四门槛复跑全绿**（本上下文：tsc=0、npm test **119/119 ×2**、build=0、check:electron=0）。**冒烟说明**：闭环期客户实例正占用 19850/5173（客户目视进行中）→ 不触碰、不执行、如实记录（客户实际运行即运行态佐证；U-V 按端口可用性执行或记录）。「完整观感 + 图标重启后可见」时点已报协调者。**U-V（project-test 批末独立验证）派发**（独立上下文） |
| 6 | 2026-10-16 | closed | U-V/U2-Fe/U-D | U-V 报告核验通过（本上下文复核其证据与判定，含 8 项清单外发现逐条等价性成立）+ **保留①已补批处置**（U2-Fe verified，按不变式 #6 最小复验绿）→ **二版候选冻结**（22 件不变 + `ResizeHandle.tsx` `c31a26d7…` 增量；U-V 结论对应版与 U2-Fe 增量两版均可追溯）。**U-D 收口**：提案与设计文档置 verified、本记录收口（§5）、memo 更新、最终报告经协调者转呈。**批闭环**；提交/发布待客户决定（工作树未提交 = 本批；客户已于 16:08:56 重启实例——新图标应已可见） |

## 5. 收口汇总（2026-10-16）

- **节点**：U1、U1b、U2、U2b–U2e、U2-Fa…U2-Fe、U-Icon、U-V、U-D 全部 **verified**；事件 seq 1–6。
- **最终候选**：22 文件哈希清单 `/tmp/b2u-v/hashes.txt`（三次采样一致）+ 增量 `ResizeHandle.tsx` `c31a26d7…`（U2-Fe 后）；完整前缀见 seq 5 与各节点行。
- **门槛（最终）**：npm test **119/119 ×2**、tsc=0、build=0、check:electron=0（本上下文 + U-V 独立共 ×5 全绿）；彩色 emoji 全仓零；异族色零（按 U-V 盘点口径，白名单=R 颜料族与中性）。
- **批内附带修复的存量缺陷**（非本批引入、随本批治愈）：① MapCanvas 网格被 `.bg-layer` 不透明底遮蔽（从未显示）；② 悬空 CSS 变量 3 处（App.tsx ×2、MapperView ×1）；③ alpha 拼接非法 CSS 5 处（MapperView ×4、ActionPanel ×1）。
- **未测项（如实）**：① 自起端到端冒烟——客户实例占用 19850/5173，按纪律未执行（不触碰；只读 health 200 旁证；客户使用中）；② GUI 目视（四区 + 新图标）由客户确认；③ mac icns 未配置（可选后续）。
- **工作树**：本批未提交（22+1 应用文件 + 2 图标 + 本角色文档）；提交/发布待客户决定（R14：验证不授权提交）。
- **遗留/建议**：boundary 的 icon2.png 行已由治理同步移除（2026-10-16）；`historyCtx`（发往 LLM 的历史上下文）✅/⬜→✓/○ 字节变化已披露备案；字体策略维持现状。
