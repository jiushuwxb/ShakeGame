# 摇一摇活动前后端部署文档

本文档对应以下两个项目：

- 前端静态站点：`D:\study_project\shake-fronted`
- 后端 Node.js 服务：`D:\study_project\shake-backend`

适用场景：

- 手机端 H5：`/user/index.html`
- 大屏端 H5：`/screen/index.html`
- 后端 API + WebSocket：Node.js + Express + ws

推荐部署方式：

- 前端：Nginx 直接托管静态文件
- 后端：Node.js + PM2 常驻
- 反向代理：Nginx 负责 HTTPS、域名转发、WebSocket Upgrade

## 1. 当前项目关键结论

后端真实比赛时长由服务端环境变量控制，不是前端决定：

- 配置位置：[src/server.js](D:/study_project/shake-backend/src/server.js:15)
- 配置名：`GAME_DURATION_SECONDS`
- 当前 `.env.example` 默认值：`30`

其他关键配置：

- 服务端端口：`PORT`，默认 `3000`
- 最大人数：`MAX_PLAYERS`，默认 `10`
- 管理口令：`ADMIN_TOKEN`
- 微信网页授权：`WECHAT_APP_ID`、`WECHAT_APP_SECRET`

## 2. 推荐域名规划

建议至少准备两个 HTTPS 域名：

- H5 前端域名：`https://www.example.com`
- 后端接口域名：`https://api.example.com`

也可以只用一个域名，但当前代码结构更适合前后端分域部署。

对应关系建议：

- `https://www.example.com/user/index.html`
- `https://www.example.com/user/game.html`
- `https://www.example.com/screen/index.html`
- `https://api.example.com/health`
- `wss://api.example.com`

## 3. 服务器环境要求

- Linux 服务器一台
- Node.js 18+
- npm 9+
- Nginx 1.18+
- PM2
- 有效 HTTPS 证书

安装示例：

```bash
sudo apt update
sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

检查版本：

```bash
node -v
npm -v
pm2 -v
nginx -v
```

## 4. 目录建议

建议目录结构：

```text
/data/www/shake-fronted
/data/www/shake-backend
```

例如：

```bash
sudo mkdir -p /data/www
sudo chown -R $USER:$USER /data/www
```

上传或拉取代码后结构建议：

```text
/data/www/shake-fronted/user
/data/www/shake-fronted/screen
/data/www/shake-backend/src
```

## 5. 后端部署

### 5.1 安装依赖

进入后端目录：

```bash
cd /data/www/shake-backend
npm ci
```

如果没有 `package-lock.json`，可用：

```bash
npm install
```

### 5.2 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

建议 `.env` 内容如下：

```env
PORT=3000
PUBLIC_BASE_URL=https://api.example.com
FRONTEND_BASE_URL=https://www.example.com
CORS_ORIGIN=https://www.example.com

GAME_DURATION_SECONDS=30
MAX_PLAYERS=10
QUESTIONNAIRE_URL=https://www.wjx.cn/vm/your-questionnaire.aspx
ADMIN_TOKEN=change-me

WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_OAUTH_SCOPE=snsapi_userinfo
```

说明：

- `PUBLIC_BASE_URL` 必须是后端公网 HTTPS 地址
- `FRONTEND_BASE_URL` 必须是前端公网地址
- `CORS_ORIGIN` 至少包含前端域名
- `GAME_DURATION_SECONDS=30` 表示比赛 30 秒
- 如果暂时不做微信授权，可保留 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 为空

### 5.3 本地验证后端

启动：

```bash
npm start
```

验证接口：

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/config
```

预期：

- `/health` 返回 `ok: true`
- `/api/config` 中 `gameDurationSeconds` 应为 `30`

### 5.4 使用 PM2 托管

推荐命令：

```bash
cd /data/www/shake-backend
pm2 start src/server.js --name shake-backend
pm2 save
pm2 startup
```

常用命令：

```bash
pm2 list
pm2 logs shake-backend
pm2 restart shake-backend
pm2 reload shake-backend
pm2 stop shake-backend
```

如果你习惯通过 npm 启动，也可以：

```bash
pm2 start npm --name shake-backend -- start
```

## 6. 前端部署

### 6.1 前端项目特点

前端项目是纯静态页面，没有打包步骤，直接部署文件即可。

需要部署的目录：

- `user/`
- `screen/`

### 6.2 修改前端配置

需要修改两个文件：

- [user/config.js](D:/study_project/shake-fronted/user/config.js:1)
- [screen/config.js](D:/study_project/shake-fronted/screen/config.js:1)

建议改成：

```js
window.SHAKE_CONFIG = {
  apiBaseUrl: 'https://api.example.com',
  wsUrl: 'wss://api.example.com',
  questionnaireUrl: 'https://www.wjx.cn/vm/your-questionnaire.aspx',
  activityTitle: '希捷极速传输挑战赛',
  brandLine: 'Seagate Data Transfer Challenge'
};
```

说明：

- `apiBaseUrl` 必须指向后端 HTTPS 域名
- `wsUrl` 必须指向后端 WSS 域名
- 前后端要一致，不要一个改了一个没改

### 6.3 上传前端静态文件

把前端项目部署到：

```text
/data/www/shake-fronted
```

最终目录示例：

```text
/data/www/shake-fronted/user/index.html
/data/www/shake-fronted/user/game.html
/data/www/shake-fronted/screen/index.html
```

## 7. Nginx 配置

### 7.1 前端静态站点配置

文件示例：`/etc/nginx/conf.d/shake-frontend.conf`

```nginx
server {
    listen 80;
    server_name www.example.com;

    root /data/www/shake-fronted;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

如果前端只访问 `/user/` 和 `/screen/`，这个配置就够用。

### 7.2 后端 API + WebSocket 反向代理

文件示例：`/etc/nginx/conf.d/shake-api.conf`

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

说明：

- 这份配置同时支持 HTTP API 和 WebSocket
- `Upgrade` / `Connection` 头必须保留，否则实时榜单会断

### 7.3 重载 Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS 证书

建议使用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d www.example.com -d api.example.com
```

证书签发完成后：

- 前端走 `https://`
- WebSocket 走 `wss://`
- 微信网页授权也必须是 HTTPS

## 9. 微信授权部署说明

如果需要启用微信授权，必须同时满足：

1. `.env` 配置了 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`
2. 微信公众平台配置了网页授权域名
3. `PUBLIC_BASE_URL` 与微信配置域名一致
4. `/api/wechat/callback` 能被微信回调访问
5. 前端页面使用 HTTPS

当前你们前端里已经有一部分逻辑被改成本地玩家/手机号优先展示。如果正式恢复微信授权，建议先确认前端是否需要重新启用授权流程。

## 10. 上线验收清单

### 10.1 后端验收

打开：

- `https://api.example.com/health`
- `https://api.example.com/api/config`

确认：

- 返回正常 JSON
- `gameDurationSeconds` 为 `30`
- `maxPlayers` 为 `10`

### 10.2 手机端验收

打开：

- `https://www.example.com/user/index.html`

确认：

- 页面资源加载正常
- 能进入 `game.html`
- 手机端能连上 WebSocket
- URL 带 `phone=185****1239` 时，显示名优先显示脱敏手机号

### 10.3 大屏端验收

打开：

- `https://www.example.com/screen/index.html?adminToken=你的口令`

确认：

- 大屏能显示准备页和二维码
- 点击开始后有 3 2 1 GO 倒计时
- 比赛开始时播放 `assets/gamemusic.mp3`
- 比赛结束时音乐停止
- 玩家昵称/手机号显示正常

### 10.4 实时联通验收

完整走一遍：

1. 手机端进入房间
2. 大屏看到玩家加入
3. 大屏点击开始
4. 倒计时结束后正式开始比赛
5. 手机摇动时大屏柱状图实时增长
6. 30 秒后自动结束
7. 大屏显示结算榜单

## 11. 常见运维命令

### PM2

```bash
pm2 list
pm2 logs shake-backend
pm2 restart shake-backend
pm2 reload shake-backend
pm2 stop shake-backend
pm2 delete shake-backend
```

### Nginx

```bash
sudo nginx -t
sudo systemctl status nginx
sudo systemctl reload nginx
sudo systemctl restart nginx
```

### 端口检查

```bash
ss -lntp | grep 3000
curl http://127.0.0.1:3000/health
```

## 12. 发布更新流程

### 后端更新

```bash
cd /data/www/shake-backend
git pull
npm ci
pm2 restart shake-backend
pm2 logs shake-backend
```

### 前端更新

```bash
cd /data/www/shake-fronted
git pull
```

如果浏览器有缓存：

- 更新 `user/index.html`、`screen/index.html` 中静态资源版本号
- 或在 Nginx 上加缓存控制

## 13. 这次项目最容易漏掉的点

- 前端 `user/config.js` 和 `screen/config.js` 必须同时改
- 后端 `.env` 的 `PUBLIC_BASE_URL` 必须是公网 HTTPS 地址
- `wsUrl` 必须写 `wss://`，不能写 `https://`
- Nginx 必须配置 WebSocket Upgrade
- 真实比赛时长在后端 `.env` 的 `GAME_DURATION_SECONDS`
- 微信授权必须走 HTTPS 且域名配置正确

## 14. 建议的生产参数

推荐直接使用：

```env
PORT=3000
PUBLIC_BASE_URL=https://api.example.com
FRONTEND_BASE_URL=https://www.example.com
CORS_ORIGIN=https://www.example.com
GAME_DURATION_SECONDS=30
MAX_PLAYERS=10
QUESTIONNAIRE_URL=https://www.wjx.cn/vm/your-questionnaire.aspx
ADMIN_TOKEN=change-me
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_OAUTH_SCOPE=snsapi_userinfo
```

如果你后续确定真实域名，我可以继续把这份文档里的 `example.com` 全部替换成你们的正式域名，并顺手给你出一份可直接复制的 Nginx 配置文件。*** End Patch
