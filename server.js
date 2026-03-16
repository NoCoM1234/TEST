'use strict';
const express = require('express');
const cors = require('cors');
const db = require('./database');
const crypto = require('crypto');

function xorHex(a, b) {
    let result = '';
    for (let i = 0; i < a.length; i++) {
        result += (parseInt(a[i], 16) ^ parseInt(b[i % b.length], 16)).toString(16);
    }
    return result;
}

// ── HMAC signature verification middleware ────────────────────────────────────
async function verifyHmac(req, res, next) {
    const tag = `[verifyHmac] ${req.method} ${req.path}`;
    const ts = req.headers['x-timestamp'];
    const sig = req.headers['x-signature'];
    console.log(`${tag} — incoming request`);
    console.log(`${tag} — headers: x-timestamp=${ts} x-signature=${sig ? sig.slice(0,8)+'...' : 'MISSING'} x-token=${req.headers['x-token'] ? req.headers['x-token'].slice(0,8)+'...' : 'MISSING'}`);
    if (!ts || !sig) {
        console.warn(`${tag} — FAIL: Missing x-timestamp or x-signature`);
        return res.status(401).json({ ok: false, error: 'Missing signature' });
    }
    // Reject requests older than 60 seconds
    const now = Math.floor(Date.now() / 1000);
    const age = Math.abs(now - parseInt(ts));
    if (age > 60) {
        console.warn(`${tag} — FAIL: Request expired — age=${age}s (max 60s)`);
        return res.status(401).json({ ok: false, error: 'Request expired' });
    }
    // Get player_id and world_id from body
    const player_id = String(req.body?.id || req.body?.player_id || '');
    const world_id = String(req.body?.world || req.body?.world_id || '');
    console.log(`${tag} — identity: player_id=${player_id} world_id=${world_id}`);
    if (!player_id || !world_id) {
        console.warn(`${tag} — FAIL: Missing player_id or world_id in body`);
        return res.status(401).json({ ok: false, error: 'Missing identity' });
    }
    // Get token from DB
    const row = await db.getAuthToken(player_id, world_id);
    if (!row) {
        console.warn(`${tag} — FAIL: No auth token found in DB for player=${player_id} world=${world_id}`);
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    console.log(`${tag} — token found in DB`);
    // Verify X-Token
    const part_axorb = req.headers['x-token'];
    if (!part_axorb) {
        console.warn(`${tag} — FAIL: Missing x-token header`);
        return res.status(401).json({ ok: false, error: 'Missing token header' });
    }
    const server_axorb = xorHex(row.token, row.part_c);
    if (server_axorb !== part_axorb) {
        console.warn(`${tag} — FAIL: X-Token mismatch`);
        console.warn(`${tag} — server computed: ${server_axorb.slice(0,8)}... client sent: ${part_axorb.slice(0,8)}...`);
        return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    console.log(`${tag} — X-Token OK`);
    // HMAC verification
    const payload = ts + (req.rawBody || JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', part_axorb).update(payload).digest('hex');
    if (expected !== sig) {
        console.warn(`${tag} — FAIL: HMAC signature mismatch`);
        console.warn(`${tag} — expected: ${expected.slice(0,8)}... received: ${sig.slice(0,8)}...`);
        return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }
    console.log(`${tag} — HMAC OK — passing to handler`);
    next();
}

const AUTH_REGISTER_SECRET = process.env.AUTH_REGISTER_SECRET || 'changeme';
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const { getTownData, getAttackerInfo, getAllianceById, invalidateCache } = require('./towns');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Timestamp', 'X-Signature', 'X-Token', 'X-Integrity', 'X-Admin-Key'],
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));

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
app.post('/players/push', verifyHmac, async (req, res) => {
    const b = req.body;
    const required = ['id', 'world', 'name', 'troops'];
    for (const f of required) {
        if (!b[f] && b[f] !== 0) return bad(res, `Missing field: ${f}`);
    }
    let townsData = b.towns_data || '[]';
    if (Array.isArray(townsData)) townsData = JSON.stringify(townsData);
    await db.upsertPlayer({
        id: String(b.id),
        world: String(b.world),
        name: b.name,
        alliance: b.alliance || '',
        cultural_level: b.cultural_level || 0,
        town_count: b.town_count || 0,
        current_cp: b.current_cp || 0,
        next_level_cp: b.next_level_cp || 0,
        troops: typeof b.troops === 'string' ? b.troops : JSON.stringify(b.troops),
        troops_in: typeof b.troops_in === 'string' ? b.troops_in : JSON.stringify(b.troops_in || {}),
        troops_out: typeof b.troops_out === 'string' ? b.troops_out : JSON.stringify(b.troops_out || {}),
        towns_data: townsData,
        status: parseInt(b.status) || 3,
    });
    return res.json({ ok: true });
});

// ── GET /players/:world ───────────────────────────────────────────────────────
app.get('/players/:world', async (req, res) => {
    const rows = await db.getPlayersByWorld(req.params.world);
    const now = Math.floor(Date.now() / 1000);
    const players = rows.map(({ towns_data, ...rest }) => {
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

// ── GET /towns/:world/:townId1/:townId2 ───────────────────────────────────────
app.get('/towns/:world/:townId1/:townId2', async (req, res) => {
    const { world, townId1, townId2 } = req.params;
    const t1 = await getTownData(world, townId1);
    const t2 = await getTownData(world, townId2);
    if (!t1) return bad(res, `Town ${townId1} not found`, 404);
    if (!t2) return bad(res, `Town ${townId2} not found`, 404);
    return res.json({ ok: true, town1: { id: townId1, ...t1 }, town2: { id: townId2, ...t2 } });
});

// ── POST /towns/batch ─────────────────────────────────────────────────────────
app.post('/towns/batch', async (req, res) => {
    const { world, ids } = req.body;
    if (!world) return bad(res, 'Missing world');
    if (!Array.isArray(ids) || ids.length === 0)
        return bad(res, 'Body must have ids array');
    if (ids.length > 500)
        return bad(res, 'Max 500 ids per request');
    const result = {};
    for (const id of ids) {
        const t = await getTownData(world, String(id));
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

// ── GET /attacker/:world/:townId ──────────────────────────────────────────────
app.get('/attacker/:world/:townId', async (req, res) => {
    const { world, townId } = req.params;
    const info = await getAttackerInfo(world, townId);
    if (!info) return bad(res, `Town ${townId} not found`, 404);
    return res.json({ ok: true, ...info });
});

// ── GET /cs-speeds ────────────────────────────────────────────────────────────
const CS_SPEEDS_PATH = require('path').join(__dirname, 'cs_speeds.json');
let csSpeedsCache = null;
app.get('/cs-speeds', (_req, res) => {
    if (!csSpeedsCache) {
        try { csSpeedsCache = require('fs').readFileSync(CS_SPEEDS_PATH, 'utf8'); }
        catch { return bad(res, 'cs_speeds.json not found', 500); }
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(csSpeedsCache);
});

// ── GET /conflicting-speeds ───────────────────────────────────────────────────
const CONFLICTING_SPEEDS_PATH = require('path').join(__dirname, 'conflicting_speeds.json');
let conflictingSpeedsCache = null;
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

// ── Requests endpoints ────────────────────────────────────────────────────────
app.post('/requests/push', verifyHmac, async (req, res) => {
    const b = req.body;
    const required = ['world', 'player_id', 'player_name', 'town_id', 'town_name', 'expires_at'];
    for (const f of required) if (!b[f]) return bad(res, `Missing field: ${f}`);
    if (!b.wood && !b.stone && !b.iron) return bad(res, 'At least one resource must be > 0');
    const result = await db.pushRequest({
        world: String(b.world),
        player_id: String(b.player_id),
        player_name: b.player_name,
        alliance_name: b.alliance_name || '',
        town_id: String(b.town_id),
        town_name: b.town_name,
        wood: parseInt(b.wood) || 0,
        stone: parseInt(b.stone) || 0,
        iron: parseInt(b.iron) || 0,
        expires_at: parseInt(b.expires_at),
        comment: b.comment ? String(b.comment).trim().slice(0, 300) : '',
    });
    return res.json({ ok: true, id: result.lastInsertId });
});

app.get('/requests/:world', async (req, res) => {
    const rows = await db.getRequests(req.params.world);
    return res.json({ ok: true, requests: rows });
});

app.patch('/requests/:id/fulfill', verifyHmac, async (req, res) => {
    await db.fulfillRequest(req.params.id);
    return res.json({ ok: true });
});

app.delete('/requests/:id', verifyHmac, async (req, res) => {
    const player_id = req.body?.player_id;
    if (!player_id) return bad(res, 'Missing player_id');
    await db.deleteRequest(req.params.id, String(player_id));
    return res.json({ ok: true });
});

// ── GET /alliance/:world/:allianceId ──────────────────────────────────────────
app.get('/alliance/:world/:allianceId', async (req, res) => {
    const { world, allianceId } = req.params;
    const name = await getAllianceById(world, allianceId);
    return res.json({ ok: true, name: name || '' });
});

// ── POST /players/status ──────────────────────────────────────────────────────
app.post('/players/status', verifyHmac, async (req, res) => {
    const { id, world, status } = req.body;
    if (!id || !world || status == null) return bad(res, 'Missing fields');
    await db.updatePlayerStatus(String(id), String(world), parseInt(status));
    return res.json({ ok: true });
});

// ── WHITELIST ADMIN ──────────────────────────────────────────────────────────
app.post('/admin/whitelist', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        console.warn(`[ADMIN WHITELIST POST] Invalid admin key attempt`);
        return res.status(403).json({ ok: false });
    }
    const { player_id, world_id } = req.body;
    if (!player_id || !world_id) return bad(res, 'Missing player_id or world_id');

    console.log(`[ADMIN] Adding to whitelist: ${player_id} / ${world_id}`);
    await db.addToWhitelist(String(player_id), String(world_id));
    console.log(`[ADMIN WHITELIST POST] → SUCCESS: ${player_id}/${world_id} added to whitelist`);

    return res.json({ ok: true });
});

app.delete('/admin/whitelist', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        console.warn(`[ADMIN WHITELIST DELETE] Invalid admin key attempt`);
        return res.status(403).json({ ok: false });
    }
    const { player_id, world_id } = req.body;
    if (!player_id || !world_id) return bad(res, 'Missing player_id or world_id');

    console.log(`[ADMIN] Removing from whitelist: ${player_id} / ${world_id}`);
    await db.removeFromWhitelist(String(player_id), String(world_id));
    console.log(`[ADMIN WHITELIST DELETE] → SUCCESS: ${player_id}/${world_id} removed`);

    return res.json({ ok: true });
});

app.get('/admin/whitelist', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        console.warn(`[ADMIN WHITELIST GET] Invalid admin key attempt`);
        return res.status(403).json({ ok: false });
    }
    const list = await db.getWhitelist();
    console.log(`[ADMIN WHITELIST GET] → Returning ${list.length} entries`);
    return res.json({ ok: true, list });
});

// ── AUTH endpoints ────────────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
    const { secret, player_id, world_id, wood, stone, iron, origin_player_id } = req.body;
    if (secret !== AUTH_REGISTER_SECRET) return bad(res, 'Unauthorized', 401);
    if (!player_id || !world_id || !origin_player_id) return bad(res, 'Missing fields');
    if (wood == null && stone == null && iron == null) return bad(res, 'No resources specified');
    await db.registerActivation({
        player_id: String(player_id),
        world_id: String(world_id),
        wood: parseInt(wood) || 0,
        stone: parseInt(stone) || 0,
        iron: parseInt(iron) || 0,
        origin_player_id: String(origin_player_id),
    });
    return res.json({ ok: true });
});

app.post('/auth/claim', async (req, res) => {
    const { player_id, world_id, wood, stone, iron, origin_town_id, part_b } = req.body;
    if (!player_id || !world_id || !origin_town_id || !part_b) return res.json({ ok: false });
    const originInfo = await getAttackerInfo(String(world_id), String(origin_town_id));
    if (!originInfo) return res.json({ ok: false });
    const part_a = await db.claimActivation(
        String(player_id),
        String(world_id),
        parseInt(wood) || 0,
        parseInt(stone) || 0,
        parseInt(iron) || 0,
        String(originInfo.player_id),
        part_b,
    );
    if (!part_a) return res.json({ ok: false });
    return res.json({ ok: true, part_a });
});

app.post('/auth/verify', async (req, res) => {
    const { player_id, world_id, part_a, part_b } = req.body;
    if (!player_id || !world_id || !part_a || !part_b) return res.json({ ok: false });
    const part_a_xor_b = xorHex(part_a, part_b);
    const valid = await db.verifyToken(String(player_id), String(world_id), part_a_xor_b);
    return res.json({ ok: valid });
});

app.post('/auth/revoke', async (req, res) => {
    const { secret, player_id, world_id } = req.body;
    if (secret !== AUTH_REGISTER_SECRET) return bad(res, 'Unauthorized', 401);
    if (!player_id || !world_id) return bad(res, 'Missing fields');
    await db.revokeToken(String(player_id), String(world_id));
    return res.json({ ok: true });
});

app.post('/auth/refresh', async (req, res) => {
    const { player_id, world_id, old_part_a, old_part_b, new_part_b } = req.body;
    if (!player_id || !world_id || !old_part_a || !old_part_b || !new_part_b) return res.json({ ok: false });
    const old_part_a_xor_b = xorHex(old_part_a, old_part_b);
    const valid = await db.verifyToken(String(player_id), String(world_id), old_part_a_xor_b);
    if (!valid) return res.json({ ok: false });
    const new_part_a = await db.refreshToken(String(player_id), String(world_id), new_part_b);
    if (!new_part_a) return res.json({ ok: false });
    return res.json({ ok: true, part_a: new_part_a });
});

// ── SCRIPT ACTIVATOR (improved logging) ───────────────────────────────────────
app.post('/script/activator', async (req, res) => {
    const { player_id, world_id } = req.body;

    console.log(`[ACTIVATOR] Request from ${player_id || 'MISSING'} / ${world_id || 'MISSING'}`);

    if (!player_id || !world_id) {
        console.warn(`[ACTIVATOR] → REJECTED: missing player_id or world_id`);
        return res.json({ ok: false });
    }

    const allowed = await db.isPlayerWhitelisted(String(player_id), String(world_id));

    console.log(`[ACTIVATOR] Whitelist check for ${player_id}/${world_id} → ${allowed ? 'ALLOWED' : 'DENIED'}`);

    if (!allowed) {
        console.warn(`[ACTIVATOR] → REJECTED: player ${player_id} not whitelisted on world ${world_id}`);
        return res.json({ ok: false });
    }

    const fs = require('fs');
    const path = require('path');
    const CryptoJS = require('crypto-js');

    try {
        const key = `${player_id}:${world_id}`;
        const script = fs.readFileSync(path.join(__dirname, 'script2.js'), 'utf8');
        const encrypted = CryptoJS.AES.encrypt(script, key).toString();

        console.log(`[ACTIVATOR] → SUCCESS: delivering script2 (${script.length} bytes raw → ${encrypted.length} encrypted)`);

        return res.json({ ok: true, data: encrypted });
    } catch (err) {
        console.error(`[ACTIVATOR] → CRASH while encrypting/delivering script2: ${err.message}`);
        return res.json({ ok: false });
    }
});

// ── SCRIPT MAIN (improved logging) ────────────────────────────────────────────
app.post('/script/main', async (req, res) => {
    const { player_id, world_id } = req.body;
    const part_axorb = req.headers['x-token'];
    const clientHash = req.headers['x-integrity'];

    console.log(`[SCRIPT MAIN] Request  player=${player_id || '?'}/${world_id || '?'}   token=${part_axorb?.slice(0,8) || 'MISSING'}…   integrity=${clientHash?.slice(0,12) || 'MISSING'}`);

    if (!player_id || !world_id || !part_axorb) {
        console.warn(`[SCRIPT MAIN] → REJECTED: missing player_id, world_id or x-token`);
        return res.json({ ok: false });
    }

    const row = await db.getAuthToken(String(player_id), String(world_id));

    if (!row) {
        console.warn(`[SCRIPT MAIN] → REJECTED: no auth token found in DB for ${player_id}/${world_id}`);
        return res.json({ ok: false });
    }

    const server_axorb = xorHex(row.token, row.part_c);

    if (server_axorb !== part_axorb) {
        console.warn(`[SCRIPT MAIN] → REJECTED: x-token mismatch`);
        console.warn(`[SCRIPT MAIN]   client sent : ${part_axorb.slice(0,16)}…`);
        console.warn(`[SCRIPT MAIN]   server calc : ${server_axorb.slice(0,16)}…`);
        return res.json({ ok: false });
    }

    console.log(`[SCRIPT MAIN] Token verified OK`);

    // Integrity check logging
    if (clientHash) {
        const stored = await db.getIntegrityHash('script2');
        if (!stored) {
            console.log(`[SCRIPT MAIN] [Integrity] First time — learning client hash: ${clientHash.slice(0,16)}…`);
            await db.setIntegrityHash('script2', clientHash);
        } else if (stored !== clientHash) {
            console.warn(`[SCRIPT MAIN] [Integrity] TAMPER DETECTED!`);
            console.warn(`[SCRIPT MAIN]   stored : ${stored.slice(0,16)}…`);
            console.warn(`[SCRIPT MAIN]   client : ${clientHash.slice(0,16)}…`);
            return res.json({ ok: false });
        } else {
            console.log(`[SCRIPT MAIN] Integrity hash matches`);
        }
    }

    const CryptoJS = require('crypto-js');
    try {
        const script = await db.getScript('script3');
        if (!script) {
            console.error(`[SCRIPT MAIN] → CRASH: script3 not found in database`);
            return res.json({ ok: false });
        }

        const encrypted = CryptoJS.AES.encrypt(script, part_axorb).toString();

        console.log(`[SCRIPT MAIN] → SUCCESS: delivering script3 (${script.length} → ${encrypted.length} bytes)`);

        return res.json({ ok: true, data: encrypted });
    } catch (e) {
        console.error(`[SCRIPT MAIN] → CRASH during encryption: ${e.message}`);
        return res.json({ ok: false });
    }
});

// ── Other endpoints (unchanged except for minor consistency) ──────────────────
app.post('/push/player/data', verifyHmac, async (req, res) => {
    const b = req.body;
    if (!b.player_id || !b.world_id || !Array.isArray(b.towns)) {
        return bad(res, 'Missing required fields');
    }
    await db.pushTownData({
        player_id: String(b.player_id),
        player_name: b.player_name || '',
        world_id: String(b.world_id),
        alliance_id: String(b.alliance_id || ''),
        alliance_name: b.alliance_name || '',
        favors: b.favors || {},
        towns: b.towns,
    });
    return res.json({ ok: true });
});

app.get('/town/data/:worldId/:townId', async (req, res) => {
    const { worldId, townId } = req.params;
    const data = await db.getTownDataByTownId(worldId, townId);
    if (!data) {
        return res.json({
            ok: false,
            error: 'Town not in database — player may not be using the script or has not pushed data yet',
        });
    }
    const now = Math.floor(Date.now() / 1000);
    const age = now - (data.updated_at || 0);
    const stale = age > 300;
    return res.json({ ok: true, stale, age_seconds: age, ...data });
});

// DECOY endpoints
app.post('/auth/session', (req, res) => {
    res.json({ ok: true, session_token: require('crypto').randomBytes(32).toString('hex') });
});

app.post('/auth/license', (req, res) => {
    res.json({ ok: true, valid: true, expires: Date.now() + 86400000 });
});

app.post('/auth/heartbeat', (req, res) => {
    res.json({ ok: true, next_ping: 30000 + Math.floor(Math.random() * 10000) });
});

app.post('/auth/verify_checksum', (req, res) => {
    res.json({ ok: true, valid: true, version: '2.1.4' });
});

app.post('/config/fetch', (req, res) => {
    res.json({ ok: false });
});

// ── ADMIN world data push ─────────────────────────────────────────────────────
app.post('/admin/world-data', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const { world_id, towns, islands, players, alliances } = req.body;
    if (!world_id) return bad(res, 'Missing world_id');
    if (!Array.isArray(towns) || !Array.isArray(islands)) return bad(res, 'towns and islands must be arrays');
    await db.upsertWorldData(world_id, towns, islands);
    if (Array.isArray(players) && Array.isArray(alliances)) {
        await db.upsertWorldMeta(world_id, players, alliances);
    }
    invalidateCache(world_id);
    console.log(`[Admin] World data updated for ${world_id} — ${towns.length} towns, ${islands.length} islands`);
    return res.json({ ok: true });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.listen(PORT, () => {
    console.log(`[Server] Master API v2.3.0 running on port ${PORT}`);
});
