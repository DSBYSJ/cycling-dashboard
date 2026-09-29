/**
 * 更新日志。
 *
 * 版本号可点击后展示的内容。**按版本倒序排列**（最新在前），
 * 每个版本下按「类别 → 条目」组织，缺哪类就省哪类。
 *
 * ⚠️ 升版本号时（`npm run bump:patch` / `bump:major`）要**同步在这里加一条**：
 *   - 第一条的 `version` 必须等于 `package.json` 的 version（`changelog.test.ts` 会守这条）；
 *   - 只记「用户能感知的变化」，别写内部重构、依赖升级这类无关条目。
 */

export interface ChangelogGroup {
  title: string
  items: string[]
}

export interface ChangelogEntry {
  version: string
  date: string
  groups: ChangelogGroup[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.1',
    date: '2026-09-29',
    groups: [
      {
        title: '新增',
        items: [
          'AI 教练支持直接切换要复盘的那次骑行，不用再切去「看板」页点历史列表',
          '页脚版本号可点击，查看每个版本的更新内容',
        ],
      },
      {
        title: '站长',
        items: ['「设置」里新增「更新日志」开关，可控制是否展示更新日志入口'],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-29',
    groups: [
      {
        title: '首发',
        items: [
          '云端账号体系：注册 / 登录，数据按账号隔离',
          '多维骑行评分：结合天气、空气质量与路线海拔坡度',
          'GPX 轨迹导入、速度 / 海拔曲线与地图展示',
          '单车与轮胎管理、耗材保养提醒',
          '未来 7 天出行建议，出门前就知道该挑哪个时段',
          'AI 教练复盘（DeepSeek）：针对单次骑行给出训练建议',
          '站长控制台：账号 / 数据 / 备份 / 审计 / 留言 / 邀请码 / 设置',
        ],
      },
      {
        title: '上线',
        items: ['完成 ICP 备案与公安联网备案，全站 HTTPS，支持安装到桌面（PWA）'],
      },
    ],
  },
]
