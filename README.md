# 希捷摇一摇互动游戏后端

Node.js + WebSocket 后端，负责微信网页授权、玩家接入、摇动次数接收、活动状态控制和实时广播。

## 启动

```bash
npm install
copy .env.example .env
npm start
```

默认监听 `3000` 端口。

## 配置

- `PUBLIC_BASE_URL`: 后端公网地址，例如 `https://api.example.com`。
- `FRONTEND_BASE_URL`: 手机端 H5 地址，例如 `https://h5.example.com`。
- `CORS_ORIGIN`: 允许访问后端的前端域名，多个域名用英文逗号分隔。
- `QUESTIONNAIRE_URL`: 游戏结束后跳转的问卷星链接。
- `ADMIN_TOKEN`: 大屏端开始、结束、重置活动使用的管理口令。
- `WECHAT_APP_ID` / `WECHAT_APP_SECRET`: 微信公众号网页授权配置。
- `WECHAT_OAUTH_SCOPE`: 默认 `snsapi_userinfo`，用于获取头像昵称。

## 接口

- `GET /health`: 健康检查。
- `GET /api/config`: 前端运行配置。
- `GET /api/wechat/authorize-url?redirectUri=...`: 生成微信授权链接。
- `GET /api/wechat/callback`: 微信 OAuth 回调，自动带 `code` 跳回 H5。
- `GET /api/wechat/user?code=...`: 通过 code 获取微信头像昵称。
- `POST /api/admin/start`: 开始 60 秒游戏。
- `POST /api/admin/end`: 结束游戏。
- `POST /api/admin/reset`: 重置活动并清零分数，已连接玩家保留。

## WebSocket 消息

- 手机端加入：`{"type":"join_player","player":{"id":"可选","nickname":"昵称","avatar":"头像"}}`
- 大屏端加入：`{"type":"join_screen"}`
- 摇动上报：`{"type":"shake","delta":1}`
- 大屏控制：`{"type":"admin_start","token":"管理口令"}`、`admin_end`、`admin_reset`
- 服务端广播：`{"type":"snapshot","data":{...}}`

## 微信配置

1. 公众号后台配置网页授权域名，域名必须与 `PUBLIC_BASE_URL` 的域名一致。
2. 服务器部署时必须使用 HTTPS。
3. 将 OAuth 回调路径配置为后端的 `/api/wechat/callback`。
4. 手机端进入 H5 后，如果没有本地用户信息，会自动获取授权链接并跳转微信授权。

## 现场操作

1. 启动后端：`npm start`。
2. 部署前端静态文件到 H5 域名。
3. 打开大屏页 `/screen.html?adminToken=你的口令`。
4. 手机扫码进入 `/index.html`，完成微信授权后等待开始。
5. 大屏点击“开始比赛”，60 秒后自动结束并展示排名。
6. 点击“重置活动”可清零分数并进入下一轮，已连接玩家无需重新扫码。
