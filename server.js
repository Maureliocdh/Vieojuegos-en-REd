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
const obstaculos = [
  { x: 220, y: 220, width: 140, height: 100 },
  { x: 760, y: 420, width: 220, height: 90 },
  { x: 1320, y: 260, width: 120, height: 220 },
  { x: 360, y: 1050, width: 260, height: 100 },
  { x: 1060, y: 1180, width: 130, height: 260 },
  { x: 1560, y: 1580, width: 240, height: 110 },
];

// Configuración autoritativa: el cliente solo la replica para mostrar feedback visual.
const STATS_ARMAS = {
  'puños': { daño: 5, rango: 80, velocidad: 500, balas: 1, dispersion: 0, cooldown: 400, capacidadCargador: 0, tiempoRecarga: 0 },
  pistola: { daño: 15, rango: 1000, velocidad: 900, balas: 1, dispersion: 0, cooldown: 300, capacidadCargador: 12, tiempoRecarga: 1200 },
  escopeta: { daño: 10, rango: 700, velocidad: 650, balas: 3, dispersion: 15, cooldown: 800, capacidadCargador: 6, tiempoRecarga: 1800 },
  rifle: { daño: 25, rango: 1600, velocidad: 1200, balas: 1, dispersion: 0, cooldown: 1000, capacidadCargador: 30, tiempoRecarga: 1500 },
  botiquin: { tipo: 'consumible', cura_vida: 50 },
  escudo_pocion: { tipo: 'consumible', cura_escudo: 50 },
};

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const TICK_RATE = 30;
const BULLET_SPEED = 900;
const MUZZLE_OFFSET = 45;
const HIT_RADIUS = 40;
const RESPAWN_MARGIN = 80;
const PLATFORM_RADIUS = 55;
const LOOT = ['pistola', 'escopeta', 'botiquin', 'escudo_pocion'];
// Dificultad moderada: persiguen más despacio y solo atacan a distancia cercana.
const BOT_SPEED = 60;
const BOT_ATTACK_RANGE = 300;
const BOT_COUNT = 6;
const RESPAWN_COOLDOWN = 3000;
let partidaEnCurso = false;
let partidaFinalizada = false;
let tiempoRestante = 120;
const limiteKills = 10;
let temporizadorPartida = null;

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

function iniciarPartida() {
  if (partidaEnCurso || partidaFinalizada) return;
  partidaEnCurso = true;
  tiempoRestante = 120;
  broadcast('inicioPartida', { tiempoRestante });
  broadcast('tiempoPartida', tiempoRestante);
  temporizadorPartida = setInterval(() => {
    if (!partidaEnCurso) return;
    tiempoRestante -= 1;
    broadcast('tiempoPartida', tiempoRestante);
    if (tiempoRestante <= 0) finalizarPartida();
  }, 1000);
}

function finalizarPartida() {
  if (!partidaEnCurso || partidaFinalizada) return;
  partidaEnCurso = false;
  partidaFinalizada = true;
  if (temporizadorPartida) clearInterval(temporizadorPartida);
  temporizadorPartida = null;

  const podio = Object.values(jugadores)
    .sort((a, b) => (b.kills || 0) - (a.kills || 0))
    .slice(0, 3)
    .map((jugador) => ({ nombre: jugador.nombre, kills: jugador.kills || 0 }));
  broadcast('finDeJuego', podio);

  setTimeout(() => {
    for (const jugador of Object.values(jugadores)) {
      jugador.vida = 100;
      jugador.escudo = 0;
      jugador.kills = 0;
      jugador.muerto = false;
      jugador.recargando = false;
      jugador.inventario = jugador.esBot ? ['pistola', null, null] : ['puños', null, null];
      jugador.slotSeleccionado = 0;
      jugador.balasEnCargador = 0;
      jugador.municionPorSlot = [null, null, null];
      jugador.ultimoDisparo = 0;
      jugador.unido = jugador.esBot;
      if (jugador.esBot) equiparArma(jugador);
    }
    balas.length = 0;
    plataformas.forEach((plataforma) => { plataforma.objeto = null; });
    tiempoRestante = 120;
    partidaFinalizada = false;
    broadcast('reinicioPartida', {});
  }, 10_000);
}

function unirseJugador(id, nombre, client = null) {
  const jugador = jugadores[id];
  if (!jugador || jugador.esBot || partidaFinalizada) return;
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim().slice(0, 16) : '';
  jugador.nombre = nombreLimpio || `Jugador_${id.slice(0, 5)}`;
  jugador.unido = true;
  if (!partidaEnCurso) iniciarPartida();
  if (client && partidaEnCurso) sendToClient(client, 'inicioPartida', { tiempoRestante });
}

const PLAYER_RADIUS = 24;

function colisionaConObstaculo(x, y, radius = PLAYER_RADIUS) {
  return obstaculos.some((obstaculo) => {
    const closestX = Math.max(obstaculo.x, Math.min(x, obstaculo.x + obstaculo.width));
    const closestY = Math.max(obstaculo.y, Math.min(y, obstaculo.y + obstaculo.height));
    return Math.hypot(x - closestX, y - closestY) < radius;
  });
}

function puntoEnObstaculo(x, y) {
  return obstaculos.some((obstaculo) => (
    x >= obstaculo.x && x <= obstaculo.x + obstaculo.width
    && y >= obstaculo.y && y <= obstaculo.y + obstaculo.height
  ));
}

/** Busca una posición de aparición libre, fuera de obstáculos y de otros jugadores. */
function obtenerPosicionSpawn() {
  for (let intento = 0; intento < 100; intento += 1) {
    const x = RESPAWN_MARGIN + Math.random() * (MAP_WIDTH - RESPAWN_MARGIN * 2);
    const y = RESPAWN_MARGIN + Math.random() * (MAP_HEIGHT - RESPAWN_MARGIN * 2);
    const ocupado = Object.values(jugadores).some((jugador) => (
      !jugador.muerto && Math.hypot(jugador.x - x, jugador.y - y) < PLAYER_RADIUS * 3
    ));
    if (!colisionaConObstaculo(x, y) && !ocupado) return { x, y };
  }

  // Respaldo determinista: el centro está despejado en el mapa actual.
  return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
}

/** Intenta mover una entidad y permite deslizarse sobre el borde de una caja. */
function moverEntidad(entidad, nextX, nextY) {
  const x = Math.max(0, Math.min(MAP_WIDTH, nextX));
  const y = Math.max(0, Math.min(MAP_HEIGHT, nextY));
  if (!colisionaConObstaculo(x, y)) {
    entidad.x = x;
    entidad.y = y;
  } else if (!colisionaConObstaculo(x, entidad.y)) {
    entidad.x = x;
  } else if (!colisionaConObstaculo(entidad.x, y)) {
    entidad.y = y;
  }
}

function armaActual(jugador) {
  return jugador.inventario[jugador.slotSeleccionado] || 'puños';
}

function statsArmaActual(jugador) {
  return STATS_ARMAS[armaActual(jugador)] || STATS_ARMAS['puños'];
}

function equiparArma(jugador) {
  const stats = statsArmaActual(jugador);
  const slot = jugador.slotSeleccionado;
  if (!jugador.municionPorSlot) jugador.municionPorSlot = [0, null, null];
  if (stats.capacidadCargador > 0 && jugador.municionPorSlot[slot] === null) {
    jugador.municionPorSlot[slot] = stats.capacidadCargador;
  }
  jugador.balasEnCargador = stats.capacidadCargador > 0
    ? (jugador.municionPorSlot[slot] ?? 0)
    : 0;
  jugador.recargando = false;
}

/** Inicia una recarga para humanos y bots, evitando dobles temporizadores. */
function iniciarRecarga(id) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto || jugador.recargando) return;
  const arma = armaActual(jugador);
  const slot = jugador.slotSeleccionado;
  const stats = STATS_ARMAS[arma];
  if (!stats || stats.tipo === 'consumible' || !stats.capacidadCargador
    || jugador.balasEnCargador >= stats.capacidadCargador) return;

  jugador.recargando = true;
  setTimeout(() => {
    // El jugador puede haber cambiado de arma o muerto durante la recarga.
    if (!jugadores[id] || jugadores[id] !== jugador || jugador.muerto) return;
    if (armaActual(jugador) !== arma) {
      jugador.recargando = false;
      return;
    }
    jugador.balasEnCargador = stats.capacidadCargador;
    jugador.municionPorSlot[slot] = stats.capacidadCargador;
    jugador.recargando = false;
  }, stats.tiempoRecarga);
}

function addPlayer(id) {
  jugadores[id] = {
    x: MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2,
    angle: 0,
    vida: 100,
    escudo: 0,
    kills: 0,
    inventario: ['puños', null, null],
    slotSeleccionado: 0,
    ultimoDisparo: 0,
    muerto: false,
    balasEnCargador: 0,
    recargando: false,
    municionPorSlot: [0, null, null],
    esBot: false,
    nombre: `Jugador_${id.slice(0, 5)}`,
    unido: false,
  };
  equiparArma(jugadores[id]);
}

/** Crea un jugador controlado por el servidor, con el mismo estado que un humano. */
function generarBot(id) {
  const spawn = obtenerPosicionSpawn();
  jugadores[id] = {
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    vida: 100,
    escudo: 0,
    // Los bots nacen siempre armados y conservan esta pistola al reaparecer.
    inventario: ['pistola', null, null],
    slotSeleccionado: 0,
    ultimoDisparo: 0,
    muerto: false,
    balasEnCargador: 0,
    recargando: false,
    municionPorSlot: [null, null, null],
    kills: 0,
    esBot: true,
    nombre: `BOT_${id}`,
    unido: true,
  };
  equiparArma(jugadores[id]);
}

function removePlayer(id) {
  delete jugadores[id];
  broadcast('jugadorDesconectado', id);
  console.log(`Desconectado: ${id}`);
}

function updateMovement(id, { x, y, angle } = {}) {
  if (!partidaEnCurso || !jugadores[id] || jugadores[id].muerto
    || (!jugadores[id].esBot && !jugadores[id].unido)
    || ![x, y, angle].every(Number.isFinite)) return;
  moverEntidad(jugadores[id], x, y);
  jugadores[id].angle = angle;
}

function createBullet(id, { x, y, angle } = {}) {
  if (!partidaEnCurso || !jugadores[id] || jugadores[id].muerto
    || (!jugadores[id].esBot && !jugadores[id].unido)
    || ![x, y, angle].every(Number.isFinite)) return;
  const jugador = jugadores[id];
  const nombreArma = jugador.inventario[jugador.slotSeleccionado] || 'puños';
  const stats = STATS_ARMAS[nombreArma] || STATS_ARMAS['puños'];
  // Los consumibles usan el mismo evento de acción, pero no crean proyectiles.
  if (stats.tipo === 'consumible') {
    if (stats.cura_vida) jugador.vida = Math.min(100, jugador.vida + stats.cura_vida);
    if (stats.cura_escudo) jugador.escudo = Math.min(100, jugador.escudo + stats.cura_escudo);
    jugador.inventario[jugador.slotSeleccionado] = null;
    jugador.municionPorSlot[jugador.slotSeleccionado] = null;
    equiparArma(jugador);
    return;
  }
  if (jugador.recargando || (stats.capacidadCargador > 0 && jugador.balasEnCargador <= 0)) return;
  const ahora = Date.now();

  // Cooldown autoritativo: los mensajes que llegan demasiado pronto se ignoran.
  if (ahora - jugador.ultimoDisparo < stats.cooldown) return;
  jugador.ultimoDisparo = ahora;
  if (stats.capacidadCargador > 0) {
    jugador.balasEnCargador -= 1;
    jugador.municionPorSlot[jugador.slotSeleccionado] = jugador.balasEnCargador;
  }

  for (let index = 0; index < stats.balas; index += 1) {
    // Para la escopeta: -15°, 0°, +15°; un solo proyectil conserva el ángulo original.
    const offsetGrados = stats.balas === 1
      ? 0
      : (index - (stats.balas - 1) / 2) * stats.dispersion;
    const anguloBala = angle + (offsetGrados * Math.PI) / 180;
    balas.push({
      x: x + Math.cos(anguloBala) * MUZZLE_OFFSET,
      y: y + Math.sin(anguloBala) * MUZZLE_OFFSET,
      angle: anguloBala,
      velocidad: stats.velocidad,
      daño: stats.daño,
      rango: stats.rango,
      distanciaRecorrida: 0,
      arma: nombreArma,
      // ID común para Socket.IO y WebSocket nativo; se usa al confirmar una baja.
      propietarioId: id,
      // Alias temporal para compatibilidad con balas creadas por una versión anterior.
      ownerId: id,
    });
  }
}

function selectInventorySlot(id, { slot } = {}) {
  if (!jugadores[id] || jugadores[id].muerto || !Number.isInteger(slot) || slot < 0 || slot > 2) return;
  jugadores[id].slotSeleccionado = slot;
  equiparArma(jugadores[id]);
}

function reloadWeapon(id) {
  iniciarRecarga(id);
}

/** Intercambia el objeto del slot seleccionado por el botín de una plataforma cercana. */
function exchangeWithPlatform(id) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto) return;

  const plataforma = plataformas.find((candidate) => (
    candidate.objeto !== null
    && Math.hypot(jugador.x - candidate.x, jugador.y - candidate.y) <= PLATFORM_RADIUS
  ));
  if (!plataforma) return;

  const slot = jugador.slotSeleccionado;
  const objetoEnMano = jugador.inventario[slot];
  jugador.inventario[slot] = plataforma.objeto;
  plataforma.objeto = objetoEnMano;
  jugador.municionPorSlot[slot] = null;
  equiparArma(jugador);
}

function processClientMessage(id, message, client = null) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'unirse') unirseJugador(id, message.data?.nombre, client);
  if (message.type === 'movimiento') updateMovement(id, message.data);
  if (message.type === 'disparar') createBullet(id, message.data);
  if (message.type === 'cambiarSlot') selectInventorySlot(id, message.data);
  if (message.type === 'intercambiar') exchangeWithPlatform(id);
  if (message.type === 'recargar') reloadWeapon(id);
}

// Los bots existen desde el arranque y aparecen en el mismo objeto que los jugadores.
for (let index = 1; index <= BOT_COUNT; index += 1) generarBot(`bot${index}`);

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
    sendToClient(socket, 'configMapa', { MAP_WIDTH, MAP_HEIGHT, obstaculos });

    socket.on('message', (rawMessage) => {
      try {
        processClientMessage(id, JSON.parse(rawMessage.toString()), socket);
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
    sendToClient(socket, 'configMapa', { MAP_WIDTH, MAP_HEIGHT, obstaculos });

    socket.on('movimiento', (data) => updateMovement(id, data));
    socket.on('unirse', (data) => unirseJugador(id, data?.nombre, socket));
    socket.on('disparar', (data) => createBullet(id, data));
    socket.on('cambiarSlot', (data) => selectInventorySlot(id, data));
    socket.on('intercambiar', () => exchangeWithPlatform(id));
    socket.on('recargar', () => reloadWeapon(id));
    socket.on('disconnect', () => removePlayer(id));
  });
}

function respawn(jugador) {
  // La muerte deja al jugador fuera de combate durante tres segundos.
  jugador.vida = 0;
  jugador.escudo = 0;
  jugador.muerto = true;
  jugador.respawnAt = Date.now() + RESPAWN_COOLDOWN;
  jugador.inventario = ['puños', null, null];
  jugador.slotSeleccionado = 0;
  jugador.ultimoDisparo = 0;
  jugador.balasEnCargador = 0;
  jugador.municionPorSlot = [null, null, null];
  jugador.recargando = false;
  jugador.angle = 0;
}

function procesarRespawns() {
  const ahora = Date.now();
  for (const jugador of Object.values(jugadores)) {
    if (!jugador.muerto || ahora < jugador.respawnAt) continue;
    jugador.vida = 100;
    jugador.escudo = 0;
    jugador.muerto = false;
    const spawn = obtenerPosicionSpawn();
    jugador.x = spawn.x;
    jugador.y = spawn.y;
    jugador.angle = 0;
    // La regla de los bots prevalece: reaparecen con su pistola equipada.
    if (jugador.esBot) jugador.inventario[0] = 'pistola';
    equiparArma(jugador);
  }
}

/** Ejecuta la IA de un bot una vez por tick del servidor. */
function actualizarBots() {
  if (!partidaEnCurso) return;
  for (const [botId, bot] of Object.entries(jugadores)) {
    if (!bot.esBot || bot.muerto || bot.vida <= 0) continue;

    let objetivo = null;
    let distanciaObjetivo = Infinity;
    for (const [id, candidato] of Object.entries(jugadores)) {
      // Ahora los bots pueden elegir como objetivo a humanos u otros bots.
      if (id === botId || candidato.muerto || candidato.vida <= 0) continue;
      const distancia = Math.hypot(candidato.x - bot.x, candidato.y - bot.y);
      if (distancia < distanciaObjetivo) {
        distanciaObjetivo = distancia;
        objetivo = candidato;
      }
    }
    if (!objetivo) continue;

    // Garantiza que el bot nunca se quede sin un arma seleccionada.
    bot.inventario[0] = 'pistola';
    bot.slotSeleccionado = 0;

    const dx = objetivo.x - bot.x;
    const dy = objetivo.y - bot.y;
    bot.angle = Math.atan2(dy, dx);

    // Se acerca sin abandonar los límites del mapa.
    if (distanciaObjetivo > 55) {
      moverEntidad(
        bot,
        bot.x + Math.cos(bot.angle) * (BOT_SPEED / TICK_RATE),
        bot.y + Math.sin(bot.angle) * (BOT_SPEED / TICK_RATE),
      );
    }

    // Reutiliza la misma lógica de disparo, cooldown y dispersión que un humano.
    if (distanciaObjetivo < BOT_ATTACK_RANGE) {
      if (bot.balasEnCargador <= 0) {
        iniciarRecarga(botId);
        continue;
      }
      if (bot.recargando) continue;
      createBullet(botId, { x: bot.x, y: bot.y, angle: bot.angle });
    }
  }
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
  procesarRespawns();
  actualizarBots();

  for (let index = balas.length - 1; index >= 0; index -= 1) {
    const bala = balas[index];
    const distanciaPaso = bala.velocidad / TICK_RATE;
    bala.x += Math.cos(bala.angle) * distanciaPaso;
    bala.y += Math.sin(bala.angle) * distanciaPaso;
    bala.distanciaRecorrida += distanciaPaso;

    if (bala.x < 0 || bala.x > MAP_WIDTH || bala.y < 0 || bala.y > MAP_HEIGHT
      || bala.distanciaRecorrida >= bala.rango || puntoEnObstaculo(bala.x, bala.y)) {
      balas.splice(index, 1);
      continue;
    }

    for (const id in jugadores) {
      const propietarioId = bala.propietarioId || bala.ownerId;
      const jugador = jugadores[id];
      if (id === propietarioId || jugador.muerto) continue;
      if (Math.hypot(bala.x - jugador.x, bala.y - jugador.y) <= HIT_RADIUS) {
        balas.splice(index, 1);
        // El escudo absorbe primero el daño; solo el excedente llega a la vida.
        const dañoAlEscudo = Math.min(jugador.escudo, bala.daño);
        jugador.escudo -= dañoAlEscudo;
        const dañoRestante = bala.daño - dañoAlEscudo;
        jugador.vida -= dañoRestante;
        jugador.escudo = Math.max(0, jugador.escudo);
        if (jugador.vida <= 0) {
          const propietario = jugadores[propietarioId];
          if (propietario) {
            propietario.kills += 1;
            if (propietario.kills >= limiteKills) finalizarPartida();
          }
          respawn(jugador);
        }
        break;
      }
    }
  }

  // Recogida autoritativa: el servidor decide si hay espacio y vacía la plataforma.
  for (const id in jugadores) {
    const jugador = jugadores[id];
    for (const plataforma of plataformas) {
      if (plataforma.objeto === null || jugador.muerto) continue;
      if (Math.hypot(jugador.x - plataforma.x, jugador.y - plataforma.y) > PLATFORM_RADIUS) continue;

      const slotVacio = jugador.inventario.indexOf(null);
      if (slotVacio === -1) continue;
      jugador.inventario[slotVacio] = plataforma.objeto;
      plataforma.objeto = null;
      jugador.municionPorSlot[slotVacio] = null;
      if (slotVacio === jugador.slotSeleccionado) equiparArma(jugador);
    }
  }

  broadcast('estadoJuego', { jugadores, balas, plataformas, obstaculos });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Servidor (${nativeMode ? 'WebSocket nativo' : 'Socket.IO'}) en http://localhost:${PORT}`);
});
