const path = require('path');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const nativeMode = process.argv.includes('--nativo');
const jugadores = {};
const balas = [];
const plataformas = [
  { x: 300, y: 300, objeto: null },
  { x: 1000, y: 300, objeto: null },
  { x: 1700, y: 500, objeto: null },
  { x: 500, y: 1500, objeto: null },
  { x: 1400, y: 1600, objeto: null },
];

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const TICK_RATE = 30;
const BULLET_SPEED = 900;
const MUZZLE_OFFSET = 45;
const HIT_RADIUS = 40;
const RESPAWN_MARGIN = 80;
const PLATFORM_RADIUS = 55;
const LOOT = ['pistola', 'escopeta', 'botiquin'];

let io;
let wss;
let nextNativePlayerId = 1;

app.use(express.static(path.join(__dirname, 'public')));

// El cliente consulta este endpoint antes de elegir su transporte de red.
app.get('/modo', (_request, response) => {
  response.json({ modo: nativeMode ? 'nativo' : 'socket.io' });
});

/** Envía un evento usando Socket.IO o el formato JSON de WebSocket nativo. */
function sendToClient(client, type, data) {
  if (nativeMode) {
    // OPEN es 1; no se intenta escribir sobre un socket ya cerrado.
    if (client.readyState === 1) client.send(JSON.stringify({ type, data }));
  } else {
    client.emit(type, data);
  }
}

/** Difunde un evento usando el transporte activo. */
function broadcast(type, data) {
  if (nativeMode) {
    for (const client of wss.clients) sendToClient(client, type, data);
  } else {
    io.emit(type, data);
  }
}

function addPlayer(id) {
  jugadores[id] = {
    x: MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2,
    angle: 0,
    vida: 100,
    inventario: ['puños', null, null],
    slotSeleccionado: 0,
  };
}

function removePlayer(id) {
  delete jugadores[id];
  broadcast('jugadorDesconectado', id);
  console.log(`Desconectado: ${id}`);
}

function updateMovement(id, { x, y, angle } = {}) {
  if (!jugadores[id] || ![x, y, angle].every(Number.isFinite)) return;
  jugadores[id].x = Math.max(0, Math.min(MAP_WIDTH, x));
  jugadores[id].y = Math.max(0, Math.min(MAP_HEIGHT, y));
  jugadores[id].angle = angle;
}

function createBullet(id, { x, y, angle } = {}) {
  if (!jugadores[id] || ![x, y, angle].every(Number.isFinite)) return;
  balas.push({
    x: x + Math.cos(angle) * MUZZLE_OFFSET,
    y: y + Math.sin(angle) * MUZZLE_OFFSET,
    angle,
    ownerId: id,
  });
}

function selectInventorySlot(id, { slot } = {}) {
  if (!jugadores[id] || !Number.isInteger(slot) || slot < 0 || slot > 2) return;
  jugadores[id].slotSeleccionado = slot;
}

function processClientMessage(id, message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'movimiento') updateMovement(id, message.data);
  if (message.type === 'disparar') createBullet(id, message.data);
  if (message.type === 'cambiarSlot') selectInventorySlot(id, message.data);
}

if (nativeMode) {
  // En modo nativo NO se carga Socket.IO: ws se acopla al mismo servidor HTTP.
  const { WebSocketServer } = require('ws');
  wss = new WebSocketServer({ server });

  wss.on('connection', (socket) => {
    const id = `native-${nextNativePlayerId++}`;
    socket.playerId = id;
    addPlayer(id);
    console.log(`Conectado: ${id}`);

    sendToClient(socket, 'identidad', { id });
    sendToClient(socket, 'configMapa', { MAP_WIDTH, MAP_HEIGHT });

    socket.on('message', (rawMessage) => {
      try {
        processClientMessage(id, JSON.parse(rawMessage.toString()));
      } catch {
        // Un paquete malformado se descarta sin interrumpir el servidor.
      }
    });
    socket.on('close', () => removePlayer(id));
  });
} else {
  // Socket.IO permanece disponible como modo predeterminado del proyecto.
  const { Server } = require('socket.io');
  io = new Server(server);

  io.on('connection', (socket) => {
    const { id } = socket;
    addPlayer(id);
    console.log(`Conectado: ${id}`);
    sendToClient(socket, 'configMapa', { MAP_WIDTH, MAP_HEIGHT });

    socket.on('movimiento', (data) => updateMovement(id, data));
    socket.on('disparar', (data) => createBullet(id, data));
    socket.on('cambiarSlot', (data) => selectInventorySlot(id, data));
    socket.on('disconnect', () => removePlayer(id));
  });
}

function respawn(jugador) {
  jugador.vida = 100;
  jugador.x = RESPAWN_MARGIN + Math.random() * (MAP_WIDTH - RESPAWN_MARGIN * 2);
  jugador.y = RESPAWN_MARGIN + Math.random() * (MAP_HEIGHT - RESPAWN_MARGIN * 2);
  jugador.angle = 0;
}

// Cada diez segundos, las plataformas vacías reciben botín al azar.
setInterval(() => {
  for (const plataforma of plataformas) {
    if (plataforma.objeto === null) {
      plataforma.objeto = LOOT[Math.floor(Math.random() * LOOT.length)];
    }
  }
}, 10_000);

// Game loop compartido: no depende de cuál transporte esté activo.
setInterval(() => {
  for (let index = balas.length - 1; index >= 0; index -= 1) {
    const bala = balas[index];
    bala.x += Math.cos(bala.angle) * (BULLET_SPEED / TICK_RATE);
    bala.y += Math.sin(bala.angle) * (BULLET_SPEED / TICK_RATE);

    if (bala.x < 0 || bala.x > MAP_WIDTH || bala.y < 0 || bala.y > MAP_HEIGHT) {
      balas.splice(index, 1);
      continue;
    }

    for (const id in jugadores) {
      if (id === bala.ownerId) continue;
      const jugador = jugadores[id];
      if (Math.hypot(bala.x - jugador.x, bala.y - jugador.y) <= HIT_RADIUS) {
        balas.splice(index, 1);
        jugador.vida -= 10;
        if (jugador.vida <= 0) respawn(jugador);
        break;
      }
    }
  }

  // Recogida autoritativa: el servidor decide si hay espacio y vacía la plataforma.
  for (const id in jugadores) {
    const jugador = jugadores[id];
    for (const plataforma of plataformas) {
      if (plataforma.objeto === null) continue;
      if (Math.hypot(jugador.x - plataforma.x, jugador.y - plataforma.y) > PLATFORM_RADIUS) continue;

      const slotVacio = jugador.inventario.indexOf(null);
      if (slotVacio === -1) continue;
      jugador.inventario[slotVacio] = plataforma.objeto;
      plataforma.objeto = null;
    }
  }

  broadcast('estadoJuego', { jugadores, balas, plataformas });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Servidor (${nativeMode ? 'WebSocket nativo' : 'Socket.IO'}) en http://localhost:${PORT}`);
});
