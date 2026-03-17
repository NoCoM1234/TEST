'use strict';
const express = require('express');
const cors    = require('cors');
const db      = require('./database');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken'); // npm i jsonwebtoken

// ── ENV ───────────────────────────────────────────────────────────────────────
// Required in Render environment variables:
//   JWT_SECRET          — long random string, e.g. output of: openssl rand -hex 64
//   ADMIN_KEY           — already set
//   AUTH_REGISTER_SECRET — already set
//   MONGO_URI           — already set
//
// No longer needed (remove from Render):
//   WATCHER_SESSION     — watcher is now a browser script, not a server HTTP call
//   WATCHER_WORLD       — same reason
const JWT_SECRET       = process.env.JWT_SECRET || 'CHANGE_ME_LONG_RANDOM_STRING';
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // challenge codes expire after 5 min

// ── RATE LIMITER ──────────────────────────────────────────────────────────────
// Prevents abuse of /auth/challenge by limiting each player_id to
// MAX_CHALLENGES attempts within RATE_WINDOW_MS. In-memory — resets on restart.
// For multi-instance deployments replace with Redis.
const MAX_CHALLENGES   = 3;
const RATE_WINDOW_MS   = 10 * 60 * 1000; // 10 minutes
const _challengeRates  = new Map();       // player_id → { count, reset_at }

function checkChallengeRate(player_id) {
    const now   = Date.now();
    const entry = _challengeRates.get(player_id);

    if (!entry || now > entry.reset_at) {
        // First attempt or window expired — start fresh
        _challengeRates.set(player_id, { count: 1, reset_at: now + RATE_WINDOW_MS });
        return true;
    }
    if (entry.count >= MAX_CHALLENGES) {
        const secs = Math.ceil((entry.reset_at - now) / 1000);
        console.warn(`[RATE] player ${player_id} exceeded challenge limit — retry in ${secs}s`);
        return false;
    }
    entry.count++;
    return true;
}

// Purge stale rate entries every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, e] of _challengeRates) if (now > e.reset_at) _challengeRates.delete(id);
}, 15 * 60 * 1000);

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
    const ts  = req.headers['x-timestamp'];
    const sig = req.headers['x-signature'];
    console.log(`${tag} — incoming request`);
    console.log(`${tag} — headers: x-timestamp=${ts} x-signature=${sig ? sig.slice(0,8)+'...' : 'MISSING'} x-token=${req.headers['x-token'] ? req.headers['x-token'].slice(0,8)+'...' : 'MISSING'}`);
    if (!ts || !sig) {
        console.warn(`${tag} — FAIL: Missing x-timestamp or x-signature`);
        return res.status(401).json({ ok: false, error: 'Missing signature' });
    }
    const now = Math.floor(Date.now() / 1000);
    const age = Math.abs(now - parseInt(ts));
    if (age > 60) {
        console.warn(`${tag} — FAIL: Request expired — age=${age}s (max 60s)`);
        return res.status(401).json({ ok: false, error: 'Request expired' });
    }
    const player_id = String(req.body?.id || req.body?.player_id || '');
    const world_id  = String(req.body?.world || req.body?.world_id || '');
    console.log(`${tag} — identity: player_id=${player_id} world_id=${world_id}`);
    if (!player_id || !world_id) {
        console.warn(`${tag} — FAIL: Missing player_id or world_id in body`);
        return res.status(401).json({ ok: false, error: 'Missing identity' });
    }
    const row = await db.getAuthToken(player_id, world_id);
    if (!row) {
        console.warn(`${tag} — FAIL: No auth token found in DB for player=${player_id} world=${world_id}`);
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    console.log(`${tag} — token found in DB`);
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
    const payload  = ts + (req.rawBody || JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', part_axorb).update(payload).digest('hex');
    if (expected !== sig) {
        console.warn(`${tag} — FAIL: HMAC signature mismatch`);
        console.warn(`${tag} — expected: ${expected.slice(0,8)}... received: ${sig.slice(0,8)}...`);
        return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }
    console.log(`${tag} — HMAC OK — passing to handler`);
    next();
}

// ── Script hash verification middleware ───────────────────────────────────────
// Applied to challenge-response routes. Checks X-Script-Hash against the
// stored hash in integrity_hashes['script1'].
//
// Behaviour:
//   First ever request → no hash stored → learn it, store as known-good, allow.
//   Subsequent requests → compare incoming vs stored. Mismatch → reject.
//   Missing/unknown header → reject immediately.
//
// The hash is computed from the source of three critical functions using
// .toString() — so any modification to those functions changes the hash.
//
// To reset after a legitimate script update:
//   curl -X DELETE https://your-server/admin/integrity/script1 -H "x-admin-key: KEY"
async function verifyScriptHash(req, res, next) {
    const tag        = `[verifyScriptHash] ${req.method} ${req.path}`;
    const clientHash = req.headers['x-script-hash'];

    if (!clientHash || clientHash === 'unknown') {
        console.warn(`${tag} — FAIL: Missing or unknown X-Script-Hash`);
        return res.status(401).json({ ok: false, error: 'Missing script hash' });
    }

    try {
        const stored = await db.getIntegrityHash('script1');

        if (!stored) {
            // First ever request — learn and store this hash automatically
            await db.setIntegrityHash('script1', clientHash);
            console.log(`${tag} — First run: registered hash ${clientHash.slice(0,16)}…`);
            return next();
        }

        if (stored !== clientHash) {
            console.warn(`${tag} — TAMPER DETECTED`);
            console.warn(`${tag}   stored : ${stored.slice(0,16)}…`);
            console.warn(`${tag}   client : ${clientHash.slice(0,16)}…`);
            return res.status(401).json({ ok: false, error: 'Script integrity check failed' });
        }

        return next();

    } catch (e) {
        console.error(`${tag} — DB error: ${e.message}`);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
}

const AUTH_REGISTER_SECRET = process.env.AUTH_REGISTER_SECRET || 'changeme';
const ADMIN_KEY            = process.env.ADMIN_KEY            || 'changeme';
const { getTownData, getAttackerInfo, getAllianceById, invalidateCache } = require('./towns');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 'X-Timestamp', 'X-Signature', 'X-Token', 'X-Integrity',
        'X-Admin-Key', 'X-Script-Hash', 'X-Player-Id',
        'X-Challenge-Token', 'Authorization',
    ],
}));
app.options('*', cors());
app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));

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
    const b        = req.body;
    const required = ['id', 'world', 'name', 'troops'];
    for (const f of required) {
        if (!b[f] && b[f] !== 0) return bad(res, `Missing field: ${f}`);
    }
    let townsData = b.towns_data || '[]';
    if (Array.isArray(townsData)) townsData = JSON.stringify(townsData);
    await db.upsertPlayer({
        id:             String(b.id),
        world:          String(b.world),
        name:           b.name,
        alliance:       b.alliance || '',
        cultural_level: b.cultural_level || 0,
        town_count:     b.town_count || 0,
        current_cp:     b.current_cp || 0,
        next_level_cp:  b.next_level_cp || 0,
        troops:         typeof b.troops     === 'string' ? b.troops     : JSON.stringify(b.troops),
        troops_in:      typeof b.troops_in  === 'string' ? b.troops_in  : JSON.stringify(b.troops_in  || {}),
        troops_out:     typeof b.troops_out === 'string' ? b.troops_out : JSON.stringify(b.troops_out || {}),
        towns_data:     townsData,
        status:         parseInt(b.status) || 3,
    });
    return res.json({ ok: true });
});

// ── GET /players/:world ───────────────────────────────────────────────────────
app.get('/players/:world', async (req, res) => {
    const rows = await db.getPlayersByWorld(req.params.world);
    const now  = Math.floor(Date.now() / 1000);
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
    if (!Array.isArray(ids) || ids.length === 0) return bad(res, 'Body must have ids array');
    if (ids.length > 500) return bad(res, 'Max 500 ids per request');
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
    const b        = req.body;
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
        comment:       b.comment ? String(b.comment).trim().slice(0, 300) : '',
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

// ── WHITELIST ADMIN ───────────────────────────────────────────────────────────
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
        player_id:        String(player_id),
        world_id:         String(world_id),
        wood:             parseInt(wood)  || 0,
        stone:            parseInt(stone) || 0,
        iron:             parseInt(iron)  || 0,
        origin_player_id: String(origin_player_id),
    });
    return res.json({ ok: true });
});

// ── POST /auth/claim ──────────────────────────────────────────────────────────
app.post('/auth/claim', async (req, res) => {
    const { player_id, world_id, wood, stone, iron, origin_town_id, part_b } = req.body;
    console.log(`[CLAIM] Attempt  player=${player_id || '?'}/${world_id || '?'}  origin_town=${origin_town_id || '?'}  res=${wood || 0}/${stone || 0}/${iron || 0}  part_b=${part_b?.slice(0,8) || 'MISSING'}…`);
    if (!player_id || !world_id || !origin_town_id || !part_b) {
        console.warn(`[CLAIM] → REJECTED: missing required fields`);
        return res.json({ ok: false });
    }
    const originInfo = await getAttackerInfo(String(world_id), String(origin_town_id));
    if (!originInfo) {
        console.warn(`[CLAIM] → REJECTED: origin town ${origin_town_id} not found in world ${world_id}`);
        return res.json({ ok: false });
    }
    console.log(`[CLAIM] Origin town found → attacker = ${originInfo.player_id || '?'}`);
    const part_a = await db.claimActivation(
        String(player_id),
        String(world_id),
        parseInt(wood)  || 0,
        parseInt(stone) || 0,
        parseInt(iron)  || 0,
        String(originInfo.player_id),
        part_b,
    );
    if (!part_a) {
        console.warn(`[CLAIM] → FAILED: claimActivation returned no part_a`);
        return res.json({ ok: false });
    }
    console.log(`[CLAIM] → SUCCESS: part_a generated = ${part_a.slice(0,8)}…`);
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

// ═════════════════════════════════════════════════════════════════════════════
// ── CHALLENGE-RESPONSE VERIFICATION SYSTEM (Polling Watcher Architecture) ────
// ═════════════════════════════════════════════════════════════════════════════
//
// New flow (replaces server-side axios watcher call):
//
//   1. Client   → POST /auth/challenge       → gets code + challenge_token
//   2. User renames a town to the code in-game
//   3. Client   → POST /auth/verify-rename   → sends town_id; server queues
//                                               a watcher_task in MongoDB
//                                               ← { ok: true, queued: true }
//   4. Client polls POST /auth/verify-status every 3s
//
//   5. Watcher  → GET /watcher/pending (every 10s, X-Admin-Key)
//                  ← [{ challenge_token, town_id, world_id, expected_code, player_id }]
//   6. Watcher fetches town info via Grepolis game API (browser cookies = auth)
//   7. Watcher  → POST /watcher/results (X-Admin-Key)
//                  body: [{ challenge_token, town_name, town_player_id }]
//   8. Server checks: name match + DB ownership → issues JWT → marks task verified
//
//   9. Client poll → { status: 'verified', access_token } → done
//
// Security properties:
//   • Admin key is hardcoded in the Watcher script (Tampermonkey) — only you
//     can run that script and send results back.
//   • Server never trusts the name from the USER script — only from the Watcher.
//   • The Watcher uses real browser cookies → it IS logged into the game.
//   • Multi-world: Watcher loops over tasks of any world_id and makes
//     cross-subdomain requests via GM_xmlhttpRequest (browser sends cookies
//     for any grepolis.com subdomain the watcher is logged into).
// ─────────────────────────────────────────────────────────────────────────────

const challenges = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of challenges) {
        if (entry.expires_at < now) challenges.delete(token);
    }
}, 60_000);

function generateChallengeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    let code = 'V-';
    for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
    return code;
}

// ── POST /auth/challenge ──────────────────────────────────────────────────────
// Returns a challenge code and a short-lived challenge_token.
app.post('/auth/challenge', verifyScriptHash, async (req, res) => {
    try {
        const { player_id, world_id } = req.body;
        if (!player_id || !world_id) return res.json({ ok: false, reason: 'Missing fields' });

        // ── Rate limit: max 3 challenges per player per 10 minutes ──────────
        if (!checkChallengeRate(String(player_id))) {
            return res.json({ ok: false, reason: 'Too many attempts — please wait before trying again' });
        }

        const whitelisted = await db.isPlayerWhitelisted(String(player_id), String(world_id));
        if (!whitelisted) {
            console.warn(`[CHALLENGE] → REJECTED: player ${player_id}/${world_id} not whitelisted`);
            return res.json({ ok: false, reason: 'Player not whitelisted' });
        }

        const code            = generateChallengeCode();
        const challenge_token = crypto.randomBytes(32).toString('hex');

        challenges.set(challenge_token, {
            code,
            player_id:  String(player_id),
            world_id:   String(world_id),
            expires_at: Date.now() + CHALLENGE_TTL_MS,
        });

        console.log(`[CHALLENGE] Issued code=${code} for player=${player_id} world=${world_id}`);
        return res.json({ ok: true, challenge: code, challenge_token });

    } catch (e) {
        console.error('[CHALLENGE] Error:', e);
        return res.json({ ok: false, reason: 'Server error' });
    }
});

// ── POST /auth/verify-rename ──────────────────────────────────────────────────
// Client reports a rename and sends the town_id.
// Server validates the challenge_token, then QUEUES a watcher_task in MongoDB
// instead of calling the game API directly. Returns { ok: true, queued: true }.
// The client must then poll /auth/verify-status.
app.post('/auth/verify-rename', verifyScriptHash, async (req, res) => {
    try {
        const { player_id, world_id, town_id, challenge_token } = req.body;
        if (!player_id || !world_id || !town_id || !challenge_token) {
            return res.json({ ok: false, reason: 'Missing fields' });
        }

        // ── Validate challenge token ──────────────────────────────────────────
        const entry = challenges.get(challenge_token);
        if (!entry) {
            console.warn(`[VERIFY-RENAME] → REJECTED: unknown challenge_token`);
            return res.json({ ok: false, reason: 'Invalid or expired challenge' });
        }
        if (Date.now() > entry.expires_at) {
            challenges.delete(challenge_token);
            console.warn(`[VERIFY-RENAME] → REJECTED: challenge expired for player=${player_id}`);
            return res.json({ ok: false, reason: 'Challenge expired — please reload and try again' });
        }
        if (entry.player_id !== String(player_id) || entry.world_id !== String(world_id)) {
            console.warn(`[VERIFY-RENAME] → REJECTED: player/world mismatch on challenge_token`);
            return res.json({ ok: false, reason: 'Challenge mismatch' });
        }

        // ── Confirm still whitelisted ─────────────────────────────────────────
        const whitelisted = await db.isPlayerWhitelisted(String(player_id), String(world_id));
        if (!whitelisted) {
            return res.json({ ok: false, reason: 'Player not whitelisted' });
        }

        // ── Queue task for Watcher — consume challenge from memory ────────────
        // Remove from in-memory map immediately so it can't be double-queued.
        challenges.delete(challenge_token);

        await db.queueWatcherTask({
            challenge_token,
            town_id:       String(town_id),
            world_id:      String(world_id),
            expected_code: entry.code,
            player_id:     String(player_id),
        });

        console.log(`[VERIFY-RENAME] ⏳ Queued watcher task: challenge=${challenge_token.slice(0,8)}… town=${town_id} world=${world_id}`);
        return res.json({ ok: true, queued: true });

    } catch (e) {
        console.error('[VERIFY-RENAME] Error:', e);
        return res.json({ ok: false, reason: 'Server error' });
    }
});

// ── POST /auth/verify-status ──────────────────────────────────────────────────
// Client polls this every 3 seconds after receiving { queued: true }.
// Returns:
//   { status: 'pending' }                         — watcher hasn't checked yet
//   { status: 'verified', access_token: '...' }   — success, JWT issued
//   { status: 'failed',   reason: '...' }          — watcher found a mismatch
//   { status: 'not_found' }                        — task expired or unknown
app.post('/auth/verify-status', verifyScriptHash, async (req, res) => {
    try {
        const { challenge_token, player_id, world_id } = req.body;
        if (!challenge_token || !player_id) {
            return res.json({ status: 'not_found' });
        }

        const task = await db.getWatcherTaskStatus(challenge_token, String(player_id));
        if (!task) return res.json({ status: 'not_found' });

        if (task.status === 'pending') {
            return res.json({ status: 'pending' });
        }

        if (task.status === 'failed') {
            return res.json({ status: 'failed', reason: task.reason || 'Verification failed' });
        }

        if (task.status === 'verified') {
            // Generate JWT on the fly — it's cheap and avoids storing tokens in DB
            const jti          = crypto.randomBytes(16).toString('hex');
            const access_token = jwt.sign(
                {
                    jti,
                    player_id: String(task.player_id),
                    world_id:  String(task.world_id),
                    verified:  true,
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            console.log(`[VERIFY-STATUS] ✅ Issuing JWT jti=${jti.slice(0,8)}… for player=${task.player_id} world=${task.world_id}`);
            return res.json({ status: 'verified', access_token });
        }

        return res.json({ status: 'not_found' });

    } catch (e) {
        console.error('[VERIFY-STATUS] Error:', e);
        return res.json({ status: 'not_found' });
    }
});

// ── POST /auth/token-check ────────────────────────────────────────────────────
// Returning users validate their stored JWT to skip the rename flow.
app.post('/auth/token-check', verifyScriptHash, async (req, res) => {
    try {
        const bearer = req.headers.authorization ?? '';
        const token  = bearer.startsWith('Bearer ') ? bearer.slice(7) : null;
        if (!token) return res.json({ valid: false });

        const payload = jwt.verify(token, JWT_SECRET);
        const match   = String(payload.player_id) === String(req.body.player_id)
                     && String(payload.world_id)  === String(req.body.world_id);

        // Reject if this specific token has been revoked
        if (match && payload.jti) {
            const revoked = await db.isJtiRevoked(payload.jti);
            if (revoked) return res.json({ valid: false });
        }

        return res.json({ valid: match && !!payload.verified });
    } catch (e) {
        return res.json({ valid: false });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// ── WATCHER ROUTES ────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
//
// These two routes are ONLY called by the Watcher Tampermonkey script.
// Both require X-Admin-Key. The key is hardcoded in the Watcher script,
// so only you (the admin running the watcher account) can call these.
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /watcher/pending ──────────────────────────────────────────────────────
// Watcher polls this every 10 seconds.
// Returns all tasks currently in 'pending' status.
// Response: { ok: true, tasks: [{ challenge_token, town_id, world_id, expected_code, player_id }] }
//
// Multi-world: tasks from ANY world are returned. The Watcher script loops over
// them and makes a cross-subdomain GM_xmlhttpRequest for each one. Browser cookies
// for any grepolis.com subdomain the admin is logged into are sent automatically.
app.get('/watcher/pending', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        console.warn(`[WATCHER PENDING] Invalid admin key`);
        return res.status(403).json({ ok: false });
    }
    try {
        const tasks = await db.getPendingWatcherTasks();
        // Only expose the fields the Watcher needs — don't leak expected_code
        // unnecessarily... actually the Watcher NEEDS it to compare locally.
        // That's fine: only the admin's browser (with ADMIN_KEY) receives this.
        console.log(`[WATCHER PENDING] Returning ${tasks.length} pending task(s)`);
        return res.json({ ok: true, tasks });
    } catch (e) {
        console.error('[WATCHER PENDING] Error:', e);
        return res.json({ ok: false, tasks: [] });
    }
});

// ── POST /watcher/results ─────────────────────────────────────────────────────
// Watcher posts the live town data it fetched from the game API.
// Body: { results: [{ challenge_token, town_name, town_player_id }] }
//
// For each result the server performs two checks:
//   1. Name match — does the live town name == expected challenge code?
//   2. Ownership  — does the DB world_data confirm town belongs to claimed player?
// Only if both pass does the server mark the task as 'verified'.
app.post('/watcher/results', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        console.warn(`[WATCHER RESULTS] Invalid admin key`);
        return res.status(403).json({ ok: false });
    }

    const { results } = req.body;
    if (!Array.isArray(results) || results.length === 0) {
        return res.json({ ok: true, processed: 0 });
    }

    let processed = 0;

    for (const result of results) {
        const { challenge_token, town_name, town_player_id } = result;
        if (!challenge_token || town_name === undefined) continue;

        try {
            // Fetch the queued task to get expected_code, player_id, world_id
            const task = await db.getWatcherTaskStatus(challenge_token, null);
            if (!task || task.status !== 'pending') continue;

            const trimmedName = String(town_name).trim();

            // ── Check 1: Name matches the challenge code ───────────────────
            if (trimmedName !== task.expected_code) {
                console.warn(`[WATCHER RESULTS] ❌ Name mismatch for ${challenge_token.slice(0,8)}… — watcher saw "${trimmedName}", expected "${task.expected_code}"`);
                await db.resolveWatcherTask(
                    challenge_token,
                    'failed',
                    `Town name "${trimmedName}" does not match. Rename a town to exactly "${task.expected_code}" and try again.`
                );
                processed++;
                continue;
            }

            // ── Check 2: Watcher-reported owner matches claimed player ─────
            if (town_player_id && String(town_player_id) !== String(task.player_id)) {
                console.warn(`[WATCHER RESULTS] ❌ Ownership mismatch: watcher sees owner=${town_player_id}, claimed=${task.player_id}`);
                await db.resolveWatcherTask(
                    challenge_token,
                    'failed',
                    'Town does not belong to this player (watcher check)'
                );
                processed++;
                continue;
            }

            // ── Check 3: Cross-reference DB world snapshot ─────────────────
            const owned = await db.isTownOwnedBy(task.town_id, task.player_id, task.world_id);
            if (!owned) {
                console.warn(`[WATCHER RESULTS] ❌ DB ownership check failed: town=${task.town_id} player=${task.player_id} world=${task.world_id}`);
                await db.resolveWatcherTask(
                    challenge_token,
                    'failed',
                    'Town does not belong to this player (DB check)'
                );
                processed++;
                continue;
            }

            // ── All checks passed ──────────────────────────────────────────
            await db.resolveWatcherTask(challenge_token, 'verified', null);
            console.log(`[WATCHER RESULTS] ✅ Verified: player=${task.player_id} world=${task.world_id} town=${task.town_id}`);
            processed++;

        } catch (e) {
            console.error(`[WATCHER RESULTS] Error processing ${challenge_token?.slice(0,8)}…:`, e.message);
        }
    }

    return res.json({ ok: true, processed });
});

// ═════════════════════════════════════════════════════════════════════════════
// ── SCRIPT ACTIVATOR ─────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
// Requires a verified JWT (issued after challenge-response completes).
// Encrypts script2.js with the JWT string itself as the AES key — a forged
// or replayed token produces a different key → decryption → garbage output.
app.post('/script/activator', verifyScriptHash, async (req, res) => {
    const { player_id, world_id } = req.body;
    console.log(`[ACTIVATOR] Request from ${player_id || 'MISSING'} / ${world_id || 'MISSING'}`);

    if (!player_id || !world_id) {
        console.warn(`[ACTIVATOR] → REJECTED: missing player_id or world_id`);
        return res.json({ ok: false });
    }

    // ── 1. Verify JWT ─────────────────────────────────────────────────────
    const bearer = req.headers.authorization ?? '';
    const token  = bearer.startsWith('Bearer ') ? bearer.slice(7) : null;
    if (!token) {
        console.warn(`[ACTIVATOR] → REJECTED: missing Authorization header`);
        return res.json({ ok: false });
    }

    let jwtPayload;
    try {
        jwtPayload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        console.warn(`[ACTIVATOR] → REJECTED: invalid or expired JWT — ${e.message}`);
        return res.json({ ok: false });
    }

    if (!jwtPayload.verified) {
        console.warn(`[ACTIVATOR] → REJECTED: JWT not marked as verified`);
        return res.json({ ok: false });
    }

    // ── 1b. Check jti blacklist ───────────────────────────────────────────
    if (jwtPayload.jti) {
        const revoked = await db.isJtiRevoked(jwtPayload.jti);
        if (revoked) {
            console.warn(`[ACTIVATOR] → REJECTED: JWT jti=${jwtPayload.jti.slice(0,8)}… is revoked`);
            return res.json({ ok: false });
        }
    }

    // ── 2. Confirm JWT identity matches body ──────────────────────────────
    if (String(jwtPayload.player_id) !== String(player_id) ||
        String(jwtPayload.world_id)  !== String(world_id)) {
        console.warn(`[ACTIVATOR] → REJECTED: JWT player/world mismatch`);
        return res.json({ ok: false });
    }

    // ── 3. Confirm still whitelisted ──────────────────────────────────────
    const allowed = await db.isPlayerWhitelisted(String(player_id), String(world_id));
    console.log(`[ACTIVATOR] Whitelist check for ${player_id}/${world_id} → ${allowed ? 'ALLOWED' : 'DENIED'}`);
    if (!allowed) {
        console.warn(`[ACTIVATOR] → REJECTED: player ${player_id} not whitelisted on world ${world_id}`);
        return res.json({ ok: false });
    }

    // ── 4. Encrypt script2.js with the JWT as the AES key ────────────────
    const fs       = require('fs');
    const path     = require('path');
    const CryptoJS = require('crypto-js');

    try {
        const script    = fs.readFileSync(path.join(__dirname, 'script2.js'), 'utf8');
        const encrypted = CryptoJS.AES.encrypt(script, token).toString();
        console.log(`[ACTIVATOR] → SUCCESS: delivering script2 (${script.length} bytes raw → ${encrypted.length} encrypted) to player ${player_id}`);
        return res.json({ ok: true, data: encrypted });
    } catch (err) {
        console.error(`[ACTIVATOR] → CRASH while encrypting/delivering script2: ${err.message}`);
        return res.json({ ok: false });
    }
});

// ── DELETE /admin/integrity/:type — reset a stored integrity hash ─────────────
app.delete('/admin/integrity/:type', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        console.warn(`[ADMIN INTEGRITY DELETE] Invalid admin key attempt`);
        return res.status(403).json({ ok: false });
    }
    const { type } = req.params;
    await db.deleteIntegrityHash(type);
    console.log(`[ADMIN INTEGRITY DELETE] Hash for '${type}' deleted — will re-learn on next request`);
    return res.json({ ok: true, deleted: type });
});

// ── POST /admin/revoke — revoke a specific player's JWT ──────────────────────
// Supply player_id + world_id. The server reads their current JWT's jti from
// the request, or you can supply a jti directly.
// After revocation: heartbeat returns { ok: false }, token-check returns invalid,
// activator rejects — player is locked out within one heartbeat cycle.
//
// Usage:
//   curl -X POST https://your-server.com/admin/revoke \
//     -H "x-admin-key: YOUR_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"player_id":"12345","world_id":"gr112","jti":"abc123...","exp":1234567890}'
app.post('/admin/revoke', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
        console.warn(`[ADMIN REVOKE] Invalid admin key attempt`);
        return res.status(403).json({ ok: false });
    }
    const { player_id, world_id, jti, exp } = req.body;
    if (!player_id || !world_id || !jti) return bad(res, 'Missing player_id, world_id or jti');

    // exp defaults to now + 7d if not supplied (safe upper bound)
    const expiry = exp ?? Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    await db.revokeJti(jti, String(player_id), String(world_id), expiry);
    console.log(`[ADMIN REVOKE] Revoked jti=${jti.slice(0,8)}… for player=${player_id}/${world_id}`);
    return res.json({ ok: true });
});

// ── POST /admin/script — upload script content to MongoDB ────────────────────
app.post('/admin/script', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ ok: false });
    const { name, content } = req.body;
    if (!name || !content) return bad(res, 'Missing name or content');
    await db.setScript(name, content);
    console.log(`[Admin] Script '${name}' uploaded — ${content.length} bytes`);
    return res.json({ ok: true });
});

// ── GET /admin/script/:name — check a script exists ──────────────────────────
app.get('/admin/script/:name', async (req, res) => {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ ok: false });
    const script = await db.getScript(req.params.name);
    if (!script) return res.json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, size: script.length });
});

// ── SCRIPT MAIN ───────────────────────────────────────────────────────────────
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

// ── Other endpoints ───────────────────────────────────────────────────────────
app.post('/push/player/data', verifyHmac, async (req, res) => {
    const b = req.body;
    if (!b.player_id || !b.world_id || !Array.isArray(b.towns)) {
        return bad(res, 'Missing required fields');
    }
    await db.pushTownData({
        player_id:     String(b.player_id),
        player_name:   b.player_name || '',
        world_id:      String(b.world_id),
        alliance_id:   String(b.alliance_id || ''),
        alliance_name: b.alliance_name || '',
        favors:        b.favors || {},
        towns:         b.towns,
    });
    return res.json({ ok: true });
});

app.get('/town/data/:worldId/:townId', async (req, res) => {
    const { worldId, townId } = req.params;
    const data = await db.getTownDataByTownId(worldId, townId);
    if (!data) {
        return res.json({
            ok:    false,
            error: 'Town not in database — player may not be using the script or has not pushed data yet',
        });
    }
    const now   = Math.floor(Date.now() / 1000);
    const age   = now - (data.updated_at || 0);
    const stale = age > 300;
    return res.json({ ok: true, stale, age_seconds: age, ...data });
});

// ── DECOY endpoints ───────────────────────────────────────────────────────────
app.post('/auth/session', (_req, res) => {
    res.json({ ok: true, session_token: require('crypto').randomBytes(32).toString('hex') });
});

app.post('/auth/license', (_req, res) => {
    res.json({ ok: true, valid: true, expires: Date.now() + 86400000 });
});

// ── POST /auth/heartbeat — REAL: JWT re-validation ──────────────────────────
// Called periodically by script2 (every ~5 min recommended).
// Checks: JWT signature, expiry, jti blacklist, whitelist.
// Returns { ok: false } if any check fails → script2 should stop running.
// This means a banned/revoked player is cut off within one heartbeat interval
// instead of waiting for the 7-day JWT expiry.
app.post('/auth/heartbeat', async (req, res) => {
    try {
        const bearer = req.headers.authorization ?? '';
        const token  = bearer.startsWith('Bearer ') ? bearer.slice(7) : null;
        if (!token) return res.json({ ok: false, reason: 'No token' });

        let payload;
        try { payload = jwt.verify(token, JWT_SECRET); }
        catch (e) { return res.json({ ok: false, reason: 'Invalid token' }); }

        // Check jti blacklist
        if (payload.jti) {
            const revoked = await db.isJtiRevoked(payload.jti);
            if (revoked) {
                console.warn(`[HEARTBEAT] Revoked jti=${payload.jti.slice(0,8)}… for player=${payload.player_id}`);
                return res.json({ ok: false, reason: 'Token revoked' });
            }
        }

        // Check still whitelisted
        const allowed = await db.isPlayerWhitelisted(String(payload.player_id), String(payload.world_id));
        if (!allowed) {
            console.warn(`[HEARTBEAT] Player ${payload.player_id} no longer whitelisted`);
            return res.json({ ok: false, reason: 'Access revoked' });
        }

        const next_ping = 5 * 60 * 1000 + Math.floor(Math.random() * 30000); // ~5 min
        return res.json({ ok: true, next_ping });

    } catch (e) {
        console.error('[HEARTBEAT] Error:', e);
        return res.json({ ok: false, reason: 'Server error' });
    }
});

app.post('/auth/verify_checksum', (_req, res) => {
    res.json({ ok: true, valid: true, version: '2.1.4' });
});

app.post('/config/fetch', (_req, res) => {
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
