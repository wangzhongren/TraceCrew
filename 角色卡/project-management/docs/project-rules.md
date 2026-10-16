# 项目工程规则（project-rules）

> 维护：项目管理角色。**只收录已确认事实**，每条注明来源；未经核实的内容放在文末 [「待确认」](#8-待确认未核实不作为规则)，不作为规则执行。
> 本文件**不扩大任何角色的权限**——每个角色能改哪些文件仍以各自 `boundary.md` 的 Section 1 为准。
> 建立：2026-10-16（首个基线版本，随附本角色 bootstrap 交付物）；最后更新：2026-10-16。

## 1. 命令与端口

### R1 构建、启动、测试命令都在 `frontend/` 下执行

| 目的 | 命令（在 `frontend/` 下） | 实际执行内容 |
| --- | --- | --- |
| 开发启动 | `npm run electron:dev` | `vite`（vite-plugin-electron 构建主进程/preload 并启动 Electron，内嵌后端随之监听 19850） |
| 纯前端开发服务器 | `npm run dev` | `vite` |
| 类型检查 + 构建 | `npm run build` | `tsc --noEmit && vite build` |
| electron/ 独立类型检查（ratchet 门） | `npm run check:electron` | `tsc --noEmit -p tsconfig.electron.json`（基线 0，见 R19） |
| 打包 | `npm run electron:build` | `vite build && electron-builder` |
| 测试（跑一次） | `npm test` | `vitest run` |
| 测试（监听） | `npm run test:watch` | `vitest` |

仓库根没有 `package.json`；根目录的 `start.sh` 负责清理残留进程后在 `frontend/` 执行 `npm run electron:dev`，并健康检查 19850。
**来源**：`frontend/package.json` scripts 字段；`start.sh` 全文；角色卡 app-shell memo（2026-10-16 条目）。

### R2 端口是硬编码契约，改动要三处同步

- 内嵌后端固定 **19850**：`electron/server/index.ts` 的 `const PORT = 19850`，启动日志与 `start.sh` 的健康检查依赖它。
- 开发前端 **5173**：`frontend/vite.config.ts` 的 `server.port`。
- preload 暴露的 `backend.getUrl()` **硬编码** `http://localhost:19850`；开发模式下前端 `/api` 请求由 Vite 代理转发到 19850（对 URL 含 `/stream` 的请求专门设置不缓冲，保证 SSE 实时）。
- 因此改端口至少涉及三处：`server/index.ts`、`vite.config.ts`（proxy target + port）、`preload.ts`（getUrl）。
**来源**：上述三个文件；2026-10-16 逐处核对。

## 2. 环境与依赖

### R3 `.env` 位于仓库根目录；按 Agent 分键 + 全局回退链

- 每 Agent 键（3 个字段 × 6 个 Agent）：`TRACECREW_LLM_<AGENT>_API_KEY`、`TRACECREW_LLM_<AGENT>_BASE_URL`、`TRACECREW_LLM_<AGENT>_MODEL`；`<AGENT>` ∈ {`PM`, `ARCHITECT`, `PLANNER`, `REVIEWER`, `MAPPER`, `EXECUTOR`}。
- 回退链：`TRACECREW_LLM_<AGENT>_<字段>` → 旧版全局键 `TRACECREW_LLM_API_KEY` / `TRACECREW_LLM_BASE_URL` / `TRACECREW_LLM_MODEL`。
- 特殊回退：**Architect 的 API_KEY 为空时借用 Planner 的整组配置**（baseURL/model 同样回退）。
- 读取：`electron/main.ts` 启动时用 dotenv 加载仓库根 `.env`（路径按构建产物 `frontend/dist-electron/../../.env` 解析，开发态即仓库根）。
- 写入：设置面板保存 → `POST /api/v1/settings` → 同步 `process.env` + `settingsStore.updateEnvFile()` 写回 `.env` → `agentService.reload()` 清客户端缓存，**无需重启**。
- 拼写以源码为准：前缀统一是 `TRACECREW_LLM_`（历史任务单里出现过 `TRACECWREW` 的拼写笔误；`electron/settingsStore.ts` 与 `electron/server/index.ts`、`services/agent.ts` 三处一致，均为 `TRACECREW`）。
**来源**：`electron/server/services/agent.ts`（`getAgentConfig`）、`electron/server/index.ts`（settings 路由）、`electron/settingsStore.ts`、`electron/main.ts`、`.env.example` 键名清单；2026-10-16 核对。

### R4 better-sqlite3 必须按 Electron ABI 预编译（当前环境事实）

- 现状：`frontend/node_modules/better-sqlite3/build/Release/better_sqlite3.node` 按 **NODE_MODULE_VERSION 132（Electron 34 ABI）** 编译。
- 后果一：在 Electron 34.5.4（项目 devDependencies 指定的版本）下可用。
- 后果二：在 Node 24（NODE_MODULE_VERSION 137，本机 `node --version` = v24.14.0）下，`new Database()` 直接抛出 “was compiled against a different Node.js version … NODE_MODULE_VERSION 132 … requires 137”。因此系统 Node 下无法连库；2026-10-16 起测试改跑在 Electron 的 Node 上规避该矛盾（见 R9）。
- 重建命令（bootstrap 记录）：在 `frontend/node_modules/better-sqlite3` 目录下执行
  `../.bin/prebuild-install -r electron -t 34.5.4 --arch arm64`
  （`frontend/node_modules/.bin/prebuild-install` 与 `build/Release/better_sqlite3.node` 均已存在）。
- 同一个 `.node` 文件只能是一种 ABI：为 Electron 重建的版本在 Node 下不能用，反之亦然。
- 测试侧落地（2026-10-16，M1 已核验）：`npm test` = `cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run`，测试与二进制同 ABI、全部通过；系统 Node 下不再跑测试（矛盾由此规避，无需双二进制切换）。
**来源**：2026-10-16 实测（`npx vitest run test/db.test.ts` 的报错原文；`electron --version` = v34.5.4；二进制与 prebuild-install 存在性检查）；重建命令来自本项目 bootstrap 验收记录。

## 3. 通信契约

### R5 HTTP/SSE：事件是「一行一个 JSON」

- 后端把每个事件写成 `JSON.stringify({ event, data }) + '\n'`；前端按 `\n` 切分、逐行 `JSON.parse`。
- 事件名按端点列出（详见 `角色卡/project-management/docs/architecture.md` 第 5.1 节）：
  - `/api/v1/agent/chat/stream`：`token`、`reasoning`、`tools`、`done`。
  - `/api/v1/agent/plan/stream`：`plan_token`、`plan`、`plan_error`。
  - `/api/v1/agent/step/stream`：`step_token`、`step_done`、`step_error`。
  - `/api/v1/agent/action/stream`：`phase`、`reasoning`、`token`、`review_token`、`tools`、`done`。
  - `/api/v1/topology/stream`：`connected`、`ping`（30 秒心跳）。
- 事件名与数据形态是跨角色契约：变更前先更新设计并通知消费方（前端 App.tsx / ChatPanel 等）。
**来源**：`electron/server/routes/agent.ts`、`routes/topology.ts` 与 `frontend/src/App.tsx`、`ChatPanel.tsx` 的解析代码；2026-10-16 核对。

### R6 `window.tracecrew` 桥契约与类型声明必须同步维护

`electron/preload.ts` 暴露的 `window.tracecrew`（file / shell / backend / window / getAppIcon 五组）与 `frontend/src/types/electron.d.ts` 的 `TraceCrewAPI` 是同一契约的两半，属 app-shell 角色，改动必须两边同步，避免漂移。
**来源**：两个文件对照；角色卡 app-shell「执行原则」。

### R7 本机能力走 IPC，LLM 流水线走 HTTP

- 文件读写/搜索/Shell/窗口控制：IPC（`ipcRenderer.invoke` 与事件，经 preload 桥）。
- Agent 对话、动作执行、设置读写：HTTP/SSE（19850）。
**来源**：`preload.ts`、`main.ts` 的 `ipcMain.handle` 清单与 `server/` 路由清单。

## 4. 数据落盘

### R8 每个被打开的项目在自身目录下生成 `.tracecrew/`

- `STATE.json`（图谱/计划快照，前端）、`ARCHITECTURE.md`、`plans/`（`<日期>-<slug>.md`、`latest.md`、`README.md` 索引）、`tracecrew.db`（SQLite，WAL 模式，表：features、change_queue、meta、file_summaries）、`TASKLOG.md`（追加式任务日志）、`backups/<id>/`（写前备份 `before` + `meta.json`）、`deleted/`（删除保护回收站）。
- Shell 执行日志放在被打开项目的 `.tracecrew-logs/`（注意：不是 `.tracecrew/logs`）。
- 备份的“项目根”判定：从被改文件向上找第一个含 `.git` 或 `.tracecrew` 的目录。
**来源**：`frontend/src/App.tsx`、`ChatPanel.tsx`；`electron/server/services/db.ts`；`electron/fileManager.ts`（createBackup / deleteFile / runShell / appendTaskLog / findProjectRoot）；2026-10-16 核对。

## 5. 测试

### R9 测试位置与运行配置

- vitest 配置（`frontend/vitest.config.ts`）：`include: ['test/**/*.test.ts', 'test/**/*.test.tsx']`（相对 `frontend/`，**递归**生效）；`globals: true`；`environment: 'node'`；alias `@` → `src`。
- 测试运行方式（2026-10-16 起，测试红灯修复 M1 落地）：`npm test` / `npm run test:watch` 经 `cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs [run]` 启动，跑在 **Electron 内置 Node** 上，与 better-sqlite3 二进制的 ABI 一致（见 R4）。注：vitest 4 检测到 agent 环境变量（CLAUDECODE / AI_AGENT）时会自动禁用 watch 只跑一次；真实用户终端不受影响。
- 目录约定（各角色卡已验收）：
  - 各角色**新写的**测试放 `frontend/test/<role>/`（如 `frontend/test/project-management/`、`frontend/test/project-test/`、`frontend/test/graph-view/`、`frontend/test/app-shell/`、`frontend/test/project-data/`）。
  - 既有 3 个测试文件仍在 `frontend/test/` 根下：`agent.test.ts`（归 agent-pipeline 维护）、`db.test.ts` 与 `fileManager.test.ts`（归 project-data 维护）。是否迁入角色目录未决（见 T6）。
**来源**：`frontend/vitest.config.ts`；各角色卡「质量约束」（bootstrap 验收）。

### R10 测试套件状态（2026-10-16：红灯已解除）

- 历史（2026-10-16 上午实测）：`npm test` = 3 个文件失败、43 失败 / 50 通过（93 例）；两类原因：ABI（15 例）+ 用例过时（28 例）；复测后又确认 1 项 (c) 实现缺陷（`searchInFiles` 恒空，3 例）。当时「任何测试通过的表述都不成立」的约束，随本条更新即告解除。
- 现状（2026-10-16 批 1 后）：**5 个文件、98/98、退出码 0**（含 O-b1 的 i18n 一致性测试 3 例）；`tsc --noEmit`=0、`npm run build`=0、`check:electron`=0（见 R19）。批 1 独立验证（B1-V）通过：两连跑无 flake、skip/only 零命中、启动冒烟通过。
- 处置记录：[docs/fix/2026-10-16_fix_test-suite-red.md](fix/2026-10-16_fix_test-suite-red.md)、[docs/fix/2026-10-16_fix_search-in-files-empty.md](fix/2026-10-16_fix_search-in-files-empty.md)；调度记录 [docs/scheduling/test-suite-red-fix.md](scheduling/test-suite-red-fix.md)。
**来源**：2026-10-16 本机实测（实施前 43 失败逐文件清单；实施后 94/94 与逐节点核验记录）。

## 6. 质量门（全项目）

### R11 相邻层调用
Interface → Pipeline → Service → Provider；Model 共享。已知存量偏差（Express 路由直连 services、组件从 MapCanvas 导入类型、App.tsx 双重职责等）如实记录在 `docs/architecture.md` 第 8 节；**新代码不扩散新偏差**；整改与否是客户待决策项。
**来源**：各角色卡「质量约束」（bootstrap 验收）。

### R12 代码质量门
实现兑现契约、无空壳；命名可读；不做单行多语句压缩；**禁止三元表达式**（用 if/else）；每个 `catch` 必须输出错误；不得从类外部访问内部属性。
**来源**：各角色卡「质量约束」（bootstrap 验收）。

### R13 先评审后实施
业务代码/测试变更前先出提案文档（design / change / fix 类型），经项目管理按 proposal-review 实质评审、客户确认该版本并授意后实施；同一版本、同一范围的既有确认可复用。
**来源**：各角色卡「执行检查点 1a」；技能 documentation.md「先审核，再提炼审批摘要」。

### R14 验收核验与证据
验收需：授权路径、通过的门、当前证据、所需文档齐备；**验证不授权提交、推送、发布或部署**。依赖版本变化后旧证据失效，须复测。
**来源**：各角色卡「执行检查点 6」；project-test 角色卡「执行原则」。

### R15 跨角色共享资源与请求路径
- `frontend/src/i18n/**`（Locale Context + 4 个语言包）由项目管理**独家主属主**，其他角色只读引用；需要新字符串时提交跨角色请求。
- 跨角色请求统一提交项目管理角色协调；角色之间不互改代码、不互改测试。
**来源**：各角色卡「执行原则 / 只读依赖」；`角色卡/project-management/boundary.md` Section 1。

### R16 图谱类型（MapCanvas 导出）的变更规则
图谱类型是事实上的共享模型：改字段、改事件形态前必须先更新设计并通知下游（agent-pipeline、app-shell 等消费方）；下游只读引用。
**来源**：角色卡 graph-view「执行原则 / 工作立场」。

### R17 构建配置与端口变更的协调要求
`package.json`、vite / vitest / tsconfig 等构建设置影响所有角色，变更必须走提案并通知受影响角色；端口变更按 R2 三处同步。
**来源**：角色卡 app-shell「质量约束」。

### R19 electron/ 独立类型门（ratchet，基线 0；批 1 新增）

- 门槛命令：`cd frontend && npm run check:electron`（= `tsc --noEmit -p tsconfig.electron.json`）。
- 配置：`frontend/tsconfig.electron.json`（app-shell Section 1；`strict` 全家 + `noUnusedLocals`/`noUnusedParameters`，与前端主配置**全同标准**）。维护注意：`paths` 的 `@types` 优先顺序**不可颠倒**（颠倒即复现约 24 条解析噪音，并使路由处理器参数退化为隐式 any）。
- 基线：**0 条错误**（2026-10-16 实测；worker 与项目管理各一轮**负对照**——在 /tmp 隔离副本注入错误均被恰准抓出——证实检查器真实生效）。
- 政策：**保持 0**——新增/修改 electron/ 文件不得引入任何检查错误；提交/交付前以该命令输出为准。electron/ 的构建链（vite/esbuild 转译）不含类型检查，本门是 electron/ 的类型保障来源。
**来源**：批 1 实施提案 C6 与附属 X2（客户 2026-10-16 批准）；证据归目见 `docs/scheduling/architecture-batch1.md`（事件 seq 17/20/21）。

## 7. 命名与命名空间

### R18 产品内 LLM Agent 的命名是六个固定标识
`PM`、`ARCHITECT`、`PLANNER`、`REVIEWER`、`MAPPER`、`EXECUTOR`（大写用于 `.env` 前缀；小写用于 API 参数与设置面板）。`reviewer_exec` 是 Reviewer 的执行期变体，共用 REVIEWER 配置。
**来源**：`electron/settingsStore.ts`（AGENTS 常量）、`electron/server/index.ts`、`services/agent.ts`（resolveAgent）。

## 8. 待确认（未核实，不作为规则）

- **T1（已解决）测试红灯处置**：已获批并实施闭环——M1–M8 全部核验通过、M5 独立验证通过（全套 **95/95**、退出码 0、启动冒烟通过）；双 ABI 矛盾经「测试跑在 Electron Node 上」（方案 A1）解决。记录：[docs/fix/2026-10-16_fix_test-suite-red.md](fix/2026-10-16_fix_test-suite-red.md)、[docs/fix/2026-10-16_fix_search-in-files-empty.md](fix/2026-10-16_fix_search-in-files-empty.md)；调度 [docs/scheduling/test-suite-red-fix.md](scheduling/test-suite-red-fix.md)。
- **T2** 重建命令 `../.bin/prebuild-install -r electron -t 34.5.4 --arch arm64` 来自 bootstrap 验收记录；仓库内没有可直接佐证其执行历史的文件（二进制存在与 ABI 状态与之一致）。
- **T3** 打包（electron-builder）后 `.env` 的解析路径未验证；已验证的是开发态读取仓库根 `.env`。
- **T4** `routes/features.ts` 占位端点的迁移计划；`summarizer.ts`（文件摘要服务）的接线计划与归属接线方。
- **T5** 遗留 CodeAtlas 命名的清理范围（`start.sh` 横幅、健康检查 `service` 名、`.codeatlas/` 目录、`frontend/package.json` 中不存在的 `../backend/**` 引用等）——属重构事项，需提案。
- **T6** 既有 3 个扁平测试文件是否迁入 `frontend/test/<role>/`；迁移时机与归属。
- **T7** 端口是否允许配置化（当前三处硬编码，见 R2）。
- **T8** `chat.pipelineFlow` 等 i18n 文案与实际流水线的漂移修正（见 architecture.md 偏差 10）——i18n 属项目管理范围，修正需走提案；已纳入《项目架构升级方案》（[docs/design/2026-10-16_design_architecture-upgrade-plan.md](design/2026-10-16_design_architecture-upgrade-plan.md)）的 D10 项一并评审。
- **T9 缺陷 #2 修复（M8）**：`electron/server/services/agent.ts:1013` 把 `SearchResponse` 当数组（Agent 搜索工具恒返错误串）——**已批准并实施核验**（M8：1 行解构修复 + 1 条回归用例；全套 95/95、严格试算 TS2339 归零）；方案关联见《项目架构升级方案》N1（[docs/design/2026-10-16_design_architecture-upgrade-plan.md](design/2026-10-16_design_architecture-upgrade-plan.md)）。
- **T10 批 1 后续与遗留观察归目**：H1（`frontend/tsconfig.tsbuildinfo` 受 git 跟踪，建议提交时移除跟踪并加入忽略）、Z1–Z5 观察项（静默 catch 后续批次 / planning 阶段指示器文案 / `8d64343` 的 closeDatabase 历史声明 / db.ts 生产侧暂无导入者等）——详见 [docs/scheduling/architecture-batch1.md](scheduling/architecture-batch1.md) §6；是否在下批处理由客户定。
