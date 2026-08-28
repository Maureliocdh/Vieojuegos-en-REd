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
  { x: 900,  y: 900,  objeto: null },
  { x: 3000, y: 900,  objeto: null },
  { x: 5100, y: 1500, objeto: null },
  { x: 1500, y: 4500, objeto: null },
  { x: 4200, y: 4800, objeto: null },
  { x: 2400, y: 2400, objeto: null },
  { x: 4800, y: 3000, objeto: null },
  { x: 1200, y: 3000, objeto: null },
  { x: 3600, y: 1800, objeto: null },
  { x: 3000, y: 5400, objeto: null },
];
const obstaculos = [
  { x:  660, y:  660, width: 420, height: 300 },
  { x: 2280, y: 1260, width: 660, height: 270 },
  { x: 3960, y:  780, width: 360, height: 660 },
  { x: 1080, y: 3150, width: 780, height: 300 },
  { x: 3180, y: 3540, width: 390, height: 780 },
  { x: 4680, y: 4740, width: 720, height: 330 },
  { x: 1800, y: 1800, width: 300, height: 300 },
  { x: 4500, y: 2100, width: 450, height: 240 },
  { x: 2700, y: 4200, width: 360, height: 360 },
  { x:  900, y: 5100, width: 480, height: 200 },
  { x: 5400, y: 4200, width: 300, height: 420 },
  { x: 2400, y: 600,  width: 240, height: 300 },
];
// Items sueltos tirados por jugadores: { id, x, y, item }
const itemsEnSuelo = [];
let nextItemId = 1;

// Configuración autoritativa: el cliente solo la replica para mostrar feedback visual.
const STATS_ARMAS = {
  'puños': { daño: 5, rango: 80, velocidad: 500, balas: 1, dispersion: 0, cooldown: 400, capacidadCargador: 0, tiempoRecarga: 0 },
  pistola: { daño: 15, rango: 1000, velocidad: 900, balas: 1, dispersion: 0, cooldown: 300, capacidadCargador: 12, tiempoRecarga: 1200 },
  escopeta: { daño: 10, rango: 700, velocidad: 650, balas: 3, dispersion: 15, cooldown: 800, capacidadCargador: 6, tiempoRecarga: 1800 },
  rifle: { daño: 25, rango: 1600, velocidad: 1200, balas: 1, dispersion: 0, cooldown: 1000, capacidadCargador: 30, tiempoRecarga: 1500 },
  botiquin: { tipo: 'consumible', cura_vida: 50 },
  escudo_pocion: { tipo: 'consumible', cura_escudo: 50 },
  granada: { tipo: 'lanzable', cooldown: 1500 },
};

const INVENTARIO_SIZE = 5;

const MAP_WIDTH = 6000;
const MAP_HEIGHT = 6000;
const TICK_RATE = 30;
const BULLET_SPEED = 900;
const MUZZLE_OFFSET = 45;
const HIT_RADIUS = 40;
const RESPAWN_MARGIN = 80;
const PLATFORM_RADIUS = 55;
const LOOT = ['pistola', 'escopeta', 'botiquin', 'escudo_pocion', 'rifle', 'granada'];
// Dificultad moderada: persiguen más despacio y solo atacan a distancia cercana.
const BOT_SPEED = 60;
const BOT_ATTACK_RANGE = 300;
const BOT_COUNT = 11;
const RESPAWN_COOLDOWN = 3000;
let partidaEnCurso = false;
let partidaFinalizada = false;
let tiempoRestante = 120;
const limiteKills = 10;
let temporizadorPartida = null;

// Zona segura: se reduce cada 30 s durante la partida.
const zonaSegura = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, radio: Math.hypot(MAP_WIDTH, MAP_HEIGHT) / 2 };
const ZONA_DAÑO_POR_SEGUNDO = 2;
let temporizadorZona = null;

// Granadas activas en vuelo/cuenta regresiva: { id, x, y, angle, lanzadorId, explotaEn }
const granadas = [];
let nextGranadaId = 1;
const GRANADA_VELOCIDAD = 400;
const GRANADA_RADIO_EXPLOSION = 150;
const GRANADA_DAÑO = 60;
const GRANADA_FUZE = 2000; // ms hasta explotar

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
  // Reinicia la zona segura al tamaño máximo del mapa.
  zonaSegura.x = MAP_WIDTH / 2;
  zonaSegura.y = MAP_HEIGHT / 2;
  zonaSegura.radio = Math.hypot(MAP_WIDTH, MAP_HEIGHT) / 2;
  broadcast('inicioPartida', { tiempoRestante });
  broadcast('tiempoPartida', tiempoRestante);
  temporizadorPartida = setInterval(() => {
    if (!partidaEnCurso) return;
    tiempoRestante -= 1;
    broadcast('tiempoPartida', tiempoRestante);
    if (tiempoRestante <= 0) finalizarPartida();
  }, 1000);
  // La zona empieza a reducirse 20 s después del inicio.
  temporizadorZona = setTimeout(function reducirZona() {
    if (!partidaEnCurso) return;
    const radioMin = 400;
    if (zonaSegura.radio > radioMin) {
      zonaSegura.radio = Math.max(radioMin, zonaSegura.radio * 0.7);
      // Mueve el centro ligeramente al azar para variar.
      zonaSegura.x = Math.max(zonaSegura.radio, Math.min(MAP_WIDTH - zonaSegura.radio,
        zonaSegura.x + (Math.random() - 0.5) * 400));
      zonaSegura.y = Math.max(zonaSegura.radio, Math.min(MAP_HEIGHT - zonaSegura.radio,
        zonaSegura.y + (Math.random() - 0.5) * 400));
      broadcast('zonaActualizada', { x: zonaSegura.x, y: zonaSegura.y, radio: zonaSegura.radio });
    }
    if (partidaEnCurso) temporizadorZona = setTimeout(reducirZona, 25_000);
  }, 20_000);
}

function finalizarPartida() {
  if (!partidaEnCurso || partidaFinalizada) return;
  partidaEnCurso = false;
  partidaFinalizada = true;
  if (temporizadorPartida) clearInterval(temporizadorPartida);
  if (temporizadorZona) { clearTimeout(temporizadorZona); temporizadorZona = null; }
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
      const invReset = Array(INVENTARIO_SIZE).fill(null);
      invReset[0] = jugador.esBot ? 'pistola' : 'puños';
      jugador.inventario = invReset;
      jugador.slotSeleccionado = 0;
      jugador.balasEnCargador = 0;
      jugador.municionPorSlot = Array(INVENTARIO_SIZE).fill(null);
      jugador.ultimoDisparo = 0;
      jugador.unido = jugador.esBot;
      if (jugador.esBot) equiparArma(jugador);
    }
    balas.length = 0;
    granadas.length = 0;
    itemsEnSuelo.length = 0;
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
  // Asigna posición dentro de la zona segura al unirse
  const spawn = obtenerPosicionSpawn();
  jugador.x = spawn.x;
  jugador.y = spawn.y;
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

/** Busca una posición de aparición libre, dentro de la zona segura y fuera de obstáculos. */
function obtenerPosicionSpawn() {
  for (let intento = 0; intento < 150; intento += 1) {
    const x = RESPAWN_MARGIN + Math.random() * (MAP_WIDTH - RESPAWN_MARGIN * 2);
    const y = RESPAWN_MARGIN + Math.random() * (MAP_HEIGHT - RESPAWN_MARGIN * 2);
    // Rechaza posiciones fuera de la zona segura (con margen de 60px para no spawnear justo en el borde)
    if (zonaSegura && Math.hypot(x - zonaSegura.x, y - zonaSegura.y) > zonaSegura.radio - 60) continue;
    const ocupado = Object.values(jugadores).some((jugador) => (
      !jugador.muerto && Math.hypot(jugador.x - x, jugador.y - y) < PLAYER_RADIUS * 3
    ));
    if (!colisionaConObstaculo(x, y) && !ocupado) return { x, y };
  }

  // Respaldo: el centro de la zona segura siempre está dentro.
  return { x: zonaSegura.x, y: zonaSegura.y };
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
    inventario: Array(INVENTARIO_SIZE).fill(null),
    slotSeleccionado: 0,
    ultimoDisparo: 0,
    muerto: false,
    balasEnCargador: 0,
    recargando: false,
    municionPorSlot: Array(INVENTARIO_SIZE).fill(null),
    esBot: false,
    nombre: `Jugador_${id.slice(0, 5)}`,
    unido: false,
  };
  jugadores[id].inventario[0] = 'puños';
  equiparArma(jugadores[id]);
}

/** Crea un jugador controlado por el servidor, con el mismo estado que un humano. */
function generarBot(id) {
  const spawn = obtenerPosicionSpawn();
  const inv = Array(INVENTARIO_SIZE).fill(null);
  const mun = Array(INVENTARIO_SIZE).fill(null);
  inv[0] = 'pistola';
  jugadores[id] = {
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    vida: 100,
    escudo: 0,
    inventario: inv,
    slotSeleccionado: 0,
    ultimoDisparo: 0,
    muerto: false,
    balasEnCargador: 0,
    recargando: false,
    municionPorSlot: mun,
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
    // No se consume si el stat correspondiente ya está al máximo.
    if (stats.cura_vida && jugador.vida >= 100) return;
    if (stats.cura_escudo && jugador.escudo >= 100) return;
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
  if (!jugadores[id] || jugadores[id].muerto || !Number.isInteger(slot) || slot < 0 || slot >= INVENTARIO_SIZE) return;
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

function dropItem(id, { slot } = {}) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto) return;
  const slotIndex = typeof slot === 'number' ? slot : jugador.slotSeleccionado;
  if (slotIndex < 0 || slotIndex >= INVENTARIO_SIZE) return;
  const item = jugador.inventario[slotIndex];
  // No se puede tirar si no hay nada o si es el único slot con arma y no hay más.
  if (!item) return;
  const itemId = `drop_${nextItemId++}`;
  // El item cae cerca del jugador con un pequeño desplazamiento.
  const offsetAngle = jugador.angle + Math.PI; // cae detrás del jugador
  itemsEnSuelo.push({
    id: itemId,
    x: jugador.x + Math.cos(offsetAngle) * 60,
    y: jugador.y + Math.sin(offsetAngle) * 60,
    item,
  });
  jugador.inventario[slotIndex] = null;
  jugador.municionPorSlot[slotIndex] = null;
  if (slotIndex === jugador.slotSeleccionado) equiparArma(jugador);
}

function processClientMessage(id, message, client = null) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'unirse') unirseJugador(id, message.data?.nombre, client);
  if (message.type === 'movimiento') updateMovement(id, message.data);
  if (message.type === 'disparar') createBullet(id, message.data);
  if (message.type === 'cambiarSlot') selectInventorySlot(id, message.data);
  if (message.type === 'intercambiar') exchangeWithPlatform(id);
  if (message.type === 'recargar') reloadWeapon(id);
  if (message.type === 'tirarItem') dropItem(id, message.data);
  if (message.type === 'lanzarGranada') lanzarGranada(id, message.data);
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
    socket.on('tirarItem', (data) => dropItem(id, data));
    socket.on('lanzarGranada', (data) => lanzarGranada(id, data));
    socket.on('disconnect', () => removePlayer(id));
  });
}

function respawn(jugador) {
  // Suelta todo el inventario en el suelo antes de morir.
  for (const item of jugador.inventario) {
    if (!item || item === 'puños') continue;
    const spread = (Math.random() - 0.5) * 80;
    const spreadY = (Math.random() - 0.5) * 80;
    itemsEnSuelo.push({
      id: `drop_${nextItemId++}`,
      x: Math.max(0, Math.min(MAP_WIDTH, jugador.x + spread)),
      y: Math.max(0, Math.min(MAP_HEIGHT, jugador.y + spreadY)),
      item,
    });
  }

  // La muerte deja al jugador fuera de combate durante tres segundos.
  jugador.vida = 0;
  jugador.escudo = 0;
  jugador.muerto = true;
  jugador.respawnAt = Date.now() + RESPAWN_COOLDOWN;
  const invNuevo = Array(INVENTARIO_SIZE).fill(null);
  invNuevo[0] = 'puños';
  jugador.inventario = invNuevo;
  jugador.slotSeleccionado = 0;
  jugador.ultimoDisparo = 0;
  jugador.balasEnCargador = 0;
  jugador.municionPorSlot = Array(INVENTARIO_SIZE).fill(null);
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
    // La regla de los bots prevalece: reaparecen siempre con al menos pistola.
    if (jugador.esBot) {
      const tieneArma = jugador.inventario.some((it) => it && STATS_ARMAS[it] && !STATS_ARMAS[it].tipo);
      if (!tieneArma) jugador.inventario[0] = 'pistola';
    }
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

    // Garantiza que el bot nunca se quede sin arma real. Puños no cuenta como arma.
    const esArmaDisparable = (it) => it && it !== 'puños' && STATS_ARMAS[it] && !STATS_ARMAS[it].tipo;
    const tieneArma = bot.inventario.some(esArmaDisparable);
    if (!tieneArma) {
      bot.inventario[0] = 'pistola';
      bot.slotSeleccionado = 0;
      equiparArma(bot);
    } else {
      // Selecciona el primer slot con arma disparable (no puños, no consumible).
      const slotArma = bot.inventario.findIndex(esArmaDisparable);
      if (slotArma !== -1 && bot.slotSeleccionado !== slotArma) {
        bot.slotSeleccionado = slotArma;
        equiparArma(bot);
      }
    }

    // Los bots recogen items del suelo si tienen espacio.
    for (let i = itemsEnSuelo.length - 1; i >= 0; i -= 1) {
      const drop = itemsEnSuelo[i];
      if (Math.hypot(bot.x - drop.x, bot.y - drop.y) > PLATFORM_RADIUS) continue;
      const slotVacio = bot.inventario.indexOf(null);
      if (slotVacio === -1) break;
      bot.inventario[slotVacio] = drop.item;
      bot.municionPorSlot[slotVacio] = null;
      if (slotVacio === bot.slotSeleccionado) equiparArma(bot);
      itemsEnSuelo.splice(i, 1);
    }

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

function lanzarGranada(id, { angle } = {}) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto || !partidaEnCurso) return;
  if (!Number.isFinite(angle)) return;
  const slotGranada = jugador.inventario.indexOf('granada');
  if (slotGranada === -1) return;
  const ahora = Date.now();
  if (ahora - jugador.ultimoDisparo < (STATS_ARMAS.granada.cooldown || 1500)) return;
  jugador.ultimoDisparo = ahora;
  jugador.inventario[slotGranada] = null;
  jugador.municionPorSlot[slotGranada] = null;
  if (jugador.slotSeleccionado === slotGranada) equiparArma(jugador);
  granadas.push({
    id: `g_${nextGranadaId++}`,
    x: jugador.x + Math.cos(angle) * MUZZLE_OFFSET,
    y: jugador.y + Math.sin(angle) * MUZZLE_OFFSET,
    angle,
    lanzadorId: id,
    explotaEn: ahora + GRANADA_FUZE,
    distancia: 0,
  });
}

function procesarGranadas() {
  if (!granadas.length) return;
  const ahora = Date.now();
  const dt = 1 / TICK_RATE;
  for (let i = granadas.length - 1; i >= 0; i -= 1) {
    const g = granadas[i];
    const velActual = Math.max(0, GRANADA_VELOCIDAD * (1 - g.distancia / 350));
    g.x += Math.cos(g.angle) * velActual * dt;
    g.y += Math.sin(g.angle) * velActual * dt;
    g.distancia += velActual * dt;
    const explotaPorDistancia = g.distancia >= 350;
    const explotaPorTiempo = ahora >= g.explotaEn;
    if (!explotaPorDistancia && !explotaPorTiempo) continue;
    // Explosión: daña a todos los jugadores en el radio.
    for (const [jid, jugador] of Object.entries(jugadores)) {
      if (jugador.muerto) continue;
      const dist = Math.hypot(jugador.x - g.x, jugador.y - g.y);
      if (dist > GRANADA_RADIO_EXPLOSION) continue;
      const daño = Math.round(GRANADA_DAÑO * (1 - dist / GRANADA_RADIO_EXPLOSION));
      const dañoEscudo = Math.min(jugador.escudo, daño);
      jugador.escudo -= dañoEscudo;
      jugador.vida -= daño - dañoEscudo;
      jugador.escudo = Math.max(0, jugador.escudo);
      if (jugador.vida <= 0) {
        const lanzador = jugadores[g.lanzadorId];
        if (lanzador) {
          lanzador.kills += 1;
          broadcast('kill', { asesino: lanzador.nombre, victima: jugador.nombre, arma: 'granada' });
          if (lanzador.kills >= limiteKills) finalizarPartida();
        }
        respawn(jugador);
      }
    }
    broadcast('explosion', { x: g.x, y: g.y, radio: GRANADA_RADIO_EXPLOSION });
    granadas.splice(i, 1);
  }
}

function aplicarDañoZona() {
  if (!partidaEnCurso) return;
  for (const jugador of Object.values(jugadores)) {
    if (jugador.muerto) continue;
    const dist = Math.hypot(jugador.x - zonaSegura.x, jugador.y - zonaSegura.y);
    if (dist > zonaSegura.radio) {
      jugador.vida -= ZONA_DAÑO_POR_SEGUNDO * (1 / TICK_RATE);
      if (jugador.vida <= 0) {
        jugador.vida = 0;
        respawn(jugador);
      }
    }
  }
}


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
  procesarGranadas();
  aplicarDañoZona();

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
            broadcast('kill', { asesino: propietario.nombre, victima: jugador.nombre, arma: armaActual(propietario) });
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

    // Recogida de items tirados en el suelo.
    for (let i = itemsEnSuelo.length - 1; i >= 0; i -= 1) {
      const drop = itemsEnSuelo[i];
      if (jugador.muerto) continue;
      if (Math.hypot(jugador.x - drop.x, jugador.y - drop.y) > PLATFORM_RADIUS) continue;
      const slotVacio = jugador.inventario.indexOf(null);
      if (slotVacio === -1) continue;
      jugador.inventario[slotVacio] = drop.item;
      jugador.municionPorSlot[slotVacio] = null;
      if (slotVacio === jugador.slotSeleccionado) equiparArma(jugador);
      itemsEnSuelo.splice(i, 1);
    }
  }

  broadcast('estadoJuego', { jugadores, balas, plataformas, obstaculos, itemsEnSuelo, granadas, zonaSegura });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Servidor (${nativeMode ? 'WebSocket nativo' : 'Socket.IO'}) en http://localhost:${PORT}`);
});
