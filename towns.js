'use strict';

const { MongoClient } = require('mongodb');
const path = require('path');
const zlib = require('zlib');

// world_data stores towns/islands gzip-compressed (towns_gz / islands_gz).
// This helper accepts both the compressed and the legacy raw format.
function unpackWorldField(row, name) {
    if (!row) return [];
    if (row[name + '_gz']) {
        const bin = row[name + '_gz'];
        const buf = Buffer.isBuffer(bin) ? bin : Buffer.from(bin.buffer);
        return JSON.parse(zlib.gunzipSync(buf).toString());
    }
    return row[name] || [];
}

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

    const rawTowns   = unpackWorldField(data, 'towns');
    const rawIslands = unpackWorldField(data, 'islands');

    // towns: [town_id, player_id, name, island_x, island_y, slot, points]
    for (const p of rawTowns) {
        townsMap.set(String(p[0]), {
            name:      p[2],
            player_id: String(p[1]),
            island_x:  parseInt(p[3], 10),
            island_y:  parseInt(p[4], 10),
            slot:      parseInt(p[5], 10),
            points:    p.length > 6 && p[6] != null ? parseInt(p[6], 10) : null,   // per-town points
        });
    }

    // islands: [island_id, x, y, island_type, ...]
    for (const p of rawIslands) {
        islandsMap.set(`${p[1]},${p[2]}`, parseInt(p[3], 10));
    }

   // players: [player_id, name, alliance_id, points, rank, town_count]
for (const p of (meta?.players || [])) {
    playersMap.set(String(p[0]), {
        name:        p[1],
        alliance_id: p[2] || null,
        points:      p[3] != null ? parseInt(p[3], 10) : null,   // ← new
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

    const player = cache.playersMap.get(town.player_id);
    if (!player) return { town_name: town.name, player_name: null, alliance_name: null, player_id: null, points: null };

    // alliancesMap is keyed with String(id), so coerce or the lookup silently misses
    const alliance = player.alliance_id ? cache.alliancesMap.get(String(player.alliance_id)) : null;
    return {
        town_name:     town.name,
        player_name:   player.name,
        alliance_name: alliance ? alliance.name : null,
        alliance_id:   player.alliance_id || null,
        player_id:     town.player_id,
        points:        player.points ?? null,   // ← new
    };
}

// Batch town lookup. Reads the in-memory world cache once and loops, so a
// request for hundreds of ids costs the same as one. Pass withOwner=true to
// also resolve player + alliance for each town.
async function getTownsBatch(world_id, ids, withOwner = false) {
    const offsets = require(path.join(__dirname, 'offsets.json'));
    const cache   = await getWorldCache(world_id);
    if (!cache) return null;

    const out = {};
    for (const rawId of ids) {
        const id   = String(rawId);
        const town = cache.townsMap.get(id);
        if (!town) continue;

        const island_type = cache.islandsMap.get(`${town.island_x},${town.island_y}`) ?? null;
        const slotOffsets = offsets[String(island_type)]?.[town.slot] ?? null;

        const entry = {
            island_x: town.island_x,
            island_y: town.island_y,
            offset_x: slotOffsets ? slotOffsets[0] : null,
            offset_y: slotOffsets ? slotOffsets[1] : null,
        };

        if (withOwner) {
            const player   = cache.playersMap.get(town.player_id);
            const alliance = player && player.alliance_id
                ? cache.alliancesMap.get(String(player.alliance_id)) : null;
            entry.town_name     = town.name;
            entry.player_id     = town.player_id;
            entry.player_name   = player ? player.name : null;
            entry.player_points = player ? (player.points ?? null) : null;
            entry.alliance_id   = player ? (player.alliance_id || null) : null;
            entry.alliance_name = alliance ? alliance.name : null;
        }

        out[id] = entry;
    }

    return out;
}

async function getAllianceById(world_id, allianceId) {
    const cache = await getWorldCache(world_id);
    if (!cache) return null;
    return cache.alliancesMap.get(String(allianceId))?.name || null;
}

async function getMapData(world_id) {
    const cache = await getWorldCache(world_id);
    if (!cache) return null;

    const offsets = require(path.join(__dirname, 'offsets.json'));
    const towns = [];
    for (const [id, t] of cache.townsMap) {
        const island_type = cache.islandsMap.get(`${t.island_x},${t.island_y}`) ?? null;
        const slotOffsets = island_type ? offsets[String(island_type)]?.[t.slot] : null;
        const offset_x = slotOffsets ? slotOffsets[0] : 0;
        const offset_y = slotOffsets ? slotOffsets[1] : 0;
     
towns.push([id, t.player_id, t.name, t.island_x, t.island_y, offset_x, offset_y, t.slot, t.points ?? null]);
    }

    const players = {};
    for (const [id, p] of cache.playersMap) {
        players[id] = [p.name, p.alliance_id || '0', p.points || 0];
    }

    const alliances = {};
    for (const [id, a] of cache.alliancesMap) {
        alliances[id] = a.name;
    }

    const islands = [];
    for (const [key, type] of cache.islandsMap) {
        const [x, y] = key.split(',').map(Number);
        islands.push([x, y, type]);
    }

    return { towns, players, alliances, islands };
}

module.exports = { getTownData, getTownsBatch, getAttackerInfo, getAllianceById, invalidateCache, getMapData };
