const { test, expect } = require('@playwright/test');

test('Portales espaciales: render, interacción real, cooldown, retorno y limpieza al cambiar mapa', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#nickname').fill('Viajero');
  await page.locator('#match-map').selectOption('orbital');
  await page.locator('#match-bots').selectOption('0');
  await page.locator('#jugar-button').click();
  await page.locator('#start-match').click();
  await page.waitForFunction(() => gameStarted && preparacionRestante === 0);
  const { source, destination, mobile } = await page.evaluate(() => {
    const source = portales[0], destination = portales.find(portal => portal.id === source.destinoId);
    if (portales.length !== 12) throw new Error('Faltan portales');
    window.originalSend = network.send;
    network.send = function (type, data) {
      if (type !== 'movimiento') window.originalSend.call(this, type, data);
    };
    window.originalSend.call(network, 'movimiento', { x: source.x, y: source.y, angle: 0 });
    return { source, destination, mobile: isMobile };
  });
  await page.waitForFunction(source => jugadores[network.id].x === source.x && jugadores[network.id].y === source.y, source);
  await page.screenshot({ path: testInfo.outputPath('station-portals.png') });
  const usePortal = async () => {
    if (mobile) await page.locator('#swap-button').click();
    else await page.keyboard.press('e');
  };
  await usePortal();
  await page.waitForFunction(destination => jugadores[network.id].x === destination.x
    && jugadores[network.id].y === destination.y, destination);
  expect(await page.evaluate(() => jugadores[network.id].portalHasta > Date.now())).toBe(true);
  await usePortal();
  expect(await page.evaluate(() => ({ x: jugadores[network.id].x, y: jugadores[network.id].y })))
    .toEqual({ x: destination.x, y: destination.y });
  await page.waitForFunction(() => jugadores[network.id].portalHasta <= Date.now());
  await usePortal();
  await page.waitForFunction(source => jugadores[network.id].x === source.x && jugadores[network.id].y === source.y, source);
  await page.evaluate(() => { network.send = window.originalSend; });
  await page.locator('#leave-match').click();
  await page.locator('#match-map').selectOption('outpost');
  await page.locator('#jugar-button').click();
  await page.waitForFunction(() => WorldArt.map === 'outpost' && portales.length === 0);
  await page.locator('#leave-match').click();
  expect(errors).toEqual([]);
});
