# 验证报告 · CI 流水线

> 产出工作流：`/bmad-walkthrough`（Verification）
> 验证对象：`feature/ci-pipeline` 分支（story 1.1 ~ 1.4 + 评审修复 R-01）
> 时间：2026-11-04 ｜ 环境：Windows + Git Bash，Node v22.22.2 / npm 10.9.7

---

## 一、验证策略：不验"能不能跑通"，验"坏代码能不能被拦下"

一条只会变绿的流水线是没价值的 —— 它只是一段打印。真正要证明的是**它会不会红**。
所以下面四个实验里，有三个是**故意把代码弄坏**。

| 实验 | 目的 | 对应验收标准 |
|---|---|---|
| A | 注入未使用变量 → lint 必须拦下，且后续闸门不执行 | AC-1.1.2 |
| B | 注入类型错误（lint 查不出）→ 必须由 `tsc -b` 拦下 | AC-1.1.3 |
| C | 注入仅产生 warning 的写法 → 旧 `lint` 放行、CI 版拦下 | AC-1.1.4 |
| D | 全部还原 → 必须回到全绿 | AC-1.1.1 |

实验用同一个探针文件 `src/components/__ci_probe__.tsx`，三次改内容、跑完即删，**不进入提交历史**。

---

## 二、实验记录（原始输出）

### 实验 A · lint 拦得住吗

探针内容（一段未使用变量）：

```tsx
export function Probe() {
  const unused = 1
  return <div>probe</div>
}
```

```
$ npm run ci
> eslint . --max-warnings=0

G:\glmscs\bike\cycling-dashboard\src\components\__ci_probe__.tsx
  3:9  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (1 error, 0 warnings)
EXIT=1
```

**关键观察**：日志中 `Tests 182 passed` 出现 **0 次** —— 说明 `&&` 短路生效，第 2、3、4 段根本没有执行。这正是"前一刀不过立刻停"的要求。

**结论**：通过。

---

### 实验 B · 类型错误拦得住吗

探针换成类型错误（语法合法、lint 的语法规则查不出）：

```tsx
export function Probe() {
  const bad: string = 1
  return <div>{bad}</div>
}
```

```
$ npm run ci
> npm run ci:lint        ← 通过
> npm run ci:test
      Tests  182 passed (182)      ← 182 个用例照常通过，没被牵连
> npm run ci:build
> tsc -b && vite build
src/components/__ci_probe__.tsx(3,9): error TS2322: Type 'number' is not assignable to type 'string'.
EXIT=2
```

**关键观察**：
1. lint 通过、测试通过 —— 证明这类错误**只有 `tsc -b` 能抓**，而它只在 build 阶段跑。这正是 brief 里"日常 `vite dev` 不做类型检查"那条风险的实证。
2. 退出码是 **2**（tsc 的约定），不是 1。所以任何"判断 `$? == 1` 就算失败"的脚本都会漏判 —— 必须按"非零即失败"处理。这是本次验证的额外收获。

**结论**：通过。

---

### 实验 C · "警告即失败"真的有意义吗

探针换成一个只触发 warning 的写法（同时导出组件与非组件）：

```tsx
export const helper = () => 1
export function Probe() {
  return <div>{helper()}</div>
}
```

同一份代码，两条命令：

```
$ npm run lint                    # 改造前的 lint
  2:14  warning  Fast refresh only works when a file only exports components...
✖ 1 problem (0 errors, 1 warning)
EXIT=0                            ← 放行

$ npm run ci:lint                 # CI 用的版本
> eslint . --max-warnings=0
  2:14  warning  ...同上...
✖ 1 problem (0 errors, 1 warning)
ESLint found too many warnings (maximum: 0).
EXIT=1                            ← 拦下
```

**关键观察**：**同一份代码，旧命令绿、新命令红**。这一对输出直接证明了 `--max-warnings=0` 不是装饰 —— 它把"以后再说"的警告变成了必须当场处理的问题。

**结论**：通过。

---

### 实验 D · 还原后是否回到全绿

删除探针文件，`git status` 干净，全量复跑：

```
$ npm run ci
> npm run ci:lint        ✓
> npm run ci:test
 Test Files  14 passed (14)
      Tests  182 passed (182)
   Duration  3.67s
> npm run ci:server
# tests 110
# pass 110
# fail 0
> npm run ci:build
 ✓ built in 5.76s
EXIT=0
```

**结论**：通过。**闸门覆盖 182 + 110 = 292 个用例**。

---

## 三、验证过程中真实遇到的问题

### P-1 · 本地偶发 `EPERM`，一度以为把测试跑挂了

**现象**：某次 `npm run ci` 在测试段失败，只有 12 个文件 / 137 个用例，并报：

```
Error: EPERM: operation not permitted, open
  'C:\Users\20261\AppData\Local\Temp\<...>\web\<hash>'
 ❯ wrappedPromisesWriteFile  .../cli/vendor/shim/node-brokered-fs-shim.cjs:724:20
 ❯ Proxy.fetch  node_modules/vitest/dist/chunks/resolveConfig.rBxzbVsl.js:6643:7
```

**定位过程**：
1. 堆栈里出现 `node-brokered-fs-shim.cjs` —— 这是**工具运行沙箱的文件系统代理**，不在项目依赖里；
2. 失败发生在 vitest 向系统临时目录写转换缓存时，不是断言失败；
3. 直接复跑同一条命令，恢复 14 文件 / 182 用例全过。

**结论**：环境侧的临时文件权限竞争，**不是项目缺陷、也不是流水线缺陷**。处置是不改代码、记录在案；若在真实 CI（GitHub 托管机器）上出现同类问题，才按 flaky 缺陷处理。

**这条没被"顺手删掉"的原因**：它是"测试偶发失败"最容易误判的一类 —— 看着像自己把代码改坏了。留档可避免下次重新排查一遍。

### P-2 · `tsc` 用退出码 2 表示失败

见实验 B。已确认语义：**任何非零都算失败**，不能只判 `==1`。

---

## 四、验收标准逐条对照

| AC | 内容 | 结果 | 证据 |
|---|---|---|---|
| AC-1.1.1 | 干净代码 `npm run ci` 退出码 0 | 通过 | 实验 D |
| AC-1.1.2 | 未使用变量被拦、后续不执行 | 通过 | 实验 A（`Tests` 出现 0 次） |
| AC-1.1.3 | 类型错误由 build 阶段拦下 | 通过 | 实验 B |
| AC-1.1.4 | 仅 warning 也失败 | 通过 | 实验 C（同一代码软 0 / 硬 1） |
| AC-1.1.5 | `eslint .` 命令只定义一处 | 通过 | `grep -c "eslint \." package.json` = 1 |
| AC-1.1.6 | `engines.node` 存在 | 通过 | `>=20` |
| AC-1.2.1~7 | workflow 结构与安全项 | 通过 | YAML 解析成功，7 个 step 名称与预期一致；无真实命令字面量、无密钥 |
| AC-1.3.1~3 | 产物留存 | 通过（配置级） | `upload-artifact@v4` + `if: success()` + `retention-days: 7`；`dist` 已在 `.gitignore` |
| AC-1.4.1~3 | 徽章与文档 | 通过 | README diff 为 1 增 0 删；CHANGELOG 新增 1.0.22 条目 |
| AC-6 | 云端可下载产物 | **待云端首跑** | 本机到 github.com:443 的 TLS 不通（既有问题），见下文 |

## 五、未能在本轮闭环的一项

**AC-6（云端产物下载）与云端首次绿灯**需要仓库推送到 GitHub 并由 Actions 实际执行。本机网络到 `github.com:443` 不通（该项目一直靠 `push-api.mjs` 走 API 推送，属既有约束）。

**处置**：本轮以"**本地执行同一套命令的真实红绿结果**"作为验证证据 —— 因为 ADR-1 已保证云端与本地跑的是同一串脚本，差异只剩运行器环境。云端首跑结果由站长在可联网环境补一次截图，作为 `docs/screenshots/` 之外的补充材料。

**这不是"没做完"，是"验证边界写清楚"** —— 把不能验的部分标出来，比含糊地说"应该没问题"负责。
