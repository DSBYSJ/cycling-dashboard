#!/usr/bin/env bash
# ============================================================================
# 骑行看板 · 宝塔 Node 项目配置合并脚本（幂等，可重复执行）
#
# 背景：宝塔「Node 项目 → 域名管理/外网映射」会生成
#       /www/server/panel/vhost/nginx/node_cycling-dashboard.conf，
#       默认把【整个站点】反代到 Node 3000。但骑行看板前端是静态文件
#       （dist/），只有 /api 走 Node —— 不改造的话首页直接 404。
#
# 本脚本做两件事，各自独立幂等（缺哪步补哪步，已完成的跳过）：
#
#   ① 静态前端 + /api 反代 —— 把「整站反代」改成「静态 dist + /api 反代」，
#      并加 listen 8080、/assets 长缓存、sw.js 不缓存。
#      幂等标记：「骑行看板前端是静态文件」
#
#   ② 域名强制 HTTPS —— http 访问域名时 301 跳 https。
#      要点：宝塔把 80/443/8080 放在**同一个 server 块**里，所以必须按
#      `$server_port` 判断，否则 443 请求也会被 301 → 无限重定向。
#      另外排除 IP（无证书，跳了会报证书错误）与 .well-known（Let's Encrypt 续期）。
#      幂等标记：「域名强制 HTTPS」
#
# 用法（服务器上以 root 执行）：
#     bash server/scripts/panel-merge-site.sh            # 正式执行
#     bash server/scripts/panel-merge-site.sh --dry-run  # 只预览，不落盘
#
# 什么时候需要重跑：
#   · 在面板「域名管理」里增删域名后（面板会重写配置，把上面的改动冲掉）
#   · 首页突然 404 / 出现无限重定向 / nginx 报 duplicate location 时
# ============================================================================

set -euo pipefail

CONF="/www/server/panel/vhost/nginx/node_cycling-dashboard.conf"
BACKUP_DIR="/www/backup/cycling-dashboard/nginx-confs"
NGINX_BIN=/www/server/nginx/sbin/nginx
SERVER_IP="47.107.38.255"
STAMP="$(date +%Y%m%d-%H%M%S)"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

log()  { echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ⚠ $*"; }
die()  { echo "  ✗ $*" >&2; exit 1; }

[ -f "$CONF" ] || die "找不到 $CONF —— Node 项目还没在面板里绑定域名？"

# ---- 两步各自判断是否需要处理 ----------------------------------------------
NEED_STATIC=0; grep -q "骑行看板前端是静态文件" "$CONF" || NEED_STATIC=1
NEED_HTTPS=0;  grep -q "域名强制 HTTPS"          "$CONF" || NEED_HTTPS=1

if [ "$NEED_STATIC" = "0" ] && [ "$NEED_HTTPS" = "0" ]; then
  log "两步改造都已完成，无需处理"
  exit 0
fi
[ "$NEED_STATIC" = "1" ] && log "检测到：①「静态前端 + /api 反代」缺失"
[ "$NEED_HTTPS" = "1" ]  && log "检测到：②「域名强制 HTTPS」缺失"

log "1/3 备份原配置"
if [ "$DRY" = "0" ]; then
  mkdir -p "$BACKUP_DIR"
  cp "$CONF" "$BACKUP_DIR/node_cycling-dashboard.conf.$STAMP"
fi
ok "备份到 $BACKUP_DIR/"

log "2/3 注入缺失的规则"
NEW_BLOCK='    # HTTP反向代理相关配置开始 >>>
    # （改造说明：骑行看板前端是静态文件，只有 /api 走 Node。
    #   宝塔默认把整个站点反代到 Node，会导致首页 404 —— 这里改成「静态 + /api 反代」。）

    # 静态前端（SPA + hash 路由，未命中的路径回落 index.html）
    location / {
        root  /www/wwwroot/cycling-dashboard/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端接口走 Node（与前端同源，Cookie 正常携带；登录限流靠 X-Forwarded-For 取真实 IP）
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout 60s;
        proxy_send_timeout 30s;
    }

    # vite 构建产物文件名带内容哈希，可长期缓存
    location /assets/ {
        root  /www/wwwroot/cycling-dashboard/dist;
        expires 30d;
        try_files $uri =404;
    }

    # Service Worker 与注册脚本绝不能缓存，否则新版本推不下去
    location = /sw.js {
        root  /www/wwwroot/cycling-dashboard/dist;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    location = /registerSW.js {
        root  /www/wwwroot/cycling-dashboard/dist;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    # HTTP反向代理相关配置结束 <<<'

if [ "$DRY" = "0" ]; then
  python3 - "$CONF" "$NEW_BLOCK" "$NEED_STATIC" "$NEED_HTTPS" "$SERVER_IP" <<'PYEOF' || die "注入失败"
import re
import sys
import pathlib

conf = pathlib.Path(sys.argv[1])
new_block = sys.argv[2]
need_static = sys.argv[3] == '1'
need_https = sys.argv[4] == '1'
server_ip = sys.argv[5]

s = conf.read_text(encoding='utf-8')

# ---- ① 静态前端 + /api 反代 ----
if need_static:
    if 'listen 8080' not in s:
        s = s.replace('listen 80;', 'listen 80;\n    listen 8080;', 1)
    start = s.find('    # HTTP反向代理相关配置开始 >>>')
    end = s.find('    # HTTP反向代理相关配置结束 <<<')
    if start == -1 or end == -1:
        sys.exit('未找到反代配置块标记（面板可能改了模板），请人工检查')
    end += len('    # HTTP反向代理相关配置结束 <<<')
    s = s[:start] + new_block + s[end:]
    print('  ✓ 已注入「静态前端 + /api 反代」')

# ---- ② 域名强制 HTTPS ----
if need_https:
    # 注意：80/443/8080 在同一个 server 块里，必须按端口判断，
    # 否则 443 的请求也会命中 301 → 无限重定向。
    https_block = f'''    # 域名强制 HTTPS（仅 80 端口进入才跳转；IP 无证书保持 http、8080 备用端口不动；
    # 排除 .well-known，免得 Let's Encrypt 续期验证被 301 打断）
    set $icp_force_https 0;
    if ($server_port = 80) {{ set $icp_force_https 1; }}
    if ($host = {server_ip}) {{ set $icp_force_https 0; }}
    if ($request_uri ~ ^/\\.well-known/) {{ set $icp_force_https 0; }}
    if ($icp_force_https = 1) {{ return 301 https://$host$request_uri; }}
'''
    m = re.search(r'^[ \t]*server_name[ \t]+[^;]+;[ \t]*$', s, re.M)
    if not m:
        sys.exit('未找到 server_name 行，无法插入 HTTPS 跳转规则')
    s = s[:m.end()] + '\n\n' + https_block + s[m.end():]
    print('  ✓ 已注入「域名强制 HTTPS」')

conf.write_text(s, encoding='utf-8')
PYEOF
else
  echo "  [dry-run] 将注入缺失的规则块"
fi

log "3/3 nginx 语法检查（不通过自动回滚）→ 重载"
if ! "$NGINX_BIN" -t >/dev/null 2>&1; then
  "$NGINX_BIN" -t 2>&1 | sed 's/^/    /'
  if [ "$DRY" = "0" ]; then
    cp "$BACKUP_DIR/node_cycling-dashboard.conf.$STAMP" "$CONF"
    warn "已回滚"
  fi
  die "语法错误"
fi
ok "语法 OK"

if [ "$DRY" = "0" ]; then
  "$NGINX_BIN" -s reload && ok "已重载（reload 后旧 worker 短暂残留，立即测试可能拿到旧响应，等 2-3 秒再验）"
else
  echo "  [dry-run] 将执行 nginx -s reload"
fi

echo
echo "完成。自测命令（在服务器上执行）："
echo "  # 首页应 200 且标题是前端"
echo "  curl -s -H 'Host: dsbysj.cn' http://127.0.0.1/ | grep -o '<title>[^<]*</title>'"
echo "  # 接口应 ok"
echo "  curl -s -H 'Host: dsbysj.cn' http://127.0.0.1/api/health"
echo "  # http 访问域名应 301 到 https"
echo "  curl -sI -H 'Host: dsbysj.cn' http://127.0.0.1/ | head -1"
echo "  # http 访问 IP 应仍是 200（不跳）"
echo "  curl -sI -H 'Host: 47.107.38.255' http://127.0.0.1/ | head -1"
