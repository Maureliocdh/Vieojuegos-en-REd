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
let mapWidth = 2000;
let mapHeight = 2000;
let gameStarted = false;
let gameFinished = false;
let networkReady = false;
let tiempoPartida = 120;

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
};
let lastShotTime = -Infinity;
let cooldownFeedbackUntil = 0;
let cooldownFeedbackSlot = -1;
let noAmmoMessageUntil = 0;

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

network.on('estadoJuego', ({ jugadores: jugadoresDelServidor, balas: balasDelServidor, plataformas: plataformasDelServidor, obstaculos: obstaculosDelServidor }) => {
  jugadores = jugadoresDelServidor;
  balas = balasDelServidor;
  plataformas = plataformasDelServidor || [];
  obstaculos = obstaculosDelServidor || obstaculos;
  actualizarScoreboard(jugadores);

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
        'tiempoPartida', 'finDeJuego', 'reinicioPartida',
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
// Se reutiliza el sprite del jugador como marcador temporal para el slot "puños".
itemImages.puños.src = '/assets/sprites/jugador.png';

/** Ajusta el búfer para pantallas retina sin cambiar las coordenadas del juego. */
function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
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

  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Digit1', 'Digit2', 'Digit3', 'KeyE', 'KeyR'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  const slot = { Digit1: 0, Digit2: 1, Digit3: 2 }[event.code];
  if (slot !== undefined) selectSlot(slot);
  if (event.code === 'KeyE' && !event.repeat) attemptExchange();
  if (event.code === 'KeyR' && !event.repeat) requestReload();
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

  if (jugadorLocal?.recargando) return false;
  if (statsCliente.capacidadCargador && jugadorLocal?.balasEnCargador <= 0) {
    // Feedback inmediato: no se envía un disparo inútil al servidor.
    noAmmoMessageUntil = ahora + 1800;
    return false;
  }

  // Si el intento local está dentro del cooldown, el slot se marca en rojo temporalmente.
  if (ahora - lastShotTime < cooldown) {
    cooldownFeedbackUntil = ahora + 220;
    cooldownFeedbackSlot = jugadorLocal?.slotSeleccionado ?? 0;
    return false;
  }

  lastShotTime = ahora;
  network.send('disparar', { x: player.x, y: player.y, angle: player.angle });
  return true;
}

function requestReload() {
  if (gameStarted && !jugadores[network.id]?.muerto) network.send('recargar', {});
}

canvas.addEventListener('mousedown', (event) => {
  if (!isMobile && event.button === 0) shoot();
});

/** Cambia el slot local para respuesta inmediata y lo sincroniza por el transporte activo. */
function selectSlot(slot) {
  if (!gameStarted || !Number.isInteger(slot) || slot < 0 || slot > 2) return;
  const jugadorLocal = jugadores[network.id];
  if (jugadorLocal) jugadorLocal.slotSeleccionado = slot;
  network.send('cambiarSlot', { slot });
}

function getInventorySlotAt(screenX, screenY) {
  const size = 64;
  const gap = 12;
  const totalWidth = size * 3 + gap * 2;
  const startX = (window.innerWidth - totalWidth) / 2;
  const startY = window.innerHeight - size - 24;
  if (screenY < startY || screenY > startY + size) return null;
  const slot = Math.floor((screenX - startX) / (size + gap));
  const slotX = startX + slot * (size + gap);
  return slot >= 0 && slot < 3 && screenX <= slotX + size ? slot : null;
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
  const size = 64;
  const gap = 12;
  const totalWidth = size * 3 + gap * 2;
  const startX = (window.innerWidth - totalWidth) / 2;
  const startY = window.innerHeight - size - 24;
  const inventario = jugadorLocal.inventario || ['puños', null, null];

  for (let slot = 0; slot < 3; slot += 1) {
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
    if (inventario[slot]) drawItemIcon(inventario[slot], x + size / 2, startY + size / 2, 42);

    ctx.fillStyle = '#ffffff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(slot + 1), x + 5, startY + 15);
  }
}

function drawAmmoUI(jugadorLocal) {
  const arma = jugadorLocal?.inventario?.[jugadorLocal.slotSeleccionado] || 'puños';
  const stats = STATS_ARMAS_CLIENTE[arma];
  if (!stats?.capacidadCargador) return;

  ctx.save();
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
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
  if (noAmmoMessageUntil > performance.now()) {
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#ffcc80';
    ctx.fillText('Sin balas. Presiona R para recargar', window.innerWidth / 2, window.innerHeight - 122);
  }
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

  // El jugador local es la referencia de la cámara. Antes de recibir estado se usa la predicción local.
  const jugadorLocal = jugadores[network.id] || player;
  ctx.save();
  ctx.translate(window.innerWidth / 2 - jugadorLocal.x, window.innerHeight / 2 - jugadorLocal.y);

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

  // Todas las balas provienen del estado enviado por el servidor.
  if (bulletImage.complete && bulletImage.naturalWidth) {
    for (const bala of balas) {
      ctx.save();
      ctx.translate(bala.x, bala.y);
      ctx.rotate(bala.angle);
      if (bala.arma !== 'puños') {
        ctx.drawImage(bulletImage, -bulletImage.naturalWidth / 2, -bulletImage.naturalHeight / 2);
      }
      ctx.restore();
    }
  }

  if (player.image.complete && player.image.naturalWidth) {
    // Cada entrada fue creada y sincronizada por el servidor.
    for (const id in jugadores) {
      const jugador = jugadores[id];
      if (jugador.muerto) continue;

      // Se traslada al centro antes de rotar: la imagen rota sobre su propio centro.
      ctx.save();
      ctx.translate(jugador.x, jugador.y);
      ctx.rotate(jugador.angle);
      ctx.drawImage(player.image, -player.image.naturalWidth / 2, -player.image.naturalHeight / 2);
      ctx.restore();
      drawWeaponOnPlayer(jugador);

      // Etiqueta visible para distinguir la IA de los jugadores humanos.
      ctx.save();
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(jugador.esBot ? 'BOT' : (jugador.nombre || ''), jugador.x, jugador.y - player.image.naturalHeight / 2 - 28);
      ctx.fillStyle = jugador.esBot ? '#ffb74d' : '#fff';
      ctx.fillText(jugador.esBot ? 'BOT' : (jugador.nombre || ''), jugador.x, jugador.y - player.image.naturalHeight / 2 - 28);
      ctx.restore();

      // Barra de salud encima de cada sprite: fondo rojo y vida restante en verde.
      const barWidth = 56;
      const barHeight = 7;
      const barY = jugador.y - player.image.naturalHeight / 2 - 16;
      const vida = Math.max(0, Math.min(100, jugador.vida));
      ctx.fillStyle = '#c62828';
      ctx.fillRect(jugador.x - barWidth / 2, barY, barWidth, barHeight);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(jugador.x - barWidth / 2, barY, barWidth * (vida / 100), barHeight);

      // Segunda barra: el escudo se muestra en azul debajo de la vida.
      const escudo = Math.max(0, Math.min(100, jugador.escudo || 0));
      if (escudo > 0) {
        const shieldBarY = barY + barHeight + 3;
        ctx.fillStyle = '#263238';
        ctx.fillRect(jugador.x - barWidth / 2, shieldBarY, barWidth, barHeight);
        ctx.fillStyle = '#2196f3';
        ctx.fillRect(jugador.x - barWidth / 2, shieldBarY, barWidth * (escudo / 100), barHeight);
      }
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

  // Restaura el contexto para que la cámara no afecte al siguiente frame.
  ctx.restore();
  actualizarMensajeRespawn(jugadorLocal);
  swapButton?.classList.toggle('visible', Boolean(nearbyLoot && isMobile));
  drawInventoryUI(jugadorLocal);
  drawAmmoUI(jugadorLocal);
  drawMatchTimer();
}

let previousTime = performance.now();
function gameLoop(currentTime) {
  // Se limita el delta para que no salte al regresar a la pestaña.
  const deltaSeconds = Math.min((currentTime - previousTime) / 1000, 0.1);
  previousTime = currentTime;
  if (gameStarted && !gameFinished) {
    update(deltaSeconds);
    draw();
  }
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
