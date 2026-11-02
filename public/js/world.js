(() => {
  const images = {};
  const makeImage = (source) => { const image = new Image(); image.src = source; return image; };
  for (const skin of GameAssets.skins) images[skin.id] = makeImage(GameAssets.skinUrl(skin));
  const tree = makeImage(GameAssets.svgUrl('<ellipse cx="49" cy="56" rx="42" ry="37" fill="#1f462d" opacity=".3"/><path d="M44 57h12v31H44z" fill="#665c42"/><path d="M12 42L23 18 47 6 75 17 87 43 74 72 47 80 20 65Z" fill="#306343" stroke="#234a35" stroke-width="3"/><path d="M21 36L38 15 63 17 77 36 67 58 39 64 20 52Z" fill="#498450"/><path d="M31 32L45 19 64 26 68 39 47 46 29 42Z" fill="#639c5b"/>'));
  const rock = makeImage(GameAssets.svgUrl('<path d="M9 63L18 30 44 14 72 23 89 54 78 80 35 87Z" fill="#546a67" stroke="#384e4b" stroke-width="3"/><path d="M18 30L44 14 72 23 64 53 36 65 9 63Z" fill="#a2b3a3"/><path d="M18 30L42 25 55 40 36 65Z" fill="#bec8b4"/>'));
  let floorPattern = null;
  const orbitalFloor = makeImage('/assets/tiles/orbital.svg');
  let orbitalPattern = null;
  let currentMap = 'outpost';
  const bushImage = makeImage(GameAssets.svgUrl('<g stroke="#24482b" stroke-width="3"><ellipse cx="48" cy="49" rx="46" ry="44" fill="#315d35"/><ellipse cx="28" cy="43" rx="23" ry="27" fill="#54883f"/><ellipse cx="62" cy="34" rx="28" ry="25" fill="#66964a"/><ellipse cx="62" cy="66" rx="28" ry="23" fill="#497d3b"/><path d="M18 37l12-7m14-9l10 8m13 18l12-4M27 61l10 8m12-14l8 6" stroke="#9fbf63" stroke-width="5" stroke-linecap="round"/></g>'));
  const roofOpacity = new Map();
  const hatchProgress = new Map();
  const station = ArenaMaps.stationLayout();
  window.WorldArt = {
    images,
    setMap(id) {
      if (currentMap !== id) { roofOpacity.clear(); hatchProgress.clear(); }
      currentMap = id;
    },
    get map() { return currentMap; },
    specialZones(context, inView) {
      for (const zone of SpecialZones.zones) {
        if (inView && !inView(zone.x, zone.y, zone.radio)) continue;
        const ice = zone.tipo === 'hielo';
        if (zone.tipo === 'agujeroNegro') {
          context.save();
          context.translate(zone.x, zone.y);
          const halo = context.createRadialGradient(0, 0, zone.radio * 0.3, 0, 0, zone.radio);
          halo.addColorStop(0, '#05030b');
          halo.addColorStop(0.55, '#281340ee');
          halo.addColorStop(0.75, '#b46bdf88');
          halo.addColorStop(1, '#7939b900');
          context.fillStyle = halo;
          context.beginPath(); context.arc(0, 0, zone.radio, 0, Math.PI * 2); context.fill();
          context.rotate(performance.now() / 1700);
          for (let i = 0; i < 5; i += 1) {
            context.strokeStyle = i % 2 ? '#f5beff' : '#9d78ef';
            context.lineWidth = 2 + i;
            context.beginPath();
            context.ellipse(0, 0, zone.radio * (0.48 + i * 0.08), zone.radio * (0.18 + i * 0.04),
              i * 0.18, 0.3 + i, 2.5 + i);
            context.stroke();
          }
          context.fillStyle = '#020107';
          context.beginPath(); context.arc(0, 0, zone.radio * 0.36, 0, Math.PI * 2); context.fill();
          context.strokeStyle = '#d9b8ff'; context.lineWidth = 3; context.stroke();
          context.restore();
          continue;
        }
        context.save();
        context.beginPath();
        if (zone.points) {
          zone.points.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
          context.closePath();
        } else context.arc(zone.x, zone.y, zone.radio, 0, Math.PI * 2);
        const fill = context.createRadialGradient(zone.x, zone.y, 0, zone.x, zone.y, zone.radio);
        fill.addColorStop(0, ice ? '#d5f8ffff' : '#759b16ee');
        fill.addColorStop(1, ice ? '#77b9d9cc' : '#344d16dd');
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = ice ? '#e4ffff' : '#d6ed59';
        context.lineWidth = 4;
        context.lineJoin = "round";
        context.stroke();
        context.clip();
        context.setLineDash([]);
        for (let i = 0; i < 24; i++) {
          const x = zone.x - zone.radio + (i * 113 % (zone.radio * 2));
          const y = zone.y - zone.radio + (i * 173 % (zone.radio * 2));
          context.beginPath();
          if (ice) {
            context.moveTo(x - 18, y - 12); context.lineTo(x, y); context.lineTo(x - 8, y + 20);
            context.moveTo(x, y); context.lineTo(x + 22, y - 6);
          } else {
            const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 450 + i);
            context.fillStyle = 'rgba(192,232,65,0.25)';
            context.arc(x, y, (8 + i % 10) * pulse, 0, Math.PI * 2);
            context.fill();
          }
          context.stroke();
        }
        context.restore();
      }
    },
    bush(context, object, observer) {
      if (!bushImage.complete || !bushImage.naturalWidth) return;
      context.save();
      context.globalAlpha = Buildings.inBush(object, observer) ? 0.25 : 1;
      context.drawImage(bushImage, object.x, object.y, object.width, object.height);
      context.restore();
    },
    terrain(context, image, width, height, inView) {
      if (currentMap === 'orbital') {
        if (!orbitalPattern && orbitalFloor.complete && orbitalFloor.naturalWidth) orbitalPattern = context.createPattern(orbitalFloor, 'repeat');
        context.fillStyle = '#040813';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#a1bdde';
        for (let i = 0; i < 450; i += 1) {
          const x = 20 + i * 877 % (width - 40), y = 20 + i * 1301 % (height - 40);
          if (!inView || inView(x, y, 4)) context.fillRect(x, y, i % 5 ? 2 : 3, 2);
        }
        for (const floor of [...station.corridors, ...station.exterior, ...station.rooms]) {
          const { x, y, width: w, height: h } = floor;
          if (inView && !inView(x + w / 2, y + h / 2, Math.hypot(w, h) / 2)) continue;
          context.strokeStyle = '#4d697f'; context.lineWidth = 16;
          context.strokeRect(x, y, w, h);
          context.fillStyle = orbitalPattern || '#29384a';
          context.fillRect(x, y, w, h);
        }
        for (const corridor of station.corridors) {
          const { x, y, width: w, height: h } = corridor;
          context.fillStyle = '#71e8ef';
          if (w > h) {
            context.fillRect(x, y + 12, w, 4); context.fillRect(x, y + h - 16, w, 4);
          } else {
            context.fillRect(x + 12, y, 4, h); context.fillRect(x + w - 16, y, 4, h);
          }
        }
        for (const deck of station.exterior) {
          context.strokeStyle = '#edbb64'; context.lineWidth = 5;
          context.strokeRect(deck.x + 20, deck.y + 20, deck.width - 40, deck.height - 40);
          context.fillStyle = '#112036aa'; context.fillRect(deck.x + 40, deck.y + 40, deck.width - 80, 65);
          context.fillStyle = '#9bcee5';
          for (let i = 0; i < 8; i += 1) {
            context.fillRect(deck.x + 50 + i * 95, deck.y + 45, 3, 50);
          }
        }
        return;
      }
      if (!floorPattern && image.complete && image.naturalWidth) floorPattern = context.createPattern(image, 'repeat');
      context.fillStyle = floorPattern || '#75a75a';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#a5b27d';
      for (const coordinate of [1200, 3000, 4800]) {
        context.fillRect(coordinate - 65, 0, 130, height);
        context.fillRect(0, coordinate - 65, width, 130);
      }
      context.fillStyle = '#718581';
      context.fillRect(2936, 0, 128, height);
      context.fillRect(0, 2936, width, 128);
      context.save();
      context.strokeStyle = '#d3d6b8';
      context.setLineDash([28, 32]);
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(3000, 0); context.lineTo(3000, height);
      context.moveTo(0, 3000); context.lineTo(width, 3000);
      context.stroke();
      context.restore();
    },
    obstacle(context, obstacle) {
      if (obstacle.tipo === 'arbusto') return;
      const { x, y, width, height, tipo } = obstacle;
      const metal = currentMap === 'orbital';
      if (tipo === 'casco') return;
      if (tipo === 'contenedor') {
        context.fillStyle = '#0d1724'; context.fillRect(x + 5, y + 7, width, height);
        context.fillStyle = '#51687b'; context.fillRect(x, y, width, height);
        context.strokeStyle = '#9bafbb'; context.lineWidth = 3; context.strokeRect(x + 4, y + 4, width - 8, height - 8);
        context.fillStyle = '#273b51';
        for (let offset = 14; offset < width - 8; offset += 18) context.fillRect(x + offset, y + 10, 7, height - 20);
        context.fillStyle = '#f5bb64'; context.fillRect(x + 8, y + height - 12, 24, 5);
        return;
      }
      if (tipo === 'arbol' || tipo === 'roca') {
        const image = tipo === 'arbol' ? tree : rock;
        if (image.complete && image.naturalWidth) context.drawImage(image, x, y, width, height);
        return;
      }
      context.fillStyle = metal ? orbitalPattern || '#354b61' : tipo === 'almacen' ? '#afb7af' : '#dbcbae';
      context.fillRect(x, y, width, height);
      context.strokeStyle = '#887d6744'; context.lineWidth = 1;
      for (let offset = 18; offset < height; offset += 30) {
        context.beginPath(); context.moveTo(x, y + offset); context.lineTo(x + width, y + offset); context.stroke();
      }
      context.fillStyle = metal ? '#56d2eb' : '#638f85'; context.fillRect(x + 35, y + 35, 100, 48);
      context.fillStyle = '#25474e'; context.fillRect(x + 40, y + 40, 90, 9);
      context.fillStyle = metal ? '#9aabba' : '#a58052'; context.fillRect(x + width - 85, y + 36, 46, 46);
      context.strokeStyle = '#664c33'; context.strokeRect(x + width - 80, y + 41, 36, 36);
      context.fillStyle = '#e5e8d8'; context.fillRect(x + width - 100, y + height - 100, 55, 45);
      context.fillStyle = '#82a59a'; context.fillRect(x + width - 95, y + height - 95, 45, 10);
      context.fillStyle = metal ? '#92afc3' : '#dbe0d4';
      for (const wall of Buildings.walls(obstacle)) context.fillRect(wall.x, wall.y, wall.width, wall.height);
    },
    roof(context, obstacle, observer) {
      if (!Buildings.isBuilding(obstacle)) return;
      const { x, y, width, height, tipo } = obstacle;
      const metal = currentMap === 'orbital';
      if (metal) {
        context.fillStyle = '#8296aa';
        for (const wall of Buildings.walls({ ...obstacle, puertas: obstacle.puertas.map(door => ({ ...door, abierta: true })) })) {
          context.fillRect(wall.x, wall.y, wall.width, wall.height);
        }
        for (const door of Buildings.doors(obstacle)) {
          const key = `${obstacle.id}-${door.index}`;
          const target = door.abierta ? 1 : 0;
          const now = performance.now();
          const previous = hatchProgress.get(key) ?? { value: target, time: now };
          const progress = previous.value + Math.sign(target - previous.value) * Math.min(Math.abs(target - previous.value), (now - previous.time) / 220);
          hatchProgress.set(key, { value: progress, time: now });
          context.fillStyle = '#0b1524';
          context.fillRect(door.x - 6, door.y - 12, door.width + 12, door.height + 24);
          context.save();
          context.beginPath(); context.rect(door.x, door.y, door.width, door.height); context.clip();
          context.fillStyle = '#8fa4b8';
          const half = door.height / 2;
          context.fillRect(door.x, door.y - progress * half, door.width, half - 2);
          context.fillRect(door.x, door.y + half + progress * half + 2, door.width, half - 2);
          context.fillStyle = '#e5c071';
          context.fillRect(door.x + 5, door.y + half - progress * half - 10, 8, 8);
          context.fillRect(door.x + 5, door.y + half + progress * half + 2, 8, 8);
          context.restore();
          context.fillStyle = door.abierta ? '#79f2d2' : '#edbb64';
          context.fillRect(door.x - 5, door.y - 12, door.width + 10, 5);
          context.fillRect(door.x - 5, door.y + door.height + 7, door.width + 10, 5);
        }
        return;
      }
      const target = Buildings.inside(obstacle, observer) ? 0.03 : 1;
      const previous = roofOpacity.get(obstacle.id) ?? target;
      const opacity = previous + (target - previous) * 0.18;
      roofOpacity.set(obstacle.id, opacity);
      context.save(); context.globalAlpha = opacity;
      context.fillStyle = '#23433055'; context.fillRect(x + 10, y + 12, width, height);
      context.fillStyle = metal ? '#79c2d6' : '#d4d7c1'; context.fillRect(x - 6, y - 6, width + 12, height + 12);
      context.fillStyle = metal ? '#34485f' : tipo === 'almacen' ? '#617f87' : '#c57666'; context.fillRect(x, y, width, height);
      context.save();
      context.beginPath(); context.rect(x, y, width, height); context.clip();
      context.strokeStyle = '#22373444'; context.lineWidth = 2;
      for (let offset = 16; offset < height; offset += 22) {
        context.beginPath(); context.moveTo(x, y + offset); context.lineTo(x + width, y + offset); context.stroke();
      }
      context.fillStyle = '#ffffff18'; context.fillRect(x, y, width / 2, height);
      context.fillStyle = '#394f54'; context.fillRect(x + width / 2 - 5, y, 10, height);
      context.fillStyle = '#dbe6df'; context.fillRect(x + 30, y + 30, 52, 44);
      context.fillStyle = '#45656f'; context.fillRect(x + 36, y + 36, 40, 32);
      context.restore();
      context.restore();
      const door = Buildings.door(obstacle);
      context.fillStyle = metal ? (obstacle.puertaAbierta ? '#80edee' : '#dbad63') : obstacle.puertaAbierta ? '#d4be86' : '#345451';
      if (obstacle.puertaAbierta) context.fillRect(door.x, door.y - 75, 12, 85);
      else context.fillRect(door.x, door.y, door.width, door.height);
      context.fillStyle = '#f2d66c'; context.fillRect(door.x + (obstacle.puertaAbierta ? 3 : 75), door.y + 5, 6, 6);
    },
  };
})();
