const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const swapButton = document.getElementById('swap-button');
const reloadButton = document.getElementById('reload-button');
const scoreboard = document.getElementById('scoreboard');
const respawnMessage = document.getElementById('respawn-message');
const inicioScreen = document.getElementById('pantalla-inicio');
const finishScreen = document.getElementById('pantalla-fin');
const nicknameInput = document.getElementById('nickname');
const playButton = document.getElementById('jugar-button');
const podiumList = document.getElementById('podio');
// Adaptador: el resto del juego llama a network.send/on sin conocer el transporte.
const network = {
  id: null,
  handlers: new Map(),
  send: () => {},
  on(type, handler) {
    this.handlers.set(type, handler);
  },
  receive(type, data) {
    this.handlers.get(type)?.(data);
  },
};
// Esta copia se actualiza con el estado global que envía el servidor.
let jugadores = {};
let balas = [];
let plataformas = [];
let obstaculos = [];
let itemsEnSuelo = [];
let granadosEnVuelo = [];
let zonaSegura = { x: 3000, y: 3000, radio: 9000 };
let mapWidth = 6000;
let mapHeight = 6000;
let gameStarted = false;
let gameFinished = false;
let networkReady = false;
let tiempoPartida = 120;

// ---- Animaciones de consumibles ----
// { tipo: 'vida'|'escudo', inicio: ms, duracion: ms }
let consumeAnim = null;
const CONSUME_DURACION = 1200; // ms que dura la barra de progreso

// ---- Kill feed ----
const killFeed = []; // { texto, hasta }
const KILL_FEED_DURACION = 4000;

// ---- Daño flotante ----
const floatingNumbers = []; // { x, y, valor, color, nacido, vida:ms }
let prevVidas = {}; // id → vida anterior
let prevEscudos = {};

// ---- Cámara shake ----
let shakeUntil = 0;
let shakeIntensidad = 0;

// ---- Partículas de impacto ----
const particulas = []; // { x, y, vx, vy, vida, maxVida, color }

// ---- Explosiones visuales ----
const explosiones = []; // { x, y, radio, maxRadio, alfa, nacido }

// ---- Web Audio ----
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(frecuencia, tipo, duracion, volumen = 0.18) {
  try {
    const ctx2 = getAudioCtx();
    const osc = ctx2.createOscillator();
    const gain = ctx2.createGain();
    osc.connect(gain);
    gain.connect(ctx2.destination);
    osc.type = tipo;
    osc.frequency.value = frecuencia;
    gain.gain.setValueAtTime(volumen, ctx2.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + duracion);
    osc.start(ctx2.currentTime);
    osc.stop(ctx2.currentTime + duracion);
  } catch { /* silencio si no hay permisos */ }
}
function playShoot() { playTone(280, 'sawtooth', 0.08, 0.12); }
function playHit() { playTone(180, 'square', 0.12, 0.25); }
function playPickup() { playTone(660, 'sine', 0.18, 0.15); }
function playExplosion() { playTone(80, 'sawtooth', 0.4, 0.5); }
function playKill() { playTone(880, 'sine', 0.3, 0.22); }

// ---- Vibración móvil ----
function vibrar(ms = 60) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/** Ordena el estado recibido y actualiza el marcador visible en pantalla. */
function actualizarScoreboard(jugadoresRecibidos) {
  const ranking = Object.entries(jugadoresRecibidos)
    .sort(([, jugadorA], [, jugadorB]) => (jugadorB.kills || 0) - (jugadorA.kills || 0));

  scoreboard.innerHTML = ranking.map(([, jugador], index) => (
    `<div>${jugador.nombre || `Jugador ${index + 1}`}: ${jugador.kills || 0} Kills</div>`
  )).join('');
}

// Se comprueba una vez: en móviles se añaden controles táctiles.
const isMobile = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent);
if (isMobile) document.body.classList.add('mobile');
const keys = new Set();
const mouse = { x: 0, y: 0 };
const movement = { x: 0, y: 0 };
const aim = { x: 1, y: 0 };
// Réplica local de cooldowns para feedback inmediato; el servidor sigue siendo autoritativo.
const STATS_ARMAS_CLIENTE = {
  'puños': { cooldown: 400, capacidadCargador: 0 },
  pistola: { cooldown: 300, capacidadCargador: 12 },
  escopeta: { cooldown: 800, capacidadCargador: 6 },
  rifle: { cooldown: 1000, capacidadCargador: 30 },
  botiquin: { cooldown: 400 },
  escudo_pocion: { cooldown: 400 },
  granada: { cooldown: 1500 },
};
let lastShotTime = -Infinity;
let cooldownFeedbackUntil = 0;
let cooldownFeedbackSlot = -1;
let noAmmoMessageUntil = 0;
let fullStatMessageUntil = 0;
let fullStatMessage = '';

const player = {
  x: window.innerWidth / 2, y: window.innerHeight / 2, angle: 0, speed: 350,
  image: new Image(),
};
const bulletImage = new Image();
const floorImage = new Image();
const platformImage = new Image();
const itemImages = {
  pistola: new Image(),
  escopeta: new Image(),
  rifle: new Image(),
  botiquin: new Image(),
  escudo_pocion: new Image(),
  puños: new Image(),
  granada: new Image(),
};

network.on('identidad', ({ id }) => {
  network.id = id;
});

network.on('configMapa', ({ MAP_WIDTH, MAP_HEIGHT, obstaculos: obstaculosDelServidor }) => {
  mapWidth = MAP_WIDTH;
  mapHeight = MAP_HEIGHT;
  obstaculos = obstaculosDelServidor || [];
});

network.on('inicioPartida', ({ tiempoRestante }) => {
  gameStarted = true;
  gameFinished = false;
  tiempoPartida = tiempoRestante ?? 120;
  inicioScreen.style.display = 'none';
  finishScreen.style.display = 'none';
  setGameVisibility(true);
});

network.on('tiempoPartida', (tiempo) => {
  tiempoPartida = Math.max(0, Number(tiempo) || 0);
});

network.on('finDeJuego', (podio) => {
  gameStarted = false;
  gameFinished = true;
  setGameVisibility(false);
  podiumList.replaceChildren();
  podio.forEach((jugador, index) => {
    const item = document.createElement('li');
    item.textContent = `${index + 1}. ${jugador.nombre} - ${jugador.kills} Kills`;
    podiumList.appendChild(item);
  });
  finishScreen.style.display = 'flex';
});

network.on('reinicioPartida', () => {
  gameStarted = false;
  gameFinished = false;
  tiempoPartida = 120;
  setGameVisibility(false);
  finishScreen.style.display = 'none';
  inicioScreen.style.display = 'flex';
  nicknameInput.value = '';
  playButton.disabled = false;
});

network.on('estadoJuego', ({ jugadores: jugadoresDelServidor, balas: balasDelServidor, plataformas: plataformasDelServidor, obstaculos: obstaculosDelServidor, itemsEnSuelo: itemsDelServidor, granadas: granadasDelServidor, zonaSegura: zonaDelServidor }) => {
  const jugadoresAnteriores = jugadores;
  jugadores = jugadoresDelServidor;
  balas = balasDelServidor;
  plataformas = plataformasDelServidor || [];
  obstaculos = obstaculosDelServidor || obstaculos;
  itemsEnSuelo = itemsDelServidor || [];
  granadosEnVuelo = granadasDelServidor || [];
  if (zonaDelServidor) zonaSegura = zonaDelServidor;
  actualizarScoreboard(jugadores);

  // ---- Daño flotante: detecta cambios de vida/escudo ----
  const ahora = performance.now();
  for (const [id, jugador] of Object.entries(jugadores)) {
    const vidaAnterior = prevVidas[id] ?? jugador.vida;
    const escudoAnterior = prevEscudos[id] ?? jugador.escudo;
    const deltaVida = vidaAnterior - jugador.vida;
    const deltaEscudo = escudoAnterior - jugador.escudo;

    if (deltaVida > 0 && !jugador.muerto) {
      floatingNumbers.push({ x: jugador.x + (Math.random() - 0.5) * 30, y: jugador.y - 30, valor: `-${Math.round(deltaVida)}`, color: '#ef5350', nacido: ahora, vida: 1000 });
      if (id === network.id) { startShake(6, 200); vibrar(40); playHit(); }
    }
    if (deltaEscudo > 0 && !jugador.muerto) {
      floatingNumbers.push({ x: jugador.x + (Math.random() - 0.5) * 30, y: jugador.y - 48, valor: `-${Math.round(deltaEscudo)}🛡`, color: '#42a5f5', nacido: ahora, vida: 1000 });
    }
    if (deltaVida < 0) {
      floatingNumbers.push({ x: jugador.x, y: jugador.y - 30, valor: `+${Math.round(-deltaVida)}❤`, color: '#2ecc71', nacido: ahora, vida: 1000 });
    }
    prevVidas[id] = jugador.vida;
    prevEscudos[id] = jugador.escudo;
  }
  // Limpia jugadores que ya no existen
  for (const id of Object.keys(prevVidas)) {
    if (!jugadores[id]) { delete prevVidas[id]; delete prevEscudos[id]; }
  }

  // Sincroniza el jugador local, especialmente tras un respawn del servidor.
  const jugadorLocal = jugadores[network.id];
  if (jugadorLocal) {
    player.x = jugadorLocal.x;
    player.y = jugadorLocal.y;
    player.angle = jugadorLocal.angle;
  }
});

// La notificación permite quitarlo sin esperar al siguiente tick de 30 FPS.
network.on('jugadorDesconectado', (id) => {
  delete jugadores[id];
});

network.on('kill', ({ asesino, victima, arma }) => {
  killFeed.push({ texto: `🔫 ${asesino} eliminó a ${victima} [${arma}]`, hasta: performance.now() + KILL_FEED_DURACION });
  if (asesino === jugadores[network.id]?.nombre) playKill();
});

network.on('explosion', ({ x, y, radio }) => {
  explosiones.push({ x, y, radio: 10, maxRadio: radio, alfa: 1, nacido: performance.now() });
  // Partículas de humo
  for (let i = 0; i < 14; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const vel = 80 + Math.random() * 180;
    particulas.push({ x, y, vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel, vida: 600, maxVida: 600, color: '#ffb74d' });
  }
  startShake(12, 400);
  vibrar(120);
  playExplosion();
});

network.on('zonaActualizada', (zona) => {
  zonaSegura = zona;
});

function loadSocketIoClient() {
  if (window.io) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar el cliente de Socket.IO'));
    document.head.appendChild(script);
  });
}

async function connectNetwork() {
  try {
    const response = await fetch('/modo');
    const { modo } = await response.json();

    if (modo === 'socket.io') {
      await loadSocketIoClient();
      const socket = window.io();
      network.send = (type, data) => socket.emit(type, data);
      socket.on('connect', () => { network.id = socket.id; networkReady = true; });
      for (const type of [
        'configMapa', 'estadoJuego', 'jugadorDesconectado', 'inicioPartida',
        'tiempoPartida', 'finDeJuego', 'reinicioPartida', 'kill', 'explosion', 'zonaActualizada',
      ]) {
        socket.on(type, (data) => network.receive(type, data));
      }
    } else if (modo === 'nativo') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}`);
      network.send = (type, data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
      };
      socket.addEventListener('open', () => { networkReady = true; });
      socket.addEventListener('message', (event) => {
        try {
          const { type, data } = JSON.parse(event.data);
          network.receive(type, data);
        } catch {
          console.warn('Mensaje WebSocket inválido ignorado');
        }
      });
    } else {
      throw new Error(`Modo de red no reconocido: ${modo}`);
    }
  } catch (error) {
    console.error('No se pudo conectar al servidor:', error);
  }
}

connectNetwork();

function setGameVisibility(visible) {
  const elements = [canvas, scoreboard, swapButton, reloadButton, respawnMessage,
    document.getElementById('move-zone'), document.getElementById('aim-zone')];
  elements.forEach((element) => {
    if (element) element.style.display = visible ? '' : 'none';
  });
}

playButton.addEventListener('click', () => {
  const nombre = nicknameInput.value.trim();
  if (!nombre || !networkReady || gameStarted || gameFinished) return;
  playButton.disabled = true;
  network.send('unirse', { nombre });
});

nicknameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') playButton.click();
});

// Express sirve "public" como raíz estática, por eso la ruta comienza con /.
player.image.src = '/assets/sprites/jugador.png';
player.image.addEventListener('error', () => console.error('No se pudo cargar /assets/sprites/jugador.png'));
bulletImage.src = '/assets/sprites/bala.png';
bulletImage.addEventListener('error', () => console.error('No se pudo cargar /assets/sprites/bala.png'));
floorImage.src = '/assets/tiles/suelo.png';
floorImage.addEventListener('error', () => console.error('No se pudo cargar /assets/tiles/suelo.png'));
const obstacleImage = new Image();
obstacleImage.src = '/assets/sprites/caja.png';
obstacleImage.addEventListener('error', () => console.error('No se pudo cargar /assets/sprites/caja.png'));
platformImage.src = '/assets/sprites/plataforma.png';
platformImage.addEventListener('error', () => console.error('No se pudo cargar /assets/sprites/plataforma.png'));
itemImages.pistola.src = '/assets/sprites/pistola.png';
itemImages.escopeta.src = '/assets/sprites/escopeta.png';
itemImages.botiquin.src = '/assets/sprites/botiquin.png';
itemImages.escudo_pocion.src = '/assets/sprites/escudo.png';
itemImages.rifle.src = '/assets/sprites/rifle.png';
itemImages.granada.src = '/assets/sprites/granada.png';
// Se reutiliza el sprite del jugador como marcador temporal para el slot "puños".
itemImages.puños.src = '/assets/sprites/jugador.png';

/** Ajusta el búfer para pantallas retina sin cambiar las coordenadas del juego. */
function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  player.x = Math.min(Math.max(player.x, 0), mapWidth);
  player.y = Math.min(Math.max(player.y, 0), mapHeight);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ----- Controles de PC ----------------------------------------------------
window.addEventListener('keydown', (event) => {
  // Mientras se escribe el nickname, las teclas WASD deben comportarse como texto normal.
  const elementoEscritura = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement;
  if (elementoEscritura) return;

  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyE', 'KeyR', 'KeyG', 'KeyF'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  const slot = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 }[event.code];
  if (slot !== undefined) selectSlot(slot);
  if (event.code === 'KeyE' && !event.repeat) attemptExchange();
  if (event.code === 'KeyR' && !event.repeat) requestReload();
  if (event.code === 'KeyG' && !event.repeat) dropCurrentItem();
  if (event.code === 'KeyF' && !event.repeat) throwGrenade();
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', (event) => {
  const bounds = canvas.getBoundingClientRect();
  mouse.x = event.clientX - bounds.left;
  mouse.y = event.clientY - bounds.top;
});

// ----- Disparo ------------------------------------------------------------
function shoot() {
  if (!gameStarted || gameFinished) return false;
  const jugadorLocal = jugadores[network.id];
  const arma = jugadorLocal?.inventario?.[jugadorLocal.slotSeleccionado] || 'puños';
  const cooldown = STATS_ARMAS_CLIENTE[arma]?.cooldown || STATS_ARMAS_CLIENTE['puños'].cooldown;
  const ahora = performance.now();
  const statsCliente = STATS_ARMAS_CLIENTE[arma] || STATS_ARMAS_CLIENTE['puños'];

  // Granada: tecla F o botón dedicado, NO disparo normal
  if (arma === 'granada') return false;

  // Consumibles: disparar = usar, con animación de barra de progreso.
  if (arma === 'botiquin' || arma === 'escudo_pocion') {
    if (arma === 'botiquin' && (jugadorLocal?.vida ?? 0) >= 100) {
      fullStatMessage = '❤ Ya tienes la vida completa';
      fullStatMessageUntil = ahora + 2000;
      return false;
    }
    if (arma === 'escudo_pocion' && (jugadorLocal?.escudo ?? 0) >= 100) {
      fullStatMessage = '🛡 Ya tienes el escudo completo';
      fullStatMessageUntil = ahora + 2000;
      return false;
    }
    if (ahora - lastShotTime < cooldown) return false;
    lastShotTime = ahora;
    consumeAnim = { tipo: arma === 'botiquin' ? 'vida' : 'escudo', inicio: ahora, duracion: CONSUME_DURACION };
    network.send('disparar', { x: player.x, y: player.y, angle: player.angle });
    playPickup();
    return true;
  }

  if (jugadorLocal?.recargando) return false;
  if (statsCliente.capacidadCargador && jugadorLocal?.balasEnCargador <= 0) {
    noAmmoMessageUntil = ahora + 1800;
    return false;
  }

  if (ahora - lastShotTime < cooldown) {
    cooldownFeedbackUntil = ahora + 220;
    cooldownFeedbackSlot = jugadorLocal?.slotSeleccionado ?? 0;
    return false;
  }

  lastShotTime = ahora;
  network.send('disparar', { x: player.x, y: player.y, angle: player.angle });
  playShoot();
  return true;
}

/** Lanza la granada del inventario. Tecla F en PC, botón en móvil. */
function throwGrenade() {
  if (!gameStarted || gameFinished) return;
  const jugadorLocal = jugadores[network.id];
  if (!jugadorLocal || jugadorLocal.muerto) return;
  const slotGranada = jugadorLocal.inventario?.indexOf('granada');
  if (slotGranada === undefined || slotGranada === -1) return;
  const ahora = performance.now();
  if (ahora - lastShotTime < (STATS_ARMAS_CLIENTE.granada?.cooldown || 1500)) return;
  lastShotTime = ahora;
  // Optimistic: quita la granada localmente
  jugadorLocal.inventario[slotGranada] = null;
  network.send('lanzarGranada', { angle: player.angle });
  playShoot();
}

function requestReload() {
  if (gameStarted && !jugadores[network.id]?.muerto) network.send('recargar', {});
}

/** Tira el item del slot actual al suelo. Tecla G en PC, botón en móvil. */
function dropCurrentItem() {
  if (!gameStarted || gameFinished) return;
  const jugadorLocal = jugadores[network.id];
  if (!jugadorLocal || jugadorLocal.muerto) return;
  const slot = jugadorLocal.slotSeleccionado;
  const item = jugadorLocal.inventario?.[slot];
  if (!item) return;
  // Optimistic: vaciamos localmente para feedback inmediato.
  jugadorLocal.inventario[slot] = null;
  network.send('tirarItem', { slot });
}

canvas.addEventListener('mousedown', (event) => {
  if (!isMobile && event.button === 0) shoot();
});

/** Cambia el slot local para respuesta inmediata y lo sincroniza por el transporte activo. */
function selectSlot(slot) {
  if (!gameStarted || !Number.isInteger(slot) || slot < 0 || slot > 4) return;
  const jugadorLocal = jugadores[network.id];
  if (jugadorLocal) jugadorLocal.slotSeleccionado = slot;
  network.send('cambiarSlot', { slot });
}

function getInventorySlotAt(screenX, screenY) {
  const size = 56;
  const gap = 8;
  const totalWidth = size * 5 + gap * 4;
  const startX = (window.innerWidth - totalWidth) / 2;
  const startY = window.innerHeight - size - 24;
  if (screenY < startY || screenY > startY + size) return null;
  const slot = Math.floor((screenX - startX) / (size + gap));
  const slotX = startX + slot * (size + gap);
  return slot >= 0 && slot < 5 && screenX <= slotX + size ? slot : null;
}

// En móvil, tocar un slot cambia de objeto sin disparar.
canvas.addEventListener('pointerdown', (event) => {
  if (!isMobile) return;
  const slot = getInventorySlotAt(event.clientX, event.clientY);
  if (slot !== null) {
    event.preventDefault();
    selectSlot(slot);
  }
});

function getNearbyLootPlatform(jugadorLocal) {
  if (!jugadorLocal || jugadorLocal.muerto || !jugadorLocal.inventario
    || jugadorLocal.inventario.some((item) => item === null)) return null;
  return plataformas.find((plataforma) => (
    plataforma.objeto !== null
    && Math.hypot(jugadorLocal.x - plataforma.x, jugadorLocal.y - plataforma.y) <= 55
  )) || null;
}

/** Muestra el tiempo restante de respawn del jugador local. */
function actualizarMensajeRespawn(jugadorLocal) {
  if (!jugadorLocal?.muerto) {
    respawnMessage.classList.remove('visible');
    return;
  }

  const segundos = Math.max(0, Math.ceil((jugadorLocal.respawnAt - Date.now()) / 1000));
  respawnMessage.textContent = `Reaparecerá en: ${segundos}s`;
  respawnMessage.classList.add('visible');
}

function attemptExchange() {
  if (!gameStarted || gameFinished) return;
  const jugadorLocal = jugadores[network.id];
  if (getNearbyLootPlatform(jugadorLocal)) network.send('intercambiar', {});
}

// En móvil, el botón solo se muestra cuando el cliente detecta una oportunidad válida.
swapButton?.addEventListener('click', attemptExchange);
reloadButton?.addEventListener('click', requestReload);
document.getElementById('drop-button')?.addEventListener('click', dropCurrentItem);
document.getElementById('grenade-button')?.addEventListener('click', throwGrenade);

/** Carga NippleJS únicamente si el dispositivo es móvil. */
function loadNippleJS() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/nipplejs@0.10.2/dist/nipplejs.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar NippleJS'));
    document.head.appendChild(script);
  });
}

function createMobileControls() {
  document.body.classList.add('mobile');
  const options = { mode: 'static', color: '#fff', size: 120, restOpacity: 0.45 };
  const moveStick = nipplejs.create({ zone: document.getElementById('move-zone'), ...options });
  moveStick.on('move', (_event, data) => {
    movement.x = data.vector.x;
    movement.y = -data.vector.y; // NippleJS considera arriba como Y positiva.
  });
  moveStick.on('end', () => Object.assign(movement, { x: 0, y: 0 }));

  const aimStick = nipplejs.create({ zone: document.getElementById('aim-zone'), ...options });
  aimStick.on('move', (_event, data) => {
    aim.x = data.vector.x;
    aim.y = -data.vector.y;
    player.angle = Math.atan2(aim.y, aim.x);
    // La función shoot aplica el cooldown específico del arma actual.
    shoot();
  });
  aimStick.on('end', () => Object.assign(aim, { x: 0, y: 0 }));
}

if (isMobile) loadNippleJS().then(createMobileControls).catch(console.error);

function update(deltaSeconds) {
  let moveX = movement.x;
  let moveY = movement.y;
  if (!isMobile) {
    moveX = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    moveY = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
  }

  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude > 0) {
    player.x += (moveX / magnitude) * player.speed * deltaSeconds;
    player.y += (moveY / magnitude) * player.speed * deltaSeconds;
    // Predicción local: el límite se aplica aquí y también de forma autoritativa en el servidor.
    player.x = Math.max(0, Math.min(mapWidth, player.x));
    player.y = Math.max(0, Math.min(mapHeight, player.y));
  }

  if (isMobile) {
    if (Math.hypot(aim.x, aim.y) > 0.05) player.angle = Math.atan2(aim.y, aim.x);
  } else {
    // Con la cámara centrada en el jugador, el cursor se mide desde el centro de pantalla.
    player.angle = Math.atan2(mouse.y - window.innerHeight / 2, mouse.x - window.innerWidth / 2);
  }

  // El servidor conservará este estado asociado a socket.id.
  network.send('movimiento', { x: player.x, y: player.y, angle: player.angle });
}

/** Dibuja un icono de objeto centrado; si su sprite aún no carga, muestra su nombre. */
function drawItemIcon(item, x, y, size) {
  const image = itemImages[item];
  if (image?.complete && image.naturalWidth) {
    ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    return;
  }
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(item, x, y + 4);
}

/** Superpone el arma seleccionada sobre la dirección de las manos del personaje. */
function drawWeaponOnPlayer(jugador) {
  const arma = jugador.inventario?.[jugador.slotSeleccionado];
  if (!arma || arma === 'puños') return;
  const image = itemImages[arma];
  if (!image?.complete || !image.naturalWidth) return;

  const offset = 28;
  ctx.save();
  ctx.translate(
    jugador.x + Math.cos(jugador.angle) * offset,
    jugador.y + Math.sin(jugador.angle) * offset,
  );
  ctx.rotate(jugador.angle);
  ctx.drawImage(image, -24, -12, 48, 24);
  ctx.restore();
}

/** UI de inventario: se llama después de restaurar la cámara, en coordenadas de pantalla. */
function drawInventoryUI(jugadorLocal) {
  const size = 56;
  const gap = 8;
  const SLOTS = 5;
  const totalWidth = size * SLOTS + gap * (SLOTS - 1);
  const startX = (window.innerWidth - totalWidth) / 2;
  const startY = window.innerHeight - size - 24;
  const inventario = jugadorLocal.inventario || Array(SLOTS).fill(null);

  for (let slot = 0; slot < SLOTS; slot += 1) {
    const x = startX + slot * (size + gap);
    const selected = slot === jugadorLocal.slotSeleccionado;
    const cooldownError = selected
      && slot === cooldownFeedbackSlot
      && performance.now() < cooldownFeedbackUntil;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, startY, size, size);
    ctx.strokeStyle = cooldownError ? '#ef3340' : (selected ? '#ffd54a' : '#ffffff');
    ctx.lineWidth = selected ? 4 : 2;
    ctx.strokeRect(x, startY, size, size);
    if (inventario[slot]) drawItemIcon(inventario[slot], x + size / 2, startY + size / 2, 36);

    ctx.fillStyle = '#ffffff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(slot + 1), x + 4, startY + 13);
  }
}

function drawAmmoUI(jugadorLocal) {
  const arma = jugadorLocal?.inventario?.[jugadorLocal.slotSeleccionado] || 'puños';
  const stats = STATS_ARMAS_CLIENTE[arma];
  const ahora = performance.now();

  ctx.save();
  ctx.textAlign = 'center';

  if (stats?.capacidadCargador) {
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `Balas: ${jugadorLocal.balasEnCargador || 0} / ${stats.capacidadCargador}`,
      window.innerWidth / 2,
      window.innerHeight - 96,
    );
    if (jugadorLocal.recargando) {
      ctx.font = 'bold 30px sans-serif';
      ctx.fillStyle = '#90caf9';
      ctx.fillText('RECARGANDO...', window.innerWidth / 2, window.innerHeight / 2 - 90);
    }
    if (noAmmoMessageUntil > ahora) {
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#ffcc80';
      ctx.fillText('Sin balas. Presiona R para recargar', window.innerWidth / 2, window.innerHeight - 122);
    }
  }

  // Hint de granada: aparece cuando el slot activo tiene una granada
  if (arma === 'granada') {
    const pulso = 0.75 + 0.25 * Math.abs(Math.sin(ahora / 500));
    ctx.globalAlpha = pulso;
    ctx.font = 'bold 18px sans-serif';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    const texto = isMobile ? '💣 Pulsa el botón 💣 para lanzar' : '💣 Presiona F para lanzar la granada';
    ctx.strokeText(texto, window.innerWidth / 2, window.innerHeight - 96);
    ctx.fillStyle = '#8bc34a';
    ctx.fillText(texto, window.innerWidth / 2, window.innerHeight - 96);
    ctx.globalAlpha = 1;
  }

  // Mensaje de stat completo al intentar usar un consumible innecesariamente.
  if (fullStatMessageUntil > ahora) {
    const esVida = fullStatMessage.includes('vida');
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = esVida ? '#2ecc71' : '#2196f3';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(fullStatMessage, window.innerWidth / 2, window.innerHeight / 2 - 120);
    ctx.fillText(fullStatMessage, window.innerWidth / 2, window.innerHeight / 2 - 120);
  }

  ctx.restore();
}

/** Barra de progreso animada al consumir botiquin o escudo. */
function drawConsumeAnim() {
  if (!consumeAnim) return;
  const ahora = performance.now();
  const progreso = (ahora - consumeAnim.inicio) / consumeAnim.duracion;
  if (progreso >= 1) { consumeAnim = null; return; }

  const esVida = consumeAnim.tipo === 'vida';
  const barW = 220;
  const barH = 22;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2 - 60;

  ctx.save();
  // Fondo semitransparente
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(cx - barW / 2 - 6, cy - barH / 2 - 22, barW + 12, barH + 36, 8);
  ctx.fill();

  // Etiqueta
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = esVida ? '#2ecc71' : '#2196f3';
  ctx.fillText(esVida ? '❤ Curando...' : '🛡 Cargando escudo...', cx, cy - barH / 2 - 4);

  // Barra fondo
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect(cx - barW / 2, cy - barH / 2, barW, barH, 6);
  ctx.fill();

  // Barra progreso
  ctx.fillStyle = esVida ? '#2ecc71' : '#2196f3';
  ctx.beginPath();
  ctx.roundRect(cx - barW / 2, cy - barH / 2, barW * progreso, barH, 6);
  ctx.fill();

  // Porcentaje
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(`${Math.round(progreso * 100)}%`, cx, cy + barH / 2 + 14);
  ctx.restore();
}

/**
 * Mini mapa estilo CoD:
 * - Geometría siempre visible (suelo, obstáculos, plataformas, borde).
 * - Jugador local: punto blanco permanente con triángulo de dirección.
 * - Enemigos/bots: solo aparecen si dispararon en los últimos 2 s,
 *   con un halo que se desvanece conforme pasa el tiempo.
 */
const MINIMAP_SHOT_WINDOW = 2000; // ms que dura la detección tras un disparo

function drawMinimap() {
  const MM_W = 180;
  const MM_H = 180;
  const MM_PADDING = 14;
  const mx = MM_PADDING;
  const my = window.innerHeight - MM_H - MM_PADDING;
  const scaleX = MM_W / mapWidth;
  const scaleY = MM_H / mapHeight;
  const ahora = Date.now();

  ctx.save();

  // Fondo con borde sutil
  ctx.fillStyle = 'rgba(0,0,0,0.70)';
  ctx.beginPath();
  ctx.roundRect(mx - 4, my - 4, MM_W + 8, MM_H + 8, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Clip al área del minimapa
  ctx.beginPath();
  ctx.rect(mx, my, MM_W, MM_H);
  ctx.clip();

  // Suelo
  ctx.fillStyle = '#2a3a2a';
  ctx.fillRect(mx, my, MM_W, MM_H);

  // Obstáculos
  ctx.fillStyle = '#7a6a4a';
  for (const obs of obstaculos) {
    ctx.fillRect(
      mx + obs.x * scaleX,
      my + obs.y * scaleY,
      Math.max(1, obs.width * scaleX),
      Math.max(1, obs.height * scaleY),
    );
  }

  // Plataformas: punto amarillo si tienen loot, gris si están vacías
  for (const plat of plataformas) {
    ctx.fillStyle = plat.objeto ? '#ffd54a' : '#556';
    ctx.beginPath();
    ctx.arc(mx + plat.x * scaleX, my + plat.y * scaleY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Borde del mundo
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mx, my, MM_W, MM_H);

  // ---- Enemigos detectados por disparo ----
  for (const [id, jugador] of Object.entries(jugadores)) {
    if (id === network.id || jugador.muerto) continue;
    // ultimoDisparo viene del servidor en ms epoch (Date.now())
    const tiempoDesdeDisparo = ahora - (jugador.ultimoDisparo || 0);
    if (tiempoDesdeDisparo > MINIMAP_SHOT_WINDOW) continue;

    // Opacidad que se desvanece: 1 justo al disparar → 0 al final de la ventana
    const fade = 1 - tiempoDesdeDisparo / MINIMAP_SHOT_WINDOW;
    const ex = mx + jugador.x * scaleX;
    const ey = my + jugador.y * scaleY;

    // Halo exterior que se expande y desvanece
    ctx.save();
    ctx.globalAlpha = fade * 0.4;
    ctx.fillStyle = jugador.esBot ? '#ffb74d' : '#ef5350';
    ctx.beginPath();
    ctx.arc(ex, ey, 7 + (1 - fade) * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Punto central sólido
    ctx.save();
    ctx.globalAlpha = 0.5 + fade * 0.5;
    ctx.fillStyle = jugador.esBot ? '#ffb74d' : '#ef5350';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ex, ey, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---- Jugador local: siempre visible ----
  const jugadorLocal = jugadores[network.id];
  if (jugadorLocal && !jugadorLocal.muerto) {
    const px = mx + jugadorLocal.x * scaleX;
    const py = my + jugadorLocal.y * scaleY;

    // Triángulo apuntando en la dirección actual
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(jugadorLocal.angle);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ---- Cámara shake ----
function startShake(intensidad, duracionMs) {
  shakeIntensidad = Math.max(shakeIntensidad, intensidad);
  shakeUntil = Math.max(shakeUntil, performance.now() + duracionMs);
}

function getShakeOffset() {
  if (performance.now() >= shakeUntil) { shakeIntensidad = 0; return { sx: 0, sy: 0 }; }
  const t = 1 - (shakeUntil - performance.now()) / 500;
  const mag = shakeIntensidad * (1 - t);
  return { sx: (Math.random() - 0.5) * mag * 2, sy: (Math.random() - 0.5) * mag * 2 };
}

// ---- Kill feed ----
function drawKillFeed() {
  const ahora = performance.now();
  const activos = killFeed.filter((k) => k.hasta > ahora);
  killFeed.length = 0;
  killFeed.push(...activos);
  ctx.save();
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i < activos.length; i += 1) {
    const alpha = Math.min(1, (activos[i].hasta - ahora) / 800);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(activos[i].texto, window.innerWidth - 12, 60 + i * 22);
    ctx.fillStyle = '#ffd54a';
    ctx.fillText(activos[i].texto, window.innerWidth - 12, 60 + i * 22);
  }
  ctx.restore();
}

// ---- Daño flotante ----
function updateAndDrawFloatingNumbers() {
  const ahora = performance.now();
  const jugadorLocal = jugadores[network.id] || player;
  for (let i = floatingNumbers.length - 1; i >= 0; i -= 1) {
    const fn = floatingNumbers[i];
    const elapsed = ahora - fn.nacido;
    if (elapsed > fn.vida) { floatingNumbers.splice(i, 1); continue; }
    const alpha = 1 - elapsed / fn.vida;
    const sx = fn.x - jugadorLocal.x + window.innerWidth / 2;
    const sy = fn.y - jugadorLocal.y + window.innerHeight / 2 - elapsed * 0.06;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(fn.valor, sx, sy);
    ctx.fillStyle = fn.color;
    ctx.fillText(fn.valor, sx, sy);
    ctx.restore();
  }
}

// ---- Partículas ----
function updateParticulas(dt) {
  for (let i = particulas.length - 1; i >= 0; i -= 1) {
    const p = particulas[i];
    p.vida -= dt * 1000;
    if (p.vida <= 0) { particulas.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }
}

function drawParticulas(camX, camY) {
  ctx.save();
  for (const p of particulas) {
    const alpha = Math.max(0, p.vida / p.maxVida);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - camX + window.innerWidth / 2, p.y - camY + window.innerHeight / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Explosiones visuales ----
function updateExplosiones(dt) {
  const ahora = performance.now();
  for (let i = explosiones.length - 1; i >= 0; i -= 1) {
    const e = explosiones[i];
    e.radio = Math.min(e.maxRadio, e.radio + e.maxRadio * dt * 3);
    e.alfa = Math.max(0, 1 - (ahora - e.nacido) / 500);
    if (e.alfa <= 0) { explosiones.splice(i, 1); }
  }
}

function drawExplosiones(camX, camY) {
  ctx.save();
  for (const e of explosiones) {
    const sx = e.x - camX + window.innerWidth / 2;
    const sy = e.y - camY + window.innerHeight / 2;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, e.radio);
    grad.addColorStop(0, `rgba(255,220,80,${e.alfa})`);
    grad.addColorStop(0.5, `rgba(255,100,0,${e.alfa * 0.6})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, e.radio, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Zona segura (overlay en coordenadas de pantalla) ----
function drawZonaSegura(camX, camY) {
  if (!zonaSegura) return;
  const sx = zonaSegura.x - camX + window.innerWidth / 2;
  const sy = zonaSegura.y - camY + window.innerHeight / 2;
  const r = zonaSegura.radio;

  // Overlay rojo: rectángulo completo con hueco circular usando "evenodd"
  // Esto NO usa destination-out, por lo que no borra el canvas subyacente.
  ctx.save();
  ctx.fillStyle = 'rgba(200,20,20,0.18)';
  ctx.beginPath();
  // Rectángulo exterior (sentido horario)
  ctx.rect(0, 0, window.innerWidth, window.innerHeight);
  // Círculo interior (sentido antihorario = hueco con evenodd)
  ctx.arc(sx, sy, r, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();

  // Borde azul pulsante de la zona segura
  ctx.save();
  ctx.strokeStyle = 'rgba(100,180,255,0.75)';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---- Granadas en vuelo ----
function drawGranadas(camX, camY) {
  ctx.save();
  for (const g of granadosEnVuelo) {
    const sx = g.x - camX + window.innerWidth / 2;
    const sy = g.y - camY + window.innerHeight / 2;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(g.angle);
    ctx.fillStyle = '#8bc34a';
    ctx.strokeStyle = '#33691e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Punto parpadeante de fuze
    const fuzeAlfa = 0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 200));
    ctx.globalAlpha = fuzeAlfa;
    ctx.fillStyle = '#ff5722';
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---- Borde rojo cuando vida < 25 ----
function drawRedVignette(jugadorLocal) {
  if (!jugadorLocal || jugadorLocal.muerto) return;
  const vida = jugadorLocal.vida ?? 100;
  if (vida >= 25) return;
  const alpha = 0.12 + 0.22 * (1 - vida / 25) * (0.7 + 0.3 * Math.abs(Math.sin(performance.now() / 400)));
  const grad = ctx.createRadialGradient(
    window.innerWidth / 2, window.innerHeight / 2, window.innerHeight * 0.3,
    window.innerWidth / 2, window.innerHeight / 2, window.innerHeight * 0.85,
  );
  grad.addColorStop(0, 'rgba(220,0,0,0)');
  grad.addColorStop(1, `rgba(220,0,0,${alpha})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.restore();
}

function drawMatchTimer() {
  ctx.save();
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = tiempoPartida <= 10 ? '#ff5252' : '#fff';
  const minutos = Math.floor(tiempoPartida / 60);
  const segundos = String(tiempoPartida % 60).padStart(2, '0');
  ctx.fillText(`Tiempo: ${minutos}:${segundos}`, window.innerWidth / 2, 32);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = '#20242b';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  const jugadorLocal = jugadores[network.id] || player;
  const { sx: shakeX, sy: shakeY } = getShakeOffset();
  ctx.save();
  ctx.translate(window.innerWidth / 2 - jugadorLocal.x + shakeX, window.innerHeight / 2 - jugadorLocal.y + shakeY);

  // Repite la textura solo dentro del mapa, sin dibujar mosaicos fuera de sus límites.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, mapWidth, mapHeight);
  ctx.clip();
  if (floorImage.complete && floorImage.naturalWidth) {
    for (let x = 0; x < mapWidth; x += floorImage.naturalWidth) {
      for (let y = 0; y < mapHeight; y += floorImage.naturalHeight) {
        ctx.drawImage(floorImage, x, y);
      }
    }
  } else {
    ctx.fillStyle = '#334334';
    ctx.fillRect(0, 0, mapWidth, mapHeight);
  }
  ctx.restore();

  // Obstáculos estáticos: se dibujan antes de plataformas, balas y jugadores.
  for (const obstaculo of obstaculos) {
    if (obstacleImage.complete && obstacleImage.naturalWidth) {
      ctx.drawImage(obstacleImage, obstaculo.x, obstaculo.y, obstaculo.width, obstaculo.height);
    } else {
      ctx.fillStyle = '#555';
      ctx.fillRect(obstaculo.x, obstaculo.y, obstaculo.width, obstaculo.height);
    }
  }

  // Borde del mundo: ayuda a comprobar visualmente dónde no se puede avanzar.
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, mapWidth, mapHeight);

  // Las plataformas se dibujan antes que los jugadores, por lo que quedan debajo de ellos.
  for (const plataforma of plataformas) {
    if (platformImage.complete && platformImage.naturalWidth) {
      ctx.drawImage(
        platformImage,
        plataforma.x - platformImage.naturalWidth / 2,
        plataforma.y - platformImage.naturalHeight / 2,
      );
    } else {
      ctx.fillStyle = '#777';
      ctx.fillRect(plataforma.x - 28, plataforma.y - 14, 56, 28);
    }
    // El objeto se eleva visualmente sobre la plataforma.
    if (plataforma.objeto) drawItemIcon(plataforma.objeto, plataforma.x, plataforma.y - 42, 38);
  }

  // Items tirados en el suelo: pequeño icono con brillo parpadeante.
  for (const drop of itemsEnSuelo) {
    const pulso = 0.7 + 0.3 * Math.sin(performance.now() / 300);
    ctx.save();
    ctx.globalAlpha = pulso;
    // Halo
    ctx.fillStyle = 'rgba(255,213,74,0.22)';
    ctx.beginPath();
    ctx.arc(drop.x, drop.y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawItemIcon(drop.item, drop.x, drop.y, 32);
    // Etiqueta
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.strokeText(drop.item, drop.x, drop.y + 26);
    ctx.fillStyle = '#ffd54a';
    ctx.fillText(drop.item, drop.x, drop.y + 26);
    ctx.restore();
  }

  // Todas las balas provienen del estado enviado por el servidor.
  // Balas: usa imagen si cargó, si no dibuja un círculo simple
  for (const bala of balas) {
    ctx.save();
    ctx.translate(bala.x, bala.y);
    ctx.rotate(bala.angle);
    if (bulletImage.complete && bulletImage.naturalWidth) {
      if (bala.arma !== 'puños') {
        ctx.drawImage(bulletImage, -bulletImage.naturalWidth / 2, -bulletImage.naturalHeight / 2);
      }
    } else if (bala.arma !== 'puños') {
      ctx.fillStyle = '#ffe082';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Jugadores: siempre se dibujan aunque no haya sprite
  const SPRITE_R = 20; // radio para el fallback sin sprite
  for (const id in jugadores) {
    const jugador = jugadores[id];
    if (jugador.muerto) continue;

    ctx.save();
    ctx.translate(jugador.x, jugador.y);
    ctx.rotate(jugador.angle);
    if (player.image.complete && player.image.naturalWidth) {
      ctx.drawImage(player.image, -player.image.naturalWidth / 2, -player.image.naturalHeight / 2);
    } else {
      // Fallback: círculo de color con línea indicando dirección
      ctx.fillStyle = jugador.esBot ? '#ffb74d' : (id === network.id ? '#4fc3f7' : '#ef5350');
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, SPRITE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Línea de dirección
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(SPRITE_R + 8, 0);
      ctx.stroke();
    }
    ctx.restore();
    drawWeaponOnPlayer(jugador);

    const spriteHalfH = (player.image.complete && player.image.naturalWidth)
      ? player.image.naturalHeight / 2 : SPRITE_R;

    // Etiqueta con nombre/BOT
    ctx.save();
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(jugador.esBot ? 'BOT' : (jugador.nombre || ''), jugador.x, jugador.y - spriteHalfH - 28);
    ctx.fillStyle = jugador.esBot ? '#ffb74d' : '#fff';
    ctx.fillText(jugador.esBot ? 'BOT' : (jugador.nombre || ''), jugador.x, jugador.y - spriteHalfH - 28);
    ctx.restore();

    // Barra de salud
    const barWidth = 56;
    const barHeight = 7;
    const barY = jugador.y - spriteHalfH - 16;
    const vida = Math.max(0, Math.min(100, jugador.vida));
    ctx.fillStyle = '#c62828';
    ctx.fillRect(jugador.x - barWidth / 2, barY, barWidth, barHeight);
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(jugador.x - barWidth / 2, barY, barWidth * (vida / 100), barHeight);

    // Barra de escudo
    const escudo = Math.max(0, Math.min(100, jugador.escudo || 0));
    if (escudo > 0) {
      const shieldBarY = barY + barHeight + 3;
      ctx.fillStyle = '#263238';
      ctx.fillRect(jugador.x - barWidth / 2, shieldBarY, barWidth, barHeight);
      ctx.fillStyle = '#2196f3';
      ctx.fillRect(jugador.x - barWidth / 2, shieldBarY, barWidth * (escudo / 100), barHeight);
    }
  }

  // Indicador de intercambio en coordenadas del mundo, cerca del jugador local.
  const nearbyLoot = getNearbyLootPlatform(jugadorLocal);
  if (nearbyLoot && !isMobile) {
    ctx.save();
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.strokeText('Presiona E para intercambiar', jugadorLocal.x, jugadorLocal.y - 70);
    ctx.fillStyle = '#fff';
    ctx.fillText('Presiona E para intercambiar', jugadorLocal.x, jugadorLocal.y - 70);
    ctx.restore();
  }

  // Indicador de tirar item cerca del jugador (PC).
  if (!isMobile) {
    const jl = jugadores[network.id];
    const itemActual = jl?.inventario?.[jl?.slotSeleccionado];
    if (itemActual) {
      ctx.save();
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      let hints = ['G: Tirar'];
      if (itemActual === 'granada') hints.unshift('F: Lanzar');
      ctx.strokeText(hints.join(' | '), jugadorLocal.x, jugadorLocal.y - (nearbyLoot ? 92 : 70));
      ctx.fillStyle = '#ffd54a';
      ctx.fillText(hints.join(' | '), jugadorLocal.x, jugadorLocal.y - (nearbyLoot ? 92 : 70));
      ctx.restore();
    }
  }

  // Granadas en vuelo (en coordenadas mundo = dentro del save de cámara)
  for (const g of granadosEnVuelo) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    ctx.fillStyle = '#8bc34a';
    ctx.strokeStyle = '#33691e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Punto fuze parpadeante
    const fuzeAlfa = 0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 200));
    ctx.save();
    ctx.globalAlpha = fuzeAlfa;
    ctx.fillStyle = '#ff5722';
    ctx.beginPath();
    ctx.arc(g.x, g.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Restaura el contexto para que la cámara no afecte al siguiente frame.
  ctx.restore();

  // ---- Efectos de pantalla (coordenadas de pantalla, sin cámara) ----
  const camX = jugadorLocal.x;
  const camY = jugadorLocal.y;
  drawZonaSegura(camX, camY);
  drawExplosiones(camX, camY);
  drawParticulas(camX, camY);
  drawRedVignette(jugadores[network.id]);

  actualizarMensajeRespawn(jugadorLocal);
  swapButton?.classList.toggle('visible', Boolean(nearbyLoot && isMobile));
  drawInventoryUI(jugadorLocal);
  drawAmmoUI(jugadorLocal);
  drawConsumeAnim();
  drawMatchTimer();
  drawKillFeed();
  updateAndDrawFloatingNumbers();
  drawMinimap();
}

let previousTime = performance.now();
function gameLoop(currentTime) {
  const deltaSeconds = Math.min((currentTime - previousTime) / 1000, 0.1);
  previousTime = currentTime;
  if (gameStarted && !gameFinished) {
    update(deltaSeconds);
    updateParticulas(deltaSeconds);
    updateExplosiones(deltaSeconds);
  }
  // Dibuja siempre que haya datos: si la partida ya corría al unirse, se ve el mapa de inmediato
  if (gameStarted || Object.keys(jugadores).length > 0) {
    draw();
  }
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
