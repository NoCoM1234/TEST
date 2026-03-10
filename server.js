'use strict';
const express = require('express');
const cors    = require('cors');
const db      = require('./database');
const { getTownData, getAttackerInfo, loadData, loadOffsets, loadPlayers, loadAlliances } = require('./towns');

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
app.post('/players/push', (req, res) => {
    const b = req.body;
    const required = ['id', 'world', 'name', 'troops'];
    for (const f of required) {
        if (!b[f] && b[f] !== 0) return bad(res, `Missing field: ${f}`);
    }
    let townsData = b.towns_data || '[]';
    if (Array.isArray(townsData)) townsData = JSON.stringify(townsData);
    db.upsertPlayer({
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
    });
    return res.json({ ok: true });
});

// ── GET /players/:world ───────────────────────────────────────────────────────
app.get('/players/:world', (req, res) => {
    const rows = db.getPlayersByWorld(req.params.world);
    const players = rows.map(({ towns_data, ...rest }) => rest);
    return res.json({ ok: true, players });
});

// ── GET /players/:world/:playerId/towns ───────────────────────────────────────
app.get('/players/:world/:playerId/towns', (req, res) => {
    const { world, playerId } = req.params;
    const towns = db.getPlayerTowns(world, playerId);
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

// ── GET /attacker/:townId ─────────────────────────────────────────────────────
// Given a home_town_id, returns the attacker's player name + alliance.
// Used by the AttackNotification userscript to replace the in-game API call.
// Response: { ok, town_name, player_name, alliance_name, alliance_id }
app.get('/attacker/:townId', (req, res) => {
    const info = getAttackerInfo(req.params.townId);
    if (!info) return bad(res, `Town ${req.params.townId} not found`, 404);
    return res.json({ ok: true, ...info });
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
