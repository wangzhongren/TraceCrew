---
id: change-batch1-cleanup-hardening
type: change
title: 批 1 实施提案：卫生清理与防复发（D8/D10/D5/D6/D7/N1/N2/N5）
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: verified
related: [design-architecture-upgrade-plan]
events:
  - date: "2026-10-16"
    kind: created
    summary: 依据客户对升级方案的四项决策，把批 1（并建议并入 D5/D6/D7 清理）合并为一份实施提案：逐项范围/验收/归属/依赖与批末独立验证，待客户批准
  - date: "2026-10-16"
    kind: implemented
    summary: 客户批准 C1–C8 + D5/D6/D7 并入 + O-b1 + 存储层保留；按节点表实施（B1-1…B1-6、X1-A/C/B、X2-A/B、R1-N）
  - date: "2026-10-16"
    kind: verified
    summary: B1-V 独立验证通过（98/98、tsc=0、build=0、check:electron=0、冒烟与 404 复核、零 skip/only）；X2 增量合并复验全绿
---

# 批 1 实施提案：卫生清理与防复发

> 状态：**已全部实施并通过独立验证（2026-10-16 闭环）**。这是《项目架构升级方案》（[../design/2026-10-16_design_architecture-upgrade-plan.md](../design/2026-10-16_design_architecture-upgrade-plan.md)）批 1 的合并实施提案。附属小项 X1（5 条类型错误）、X2（类型门全同标准）、R1-N（锁名忽略）均已闭环；逐项实施证据与观察项归目见 [../scheduling/architecture-batch1.md](../scheduling/architecture-batch1.md)；全程未提交 git（提交待客户决定）。
> 客户 2026-10-16 决策：批 1 先立项（D8、D10、N1、N2-electron 第一批、N5）；D5→清理、D6→删除、D7→清理；N1 用 ratchet；`.codeatlas/` 数据默认不动；N5/D8 先实测打包。
> 分派规则：**一份提案一次批准**；批准后按归属角色分派实施，每人独立上下文；批末由固定测试角色在小合并候选上独立验证（「提案 → 批准 → 实施 → 独立验证」不放松）。

## 1. 本次包含什么（八项内容 + 一块验证）

| 编号 | 内容 | 归属角色 | 量级 | 依赖 |
| --- | --- | --- | --- | --- |
| C1 | D8 遗留命名与无效打包引用清理 | app-shell | S | C8 实测先行（同一节点内） |
| C2 | D10 i18n 文案修正（+ 选装 O-b1 一致性测试） | project-management | S | — |
| C3 | D5 清理：三个占位路由 + `getUrl` | app-shell + project-data + graph-view | S | C1/C3 的装配部分先于文件删除（见 §5 顺序） |
| C4 | D6 删除：summarizer 及其相关表/接口 | project-data | S | — |
| C5 | D7 清理：前端 remap 处理与 i18n 键 | agent-pipeline + project-management | S | — |
| C6 | N1 electron 类型门（配置 + 脚本；ratchet） | app-shell（**前置：治理增补路径**） | S-M | 治理先增补 `frontend/tsconfig.electron.json` |
| C7 | N2 electron 第一批：静默 catch 处置 | project-data + agent-pipeline | S | — |
| C8 | N5 打包实测（并入 C1 节点首位） | app-shell | S | — |
| B1-V | 批末独立验证（回归 + 冒烟 + 逐项复查） | project-test | — | C1–C8 全部完成 |

**请求批准范围**：C1–C8 全部 + 是否采纳 **O-b1**（见 §6）。本提案同时把「D5/D6/D7 并入批 1」作为**排期建议**呈报（理由：同属卫生/减死代码、同为 S 级、同一波验证可省往返）；若客户希望拆出，我们按拆出执行（见 §4 说明）。

## 2. 逐项范围与验收

### C1（D8）遗留命名与无效打包引用 — app-shell

**改什么**（精确文件与位置，2026-10-16 核查）：

1. `electron/server/index.ts`：健康检查 `res.json({ status: 'ok', service: 'code-atlas' })` → `service: 'tracecrew'`。（消费方核查：`start.sh` 只检查请求成功与否，不看 service 名；无其他消费方。）
2. `start.sh`：第 5 行 `LOCK_FILE=".../.codeatlas.lock"` → `.tracecrew.lock`；第 15 行横幅 “CodeAtlas Launcher” → “TraceCrew Launcher”；第 55 行 “Starting CodeAtlas” → “Starting TraceCrew”。
3. `start.bat`：同上（第 2 行 `title`、第 8 行 LOCK_FILE、第 11/45 行文案）。
4. `frontend/package.json` 的 electron-builder 配置：从 `build.files` 移除 `"../backend/**/*"`，删除引用不存在目录的 `build.extraResources` 整块（`../backend` 在 2026-10-16 核查中不存在）。
5. `.codeatlas/` 目录与其 4 组历史备份**不动**（客户口径）；`.gitignore` 对 `.codeatlas` 的忽略保持（不提清理数据）。

**验收**：启动冒烟后 `curl /api/v1/health` 返回 `{"status":"ok","service":"tracecrew"}`；`grep -n "CodeAtlas\|codeatlas" start.sh start.bat electron/server/index.ts` 仅剩有意保留项（预期为零；`.codeatlas` 数据引用不在这些文件）；`npm run electron:build` 结果按 C8 记录；`npm test` 全绿。

### C2（D10）i18n 文案修正 — project-management

**改什么**：4 个语言包（`frontend/src/i18n/zh-CN.json`、`en.json`、`ja.json`、`ko.json`）。

1. `chat.pipelineFlow`：改为含 Architect 的真实流水线（中文 “PM → Architect → Planner → Reviewer → Mapper”；其余语言同语义）。
2. **实施时扫描并列出**其它引用旧「四段式」或与实际流程不符的键（如 `chat.pipelineHint` 等），逐条修正或确认无需改——清单与判定写入实施报告。

**验收**：`npm test` 全绿；文义与 `architecture.md` 的流水线描述一致（逐条对照）。

### C3（D5）清理占位路由与 `getUrl`

**改什么**（删除文件 + 摘除引用；2026-10-16 核查引用面）：

1. **app-shell**：`electron/server/index.ts` 删除 `featuresRoutes`/`changesRoutes`/`topologyRoutes` 的 import 与三行 `app.use('/api/v1/...')` 挂载（保留 agentRoutes）；`electron/preload.ts` 删除 `backend: { getUrl: ... }`；`frontend/src/types/electron.d.ts` 同步删除 `backend` 段（契约同步，R6）。
2. **project-data**：删除 `electron/server/routes/features.ts`、`electron/server/routes/changes.ts`。
3. **graph-view**：删除 `electron/server/routes/topology.ts`。
4. **范围外说明（刻意保留）**：`services/db.ts` 的 features CRUD（`loadFeatures`/`saveFeatures`/`findFeature`/`updateFeatureChildren`/`updateFeatureOverview`）与 change_queue（`pushChange`/`pullChanges`/`hasPendingChanges`）及对应表**保留不动**——客户 D5 口径是「占位路由 + getUrl」；存储层无消费者但保留可在未来功能立项时复用（如需一并删除请批准时指出；对应约 15 条测试的处置需单独说明）。
5. 次序要求：**先**摘挂载与 getUrl（app-shell），**后**删路由文件（project-data / graph-view）——避免出现「文件已删、挂载仍在」的启动崩溃窗口。

**验收**：`grep -rn "routes/features\|routes/changes\|routes/topology\|getUrl" electron/ frontend/src/` 零命中（排除 `角色卡/` 与文档）；`npm test` 全绿；冒烟通过（health 正常）；被删端点 `curl /api/v1/features` 返回 404。

### C4（D6）删除 summarizer 及其相关表/接口 — project-data

**改什么**（2026-10-16 核查：`summarizer.ts` 是这些导出的唯一消费者）：

1. 删除 `electron/server/services/summarizer.ts` 整文件（含 `SummarizerService`、提示词、队列逻辑）。
2. `electron/server/services/db.ts`：删除 `file_summaries` 的 `CREATE TABLE` 块与其后的 `total_lines` 迁移 `ALTER TABLE` 块；删除 `upsertFileSummary`、`getFileSummary`、`getFileSummariesForContext`、`FileSummary` 接口。
3. 既有项目数据库中的 `file_summaries` 表**不动**（无害；不写迁移删表）。
4. 可从 git 历史找回（客户口径）——在提交信息/变更记录中注明。

**验收**：`grep -rn "summarizer\|file_summaries\|FileSummary\|upsertFileSummary\|getFileSummary" electron/ frontend/ --include="*.ts" --include="*.tsx"`（排除 node_modules）零命中；`npm test` 全绿（db.test.ts 未覆盖这些函数，无需改测试——实施时核验）；冒烟通过。

### C5（D7）清理前端 remap 处理 — agent-pipeline + project-management

**改什么**（2026-10-16 核查的位置全清单）：

1. **agent-pipeline**：`frontend/src/App.tsx` 第 538 行删除 `case 'remap_token':` 分支（归入 token 分支或删除，保持 switch 合法）；第 583 行 fallback 判断中去掉 `|| event === 'remap_token'`；`frontend/src/components/ActionPanel.tsx`：`StreamState` 的 phase 联合类型两处去 `'remap'`；第 81 行文案分支去 remap 项；第 362 行 `getPhaseConfig` 去 `'remap'` case。
2. **project-management**：4 个语言包删除 `action.remapping` 键（代码移除后核验无消费者）。

**验收**：`grep -rn "remap" frontend/src/` 零命中；`npm test` 全绿；冒烟通过。

### C6（N1）electron 类型门（配置 + 脚本；ratchet）— app-shell

**前置（治理）**：需要 ANS Governance 把 **`frontend/tsconfig.electron.json`（新文件）** 增补进 app-shell 的 Section 1（其余改动均在既有白名单：`frontend/package.json`）。

**改什么**：

1. 新建 `frontend/tsconfig.electron.json`：`include` 覆盖 `../electron/**/*.ts`；`strict`、`skipLibCheck`、`moduleResolution: bundler`；用 `baseUrl: "."` + `paths: { "*": ["./node_modules/*"] }` 让 `better-sqlite3`/`openai` 等从 `frontend/node_modules` 解析（当前试算的 11 项 TS2307 即由此而来）。
2. `frontend/package.json` 增加脚本 `"check:electron": "tsc --noEmit -p tsconfig.electron.json"`。
3. **ratchet 政策**（客户已定）：不要求一次清完历史注解类报错；**只要求今后新改/新增的 electron 文件不引入新的检查错误**（评审 + 本命令输出为准）。政策由项目管理写入 `docs/project-rules.md`。

**验收（2026-10-16 实施结果）**：`cd frontend && npm run check:electron` 可运行，**基线 = 0 条**（含 `noUnusedLocals`/`noUnusedParameters` 全同标准旗标；worker 与项目管理双负对照证实检查器有效）；`npm test` 与 `npm run build` 均绿。**Δ口径修正**：预告的「≈77」为 ad-hoc 解析噪音快照（归因见 [../scheduling/architecture-batch1.md](../scheduling/architecture-batch1.md) §5），不构成真实债；政策「保持 0」已写入规则 R19。

### C7（N2）electron 第一批：静默 catch 处置 — project-data + agent-pipeline

**政策（写入规则）**：electron/ 内每处 `catch` 要么**输出错误**（含定位上下文），要么用注释**显式说明为何可忽略**（两者必居其一）。

**改什么**（2026-10-16 扫描的 electron/ 剩余静默点）：

- project-data：`electron/fileManager.ts` 第 574 行（`appendTaskLog` 的 `catch { /* best-effort… */ }`）→ 补输出（含日志路径/原因）或按政策改为显式说明+输出；`routes/features.ts`、`routes/changes.ts` 的静默点随 C3 整文件删除，不再单独处理。
- agent-pipeline：`electron/server/services/agent.ts` 6 处（第 1137/1200/1546/1585/1723/1777 行附近）——**逐处判断**：属“预期失败”（如 JSON 解析尝试、无存档计划）的写显式注释；属“不该发生”的补 `console.log`。逐处清单与判定写入实施报告。
- `services/db.ts` 两处迁移 catch（`/* column already exists */`）已有显式说明，保留不动（并在报告中注明该判定）。

**验收**：electron/ 内（除 C3 删除的文件）不存在「空 catch 且无说明」；`npm test` 全绿；冒烟通过。

### C8（N5）打包实测 — app-shell（并入 C1 节点首位）

**做什么**：在 `frontend/` 实跑 `npm run electron:build`（vite build + electron-builder），记录：命令、耗时、退出码、关键输出、产物路径与是否存在。**若报错**：按「缺陷优先」处理——先按 C1 的打包引用修复后重跑；若仍有其它原因，如实列入实施报告并按你的判断提出后续（不在本提案内擅自扩大修复范围）。

**验收**：一次完整实测记录（通过=产物存在；失败=原始报错 + 已修/未修说明）。

## 3. 批次末独立验证（B1-V，project-test）

在**合并候选**上执行：`npm test`（预期全绿；基线 95 例，删测试仅限 C3/C4 明确删除的代码所对应的用例——本提案 C3/C4 均不删既有测试，故预期仍 95；如实施中出现用例数变化，须逐条说明）；冒烟（`electron:dev` + health）；逐项 grep 复查（C1/C3/C4/C5/C7 的零引用项）；不变式 #7 复查（无 skip/only；删除代码不留半截引用）。结论三态 + 未测项照常。

## 4. 排期建议：D5/D6/D7 并入批 1（呈请确认）

- **建议并入**：三者都是「清理/删除」型 S 级小项，与批 1 主题（卫生）同质；并入可共用一次批准、一次批末独立验证，避免三次往返。且 C1 已要动 `server/index.ts`，与 C3 的挂载摘除同文件同角色，合并实施最省。
- **若客户不并入**：C3/C4/C5 拆为独立的「批 1b」提案，按同一流程单独批准与派发；批 1 主体（C1/C2/C6/C7/C8）不受影响。
- **C3 的范围外说明**（§2 C3 第 4 点：存储层保留）请一并确认。

## 5. 角色分工与实施顺序

| 步 | 节点 | 角色 | 内容 | 前置 |
| --- | --- | --- | --- | --- |
| 1 | B1-1 | app-shell | C8（打包实测）→ C1（命名/引用）→ C3 的装配部分（摘挂载 + getUrl） | 无 |
| 2a | B1-2 | project-data | C3 的文件删除（features/changes）+ C4 + C7（fileManager） | B1-1（先摘挂载后删文件） |
| 2b | B1-3 | graph-view | C3 的文件删除（topology） | B1-1 |
| 2c | B1-4 | agent-pipeline | C5（App/ActionPanel）+ C7（agent.ts） | 无（与 B1-1 无写集冲突） |
| 2d | B1-5 | project-management | C2 + C5 的 i18n 键删除（+O-b1 如获批） | C5 代码移除后（键删除前核验无消费者） |
| 3 | B1-6 | app-shell | C6（配置 + 脚本） | 治理增补 `frontend/tsconfig.electron.json` |
| 4 | B1-V | project-test | 批末独立验证 | 全部完成 |
| 5 | — | project-management | 规则与文档更新（ratchet 政策、R4/R9/R10 相关状态、方案/提案状态） | B1-V 通过 |

## 6. 必选 / 选装

**本次必须做**：C1–C8（含 D5/D6/D7 并入，若客户确认）+ B1-V。

**选装**（默认勾选为推荐，旁边标注待客户确认）：

- [x] O-b1：i18n 一致性测试（4 语言包键集合一致 + 关键键存在），放 `frontend/test/project-management/i18n.test.ts`。**（已获客户批准并实施：3 例，随 B1-5 落地，计入 98 例基线）**
  好处：本次的「文案漂移」这类问题以后测试即可拦住；四语言包漏译也会被发现。
  不加会怎样：文案仍靠人工比对；不影响本次其余条目。
  代价：一个测试文件（约 30 行）+ 后续改键时需同步（这正是它的目的）。

## 7. 未决问题

1. **治理前置**：`frontend/tsconfig.electron.json` 需先增补进 app-shell Section 1（B1-6 的前置）。
2. **O-b1** 是否采纳。
3. **D5 存储层保留口径**（§2 C3 第 4 点）是否确认；若不保留，需单列说明（含约 15 条对应测试的处置）。
4. **C8 打包实测结果**是实施产出——若报错超出「删无效引用」可修范围，将如实上报再定。

## 8. 事实核查附录（2026-10-16，用于本提案范围界定）

- 三个路由文件的唯一引用方：`electron/server/index.ts`（imports + mounts）。
- `getUrl` 唯一位置：`electron/preload.ts:53`、`frontend/src/types/electron.d.ts:86`；零消费者。
- `remap` 全部位置：`App.tsx:538,583`、`ActionPanel.tsx:10,12,81,362`；i18n 键 `action.remapping`（4 语言，唯一消费者是 ActionPanel）。
- `summarizer` 相关：`services/summarizer.ts` 是 `upsertFileSummary`/`getFileSummary`/`FileSummary` 的唯一消费者；`db.test.ts` 未覆盖这些函数。
- `CodeAtlas` 字符串：`start.sh:5,15,55`；`start.bat:2,8,11,45`；`server/index.ts` 健康检查 service 名；`.codeatlas/` 数据目录与 `.codeatlas.lock`（客户口径：数据不动）。
- `../backend`：目录不存在；引用位于 `frontend/package.json` 的 `build.files` 与 `build.extraResources`。
- 属主核对：`routes/features.ts`、`routes/changes.ts` ∈ project-data；`routes/topology.ts` ∈ graph-view；`server/index.ts`、`preload.ts`、`electron.d.ts`、`start.sh`、`start.bat`、`package.json` ∈ app-shell；`App.tsx`、`ActionPanel.tsx`、`services/agent.ts` ∈ agent-pipeline；`fileManager.ts`、`services/db.ts`、`summarizer.ts` ∈ project-data；i18n 与本文档 ∈ project-management。
