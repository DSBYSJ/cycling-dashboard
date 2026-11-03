# 代码审查记录 · story 1.1 ~ 1.4

> 产出工作流：`/bmad-code-review`（Dev / QA）
> 审查对象：分支 `feature/ci-pipeline` 相对 `main` 的全部改动
> 审查时间：2026-11-04 ｜ 审查人：站长自审（单人项目，无第二双眼睛可用）

---

## 一、审查范围

```
$ git diff --stat main...feature/ci-pipeline
 .github/workflows/ci.yml                        |  ~58 +
 README.md                                       |    1 +
 package.json                                    |   +9 -
 src/data/changelog.ts                           |  +12
 _bmad-output/**                                 |  工作流产物（不参与评审）
```

**审查关注点**（不是"代码好不好看"，而是这四件事）：
1. 闸门是否真的拦得住坏代码（而不是只跑得通）；
2. 本地与云端是否同一套判定（防止双轨）；
3. 是否引入泄露风险（服务器信息、密钥）；
4. 是否存在"看着绿、其实没验到"的假阳性。

---

## 二、发现的问题

### R-01 · High · 后端 110 个测试从未进入闸门 —— **已修**

**证据**

`server/` 是独立的一套工程，有自己的 `package.json`、`tsconfig.json`、`test/` 目录与脚本：

```
server/package.json
  "typecheck": "tsc --noEmit"
  "test": "node --test --experimental-strip-types test/*.test.ts"
```

而根目录的 `npm run ci` 只跑 `tsc -b`（根 `tsconfig.json` 仅引用 `tsconfig.app.json` + `tsconfig.node.json`，**不含 server**）与 `vitest run`（只扫 `src/`）。

**后果**：第一版流水线会在"三道门全绿"的状态下，让 110 个后端用例一次都没执行 —— 这是典型的**假阳性绿灯**，比红灯更危险。

**处置**：新增 `ci:server`（`npm --prefix server run typecheck && npm --prefix server test`），插入 `ci` 链，并在 workflow 增加「安装后端依赖」（`npm ci --prefix server`）与「后端类型与测试」两个 step。

**验证**：修复后本地 `npm run ci` 实测 `Tests 182 passed` + `# pass 110` + `built in 5.76s`，退出码 0。闸门覆盖的用例数从 182 提到 **292**。

**对 SPEC 的影响**：`SPEC.md` S-1 的 `ci` 链由 `lint && test && build` 变为 `lint && test && server && build`；S-2 的步骤数由 6 变 8。属评审驱动的范围扩展，记录在此，不回改已归档的 SPEC 正文（保持"当时是怎么想的"可追溯）。

---

### R-02 · Medium · 产物名与 PRD 的"短哈希"不一致 —— **接受偏差，更正口径**

**证据**：PRD FR-6 写的是 `dist-<commit 短哈希>`，实现是 `dist-${{ github.sha }}`（40 位完整哈希）。

**原因**：GitHub Actions 的表达式语言**没有字符串切片函数**，`github.sha` 无法在 `name:` 里截短。要用短哈希得额外引入一个 shell step 算出 `short_sha` 再输出为变量，为一个显示名增加三个 step 不划算。

**处置**：保留完整 sha。Actions 页面本身会把 sha 显示成短形式，人读起来没有差别。本记录即为口径更正 —— 以完整 sha 为准。

---

### R-03 · Low · `engines.node: ">=20"` 与 CI 只验证 22.x 看似矛盾 —— **不修，语义本就不同**

**说明**：`engines` 表达的是"**允许**在哪个范围运行"（对外声明），CI 的 `22.x` 表达的是"**在这条流水线上验证**哪个版本"。前者放宽、后者收紧，是常见且正确的组合，不构成不一致。

**保留风险**：若真的有人在 Node 20 上跑出问题，流水线不会提前发现。单人项目、实际只有一台开发机（22.22.2），此风险可接受。

---

### R-04 · Low · `if: success()` 与 GitHub 默认行为重复 —— **有意保留**

GHA 的 step 默认就是"前面都成功才跑"，`if: success()` 属于显式冗余。

**保留理由**：这条的语义是"**红灯时不许上传产物**"，是本次的一个业务规则（见 ADR-6），不是语法必需。写成显式条件，后人删它之前会先想一想；不写，则"删掉也不影响行为"，规则会静默消失。

---

### R-05 · Medium · 只改文档的提交也会跑完整流水线 —— **考虑过，不做**

一次 `docs:` 提交也要花约 2 分钟跑完 292 个用例 + 构建。

**不做的理由**：加 `paths-ignore: ['**.md', '_bmad-output/**']` 能省时间，但会引入"改了 README 里的启动命令却没验"这类漏跑。**省 2 分钟 vs 漏验一次发布说明**，选后者安全。

---

### R-06 · Low · 分支之间的 PR 不触发 —— **接受**

触发条件是 `push`（全分支）+ `pull_request`（仅 `main`）。若开 `feature/a → feature/b` 的 PR，只有 push 触发、不产生 PR 检查结果。单人开发无此场景，不为此增加配置复杂度。

---

### R-07 · Info · 每道门各起一次 npm 进程 —— **接受**

`ci:lint` / `ci:test` / `ci:server` / `ci:build` 各是一次 `npm run`，额外开销约 200ms×4。换来的是"脚本名可读、UI 里逐段可见、单段可单独复跑"。值得。

---

## 三、安全复查

| 检查项 | 结果 |
|---|---|
| workflow 中出现服务器 IP / 域名 / 备案号 | 无 |
| 出现 `secrets.*` 或任何密钥引用 | 无 |
| `permissions` 是否最小 | `contents: read`，足够 |
| 是否会把 `dist/`、`.env` 误提交 | `dist` 在 `.gitignore`；workflow 只上传为 artifact，不入库 |
| 文档中是否含真实隐私数据 | 无；引用的是仓库内相对路径与公开仓库地址 |

## 四、结论

| 级别 | 数量 | 处置 |
|---|---|---|
| High | 1 | 已修（R-01） |
| Medium | 2 | 1 接受偏差（R-02）、1 明确不做（R-05） |
| Low / Info | 4 | 3 接受、1 有意保留 |

**可以合并。** 合并前最后一次全量复跑：`npm run ci` → 退出码 0（292 用例 + 构建通过）。
