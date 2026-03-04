'use strict';

const express = require('express');
const cors    = require('cors');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Simple request logger
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function bad(res, msg, status = 400) {
    return res.status(status).json({ ok: false, error: msg });
}

function requireFields(body, fields) {
    for (const f of fields) {
        if (body[f] === undefined || body[f] === null || body[f] === '') return f;
    }
    return null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — Render pings this to keep the service alive
app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'Grepolis Master API', version: '1.0.0' });
});

// ── POST /groups/create ───────────────────────────────────────────────────────
// Body: { token, name, world }
// Creates a new group. Token must be unique.
app.post('/groups/create', (req, res) => {
    const missing = requireFields(req.body, ['token', 'name', 'world']);
    if (missing) return bad(res, `Missing field: ${missing}`);

    const { token, name, world } = req.body;

    if (token.length < 8 || token.length > 64)
        return bad(res, 'Token must be 8–64 characters');

    const result = db.createGroup({ token, name, world });
    if (!result.ok) return bad(res, result.error, 409);

    console.log(`[Groups] Created group "${name}" for world ${world}`);
    return res.status(201).json({ ok: true, token });
});

// ── POST /players/push ────────────────────────────────────────────────────────
// Body: { token, id, name, world, towns, alliance, cultural_level,
//         additional_towns, current_cp, next_level_cp, last_updated }
// Upserts the player's encrypted data into the group.
app.post('/players/push', (req, res) => {
    const missing = requireFields(req.body, [
        'token', 'id', 'name', 'world',
        'towns', 'alliance', 'cultural_level',
        'additional_towns', 'current_cp', 'next_level_cp', 'last_updated'
    ]);
    if (missing) return bad(res, `Missing field: ${missing}`);

    const { token } = req.body;

    if (!db.groupExists(token))
        return bad(res, 'Group not found', 404);

    db.upsertPlayer({
        id:               String(req.body.id),
        token,
        name:             req.body.name,
        world:            req.body.world,
        towns:            req.body.towns,
        alliance:         req.body.alliance,
        cultural_level:   req.body.cultural_level,
        additional_towns: req.body.additional_towns,
        current_cp:       req.body.current_cp,
        next_level_cp:    req.body.next_level_cp,
        last_updated:     req.body.last_updated,
    });

    return res.json({ ok: true });
});

// ── GET /players/:token ───────────────────────────────────────────────────────
// Returns all encrypted player rows for the group.
app.get('/players/:token', (req, res) => {
    const { token } = req.params;

    if (!db.groupExists(token))
        return bad(res, 'Group not found', 404);

    const players = db.getPlayers(token);
    return res.json({ ok: true, players });
});

// ── DELETE /players/:token/:playerId ─────────────────────────────────────────
// Removes a single player from the group.
app.delete('/players/:token/:playerId', (req, res) => {
    const { token, playerId } = req.params;

    if (!db.groupExists(token))
        return bad(res, 'Group not found', 404);

    const deleted = db.deletePlayer({ id: playerId, token });
    if (!deleted) return bad(res, 'Player not found in group', 404);

    return res.json({ ok: true });
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[Server] Grepolis Master API running on port ${PORT}`);
});
