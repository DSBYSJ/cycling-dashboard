/**
 * 数据库迁移。
 *
 * 约定:只追加、不修改已发布的迁移 —— 线上库的 schema_migrations 里已记录了版本号，
 * 改动历史迁移不会重跑，只会造成"本地对、线上错"。
 * 需要改结构时新增一条，写 ALTER TABLE。
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      -- 用户:邮箱唯一(不区分大小写),密码只存 scrypt 哈希
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT    NOT NULL COLLATE NOCASE,
        password_hash TEXT    NOT NULL,
        display_name  TEXT,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );
      CREATE UNIQUE INDEX idx_users_email ON users(email);

      -- 骑行记录:主键用 (user_id, id) 复合，保证不同用户可以用同一个记录 id 而不互相覆盖
      CREATE TABLE rides (
        user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id                 TEXT    NOT NULL,
        date               TEXT    NOT NULL,
        label              TEXT,
        bike_id            TEXT,
        check_in           INTEGER NOT NULL DEFAULT 0,
        duration_min       REAL,
        distance_km        REAL,
        avg_speed          REAL,
        max_speed          REAL,
        city_name          TEXT    NOT NULL DEFAULT '',
        city_code          TEXT    NOT NULL DEFAULT '',
        start_name         TEXT,
        start_district     TEXT,
        location_lat       REAL,
        location_lon       REAL,
        env_json           TEXT    NOT NULL,
        env_meta_json      TEXT    NOT NULL,
        route_json         TEXT    NOT NULL,
        track_json         TEXT    NOT NULL,
        route_name         TEXT,
        speed_series_json  TEXT    NOT NULL,
        scores_json        TEXT,
        comment            TEXT    NOT NULL DEFAULT '',
        suggestions_json   TEXT    NOT NULL,
        notes              TEXT    NOT NULL DEFAULT '',
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      -- 列表与趋势都是"按日期倒序取这个用户的记录"，这个索引直接覆盖
      CREATE INDEX idx_rides_user_date ON rides(user_id, date DESC, created_at DESC);

      -- 单车
      CREATE TABLE bikes (
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id              TEXT    NOT NULL,
        name            TEXT    NOT NULL,
        category        TEXT    NOT NULL,
        tire_type_id    TEXT    NOT NULL,
        tire_installed_at TEXT  NOT NULL,
        tire_start_km   REAL    NOT NULL DEFAULT 0,
        notes           TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );

      -- 每日骑行打卡:一个用户一天一条，主键就是日期
      CREATE TABLE days (
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id          TEXT    NOT NULL,
        date        TEXT    NOT NULL,
        rode        INTEGER NOT NULL DEFAULT 0,
        bike_id     TEXT,
        distance_km REAL,
        ride_id     TEXT,
        note        TEXT,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
    `,
  },
  {
    version: 2,
    name: 'admin-console',
    sql: `
      -- 账号状态:站长控制面板要能停用账号(而不是只能删除)
      -- SQLite 允许给已有表加"非空 + 有默认值"的列
      ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      -- 最后登录时间:用户列表里用来看活跃度
      ALTER TABLE users ADD COLUMN last_login_at TEXT;
      -- 令牌版本:改密 / 重置密码 / 停用时自增，让此前签发的所有令牌立即失效。
      -- 老令牌里没有 tv 字段，解析时按 0 处理，而这里的默认值也是 0 —— 升级不会把在线用户踢掉。
      ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

      -- 运行时设置(key-value)。只放"运营期要随手改"的项:
      --   allow_register / feedback_enabled
      -- 部署期配置(JWT_SECRET / DATABASE_PATH / PORT / COOKIE_SECURE)只留在 .env，
      -- 后台不提供任何读写入口 —— 放在数据库里反而扩大了攻击面。
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 管理操作审计:出问题时唯一的举证材料，所以写操作都要落一条
      CREATE TABLE admin_audit_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id   INTEGER NOT NULL,
        action     TEXT NOT NULL,
        target     TEXT,
        detail     TEXT,
        ip         TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_created ON admin_audit_log(created_at DESC);

      -- 用户 -> 站长 的单向留言(合规上不构成用户间信息发布，见 docs/用户聊天功能合规评估.md)
      CREATE TABLE feedback (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content    TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'open',
        reply      TEXT,
        replied_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_feedback_user ON feedback(user_id, created_at DESC);
      CREATE INDEX idx_feedback_status ON feedback(status, created_at DESC);

      -- 注册邀请码:把"开放注册"换成"凭码注册"
      CREATE TABLE invite_codes (
        code       TEXT PRIMARY KEY,
        max_uses   INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        note       TEXT,
        created_at TEXT NOT NULL
      );

      -- 邀请码使用记录:谁在什么时候用哪个码注册的
      CREATE TABLE invite_uses (
        code    TEXT    NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        used_at TEXT    NOT NULL,
        PRIMARY KEY (code, user_id)
      );
    `,
  },
]
