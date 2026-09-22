#!/usr/bin/env bash
# ============================================================================
#  骑行看板后端 · 一键安装脚本（阿里云大陆服务器 + 宝塔面板）
#
#  用法（在宝塔面板左侧「终端」里，root 身份执行）：
#      cd /www/wwwroot/cycling-dashboard
#      bash server/scripts/install.sh
#
#  它做六件事：
#      1. 检查代码目录是否完整（后端会引用前端的 src/types.ts，漏了就跑不起来）
#      2. 找一个可用的 Node（≥ 22.6），并实测 node:sqlite 和 TS 直跑能不能用
#      3. 安装后端依赖（走国内镜像，避免 npm 在墙内卡死）
#      4. 生成 .env（自动生成随机 JWT_SECRET，文件权限 600）
#      5. 注册 systemd 服务并启动（开机自启 + 崩溃自动重启）
#      6. 自检 /api/health，失败就把日志打出来
#
#  重复执行是安全的：已存在的 .env 不会被覆盖，服务会被平滑重启。
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$APP_ROOT/server"

RUN_USER="${RUN_USER:-www}"
API_PORT="${API_PORT:-3000}"
SVC_NAME="cycling-api"
LOG_FILE="/www/wwwlogs/cycling-api.log"
NPM_REGISTRY="https://registry.npmmirror.com"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ✓\033[0m %s\n' "$*"; }
info() { printf '\033[36m  ·\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !\033[0m %s\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
step "1/6 检查代码目录"
# ---------------------------------------------------------------------------
[ "$(id -u)" = "0" ] || die "请用 root 身份执行（宝塔面板左侧「终端」默认就是 root）"

[ -f "$SERVER_DIR/package.json" ] || die "没找到 $SERVER_DIR/package.json —— 请确认压缩包解压到了 $APP_ROOT"

# 后端 validate.ts 里对前端 types.ts 是「值导入」（不是 import type），
# 所以运行时真的需要这个文件；这是打包时最容易漏的一环。
[ -f "$APP_ROOT/src/types.ts" ] || die "没找到 $APP_ROOT/src/types.ts —— 后端运行时依赖它，请确认压缩包完整解压（不要只解压 server 目录）"

ok "代码目录：$APP_ROOT"

# ---------------------------------------------------------------------------
step "2/6 定位 Node（要求 ≥ 22.6，因为它内置了 node:sqlite）"
# ---------------------------------------------------------------------------
version_ok() {           # $1 = vX.Y.Z
  local v="${1#v}" major minor
  major="${v%%.*}"
  minor="${v#*.}"
  minor="${minor%%.*}"
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 6 ]; then return 0; fi
  return 1
}

candidates=()
# 宝塔「Node.js 版本管理器」装的 Node 在 /www/server/nodejs/<版本>/bin/，按版本降序
while IFS= read -r p; do
  [ -n "$p" ] && candidates+=("$p")
done < <(for g in /www/server/nodejs/*/bin/node; do [ -x "$g" ] && echo "$g"; done | sort -rV)
# PATH 上的（已激活的 nvm / 系统包等）
while IFS= read -r p; do
  [ -n "$p" ] && candidates+=("$p")
done < <(type -a -p node 2>/dev/null || true)
# 常见固定位置 + nvm 目录
for g in /usr/local/bin/node /usr/bin/node /root/.nvm/versions/node/*/bin/node; do
  [ -x "$g" ] && candidates+=("$g")
done

NODE_BIN=""
if [ "${#candidates[@]}" -gt 0 ]; then
  for cand in "${candidates[@]}"; do
    raw="$("$cand" -v 2>/dev/null || true)"
    case "$raw" in v*) ;; *) continue ;; esac
    if version_ok "$raw"; then NODE_BIN="$cand"; NODE_VER="$raw"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  warn "已扫到的 Node 版本（都不满足要求）："
  if [ "${#candidates[@]}" -gt 0 ]; then
    for cand in "${candidates[@]}"; do
      printf '      %s -> %s\n' "$cand" "$("$cand" -v 2>/dev/null || echo '无法执行')"
    done
  else
    echo "      （一个都没找到）"
  fi
  die "请先安装 Node 22：宝塔面板 →「软件商店」→ 搜「Node.js版本管理器」→ 安装 → 再装 Node 22，然后重新执行本脚本"
fi

ok "Node：$NODE_VER（$NODE_BIN）"

NPM_BIN="$(dirname "$NODE_BIN")/npm"
[ -x "$NPM_BIN" ] || die "在 $(dirname "$NODE_BIN") 下没找到 npm，Node 安装可能不完整"
# 把 node 目录放进 PATH：npm 是带 `#!/usr/bin/env node` 的脚本，
# 不这么做的话在一个没激活 node 的 root shell 里会报 "env: node: No such file or directory"
export PATH="$(dirname "$NODE_BIN"):$PATH"

# node:sqlite 在部分 Node 版本上仍需要显式开关，这里实测而不是猜
SQLITE_FLAG=""
if ! "$NODE_BIN" -e "require('node:sqlite')" >/dev/null 2>&1; then
  if "$NODE_BIN" --experimental-sqlite -e "require('node:sqlite')" >/dev/null 2>&1; then
    SQLITE_FLAG="--experimental-sqlite"
    warn "这个 Node 需要 --experimental-sqlite 才能用内置 SQLite，已自动加上该参数"
  else
    die "这个 Node 无法使用内置 SQLite（node:sqlite），请换成 Node 22.6 以上版本"
  fi
fi
"$NODE_BIN" --experimental-strip-types -e "process.exit(0)" >/dev/null 2>&1 \
  || die "这个 Node 不支持 --experimental-strip-types（直接运行 .ts 需要它），请换成 Node 22.6 以上版本"
ok "node:sqlite 与 TypeScript 直跑均可用（无需构建步骤）"

# ---------------------------------------------------------------------------
step "3/6 安装依赖（走国内镜像，避免卡死）"
# ---------------------------------------------------------------------------
cd "$SERVER_DIR"
info "registry: $NPM_REGISTRY"
"$NPM_BIN" install --omit=dev --registry="$NPM_REGISTRY" --no-audit --no-fund
ok "依赖安装完成（全部是纯 JS，没有任何需要编译的原生模块）"

# ---------------------------------------------------------------------------
step "4/6 生成配置（.env）"
# ---------------------------------------------------------------------------
ENV_FILE="$SERVER_DIR/.env"
mkdir -p "$SERVER_DIR/data"

if [ -f "$ENV_FILE" ]; then
  info ".env 已存在，保持不动（不覆盖你改过的配置）"
else
  SECRET="$("$NODE_BIN" -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))")"
  cat > "$ENV_FILE" <<EOF
# 生产模式:影响日志级别，并在出错时不把内部细节返回给客户端。
# 注意写在这里而不是只写在 systemd 的 Environment= 里 —— 将来改用
# 宝塔「Node 项目」(PM2) 或其他方式托管时，这个值才不会丢。
NODE_ENV=production
PORT=$API_PORT
HOST=127.0.0.1
DATABASE_PATH=./data/cycling.db
JWT_SECRET=$SECRET
SESSION_DAYS=30
COOKIE_SECURE=false
ALLOW_REGISTER=true
TRUST_PROXY=1
AUTH_RATE_LIMIT_MAX=10
EOF
  chmod 600 "$ENV_FILE"
  ok "已生成 .env（JWT_SECRET 为随机生成，权限 600，只有 root 能读）"
  warn "COOKIE_SECURE 暂设为 false —— 因为现在是 http 访问。等备案通过、配上 HTTPS 后要改成 true"
fi

# 老版本生成的 .env 里没有 NODE_ENV（当时靠 systemd 的 Environment= 提供）。
# 这里幂等补齐：否则改用 PM2 / 面板托管后，出错响应会把内部信息泄露给客户端。
if ! grep -q '^NODE_ENV=' "$ENV_FILE" 2>/dev/null; then
  printf 'NODE_ENV=production\n' | cat - "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  [ -n "${RUN_USER:-}" ] && chown "$RUN_USER:$RUN_USER" "$ENV_FILE" 2>/dev/null || true
  ok "已为已有的 .env 补上 NODE_ENV=production（不依赖 systemd 提供）"
fi

# 以 .env 里的 PORT 为准（万一你改过）
ENV_PORT="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r' || true)"
[ -n "${ENV_PORT:-}" ] && API_PORT="$ENV_PORT"

if id "$RUN_USER" >/dev/null 2>&1; then
  chown -R "$RUN_USER:$RUN_USER" "$SERVER_DIR/data"
  chown "$RUN_USER:$RUN_USER" "$ENV_FILE"
  ok "运行用户：$RUN_USER"
else
  warn "系统里没有 $RUN_USER 用户，改用 root 运行"
  RUN_USER="root"
fi

# ---------------------------------------------------------------------------
step "5/6 注册开机自启服务（systemd）"
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$LOG_FILE")"
SVC_FILE="/etc/systemd/system/$SVC_NAME.service"

cat > "$SVC_FILE" <<EOF
[Unit]
Description=Cycling Dashboard API (骑行看板后端)
After=network.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$SERVER_DIR
Environment=NODE_ENV=production
# 用绝对路径调用 node：宝塔装的 Node 不在 systemd 的 PATH 里，写 node 会起不来
ExecStart=$NODE_BIN $SQLITE_FLAG --disable-warning=ExperimentalWarning --experimental-strip-types src/index.ts
Restart=always
RestartSec=3
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SVC_NAME" >/dev/null 2>&1 || true
systemctl restart "$SVC_NAME"
ok "服务已注册并启动：systemctl status $SVC_NAME"

if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null || true)" = "Enforcing" ]; then
  warn "SELinux 处于 Enforcing，可能挡住服务读写数据目录。若启动失败可执行：setenforce 0（宝塔一般已是 permissive）"
fi

# ---------------------------------------------------------------------------
step "6/6 自检"
# ---------------------------------------------------------------------------
sleep 3
if "$NODE_BIN" -e "fetch('http://127.0.0.1:$API_PORT/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  ok "后端已在 127.0.0.1:$API_PORT 正常响应"
else
  printf '\033[31m  ✗ 后端没有响应，最近的日志：\033[0m\n\n'
  journalctl -u "$SVC_NAME" -n 30 --no-pager 2>/dev/null || tail -30 "$LOG_FILE" 2>/dev/null || true
  printf '\n'
  die "启动失败。请把上面这段日志发给我，我来定位"
fi

# ---------------------------------------------------------------------------
cat <<EOF

============================================================================
  后端已就绪 ✓   监听 127.0.0.1:$API_PORT（只对本机开放，由 Nginx 转发对外）
============================================================================

  数据文件：$SERVER_DIR/data/cycling.db
  运行日志：$LOG_FILE          （可用 tail -f $LOG_FILE 实时看）
  常用命令：systemctl restart $SVC_NAME    重启
            systemctl status  $SVC_NAME    看状态
            systemctl stop    $SVC_NAME    停止

  接下来还有 3 步（在宝塔面板里点，不需要命令行）：

  【第 1 步】阿里云控制台 → 该服务器「安全组」→ 入方向放行 8080 端口
             （备案通过后改用 80/443，那时再把 8080 去掉）

  【第 2 步】宝塔面板 →「网站」→ 添加站点
             · 域名填你的域名
             · 根目录填：$APP_ROOT/dist
             · PHP 版本选「纯静态」
             保存后 →「设置」→「配置文件」，把 listen 80; 改成 listen 8080;
             （有两个 listen 行连同 IPv6 那行一起改），保存

  【第 3 步】同一个站点 →「设置」→「反向代理」→ 添加反向代理
             · 代理名称：api
             · 目标 URL：http://127.0.0.1:$API_PORT
             · 发送域名：\$host
             · 代理目录：/api
             保存

  然后浏览器打开 http://你的服务器IP:8080 就能用了。
  第一次进去先「注册」，注册完自己的账号后可以把 .env 里的
  ALLOW_REGISTER 改成 false 锁死注册入口（改完 systemctl restart $SVC_NAME）。

  提醒：现在还是 http，所以 PWA 的离线能力用不了（浏览器只在 HTTPS 下允许
  Service Worker）。等 ICP 备案通过后，在这个站点上「SSL → Let's Encrypt」
  一键申请证书，再把 .env 的 COOKIE_SECURE 改成 true、重启服务即可。
============================================================================
EOF
