# 部署指南

游戏本体是纯静态站点，龙虎榜需要一个 Node 进程（内置 SQLite，**零 npm 依赖、无构建步骤**）。推荐方案：Linux 服务器 + systemd 常驻 + nginx 反代 + HTTPS，全程约 10 分钟。

## 0. 前置要求

- 一台服务器：1 核 1G 起步足够（静态文件 + SQLite，非常轻）
- **Node.js ≥ 22.5**（龙虎榜依赖内置的 `node:sqlite`；`node -v` 检查）
- 可选：一个域名（用 IP 直连也能玩）

## 1. 上传代码

```bash
# 本地执行（排除测试与文档也行，保留 tools/ 是关键）
scp -r ./Forextale user@你的服务器IP:/opt/forextale
```

需要的关键文件：`index.html`、`styles.css`、`src/`、`tools/server.mjs`、`tools/db.mjs`、`sw.js`、`manifest.webmanifest`、`icons/`。

## 2. 服务器安装 Node 22+（已有可跳过）

```bash
# Debian/Ubuntu（NodeSource 源）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 应 ≥ v22.5
```

CentOS/RHEL 把 `apt-get` 换成 `yum`，或用 [nvm](https://github.com/nvm-sh/nvm) 装多版本。

## 3. 试运行

```bash
cd /opt/forextale
node tools/server.mjs
# 输出「汇市物语（含龙虎榜）」即成功，Ctrl+C 退出
```

环境变量：`PORT`（默认 8123）、`HOST`（默认 0.0.0.0，生产建议 127.0.0.1）、`DB`（SQLite 路径，默认 `data/forextale.db`）。

## 4. 常驻运行（systemd，推荐）

创建 `/etc/systemd/system/forextale.service`：

```ini
[Unit]
Description=Forextale 汇市物语
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/forextale
ExecStart=/usr/bin/node tools/server.mjs
Environment=PORT=8123
Environment=HOST=127.0.0.1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now forextale
systemctl status forextale   # 应为 active (running)
```

> 宝塔 / 1Panel 用户：在「Node 项目」里把启动文件指向 `tools/server.mjs` 即可，效果相同。

## 5. nginx 反向代理 + HTTPS

`/etc/nginx/conf.d/forextale.conf`：

```nginx
server {
    listen 80;
    server_name game.example.com;   # 换成你的域名或注释掉用 IP

    location / {
        proxy_pass http://127.0.0.1:8123;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo nginx -t && sudo nginx -s reload
# HTTPS（强烈建议：PWA 离线缓存只在 HTTPS/localhost 下生效）
sudo certbot --nginx -d game.example.com
```

## 6. 防火墙 / 安全组

- 云控制台安全组放行 **80 / 443**；
- `HOST=127.0.0.1` 时 8123 端口只对内，**无需**对外放行（这是推荐配置）。

## 7. 更新与备份

```bash
# 更新代码：覆盖文件后重启即可，无需任何安装步骤
sudo systemctl restart forextale

# 备份数据库（所有玩家注册信息与战绩都在这一个文件里）
cp /opt/forextale/data/forextale.db ~/backup/forextale-$(date +%F).db
```

每日自动备份的 crontab 示例：`0 4 * * * cp /opt/forextale/data/forextale.db ~/backup/forextale-$(date +\%F).db`

## 8. 常见问题

| 问题 | 处理 |
|---|---|
| 服务器 Node < 22.5 | 升级 Node；或临时用 `node tools/serve.mjs`（纯静态，游戏可玩、龙虎榜提示未启用） |
| Windows 服务器 | 同样 `node tools/server.mjs`，用 计划任务 / nssm 守护进程 |
| 端口被占用 | `PORT=9000 node tools/server.mjs` |
| 榜单数据想清零 | 停服务 → 删 `data/forextale.db` → 重启 |
| 想上线前先本地试 | 本机 `npm start` 即与线上一致 |

## 9. 已知的安全边界

- 龙虎榜成绩由客户端自报（服务端有数值范围校验与 1.5 秒限流），休闲自榜机制，防不了作弊，仅供娱乐；
- 昵称做了字符白名单 + 长度截断，数据库全程预编译语句，前端渲染昵称走 `textContent`，无 XSS/注入面；
- 若要公网开放，建议再加一层 nginx 限流（`limit_req`）兜底。
