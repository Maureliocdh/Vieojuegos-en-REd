const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const jugadores = {};

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log(`Conectado: ${socket.id}`);

  // Cada jugador queda identificado exclusivamente por el id de su socket.
  jugadores[socket.id] = { x: 960, y: 540, angle: 0 };

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

    jugadores[socket.id].x = x;
    jugadores[socket.id].y = y;
    jugadores[socket.id].angle = angle;
  });
});

// Estado global a 30 FPS para todos los clientes conectados.
setInterval(() => {
  io.emit('jugadores', jugadores);
}, 1000 / 30);

server.listen(PORT, () => {
  console.log(`Servidor disponible en http://localhost:${PORT}`);
});
