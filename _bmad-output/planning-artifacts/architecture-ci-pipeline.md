# 技术架构 · CI 流水线

> 产出工作流：`/bmad-architecture`（Architect）
> 上游：`brief-cycling-dashboard-ci.md`、`prd-cycling-dashboard-ci.md`
> 日期：2026-11-04 ｜ 状态：已定稿，交 `/bmad-spec`

---

## 一、总体形状

一句话：**YAML 当壳，命令当肉**。流水线文件只负责"准备一台能跑 npm 的机器"，所有判定逻辑放在 `package.json` 的脚本里。

```
        push (任意分支) / PR → main
                    │
                    ▼
     ┌──────────────────────────────┐
     │ job: verify (ubuntu-latest)  │
     │                              │
     │ 1. checkout                  │
     │ 2. setup-node 22 + npm 缓存  │
     │ 3. npm ci        ← 装依赖    │
     │ 4. npm run ci    ← 三道闸门  │
     │      ├─ lint  (--max-warnings=0)  秒级
     │      ├─ test  (182 用例)          ~20s
     │      └─ build (tsc -b + vite)     ~10s
     │ 5. upload-artifact dist/ (仅全绿) │
     └──────────────────────────────┘
                    │
        绿 → 徽章绿 / 可下载产物
        红 → 停在该步，后序 step 不执行
```

## 二、关键决策（ADR）

### ADR-1 闸门写在 `package.json`，不写在 YAML 里

| 选项 | 评价 |
|---|---|
| **A. npm script 承载（选用）** | 本地 `npm run ci` 与云端执行**同一串命令**；换平台只换壳；命令本身可被 `git log` 审查 |
| B. 三条 `run:` 直接写在 YAML | 云端与本地两套入口，容易漂移；迁 Gitee Go 要重写一遍 |
| C. 用 Makefile / just | 引入新依赖，Windows 本地体验差（本项目开发机是 Windows + Git Bash） |

**后果**：`package.json` 的 `scripts` 成为契约面，改闸门等于改契约，diff 一眼可见。

### ADR-2 Node 版本对齐本地 22.x

本地实测 `node v22.22.2` / `npm 10.9.7`。CI 若用 20.x，可能出现在 22 上没问题、在 20 上 `tsc` 版本行为不同的偶发红。**锁 22.x，并在 `package.json` 加 `engines.node: ">=20"` 作为对外声明**（声明宽松、执行严格，两者不冲突）。

### ADR-3 `npm ci` + npm 缓存

`package-lock.json` 已在版本控制中（4591 个条目），配合 `npm ci` 可保证安装结果可复现。缓存用 `actions/setup-node@v4` 的 `cache: npm`，key 由锁文件哈希派生，锁文件一改缓存自动失效。

### ADR-4 三道门串行，不并行

语义上"先证明代码是干净的、行为是对的，再证明它能构建"。并行虽然省时，但会让"lint 挂了还跑完 build"成为常态，浪费算力也模糊反馈。总耗时本就只有约 30 秒（不含装依赖），省不出可感知的收益。

### ADR-5 `concurrency` 取消同分支旧任务

单人开发最常见的动作是"改一点、推一下、发现错了、再改再推"。不取消旧任务，队列里会堆一串过时运行，既慢又吵。

### ADR-6 产物只在全绿后上传

红灯时的 `dist/` 是"能编译但测试不过"的产物，一旦被当可发布物下载，等于把闸门的意义抵消掉。

## 三、文件布局

```
cycling-dashboard/
├── .github/
│   └── workflows/
│       └── ci.yml              ← 新增：约 50 行的壳
├── package.json                ← 改：加 "ci" script、engines
├── README.md                   ← 改：加状态徽章
└── _bmad-output/               ← 工作流产物（不进构建）
```

## 四、命令契约

```jsonc
// package.json（示意）
{
  "engines": { "node": ">=20" },
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run",
    "build": "tsc -b && vite build",
    "ci": "npm run lint -- --max-warnings=0 && npm test && npm run build"
  }
}
```

退出码语义：任一段非零 → `npm run ci` 非零 → 该 step 失败 → 后续 step 跳过。这是 npm 的 `&&` 天然行为，不需要额外写 `if`。

> 注意 `npm run lint -- --max-warnings=0` 的双横线：`--` 之后的参数才会传给 `eslint`，否则会被 npm 自己吃掉。这是最容易写错的一处，列入 story 的验收点。

## 五、失败诊断设计

| 现象 | 定位方式 |
|---|---|
| 第 4 步（npm run ci）在 0–2 秒内失败 | 看 step 输出第一段，是 eslint 报错 |
| 第 4 步在 20 秒左右失败 | vitest 用例失败，输出里有 `FAIL src/...` 与断言差异 |
| 第 4 步在 30 秒后失败且出现 `error TS` | `tsc -b` 类型错误 |
| 第 3 步（npm ci）失败 | 锁文件与 `package.json` 不一致，或 npm 源不可达 |

**step 全部带中文 `name`**，这样失败摘要里直接是「静态检查 / 单元测试 / 类型与构建」，不用靠序号猜。

## 六、与部署的关系（明确切断）

本期**不做**自动部署。服务器的路径、域名、面板入口按项目既有约定不进公开仓库（`.gitignore` 里 `server/scripts/`、`server/README.md` 已被排除）。CI 的职责止于"证明这份代码是合格的"，发布仍是人工动作 —— **这是取舍，写在这里是为了避免后人误以为是没做完**。

## 七、迁移路径（如果以后主仓迁到 Gitee）

1. 新建 `.workflow/` 配置（Gitee Go），步骤与本节第一节的图一一对应；
2. 命令列改成 `npm ci` → `npm run ci`，**一个字都不用改**；
3. 徽章换成 Gitee 的流水线徽章。

因为 ADR-1 已经把逻辑下沉到脚本，这次迁移的成本被压到"抄一遍 YAML"。
