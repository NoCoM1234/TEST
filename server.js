'use strict';

const express = require('express');
const cors    = require('cors');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));   // bumped limit — towns_data can be large
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

function bad(res, msg, status = 400) {
    return res.status(status).json({ ok: false, error: msg });
}

// Health check
app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'Grepolis Master API', version: '2.1.0' });
});

// ── POST /players/push ────────────────────────────────────────────────────────
// Body: { id, world, name, alliance, cultural_level, town_count,
//         current_cp, next_level_cp, troops, towns_data }
app.post('/players/push', (req, res) => {
    const b = req.body;
    const required = ['id', 'world', 'name', 'troops'];
    for (const f of required) {
        if (!b[f] && b[f] !== 0) return bad(res, `Missing field: ${f}`);
    }

    // towns_data: accept array or JSON string
    let townsData = b.towns_data || '[]';
    if (Array.isArray(townsData)) townsData = JSON.stringify(townsData);

    db.upsertPlayer({
        id:            String(b.id),
        world:         String(b.world),
        name:          b.name,
        alliance:      b.alliance       || '',
        cultural_level:b.cultural_level || 0,
        town_count:    b.town_count     || 0,
        current_cp:    b.current_cp     || 0,
        next_level_cp: b.next_level_cp  || 0,
        troops:        typeof b.troops === 'string' ? b.troops : JSON.stringify(b.troops),
        towns_data:    townsData,
    });
    return res.json({ ok: true });
});

// ── GET /players/:world ───────────────────────────────────────────────────────
// Returns all players for a world (lightweight — no towns_data)
app.get('/players/:world', (req, res) => {
    const rows = db.getPlayersByWorld(req.params.world);
    // Strip towns_data from list view to keep payload small
    const players = rows.map(({ towns_data, ...rest }) => rest);
    return res.json({ ok: true, players });
});

// ── GET /players/:world/:playerId/towns ───────────────────────────────────────
// Returns the full towns_data array for one player
app.get('/players/:world/:playerId/towns', (req, res) => {
    const { world, playerId } = req.params;
    const towns = db.getPlayerTowns(world, playerId);
    if (towns === null) return res.status(404).json({ ok: false, error: 'Player not found' });
    return res.json({ ok: true, towns });
});

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.listen(PORT, () => {
    console.log(`[Server] Grepolis Master API v2.1.0 running on port ${PORT}`);
});
