# 骑行看板后端（登录 + 云端数据）

给「骑行评分监测看板」提供账号系统与云端存储，让骑行数据从「只在本机浏览器里」变成「换设备登录也能看到」。

## 技术选型与理由

| 选择 | 为什么 |
|---|---|
| Node 22 + TypeScript | 与前端同一门语言，类型定义直接复用 `src/types.ts`，两端模型不会各自漂移 |
| Fastify | 轻、快，插件生态够用（Cookie、限流） |
| **`node:sqlite`（Node 内置）** | **整个后端没有任何需要编译的原生模块**。`better-sqlite3`、`bcrypt` 这类在便宜的云服务器上经常装不上；内置 SQLite 零依赖、零配置，个人规模完全够用，**备份就是拷一个文件** |
| `node:crypto` scrypt | 密码哈希用内置实现，同样避开原生模块 |
| httpOnly Cookie 会话 | 登录态 JS 读不到（防 XSS 窃取），前端也不必自己管令牌 |

> 代价：需要服务器上 Node ≥ 22.6（`node:sqlite` 与 TS 直跑都依赖它）。装 Node 22 的命令见下文。

## 接口一览

前端一律走**同源** `/api`（开发时由 Vite 代理，线上由 Nginx 反代）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 探活，不需要登录 |
| GET | `/api/bootstrap` | 首屏一次拿齐：当前用户 + 单车 + 打卡 + 骑行记录列表 |
| POST | `/api/auth/register` | 注册（邮箱 + 密码），成功后直接登录 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/password` | 改密码 |
| GET | `/api/rides` | 记录列表，支持 `?from=&to=&limit=&offset=`；**不含轨迹**，只给 `hasTrack` 标记 |
| GET | `/api/rides/:id` | 单条详情，**含完整轨迹** |
| PUT | `/api/rides/:id` | 新增或覆盖 |
| DELETE | `/api/rides/:id` | 删除 |
| POST | `/api/rides/bulk` | 批量导入（把浏览器里的本地数据搬到云端用） |
| GET/PUT/DELETE | `/api/bikes`、`/api/bikes/:id` | 同上，另有 `/bulk` |
| GET/PUT/DELETE | `/api/days`、`/api/days/:id` | 同上，另有 `/bulk` |

**列表为什么不返回轨迹**：一条 5000 点的 GPX 记录 JSON 有几百 KB，历史列表有多少条就要传多少份，手机上会非常慢。所以列表只给元数据，用户点开某条时再调详情接口取轨迹。

错误响应统一是 `{ "error": { "code": "...", "message": "..." } }`，前端按 `code` 判断（如 `session_expired` 时跳登录页）。

## 本地开发

```bash
# 1. 后端
cd server
npm install
cp .env.example .env
npm run gen-secret          # 生成随机密钥，粘贴到 .env 的 JWT_SECRET
# 本地没有 HTTPS，把 .env 里的 COOKIE_SECURE 改成 false
npm run dev                 # 默认 http://127.0.0.1:3000

# 2. 前端（另开一个终端，在项目根目录）
npm run dev                 # 打开 http://localhost:5173，/api 会被代理到 3000
```

常用命令：

```bash
npm test          # 单元 + 集成测试(真实 SQLite + 真实 HTTP 请求)
npm run typecheck # 类型检查
```

## 部署到阿里云 + 宝塔面板

### 0. 服务器选型建议

这个应用非常轻（SQLite 文件 + 一个 Node 进程，常驻内存约 100MB 上下），**不需要大配置**。
下面价格是 2026 年中的公开活动价，实际以下单页为准：

| 方案 | 配置 | 参考价 | 说明 |
|---|---|---|---|
| **轻量应用服务器（推荐）** | 2核2G / 40G ESSD / 200M 峰值 | 秒杀 38 元/年，常规 **68 元/年** | **购买时应用镜像直接选「宝塔Linux面板」**，省掉自己装面板这一步 |
| ECS 经济型 e 实例 | 2核2G / 40G / 3M 固定带宽 | 99 元/年（续费同价） | 带宽是固定的、不共享，价格稳定；3M 对个人够用 |
| ECS u1 实例 | 2核4G / 80G / 5M 固定带宽 | 199 元/年 | 余量更足 |
| 香港轻量（免备案） | 2核2G / 40G | 39 元/月 | 不想折腾备案就选它，但国内访问延迟略高 |

两点提醒：
- 轻量的「200M」是**峰值**带宽（不承诺），ECS 的 3M/5M 是**固定**带宽。个人用两者都够。
- 学生可以领阿里云 300 元无门槛券，先领再买。

### 1. 域名与备案（中国大陆服务器必读）

- 用**域名 + HTTPS** 访问才完整：PWA 的离线能力（Service Worker）**只在 HTTPS 或 localhost 下生效**，用 `http://IP:端口` 打开会装不上、也缓存不了。
- 中国大陆服务器的域名必须完成 **ICP 备案**（免费，但通常要 7～20 天，需要服务器和域名都在同一账号下）。
- 还没备案也能先用 `http://IP:端口` 跑起来，记得把 `.env` 里的 `COOKIE_SECURE` 设成 `false`，否则浏览器不会保存登录态。

### 2. 装 Node 22

宝塔面板 →「软件商店」→ 搜 `Node.js版本管理器` → 安装 → 再装 **Node 22**。

或者用命令行：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22 && nvm use 22
node -v   # 必须 >= v22.6
```

> 低于 22.6 会直接启动失败并提示版本不够（`node:sqlite` 与 TS 直跑都需要它）。这是刻意设计的：宁可启动时明确报错，也不要跑起来一半才发现问题。

### 3. 放代码

```bash
cd /www/wwwroot
git clone https://github.com/DSBYSJ/cycling-dashboard.git
cd cycling-dashboard/server
npm install --omit=dev      # 运行时不依赖 typescript，省流量
cp .env.example .env
npm run gen-secret          # 把输出粘到 .env 的 JWT_SECRET
vi .env                     # 至少改这几项 ↓
```

`.env` 生产环境必须确认的项：

```ini
NODE_ENV=production         # 必须在 .env 里，不能只靠 systemd 的 Environment=
HOST=127.0.0.1              # 只监听本机，由 Nginx 对外（别设 0.0.0.0）
COOKIE_SECURE=true          # 配好 HTTPS 后必须是 true
JWT_SECRET=<npm run gen-secret 的输出>
ALLOW_REGISTER=true         # 注册完自己的账号后可改成 false 锁死注册
```

> `NODE_ENV` 为什么强调要写在 `.env` 里：它只在两处起作用，但都不是小事 ——
> 设为 `production` 时，出错响应只返回一句「服务器内部错误」，dev 模式会把**内部错误信息**
> 一起返回给客户端；日志级别也在生产模式才正常。如果只靠 systemd 的 `Environment=` 提供，
> 一旦改用 PM2 / 面板「Node 项目」托管就会丢失，等于悄悄把内部信息暴露出去。
> `install.sh` 已支持幂等补齐这一项。

### 4. 建 Node 项目

宝塔 →「网站」→「Node 项目」→ 添加：

- 项目名称：`cycling-dashboard`
- 项目目录：`/www/wwwroot/cycling-dashboard/server`
- 端口：`3000`
- Node 版本：选 `v22.x`（**必须 ≥ 22.6**，`node:sqlite` 需要）
- 运行用户：`www`（若面板没这项选项，保持默认即可）
- 勾选「开机自启」

**启动命令有两种填法，取决于面板给的是哪一种：**

| 面板界面 | 填什么 |
|---|---|
| 只有一个「启动命令」/「启动选项」框 | `npm start` |
| 分成「启动文件」+「启动选项」两个框 | 启动文件 `src/index.ts`，启动选项 `--disable-warning=ExperimentalWarning --experimental-strip-types` |

> ⚠️ **`--experimental-strip-types` 不能漏。** 这个后端是「直接运行 TypeScript」的，
> 没有构建步骤（当初就是为了在便宜服务器上不踩原生模块编译坑），漏掉这个参数会启动失败。
> 用 `npm start` 的话它已经包含在内（见 `package.json`），最省事。
>
> ⚠️ 还有一点：**项目目录必须填到 `server` 这一层**。后端的 `.env` 和 `data/` 都是按
> 「当前工作目录」找的（`process.loadEnvFile(path.join(process.cwd(), '.env'))` 与
> `DATABASE_PATH=./data/cycling.db`）。填成上级目录会读不到配置、甚至起不来。

保存后状态应为「运行中」。**先点开日志确认没有报错**，也可以本机验证：

```bash
curl -s http://127.0.0.1:3000/api/health     # 期望 {"ok":true,...}
```

> 如果启动报权限错误，多半是 `data/` 目录不属于 `www` 用户：
> `chown -R www:www /www/wwwroot/cycling-dashboard/server`

### 5. 前端构建 + 站点配置

```bash
cd /www/wwwroot/cycling-dashboard
npm install && npm run build      # 产物在 dist/
```

宝塔 →「网站」→ 添加站点（绑定你的域名，根目录设为 `/www/wwwroot/cycling-dashboard/dist`），然后在**该站点的配置文件**里加反代 —— 关键是让 `/api` 走 Node，其余走静态文件：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 前端是单页应用且有 hash 路由，未命中的路径回落到 index.html
location / {
    try_files $uri $uri/ /index.html;
}
```

要点说明：
- **必须同源**：前端请求 `/api/...` 不带域名，所以不存在跨域，Cookie 也能正常携带。不要把 API 放到另一个域名或端口上，否则要额外处理 CORS + SameSite，反而更容易错。
- `X-Forwarded-For` 别省 —— 后端的登录限流靠它取真实客户端 IP。
- `X-Forwarded-Proto` 让后端知道外部是 HTTPS。

### 6. HTTPS

宝塔站点 →「SSL」→ Let's Encrypt 一键申请 → 打开「强制 HTTPS」。
搞定后确认 `.env` 里 `COOKIE_SECURE=true`，重启 Node 项目。

### 7. 备份（重要）

数据全在 `server/data/cycling.db` 一个文件里，用仓库自带的脚本备份：

```bash
cd /www/wwwroot/cycling-dashboard/server && node scripts/backup.mjs
# 默认写 /www/backup/cycling-dashboard/cycling-<时间戳>.db，保留 30 天
# 可用参数覆盖：node scripts/backup.mjs <数据库路径> <备份目录>
# 环境变量 BACKUP_KEEP_DAYS 可改保留天数
```

**为什么不用 `cp cycling.db`**：SQLite 默认跑在 WAL 模式下，最新写入可能还在 `cycling.db-wal` 里，
只拷主文件会得到一个落后甚至损坏的副本。脚本用的是 `VACUUM INTO` —— 由 SQLite 自己生成
事务一致的完整快照，**不用停服务**也不会漏 WAL。

定时任务（放在 `/etc/cron.d/`，宝塔「计划任务」界面看不到，但更简单可靠）：

```cron
# /etc/cron.d/cycling-dashboard-backup
30 3 * * * root cd /www/wwwroot/cycling-dashboard/server && /www/server/nodejs/v22.20.0/bin/node scripts/backup.mjs >> /www/wwwlogs/cycling-backup.log 2>&1
```

> ⚠️ **crontab 里的 `%` 是特殊字符**：`date "+%F %T"` 这类写法**根本不会执行**（`%` 被当成换行，
> 后面的内容变成命令的 stdin）。要用就写 `\%`。这个坑很隐蔽——任务看起来配好了，其实什么都没跑。

建议再把 `/www/backup/cycling-dashboard` 纳入宝塔的「文件备份」或同步到 OSS/网盘。

### 8. 一台真实服务器上的落地记录（可作参考）

以下是阿里云大陆 ECS（Debian 13 / 2核2G / 宝塔面板 / **域名未备案**）上的实际结果与踩坑记录。

**关键发现：阿里云安全组的默认放行范围很窄。** 实测该实例只放行了 **80**（以及 SSH 的 22）：

| 端口 | 外网可达 |
|---|---|
| 80 | ✅ 通 |
| 443 / 888 / 8888 / 8080 / 3000 | ❌ 全部不通 |

所以「用 8080 端口规避备案限制」这个思路**要求你先去阿里云控制台放行 8080**。
不想动控制台的话，还有个更省事的路子：

> **用 80 端口 + `server_name <服务器IP>`。**
> 阿里云的备案拦截是**按域名（Host）判定**的，纯 IP 访问不受影响。
> 实测 `http://<IP>/` 在未备案状态下正常返回页面。
> 于是站点同时监听 80 和 8080：80 供 IP 访问（现在就能用），8080 留给「域名 + 放行后」的场景。

`server_name` 写成 IP 是合法的，请求头 `Host: <IP>` 会精确命中这个 server 块，
排在宝塔默认站之前的匹配规则里胜出，不会跟宝塔的默认站点冲突。

**安装过程（全部命令行，不用点面板）**

```bash
# 1) 装 Node 22，放到宝塔的目录约定下（install.sh 会扫 /www/server/nodejs/v*/bin/node）
mkdir -p /www/server/nodejs && cd /tmp
curl -fL -o node.tar.xz \
  https://registry.npmmirror.com/-/binary/node/latest-v22.x/node-v22.20.0-linux-x64.tar.xz
tar -xJf node.tar.xz -C /www/server/nodejs
mv /www/server/nodejs/node-v22.20.0-linux-x64 /www/server/nodejs/v22.20.0

# 2) 代码 + 一条命令装好后端
cd /www/wwwroot/cycling-dashboard && bash server/scripts/install.sh

# 3) 本机防火墙（ufw 默认拒绝入站，必须显式放行）
ufw allow 80/tcp && ufw allow 8080/tcp
```

**Nginx 站点**：配置直接写到 `/www/server/panel/vhost/nginx/cycling-dashboard.conf`
（主配置里有 `include /www/server/panel/vhost/nginx/*.conf;`）。
这样加的站点**不会出现在宝塔「网站」列表里**（面板列表读的是它自己的数据库）。
以后想用面板管理 SSL，可以在面板里添加同域名站点，再把本文件的内容合并过去。

**两个容易误判的坑**

1. **`nginx -s reload` 之后要等一下再验证。** reload 会先起新 worker，旧 worker 处理完存量连接才退出；
   如果 reload 后**立刻**发请求，可能仍由持有旧配置的 worker 响应，看起来像"配置没生效"。
   实测第一次就踩了这个 —— 配置明明在 `nginx -T` 里，请求却还是旧的响应。`sleep 1~2` 即可。
   用宝塔的 `/etc/init.d/nginx reload` 比 `nginx -s reload` 更稳妥。
2. **`iptables` 里端口是 ACCEPT，不代表外网能通。** 本机 `curl 127.0.0.1` 走的是 `lo` 回环，
   会被 `-i lo -j ACCEPT` 放行，跟外网路径完全不是一回事。
   要判断到底是安全组还是本机防火墙拦的，看 `iptables -L ufw-user-input -n -v` 那条规则的**包计数**：
   计数为 0 就说明外部连接压根没到服务器（即云厂商安全组拦的）。

**这台服务器上验证过的清单**

| 项 | 结果 |
|---|---|
| `npm install --omit=dev` | 69 个包，**1 秒**（走 npmmirror），无任何原生模块 |
| systemd 服务 | `cycling-api` enabled + active；`WorkingDirectory` 指向 server/，`ExecStart` 用**绝对** node 路径 |
| 公网端到端 | 首页 200 → `/api/health` ok → 未登录 401 → 注册成功 → 写入并读回记录 → 登出 204 → 再访问 401 |
| Cookie 标志位 | `HttpOnly; SameSite=Lax; Path=/`，**无 `Secure`**（http 阶段必须如此，否则浏览器不保存登录态） |
| 列表接口 | `track` 为空数组、`hasTrack=true`（大轨迹不在列表里传，符合设计） |
| 备份 | `node scripts/backup.mjs` 生成 6 张表的完整快照，`PRAGMA integrity_check = ok`；cron 每天 03:30 |
| 开机自启 | `cycling-api`、`nginx`、`cron`、`bt`(面板) 均已注册 |

**这台服务器上还没做的（等备案）**

- 443 端口在安全组里**没放行**，所以 HTTPS 还上不了
- 域名还没加进 `server_name`，也还没申请证书
- 未备案期间：**Service Worker 不生效 → PWA 离线能力用不了**（浏览器只在 HTTPS 下给 secure context）
- **高德 Key 的域名白名单**：用 IP 访问时 referer 是 IP，地图可能空白；要把 IP 和域名都加进白名单

## 常见故障排查

| 现象 | 原因与处理 |
|---|---|
| 站点 502 | Node 项目没起来。看宝塔 Node 项目日志；`curl 127.0.0.1:3000/api/health` 本机试一下 |
| 登录后刷新就掉登录态 | 大概率是 `COOKIE_SECURE=true` 但你在用 http 访问（或反过来）。按访问协议调 `.env` 后重启 |
| 前端能开，接口全 404 | Nginx 的 `/api/` 反代没配或配到了别的站点 |
| 提示 `JWT_SECRET 未配置` | 启动时故意拦的：按提示执行 `npm run gen-secret` |
| 提示 Node 版本不够 | 见「装 Node 22」 |
| 登录提示「操作过于频繁」 | 触发了限流（默认同一 IP 10 分钟 10 次）。改 `.env` 的 `AUTH_RATE_LIMIT_MAX` 后重启 |
| 数据没写进去 | 看 `server/data` 目录属主是不是 `www` |

## 安全清单

- [x] 密码用 scrypt 加盐哈希，不存明文
- [x] 登录态放 httpOnly Cookie，JS 读不到
- [x] 登录/注册限流，防密码爆破；用户不存在时也做一次等价哈希运算，避免用响应时间判断邮箱是否注册
- [x] 所有数据接口按 `(user_id, id)` 复合主键隔离，越权读写在 SQL 层就查不到
- [x] 入参在服务端强制校验并归一化（前端校验只为体验，服务端才是边界）
- [x] 生产环境错误响应不外泄堆栈；日志脱敏 Cookie
- [ ] **`JWT_SECRET` 用 `npm run gen-secret` 生成并只放在服务器上**，不要提交、不要发聊天
- [ ] 服务器安全组只放 80/443（以及你的 SSH 端口），**不要开放 3000**
- [ ] 数据库文件不要放进 git、不要放在网站根目录
