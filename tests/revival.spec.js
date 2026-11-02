const { test, expect } = require('@playwright/test');

for (const map of ['outpost', 'orbital'])
test(`Abatidos reales: levantar, cancelar y volver con 25 de vida (${map})`, async ({ page, context }, testInfo) => {
  test.setTimeout(45000);
  const errors = [];
  const pages = [page];
  for (let i = 0; i < 3; i += 1) pages.push(await context.newPage());
  for (const [i, client] of pages.entries()) {
    client.on('pageerror', error => errors.push(error.message));
    await client.goto('/');
    await expect(client.locator('#jugar-button')).toBeEnabled();
    await client.locator('#nickname').fill(`Jugador ${i}`);
    if (i === 0) {
      await client.locator('#tab-equipos').click();
      await client.locator('#match-bots').selectOption('0');
      await client.locator('#match-map').selectOption(map);
    }
    await client.locator('#jugar-button').click();
  }
  await expect(page.locator('#room-players li')).toHaveCount(4);
  await page.locator('#start-match').click();
  await page.waitForFunction(() => gameStarted && preparacionRestante === 0);
  const ownTeam = await page.evaluate(() => jugadores[network.id].equipo);
  const teammates = [], enemies = [];
  for (const client of pages.slice(1)) {
    const team = await client.evaluate(() => jugadores[network.id].equipo);
    (team === ownTeam ? teammates : enemies).push(client);
  }
  const victim = teammates[0], shooter = enemies[0];
  const id = await victim.evaluate(() => network.id);
  const origin = await page.evaluate(() => {
    const walls = obstaculos.flatMap(Buildings.walls);
    for (let y = 1600; y < 4400; y += 180) {
      for (let x = 1600; x < 4400; x += 250) {
        if (walls.some(wall => wall.x < x + 250 && wall.x + wall.width > x - 50
          && wall.y < y + 200 && wall.y + wall.height > y - 50)) continue;
        if (SpecialZones.zones.some(zone => Math.hypot(x + 100 - zone.x, y - zone.y) < zone.radio + 300)) continue;
        return { x, y };
      }
    }
    throw new Error('No hay zona de prueba libre');
  });
  for (const [client, offset] of [[shooter, [0, 0]], [victim, [140, 0]], [page, [140, 80]], [enemies[1], [0, 180]]]) {
    await client.evaluate(({ origin, offset }) => {
      const target = { x: origin.x + offset[0], y: origin.y + offset[1], angle: 0 };
      window.originalSend = network.send;
      network.send = function (type, data) {
        return window.originalSend.call(this, type, type === 'movimiento' ? { ...data, ...target } : data);
      };
      Object.assign(player, target);
      network.send('movimiento', target);
    }, { origin, offset });
  }
  await page.waitForFunction(({ id, origin }) => Math.hypot(jugadores[id].x - origin.x - 140, jugadores[id].y - origin.y) < 1, { id, origin });
  for (let shot = 0; shot < 7; shot += 1) {
    await shooter.evaluate(origin => network.send('disparar', { ...origin, angle: 0 }), origin);
    await page.waitForTimeout(700);
  }
  await page.waitForFunction(id => jugadores[id]?.abatido, id);
  await expect(victim.locator('#respawn-message')).toContainText('Abatido');
  expect(await page.evaluate(() => currentTeams.puntos)).toEqual({ azul: 0, rojo: 0 });
  await page.bringToFront();
  const mobile = await page.evaluate(() => isMobile);
  const button = page.locator('#swap-button');
  async function hold() {
    if (mobile) {
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
    } else await page.keyboard.down('e');
  }
  async function release() {
    if (mobile) await page.mouse.up();
    else await page.keyboard.up('e');
  }
  await hold();
  await page.waitForFunction(id => jugadores[id]?.progresoReanimacion > 0.15, id);
  await release();
  await page.waitForFunction(id => jugadores[id]?.progresoReanimacion === 0, id);
  expect(await page.evaluate(id => jugadores[id].abatido, id)).toBe(true);
  await hold();
  await page.waitForFunction(id => jugadores[id]?.progresoReanimacion > 0.3, id);
  await page.screenshot({ path: testInfo.outputPath('reviving-teammate.png') });
  await page.waitForFunction(id => jugadores[id]?.abatido === false && jugadores[id]?.vida === 25, id);
  await release();
  await expect(victim.locator('#respawn-message')).not.toHaveClass(/visible/);
  expect(await page.evaluate(id => jugadores[id].escudo, id)).toBe(0);
  expect(await page.evaluate(() => currentTeams.puntos)).toEqual({ azul: 0, rojo: 0 });
  for (const client of pages) {
    await client.evaluate(() => { network.send = window.originalSend; });
    await client.locator('#leave-match').click();
  }
  for (const client of pages.slice(1)) await client.close();
  expect(errors).toEqual([]);
});
