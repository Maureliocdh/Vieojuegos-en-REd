const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const socket = io();
// Esta copia se actualiza con el estado global que envía el servidor.
let jugadores = {};
let balas = [];
let mapWidth = 2000;
let mapHeight = 2000;

// Se comprueba una vez: en móviles se añaden controles táctiles.
const isMobile = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent);
const keys = new Set();
const mouse = { x: 0, y: 0 };
const movement = { x: 0, y: 0 };
const aim = { x: 1, y: 0 };
const FIRE_COOLDOWN = 300;
let lastShotTime = -Infinity;

const player = {
  x: window.innerWidth / 2, y: window.innerHeight / 2, angle: 0, speed: 350,
  image: new Image(),
};
const bulletImage = new Image();
const floorImage = new Image();

socket.on('configMapa', ({ MAP_WIDTH, MAP_HEIGHT }) => {
  mapWidth = MAP_WIDTH;
  mapHeight = MAP_HEIGHT;
});

socket.on('estadoJuego', ({ jugadores: jugadoresDelServidor, balas: balasDelServidor }) => {
  jugadores = jugadoresDelServidor;
  balas = balasDelServidor;

  // Sincroniza el jugador local, especialmente tras un respawn del servidor.
  const jugadorLocal = jugadores[socket.id];
  if (jugadorLocal) {
    player.x = jugadorLocal.x;
    player.y = jugadorLocal.y;
    player.angle = jugadorLocal.angle;
  }
});

// La notificación permite quitarlo sin esperar al siguiente tick de 30 FPS.
socket.on('jugadorDesconectado', (id) => {
  delete jugadores[id];
});

// Express sirve "public" como raíz estática, por eso la ruta comienza con /.
player.image.src = '/assets/sprites/jugador.png';
player.image.addEventListener('error', () => console.error('No se pudo cargar /assets/sprites/jugador.png'));
bulletImage.src = '/assets/sprites/bala.png';
bulletImage.addEventListener('error', () => console.error('No se pudo cargar /assets/sprites/bala.png'));
floorImage.src = '/assets/tiles/suelo.png';
floorImage.addEventListener('error', () => console.error('No se pudo cargar /assets/tiles/suelo.png'));

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
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
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
  socket.emit('disparar', { x: player.x, y: player.y, angle: player.angle });
}

canvas.addEventListener('mousedown', (event) => {
  if (event.button === 0) shoot();
});

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
    // El joystick derecho permite apuntar y dispara como máximo una vez cada 300 ms.
    const now = performance.now();
    if (now - lastShotTime >= FIRE_COOLDOWN) {
      lastShotTime = now;
      shoot();
    }
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
  socket.emit('movimiento', { x: player.x, y: player.y, angle: player.angle });
}

function draw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = '#20242b';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  // El jugador local es la referencia de la cámara. Antes de recibir estado se usa la predicción local.
  const jugadorLocal = jugadores[socket.id] || player;
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

  // Borde del mundo: ayuda a comprobar visualmente dónde no se puede avanzar.
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, mapWidth, mapHeight);

  // Todas las balas provienen del estado enviado por el servidor.
  if (bulletImage.complete && bulletImage.naturalWidth) {
    for (const bala of balas) {
      ctx.save();
      ctx.translate(bala.x, bala.y);
      ctx.rotate(bala.angle);
      ctx.drawImage(bulletImage, -bulletImage.naturalWidth / 2, -bulletImage.naturalHeight / 2);
      ctx.restore();
    }
  }

  if (!player.image.complete || !player.image.naturalWidth) return;

  // Cada entrada fue creada y sincronizada por el servidor.
  for (const id in jugadores) {
    const jugador = jugadores[id];

    // Se traslada al centro antes de rotar: la imagen rota sobre su propio centro.
    ctx.save();
    ctx.translate(jugador.x, jugador.y);
    ctx.rotate(jugador.angle);
    ctx.drawImage(player.image, -player.image.naturalWidth / 2, -player.image.naturalHeight / 2);
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
  }

  // Restaura el contexto para que la cámara no afecte al siguiente frame.
  ctx.restore();
}

let previousTime = performance.now();
function gameLoop(currentTime) {
  // Se limita el delta para que no salte al regresar a la pestaña.
  const deltaSeconds = Math.min((currentTime - previousTime) / 1000, 0.1);
  previousTime = currentTime;
  update(deltaSeconds);
  draw();
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
