const { test, expect } = require('@playwright/test');

test('Render omite objetos fuera de cámara y conserva el borde visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  const result = await page.evaluate(() => {
    const originalDrawItem = drawItemIcon;
    const originalBush = WorldArt.bush;
    const originalRoof = WorldArt.roof;
    const state = { jugadores, itemsEnSuelo, plataformas, obstaculos, cofres, balas, granadosEnVuelo, gameStarted };
    const icons = [], bushes = [], roofs = [];
    try {
      gameStarted = true;
      jugadores = { [network.id]: { x: 1000, y: 1000, angle: 0, unido: true, vida: 100, inventario: ['puños'], slotSeleccionado: 0 } };
      plataformas = []; cofres = []; balas = []; granadosEnVuelo = [];
      itemsEnSuelo = [
        { item: 'pistola', x: 1000, y: 1000 },
        { item: 'rifle', x: 1000 + innerWidth / 2 + 20, y: 1000 },
        { item: 'sniper', x: 5000, y: 5000 },
      ];
      obstaculos = [
        { id: 'near-bush', tipo: 'arbusto', x: 1000, y: 1000, width: 100, height: 100 },
        { id: 'far-bush', tipo: 'arbusto', x: 5000, y: 5000, width: 100, height: 100 },
        { id: 'near-house', tipo: 'casa', x: 1100, y: 1100, width: 100, height: 100 },
        { id: 'far-house', tipo: 'casa', x: 5000, y: 5000, width: 100, height: 100 },
      ];
      drawItemIcon = (item, x, y, ...args) => { if (y === 1000) icons.push(item); originalDrawItem(item, x, y, ...args); };
      WorldArt.bush = (_ctx, object) => bushes.push(object.id);
      WorldArt.roof = (_ctx, object) => roofs.push(object.id);
      draw();
      return { icons, bushes, roofs };
    } finally {
      drawItemIcon = originalDrawItem; WorldArt.bush = originalBush; WorldArt.roof = originalRoof;
      ({ jugadores, itemsEnSuelo, plataformas, obstaculos, cofres, balas, granadosEnVuelo, gameStarted } = state);
    }
  });
  expect(result).toEqual({ icons: ['pistola', 'rifle'], bushes: ['near-bush'], roofs: ['near-house'] });
});

test('Marcador reutiliza nodos sin cambios y actualiza nombres, bajas y puestos', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  const result = await page.evaluate(() => {
    const players = { a: { unido: true, nombre: 'Uno', kills: 1 }, b: { unido: true, nombre: 'Dos', kills: 0 } };
    actualizarScoreboard(players);
    const first = scoreboard.firstChild;
    actualizarScoreboard(players);
    const reused = first === scoreboard.firstChild;
    players.b.kills = 2;
    players.b.nombre = 'Nuevo';
    actualizarScoreboard(players);
    const ranking = [...scoreboard.children].map(node => node.textContent);
    actualizarScoreboard({});
    return { reused, ranking, empty: scoreboard.childElementCount === 0 };
  });
  expect(result).toEqual({ reused: true, ranking: ['Nuevo: 2', 'Uno: 1'], empty: true });
});
