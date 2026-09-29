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

## 10. 自动部署（GitHub → 服务器）

工作流 `.github/workflows/deploy.yml` 已内置：push 到 `main` → 自动跑测试 → rsync 同步代码到服务器 → 重启服务（约 30 秒上线）。玩家数据库 `data/forextale.db` 永远不会被部署覆盖。

下面是零基础全流程。约定：`user` = 你登录服务器的用户名，`你的服务器IP` = 服务器地址。全程在 **Windows PowerShell** 中执行（Linux/Mac 把安装公钥那条换成 `ssh-copy-id -i deploy_key.pub user@IP` 即可）。

### 第 1 步：生成一对部署密钥

```powershell
cd D:\Code\Forextale        # 或任何你想放密钥的目录
ssh-keygen -t ed25519 -C "forextale-deploy" -f deploy_key
```

一路回车（不设密码）。完成后目录里多出两个文件：

| 文件 | 是什么 | 去向 |
|---|---|---|
| `deploy_key.pub` | 公钥（锁） | 装到服务器上（第 2 步） |
| `deploy_key` | 私钥（钥匙） | 内容粘进 GitHub（第 4 步），文件本体建议移到 `C:\Users\你的用户名\.ssh\` 保管 |

> 不小心给密钥设了密码？CI 无法输入密码会部署失败。用 `ssh-keygen -p -f .\deploy_key` 移除（旧密码 → 新密码两次直接回车），然后**重新复制私钥粘进 GitHub Secret**；公钥不变，服务器无需任何改动。

### 第 2 步：把公钥装上服务器

```powershell
Get-Content .\deploy_key.pub | ssh user@你的服务器IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

这条命令会**最后输一次服务器密码**（以后就不再需要了）。装完立即验证：

```powershell
ssh -i .\deploy_key user@你的服务器IP "echo 免密登录成功"
```

输出「免密登录成功」且**没有要求密码** = 成功。若仍要求密码：检查服务器上 `~/.ssh` 权限是否 700、`authorized_keys` 是否 600、用户名有没有写错。

### 第 3 步：服务器收尾（rsync + 免密重启权限）

```powershell
ssh -i .\deploy_key user@你的服务器IP
# —— 进入服务器后执行：——
sudo apt install -y rsync
echo "user ALL=(root) NOPASSWD: /usr/bin/systemctl restart forextale" | sudo tee /etc/sudoers.d/forextale-deploy
sudo chmod 440 /etc/sudoers.d/forextale-deploy
exit
```

说明：sudoers 命令里的 `user` 要改成**第 2 步 ssh 命令里用的那个用户名**（两处）；若你直接用 root 登录服务器，这一步整个跳过。这条规则只放行「重启 forextale 服务」一条命令，CI 拿着密钥也做不了别的事。

### 第 4 步：把三个秘密配置进 GitHub

先把私钥内容复制到剪贴板：

```powershell
Get-Content .\deploy_key | Set-Clipboard
```

打开浏览器：`github.com/你的GitHub用户名/forextale` → **Settings** → 左侧 **Secrets and variables** → **Actions** → 绿色按钮 **New repository secret**，依次添加三条（每条填 Name 和 Value 后点 Add secret）：

| Name（原样填写，含下划线） | Value |
|---|---|
| `SSH_PRIVATE_KEY` | 刚才剪贴板里的私钥全文（包含 `-----BEGIN` 和 `-----END` 两行） |
| `SERVER_HOST` | 服务器 IP（如 `123.45.67.89`）或域名 |
| `SERVER_USER` | 第 2 步 ssh 命令里用的用户名 |

### 第 5 步：创建 GitHub 仓库并首推

1. 打开 `github.com/new` → Repository name 填 `forextale` → 选 **Private** → **不要勾选**任何初始化选项（README、.gitignore 都不勾）→ Create repository；
2. 回到 PowerShell：

```powershell
cd D:\Code\Forextale
git config --global user.name "你的名字"      # 本机首次使用 git 才需要这两行
git config --global user.email "你的邮箱"
git branch -M main
git remote add origin https://github.com/你的GitHub用户名/forextale.git
git push -u origin main
```

（本目录已 `git init` 并有提交，直接推即可。）

### 第 6 步：验证自动部署

1. 推送后打开仓库的 **Actions** 标签页，会看到一次 `Deploy` 运行，点进去看日志：测试全绿 → rsync 文件清单 → `systemctl restart` → `active`；
2. 浏览器打开 `http://你的服务器IP`（或你的域名）——已经是最新版本；
3. 之后的日常就是：改代码 → `git add .` → `git commit -m "说明"` → `git push`，30 秒后线上生效。

### 排错对照表（对照 Actions 日志）

| 报错 | 原因与处理 |
|---|---|
| `Permission denied (publickey)` | 公钥没装对：重做第 2 步；或 `SERVER_USER` 与第 2 步的用户名不一致 |
| 读私钥时报 `invalid format` | 私钥混入了 Windows 换行符——工作流已自动容错，仍报错就重新复制私钥全文（勿手动增删行） |
| `sudo: a password is required` | 第 3 步 sudoers 里的用户名和 `SERVER_USER` 不一致 |
| `rsync: command not found` | 服务器没装 rsync：`sudo apt install -y rsync` |
| `Connection timed out` | 云安全组/防火墙没放行 22 端口 |
| 测试没过、部署被跳过 | 本地先跑 `node tests/smoke.mjs`，修完再推 |

> 提醒：`data/forextale.db`（玩家数据）在同步排除名单里，部署永不覆盖；`.gitignore` 也保证它不会被推上 GitHub。

