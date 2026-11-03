# SPEC · spec-1-ci-pipeline

> 产出工作流：`/bmad-spec`
> 上游：`prd-cycling-dashboard-ci.md`、`architecture-ci-pipeline.md`
> 日期：2026-11-04 ｜ 状态：ready-for-dev

---

## 〇、落地时发现的需求冲突（先裁决，再写规格）

写 SPEC 时发现 PRD 里有两条需求打架：

- **FR-5**：闸门收敛到一条 `npm run ci`，workflow 只调用它（单一入口，避免两处真相）
- **FR-8**：每个闸门是独立 step 且带中文 name（失败可定位）

如果 workflow 只写一个 `run: npm run ci`，GitHub UI 里三道门就挤在同一个 step，FR-8 落空；如果把三条命令直接抄进 YAML，ADR-1 的"单一真相"就破了。

**裁决：两条都保留，用分层脚本解决。**

```
package.json
├── ci:lint   = npm run lint -- --max-warnings=0
├── ci:test   = npm test
├── ci:build  = npm run build
└── ci        = ci:lint && ci:test && ci:build     ← 本地一键

ci.yml
├── step「静态检查」    → npm run ci:lint
├── step「单元测试」    → npm run ci:test
└── step「类型与构建」  → npm run ci:build
```

命令定义**只存在于 `package.json` 一处**，YAML 里没有任何一条真实命令，只有脚本名 —— 单一真相与逐段可定位同时成立。
PRD 的 FR-5 同步按此修正（见本次提交对 PRD 的两处措辞调整）。

## 一、这份 SPEC 要交付什么

| # | 路径 | 动作 | 归属 story |
|---|---|---|---|
| 1 | `package.json` | 改：加 `engines.node`、四条 `ci*` script | 1.1 |
| 2 | `.github/workflows/ci.yml` | 新增 | 1.2 |
| 3 | `README.md` | 改：标题下加状态徽章 | 1.3 |

## 二、规格明细

### S-1 `package.json`

```jsonc
{
  "engines": { "node": ">=20" },

  "scripts": {
    // 既有四条保持原样：lint / test / build / preview / bump:*
    "ci:lint":  "npm run lint -- --max-warnings=0",
    "ci:test":  "npm test",
    "ci:build": "npm run build",
    "ci":       "npm run ci:lint && npm run ci:test && npm run ci:build"
  }
}
```

**约束**：
- 四条 `ci*` 必须**复用**既有 `lint` / `test` / `build`，不得把 `eslint .`、`vitest run`、`tsc -b && vite build` 再抄一遍。
- `--max-warnings=0` 必须靠 `--` 传递。写成 `npm run lint --max-warnings=0` 会被 npm 当自己的参数吞掉，`eslint` 收不到。
- `engines` 只声明不强制（不加 `engine-strict`），避免在 Node 21 之类版本上装不上。

### S-2 `.github/workflows/ci.yml`

**必须包含**（缺一即不合格）：

| 要素 | 值 | 依据 |
|---|---|---|
| `name` | `CI` | 徽章显示名 |
| `on.push` | 无分支过滤 | FR-1 |
| `on.pull_request.branches` | `[main]` | FR-1 |
| `permissions` | `contents: read` | NFR-2 |
| `concurrency.group` | `${{ github.workflow }}-${{ github.ref }}` | ADR-5 |
| `concurrency.cancel-in-progress` | `true` | ADR-5 |
| `jobs.verify.runs-on` | `ubuntu-latest` | FR-2 |
| `timeout-minutes` | `15` | NFR-1 |
| `actions/checkout` | `@v4` | — |
| `actions/setup-node` | `@v4`，`node-version: 22.x`，`cache: npm` | ADR-2 / ADR-3 |
| 装依赖 | `npm ci` | FR-3 |
| 三个闸门 step | 分别调 `ci:lint` / `ci:test` / `ci:build`，`name` 为「静态检查」「单元测试」「类型与构建」 | 第〇节裁决 |
| 产物 | `actions/upload-artifact@v4`，`path: dist`，`retention-days: 7`，`if: success()` | FR-6 |

**必须不包含**：任何服务器地址、域名、备案号、密钥、`secrets.*` 引用、部署步骤。

### S-3 `README.md` 徽章

插在标题行之后、现有引用块之前，单独一行：

```markdown
[![CI](https://github.com/DSBYSJ/cycling-dashboard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DSBYSJ/cycling-dashboard/actions/workflows/ci.yml)
```

**不得**顺带改动 README 其它段落 —— 一次提交只做一件事（`git diff --stat README.md` 应为 1 增 0 删）。

## 三、实现顺序

1. S-1 先落地 —— 本地就能跑的三道门，是后面一切的地基
2. 本地跑 `npm run ci` 确认退出码 0
3. S-2 把地基搬上云
4. S-3 最后加徽章（流水线首次成功前徽章是 `no status`）

## 四、build 阶段自检清单

- [ ] `npm run ci` 本地退出码为 0
- [ ] `grep -c "eslint \." package.json` 结果为 1（命令只有一处定义）
- [ ] YAML 两空格缩进、无 tab
- [ ] YAML 内无真实命令，只有脚本名
- [ ] workflow 不含服务器地址 / 域名 / 备案号 / 密钥
- [ ] Node 版本是 `22.x` 而非 `latest`
- [ ] artifact 步骤带 `if: success()`
- [ ] README diff 为 1 增 0 删

## 五、边界条件（真实会踩的坑）

| 坑 | 表现 | 处理 |
|---|---|---|
| `--max-warnings=0` 位置写错 | eslint 报 unknown option，或参数被静默忽略 | 必须 `npm run lint -- --max-warnings=0` |
| GitHub 默认 shell 是 `bash -e` | 多行 `run:` 中的 `&&` 短路行为与本地一致，无需额外 `set -e` | 不写 `set -e`，避免噪音 |
| `tsc -b` 增量缓存 | 本地二次 build 变快，CI 每次全新 | 属预期，不追平 |
| 徽章 404 / no status | 流水线从未运行过 | 首次 push 后自动出现，不属缺陷 |
| 红灯时无 `dist/` | `if: success()` 保证不上传绿灯才有的产物 | 无需额外判断目录是否存在 |

## 六、验收映射

| AC | 由哪条规格兑现 | 验证手段 |
|---|---|---|
| AC-1 绿 | S-1 全量 | `npm run ci` 退出码 0 |
| AC-2 lint 拦得住 | `ci:lint` 的 `--max-warnings=0` + `&&` 短路 | 注入未使用变量 → 看退出码与后两段是否执行 |
| AC-3 类型拦得住 | `ci:build` 复用含 `tsc -b` 的 `build` | 注入类型错误 → lint/test 过、build 挂 |
| AC-4 警告即失败 | `ci:lint` | 注入仅产生 warning 的写法 → 退出码非 0 |
| AC-5 本地等价 | S-1 是唯一入口 | 同一命令两次结果一致 |
| AC-6 产物 | S-2 upload-artifact | 核对 step 配置，云端首跑后核对下载内容 |
