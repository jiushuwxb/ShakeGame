const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.PORT || 3000);
const GAME_DURATION_MS = Number(process.env.GAME_DURATION_SECONDS || 15) * 1000;
const MAX_PLAYERS = Number.MAX_SAFE_INTEGER;
const LEADERBOARD_LIMIT = 10;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PUBLIC_BASE_URL = trimSlash(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`);
const FRONTEND_BASE_URL = trimSlash(process.env.FRONTEND_BASE_URL || 'http://localhost:5173');
const QUESTIONNAIRE_URL = process.env.QUESTIONNAIRE_URL || 'https://www.wjx.cn/';
const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const WECHAT_OAUTH_SCOPE = process.env.WECHAT_OAUTH_SCOPE || 'snsapi_userinfo';

const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((item) => item.trim()) : true;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

const game = {
  status: 'waiting',
  durationMs: GAME_DURATION_MS,
  startedAt: null,
  endsAt: null,
  players: new Map(),
};

const clients = new Map();
let endTimer = null;

app.get('/health', (req, res) => {
  res.json({ ok: true, status: game.status, players: game.players.size });
});

app.get('/api/config', (req, res) => {
  res.json({
    wsUrl: toWsUrl(PUBLIC_BASE_URL),
    questionnaireUrl: QUESTIONNAIRE_URL,
    gameDurationSeconds: Math.round(GAME_DURATION_MS / 1000),
    leaderboardLimit: LEADERBOARD_LIMIT,
  });
});

app.get('/api/wechat/authorize-url', (req, res) => {
  const redirectUri = req.query.redirectUri || `${FRONTEND_BASE_URL}/`;

  console.log('[wechat authorize-url] request', {
    redirectUri,
    host: req.headers.host,
    origin: req.headers.origin,
    referer: req.headers.referer,
    userAgent: req.headers['user-agent'],
    publicBaseUrl: PUBLIC_BASE_URL,
    frontendBaseUrl: FRONTEND_BASE_URL,
    hasWechatAppId: Boolean(WECHAT_APP_ID),
  });

  if (!WECHAT_APP_ID) {
    console.log('[wechat authorize-url] missing app id');
    return res.status(501).json({ error: 'WECHAT_APP_ID is not configured.' });
  }

  const callbackUrl = `${PUBLIC_BASE_URL}/api/wechat/callback?redirectUri=${encodeURIComponent(redirectUri)}`;
  const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  url.searchParams.set('appid', WECHAT_APP_ID);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', WECHAT_OAUTH_SCOPE);
  url.searchParams.set('state', 'shake');

  console.log('[wechat authorize-url] response', {
    callbackUrl,
    url: `${url.toString()}#wechat_redirect`,
  });
  res.json({ url: `${url.toString()}#wechat_redirect` });
});

app.get('/api/wechat/callback', (req, res) => {
  const redirectUri = req.query.redirectUri || `${FRONTEND_BASE_URL}/`;
  const code = req.query.code;
  const target = new URL(redirectUri);

  console.log('[wechat callback] request', {
    redirectUri,
    code,
    state: req.query.state,
    host: req.headers.host,
    userAgent: req.headers['user-agent'],
  });

  if (code) target.searchParams.set('code', code);
  if (req.query.state) target.searchParams.set('state', req.query.state);

  console.log('[wechat callback] redirect', { target: target.toString() });
  res.redirect(target.toString());
});

app.get('/api/wechat/user', async (req, res) => {
  const code = req.query.code;

  console.log('[wechat user] request', {
    code,
    host: req.headers.host,
    userAgent: req.headers['user-agent'],
    hasWechatAppId: Boolean(WECHAT_APP_ID),
    hasWechatSecret: Boolean(WECHAT_APP_SECRET),
  });

  if (!code) return res.status(400).json({ error: 'Missing code.' });
  if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
    console.log('[wechat user] oauth not configured');
    return res.status(501).json({ error: 'WeChat OAuth is not configured.' });
  }

  try {
    const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    tokenUrl.searchParams.set('appid', WECHAT_APP_ID);
    tokenUrl.searchParams.set('secret', WECHAT_APP_SECRET);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');

      const tokenResponse = await fetchJson(tokenUrl);
      console.log('[wechat user] token response', tokenResponse);
      if (tokenResponse.errcode) return res.status(502).json(tokenResponse);

    const userUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
    userUrl.searchParams.set('access_token', tokenResponse.access_token);
    userUrl.searchParams.set('openid', tokenResponse.openid);
    userUrl.searchParams.set('lang', 'zh_CN');

      const userResponse = await fetchJson(userUrl);
      console.log('[wechat user] user response', userResponse);
      if (userResponse.errcode) return res.status(502).json(userResponse);

      const normalizedUser = normalizeWechatUser(userResponse);
      console.log('[wechat user] normalized response', normalizedUser);
      res.json(normalizedUser);
    } catch (error) {
      console.error('[wechat user] error', error);
      res.status(502).json({ error: 'Failed to request WeChat API.', detail: error.message });
    }
  });

app.post('/api/admin/start', requireAdmin, (req, res) => {
  startGame();
  res.json(snapshot());
});

app.post('/api/admin/end', requireAdmin, (req, res) => {
  endGame();
  res.json(snapshot());
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  resetGame();
  res.json(snapshot());
});

wss.on('connection', (ws) => {
  const clientId = makeId();
  clients.set(clientId, { ws, role: 'unknown', playerId: null });

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      send(ws, { type: 'error', error: 'Invalid JSON message.' });
      return;
    }

    handleMessage(clientId, message);
  });

  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client?.playerId) {
      const player = game.players.get(client.playerId);
      if (player) player.online = false;
    }
    clients.delete(clientId);
    broadcastSnapshot();
  });

  send(ws, { type: 'hello', clientId });
  send(ws, { type: 'snapshot', data: snapshot() });
});

function handleMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  if (message.type === 'join_screen') {
    client.role = 'screen';
    send(client.ws, { type: 'snapshot', data: snapshot() });
    return;
  }

  if (message.type === 'join_player') {
    joinPlayer(client, message.player || {});
    return;
  }

  if (message.type === 'shake') {
    recordShake(client, message);
    return;
  }

  if (message.type === 'admin_start') {
    if (!isAdminMessage(message)) return send(client.ws, { type: 'error', error: 'Invalid admin token.' });
    startGame();
    return;
  }

  if (message.type === 'admin_end') {
    if (!isAdminMessage(message)) return send(client.ws, { type: 'error', error: 'Invalid admin token.' });
    endGame();
    return;
  }

  if (message.type === 'admin_reset') {
    if (!isAdminMessage(message)) return send(client.ws, { type: 'error', error: 'Invalid admin token.' });
    resetGame();
    return;
  }

  send(client.ws, { type: 'error', error: `Unknown message type: ${message.type}` });
}

function joinPlayer(client, profile) {
  const requestedId = typeof profile.id === 'string' ? sanitizeId(profile.id) : '';
  let playerId = requestedId || makeId(10);

  if (!game.players.has(playerId) && game.players.size >= MAX_PLAYERS) {
    send(client.ws, { type: 'join_rejected', reason: '活动名额已满，请联系现场工作人员。' });
    return;
  }

  const existed = game.players.get(playerId);
  const player = {
    id: playerId,
    nickname: sanitizeText(profile.nickname || existed?.nickname || '微信用户', 24),
    avatar: sanitizeUrl(profile.avatar || existed?.avatar || ''),
    count: existed?.count || 0,
    joinedAt: existed?.joinedAt || Date.now(),
    updatedAt: Date.now(),
    online: true,
  };

  game.players.set(playerId, player);
  client.role = 'player';
  client.playerId = playerId;

  send(client.ws, { type: 'joined', playerId, data: snapshot() });
  broadcastSnapshot();
}

function recordShake(client, message) {
  if (game.status !== 'playing') return;

  const playerId = client.playerId || message.playerId;
  const player = game.players.get(playerId);
  if (!player) return send(client.ws, { type: 'error', error: 'Player not joined.' });

  const delta = Math.max(1, Math.min(Number(message.delta || 1), 3));
  player.count += delta;
  player.updatedAt = Date.now();
  player.online = true;

  broadcastSnapshot();
}

function startGame() {
  if (endTimer) clearTimeout(endTimer);

  for (const [playerId, player] of game.players.entries()) {
    if (!player.online) game.players.delete(playerId);
  }

  game.status = 'playing';
  game.startedAt = Date.now();
  game.endsAt = game.startedAt + game.durationMs;
  for (const player of game.players.values()) {
    player.count = 0;
    player.updatedAt = Date.now();
  }

  endTimer = setTimeout(endGame, game.durationMs);
  broadcastSnapshot();
}

function endGame() {
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  game.status = 'ended';
  game.endsAt = Date.now();
  broadcastSnapshot();
}

function resetGame() {
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  game.status = 'waiting';
  game.startedAt = null;
  game.endsAt = null;
  game.players.clear();
  for (const client of clients.values()) {
    if (client.role === 'player') client.playerId = null;
  }
  broadcastSnapshot();
}

function snapshot() {
  const players = [...game.players.values()]
    .sort((a, b) => b.count - a.count || a.joinedAt - b.joinedAt)
    .map((player, index) => ({ ...player, rank: index + 1 }));

  return {
    status: game.status,
    durationMs: game.durationMs,
    startedAt: game.startedAt,
    endsAt: game.endsAt,
    serverTime: Date.now(),
    leaderboardLimit: LEADERBOARD_LIMIT,
    questionnaireUrl: QUESTIONNAIRE_URL,
    players,
  };
}

function broadcastSnapshot() {
  const payload = { type: 'snapshot', data: snapshot() };
  for (const { ws } of clients.values()) send(ws, payload);
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized.' });
  next();
}

function isAdminMessage(message) {
  return !ADMIN_TOKEN || message.token === ADMIN_TOKEN;
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

function normalizeWechatUser(user) {
  return {
    openid: user.openid,
    nickname: user.nickname || '微信用户',
    avatar: user.headimgurl || '',
    sex: user.sex,
    province: user.province,
    city: user.city,
    country: user.country,
  };
}

function sanitizeText(value, maxLength) {
  return String(value).trim().slice(0, maxLength);
}

function sanitizeUrl(value) {
  const text = String(value || '').trim();
  return /^https?:\/\//i.test(text) ? text : '';
}

function sanitizeId(value) {
  return String(value).trim().replace(/[^\w.-]/g, '').slice(0, 64);
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function toWsUrl(httpUrl) {
  return httpUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

function makeId(size = 21) {
  return crypto.randomBytes(Math.ceil(size * 0.75)).toString('base64url').slice(0, size);
}

server.listen(PORT, () => {
  console.log(`Shake backend listening on ${PUBLIC_BASE_URL}`);
});
