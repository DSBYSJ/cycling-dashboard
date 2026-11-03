# Epics & Stories · CI 流水线

> 产出工作流：`/bmad-create-epics-and-stories`（PM）
> 上游：`prd-cycling-dashboard-ci.md`、`specs/spec-1-ci-pipeline/SPEC.md`
> 日期：2026-11-04 ｜ 总计 1 个 Epic / 4 个 Story

---

## Epic 1 · 提交即验证

**目标**：推代码就自动验，红灯不外流。完成后 `main` 上任意一次构建都是过了 182 个测试、零 lint 警告、类型检查通过的状态。

**范围外**：自动部署、覆盖率门禁、多 Node 矩阵（见 PRD 第八节）。

**完成定义（Epic DoD）**：
1. 四个 story 全部 `done`；
2. `npm run ci` 在本地与云端结果一致；
3. 至少有一次"注入错误 → 红 → 还原 → 绿"的真实记录；
4. README 徽章可见；
5. 一次 `--no-ff` 合并回 `main`，历史可读。

---

## Story 1.1 · 三道闸门写成可复用的本地脚本

**Traceability**：FR-5、FR-2（engines）、NFR-3

**作为**站长，**我希望** `npm run ci` 一条命令跑完 lint / 测试 / 构建，**以便**在推送前就能确认这次改动没搞坏东西。

**验收标准**

- **AC-1.1.1** 给定干净的 `main`，当执行 `npm run ci`，那么依次输出三段：eslint 无输出、vitest 报 `Tests 182 passed`、vite 报 `built in …`，最终退出码 0。
- **AC-1.1.2** 给定存在一处未使用变量的代码，当执行 `npm run ci`，那么 eslint 报错并以非零退出码终止，**vitest 与 vite 不执行**。
- **AC-1.1.3** 给定一处类型错误（`const x: string = 1`），当执行 `npm run ci`，那么前两段通过、第三段 `tsc -b` 报 `error TS…`，退出码非 0。
- **AC-1.1.4** 给定一处只产生 warning 的写法，当执行 `npm run ci`，那么 eslint 以非零退出码失败（`--max-warnings=0` 生效）。
- **AC-1.1.5** `package.json` 中 `eslint .` 的命令文本只出现 1 次（`grep -c` 验证），不存在两处真相。
- **AC-1.1.6** `engines.node` 字段存在值为 `>=20`。

**技术要点**：详见 `SPEC.md` S-1。特别注意 `npm run lint -- --max-warnings=0` 的双横线。

**规模**：小（1 个文件，约 6 行改动）

---

## Story 1.2 · GitHub Actions 工作流

**Traceability**：FR-1、FR-2、FR-3、FR-4、FR-8、NFR-1、NFR-2

**作为**站长，**我希望**每次 push 和 PR 自动跑上面那三道门，**以便**不必依赖自己的记性。

**验收标准**

- **AC-1.2.1** `.github/workflows/ci.yml` 存在，`name: CI`，YAML 可被解析（缩进 2 空格、无 tab）。
- **AC-1.2.2** 触发条件为 `push`（无分支过滤）+ `pull_request`（`branches: [main]`）。
- **AC-1.2.3** 三个闸门是**三个独立 step**，`name` 分别为「静态检查」「单元测试」「类型与构建」，分别执行 `npm run ci:lint` / `ci:test` / `ci:build`。
- **AC-1.2.4** YAML 中不含任何真实命令字面量（`eslint`、`vitest`、`tsc` 均不出现），只有脚本名。
- **AC-1.2.5** 含 `permissions: contents: read`、`concurrency`（`cancel-in-progress: true`）、`timeout-minutes: 15`。
- **AC-1.2.6** `setup-node@v4` 用 `node-version: 22.x` 与 `cache: npm`。
- **AC-1.2.7** 安全：文件中不出现服务器 IP、域名、备案号、`secrets.*`。

**规模**：小（新增 1 个文件，约 50 行）

---

## Story 1.3 · 构建产物留存

**Traceability**：FR-6、US-5

**作为**站长，**我希望**绿跑后能下载这次构建出来的 `dist/`，**以便**手动部署时用的是 CI 验证过的那一份，而不是本地可能过期的产物。

**验收标准**

- **AC-1.3.1** 存在 `actions/upload-artifact@v4` 步骤，`path: dist`，`retention-days: 7`。
- **AC-1.3.2** 该步骤带 `if: success()`，红灯时不执行。
- **AC-1.3.3** `dist/` 已在 `.gitignore` 中（确认未误提交构建产物）。

**规模**：很小（1 个 step）

---

## Story 1.4 · 状态徽章与文档同步

**Traceability**：FR-7、US-4

**作为**仓库访问者，**我希望**在 README 顶部看到流水线状态，**以便**几秒内判断这个仓库是否健康。

**验收标准**

- **AC-1.4.1** `README.md` 标题行之后出现 CI 徽章，指向 `DSBYSJ/cycling-dashboard` 的 `ci.yml`，`branch=main`。
- **AC-1.4.2** `git diff --stat README.md` 为 1 增 0 删，未夹带其它改动。
- **AC-1.4.3** `CHANGELOG`（`src/data/changelog.ts`）新增一条对应版本条目 —— 沿用本项目"每次改动必须升版本号 + 写 CHANGELOG"的既有工程约定。

**规模**：很小

---

## 依赖与顺序

```
1.1 ──> 1.2 ──> 1.3
        └────> 1.4（徽章要等流水线首次成功后才有意义）
```

1.1 必须先做：它定义了 1.2 要调用的脚本名。1.3/1.4 相互独立，可任意顺序。
