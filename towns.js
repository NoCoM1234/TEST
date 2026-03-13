'use strict';
const fs   = require('fs');
const path = require('path');

const TOWNS_PATH    = process.env.TOWNS_FILE    || path.join(__dirname, 'A');
const ISLANDS_PATH  = process.env.ISLANDS_FILE  || path.join(__dirname, 'B');
const PLAYERS_PATH  = process.env.PLAYERS_FILE  || path.join(__dirname, 'C');
const ALLIANCES_PATH= process.env.ALLIANCES_FILE|| path.join(__dirname, 'D');
const OFFSETS_PATH  = process.env.OFFSETS_FILE  || path.join(__dirname, 'offsets.json');

let townsMap    = null;  // Map<townId,    {name, island_x, island_y, slot, player_id}>
let islandsMap  = null;  // Map<"x,y",     island_type>
let playersMap  = null;  // Map<playerId,  {name, alliance_id}>
let alliancesMap= null;  // Map<allianceId,{name}>
let offsetsMap  = null;  // { [island_type]: [[ox,oy], ...] }

// ── Loaders ───────────────────────────────────────────────────────────────────
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
            player_id:p[1].trim(),
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

function loadPlayers() {
    console.log('[Towns] Loading C (players) into memory...');
    playersMap = new Map();
    for (const line of fs.readFileSync(PLAYERS_PATH, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const p = line.split(',');
        // C: player_id, name, alliance_id, points, rank, town_count
        playersMap.set(p[0].trim(), {
            name:       decodeURIComponent(p[1]).replace(/\+/g, ' ').trim(),
            alliance_id:p[2].trim() || null,
        });
    }
    console.log(`[Towns] Loaded ${playersMap.size} players`);
}

function loadAlliances() {
    console.log('[Towns] Loading D (alliances) into memory...');
    alliancesMap = new Map();
    for (const line of fs.readFileSync(ALLIANCES_PATH, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const p = line.split(',');
        // D: alliance_id, name, points, town_count, member_count, rank
        alliancesMap.set(p[0].trim(), {
            name: decodeURIComponent(p[1]).replace(/\+/g, ' ').trim(),
        });
    }
    console.log(`[Towns] Loaded ${alliancesMap.size} alliances`);
}

// ── Queries ───────────────────────────────────────────────────────────────────
function getTownData(townId) {
    if (!townsMap)   loadData();
    if (!offsetsMap) loadOffsets();

    const town = townsMap.get(String(townId));
    if (!town) return null;

    const island_type  = islandsMap.get(`${town.island_x},${town.island_y}`) ?? null;
    const slotOffsets  = offsetsMap[String(island_type)]?.[town.slot] ?? null;

    return {
        ...town,
        island_type,
        offset_x: slotOffsets ? slotOffsets[0] : null,
        offset_y: slotOffsets ? slotOffsets[1] : null,
    };
}

// Given a home_town_id, returns attacker player name + alliance name
function getAttackerInfo(townId) {
    if (!townsMap)     loadData();
    if (!playersMap)   loadPlayers();
    if (!alliancesMap) loadAlliances();

    const town = townsMap.get(String(townId));
    if (!town) return null;

    const player   = playersMap.get(town.player_id);
    if (!player) return { town_name: town.name, player_name: null, alliance_name: null };

    const alliance = player.alliance_id ? alliancesMap.get(player.alliance_id) : null;

    return {
        town_name:    town.name,
        player_name:  player.name,
        alliance_name:alliance ? alliance.name : null,
        alliance_id:  player.alliance_id || null,
    };
}

// ── File watchers (daily GitHub Actions push) ─────────────────────────────────
fs.watch(TOWNS_PATH,     () => { console.log('[Towns] A updated'); townsMap     = null; });
fs.watch(ISLANDS_PATH,   () => { console.log('[Towns] B updated'); islandsMap   = null; });
fs.watch(PLAYERS_PATH,   () => { console.log('[Towns] C updated'); playersMap   = null; });
fs.watch(ALLIANCES_PATH, () => { console.log('[Towns] D updated'); alliancesMap = null; });
fs.watch(OFFSETS_PATH,   () => { console.log('[Towns] offsets updated'); offsetsMap = null; });


function getAllianceById(allianceId) {
    if (!alliancesMap) loadAlliances();
    const a = alliancesMap.get(String(allianceId));
    return a ? a.name : null;
}

module.exports = { getTownData, getAttackerInfo, getAllianceById, loadData, loadOffsets, loadPlayers, loadAlliances };
