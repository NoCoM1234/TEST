'use strict';
const express = require('express');
const cors    = require('cors');
const db      = require('./database');
const { getTownData, getAttackerInfo, getAllianceById, loadData, loadOffsets, loadPlayers, loadAlliances } = require('./towns');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

function bad(res, msg, status = 400) {
    return res.status(status).json({ ok: false, error: msg });
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'Grepolis Master API', version: '2.3.0' });
});

// ── POST /players/push ────────────────────────────────────────────────────────
app.post('/players/push', async (req, res) => {
    const b = req.body;
    const required = ['id', 'world', 'name', 'troops'];
    for (const f of required) {
        if (!b[f] && b[f] !== 0) return bad(res, `Missing field: ${f}`);
    }
    let townsData = b.towns_data || '[]';
    if (Array.isArray(townsData)) townsData = JSON.stringify(townsData);
    await db.upsertPlayer({
        id:            String(b.id),
        world:         String(b.world),
        name:          b.name,
        alliance:      b.alliance        || '',
        cultural_level:b.cultural_level  || 0,
        town_count:    b.town_count      || 0,
        current_cp:    b.current_cp      || 0,
        next_level_cp: b.next_level_cp   || 0,
        troops:        typeof b.troops === 'string' ? b.troops : JSON.stringify(b.troops),
        towns_data:    townsData,
        status:        parseInt(b.status) || 3,
    });
    return res.json({ ok: true });
});

// ── GET /players/:world ───────────────────────────────────────────────────────
app.get('/players/:world', async (req, res) => {
    const rows = await db.getPlayersByWorld(req.params.world);
    const now  = Math.floor(Date.now() / 1000);
    const players = rows.map(({ towns_data, ...rest }) => {
        // If status hasn't been updated in 3 minutes → offline
        if (now - (rest.status_at || 0) > 90) rest.status = 3;
        delete rest.status_at;
        return rest;
    });
    return res.json({ ok: true, players });
});

// ── GET /players/:world/:playerId/towns ───────────────────────────────────────
app.get('/players/:world/:playerId/towns', async (req, res) => {
    const { world, playerId } = req.params;
    const towns = await db.getPlayerTowns(world, playerId);
    if (towns === null) return res.status(404).json({ ok: false, error: 'Player not found' });
    return res.json({ ok: true, towns });
});

// ── GET /towns/:townId1/:townId2 ──────────────────────────────────────────────
// Returns raw data for two towns so distance can be calculated client-side.
app.get('/towns/:townId1/:townId2', (req, res) => {
    const { townId1, townId2 } = req.params;
    const t1 = getTownData(townId1);
    const t2 = getTownData(townId2);
    if (!t1) return bad(res, `Town ${townId1} not found`, 404);
    if (!t2) return bad(res, `Town ${townId2} not found`, 404);
    return res.json({ ok: true, town1: { id: townId1, ...t1 }, town2: { id: townId2, ...t2 } });
});

// ── POST /towns/batch ─────────────────────────────────────────────────────────
// Accepts { ids: [townId, ...] }, returns coords for all found towns.
// Used by userscript to pre-fetch all player town coords in one request.
// Response: { ok, towns: { townId: { island_x, island_y, offset_x, offset_y } } }
app.post('/towns/batch', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0)
        return bad(res, 'Body must have ids array');
    if (ids.length > 500)
        return bad(res, 'Max 500 ids per request');
    const result = {};
    for (const id of ids) {
        const t = getTownData(String(id));
        if (!t) continue;
        result[String(id)] = {
            island_x: t.island_x,
            island_y: t.island_y,
            offset_x: t.offset_x,
            offset_y: t.offset_y,
        };
    }
    return res.json({ ok: true, towns: result });
});

// ── GET /attacker/:townId ─────────────────────────────────────────────────────
// Given a home_town_id, returns the attacker's player name + alliance.
// Used by the AttackNotification userscript to replace the in-game API call.
// Response: { ok, town_name, player_name, alliance_name, alliance_id }
app.get('/attacker/:townId', (req, res) => {
    const info = getAttackerInfo(req.params.townId);
    if (!info) return bad(res, `Town ${req.params.townId} not found`, 404);
    return res.json({ ok: true, ...info });
});


// ── GET /cs-speeds ────────────────────────────────────────────────────────────
// Returns the pre-generated table of all possible CS ship speeds.
// Userscript caches this in localStorage and only requests it once.
const CS_SPEEDS_PATH = require('path').join(__dirname, 'cs_speeds.json');
let   csSpeedsCache  = null;
app.get('/cs-speeds', (_req, res) => {
    if (!csSpeedsCache) {
        try { csSpeedsCache = require('fs').readFileSync(CS_SPEEDS_PATH, 'utf8'); }
        catch { return bad(res, 'cs_speeds.json not found', 500); }
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(csSpeedsCache);
});
// ── GET /conflicting-speeds ───────────────────────────────────────────────────
// Returns per-unit speed tables that overlap with CS speed range.
// Used by userscript to flag ambiguous CS detections as 'possible CS'.
const CONFLICTING_SPEEDS_PATH = require('path').join(__dirname, 'conflicting_speeds.json');
let   conflictingSpeedsCache  = null;
app.get('/conflicting-speeds', (_req, res) => {
    if (!conflictingSpeedsCache) {
        try { conflictingSpeedsCache = require('fs').readFileSync(CONFLICTING_SPEEDS_PATH, 'utf8'); }
        catch { return bad(res, 'conflicting_speeds.json not found', 500); }
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(conflictingSpeedsCache);
});
// Clean expired requests every 10 minutes
setInterval(() => db.deleteExpiredRequests(), 10 * 60 * 1000);

// POST /requests/push
app.post('/requests/push', async (req, res) => {
    const b = req.body;
    const required = ['world', 'player_id', 'player_name', 'town_id', 'town_name', 'expires_at'];
    for (const f of required) if (!b[f]) return bad(res, `Missing field: ${f}`);
    if (!b.wood && !b.stone && !b.iron) return bad(res, 'At least one resource must be > 0');
    const result = await db.pushRequest({
        world:         String(b.world),
        player_id:     String(b.player_id),
        player_name:   b.player_name,
        alliance_name: b.alliance_name || '',
        town_id:       String(b.town_id),
        town_name:     b.town_name,
        wood:          parseInt(b.wood)  || 0,
        stone:         parseInt(b.stone) || 0,
        iron:          parseInt(b.iron)  || 0,
        expires_at:    parseInt(b.expires_at),
    });
    return res.json({ ok: true, id: result.lastInsertId });
});

// GET /requests/:world
app.get('/requests/:world', async (req, res) => {
    const rows = await db.getRequests(req.params.world);
    return res.json({ ok: true, requests: rows });
});

// PATCH /requests/:id/fulfill
app.patch('/requests/:id/fulfill', async (req, res) => {
    await db.fulfillRequest(req.params.id);
    return res.json({ ok: true });
});

// DELETE /requests/:id
app.delete('/requests/:id', async (req, res) => {
    const player_id = req.body?.player_id;
    if (!player_id) return bad(res, 'Missing player_id');
    await db.deleteRequest(req.params.id, String(player_id));
    return res.json({ ok: true });
});

// GET /alliance/:allianceId
app.get('/alliance/:allianceId', (req, res) => {
    const name = getAllianceById(req.params.allianceId);
    return res.json({ ok: true, name: name || '' });
});

// POST /players/status
app.post('/players/status', async (req, res) => {
    const { id, world, status } = req.body;
    if (!id || !world || status == null) return bad(res, 'Missing fields');
    await db.updatePlayerStatus(String(id), String(world), parseInt(status));
    return res.json({ ok: true });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.listen(PORT, () => {
    console.log(`[Server] Grepolis Master API v2.3.0 running on port ${PORT}`);
    loadData();
    loadOffsets();
    loadPlayers();
    loadAlliances();
});
