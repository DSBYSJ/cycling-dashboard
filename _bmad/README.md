# `_bmad/` · 工作流的配置层

这里放的是**配置**，产物在隔壁 [`_bmad-output/`](../_bmad-output/README.md)。

两者的分工，正好对应 BMAD 的一个核心主张：**流程的规则与流程的产出要分开存**——
规则稳定、产物随项目推进不断累积。

```
_bmad/                      配置：产物放哪、用什么语言、每个阶段叫什么
└── bmm/config.yaml         ← 唯一一份配置，改了立刻影响后续产物的落点

_bmad-output/               产物：真正被 git 逐条记录的东西
├── planning-artifacts/     简报 / PRD / 架构 / Epics
├── specs/                  每个 story 一份 SPEC
├── implementation-artifacts/  Sprint 状态、story 推进记录
└── test-artifacts/         审查记录、验证报告
```

## 为什么配置要进仓库

单人项目里，配置进不进仓库看起来没差别。但它决定了三件事：

1. **产物路径是约定，不是习惯** —— 换台机器、隔三个月回来，不用回忆"上次那份 PRD 存哪了"；
2. **核验成本** —— 读 `bmm/config.yaml` 的 `phases` 表，就知道每个阶段对应哪份产物、哪条提交，
   不必翻整个 `git log`；
3. **可迁移** —— 真要换 CI 平台或换 AI 助手，配置在仓库里，产物格式不变。

## 本项目的实际推进记录

八个阶段（简报 → PRD → 架构 → SPEC → Epics → Sprint → Build → 审查 → 验证）的产物路径与提交哈希，
全部写在 [`bmm/config.yaml`](bmm/config.yaml) 的 `phases` 里，逐条可核。
一句话索引见 [`_bmad-output/README.md`](../_bmad-output/README.md)。
