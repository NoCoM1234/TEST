'use strict';
const fs   = require('fs');
const path = require('path');

const TOWNS_PATH   = process.env.TOWNS_FILE    || path.join(__dirname, 'A');
const ISLANDS_PATH = process.env.ISLANDS_FILE  || path.join(__dirname, 'B');
const OFFSETS_PATH = process.env.OFFSETS_FILE  || path.join(__dirname, 'offsets.json');

let townsMap   = null;  // Map<townId, {name, island_x, island_y, slot}>
let islandsMap = null;  // Map<"x,y", island_type>
let offsetsMap = null;  // { [island_type]: [[ox,oy], ...] }

function loadOffsets() {
    offsetsMap = JSON.parse(fs.readFileSync(OFFSETS_PATH, 'utf8'));
    console.log(`[Towns] Loaded offsets for ${Object.keys(offsetsMap).length} island types`);
}

function loadData() {
    console.log('[Towns] Loading A and B into memory...');

    townsMap = new Map();
    for (const line of fs.readFileSync(TOWNS_PATH, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const p = line.split(',');
        // A: town_id, player_id, name, island_x, island_y, slot, points
        townsMap.set(p[0].trim(), {
            name:     decodeURIComponent(p[2]).trim(),
            island_x: parseInt(p[3], 10),
            island_y: parseInt(p[4], 10),
            slot:     parseInt(p[5], 10),
        });
    }

    islandsMap = new Map();
    for (const line of fs.readFileSync(ISLANDS_PATH, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const p = line.split(',');
        // B: island_id, x, y, island_type, ...
        islandsMap.set(`${p[1].trim()},${p[2].trim()}`, parseInt(p[3], 10));
    }

    console.log(`[Towns] Loaded ${townsMap.size} towns, ${islandsMap.size} islands`);
}

function getTownData(townId) {
    if (!townsMap)   loadData();
    if (!offsetsMap) loadOffsets();

    const town = townsMap.get(String(townId));
    if (!town) return null;

    const island_type = islandsMap.get(`${town.island_x},${town.island_y}`) ?? null;

    // Only send the two offset values the client needs for this specific slot
    const slotOffsets = offsetsMap[String(island_type)]?.[town.slot] ?? null;

    return {
        ...town,
        island_type,
        offset_x: slotOffsets ? slotOffsets[0] : null,
        offset_y: slotOffsets ? slotOffsets[1] : null,
    };
}

// Reload when GitHub Actions pushes fresh data daily
fs.watch(TOWNS_PATH,   () => { console.log('[Towns] A updated, reloading...'); townsMap   = null; });
fs.watch(ISLANDS_PATH, () => { console.log('[Towns] B updated, reloading...'); islandsMap = null; });
fs.watch(OFFSETS_PATH, () => { console.log('[Towns] offsets.json updated, reloading...'); offsetsMap = null; });

module.exports = { getTownData, loadData, loadOffsets };
