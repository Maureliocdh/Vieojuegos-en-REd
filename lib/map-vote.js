const Maps = require('../public/js/maps');

class MapVote {
  constructor(ids, currentMap, now) {
    this.electores = new Set(ids);
    this.votos = new Map();
    this.actual = currentMap;
    this.fin = now + 15000;
    this.ganador = null;
  }
  vote(id, map, now) {
    if (this.ganador || now >= this.fin) return 'La votación ya terminó.';
    if (!this.electores.has(id)) return 'Solo pueden votar quienes terminaron la ronda.';
    if (!Maps.valid(map)) return 'Selecciona un mapa válido.';
    this.votos.set(id, map);
    return null;
  }
  close(now) {
    if (this.ganador || now < this.fin) return false;
    const counts = this.counts();
    const maximum = Math.max(...Object.values(counts));
    const winners = Maps.catalog.filter(map => counts[map.id] === maximum);
    this.ganador = winners.length === 1 ? winners[0].id : this.actual;
    return true;
  }
  counts() {
    const counts = Object.fromEntries(Maps.catalog.map(map => [map.id, 0]));
    for (const map of this.votos.values()) counts[map] += 1;
    return counts;
  }
  snapshot(now) {
    return { activa: !this.ganador, segundos: Math.max(0, Math.ceil((this.fin - now) / 1000)),
      electores: [...this.electores], votos: Object.fromEntries(this.votos),
      recuento: this.counts(), ganador: this.ganador };
  }
}
module.exports = { MapVote };
