'use strict';

const { MongoClient } = require('mongodb');
const path = require('path');

let _db = null;

async function getDb() {
    if (_db) return _db;
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    _db = client.db('Master');
    return _db;
}

// ── In-memory cache per world — TTL 3 hours ───────────────────────────────────
const _cache = {};
const CACHE_TTL = 3 * 60 * 60 * 1000;

async function getWorldCache(world_id) {
    const now = Date.now();
    if (_cache[world_id] && now - _cache[world_id].ts < CACHE_TTL) {
        return _cache[world_id];
    }

    const db   = await getDb();
    const data = await db.collection('world_data').findOne({ world_id });
    const meta = await db.collection('world_meta').findOne({ world_id });

    if (!data) {
        console.warn(`[Towns] No world_data in DB for ${world_id}`);
        return null;
    }

    const townsMap     = new Map();
    const islandsMap   = new Map();
    const playersMap   = new Map();
    const alliancesMap = new Map();

    // towns: [town_id, player_id, name, island_x, island_y, slot, points]
    for (const p of (data.towns || [])) {
        townsMap.set(String(p[0]), {
            name:      p[2],
            player_id: String(p[1]),
            island_x:  parseInt(p[3], 10),
            island_y:  parseInt(p[4], 10),
            slot:      parseInt(p[5], 10),
        });
    }

    // islands: [island_id, x, y, island_type, ...]
    for (const p of (data.islands || [])) {
        islandsMap.set(`${p[1]},${p[2]}`, parseInt(p[3], 10));
    }

    // players: [player_id, name, alliance_id, points, rank, town_count]
    for (const p of (meta?.players || [])) {
        playersMap.set(String(p[0]), {
            name:        p[1],
            alliance_id: p[2] || null,
        });
    }

    // alliances: [alliance_id, name, ...]
    for (const p of (meta?.alliances || [])) {
        alliancesMap.set(String(p[0]), { name: p[1] });
    }

    _cache[world_id] = { ts: now, townsMap, islandsMap, playersMap, alliancesMap };
    console.log(`[Towns] Cache built for ${world_id} — ${townsMap.size} towns`);
    return _cache[world_id];
}

// ── Invalidate cache for a world (called after world data update) ─────────────
function invalidateCache(world_id) {
    delete _cache[world_id];
    console.log(`[Towns] Cache invalidated for ${world_id}`);
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function getTownData(world_id, townId) {
    const offsets = require(path.join(__dirname, 'offsets.json'));
    const cache   = await getWorldCache(world_id);
    if (!cache) return null;

    const town = cache.townsMap.get(String(townId));
    if (!town) return null;

    const island_type = cache.islandsMap.get(`${town.island_x},${town.island_y}`) ?? null;
    const slotOffsets = offsets[String(island_type)]?.[town.slot] ?? null;

    return {
        ...town,
        island_type,
        offset_x: slotOffsets ? slotOffsets[0] : null,
        offset_y: slotOffsets ? slotOffsets[1] : null,
    };
}

async function getAttackerInfo(world_id, townId) {
    const cache = await getWorldCache(world_id);
    if (!cache) return null;

    const town = cache.townsMap.get(String(townId));
    if (!town) return null;

    const player   = cache.playersMap.get(town.player_id);
    if (!player) return { town_name: town.name, player_name: null, alliance_name: null };

    const alliance = player.alliance_id ? cache.alliancesMap.get(player.alliance_id) : null;
    return {
        town_name:     town.name,
        player_name:   player.name,
        alliance_name: alliance ? alliance.name : null,
        alliance_id:   player.alliance_id || null,
        player_id:     town.player_id,
    };
}

async function getAllianceById(world_id, allianceId) {
    const cache = await getWorldCache(world_id);
    if (!cache) return null;
    return cache.alliancesMap.get(String(allianceId))?.name || null;
}

module.exports = { getTownData, getAttackerInfo, getAllianceById, invalidateCache };
