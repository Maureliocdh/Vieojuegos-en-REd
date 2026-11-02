(function (root) {
  const zones = [];
  function outline(zone, random) {
    const count = 10 + Math.floor(random() * 5);
    return Array.from({ length: count }, (_, n) => {
      const angle = n / count * Math.PI * 2;
      const radius = zone.radio * (0.65 + random() * 0.35);
      return { x: zone.x + Math.cos(angle) * radius, y: zone.y + Math.sin(angle) * radius };
    });
  }
  function contains(zone, entity) {
    if (!zone.points) return Math.hypot(entity.x - zone.x, entity.y - zone.y) <= zone.radio;
    let inside = false;
    for (let i = 0, j = zone.points.length - 1; i < zone.points.length; j = i++) {
      const a = zone.points[i], b = zone.points[j];
      if ((a.y > entity.y) !== (b.y > entity.y)
        && entity.x < (b.x - a.x) * (entity.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function generate(width, height, blocked = [], random = Math.random) {
    const result = [];
    // Una zona por sector mantiene los peligros repartidos por el mapa.
    for (let i = 0; i < 6; i++) {
      const radio = 210 + random() * 70;
      let zone;
      for (let attempt = 0; attempt < 500; attempt++) {
        const x = (i % 3) * width / 3 + radio + 60 + random() * (width / 3 - 2 * (radio + 60));
        const y = Math.floor(i / 3) * height / 2 + radio + 60 + random() * (height / 2 - 2 * (radio + 60));
        if (blocked.some((o) => Math.hypot(x - Math.max(o.x, Math.min(x, o.x + o.width)),
          y - Math.max(o.y, Math.min(y, o.y + o.height))) < radio + 60)) continue;
        if (result.some((o) => Math.hypot(x - o.x, y - o.y) < radio + o.radio + 100)) continue;
        zone = { id: `zona-${i}`, tipo: i % 2 ? 'hielo' : 'contaminacion', x, y, radio };
        break;
      }
      if (!zone) throw new Error('No se encontró espacio para una zona especial');
      zone.points = outline(zone, random);
      result.push(zone);
    }
    zones.splice(0, zones.length, ...result);
    return zones;
  }
  function generateStation(rooms, random = Math.random) {
    const result = [0, 2, 4, 7, 9, 11].map((index, i) => {
      const room = rooms[index];
      const zone = { id: `zona-${i}`, tipo: i % 2 ? 'hielo' : 'agujeroNegro',
        x: room.x + 500 + (random() - 0.5) * 80,
        y: room.y + 300 + (random() - 0.5) * 40, radio: 160 };
      if (zone.tipo === 'hielo') zone.points = outline(zone, random);
      return zone;
    });
    zones.splice(0, zones.length, ...result);
    return zones;
  }
  const effects = (entity, areas = zones) => {
    let contaminated = false;
    let speedMultiplier = 1;
    for (const zone of areas) {
      if (!contains(zone, entity)) continue;
      if (zone.tipo === 'contaminacion' || zone.tipo === 'agujeroNegro') contaminated = true;
      if (zone.tipo === 'hielo') speedMultiplier = 0.6;
    }
    return { damagePerSecond: contaminated ? 5 : 0, speedMultiplier };
  };
  const api = { zones, contains, effects, generate, generateStation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpecialZones = api;
})(typeof window !== 'undefined' ? window : globalThis);
