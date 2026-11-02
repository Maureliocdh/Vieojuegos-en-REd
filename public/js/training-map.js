(() => {
  const canvas = document.getElementById('training-map');
  const ctx = canvas.getContext('2d');
  const held = new Set();
  const portraits = new Map();
  let lastSend = 0;
  let previousRoom = null;
  let position = null;
  const controls = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
  for (const button of document.querySelectorAll('[data-direction]')) {
    const key = controls[button.dataset.direction];
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId); held.add(key);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => held.delete(key));
  }
  const stop = () => { held.clear(); if (window.tacticalState?.phase === 'puzzles') network.send('moverEntrenamiento', { x: 0, y: 0 }); };
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  function frame(now) {
    requestAnimationFrame(frame);
    const state = window.tacticalState;
    const room = state?.players?.[network.id]?.training;
    if (!room || !['instrucciones', 'puzzles'].includes(state.phase) || !gameStarted || resultsPinned || !networkReady) {
      previousRoom = null; position = null; held.clear(); return;
    }
    const pressed = key => !document.hidden && document.hasFocus() && (held.has(key) || keys.has(key));
    const input = { x: Number(pressed('KeyD')) - Number(pressed('KeyA')), y: Number(pressed('KeyS')) - Number(pressed('KeyW')) };
    if (state.phase === 'puzzles' && now - lastSend >= 50) { network.send('moverEntrenamiento', input); lastSend = now; }
    if (!position || previousRoom !== room.beacons[0]?.x) position = { ...room.player };
    previousRoom = room.beacons[0]?.x;
    position.x += (room.player.x - position.x) * 0.4;
    position.y += (room.player.y - position.y) * 0.4;
    ctx.fillStyle = '#182635'; ctx.fillRect(0, 0, 1000, 700);
    for (let x = 30; x < 970; x += 50) for (let y = 30; y < 670; y += 50) {
      ctx.fillStyle = ((x + y) / 50 | 0) % 2 ? '#1c2d3e' : '#203346';
      ctx.fillRect(x, y, 48, 48);
    }
    ctx.strokeStyle = '#536b82'; ctx.lineWidth = 22; ctx.strokeRect(15, 15, 970, 670);
    ctx.strokeStyle = '#56cbd4'; ctx.lineWidth = 3; ctx.strokeRect(30, 30, 940, 640);
    for (const x of [80, 920]) {
      ctx.fillStyle = '#30495e'; ctx.fillRect(x - 12, 260, 24, 180);
      ctx.fillStyle = '#6bc2d2'; ctx.fillRect(x - 4, 280, 8, 140);
    }
    ctx.save();
    ctx.strokeStyle = '#47647c'; ctx.lineWidth = 2; ctx.setLineDash([12, 12]);
    ctx.beginPath(); ctx.arc(500, 350, 70, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    for (const beacon of room.beacons) {
      const active = beacon.id === room.active;
      if (active) {
        const glow = ctx.createRadialGradient(beacon.x, beacon.y, 2, beacon.x, beacon.y, 72);
        glow.addColorStop(0, '#71fff599'); glow.addColorStop(1, '#71fff500');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(beacon.x, beacon.y, 72, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = active ? '#297f8b' : '#2b4052';
      ctx.strokeStyle = active ? '#a6fff1' : '#60788c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(beacon.x, beacon.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = active ? '#b5fff7' : '#516579';
      ctx.fillRect(beacon.x - 9, beacon.y - 18, 18, 36);
      ctx.fillRect(beacon.x - 18, beacon.y - 9, 36, 18);
      if (active) {
        ctx.strokeStyle = '#dfff78'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(beacon.x, beacon.y, 35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * room.activeSeconds / 6); ctx.stroke();
        ctx.fillStyle = '#e6ffff'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(room.activeSeconds)}s`, beacon.x, beacon.y - 49);
      }
    }
    const skinId = jugadores[network.id]?.skin || ArenaUI.skin;
    if (!portraits.has(skinId)) {
      const image = new Image();
      image.src = GameAssets.skinUrl(GameAssets.skins.find(s => s.id === skinId) || GameAssets.skins[0]);
      portraits.set(skinId, image);
    }
    ctx.fillStyle = '#030c1780'; ctx.beginPath(); ctx.ellipse(position.x, position.y + 16, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
    const portrait = portraits.get(skinId);
    if (portrait.complete && portrait.naturalWidth) ctx.drawImage(portrait, position.x - 28, position.y - 28, 56, 56);
    else { ctx.fillStyle = '#ffb26c'; ctx.beginPath(); ctx.arc(position.x, position.y, 20, 0, Math.PI * 2); ctx.fill(); }
  }
  requestAnimationFrame(frame);
})();
