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
]
