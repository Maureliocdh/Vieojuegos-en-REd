const { test, expect } = require('@playwright/test');

test('Miras: cinco estilos, selección local, persistencia y centro constante', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  const guest = await context.newPage();
  await guest.goto('/');
  await expect(guest.locator('#jugar-button')).toBeEnabled();
  await page.locator('.lobby-header .settings-trigger').click();
  await expect(page.locator('#crosshair-picker button')).toHaveCount(5);
  for (const id of ['classic', 'cross', 'dot', 'ring', 'chevron']) {
    const button = page.locator(`[data-crosshair=${id}]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#crosshair-picker [aria-pressed=true]')).toHaveCount(1);
    const preview = await button.locator('img').evaluate(async image => {
      await image.decode();
      return { file: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight };
    });
    expect(preview.width).toBe(32); expect(preview.height).toBe(32);
    const cursor = await page.locator('#game').evaluate(element => getComputedStyle(element).cursor);
    expect(cursor).toContain(`${preview.file}`);
    expect(cursor).toMatch(/16 16, crosshair$/);
  }
  expect(await guest.evaluate(() => ArenaUI.crosshair)).toBe('classic');
  await page.reload();
  await page.locator('.lobby-header .settings-trigger').click();
  await expect(page.locator('[data-crosshair=chevron]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('outpost-settings'));
    saved.crosshair = 'invalid';
    localStorage.setItem('outpost-settings', JSON.stringify(saved));
  });
  await page.reload();
  expect(await page.evaluate(() => ArenaUI.crosshair)).toBe('classic');
  await guest.close();
});

test('Mira centrada en el canvas sin cambiar cursores de menús ni coordenadas de apuntado', async ({ page }) => {
  const response = await page.request.get('/assets/crosshair.svg');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  const result = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/assets/crosshair.svg';
    await image.decode();
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: bounds.left + 123, clientY: bounds.top + 234 }));
    return {
      cursor: getComputedStyle(canvas).cursor,
      menu: getComputedStyle(inicioScreen).cursor,
      button: getComputedStyle(playButton).cursor,
      width: image.naturalWidth, height: image.naturalHeight,
      aim: { x: mouse.x, y: mouse.y },
    };
  });
  expect(result.cursor).toMatch(/crosshair\.svg"\) 16 16, crosshair$/);
  expect(result.menu).toBe('auto');
  expect(result.button).toBe('pointer');
  expect(result.width).toBe(32);
  expect(result.height).toBe(32);
  expect(result.aim).toEqual({ x: 123, y: 234 });
});

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
