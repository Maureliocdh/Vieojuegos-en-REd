const { test, expect } = require('@playwright/test');

test('Desierto persistente: carpas abiertas, suministros, cactus y todos los modos', async ({ page }, testInfo) => {
  test.setTimeout(50000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#nickname').fill('Nómada');
  await page.locator('#match-map').selectOption('desierto');
  await page.locator('#match-bots').selectOption('0');
  await page.reload();
  await expect(page.locator('#map-name')).toHaveText('Desierto Ámbar');
  await expect(page.locator('#match-map')).toHaveValue('desierto');
  await page.locator('[data-skin=duna]').click();
  await page.screenshot({ path: testInfo.outputPath('desert-lobby.png'), fullPage: true });
  for (const mode of ['clasico', 'puzzles', 'solo', 'equipos']) {
    await page.locator(`[data-mode=${mode}]`).click();
    await page.locator('#jugar-button').click();
    await expect(page.locator('#room-rules')).toContainText('Desierto Ámbar');
    await page.locator('#start-match').click();
    await page.waitForFunction(() => gameStarted && WorldArt.map === 'desierto');
    expect(await page.evaluate(() => ({
      tents: obstaculos.filter(object => object.tipo === 'carpa').length,
      buildings: obstaculos.filter(object => object.tipo === 'casa' || object.tipo === 'almacen').length,
      portals: portales.length, skin: jugadores[network.id].skin,
    }))).toEqual({ tents: 4, buildings: 0, portals: 0, skin: 'duna' });
    if (mode === 'clasico') {
      await expect(page.locator('#match-countdown')).toBeHidden({ timeout: 8000 });
      const textures = await page.evaluate(() => {
        const surface = document.createElement('canvas');
        surface.width = 600; surface.height = 600;
        const context = surface.getContext('2d');
        const areas = [...SpecialZones.zones];
        const samples = {};
        try {
          for (const map of ['desierto', 'outpost', 'orbital']) {
            WorldArt.setMap(map);
            for (const tipo of ['contaminacion', 'hielo']) {
              const zone = areas.find(area => area.tipo === tipo);
              SpecialZones.zones.splice(0, SpecialZones.zones.length, {
                ...zone, x: 300, y: 300,
                points: zone.points.map(point => ({ x: point.x - zone.x + 300, y: point.y - zone.y + 300 })),
              });
              context.clearRect(0, 0, 600, 600);
              WorldArt.specialZones(context);
              const pixels = context.getImageData(250, 250, 100, 100).data;
              let red = 0, blue = 0, green = 0, sand = 0;
              for (let i = 0; i < pixels.length; i += 4) {
                const [r, g, b, a] = pixels.subarray(i, i + 4);
                if (!a) continue;
                if (r > g * 1.3 && g > b * 1.5) red++;
                if (b > r && b > g) blue++;
                if (g > r && g > b) green++;
                if (r > g && g > b && r < g * 1.8) sand++;
              }
              samples[`${map}-${tipo}`] = { red, blue, green, sand };
            }
          }
        } finally {
          SpecialZones.zones.splice(0, SpecialZones.zones.length, ...areas);
          WorldArt.setMap('desierto');
        }
        return samples;
      });
      expect(textures['desierto-contaminacion'].red).toBeGreaterThan(5000);
      expect(textures['desierto-hielo'].sand).toBeGreaterThan(5000);
      for (const map of ['outpost', 'orbital']) {
        expect(textures[`${map}-contaminacion`].green).toBeGreaterThan(5000);
        expect(textures[`${map}-hielo`].blue).toBeGreaterThan(5000);
      }
      await page.evaluate(() => {
        const tent = obstaculos.find(object => object.tipo === 'carpa');
        const target = { x: tent.x + tent.width / 2, y: tent.y + 130 };
        window.originalSend = network.send;
        network.send = function (type, data) {
          window.originalSend.call(this, type, type === 'movimiento' ? { ...data, ...target } : data);
        };
        Object.assign(player, target);
      });
      await page.waitForFunction(() => getNearbyChest(jugadores[network.id]));
      await page.screenshot({ path: testInfo.outputPath('desert-tent-interior.png') });
      if (await page.evaluate(() => isMobile)) await page.locator('#swap-button').click();
      else await page.keyboard.press('e');
      await page.waitForFunction(() => cofres.some(chest => chest.abierto));
      const tentRoof = await page.evaluate(() => {
        const tent = obstaculos.find(object => object.tipo === 'carpa');
        const target = { x: tent.x + 450, y: tent.y + 350 };
        network.send = function (type, data) {
          window.originalSend.call(this, type, type === 'movimiento' ? { ...data, ...target } : data);
        };
        Object.assign(player, target);
        return target;
      });
      await page.waitForFunction(target => Math.hypot(jugadores[network.id].x - target.x, jugadores[network.id].y - target.y) < 10, tentRoof);
      await page.screenshot({ path: testInfo.outputPath('desert-tent-exterior.png') });
      await page.evaluate(() => { network.send = window.originalSend; });
    }
    if (mode === 'puzzles') await expect(page.locator('#tactical-screen')).toBeVisible();
    await page.locator('#leave-match').click();
    await expect(page.locator('#jugar-button')).toBeEnabled();
  }
  await page.locator('#match-map').selectOption('outpost');
  await page.locator('#jugar-button').click();
  await page.waitForFunction(() => WorldArt.map === 'outpost' && !obstaculos.some(object => object.tipo === 'carpa'));
  await page.locator('#leave-match').click();
  expect(errors).toEqual([]);
});

test('Seis skins temáticas: siluetas distintas, imágenes válidas, persistencia y réplica multijugador', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await expect(page.locator('#skin-picker button')).toHaveCount(12);
  await expect(page.locator('#skin-count')).toHaveText('12 / DISPONIBLES');
  for (const theme of ['desierto', 'orbital', 'outpost']) {
    await expect(page.locator(`#skin-picker [data-theme=${theme}]`)).toHaveCount(2);
  }
  for (const id of ['duna', 'siroco', 'cosmo', 'pulsar', 'ceiba', 'ranger']) {
    await page.locator(`[data-skin=${id}]`).click();
    await page.reload();
    await expect(page.locator(`[data-skin=${id}]`)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => document.getElementById('skin-preview').complete
      && document.getElementById('skin-preview').naturalWidth > 0);
    await page.waitForFunction(() => Object.values(WorldArt.images).every(image => image.complete && image.naturalWidth > 0));
  }
  await page.screenshot({ path: testInfo.outputPath('twelve-skins.png'), fullPage: true });
  await page.locator('#nickname').fill('Ranger');
  await page.locator('#match-bots').selectOption('0');
  await page.locator('#jugar-button').click();
  const guest = await context.newPage();
  await guest.goto('/');
  await expect(guest.locator('#jugar-button')).toBeEnabled();
  await guest.locator('#nickname').fill('Cosmo');
  await guest.locator('[data-skin=cosmo]').click();
  await guest.locator('#jugar-button').click();
  await expect(page.locator('#room-players li')).toHaveCount(2);
  await page.locator('#start-match').click();
  await page.waitForFunction(() => Object.values(jugadores).some(player => player.nombre === 'Cosmo' && player.skin === 'cosmo'));
  await guest.waitForFunction(() => Object.values(jugadores).some(player => player.nombre === 'Ranger' && player.skin === 'ranger'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#leave-match').click();
  await guest.locator('#leave-match').click();
  await guest.close();
  expect(errors).toEqual([]);
});
