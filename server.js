const path = require('path');
const { Tactical } = require('./lib/tactical');
const { MapVote } = require('./lib/map-vote');
const { Navigation } = require('./lib/navigation');
const Maps = require('./public/js/maps');
const Teams = require('./public/js/teams');
const express = require('express');
const http = require('http');
const { skins, reactions } = require('./public/js/assets.js');
const Buildings = require('./public/js/buildings.js');
const SpecialZones = require('./public/js/zones.js');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const nativeMode = process.argv.includes('--nativo');
const jugadores = {};
const balas = [];
let mapaActual = 'outpost';
let mapaSiguiente = null;
let votacionMapa = null;
let ultimoSegundoVotacion = null;
let siguienteRonda = null;
const { platforms: plataformas, obstacles: obstaculos, portals: portales } = Maps.create(mapaActual);
let navegacion = null;
const rutasBots = new Map();
// Items sueltos tirados por jugadores: { id, x, y, item }
const itemsEnSuelo = [];
let nextItemId = 1;

// Configuración autoritativa: el cliente solo la replica para mostrar feedback visual.
const STATS_ARMAS = {
  'puños': { daño: 5, rango: 80, velocidad: 500, balas: 1, dispersion: 0, cooldown: 400, capacidadCargador: 0, tiempoRecarga: 0 },
  pistola: { daño: 15, rango: 1000, velocidad: 900, balas: 1, dispersion: 0, cooldown: 650, capacidadCargador: 12, tiempoRecarga: 1200 },
  escopeta: { daño: 10, rango: 700, velocidad: 650, balas: 3, dispersion: 15, cooldown: 1200, capacidadCargador: 6, tiempoRecarga: 1800 },
  rifle: { daño: 25, rango: 1600, velocidad: 1200, balas: 1, dispersion: 0, cooldown: 1000 / 3, capacidadCargador: 30, tiempoRecarga: 1500 },
  sniper: { daño: 65, rango: 2400, velocidad: 1800, balas: 1, dispersion: 0, cooldown: 1400, capacidadCargador: 5, tiempoRecarga: 2200 },
  botiquin: { tipo: 'consumible', cura_vida: 50 },
  escudo_pocion: { tipo: 'consumible', cura_escudo: 50 },
  granada: { tipo: 'lanzable', cooldown: 1500 },
};

const INVENTARIO_SIZE = 5;
const MUNICION_CAJA = { pistola: 24, rifle: 30, sniper: 5, escopeta: 12 };
const nuevasReservas = () => ({ pistola: 0, rifle: 0, sniper: 0, escopeta: 0 });
const cofres = [];
const rarezaAleatoria = () => { const valor = Math.random(); return valor < 0.65 ? 0 : valor < 0.9 ? 1 : 2; };
function equipoInicial(jugador) {
  jugador.reaccion = null;
  jugador.reaccionHasta = 0;
  jugador.portalHasta = 0;
  jugador.portalMovimientoHasta = 0;
  jugador.inventario = ['puños', 'pistola', null, null, null];
  jugador.municionPorSlot = [0, 12, null, null, null];
  jugador.rarezas = [0, 0, 0, 0, 0];
  jugador.reservas = { ...nuevasReservas(), pistola: 24 };
  jugador.slotSeleccionado = 1;
  equiparArma(jugador);
}

const MAP_WIDTH = 6000;
const MAP_HEIGHT = 6000;
const TICK_RATE = 30;
const BULLET_SPEED = 900;
const MUZZLE_OFFSET = 45;
const HIT_RADIUS = 40;
const RESPAWN_MARGIN = 80;
const PLATFORM_RADIUS = 55;
const LOOT = ['pistola', 'escopeta', 'botiquin', 'escudo_pocion', 'rifle', 'sniper', 'granada'];
const BOT_DIFFICULTIES = {
  facil: { velocidad: 55, alcance: 200, errorPunteria: 0.3, intervaloDisparo: 1100 },
  normal: { velocidad: 80, alcance: 300, errorPunteria: 0, intervaloDisparo: 0 },
  dificil: { velocidad: 150, alcance: 650, errorPunteria: 0, intervaloDisparo: 0 },
};
const validarDificultad = value => typeof value === 'string' && Object.hasOwn(BOT_DIFFICULTIES, value) ? value : 'normal';
let dificultadBots = 'normal';
let cantidadBots = 11;
const RESPAWN_COOLDOWN = 3000;
let partidaEnCurso = false;
let partidaFinalizada = false;
let modoSoloJugador = false;
let tiempoRestante = 120;
let limiteKills = 10;
let duracionPartida = 120;
let temporizadorPartida = null;

// Tormenta: espera anunciada y cierre gradual calculado por el servidor.
const zonaSegura = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, radio: Math.hypot(MAP_WIDTH, MAP_HEIGHT) / 2 };
let ultimoDañoZona = 0;
zonaSegura.fase = 0;
zonaSegura.dañoPorSegundo = 0;
let temporizadorZona = null;
const ZONA_ESPERA_INICIAL = 20_000;
const ZONA_ESPERA = 15_000;
const ZONA_CIERRE = 20_000;
const ZONA_RADIO_MIN = 400;
let transicionZona = null;

function prepararCierreZona(ahora, espera) {
  const radio = Math.max(ZONA_RADIO_MIN, zonaSegura.radio * 0.7);
  const desplazamiento = Math.min(160, (zonaSegura.radio - radio) * 0.3);
  zonaSegura.objetivo = {
    x: Math.max(800, Math.min(MAP_WIDTH - 800, zonaSegura.x + (Math.random() * 2 - 1) * desplazamiento)),
    y: Math.max(800, Math.min(MAP_HEIGHT - 800, zonaSegura.y + (Math.random() * 2 - 1) * desplazamiento)),
    radio,
  };
  if (mapaActual === 'orbital' && (colisionaConObstaculo(zonaSegura.objetivo.x, zonaSegura.objetivo.y, 100)
    || SpecialZones.zones.some(zone => Math.hypot(zone.x - zonaSegura.objetivo.x, zone.y - zonaSegura.objetivo.y) < zone.radio + 80))) {
    zonaSegura.objetivo.x = zonaSegura.x;
    zonaSegura.objetivo.y = zonaSegura.y;
  }
  zonaSegura.estado = 'espera';
  zonaSegura.finEtapa = ahora + espera;
  transicionZona = { x: zonaSegura.x, y: zonaSegura.y, radio: zonaSegura.radio };
}

function actualizarZonaSegura() {
  if (!partidaEnCurso || !transicionZona) return;
  const ahora = Date.now();
  while (ahora >= zonaSegura.finEtapa) {
    const limite = zonaSegura.finEtapa;
    if (zonaSegura.estado === 'espera') {
      zonaSegura.estado = 'cerrando';
      zonaSegura.fase += 1;
      zonaSegura.dañoPorSegundo = Math.min(5, zonaSegura.fase);
      ultimoDañoZona = limite;
      zonaSegura.finEtapa = limite + ZONA_CIERRE;
    } else {
      Object.assign(zonaSegura, zonaSegura.objetivo);
      if (zonaSegura.radio <= ZONA_RADIO_MIN) {
        zonaSegura.estado = 'final';
        zonaSegura.objetivo = null;
        zonaSegura.finEtapa = null;
        transicionZona = null;
        zonaSegura.segundosEtapa = 0;
        return;
      }
      prepararCierreZona(limite, ZONA_ESPERA);
    }
  }
  if (zonaSegura.estado === 'cerrando') {
    const progreso = 1 - (zonaSegura.finEtapa - ahora) / ZONA_CIERRE;
    for (const key of ['x', 'y', 'radio']) {
      zonaSegura[key] = transicionZona[key] + (zonaSegura.objetivo[key] - transicionZona[key]) * progreso;
    }
  }
  zonaSegura.segundosEtapa = Math.max(0, Math.ceil((zonaSegura.finEtapa - ahora) / 1000));
}

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
app.get('/vendor/lucide.js', (_request, response) => response.sendFile(path.join(__dirname, 'node_modules/lucide/dist/umd/lucide.min.js')));
app.get('/vendor/nipplejs.js', (_request, response) => response.sendFile(path.join(__dirname, 'node_modules/nipplejs/dist/nipplejs.js')));

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
  if (type === 'estadoJuego' || type === 'inicioPartida') data = { ...data, equipos: estadoEquipos() };
  if (preparacionTactica && ['estadoJuego', 'inicioPartida'].includes(type)) {
    const clients = nativeMode ? wss.clients : io.sockets?.sockets.values() || [];
    for (const client of clients) {
      const id = nativeMode ? client.playerId : client.id;
      const privateState = preparacionTactica.snapshot(Date.now(), id);
      const packet = { ...data, preparacionTactica: privateState };
      if (data.jugadores && privateState.phase !== 'combate') {
        packet.jugadores = jugadores[id] ? { [id]: jugadores[id] } : {};
      }
      sendToClient(client, type, packet);
    }
    return;
  }
  if (nativeMode) {
    for (const client of wss.clients) sendToClient(client, type, data);
  } else {
    io.emit(type, data);
  }
}

let anfitrionId = null;
let opcionesSala = {};
let puntosEquipos = { azul: 0, rojo: 0 };
const esDueloEquipos = () => opcionesSala.modoArena === 'equipos';
function estadoEquipos() {
  return esDueloEquipos() ? { puntos: { ...puntosEquipos }, limite: limiteKills,
    ganador: partidaFinalizada ? Teams.winner(puntosEquipos) : null, finalizada: partidaFinalizada } : null;
}
function equilibrarEquipos() {
  const unidos = Object.values(jugadores).filter(jugador => jugador.unido);
  if (esDueloEquipos()) Teams.balance(unidos);
  else for (const jugador of Object.values(jugadores)) jugador.equipo = null;
}
function registrarBaja(autor, victima, arma) {
  if (!autor || (esDueloEquipos() && (autor === victima || Teams.same(autor, victima)))) return false;
  autor.kills += 1;
  if (esDueloEquipos()) puntosEquipos[autor.equipo] += 1;
  broadcast('kill', { asesino: autor.nombre, victima: victima.nombre, arma });
  if ((esDueloEquipos() ? puntosEquipos[autor.equipo] : autor.kills) < limiteKills) return false;
  finalizarPartida();
  return true;
}
function limpiarAbatido(jugador) {
  jugador.abatido = false;
  jugador.abatidoHasta = 0;
  jugador.abatidoDesde = 0;
  jugador.autorAbatidoId = null;
  jugador.armaAbatido = null;
  jugador.reanimadorId = null;
  jugador.reanimacionDesde = 0;
  jugador.progresoReanimacion = 0;
  jugador.reanimando = null;
  jugador.reanimarHasta = 0;
}
function eliminarJugador(jugador, autor = null, arma = null) {
  const responsable = autor || jugadores[jugador.autorAbatidoId];
  if (registrarBaja(responsable, jugador, arma || jugador.armaAbatido)) return true;
  respawn(jugador, responsable);
  return false;
}
function resolverBaja(jugador, autor = null, arma = null) {
  if (!esDueloEquipos()) return eliminarJugador(jugador, autor, arma);
  if (jugador.abatido) return eliminarJugador(jugador, autor, arma);
  jugador.abatido = true;
  jugador.abatidoDesde = Date.now();
  jugador.abatidoHasta = jugador.abatidoDesde + 20000;
  jugador.autorAbatidoId = Object.keys(jugadores).find(id => jugadores[id] === autor) || null;
  jugador.armaAbatido = arma;
  jugador.vida = 30;
  jugador.escudo = 0;
  jugador.recargando = false;
  jugador.recargaId = (jugador.recargaId || 0) + 1;
  jugador.reanimando = null;
  return procesarEquiposAbatidos();
}
function procesarEquiposAbatidos() {
  if (!esDueloEquipos()) return false;
  for (const equipo of Object.keys(Teams.catalog)) {
    const vivos = Object.values(jugadores).filter(j => j.unido && !j.muerto && j.equipo === equipo);
    if (!vivos.length || vivos.some(j => !j.abatido)) continue;
    for (const jugador of vivos) if (eliminarJugador(jugador)) return true;
  }
  return false;
}
function puedeReanimar(autor, objetivo) {
  return Teams.canRevive(autor, objetivo, obstaculos.flatMap(Buildings.walls));
}
function reanimar(id, { activo } = {}) {
  const autor = jugadores[id];
  if (!autor) return;
  if (activo !== true || !esDueloEquipos()) { autor.reanimando = null; autor.reanimarHasta = 0; return; }
  const objetivo = Object.entries(jugadores).filter(([, j]) => puedeReanimar(autor, j))
    .sort(([, a], [, b]) => Math.hypot(autor.x - a.x, autor.y - a.y) - Math.hypot(autor.x - b.x, autor.y - b.y))[0];
  autor.reanimando = objetivo?.[0] || null;
  autor.reanimarHasta = Date.now() + 350;
}
function procesarAbatidos() {
  const ahora = Date.now();
  for (const [id, jugador] of Object.entries(jugadores)) {
    if (jugador.reanimando && (ahora > jugador.reanimarHasta
      || !puedeReanimar(jugador, jugadores[jugador.reanimando]))) jugador.reanimando = null;
    if (!jugador.unido || jugador.muerto || !jugador.abatido) continue;
    if (ahora >= jugador.abatidoHasta) {
      if (eliminarJugador(jugador)) return true;
      continue;
    }
    const rescata = Object.entries(jugadores).find(([key, j]) => key === jugador.reanimadorId
      && j.reanimando === id && ahora <= j.reanimarHasta && puedeReanimar(j, jugador))
      || Object.entries(jugadores).find(([, j]) => j.reanimando === id
        && ahora <= j.reanimarHasta && puedeReanimar(j, jugador));
    if (!rescata) {
      jugador.reanimadorId = null; jugador.reanimacionDesde = 0; jugador.progresoReanimacion = 0;
      continue;
    }
    if (jugador.reanimadorId !== rescata[0]) {
      jugador.reanimadorId = rescata[0]; jugador.reanimacionDesde = ahora;
    }
    jugador.progresoReanimacion = Math.min(1, (ahora - jugador.reanimacionDesde) / 3000);
    if (jugador.progresoReanimacion >= 1) {
      limpiarAbatido(jugador);
      jugador.vida = 25; jugador.escudo = 0;
      rescata[1].reanimando = null;
    }
  }
  return procesarEquiposAbatidos();
}
let finPreparacion = 0;
let preparacionTactica = null;
let botsCompraron = false;
const jugadoresAusentes = new Map();
function segundosPreparacion() {
  if (preparacionTactica && preparacionTactica.phase(Date.now()).phase !== 'cuenta') return 0;
  return Math.max(0, Math.ceil((finPreparacion - Date.now()) / 1000));
}
function concederCompra(id, item) {
  const jugador = jugadores[id];
  if (!jugador?.unido || jugador.muerto) return false;
  if (item === 'escudo') {
    if (jugador.escudo >= 100) return false;
    jugador.escudo = Math.min(100, jugador.escudo + 50);
    return true;
  }
  if (item === 'municion') { jugador.reservas.pistola += 24; return true; }
  if (!recogerObjeto(jugador, item, STATS_ARMAS[item]?.capacidadCargador ?? null)) return false;
  if (STATS_ARMAS[item]?.capacidadCargador) {
    jugador.reservas[item] += item === 'rifle' ? 30 : item === 'sniper' ? 10 : 12;
    jugador.slotSeleccionado = jugador.inventario.indexOf(item);
    equiparArma(jugador);
  }
  return true;
}
function actualizarPreparacionTactica() {
  if (!preparacionTactica || botsCompraron || preparacionTactica.phase(Date.now()).phase !== 'tienda') return;
  botsCompraron = true;
  for (const [id, jugador] of Object.entries(jugadores)) {
    if (!jugador.esBot || !jugador.unido) continue;
    // Presupuesto intermedio: 80 base + una bonificación de 20.
    const cuenta = preparacionTactica.accounts.get(id);
    if (cuenta) cuenta.credits = 100;
    preparacionTactica.buy(id, 'rifle', Date.now(), item => concederCompra(id, item));
  }
}

function estadoSala() {
  return { anfitrionId, activa: partidaEnCurso, finalizada: partidaFinalizada, votacion: votacionMapa?.snapshot(Date.now()) ?? null,
    mapaSiguiente, reingresos: [...jugadoresAusentes.keys()],
    reglas: opcionesSala, equipos: estadoEquipos(), jugadores: Object.entries(jugadores)
      .filter(([, j]) => j.unido && !j.esBot)
      .map(([id, j]) => ({ id, nombre: j.nombre, skin: j.skin, equipo: j.equipo ?? null })) };
}
function publicarSala() { broadcast('estadoSala', estadoSala()); }
function iniciarDesdeSala(id) {
  if (id !== anfitrionId || !jugadores[id]?.unido || partidaEnCurso || partidaFinalizada || votacionMapa?.snapshot(Date.now()).activa) return;
  finPreparacion = Date.now() + (opcionesSala.modoArena === 'puzzles' ? 89000 : 4000);
  iniciarPartida(opcionesSala);
  for (const jugador of Object.values(jugadores)) {
    if (!jugador.unido) continue;
    jugador.muerto = false;
    limpiarAbatido(jugador);
    jugador.vida = 100;
    jugador.escudo = 0;
    jugador.kills = 0;
    equipoInicial(jugador);
    Object.assign(jugador, obtenerPosicionSpawn());
  }
  preparacionTactica = opcionesSala.modoArena === 'puzzles'
    ? new Tactical(Object.keys(jugadores).filter(id => jugadores[id].unido), finPreparacion - 89000) : null;
  botsCompraron = false;
  publicarSala();
  broadcast('inicioPartida', { tiempoRestante, preparacionRestante: segundosPreparacion(), preparacionTactica: preparacionTactica?.snapshot(Date.now()) ?? null });
}

function reglasPartida() {
  return { limiteKills, duracion: duracionPartida, cantidadBots, dificultadBots, mapa: mapaActual, mapaSiguiente,
    votacionActiva: !!votacionMapa && !votacionMapa.ganador,
    soloJugador: modoSoloJugador, modoArena: opcionesSala.modoArena || 'clasico', equipos: estadoEquipos(),
    activa: partidaEnCurso, finalizada: partidaFinalizada };
}

function configMapa() {
  return { MAP_WIDTH, MAP_HEIGHT, mapa: mapaActual, obstaculos, portales, zonasEspeciales: SpecialZones.zones };
}
function cargarMapa(id) {
  if (id === mapaActual) return;
  const map = Maps.create(id);
  mapaActual = id;
  zonaSegura.x = MAP_WIDTH / 2;
  zonaSegura.y = id === 'orbital' ? 3600 : MAP_HEIGHT / 2;
  zonaSegura.radio = Math.hypot(MAP_WIDTH, MAP_HEIGHT) / 2;
  obstaculos.splice(0, obstaculos.length, ...map.obstacles);
  portales.splice(0, portales.length, ...map.portals);
  navegacion = id === 'orbital' ? new Navigation(obstaculos) : null;
  rutasBots.clear();
  plataformas.splice(0, plataformas.length, ...map.platforms);
  cofres.length = 0;
  itemsEnSuelo.length = 0;
  balas.length = 0;
  granadas.length = 0;
  prepararObjetosMapa();
  generarZonasEspeciales();
}
function generarZonasEspeciales() {
  if (mapaActual === 'orbital') SpecialZones.generateStation(Maps.stationLayout().rooms);
  else SpecialZones.generate(MAP_WIDTH, MAP_HEIGHT, obstaculos.filter(Buildings.isBuilding));
}
function cerrarPuertas() {
  for (const edificio of obstaculos.filter(Buildings.isBuilding)) {
    edificio.puertaAbierta = false;
    for (const puerta of edificio.puertas || []) puerta.abierta = false;
  }
}
function actualizarVotacionMapa() {
  if (!votacionMapa || votacionMapa.ganador) return;
  if (votacionMapa.close(Date.now())) {
    mapaSiguiente = votacionMapa.ganador;
    broadcast('configPartida', reglasPartida());
    publicarSala();
  }
  const state = votacionMapa.snapshot(Date.now());
  if (state.segundos !== ultimoSegundoVotacion) {
    ultimoSegundoVotacion = state.segundos;
    broadcast('estadoVotacion', state);
  }
  if (votacionMapa.ganador && siguienteRonda) {
    const participantes = [...siguienteRonda.ids].filter(id => jugadores[id] && !jugadores[id].esBot);
    const opciones = siguienteRonda.opciones;
    siguienteRonda = null;
    if (!participantes.length) return;
    opcionesSala = { ...opciones, mapa: mapaSiguiente };
    anfitrionId = participantes[0];
    for (const id of participantes) jugadores[id].unido = true;
    mapaSiguiente = null;
    cargarMapa(opcionesSala.mapa);
    publicarSala();
    iniciarDesdeSala(anfitrionId);
  }
}

function iniciarPartida(opciones = {}) {
  if (partidaEnCurso || partidaFinalizada) return;
  if (Maps.valid(opciones.mapa)) cargarMapa(opciones.mapa);
  cerrarPuertas();
  rutasBots.clear();
  cofres.length = 0;
  itemsEnSuelo.length = 0;
  prepararObjetosMapa();
  generarZonasEspeciales();
  broadcast('configMapa', configMapa());
  limiteKills = [5, 10, 20, 30].includes(opciones.limiteKills) ? opciones.limiteKills : 10;
  duracionPartida = [60, 120, 180, 300].includes(opciones.duracion) ? opciones.duracion : 120;
  modoSoloJugador = opciones.soloJugador === true;
  dificultadBots = validarDificultad(opciones.dificultadBots);
  zonaSegura.x = MAP_WIDTH / 2;
  zonaSegura.y = mapaActual === 'orbital' ? 3600 : MAP_HEIGHT / 2;
  zonaSegura.radio = Math.hypot(MAP_WIDTH, MAP_HEIGHT) / 2;
  const nuevosBots = [0, 5, 11, 15, 20].includes(opciones.cantidadBots) ? opciones.cantidadBots : 11;
  if (nuevosBots !== cantidadBots) {
    for (const [id, jugador] of Object.entries(jugadores)) {
      if (jugador.esBot) delete jugadores[id];
    }
    cantidadBots = nuevosBots;
    for (let index = 1; index <= cantidadBots; index += 1) generarBot(`bot${index}`);
  }
  puntosEquipos = { azul: 0, rojo: 0 };
  equilibrarEquipos();
  partidaEnCurso = true;
  tiempoRestante = duracionPartida;
  broadcast('configPartida', reglasPartida());
  // Reinicia la zona segura al tamaño máximo del mapa.
  zonaSegura.fase = 0;
  zonaSegura.dañoPorSegundo = 0;
  ultimoDañoZona = Date.now();
  broadcast('tiempoPartida', tiempoRestante);
  temporizadorPartida = setInterval(() => {
    if (!partidaEnCurso || Date.now() < finPreparacion) return;
    tiempoRestante -= 1;
    broadcast('tiempoPartida', tiempoRestante);
    if (tiempoRestante <= 0) finalizarPartida();
  }, 1000);
  prepararCierreZona(Math.max(Date.now(), finPreparacion), ZONA_ESPERA_INICIAL);
  zonaSegura.segundosEtapa = 20;
  broadcast('zonaActualizada', { ...zonaSegura });
}

function finalizarPartida() {
  if (!partidaEnCurso || partidaFinalizada) return;
  partidaEnCurso = false;
  partidaFinalizada = true;
  broadcast('configPartida', reglasPartida());
  if (temporizadorPartida) clearInterval(temporizadorPartida);
  if (temporizadorZona) { clearTimeout(temporizadorZona); temporizadorZona = null; }
  temporizadorPartida = null;

  const podio = Object.entries(jugadores)
    .filter(([, jugador]) => jugador.unido)
    .sort(([, first], [, second]) => (second.kills || 0) - (first.kills || 0))
    .map(([id, jugador]) => ({ id, nombre: jugador.nombre, skin: jugador.skin, esBot: jugador.esBot,
      equipo: jugador.equipo ?? null, kills: jugador.kills || 0 }));
  broadcast('finDeJuego', podio);

  votacionMapa = new MapVote(podio.filter(jugador => !jugador.esBot).map(jugador => jugador.id), mapaActual, Date.now());
  siguienteRonda = { ids: new Set(votacionMapa.electores), opciones: { ...reglasPartida(), ...opcionesSala } };
  ultimoSegundoVotacion = 15;
  broadcast('estadoVotacion', votacionMapa.snapshot(Date.now()));
  reiniciarMundo();
}

function reiniciarMundo() {
    jugadoresAusentes.clear();
    for (const jugador of Object.values(jugadores)) {
      jugador.vida = 100;
      jugador.escudo = 0;
      jugador.kills = 0;
      jugador.muerto = false;
      limpiarAbatido(jugador);
      jugador.recargando = false;
      jugador.recargaId = (jugador.recargaId || 0) + 1;
      jugador.reservas = nuevasReservas();
      const invReset = Array(INVENTARIO_SIZE).fill(null);
      invReset[0] = jugador.esBot ? 'pistola' : 'puños';
      jugador.inventario = invReset;
      jugador.slotSeleccionado = 0;
      jugador.balasEnCargador = 0;
      jugador.municionPorSlot = Array(INVENTARIO_SIZE).fill(null);
      jugador.ultimoDisparo = 0;
      jugador.unido = jugador.esBot;
      if (jugador.esBot) { jugador.municionPorSlot[0] = 12; jugador.reservas.pistola = 24; equiparArma(jugador); }
    }
    balas.length = 0;
    granadas.length = 0;
    itemsEnSuelo.length = 0;
    for (const jugador of Object.values(jugadores)) equipoInicial(jugador);
    cofres.forEach((cofre) => { cofre.abierto = false; });
    generarMunicionMapa();
    cerrarPuertas();
    plataformas.forEach((plataforma) => { plataforma.objeto = null; });
    tiempoRestante = 120;
    partidaFinalizada = false;
    modoSoloJugador = false;
    anfitrionId = null;
    opcionesSala = {};
    puntosEquipos = { azul: 0, rojo: 0 };
    for (const jugador of Object.values(jugadores)) jugador.equipo = null;
    finPreparacion = 0;
    preparacionTactica = null;
    botsCompraron = false;
    broadcast('configPartida', reglasPartida());
    broadcast('reinicioPartida', {});
    publicarSala();
}

function cerrarSala(id) {
  if (id !== anfitrionId || partidaEnCurso || partidaFinalizada) return;
  reiniciarMundo();
}

function unirseJugador(id, nombre, client = null, skin = 'pulse', opciones = {}) {
  const jugador = jugadores[id];
  if (!jugador || jugador.esBot || jugador.unido || partidaFinalizada) return;
  actualizarVotacionMapa();
  if (votacionMapa && !votacionMapa.ganador) {
    if (client) sendToClient(client, 'entradaRechazada', { motivo: 'votacionEnCurso' });
    return;
  }
  const anterior = jugadoresAusentes.get(id);
  if (partidaEnCurso && anterior && client) {
    jugadores[id] = anterior.jugador;
    jugadoresAusentes.delete(id);
    if (preparacionTactica && anterior.cuenta) {
      anterior.cuenta.training.input = { x: 0, y: 0 };
      anterior.cuenta.training.inputAt = -Infinity;
      anterior.cuenta.training.lastTick = Date.now();
      preparacionTactica.accounts.set(id, anterior.cuenta);
    }
    publicarSala();
    sendToClient(client, 'configPartida', reglasPartida());
    sendToClient(client, 'inicioPartida', {
      tiempoRestante, preparacionRestante: segundosPreparacion(),
      preparacionTactica: preparacionTactica?.snapshot(Date.now(), id) ?? null,
    });
    return;
  }
  if (partidaEnCurso || (anfitrionId && opcionesSala.soloJugador)) {
    if (client) sendToClient(client, 'entradaRechazada', { motivo: partidaEnCurso ? 'partidaEnCurso' : 'soloJugador' });
    return;
  }
  if (anfitrionId && opciones.soloJugador === true) {
    if (client) sendToClient(client, 'entradaRechazada', { motivo: 'modoIncompatible' });
    return;
  }
  if (!anfitrionId) {
    const mapa = mapaSiguiente || (Maps.valid(opciones.mapa) ? opciones.mapa : 'outpost');
    mapaSiguiente = null;
    votacionMapa = null;
    cargarMapa(mapa);
    anfitrionId = id;
    opcionesSala = {
      mapa,
      limiteKills: [5,10,20,30].includes(opciones.limiteKills) ? opciones.limiteKills : 10,
      duracion: [60,120,180,300].includes(opciones.duracion) ? opciones.duracion : 120,
      cantidadBots: [0,5,11,15,20].includes(opciones.cantidadBots) ? opciones.cantidadBots : 11,
      dificultadBots: validarDificultad(opciones.dificultadBots),
      soloJugador: opciones.soloJugador === true,
      modoArena: opciones.soloJugador !== true && ['puzzles', 'equipos'].includes(opciones.modoArena) ? opciones.modoArena : 'clasico',
    };
    broadcast('configMapa', configMapa());
    broadcast('configPartida', reglasPartida());
  }
  const nombreLimpio = typeof nombre === 'string' ? nombre.trim().slice(0, 16) : '';
  jugador.nombre = nombreLimpio || `Jugador_${id.slice(0, 5)}`;
  jugador.skin = skins.some((candidate) => candidate.id === skin) ? skin : 'pulse';
  jugador.unido = true;
  equipoInicial(jugador);
  equilibrarEquipos();
  publicarSala();
  // Asigna posición dentro de la zona segura al unirse
  const spawn = obtenerPosicionSpawn();
  jugador.x = spawn.x;
  jugador.y = spawn.y;
  if (client && partidaEnCurso) sendToClient(client, 'inicioPartida', { tiempoRestante });
}

const PLAYER_RADIUS = 24;

function colisionaConObstaculo(x, y, radius = PLAYER_RADIUS) {
  return obstaculos.flatMap(Buildings.walls).some((obstaculo) => {
    const closestX = Math.max(obstaculo.x, Math.min(x, obstaculo.x + obstaculo.width));
    const closestY = Math.max(obstaculo.y, Math.min(y, obstaculo.y + obstaculo.height));
    return Math.hypot(x - closestX, y - closestY) < radius;
  });
}

function puntoEnObstaculo(x, y) {
  return obstaculos.flatMap(Buildings.walls).some((obstaculo) => (
    x >= obstaculo.x && x <= obstaculo.x + obstaculo.width
    && y >= obstaculo.y && y <= obstaculo.y + obstaculo.height
  ));
}

/** Busca una posición de aparición libre, dentro de la zona segura y fuera de obstáculos. */
function obtenerPosicionSpawn() {
  const minX = Math.max(RESPAWN_MARGIN, zonaSegura.x - zonaSegura.radio + 60);
  const maxX = Math.min(MAP_WIDTH - RESPAWN_MARGIN, zonaSegura.x + zonaSegura.radio - 60);
  const minY = Math.max(RESPAWN_MARGIN, zonaSegura.y - zonaSegura.radio + 60);
  const maxY = Math.min(MAP_HEIGHT - RESPAWN_MARGIN, zonaSegura.y + zonaSegura.radio - 60);
  for (let intento = 0; intento < 150; intento += 1) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    // Rechaza posiciones fuera de la zona segura (con margen de 60px para no spawnear justo en el borde)
    if (zonaSegura && Math.hypot(x - zonaSegura.x, y - zonaSegura.y) > zonaSegura.radio - 60) continue;
    const ocupado = Object.values(jugadores).some((jugador) => (
      !jugador.muerto && Math.hypot(jugador.x - x, jugador.y - y) < PLAYER_RADIUS * 3
    ));
    if (!colisionaConObstaculo(x, y) && !ocupado && !SpecialZones.zones.some((zone) => Math.hypot(x - zone.x, y - zone.y) <= zone.radio + PLAYER_RADIUS)) return { x, y };
  }

  if (navegacion) {
    const candidatos = [...navegacion.nodes.values()].sort((a, b) => Math.hypot(a.x - zonaSegura.x, a.y - zonaSegura.y)
      - Math.hypot(b.x - zonaSegura.x, b.y - zonaSegura.y));
    const libre = candidatos.find(({ x, y }) => Math.hypot(x - zonaSegura.x, y - zonaSegura.y) <= zonaSegura.radio - 60
      && !colisionaConObstaculo(x, y)
      && !SpecialZones.zones.some(zone => Math.hypot(x - zone.x, y - zone.y) <= zone.radio + PLAYER_RADIUS));
    if (!libre) throw new Error('No hay suelo transitable para reaparecer dentro de la estación');
    return { x: libre.x, y: libre.y };
  }
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
  if (!jugador.municionPorSlot) jugador.municionPorSlot = Array(INVENTARIO_SIZE).fill(null);
  jugador.balasEnCargador = stats.capacidadCargador > 0
    ? (jugador.municionPorSlot[slot] ?? 0)
    : 0;
  jugador.recargando = false;
  jugador.recargaId = (jugador.recargaId || 0) + 1;
}

/** Inicia una recarga para humanos y bots, evitando dobles temporizadores. */
function iniciarRecarga(id) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto || jugador.abatido || jugador.reanimando || jugador.recargando) return;
  const arma = armaActual(jugador);
  const slot = jugador.slotSeleccionado;
  const stats = STATS_ARMAS[arma];
  if (!stats || stats.tipo === 'consumible' || !stats.capacidadCargador
    || jugador.balasEnCargador >= stats.capacidadCargador || (!jugador.esBot && !(jugador.reservas?.[arma] > 0))) return;

  jugador.recargando = true;
  const recargaId = ++jugador.recargaId;
  setTimeout(() => {
    // El jugador puede haber cambiado de arma o muerto durante la recarga.
    if (!partidaEnCurso || !jugadores[id] || jugadores[id] !== jugador || jugador.muerto
      || jugador.recargaId !== recargaId || jugador.slotSeleccionado !== slot || armaActual(jugador) !== arma) return;
    const faltantes = stats.capacidadCargador - jugador.balasEnCargador;
    const cantidad = jugador.esBot ? faltantes : Math.min(faltantes, jugador.reservas[arma]);
    if (!jugador.esBot) jugador.reservas[arma] -= cantidad;
    jugador.balasEnCargador += cantidad;
    jugador.municionPorSlot[slot] = jugador.balasEnCargador;
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
    reservas: nuevasReservas(),
    esBot: false,
    nombre: `Jugador_${id.slice(0, 5)}`,
    unido: false,
    skin: 'pulse',
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
  mun[0] = 12;
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
    reservas: { ...nuevasReservas(), pistola: 24 },
    kills: 0,
    esBot: true,
    nombre: `BOT_${id}`,
    unido: true,
    skin: skins[Number(id.replace('bot', '')) % skins.length].id,
  };
  equiparArma(jugadores[id]);
}

function removePlayer(id, conservar = false) {
  siguienteRonda?.ids.delete(id);
  if (conservar && partidaEnCurso && jugadores[id]?.unido) {
    const jugador = jugadores[id];
    jugador.recargando = false;
    jugador.recargaId = (jugador.recargaId || 0) + 1;
    jugadoresAusentes.set(id, { jugador, cuenta: preparacionTactica?.accounts.get(id) });
  } else {
    jugadoresAusentes.delete(id);
  }
  preparacionTactica?.accounts.delete(id);
  delete jugadores[id];
  if (partidaEnCurso && !Object.values(jugadores).some(j => j.unido && !j.esBot)) {
    partidaEnCurso = false;
    if (temporizadorPartida) clearInterval(temporizadorPartida);
    temporizadorPartida = null;
    reiniciarMundo();
  }
  if (id === anfitrionId) {
    anfitrionId = Object.keys(jugadores).find(key => jugadores[key].unido && !jugadores[key].esBot) || null;
    if (!anfitrionId) opcionesSala = {};
  }
  if (!partidaEnCurso) equilibrarEquipos();
  publicarSala();
  broadcast('jugadorDesconectado', id);
  console.log(`Desconectado: ${id}`);
}

function abandonarPartida(id, client) {
  if (!jugadores[id] || !client) return;
  siguienteRonda?.ids.delete(id);
  if (jugadores[id].unido) {
    for (let index = balas.length - 1; index >= 0; index -= 1) {
      if (balas[index].propietarioId === id) balas.splice(index, 1);
    }
    for (let index = granadas.length - 1; index >= 0; index -= 1) {
      if (granadas[index].lanzadorId === id) granadas.splice(index, 1);
    }
    removePlayer(id, true);
    // Conserva el transporte y la identidad para poder crear o unirse a otra sala.
    addPlayer(id);
  }
  sendToClient(client, 'salidaPartida', {});
}

const tiemposMovimiento = new WeakMap();
function updateMovement(id, { x, y, angle } = {}) {
  if (!partidaEnCurso || !jugadores[id] || jugadores[id].muerto
    || Date.now() < (jugadores[id].portalMovimientoHasta || 0)
    || (!jugadores[id].esBot && !jugadores[id].unido)
    || ![x, y, angle].every(Number.isFinite)) return;
  const jugador = jugadores[id];
  const ahora = Date.now();
  const elapsed = Math.max(0, Math.min(0.1, (ahora - (tiemposMovimiento.get(jugador) ?? ahora - 1000 / TICK_RATE)) / 1000));
  tiemposMovimiento.set(jugador, ahora);
  const multiplier = SpecialZones.effects(jugador).speedMultiplier * (jugador.abatido ? 0.2 : 1);
  if (multiplier < 1) {
    const distance = Math.hypot(x - jugador.x, y - jugador.y);
    const limit = 400 * multiplier * elapsed;
    if (distance > limit) {
      x = jugador.x + (x - jugador.x) * limit / distance;
      y = jugador.y + (y - jugador.y) * limit / distance;
    }
  }
  moverEntidad(jugador, x, y);
  jugadores[id].angle = angle;
}

function createBullet(id, { x, y, angle } = {}) {
  if (!partidaEnCurso || !jugadores[id] || jugadores[id].muerto
    || jugadores[id].abatido || jugadores[id].reanimando
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
  jugador.ultimoDisparoArma = nombreArma;
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
      daño: stats.daño * (1 + 0.0015 * (jugador.rarezas?.[jugador.slotSeleccionado] || 0)),
      rango: stats.rango,
      distanciaRecorrida: 0,
      arma: nombreArma,
      disparoEn: ahora,
      equipo: jugador.equipo ?? null,
      // ID común para Socket.IO y WebSocket nativo; se usa al confirmar una baja.
      propietarioId: id,
      // Alias temporal para compatibilidad con balas creadas por una versión anterior.
      ownerId: id,
    });
  }
}

function selectInventorySlot(id, { slot } = {}) {
  if (!jugadores[id] || jugadores[id].muerto || jugadores[id].abatido || jugadores[id].reanimando
    || !Number.isInteger(slot) || slot < 0 || slot >= INVENTARIO_SIZE) return;
  jugadores[id].slotSeleccionado = slot;
  equiparArma(jugadores[id]);
}

function reloadWeapon(id) {
  iniciarRecarga(id);
}

function usarPortal(jugador, portal) {
  if (!partidaEnCurso || Date.now() < finPreparacion || !jugador?.unido || jugador.muerto
    || jugador.abatido || jugador.reanimando || Date.now() < (jugador.portalHasta || 0)
    || Math.hypot(jugador.x - portal.x, jugador.y - portal.y) > 105) return false;
  const destino = portales.find(candidate => candidate.id === portal.destinoId);
  if (!destino || colisionaConObstaculo(destino.x, destino.y)) return false;
  Object.assign(jugador, { x: destino.x, y: destino.y, portalHasta: Date.now() + 3000,
    portalMovimientoHasta: Date.now() + 200 });
  tiemposMovimiento.delete(jugador);
  return true;
}

function interactuar(id) {
  const jugador = jugadores[id];
  if (!jugador?.unido || jugador.muerto || jugador.abatido || jugador.reanimando) return;
  const portal = portales.find(candidate => Math.hypot(jugador.x - candidate.x, jugador.y - candidate.y) <= 105);
  if (portal) { usarPortal(jugador, portal); return; }
  const cofre = cofres.find((candidate) => !candidate.abierto && Math.hypot(jugador.x - candidate.x, jugador.y - candidate.y) <= 105);
  if (cofre) {
    cofre.abierto = true;
    const armas = Object.keys(MUNICION_CAJA);
    const arma = armas[Math.floor(Math.random() * armas.length)];
    const regalos = [
      { item: arma, balas: STATS_ARMAS[arma].capacidadCargador, rareza: rarezaAleatoria() },
      { item: `ammo_${arma}`, cantidad: MUNICION_CAJA[arma] },
      { item: Math.random() < 0.5 ? 'botiquin' : 'escudo_pocion' },
    ];
    regalos.forEach((regalo, index) => itemsEnSuelo.push({ id: `drop_${nextItemId++}`, x: cofre.x + (index - 1) * 65, y: cofre.y + 60, ...regalo }));
    return;
  }
  const cercano = obstaculos.filter(Buildings.isBuilding).flatMap(edificio => Buildings.doors(edificio).map(puerta => ({
    edificio, puerta, distancia: Math.hypot(jugador.x - puerta.x - puerta.width / 2, jugador.y - puerta.y - puerta.height / 2),
  }))).filter((candidate) => candidate.distancia <= 105).sort((left, right) => left.distancia - right.distancia)[0];
  if (!cercano) { exchangeWithPlatform(id); return; }
  const { edificio, puerta } = cercano;
  if (puerta.abierta && Object.values(jugadores).some((player) => player.unido && !player.muerto
    && player.x > puerta.x - PLAYER_RADIUS && player.x < puerta.x + puerta.width + PLAYER_RADIUS
    && player.y > puerta.y - PLAYER_RADIUS && player.y < puerta.y + puerta.height + PLAYER_RADIUS)) return;
  if (edificio.puertas) edificio.puertas[puerta.index].abierta = !puerta.abierta;
  else edificio.puertaAbierta = !puerta.abierta;
}

/** Intercambia el objeto del slot seleccionado por el botín de una plataforma cercana. */
function exchangeWithPlatform(id) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto || jugador.abatido || jugador.reanimando) return;

  const plataforma = plataformas.find((candidate) => (
    candidate.objeto !== null
    && Math.hypot(jugador.x - candidate.x, jugador.y - candidate.y) <= PLATFORM_RADIUS
  ));
  if (!plataforma) return;

  const slot = jugador.slotSeleccionado;
  const objetoEnMano = jugador.inventario[slot];
  if (objetoEnMano === 'puños') return;
  if (MUNICION_CAJA[plataforma.objeto] && jugador.inventario.includes(plataforma.objeto)) {
    recogerObjeto(jugador, plataforma.objeto, plataforma.balas, null, plataforma.rareza);
    plataforma.objeto = null;
    plataforma.balas = null;
    return;
  }
  const cargador = jugador.municionPorSlot[slot];
  jugador.rarezas ||= Array(INVENTARIO_SIZE).fill(0);
  const rarezaAnterior = jugador.rarezas[slot];
  jugador.rarezas[slot] = plataforma.rareza || 0;
  plataforma.rareza = rarezaAnterior;
  jugador.inventario[slot] = plataforma.objeto;
  jugador.municionPorSlot[slot] = plataforma.balas ?? STATS_ARMAS[plataforma.objeto]?.capacidadCargador ?? null;
  plataforma.objeto = objetoEnMano;
  plataforma.balas = cargador;
  equiparArma(jugador);
}

function dropItem(id, { slot } = {}) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto || jugador.abatido || jugador.reanimando) return;
  const slotIndex = typeof slot === 'number' ? slot : jugador.slotSeleccionado;
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= INVENTARIO_SIZE) return;
  const item = jugador.inventario[slotIndex];
  // No se puede tirar si no hay nada o si es el único slot con arma y no hay más.
  if (!item || item === 'puños') return;
  const itemId = `drop_${nextItemId++}`;
  // El item cae cerca del jugador con un pequeño desplazamiento.
  const offsetAngle = jugador.angle + Math.PI; // cae detrás del jugador
  itemsEnSuelo.push({
    id: itemId,
    x: jugador.x + Math.cos(offsetAngle) * 60,
    y: jugador.y + Math.sin(offsetAngle) * 60,
    item,
    balas: jugador.municionPorSlot[slotIndex],
    rareza: jugador.rarezas?.[slotIndex] || 0,
  });
  jugador.inventario[slotIndex] = null;
  jugador.municionPorSlot[slotIndex] = null;
  if (slotIndex === jugador.slotSeleccionado) equiparArma(jugador);
}

const ultimasReacciones = new WeakMap();
function enviarReaccion(id, data, client) {
  const jugador = jugadores[id];
  if (!jugador?.unido || jugador.muerto) return;
  if (!reactions.some(reaction => reaction.id === data?.reaccion)) {
    if (client) sendToClient(client, 'reaccionRechazada', { motivo: 'Reacción no válida.' });
    return;
  }
  if (Date.now() - (ultimasReacciones.get(jugador) ?? -Infinity) < 2000) {
    if (client) sendToClient(client, 'reaccionRechazada', { motivo: 'Espera un momento antes de enviar otra reacción.' });
    return;
  }
  ultimasReacciones.set(jugador, Date.now());
  jugador.reaccion = data.reaccion;
  jugador.reaccionHasta = Date.now() + 3000;
}

function processClientMessage(id, message, client = null) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'votarMapa') {
    actualizarVotacionMapa();
    const error = votacionMapa ? votacionMapa.vote(id, message.data?.mapa, Date.now()) : 'No hay una votación disponible.';
    if (error && client) sendToClient(client, 'votoRechazado', { motivo: error });
    else if (!error) broadcast('estadoVotacion', votacionMapa.snapshot(Date.now()));
    return;
  }
  if (message.type === 'abandonarPartida') {
    abandonarPartida(id, client);
    return;
  }
  if (partidaEnCurso && jugadores[id]?.unido && preparacionTactica) {
    if (message.type === 'moverEntrenamiento') preparacionTactica.move(id, message.data, Date.now());
    if (message.type === 'comprarEquipo') preparacionTactica.buy(id, message.data?.item, Date.now(), item => concederCompra(id, item));
  }
  if (message.type === 'cerrarSala') cerrarSala(id);
  if (message.type === 'iniciarSala') iniciarDesdeSala(id);
  if (message.type === 'unirse') unirseJugador(id, message.data?.nombre, client, message.data?.skin, message.data);
  if (!partidaEnCurso || Date.now() < finPreparacion || !jugadores[id]?.unido) return;
  if (message.type === 'reaccion') enviarReaccion(id, message.data, client);
  if (message.type === 'movimiento') updateMovement(id, message.data);
  if (message.type === 'reanimar') reanimar(id, message.data);
  if (message.type === 'disparar') createBullet(id, message.data);
  if (message.type === 'cambiarSlot') selectInventorySlot(id, message.data);
  if (message.type === 'intercambiar') interactuar(id);
  if (message.type === 'recargar') reloadWeapon(id);
  if (message.type === 'tirarItem') dropItem(id, message.data);
  if (message.type === 'lanzarGranada') lanzarGranada(id, message.data);
}

// Los bots existen desde el arranque y aparecen en el mismo objeto que los jugadores.
for (let index = 1; index <= cantidadBots; index += 1) generarBot(`bot${index}`);

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
    sendToClient(socket, 'configPartida', reglasPartida());
    sendToClient(socket, 'estadoSala', estadoSala());
    sendToClient(socket, 'configMapa', configMapa());

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
    sendToClient(socket, 'configMapa', configMapa());
    sendToClient(socket, 'configPartida', reglasPartida());
    sendToClient(socket, 'estadoSala', estadoSala());

    for (const type of ['votarMapa', 'abandonarPartida', 'moverEntrenamiento', 'comprarEquipo', 'cerrarSala', 'iniciarSala', 'movimiento', 'unirse', 'disparar', 'cambiarSlot', 'intercambiar', 'recargar', 'tirarItem', 'lanzarGranada', 'reanimar', 'reaccion']) {
      socket.on(type, (data) => processClientMessage(id, { type, data }, socket));
    }
    socket.on('disconnect', () => removePlayer(id));
  });
}

function respawn(jugador, asesino = null) {
  limpiarAbatido(jugador);
  // Suelta todo el inventario en el suelo antes de morir.
  for (const [slot, item] of jugador.inventario.entries()) {
    if (!item || item === 'puños') continue;
    const spread = (Math.random() - 0.5) * 80;
    const spreadY = (Math.random() - 0.5) * 80;
    let cargador = jugador.municionPorSlot[slot] || 0;
    if (MUNICION_CAJA[item] && asesino && asesino !== jugador && asesino.inventario.includes(item)) {
      asesino.reservas[item] += cargador;
      cargador = 0;
    }
    itemsEnSuelo.push({
      id: `drop_${nextItemId++}`,
      x: Math.max(0, Math.min(MAP_WIDTH, jugador.x + spread)),
      y: Math.max(0, Math.min(MAP_HEIGHT, jugador.y + spreadY)),
      item,
      balas: cargador,
      rareza: jugador.rarezas?.[slot] || 0,
    });
  }
  for (const [arma, cantidad] of Object.entries(jugador.reservas)) {
    if (cantidad <= 0) continue;
    if (asesino && asesino !== jugador && asesino.inventario.includes(arma)) asesino.reservas[arma] += cantidad;
    else itemsEnSuelo.push({ id: `drop_${nextItemId++}`, x: jugador.x + 35, y: jugador.y, item: `ammo_${arma}`, cantidad });
  }
  jugador.reservas = nuevasReservas();
  jugador.recargaId = (jugador.recargaId || 0) + 1;

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
    equipoInicial(jugador);
    // La regla de los bots prevalece: reaparecen siempre con al menos pistola.
    if (jugador.esBot) {
      const tieneArma = jugador.inventario.some((it) => it && STATS_ARMAS[it] && !STATS_ARMAS[it].tipo);
      if (!tieneArma) { jugador.inventario[0] = 'pistola'; jugador.municionPorSlot[0] = 12; jugador.reservas.pistola = 24; }
    }
    equiparArma(jugador);
  }
}

/** Ejecuta la IA de un bot una vez por tick del servidor. */
function actualizarBots() {
  if (!partidaEnCurso) return;
  const dificultad = BOT_DIFFICULTIES[dificultadBots];
  for (const [botId, bot] of Object.entries(jugadores)) {
    if (!bot.esBot || !bot.unido || bot.muerto || bot.abatido || bot.vida <= 0) continue;

    let objetivo = esDueloEquipos() ? Object.values(jugadores).filter(j => j.unido && j.abatido && !j.muerto
      && Teams.same(bot, j) && Math.hypot(bot.x - j.x, bot.y - j.y) < 900)
      .sort((a, b) => Math.hypot(bot.x - a.x, bot.y - a.y) - Math.hypot(bot.x - b.x, bot.y - b.y))[0] : null;
    const rescatando = !!objetivo;
    let distanciaObjetivo = objetivo ? Math.hypot(bot.x - objetivo.x, bot.y - objetivo.y) : Infinity;
    if (rescatando && puedeReanimar(bot, objetivo)) { reanimar(botId, { activo: true }); continue; }
    bot.reanimando = null;
    for (const [id, candidato] of Object.entries(jugadores)) {
      if (rescatando) break;
      // Ahora los bots pueden elegir como objetivo a humanos u otros bots.
      if (id === botId || !candidato.unido || candidato.muerto || candidato.vida <= 0
        || (esDueloEquipos() && Teams.same(bot, candidato))) continue;
      if (Buildings.concealed(obstaculos, candidato, bot)) continue;
      const distancia = Math.hypot(candidato.x - bot.x, candidato.y - bot.y);
      if (distancia < distanciaObjetivo) {
        distanciaObjetivo = distancia;
        objetivo = candidato;
      }
    }
    if (!objetivo) continue;
    if (Date.now() >= (bot.portalHasta || 0)) {
      const directo = Math.hypot(bot.x - objetivo.x, bot.y - objetivo.y);
      const atajo = portales.map(portal => {
        const salida = portales.find(candidate => candidate.id === portal.destinoId);
        return { portal, coste: Math.hypot(bot.x - portal.x, bot.y - portal.y)
          + Math.hypot(salida.x - objetivo.x, salida.y - objetivo.y) + 400 };
      }).filter(candidate => candidate.coste < directo).sort((a, b) => a.coste - b.coste)[0];
      if (atajo) {
        if (usarPortal(bot, atajo.portal)) { rutasBots.delete(botId); continue; }
        objetivo = atajo.portal;
        distanciaObjetivo = Math.hypot(bot.x - objetivo.x, bot.y - objetivo.y);
      }
    }

    // Garantiza que el bot nunca se quede sin arma real. Puños no cuenta como arma.
    const esArmaDisparable = (it, slot) => it && it !== 'puños' && STATS_ARMAS[it]?.capacidadCargador
      && (bot.esBot || (bot.municionPorSlot[slot] || 0) > 0 || (bot.reservas[it] || 0) > 0);
    const tieneArma = bot.inventario.some(esArmaDisparable);
    if (!tieneArma) {
      let slot = bot.inventario.indexOf('puños');
      if (slot === -1) slot = bot.inventario.indexOf(null);
      if (slot === -1) slot = bot.slotSeleccionado;
      bot.inventario[slot] = 'puños';
      bot.municionPorSlot[slot] = 0;
      if (bot.slotSeleccionado !== slot) { bot.slotSeleccionado = slot; equiparArma(bot); }
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
      if (recogerObjeto(bot, drop.item, drop.balas, drop.cantidad, drop.rareza)) itemsEnSuelo.splice(i, 1);
    }

    const dx = objetivo.x - bot.x;
    const dy = objetivo.y - bot.y;
    bot.angle = Math.atan2(dy, dx);

    // Se acerca sin abandonar los límites del mapa.
    if (distanciaObjetivo > 55 || rescatando) {
      let destino = objetivo;
      if (navegacion) {
        for (const edificio of obstaculos.filter(Buildings.isBuilding)) {
          for (const puerta of Buildings.doors(edificio)) {
            if (Math.hypot(bot.x - puerta.x - puerta.width / 2, bot.y - puerta.y - puerta.height / 2) < 140) {
              edificio.puertas[puerta.index].abierta = true;
            }
          }
        }
        let ruta = rutasBots.get(botId);
        if (!ruta || Date.now() >= ruta.hasta || Math.hypot(objetivo.x - ruta.x, objetivo.y - ruta.y) > 200) {
          ruta = { puntos: navegacion.path(bot, objetivo), hasta: Date.now() + 1500, x: objetivo.x, y: objetivo.y };
          rutasBots.set(botId, ruta);
        }
        while (ruta.puntos.length && Math.hypot(bot.x - ruta.puntos[0].x, bot.y - ruta.puntos[0].y) < 12) ruta.puntos.shift();
        if (ruta.puntos.length) destino = ruta.puntos[0];
      }
      const direccion = Math.atan2(destino.y - bot.y, destino.x - bot.x);
      moverEntidad(
        bot,
        bot.x + Math.cos(direccion) * (dificultad.velocidad / TICK_RATE) * SpecialZones.effects(bot).speedMultiplier,
        bot.y + Math.sin(direccion) * (dificultad.velocidad / TICK_RATE) * SpecialZones.effects(bot).speedMultiplier,
      );
    }

    // Reutiliza la misma lógica de disparo, cooldown y dispersión que un humano.
    const cuerpoACuerpo = armaActual(bot) === 'puños';
    if (!rescatando && !objetivo.destinoId && distanciaObjetivo < (cuerpoACuerpo ? 100 : dificultad.alcance)) {
      if (!cuerpoACuerpo && bot.balasEnCargador <= 0) {
        iniciarRecarga(botId);
        continue;
      }
      if (bot.recargando) continue;
      if (Date.now() - bot.ultimoDisparo < dificultad.intervaloDisparo) continue;
      const error = cuerpoACuerpo ? 0 : (Math.random() * 2 - 1) * dificultad.errorPunteria;
      createBullet(botId, { x: bot.x, y: bot.y, angle: bot.angle + error });
    }
  }
}

function lanzarGranada(id, { angle } = {}) {
  const jugador = jugadores[id];
  if (!jugador || jugador.muerto || jugador.abatido || jugador.reanimando || !partidaEnCurso) return;
  if (!Number.isFinite(angle)) return;
  const slotGranada = jugador.inventario.indexOf('granada');
  if (slotGranada === -1) return;
  const ahora = Date.now();
  if (ahora - jugador.ultimoDisparo < (STATS_ARMAS.granada.cooldown || 1500)) return;
  jugador.ultimoDisparo = ahora;
  jugador.ultimoDisparoArma = 'granada';
  jugador.inventario[slotGranada] = null;
  jugador.municionPorSlot[slotGranada] = null;
  if (jugador.slotSeleccionado === slotGranada) equiparArma(jugador);
  granadas.push({
    id: `g_${nextGranadaId++}`,
    x: jugador.x + Math.cos(angle) * MUZZLE_OFFSET,
    y: jugador.y + Math.sin(angle) * MUZZLE_OFFSET,
    angle,
    lanzadorId: id,
    equipo: jugador.equipo ?? null,
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
      if (jugador.muerto || !jugador.unido
        || (esDueloEquipos() && (jid === g.lanzadorId || Teams.same({ equipo: g.equipo }, jugador)))) continue;
      const dist = Math.hypot(jugador.x - g.x, jugador.y - g.y);
      if (dist > GRANADA_RADIO_EXPLOSION) continue;
      const daño = Math.round(GRANADA_DAÑO * (1 - dist / GRANADA_RADIO_EXPLOSION));
      const dañoEscudo = Math.min(jugador.escudo, daño);
      jugador.escudo -= dañoEscudo;
      jugador.vida -= daño - dañoEscudo;
      jugador.escudo = Math.max(0, jugador.escudo);
      if (jugador.vida <= 0) {
        const lanzador = jugadores[g.lanzadorId];
        if (resolverBaja(jugador, lanzador, 'granada')) return;
      }
    }
    broadcast('explosion', { x: g.x, y: g.y, radio: GRANADA_RADIO_EXPLOSION });
    granadas.splice(i, 1);
  }
}

function aplicarDañoZona() {
  if (!partidaEnCurso || zonaSegura.dañoPorSegundo <= 0) return;
  const ahora = Date.now();
  if (ahora - ultimoDañoZona < 1000) return;
  ultimoDañoZona = ahora;
  for (const jugador of Object.values(jugadores)) {
    if (jugador.muerto || !jugador.unido) continue;
    const dist = Math.hypot(jugador.x - zonaSegura.x, jugador.y - zonaSegura.y);
    if (dist > zonaSegura.radio) {
      jugador.vida -= zonaSegura.dañoPorSegundo;
      if (jugador.vida <= 0) {
        if (resolverBaja(jugador)) return;
      }
    }
  }
}


setInterval(() => {
  for (const plataforma of plataformas) {
    if (plataforma.objeto === null) {
      plataforma.objeto = LOOT[Math.floor(Math.random() * LOOT.length)];
      plataforma.rareza = rarezaAleatoria();
      plataforma.balas = STATS_ARMAS[plataforma.objeto]?.capacidadCargador ?? null;
    }
  }
}, 10_000);

function aplicarZonasEspeciales() {
  if (!partidaEnCurso) return;
  for (const jugador of Object.values(jugadores)) {
    if (jugador.muerto || !jugador.unido) continue;
    const effects = SpecialZones.effects(jugador);
    jugador.vida = Math.max(0, jugador.vida - effects.damagePerSecond / TICK_RATE);
    if (jugador.vida <= 0) { if (resolverBaja(jugador)) return; continue; }
    if (jugador.abatido) continue;
    jugador.vida = Math.min(100, jugador.vida + effects.healPerSecond / TICK_RATE);
    jugador.escudo = Math.min(100, jugador.escudo + effects.shieldPerSecond / TICK_RATE);
  }
}

// Game loop compartido: no depende de cuál transporte esté activo.
setInterval(() => {
  actualizarVotacionMapa();
  preparacionTactica?.tick(Date.now());
  actualizarPreparacionTactica();
  if (!partidaEnCurso || Date.now() < finPreparacion) {
    broadcast('estadoJuego', { jugadores, balas, plataformas, obstaculos, itemsEnSuelo, granadas, zonaSegura, cofres, preparacionRestante: segundosPreparacion(), preparacionTactica: preparacionTactica?.snapshot(Date.now()) ?? null });
    return;
  }
  actualizarZonaSegura();
  if (procesarAbatidos()) return;
  procesarRespawns();
  aplicarZonasEspeciales();
  if (!partidaEnCurso) return;
  actualizarBots();
  procesarGranadas();
  aplicarDañoZona();
  if (!partidaEnCurso) return;

  for (let index = balas.length - 1; index >= 0; index -= 1) {
    const bala = balas[index];
    const distanciaPaso = bala.velocidad / TICK_RATE;
    const pasos = Math.ceil(distanciaPaso / 8);
    let bloqueada = false;
    for (let paso = 1; paso <= pasos; paso += 1) {
      if (puntoEnObstaculo(bala.x + Math.cos(bala.angle) * distanciaPaso * paso / pasos,
        bala.y + Math.sin(bala.angle) * distanciaPaso * paso / pasos)) { bloqueada = true; break; }
    }
    bala.x += Math.cos(bala.angle) * distanciaPaso;
    bala.y += Math.sin(bala.angle) * distanciaPaso;
    bala.distanciaRecorrida += distanciaPaso;

    if (bala.x < 0 || bala.x > MAP_WIDTH || bala.y < 0 || bala.y > MAP_HEIGHT
      || bala.distanciaRecorrida >= bala.rango || bloqueada) {
      balas.splice(index, 1);
      continue;
    }

    for (const id in jugadores) {
      const propietarioId = bala.propietarioId || bala.ownerId;
      const jugador = jugadores[id];
      if (id === propietarioId || jugador.muerto || !jugador.unido
        || (jugador.abatido && bala.disparoEn <= jugador.abatidoDesde)
        || (esDueloEquipos() && Teams.same({ equipo: bala.equipo }, jugador))) continue;
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
          if (resolverBaja(jugador, propietario, bala.arma)) return;
        }
        break;
      }
    }
  }

  // Recogida autoritativa: el servidor decide si hay espacio y vacía la plataforma.
  for (const id in jugadores) {
    const jugador = jugadores[id];
    if (!partidaEnCurso || !jugador.unido || jugador.abatido || jugador.reanimando) continue;
    for (const plataforma of plataformas) {
      if (plataforma.objeto === null || jugador.muerto) continue;
      if (Math.hypot(jugador.x - plataforma.x, jugador.y - plataforma.y) > PLATFORM_RADIUS) continue;

      if (recogerObjeto(jugador, plataforma.objeto, plataforma.balas, null, plataforma.rareza)) { plataforma.objeto = null; plataforma.balas = null; }
    }

    // Recogida de items tirados en el suelo.
    for (let i = itemsEnSuelo.length - 1; i >= 0; i -= 1) {
      const drop = itemsEnSuelo[i];
      if (jugador.muerto) continue;
      if (Math.hypot(jugador.x - drop.x, jugador.y - drop.y) > PLATFORM_RADIUS) continue;
      if (recogerObjeto(jugador, drop.item, drop.balas, drop.cantidad, drop.rareza)) itemsEnSuelo.splice(i, 1);
    }
  }

  broadcast('estadoJuego', { jugadores, balas, plataformas, obstaculos, itemsEnSuelo, granadas, zonaSegura, cofres, preparacionRestante: segundosPreparacion(), preparacionTactica: preparacionTactica?.snapshot(Date.now()) ?? null });
}, 1000 / TICK_RATE);

function recogerObjeto(jugador, item, balas, cantidad, rareza = 0) {
  jugador.rarezas ||= Array(INVENTARIO_SIZE).fill(0);
  rareza = [0, 1, 2].includes(rareza) ? rareza : 0;
  if (item.startsWith('ammo_')) {
    const arma = item.slice(5);
    if (!MUNICION_CAJA[arma] || !Number.isInteger(cantidad) || cantidad <= 0) return false;
    jugador.reservas[arma] += cantidad;
    return true;
  }
  const cargador = balas ?? STATS_ARMAS[item]?.capacidadCargador ?? null;
  if (MUNICION_CAJA[item] && jugador.inventario.includes(item)) {
    jugador.reservas[item] += cargador || 0;
    const existente = jugador.inventario.indexOf(item);
    jugador.rarezas[existente] = Math.max(jugador.rarezas[existente] || 0, rareza);
    return true;
  }
  const slot = jugador.inventario.indexOf(null);
  if (slot === -1) return false;
  jugador.inventario[slot] = item;
  jugador.rarezas[slot] = rareza;
  jugador.municionPorSlot[slot] = cargador;
  if (slot === jugador.slotSeleccionado) equiparArma(jugador);
  return true;
}

function generarMunicionMapa() {
  const tipos = Object.keys(MUNICION_CAJA);
  const lugares = [...plataformas, ...obstaculos.filter(Buildings.isBuilding).map((edificio) => ({ x: edificio.x + edificio.width / 2, y: edificio.y + edificio.height / 2 }))];
  lugares.forEach((lugar, index) => {
    const armaExtra = tipos[index % tipos.length];
    itemsEnSuelo.push({ id: `drop_${nextItemId++}`, x: lugar.x, y: lugar.y - 65, item: armaExtra, balas: STATS_ARMAS[armaExtra].capacidadCargador, rareza: rarezaAleatoria() });
    for (let offset = 0; offset < 2; offset += 1) {
      const arma = tipos[(index + offset) % tipos.length];
      const x = lugar.x + (offset ? 45 : -45);
      const y = lugar.y + 35;
      if (!colisionaConObstaculo(x, y, 12)) itemsEnSuelo.push({ id: `ammo_${nextItemId++}`, x, y, item: `ammo_${arma}`, cantidad: MUNICION_CAJA[arma] });
    }
  });
}

function prepararObjetosMapa() {
  for (const [index, plataforma] of plataformas.entries()) {
    if (colisionaConObstaculo(plataforma.x, plataforma.y, PLATFORM_RADIUS)) {
      const edificio = obstaculos.find((objeto) => plataforma.x >= objeto.x - PLATFORM_RADIUS
        && plataforma.x <= objeto.x + objeto.width + PLATFORM_RADIUS
        && plataforma.y >= objeto.y - PLATFORM_RADIUS && plataforma.y <= objeto.y + objeto.height + PLATFORM_RADIUS);
      plataforma.y = edificio.y + edificio.height + 100;
    }
    plataforma.objeto = LOOT[index % LOOT.length];
    plataforma.balas = STATS_ARMAS[plataforma.objeto]?.capacidadCargador ?? null;
  }
  generarMunicionMapa();
  for (const edificio of obstaculos.filter(Buildings.isBuilding)) {
    cofres.push({ id: `cofre-${cofres.length}`, x: edificio.x + edificio.width / 2, y: edificio.y + 65, abierto: false });
  }
}
prepararObjetosMapa();

generarZonasEspeciales();

server.listen(PORT, () => {
  console.log(`Servidor (${nativeMode ? 'WebSocket nativo' : 'Socket.IO'}) en http://localhost:${PORT}`);
});
