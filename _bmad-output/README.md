# BMAD-Method 工作流产物索引

本目录是本次大作业「使用 Git 与 BMAD-Method 工作流完成一个项目」的全部过程产物。
按 **需求 → 规划 → 实现 → 验证** 四阶段排列，每份产物都对应一条真实提交，可用
`git log --oneline --graph` 逐条核对。

项目：骑行评分监测看板（cycling-dashboard）｜推进的 Epic：**提交即验证的 CI 流水线**

---

## 这套流程实际是怎么跑的

说清楚执行方式，免得核验时靠猜：

- **规则层**：[`_bmad/bmm/config.yaml`](../_bmad/bmm/config.yaml) 约定产物落点（`output_folder`）、语言，以及
  每个阶段对应哪个工作流、哪份产物、哪条提交。改配置即改约定。
- **执行层**：用 AI 编码助手（CodeBuddy / WorkBuddy）按 BMad Method 的**分阶段产物规范**推进 ——
  一个阶段产出一份文档，落进上表对应的目录，**人工过一遍再单独提交**，不在最后一次性补齐。
- **提交信息**：`docs(bmad): …（/bmad-xxx）` 里的括号，标注的是"这次提交对应哪个工作流阶段"，
  便于 `git log` 一眼看出一本日记的目录。产物本身才是证据。
- **阶段之间不是单向流水**：SPEC 阶段回头核对 PRD 时发现 FR-5 与 FR-8 互相矛盾，当场裁决并在同一提交里
  回改 PRD（见 [`SPEC.md` 第〇节](specs/spec-1-ci-pipeline/SPEC.md)）。**能看见"上游被下游修正"，比流程走得顺更能说明它是真跑的。**

---

## 阶段一 · 需求分析

| 产物 | 工作流 | 提交 |
|---|---|---|
| [`planning-artifacts/brief-cycling-dashboard-ci.md`](planning-artifacts/brief-cycling-dashboard-ci.md) | `/bmad-product-brief` | `2a18e11` |

问题不是我编的：`docs/技术架构与设计取舍.md:255` 里项目自己写着「为什么没有 CI/CD？这是明确的短板 —— 下一步就做 GitHub Actions」。

## 阶段二 · 规划与设计

| 产物 | 工作流 | 提交 |
|---|---|---|
| [`planning-artifacts/prd-cycling-dashboard-ci.md`](planning-artifacts/prd-cycling-dashboard-ci.md) | `/bmad-prd` | `5fb16e3` |
| [`planning-artifacts/architecture-ci-pipeline.md`](planning-artifacts/architecture-ci-pipeline.md) | `/bmad-architecture` | `8f5e80f` |
| [`specs/spec-1-ci-pipeline/SPEC.md`](specs/spec-1-ci-pipeline/SPEC.md) | `/bmad-spec` | `9695ada` |
| [`planning-artifacts/epics.md`](planning-artifacts/epics.md) | `/bmad-create-epics-and-stories` | `70caa41` |
| [`implementation-artifacts/sprint-status.yaml`](implementation-artifacts/sprint-status.yaml) | `/bmad-sprint-planning` | `30e15ca` |

值得看一眼的地方：

- **`architecture` 的六条 ADR**，尤其 ADR-1「为什么把闸门写在 npm script 而不是 YAML 里」；
- **`SPEC` 第〇节**：落地时发现 PRD 的 FR-5 与 FR-8 互相矛盾，当场裁决并回改 PRD。

## 阶段三 · 开发实现

分支 `feature/ci-pipeline`，4 个 story 各一次提交：

| Story | 内容 | 提交 |
|---|---|---|
| 1.1 | 三道校验收敛为 npm script | `ed560ca` |
| 1.2 | 接入 GitHub Actions | `6dca26f` |
| 1.3 | 构建产物留存 7 天 | `7272e37` |
| 1.4 | README 徽章 + 版本 1.0.22 | `0dce0d7` |

## 阶段四 · 验证与改进

| 产物 | 工作流 | 提交 |
|---|---|---|
| [`test-artifacts/verification-report.md`](test-artifacts/verification-report.md) | `/bmad-walkthrough` | `e083454` |
| [`test-artifacts/code-review-1-1.md`](test-artifacts/code-review-1-1.md) | `/bmad-code-review` | `e083454` |

验证方式不是"跑一遍绿的"，而是**故意弄坏三次**看闸门拦不拦得住：

| 实验 | 注入什么 | 结果 |
|---|---|---|
| A | 未使用变量 | 退出码 1，且后序闸门**不执行** |
| B | 类型错误（lint 查不出） | 前端测试通过、`tsc -b` 在 build 阶段拦下，退出码 2 |
| C | 只产生 warning 的写法 | 旧 `lint` 退出码 0 放行，CI 版退出码 1 拦下 |
| D | 全部还原 | 退出码 0，292 用例通过 |

评审发现并修掉的高危问题（R-01）：后端 `server/` 自带 110 个用例与独立 typecheck，
第一版闸门一个都没跑 —— 绿灯会骗人。修复后覆盖用例 **182 → 292**。

---

## 合并

`feature/ci-pipeline` 以 `git merge --no-ff` 合并回 `main`，合并提交 `9fa5b2a`，
刻意保留分支形状，让"先分支开发、验收后合并"有可见痕迹。

## 不在本期范围（写明是为了不被误认为没做完）

自动部署、覆盖率门禁、多 Node 版本矩阵、Docker 化 —— 取舍理由见
`planning-artifacts/brief-cycling-dashboard-ci.md` 第五节与 `architecture-ci-pipeline.md` 第六节。
