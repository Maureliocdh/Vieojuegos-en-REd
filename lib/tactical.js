const SHOP = [
  { id: 'escopeta', nombre: 'Escopeta', precio: 80, descripcion: '6 balas + 12 de reserva' },
  { id: 'rifle', nombre: 'Rifle', precio: 100, descripcion: '30 balas + 30 de reserva' },
  { id: 'sniper', nombre: 'Sniper', precio: 140, descripcion: '5 balas + 10 de reserva' },
  { id: 'escudo', nombre: 'Escudo inicial', precio: 40, descripcion: '+50 de escudo' },
  { id: 'botiquin', nombre: 'Botiquín', precio: 30, descripcion: 'Recupera hasta 50 de vida al usarlo' },
  { id: 'municion', nombre: 'Munición de pistola', precio: 20, descripcion: '+24 balas de reserva' },
];

class Tactical {
  constructor(ids, start, random = Math.random) {
    this.start = start;
    this.random = random;
    this.accounts = new Map(ids.map(id => [id, { credits: 80, solved: 0, purchases: {}, message: '', training: this.room(start) }]));
  }
  room(now) {
    return { width: 1000, height: 700, player: { x: 500, y: 350 },
      beacons: Array.from({ length: 9 }, (_, i) => ({ id: i, x: 120 + i % 3 * 330 + this.random() * 100,
        y: 100 + Math.floor(i / 3) * 210 + this.random() * 80 })),
      active: null, previous: -1, expires: 0, next: now + 6000, lastTick: now + 5000, inputAt: -Infinity, input: { x: 0, y: 0 } };
  }
  phase(now) {
    const elapsed = now - this.start;
    const phase = elapsed < 5000 ? 'instrucciones' : elapsed < 65000 ? 'puzzles' : elapsed < 85000 ? 'tienda' : elapsed < 89000 ? 'cuenta' : 'combate';
    const end = this.start + ({ instrucciones: 5000, puzzles: 65000, tienda: 85000, cuenta: 89000, combate: 89000 })[phase];
    return { phase, seconds: Math.max(0, Math.ceil((end - now) / 1000)) };
  }
  move(id, data, now) {
    const room = this.accounts.get(id)?.training;
    if (!room || this.phase(now).phase !== 'puzzles' || ![data?.x, data?.y].every(Number.isFinite)) return false;
    const length = Math.max(1, Math.hypot(data.x, data.y));
    room.input = { x: data.x / length, y: data.y / length };
    room.inputAt = now;
    return true;
  }
  tick(now) {
    if (this.phase(now).phase !== 'puzzles') return;
    for (const account of this.accounts.values()) {
      const room = account.training;
      const dt = Math.max(0, Math.min(0.1, (now - room.lastTick) / 1000));
      room.lastTick = now;
      if (now - room.inputAt < 250) {
        room.player.x = Math.max(35, Math.min(965, room.player.x + room.input.x * 240 * dt));
        room.player.y = Math.max(35, Math.min(665, room.player.y + room.input.y * 240 * dt));
      }
      if (room.active !== null && now >= room.expires) {
        room.active = null; room.next = now + 400;
        account.message = 'La energía se disipó. ¡Busca la siguiente baliza!';
      }
      if (room.active === null && now >= room.next) {
        const candidates = room.beacons.filter(b => b.id !== room.previous);
        room.active = candidates[Math.floor(this.random() * candidates.length)].id;
        room.previous = room.active;
        room.expires = now + 6000;
      }
      const beacon = room.beacons.find(b => b.id === room.active);
      if (beacon && Math.hypot(room.player.x - beacon.x, room.player.y - beacon.y) <= 40) {
        room.active = null; room.next = now + 400;
        account.solved++;
        const reward = account.credits < 180 ? 5 : 0;
        account.credits += reward;
        account.message = reward ? '¡Energía recogida! +5 créditos' : '¡Límite de bonificación alcanzado!';
      }
    }
  }
  buy(id, itemId, now, grant) {
    const account = this.accounts.get(id);
    const item = SHOP.find(item => item.id === itemId);
    if (!account || !item || this.phase(now).phase !== 'tienda') return false;
    if (account.credits < item.precio) { account.message = 'Créditos insuficientes.'; return false; }
    if ((account.purchases[item.id] || 0) >= (item.id === 'municion' ? 2 : 1)) { account.message = 'Ya compraste este suministro.'; return false; }
    if (!grant(item.id)) { account.message = 'No hay espacio o ya tienes el máximo.'; return false; }
    account.credits -= item.precio;
    account.purchases[item.id] = (account.purchases[item.id] || 0) + 1;
    account.message = `${item.nombre} comprado`;
    return true;
  }
  snapshot(now, playerId) {
    const entries = this.accounts.has(playerId) ? [[playerId, this.accounts.get(playerId)]] : [];
    return { ...this.phase(now), shop: SHOP, players: Object.fromEntries(entries.map(([id, a]) => [id, {
      credits: a.credits, solved: a.solved, purchases: { ...a.purchases }, message: a.message,
      training: ['instrucciones', 'puzzles'].includes(this.phase(now).phase) ? { width: a.training.width, height: a.training.height,
        player: { ...a.training.player }, beacons: a.training.beacons.map(b => ({ ...b })),
        active: a.training.active, activeSeconds: Math.max(0, (a.training.expires - now) / 1000) } : null,
    }])) };
  }
}
module.exports = { Tactical, SHOP };
