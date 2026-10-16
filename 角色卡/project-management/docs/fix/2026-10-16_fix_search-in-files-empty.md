---
id: fix-search-in-files-empty
type: fix
title: 修复文件搜索恒返回空（readFile 重名遮蔽 fs 导入）
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: verified
related: [fix-test-suite-red]
events:
  - date: "2026-10-16"
    kind: created
    summary: M2 重写测试时暴露 searchInFiles 恒空；独立复现确认根因（本地 readFile 遮蔽 fs 导入 + 静默 catch）；提出两行最小修复与 1 项选装，待客户批准
  - date: "2026-10-16"
    kind: amended
    summary: M-c1+O-c1 获客户批准并派发实施（M7）；同日独立类型试算新发现缺陷 #2（agent.ts 把 SearchResponse 当数组，Agent 搜索工具恒返错误串），追加修订请求（第 10 节），待客户批准
  - date: "2026-10-16"
    kind: implemented
    summary: M-c1+O-c1 实施完成并核验（M7 verified；35/35、94/94、运行时 total:1）；M5 独立回归待执行，联动缺陷 #2（M8）决定
  - date: "2026-10-16"
    kind: implemented
    summary: 缺陷 #2 获批并实施核验（M8 verified：1 行解构 + 1 条回归用例；36/36、95/95、TS2339 归零）；M5 独立验证待执行
  - date: "2026-10-16"
    kind: verified
    summary: M5 独立验证通过（95/95 两连跑、启动冒烟、零 skip/only、候选物哈希一致）；本记录闭环
---

# 修复文件搜索恒返回空：readFile 重名遮蔽 fs 导入

> 状态：**已验证（2026-10-16 闭环）**。M-c1 + O-c1（M7）与缺陷 #2（M8）均已实施并核验；M5 在最终合并候选上独立验证通过（95/95、启动冒烟、零 skip/only）。本记录闭环。
> 来源：本缺陷由测试红灯修复任务（M2 节点，[2026-10-16_fix_test-suite-red.md](2026-10-16_fix_test-suite-red.md)）暴露；那篇文档第 2.3 节原判「(c)=0 暂定」，复测后修正为「(c)=1」并转入本记录。

## 1. 症状与复现（用户/开发者视角）

**现象**：`searchInFiles` 对任何目录都返回 `{"results":[],"total":0}`——即使目录里明确存在要搜的词。不是“部分搜不到”，是**永远搜不到**。

**最短复现**（2026-10-16 实测，两种路径互相独立）：

1. 测试路径：`cd frontend && npm test -- test/fileManager.test.ts` → 3 例失败，恰是三个“正向匹配”用例：
   - `searchInFiles > finds matches across source files`
   - `searchInFiles > returns line numbers with matches`
   - `searchInFiles > is case insensitive`
   （其余 32 例通过——注意 `returns empty for no matches` 属于“恒空也满足”的用例，不能作为正常证据。）
2. 不经测试代码的运行时路径：用项目同族构建器（esbuild，产品打包同族）把 `electron/fileManager.ts` 打包为独立模块，直接对种子目录调用：
   - 原版：`searchInFiles("needle") => {"results":[],"total":0}`（目录里确实有 `needle`）
   - 同时观察到：同模块导出的 `readFile()` 返回的是 **FileContent 对象**（不是字符串）——机制线索。

**影响面**：
- **Agent 的搜索工具恒空**：`electron/server/services/agent.ts` 的 `executeTool case 'search'` 调用它——多 Agent 流水线里 Planner/Executor 等“搜索代码”的能力实际处于失效状态（模型拿到空结果，无从发现问题）。
- **IPC `file:search` 通道恒空**：`electron/main.ts` 注册的 `file:search` handler 同样调用它；当前前端源码中**没有**该通道的 UI 调用点（已 grep 核实），所以用户暂时看不到独立的搜索界面表现，但通道本身对外失效。
- 对本次测试任务：`fileManager.test.ts` 的 3 例红灯正是它；不修则套件无法全绿。

## 2. 根因

`electron/fileManager.ts` 同一模块里有两个 `readFile`：

- 第 6 行：`import { readdir, readFile, stat } from 'fs/promises';`（异步读文件）
- 第 72 行：`export function readFile(filePath, startLine?, endLine?): FileContent`（本模块的同步读文件，返回对象）

模块作用域内 `readFile` 解析到**本地函数**。于是 `walk()` 里：

- 第 406 行 `const content = await readFile(full, 'utf-8');` 拿到的是 FileContent 对象；
- 第 407 行 `const lines = content.split('\n');` 对对象调 `.split` → 抛 `TypeError`；
- 第 421 行 `} catch { /* skip unreadable */ }` **静默吞掉**该异常 → 每个文件都被当作“不可读”跳过 → 搜索恒空。

**为什么长期没被发现**（两点，均已核实）：
1. 原正向匹配用例此前因「未 await（Promise 未等待）」而红，掩盖了更深的失败；M2 把 await 修好后才把它暴露出来。
2. `electron/` 不在前端 `tsconfig.json` 的 `include`（仅 `src`），构建链（esbuild）容忍该重名不报错——类型检查不会提前发现。

## 3. 修复后的行为（已实施）

**2026-10-16 已实施（M7，客户批准 M-c1 + O-c1）**：

- 把 **fs 导入**改名以避免遮蔽：第 6 行 `readFile as readFileAsync`；第 406 行改用 `readFileAsync`——搜索恢复返回真实匹配。
- O-c1：第 421 行 catch 改为输出错误（含文件路径与原因，如 `[searchInFiles] 跳过不可读文件: <路径> — <原因>`）；“不可读文件跳过并继续”的行为保留。
- **公开导出未动**：本模块自己的 `export function readFile`（被 `main.ts` IPC、`agent.ts`、测试使用）签名与行为完全不变，下游零影响。
- 修复方向在实施前已**预验证**（见第 6 节证据 B）；实施结果见第 5/6 节实测。

## 4. 变更范围与角色归属

| 角色 | 文件 | 改动 | 性质 |
| --- | --- | --- | --- |
| project-data | `electron/fileManager.ts` | 两行：第 6 行导入改名、第 406 行调用点改用新名 | 必需（M-c1） |
| project-data | `electron/fileManager.ts` 第 421 行 | 选装 O-c1：静默 catch 改为输出错误 | 选装（待客户确认） |
| （不涉及）测试 | `frontend/test/fileManager.test.ts` | 不需要改动——M7 修复后 3 例应转绿 | 只复测 |

无需任何边界（Section 1）更新；不需要新文件。

## 5. 验证方式与验收标准

**实测结果（2026-10-16，M7 实施后）**：`test/fileManager.test.ts` = **35/35、退出码 0**；全套 `npm test` = **94/94、退出码 0**；运行时直调（系统 Node 与 Electron-as-Node 两路）恢复匹配 `total:1`；O-c1 EACCES 探针输出路径+原因且跳过继续。以下为原验收口径（保留，供复验对照）：

1. `cd frontend && npm test -- test/fileManager.test.ts` → **35 passed、退出码 0**（原 3 例转绿）。
2. 全套 `npm test` → **94 passed、退出码 0**（当前唯一红灯来源即这 3 例）。
3. 运行时端到端（不带 LLM，复刻本记录第 1 节的路径 2）：esbuild 打包修复后的实现，对种子目录直调 `searchInFiles` → 返回非空匹配、`total: 1`。
4. 回归确认：`readFile` / `writeFile` / `insertLines` / `replaceLines` / `deleteLines` / `deleteFile` / `restoreBackup` 各组用例保持通过（本次修复只动导入名，不改这些行为）。
5. 由 project-test（M5，独立上下文）在最终合并候选上复跑并出报告；**不变式 #7**：修复只做加法（不删减/不放宽任何断言），新增/修改行通过质量门（禁三元等）。

## 6. 证据（2026-10-16 实测，全部只读；可复跑）

- **复现 A（原版）**：esbuild 打包 `electron/fileManager.ts` → 独立驱动脚本直调 → `[searchInFiles("needle")] => {"results":[],"total":0}`；`[local readFile() returns] => object (FileContent object)`。
- **预验证 B（补丁副本）**：同文件副本仅改两行（导入改名 + 调用点）→ 同驱动脚本 → `[searchInFiles("needle")] => {"results":[{"file":"src/a.ts","line":2,"text":"function needle() {}"}],"total":1}`。
- **测试 C**：`npm test -- test/fileManager.test.ts` → `32 passed / 3 failed`（失败名见第 1 节）；`npm test -- test/db.test.ts` → 20 passed（与本缺陷无关，M4 复测记录）。
- **代码定位**：第 6 行（fs 导入）、第 72 行（本地 `readFile`）、第 406–407 行（walk 内的调用与 `.split`）、第 421 行（静默 catch）。
- **消费者核实**：`services/agent.ts`（search 工具）；`main.ts`（file:search IPC）；`frontend/src/**` 无 `file.search` 调用点（grep 为空）。
- **实施后实测（M7，2026-10-16）**：`test/fileManager.test.ts` 35/35、全套 94/94（退出码均 0）；修复后 sha256 `40cd8ffb…`；运行时直调两路（系统 Node / Electron-as-Node）均 `total:1`；O-c1 探针（chmod 000 文件）输出 `跳过不可读文件: <路径> — EACCES…` 且可读文件照常匹配。
- **独立复核（项目管理上下文，2026-10-16）**：`git diff` 恰为约定三处；自建驱动对修复后代码复现 → `total:1`、公开 `readFile` 仍返回 FileContent（未变）。
- **M5 独立验证（project-test，2026-10-16，最终合并候选）**：通过——全套 95/95 两连跑（退出码 0）、零 skip/only、启动冒烟通过、候选物哈希与节点记录逐字一致（含 `fileManager.ts` `40cd8ffb…`、`agent.ts` `80917918…`）。

## 7. 必选 / 选装

**本次必须做**：
- [M-c1] `electron/fileManager.ts` 两行最小修复（导入改名 + 调用点），恢复搜索为真实匹配。

**选装**（首次提出默认勾选为推荐，旁边标注待客户确认；不勾选不影响 3 例转绿）：

- [x] O-c1：把 `walk()` 第 421 行的静默 catch（`catch { /* skip unreadable */ }`）改为**输出错误信息**（例如 `console.log` 一行含文件路径与原因）。**（默认推荐，待客户确认）**
  好处：本缺陷正是被这个静默 catch 吞掉的——同类问题以后能第一时间看见；也符合项目质量门「每个 catch 必须输出错误」的精神（R12）。
  不加会怎样：搜索功能本身照常修好；只是未来同类读取失败会继续无声跳过。
  代价：每个“确实不可读”的文件多一行日志输出（量级很小）。
- 备注：对 `fileManager.ts` 里其他静默 catch 的成批清扫**不**并入本修复（属更大的卫生清理），已列入《项目架构升级方案》候选（另行产出）。

## 8. 实施顺序与依赖（与测试红灯任务联动）

1. 客户批准本提案 ✓（已批准 M-c1 + O-c1）。
2. **M7** ✓ 已实施并核验（attempt 1 verified：35/35、94/94、运行时 `total:1`）。
3. **M2 复验** ✓ 由 blocked 转 verified（3 例转绿）。
4. **M6** 已完成：`docs/project-rules.md`（R4/R9/R10）与两份 fix 记录已更新为实际结果。
5. **M5**（project-test）：待执行（M8 已落地，前置已满足）。

## 9. 未决问题

1. ~~O-c1 是否采纳~~ **已采纳**（客户批准，随 M7 实施）。
2. `electron/` 无类型检查的缺口（tsc include 仅 `src`，构建只转译不查类型）——这是本缺陷能潜伏的系统性原因；是否立项补“electron 独立类型门”属架构升级议题（已纳入 `docs/design/2026-10-16_design_architecture-upgrade-plan.md` 的 N1 项，本修复不动）。
3. 产品 UI 端搜索体验：当前前端无 `file.search` 调用点；若未来接入 UI，需另行验收（本次 M5 将以“打包后运行时直调”作为最接近真实入口的验证，并在报告中如实标注 UI 路径未测）。
4. ~~缺陷 #2 是否批准~~ **已批准并实施核验**（M8，见第 10 节末）。

## 10. 修订（待批准）：缺陷 #2 —— Agent 搜索工具把响应对象当数组

**发现方式**：为「electron 类型门」（架构升级方案 N1）做只读基线试算时，严格 tsc 报
`../electron/server/services/agent.ts(1013,35): error TS2339: Property 'map' does not exist on type 'SearchResponse'`；逐行核对代码确认（2026-10-16）。

**现状与影响**：`AgentService.executeTool` 的 `search` 分支（第 1000–1014 行）：
- 第 1003 行 `const results = await searchInFiles(query, searchPath, {...})` 拿到的是 `{ results, total }` 响应对象；
- 第 1013 行却写 `results.map((r) => ...)` → 运行期抛 `TypeError: results.map is not a function`，被 `executeTool` 的 catch 捕获 → **Agent 搜索工具恒返回错误串**（模型永远搜不到东西）。
- 与缺陷 #1 是**两处独立的错**：M7 修好 #1 后，`searchInFiles` 能返回真实结果；但本处 `.map` 仍会立刻抛错——**只修 #1 不足以让 Agent 搜索工具可用**（只会让错误从「恒空」变成「恒错误串」，用户可感知的“搜不到”不变）。

**修复方向（拟，最小）**：第 1003 行改为解构：
`const { results } = await searchInFiles(query, searchPath, {...});`
其下（含第 1013 行 `results.map`）保持不变；其余行不动。

**范围与角色**：`electron/server/services/agent.ts`（agent-pipeline，1 行）；**新增 1 条回归测试**防止再犯：在 `frontend/test/agent.test.ts` 里用 `(svc as any).executeTool({ type: 'search', file: '.', content: '关键词' }, 临时目录)` 断言返回串包含 `文件:行号` 且不含错误标记（该分支不调用 LLM，用临时目录可直接测）。

**验证与验收**：① 新测试通过、全套 `npm test` 保持全绿；② 严格 tsc 试算中该 `TS2339`（agent.ts:1013）消失（总错误 81 → 80，其余为既有注解/配置项）；③ M5 在最终合并候选上独立复核。

**实施顺序**：与 M7 互不冲突（不同文件）；建议作为 **M8** 在客户批准后派发（agent-pipeline，attempt 1）。**M5 建议等待 M8 一并落地**（否则其报告须标注「缺陷 #2 未修，Agent 搜索工具仍不可用」）。若客户暂缓 #2，M5 照原计划执行并如实标注。

**实施记录（2026-10-16）**：客户批准（推荐路径）后 **M8 已实施并核验**——`agent.ts` 第 1003 行改为解构（sha256 `80917918…`）、`agent.test.ts` 新增 1 条回归用例；红证：修复前该用例失败原文即缺陷症状（`expected '[错误: search .]…results.map is not a …'`）；绿证：该文件 36/36、全套 **95/95**（退出码均 0）；严格试算 `TS2339` 归零（现行 77 项，见《项目架构升级方案》N1 的口径修正）。角色侧独立 fix 记录决定不另立（1 行修复；本提案为规范记录，agent-pipeline 功能文档建立时回链）。
