/**
 * Aternos 24/7 Continuous All-Time Roaming Mineflayer Bot (Node.js Engine)
 * Target Server: alamincraft.aternos.me:26832
 *
 * RUN:
 *   node bot_mineflayer.js
 *
 * RAILWAY & NETLIFY COMPATIBILITY:
 * Built-in lightweight HTTP server on process.env.PORT
 * Allows Railway healthchecks and direct connection from Netlify web dashboard!
 */

const mineflayer = require('mineflayer');
const http = require('http');

const cliUsername = process.argv[2];

const CONFIG = {
  host: process.env.MC_HOST || 'alamincraft.aternos.me',
  port: parseInt(process.env.MC_PORT || '26832', 10),
  username: cliUsername || process.env.MC_USERNAME || 'FrankAFK_Guard',
  version: process.env.MC_VERSION || false, // false = auto-detect
  auth: 'offline', // 'offline' or 'microsoft'
  autoWalk: true,
  walkRadiusBlocks: 5.0,
  autoJump: true,
  randomHeadLook: true,
  sneakPulse: true,
  armSwing: true,
  autoReconnect: true,
  reconnectBaseSec: 15,
  reconnectMaxSec: 45,
  keepaliveTimeoutMs: 240000,
  httpPort: parseInt(process.env.PORT || '3000', 10),
};

let bot = null;
let roamTimer = null;
let reconnectAttempts = 0;
let spawnAnchor = null;
let currentUsername = CONFIG.username;
let wasThrottled = false;
let logs = [];

function appendLog(category, message) {
  const ts = new Date().toLocaleTimeString();
  const entry = { id: Date.now() + Math.random(), timestamp: ts, category, message };
  logs.push(entry);
  if (logs.length > 100) logs.shift();
  console.log(`[${category.toUpperCase()}] ${message}`);
}

function startContinuousRoamLoop() {
  if (roamTimer) clearInterval(roamTimer);
  let tick = 0;
  appendLog('roam', 'Continuous roaming loop active.');
  roamTimer = setInterval(() => {
    if (!bot || !bot.entity) return;
    tick += 1;
    const pos = bot.entity.position;
    if (!spawnAnchor) spawnAnchor = { x: pos.x, y: pos.y, z: pos.z };

    const dx = spawnAnchor.x - pos.x;
    const dz = spawnAnchor.z - pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > Math.max(2.0, CONFIG.walkRadiusBlocks)) {
      const yawBack = Math.atan2(-dx, -dz);
      bot.look(yawBack, 0, true).catch(() => {});
      bot.setControlState('forward', true);
      bot.setControlState('back', false);
    } else {
      if (tick % 7 === 0) {
        const randYaw = (Math.random() * Math.PI * 2) - Math.PI;
        bot.look(randYaw, (Math.random() - 0.5) * 0.4, true).catch(() => {});
      }
      bot.setControlState('forward', true);
    }

    if (CONFIG.autoJump && (bot.entity.isCollidedHorizontally || tick % 11 === 0)) {
      bot.setControlState('jump', true);
      setTimeout(() => bot && bot.setControlState('jump', false), 250);
    }

    if (CONFIG.armSwing && tick % 9 === 0) {
      bot.swingArm('right');
    }

    if (CONFIG.sneakPulse && tick % 19 === 0) {
      bot.setControlState('sneak', true);
      setTimeout(() => bot && bot.setControlState('sneak', false), 400);
    }
  }, 400);
}

function createBot() {
  if (roamTimer) clearInterval(roamTimer);
  spawnAnchor = null;

  appendLog('system', `Connecting to ${CONFIG.host}:${CONFIG.port} as ${currentUsername}...`);

  try {
    bot = mineflayer.createBot({
      host: CONFIG.host,
      port: CONFIG.port,
      username: currentUsername,
      version: CONFIG.version || false,
      auth: CONFIG.auth,
      checkTimeoutInterval: CONFIG.keepaliveTimeoutMs,
      hideErrors: false,
    });
  } catch (err) {
    appendLog('error', `Creation error: ${err.message}`);
    return;
  }

  bot.on('login', () => {
    reconnectAttempts = 0;
    wasThrottled = false;
    appendLog('system', `Logged in to server as ${bot.username}`);
  });

  bot.on('spawn', () => {
    const pos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
    appendLog('spawn', `Bot spawned at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    setTimeout(() => {
      if (bot && bot.entity) {
        startContinuousRoamLoop();
      }
    }, 2000);
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    if (reasonStr.includes('throttled')) {
      wasThrottled = true;
      appendLog('warning', 'Aternos connection throttled. Backing off 15s before reconnecting...');
    } else if (reasonStr.includes('duplicate_login')) {
      appendLog('warning', `Duplicate login: "${currentUsername}" is already active.`);
      currentUsername = `${CONFIG.username.slice(0, 10)}_${Math.floor(10 + Math.random() * 89)}`;
      appendLog('system', `Auto-switching username to "${currentUsername}" for next attempt.`);
    } else {
      appendLog('kicked', reasonStr);
    }
  });

  bot.on('error', (err) => {
    const msg = err?.message || String(err);
    if (msg.includes('ECONNRESET')) {
      appendLog('network', 'Connection reset (ECONNRESET). Reconnecting safely...');
    } else {
      appendLog('error', msg);
    }
  });

  bot.on('end', () => {
    if (roamTimer) clearInterval(roamTimer);
    if (!CONFIG.autoReconnect) return;
    reconnectAttempts += 1;
    let delaySec = Math.min(CONFIG.reconnectMaxSec, CONFIG.reconnectBaseSec + reconnectAttempts * 2);
    if (wasThrottled) delaySec = Math.max(16, delaySec);
    appendLog('reconnect', `Reconnecting in ${delaySec}s (attempt ${reconnectAttempts})...`);
    setTimeout(createBot, delaySec * 1000);
  });
}

// Built-in HTTP Server for Railway healthcheck & Netlify web dashboard API
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ? req.url.split('?')[0] : '/';

  if (url === '/' || url === '/health' || url === '/api/bot/healthcheck') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      bot: currentUsername,
      connected: !!(bot && bot.entity),
      uptimeSec: Math.floor(process.uptime()),
    }));
    return;
  }

  if (url === '/api/bot/state') {
    const pos = bot?.entity?.position || { x: 0, y: 0, z: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running: true,
      connectionState: bot?.entity ? 'Connected' : (bot ? 'Connecting' : 'Disconnected'),
      player: {
        username: currentUsername,
        health: bot?.health ?? 20,
        food: bot?.food ?? 20,
        position: { x: pos.x, y: pos.y, z: pos.z },
        yaw: bot?.entity?.yaw ?? 0,
        pitch: bot?.entity?.pitch ?? 0,
      },
      server: {
        host: CONFIG.host,
        port: CONFIG.port,
        version: CONFIG.version || 'Auto',
      },
      stats: {
        totalUptimeSec: Math.floor(process.uptime()),
        disconnectsCount: reconnectAttempts,
        reconnectAttempts: reconnectAttempts,
      },
      logs: logs,
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(CONFIG.httpPort, '0.0.0.0', () => {
  appendLog('system', `HTTP API Server listening on port ${CONFIG.httpPort} (Ready for Netlify & Railway)`);
  createBot();
});
