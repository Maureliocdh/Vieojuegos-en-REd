const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const jugadores = {};
const balas = [];

// Límites del mundo compartidos por todos los clientes.
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const TICK_RATE = 30;
const BULLET_SPEED = 900; // píxeles por segundo
const MUZZLE_OFFSET = 45;
const HIT_RADIUS = 40;
const RESPAWN_MARGIN = 80;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log(`Conectado: ${socket.id}`);

  // Cada jugador queda identificado exclusivamente por el id de su socket.
  jugadores[socket.id] = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, angle: 0, vida: 100 };
  // El cliente necesita estas medidas para dibujar el mismo mundo que el servidor.
  socket.emit('configMapa', { MAP_WIDTH, MAP_HEIGHT });

  socket.on('disconnect', () => {
    delete jugadores[socket.id];
    // Además del siguiente estado global, se notifica la baja de inmediato.
    socket.broadcast.emit('jugadorDesconectado', socket.id);
    console.log(`Desconectado: ${socket.id}`);
  });

  socket.on('movimiento', ({ x, y, angle }) => {
    // Un socket desconectado no puede modificar el estado de otro jugador.
    if (!jugadores[socket.id]) return;
    // Se ignoran datos inválidos antes de guardarlos.
    if (![x, y, angle].every(Number.isFinite)) return;

    // El servidor impone los límites aunque el cliente intente enviar otra posición.
    jugadores[socket.id].x = Math.max(0, Math.min(MAP_WIDTH, x));
    jugadores[socket.id].y = Math.max(0, Math.min(MAP_HEIGHT, y));
    jugadores[socket.id].angle = angle;
  });

  socket.on('disparar', ({ x, y, angle }) => {
    if (!jugadores[socket.id] || ![x, y, angle].every(Number.isFinite)) return;

    // La bala nace delante del jugador y guarda quién la disparó para no dañarlo.
    balas.push({
      x: x + Math.cos(angle) * MUZZLE_OFFSET,
      y: y + Math.sin(angle) * MUZZLE_OFFSET,
      angle,
      ownerId: socket.id,
    });
  });
});

/** Reaparece a un jugador dentro de los límites del mundo. */
function respawn(jugador) {
  jugador.vida = 100;
  jugador.x = RESPAWN_MARGIN + Math.random() * (MAP_WIDTH - RESPAWN_MARGIN * 2);
  jugador.y = RESPAWN_MARGIN + Math.random() * (MAP_HEIGHT - RESPAWN_MARGIN * 2);
  jugador.angle = 0;
}

// Game loop del servidor: balas, colisiones, daño y sincronización a 30 FPS.
setInterval(() => {
  for (let index = balas.length - 1; index >= 0; index -= 1) {
    const bala = balas[index];
    bala.x += Math.cos(bala.angle) * (BULLET_SPEED / TICK_RATE);
    bala.y += Math.sin(bala.angle) * (BULLET_SPEED / TICK_RATE);

    // Se elimina si abandona el mundo para evitar que el arreglo crezca indefinidamente.
    if (bala.x < 0 || bala.x > MAP_WIDTH || bala.y < 0 || bala.y > MAP_HEIGHT) {
      balas.splice(index, 1);
      continue;
    }

    for (const id in jugadores) {
      if (id === bala.ownerId) continue;
      const jugador = jugadores[id];
      const distancia = Math.hypot(bala.x - jugador.x, bala.y - jugador.y);

      if (distancia <= HIT_RADIUS) {
        balas.splice(index, 1);
        jugador.vida -= 10;
        if (jugador.vida <= 0) respawn(jugador);
        break; // Una bala solo puede golpear a un jugador.
      }
    }
  }

  io.emit('estadoJuego', { jugadores, balas });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Servidor disponible en http://localhost:${PORT}`);
});
