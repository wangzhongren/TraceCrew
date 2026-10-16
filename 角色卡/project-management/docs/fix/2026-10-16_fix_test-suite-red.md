---
id: fix-test-suite-red
type: fix
title: 修复测试红灯：ABI 运行方式与过时用例
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: verified
related: [fix-search-in-files-empty]
events:
  - date: "2026-10-16"
    kind: created
    summary: 实测 43 例失败完成归类（a=15 / b=28 / c=0），提出测试运行方式方案 A 与逐文件重写范围，待客户确认后实施
  - date: "2026-10-16"
    kind: approved
    summary: 客户整案批准 M1–M6+O1+O2（ABI 方案 A1，接受 5 例退役）；实施启动
  - date: "2026-10-16"
    kind: blocked
    summary: M2 重写后暴露 (c) 类实现缺陷（searchInFiles 恒空，3 例红）；转入单独修复提案 fix-search-in-files-empty，M6/M5 顺延
  - date: "2026-10-16"
    kind: implemented
    summary: M1–M4、M7 全部实施并核验（全套 94/94、退出码 0）；新发现缺陷 #2（M8 待批准）；M5 独立验证待执行
  - date: "2026-10-16"
    kind: implemented
    summary: M8（缺陷 #2）获批并实施核验（36/36、95/95、TS2339 归零）；M5 独立验证待执行
  - date: "2026-10-16"
    kind: verified
    summary: M5 独立验证通过（95/95 两连跑、零 skip/only、启动冒烟通过、候选物哈希逐字一致）；任务闭环
---

# 修复测试红灯：ABI 运行方式与过时用例

> 状态：**已验证（2026-10-16 闭环）**。M1–M8 全部核验通过；M5 独立验证通过（95/95 两连跑、skip/only 零命中、启动冒烟通过）。调度记录见 [../scheduling/test-suite-red-fix.md](../scheduling/test-suite-red-fix.md)。
> 范围：只修 `npm test` 红灯（3 个文件失败、43 失败 / 50 通过 / 93 例）。[docs/architecture.md](../architecture.md) 第 8 节的 10 条存量偏差**不在**本任务范围。

## 1. 症状与复现

用户可观察到的现象：在 `frontend/` 下执行 `npm test`，命令退出码 1，输出「3 failed | 50 passed」、43 个用例失败。应用本身能正常启动，问题只发生在测试运行中。

复现（2026-10-16 本机实测）：

1. `cd frontend && npm test` → 3 个文件失败，**43 失败 / 50 通过（93 例）**，退出码 1。
2. 对照实验（只读，不改任何文件）：把运行测试的运行时换成 Electron 自带的 Node：
   `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run`
   → **28 失败 / 65 通过**；其中 `db.test.ts` 单独运行退出码为 **0**（该文件全绿）。
   即：43 例里有 **15 例换运行时就变绿**——它们与环境有关，与代码断言无关。

## 2. 归类汇总（a = 15，b = 28，c = 0）

| 分类 | 数量 | 分布 | 结论 |
| --- | --- | --- | --- |
| (a) 环境 / ABI | **15** | `db.test.ts` 全部失败例 | 跑测试的 Node（ABI 137）加载不了 Electron ABI（132）的 better-sqlite3；换 Electron Node 后全部转为通过 |
| (b) 测试用例过时 | **28** | `agent.test.ts` 9 + `fileManager.test.ts` 19 | 期望与当前实现不符；实现行为经逐条核对属刻意约定或新签名，**无需改实现** |
| (c) 实现缺陷 | **0（暂定）** | — | 未发现；以「实施后复测」为准（若复测仍有失败，按 c 类另行上报） |

### 2.1 (a) 环境类：15 例（`db.test.ts`）

证据（错误原文摘录）：`The module … better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 132. This version of Node.js requires NODE_MODULE_VERSION 137.` 出现位置均为 `connect()` → `new Database()`。

- 系统 Node = v24.14.0（ABI 137）；项目 Electron = v34.5.4（ABI 132）；二进制是 Electron ABI（详见 [project-rules.md](../project-rules.md) R4）。
- 换到 Electron 的 Node 下：`new Database(':memory:')` 正常、`db.test.ts` 20 例全绿（其中 15 例即上述失败例）。
- 判定为 (a)：**测试代码和被测实现都不用动**，需要动的是「用什么运行时跑测试」。

### 2.2 (b) 用例过时类：28 例

每组给出：用例、失败断言（实测原文）、实现现状与判定理由、改写方向。原始行号见证据附录。

**A. `agent.test.ts`（9 例，归 agent-pipeline）**

| # | 用例 | 失败断言（实测） | 判定与改写方向 |
| --- | --- | --- | --- |
| 1 | `tagText > trims and returns content` | `'  hello world  '` ≠ `'hello world'` | 实现刻意**不再修剪**（源码注释：「仅处理 CDATA 包装，不对内容做任何修剪」；空行剥离改由下游 `contentToLines` 负责，这是修「执行器缩进丢失」的一部分）。改断言为原样保留 |
| 2 | `parseXmlLike > parses multiple operations` | `'\nnew code\n'` ≠ `'new code'` | 同上：内容按原文保留。改断言语义（原文保留；下游剥离首尾空行） |
| 3–7 | `buildUserMessage` ×5 | `TypeError: svc.buildUserMessage is not a function` | 该方法已从 `AgentService` 删除；「用户消息+打开文件+选区+文件树」的拼装已移到前端 `ChatPanel.agentLoop`。**建议退役这 5 例**（被测接口已不存在，不是为绿灯删测试），是否补等价覆盖见选装 O1 |
| 8–9 | `buildMessages` ×2 | 旧签名调用：`buildMessages('system prompt','user message')` / `(…, …, history)`，收到的是按字符串逐字符生成的消息 | 当前签名为 `buildMessages(history)`（`agent.ts` 中 system 提示词由调用方 `unshift` 挂载）。改为按当前签名重写，**保留 agent→assistant 角色映射断言**（这是这两例的真正价值） |

**B. `fileManager.test.ts`（19 例，归 project-data）**

| # | 用例组 | 失败断言（实测） | 判定与改写方向 |
| --- | --- | --- | --- |
| 1–2 | `listDirectory` ×2 | `'a-dir/'` ≠ `'a-dir'`；以及 `children` 期望（`toBeDefined` / `toEqual([])`）与当前「空 children 省略（`children?:` 可选）、目录名带 `/` 后缀」的约定不符 | 两处都是实现的**刻意约定**（`name: entry.name + '/'`；`children: children.length > 0 ? children : undefined`，后者也是给喂给模型的 JSON 瘦身）。改断言为当前契约，并显式断言 depth 参数语义 |
| 3–11 | `insertLines` ×3、`replaceLines` ×3、`deleteLines` ×3、round-trip ×1 | `expected undefined to be true`（拿到的是 Promise，未 await） | 三个函数已改为 `async`（大文件走流式编辑）。补 `await` / `async` 回调 |
| 12–18 | `searchInFiles` ×7 | `Promise{}` 当值断言；以及 `searchInFiles(query, dir, 3)` 第三参数仍是旧位置参数 | 已 `async` + 第三参数改为 `SearchOptions` 对象（`{ maxResults: 3 }`）。补 `await` 与对象参数 |

**容易误判、特意说明的三点**（为什么都不算实现缺陷）：

1. `listDirectory` 空 children 为什么不改回 `[]`：类型声明 `children?: FileEntry[]` 本就允许省略；该结果会 `JSON.stringify` 进 Agent 上下文，瘦身是刻意优化；前端/IPC 两侧都按可选处理。
2. `searchInFiles` 为什么不兼容传数字：当前契约就是 options 对象（IPC 与 Agent 工具路径都用对象）；对错误类型做静默兼容反而掩盖误用。
3. `tagText` 为什么不重新加上 trim：修剪曾导致写入内容缩进丢失（历史修复项），恢复会让已修问题回归。

### 2.3 (c) 实现缺陷：已确认 1 项并已修复核验（原判「暂定 0」修正）

实施后复测暴露 1 项实现缺陷：**`searchInFiles` 恒返回空**（本地 `readFile` 遮蔽 fs 导入 + 静默 catch 吞错），影响本文件 `fileManager.test.ts` 的 3 例正向匹配用例。修复提案：[2026-10-16_fix_search-in-files-empty.md](2026-10-16_fix_search-in-files-empty.md)；客户批准 M-c1+O-c1 后 **M7 已实施并核验**（3 例转绿、该文件 35/35、运行时直调恢复匹配）。同日追加发现**缺陷 #2**（`agent.ts` 把 SearchResponse 当数组，Agent 搜索工具恒返错误串）——见 (c) 提案第 10 节，**已批准并实施核验（M8）**。其余 25 例 (b) 维持「测试过时」判定不变。

## 3. ABI 方案：推荐 A（测试跑在 Electron 的 Node 下）

### 3.1 候选对比

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| **A（推荐）测试跑在 Electron 的 Node 下** | `ELECTRON_RUN_AS_NODE=1` 启动 Electron 二进制当 Node，在其下执行 vitest | 单一二进制、零重建、与产品真实运行时同 ABI；已用原型验证：全套可跑（93 例）、db 全绿、**退出码正确传递**（db 单跑 0；有失败时 1）。命令不变仍是 `npm test` |
| B 双二进制 + 切换脚本 | 跑测试前把 better-sqlite3 重编为 Node ABI，跑应用前再编回 Electron ABI（或双份 `.node` 互换） | 反对：每次测试都翻转产物，忘记编回应用就启动失败；`npm install` 会重置；维护两条构建链；风险高收益低 |
| C1 用替身 DB 跑 db 测试 | 不连真实 SQLite | 反对：等于把集成测试降级为假测试（弱化断言，违反治理不变式 #7 的精神） |
| C2 换 Node-API 的 SQLite 库 | 迁移数据库依赖使 ABI 不再敏感 | 本次不采用：超出「修红灯」范围的大迁移；可作为未来架构议题单独提案 |
| C3 让 Electron 加载 Node ABI | — | 不可行：同一 `.node` 只能一种 ABI |

### 3.2 A 的实施子选项（app-shell 决定，客户可指定）

- **A1（推荐）**：新增 devDependency `cross-env`，脚本改为
  `"test": "cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run"`（`test:watch` 同法）。跨平台（含 Windows）、无边界变更；代价：新增一个小依赖。
- **A2**：POSIX 内联环境变量写法，零新依赖；缺点：Windows 的 `start.bat` 场景需另处理。
- **A3**：新增一个启动器脚本（如 `frontend/scripts/run-tests.mjs`）；需要治理角色先给 app-shell 的 Section 1 增加路径，流程更长。

### 3.3 对日常开发流程与各角色的影响

- 每个人跑测试的命令不变：仍是 `npm test`（由脚本内部换运行时）。`test:watch` 的交互模式需在实施时人工验证一次。
- 测试运行时从系统 Node 24 变为 Electron 内置 Node（约 20.18）：现有 93 例全部可运行；今后新增测试按同一方式运行（记入 project-rules R9 的更新）。
- **产品构建与启动完全不动**：better-sqlite3 二进制保持 Electron ABI，`start.sh` / `electron:dev` 路径无改动（`start.sh` 本来就 `unset ELECTRON_RUN_AS_NODE`）；「启动冒烟」只做防回归确认。
- 若将来引入 CI，测试命令须沿用同一启动方式（写入规则）。

## 4. 逐文件改动清单（按归属角色）

| 角色 | 文件 | 改动 | 性质 |
| --- | --- | --- | --- |
| app-shell | `frontend/package.json`（+ A1 时 `package-lock.json`） | `test` / `test:watch` 脚本改为 Electron-Node 启动方式 | 必需（M1） |
| project-data | `frontend/test/fileManager.test.ts` | 19 例重写：async/await 化、listDirectory 契约断言、searchInFiles options 对象 | 必需（M2） |
| project-data | `frontend/test/db.test.ts` | **预期零改动**；ABI 修复后复测确认 | 必需（M4，只验证） |
| agent-pipeline | `frontend/test/agent.test.ts` | 4 例重写（tagText、parseXmlLike、buildMessages ×2）；5 例 `buildUserMessage` 退役（文件头注明原因） | 必需（M3） |
| project-test | `frontend/test/project-test/` | 新增本次回归用例与报告（全套重跑、退出码、受影响路径抽测） | 必需（M5） |
| 项目管理 | `docs/project-rules.md`、本文档 | 实施后更新 R4/R9/R10 的实际状态与测试运行方式；本文改为实际结果 | 必需（M6） |
| （如选 A3 才需要）治理 | app-shell Section 1 | 新增启动器脚本路径 | 条件性 |

（申请级校验：以上文件均落在各角色已验收的 Section 1 内；A1/A2 无需任何边界更新。）

## 5. 角色分工与实施顺序

1. **app-shell** 实施 M1（测试运行方式）→ 已完成并核验：db 全绿（零测试改动）、退出码语义正确。
2. **project-data** 实施 M2（fileManager.test.ts 重写）+ M4（db.test.ts 复测）→ M4 已完成核验；M2 重写完成、19 例契约对齐，但 3 例正向匹配被 (c) 实现缺陷阻塞。
3. **agent-pipeline** 实施 M3（agent.test.ts 重写 + 退役 + O1/O2）→ 已完成并核验。
4. **project-data** 实施 M7（(c) 最小修复，见 [2026-10-16_fix_search-in-files-empty.md](2026-10-16_fix_search-in-files-empty.md)）→ **已完成并核验**（该文件 35/35，M2 复验转绿）。
5. **项目管理** 实施 M6（规则与本文档更新为实际结果）。
6. **project-test** 实施 M5：最终合并候选独立复跑全套、启动冒烟、出具报告。

顺序理由：先修运行方式（否则 db 类无法验证）；M2 与 M3 互不依赖可并行；M7 阻塞 M2 完成与 M6/M5 顺延，故优先级最高（在客户批准路径上）。

## 6. 验证方式与验收标准

**M5 独立验证（2026-10-16，project-test，最终合并候选）**：通过——`npm test` 两连跑 95/95（退出码 0、无 flake）；不变式复查（`.only/.skip/.todo/xit/xdescribe`）零命中；用例账目吻合（agent 36 + db 20 + fileManager 35 + chatPanelUserContent 4 = 95）；候选物哈希与各节点记录逐字一致、验证全程零写入；启动冒烟通过（19850 health 200、进程级证据、收尾只杀自有进程）。未测项：LLM 端到端、UI 可视确认、Windows、打包产物等（详见 M5 报告 `reportId m5-project-test-attempt1`）。以下为原验收口径（保留）：

1. `npm test` → **95 例通过 / 0 失败、退出码 0**（93 − 退役 5 + O1 新增 4 + O2 新增 2 + M8 新增 1 = 95；精确口径以 M5 报告为准）。`test:watch`：已实测可进入 watch 等待（注：vitest 4 在 agent 环境变量（CLAUDECODE/AI_AGENT）下会自动禁用 watch 只跑一次，真实用户终端不受影响）。
2. **不变式 #7 反向检查**（防「删测试换绿灯」）：逐条 review 改动前后 diff——断言只允许按第 2.2 节列出的契约对齐，不做删减/放宽；除批准的 5 例退役外用例总数不得减少；不得出现 `.skip` / `.only`；每条重写用例保留原覆盖意图。已按此核验 M1/M2/M3 的 diff（全仓 skip/only 为零）。
3. 启动冒烟不回归：`start.sh` 启动应用、窗口出现、健康检查 OK（二进制未动，本项为防回归确认）。
4. **M7 修复后**：`test/fileManager.test.ts` = 35/35（3 例正向匹配转绿）；searchInFiles 运行时直调返回真实匹配。
5. 独立复跑：project-test 以只读身份按「测试角色」规程复跑并出具报告（含未测项）。

## 7. 必选 / 选装

**本次必须做**（对应第 4、5 节的 M 项）：M1 运行方式、M2 fileManager 重写、M3 agent 重写+退役、M4 db 复测、M5 独立回归+冒烟、M6 文档更新。

**选装**（首次提出默认勾选为推荐，旁边标注待客户确认；不勾选不影响绿灯）：

- [x] O1：为前端「用户消息 + 项目文件树」拼装补等价覆盖（代替退役 5 例腾出的缺口，目前该路径零测试）。**（已获客户批准 2026-10-16；已实施于 M3：`frontend/test/agent-pipeline/chatPanelUserContent.test.ts` 4 例，纯函数 `buildAgentUserContent`）**
  好处：context 拼装是流水线输入的关键路径，有回归保护。
  不加会怎样：退役后该能力无任何测试；不影响本次绿灯。
  代价：agent-pipeline 需从 `ChatPanel.agentLoop` 抽一个小纯函数（行为不变）+ 2~3 条用例。
- [x] O2：给 `buildMessages` 增加 `Array.isArray` 运行期守护（本次暴露：误传字符串会静默生成逐字符垃圾消息）。**（已获客户批准 2026-10-16；已实施于 M3：`agent.ts` +6 行守护，`agent.test.ts` 新增 2 例）**
  好处：同类误用立刻报错，而不是把垃圾消息喂给模型。
  不加会怎样：类型正确调用一切照常；只有 `as any` 误用才受影响。
  代价：`agent.ts` 数行改动 + 1 条用例。

## 8. 未决问题

1. ~~**ABI 子选项**~~ **已定并实施**：A1（cross-env），M1 已核验。
2. ~~**退役 5 例 / O1 / O2**~~ **已批准并实施**（M3 已核验）。
3. **(c) 类实现缺陷已确认 1 项**（`searchInFiles` 恒空，3 例受影响）：修复提案 [2026-10-16_fix_search-in-files-empty.md](2026-10-16_fix_search-in-files-empty.md)；其获批与 M7 落地是 M2 复验与 M6/M5 的前置。
4. 剩余未决：M7 的选装 O-c1 取舍（见 (c) 提案第 7 节）。

## 9. 证据附录（2026-10-16 实测，只读调查）

- 命令与结果：
  - `npm test`（系统 Node 24）：3 文件失败、43 失败 / 50 通过 / 93 例、退出码 1。
  - `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run`：28 失败 / 65 通过 / 93 例、退出码 1；`… run test/db.test.ts` 退出码 0。
  - ABI 原文：`NODE_MODULE_VERSION 132 … requires 137`；`Electron … instantiate OK`（`ELECTRON_RUN_AS_NODE=1 electron -e "new (require('better-sqlite3'))(':memory:')"`）。
- 断言差异摘录：`'  hello world  '` vs `'hello world'`；`'\nnew code\n'` vs `'new code'`；`'a-dir/'` vs `'a-dir'`；`Promise {}` vs 值；`svc.buildUserMessage is not a function`。
- 环境：Node v24.14.0、Electron v34.5.4、vitest 4.1.8、better-sqlite3 12.x（`frontend/node_modules`）。
