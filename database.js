'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');
const zlib   = require('zlib');

const MONGO_URI = process.env.MONGO_URI;
let   _db       = null;

async function getDb() {
    if (_db) return _db;
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    _db = client.db('Master');
    console.log('[DB] MongoDB connected');

    await _db.collection('players').createIndex({ id: 1, world: 1 }, { unique: true });
    await _db.collection('players').createIndex({ world: 1 });
    await _db.collection('requests').createIndex({ world: 1, expires_at: 1 });

    // Drop any stale single-field unique index on player_id so that the same
    // player can be whitelisted across multiple worlds. The correct compound
    // index { player_id, world_id } is created immediately after.
    try {
        await _db.collection('whitelist').dropIndex('player_id_1');
        console.log('[DB] Dropped stale whitelist index player_id_1');
    } catch (_) { /* index did not exist — nothing to do */ }

    await _db.collection('whitelist').createIndex({ player_id: 1, world_id: 1 }, { unique: true });
    await _db.collection('activations').createIndex({ player_id: 1, world_id: 1 });
    await _db.collection('auth_tokens').createIndex({ player_id: 1, world_id: 1 }, { unique: true });
    await _db.collection('integrity_hashes').createIndex({ type: 1 }, { unique: true });
    await _db.collection('town_data').createIndex({ player_id: 1, world_id: 1 }, { unique: true });
    await _db.collection('town_data').createIndex({ world_id: 1 });
    await _db.collection('town_data').createIndex({ 'towns.id': 1 });
    await _db.collection('world_data').createIndex({ world_id: 1 }, { unique: true });
    await _db.collection('world_meta').createIndex({ world_id: 1 }, { unique: true });
    await _db.collection('world_wonders').createIndex({ world_id: 1 }, { unique: true });
    await _db.collection('world_temples').createIndex({ world_id: 1 }, { unique: true });
    // History: one entry per world per UTC day (keyframe or diff)
    await _db.collection('world_history').createIndex({ world_id: 1, date: 1 }, { unique: true });
    await _db.collection('jwt_blacklist').createIndex({ jti: 1 }, { unique: true });
    // TTL index: MongoDB auto-deletes expired blacklist entries (expires_at is a Date)
    await _db.collection('jwt_blacklist').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

    // ── Watcher task queue ────────────────────────────────────────────────────
    // Stores pending town-rename verification tasks for the watcher account.
    // challenge_token is unique — one open task per challenge at a time.
    // expires_at index allows MongoDB to auto-expire documents (TTL index).
    await _db.collection('watcher_tasks').createIndex(
        { challenge_token: 1 }, { unique: true }
    );
    await _db.collection('watcher_tasks').createIndex(
        { status: 1 }
    );
    await _db.collection('watcher_tasks').createIndex(
        // TTL: MongoDB auto-deletes documents 2 hours after expires_at
        { expires_at: 1 }, { expireAfterSeconds: 7200 }
    );

    return _db;
}

// ── XOR helper ────────────────────────────────────────────────────────────────
function xorHex(a, b) {
    let result = '';
    for (let i = 0; i < a.length; i++) {
        result += (parseInt(a[i], 16) ^ parseInt(b[i % b.length], 16)).toString(16);
    }
    return result;
}

// ── Players ───────────────────────────────────────────────────────────────────

async function upsertPlayer(data) {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    await db.collection('players').updateOne(
        { id: data.id, world: data.world },
        { $set: {
            name:           data.name,
            alliance:       data.alliance       || '',
            cultural_level: data.cultural_level || 0,
            town_count:     data.town_count      || 0,
            current_cp:     data.current_cp      || 0,
            next_level_cp:  data.next_level_cp   || 0,
            troops:         data.troops,
            troops_in:      data.troops_in  || '{}',
            troops_out:     data.troops_out || '{}',
            towns_data:     data.towns_data,
            status:         data.status          || 3,
            status_at:      now,
            pushed_at:      now,
        }},
        { upsert: true }
    );
}

async function getTradesForTown(world_id, town_id) {
    const db   = await getDb();
    const rows = await db.collection('town_data')
        .find({ world_id: String(world_id) },
              { projection: { _id: 0, trades: 1 } })
        .toArray();
    const result = [];
    for (const row of rows) {
        for (const t of (row.trades || [])) {
            if (String(t.destination_town_id) === String(town_id)) {
                result.push(t);
            }
        }
    }
    return result;
}
async function updatePlayerStatus(id, world, status) {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    await db.collection('players').updateOne(
        { id, world },
        { $set: { status, status_at: now } }
    );
}

async function getPlayersByWorld(world) {
    const db   = await getDb();
    const rows = await db.collection('players')
        .find({ world }, { projection: { _id: 0, towns_data: 0 } })
        .sort({ name: 1 })
        .toArray();
    return rows;
}

async function getPlayerTowns(world, playerId) {
    const db  = await getDb();
    const row = await db.collection('players').findOne(
        { id: playerId, world },
        { projection: { _id: 0, towns_data: 1 } }
    );
    if (!row) return null;
    try { return typeof row.towns_data === 'string' ? JSON.parse(row.towns_data) : row.towns_data; }
    catch { return []; }
}

async function cleanupStale() {
    const db     = await getDb();
    const cutoff = Math.floor(Date.now() / 1000) - 604800;
    const r      = await db.collection('players').deleteMany({ pushed_at: { $lt: cutoff } });
    if (r.deletedCount > 0) console.log(`[DB] Cleaned up ${r.deletedCount} stale player(s)`);
}

// ── Requests ──────────────────────────────────────────────────────────────────

async function pushRequest(data) {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    const result = await db.collection('requests').insertOne({
        ...data,
        fulfilled:  0,
        created_at: now,
    });
    return { lastInsertId: result.insertedId.toString() };
}

async function getRequests(world) {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    const rows = await db.collection('requests')
        .find({ world, expires_at: { $gt: now } })
        .sort({ created_at: -1 })
        .toArray();
    return rows.map(r => ({ ...r, id: r._id.toString(), _id: undefined }));
}

async function fulfillRequest(id) {
    const db = await getDb();
    await db.collection('requests').updateOne(
        { _id: new ObjectId(id) },
        { $set: { fulfilled: 1 } }
    );
}

async function deleteRequest(id, player_id) {
    const db = await getDb();
    await db.collection('requests').deleteOne({ _id: new ObjectId(id), player_id });
}

async function deleteExpiredRequests() {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    const r   = await db.collection('requests').deleteMany({ expires_at: { $lte: now } });
    if (r.deletedCount > 0) console.log(`[DB] Deleted ${r.deletedCount} expired request(s)`);
}

// ── Whitelist ─────────────────────────────────────────────────────────────────

async function isPlayerWhitelisted(player_id, world_id) {
    const db  = await getDb();
    const row = await db.collection('whitelist').findOne({
        player_id: String(player_id),
        world_id:  String(world_id),
    });
    return !!row;
}

async function addToWhitelist(player_id, world_id) {
    const db = await getDb();
    await db.collection('whitelist').updateOne(
        { player_id: String(player_id), world_id: String(world_id) },
        { $set: {
            player_id:  String(player_id),
            world_id:   String(world_id),
            added_at:   Math.floor(Date.now() / 1000),
        }},
        { upsert: true }
    );
}

async function removeFromWhitelist(player_id, world_id) {
    const db = await getDb();
    await db.collection('whitelist').deleteOne({
        player_id: String(player_id),
        world_id:  String(world_id),
    });
}

async function getWhitelist() {
    const db = await getDb();
    return db.collection('whitelist').find({}, { projection: { _id: 0 } }).sort({ added_at: 1 }).toArray();
}

// ── Auth / Activations ────────────────────────────────────────────────────────

async function registerActivation(data) {
    const db = await getDb();
    await db.collection('activations').deleteOne({
        player_id: data.player_id,
        world_id:  data.world_id,
        used:      false,
    });
    await db.collection('activations').insertOne({
        player_id:        data.player_id,
        world_id:         data.world_id,
        wood:             data.wood,
        stone:            data.stone,
        iron:             data.iron,
        origin_player_id: data.origin_player_id,
        used:             false,
        token:            null,
        created_at:       Math.floor(Date.now() / 1000),
    });
}

async function claimActivation(player_id, world_id, wood, stone, iron, origin_player_id, part_b) {
    const db  = await getDb();
    const act = await db.collection('activations').findOne({
        player_id,
        world_id,
        wood,
        stone,
        iron,
        origin_player_id: String(origin_player_id),
        used: false,
    });
    if (!act) return null;

    const token  = crypto.randomBytes(48).toString('hex');
    const part_c = crypto.randomBytes(48).toString('hex');
    const part_a = xorHex(xorHex(token, part_b), part_c);

    await db.collection('activations').updateOne(
        { _id: act._id },
        { $set: { used: true, activated_at: Math.floor(Date.now() / 1000) } }
    );

    await db.collection('auth_tokens').updateOne(
        { player_id, world_id },
        { $set: { player_id, world_id, token, part_c, created_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );

    return part_a;
}

async function verifyToken(player_id, world_id, part_a_xor_b) {
    const db  = await getDb();
    const row = await db.collection('auth_tokens').findOne({ player_id, world_id });
    if (!row) return false;
    const reconstructed = xorHex(part_a_xor_b, row.part_c);
    return reconstructed === row.token;
}

async function getAuthToken(player_id, world_id) {
    const db = await getDb();
    return db.collection('auth_tokens').findOne({ player_id, world_id });
}

async function revokeToken(player_id, world_id) {
    const db = await getDb();
    await db.collection('auth_tokens').deleteOne({ player_id, world_id });
    await db.collection('activations').deleteMany({ player_id, world_id });
}

async function refreshToken(player_id, world_id, new_part_b) {
    const db  = await getDb();
    const row = await db.collection('auth_tokens').findOne({ player_id, world_id });
    if (!row) return null;

    const new_part_c = crypto.randomBytes(48).toString('hex');
    const new_part_a = xorHex(xorHex(row.token, new_part_b), new_part_c);

    await db.collection('auth_tokens').updateOne(
        { player_id, world_id },
        { $set: { part_c: new_part_c, updated_at: Math.floor(Date.now() / 1000) } }
    );

    return new_part_a;
}

// ── Integrity Hashes ──────────────────────────────────────────────────────────

async function getIntegrityHash(type) {
    const db  = await getDb();
    const row = await db.collection('integrity_hashes').findOne({ type });
    return row?.hash || null;
}

async function setIntegrityHash(type, hash) {
    const db = await getDb();
    await db.collection('integrity_hashes').updateOne(
        { type },
        { $set: { type, hash, updated_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
}

async function deleteIntegrityHash(type) {
    const db = await getDb();
    await db.collection('integrity_hashes').deleteOne({ type });
}

async function getScript(name) {
    const db  = await getDb();
    const row = await db.collection('scripts').findOne({ name });
    return row?.content || null;
}

async function setScript(name, content) {
    const db = await getDb();
    await db.collection('scripts').updateOne(
        { name },
        { $set: { name, content, updated_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
}

// ── Town Data ─────────────────────────────────────────────────────────────────

async function pushTownData(data) {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    await db.collection('town_data').updateOne(
        { player_id: data.player_id, world_id: data.world_id },
        { $set: {
            player_id:     data.player_id,
            player_name:   data.player_name,
            world_id:      data.world_id,
            alliance_id:   data.alliance_id,
            alliance_name: data.alliance_name,
            favors:        data.favors,
            towns:         data.towns,
            trades:        data.trades || [],
            updated_at:    now,
        }},
        { upsert: true }
    );
}

async function getTownDataByTownId(world_id, town_id) {
    const db  = await getDb();
    const row = await db.collection('town_data').findOne(
        { world_id, 'towns.id': String(town_id) },
        { projection: { _id: 0 } }
    );
    if (!row) return null;
    const town = row.towns.find(t => t.id === String(town_id));
    if (!town) return null;
    return {
        player_id:     row.player_id,
        player_name:   row.player_name,
        alliance_id:   row.alliance_id,
        alliance_name: row.alliance_name,
        favors:        row.favors,
        updated_at:    row.updated_at,
        town,
    };
}

// ── World Data ────────────────────────────────────────────────────────────────
// towns/islands are stored gzip-compressed (towns_gz / islands_gz) — ~10x
// smaller than the raw arrays. Readers transparently accept BOTH the old raw
// format and the compressed one, so legacy documents (e.g. closed historic
// worlds) keep working until migrated. See migrate_world_data.js.

function unpackWorldField(row, name) {
    if (!row) return [];
    if (row[name + '_gz']) return gunzJson(row[name + '_gz']);
    return row[name] || [];
}

async function upsertWorldData(world_id, towns, islands) {
    const db = await getDb();
    await db.collection('world_data').updateOne(
        { world_id },
        {
            $set: {
                world_id,
                towns_gz:   gzJson(towns),
                islands_gz: gzJson(islands),
                updated_at: Math.floor(Date.now() / 1000),
            },
            // remove legacy raw arrays if this doc predates compression
            $unset: { towns: '', islands: '' },
        },
        { upsert: true }
    );
}

// Returns the same shape callers always got: { world_id, towns, islands, updated_at }
async function getWorldData(world_id) {
    const db  = await getDb();
    const row = await db.collection('world_data').findOne({ world_id }, { projection: { _id: 0 } });
    if (!row) return null;
    return {
        world_id:   row.world_id,
        towns:      unpackWorldField(row, 'towns'),
        islands:    unpackWorldField(row, 'islands'),
        updated_at: row.updated_at,
    };
}

// Server-side one-time migration for POST /admin/migrate-world-data.
// Converts legacy raw towns/islands documents to the compressed format.
// Idempotent: already-compressed documents are skipped. Processes one
// document at a time to keep memory low on small hosts.
async function migrateWorldDataCompression() {
    const db  = await getDb();
    const col = db.collection('world_data');
    const results = [];
    const cursor = col.find({}, { projection: { world_id: 1, towns: 1, islands: 1 } });
    for await (const doc of cursor) {
        const hasRaw = Array.isArray(doc.towns) || Array.isArray(doc.islands);
        if (!hasRaw) {
            results.push({ world_id: doc.world_id, status: 'already-compressed' });
            continue;
        }
        const towns   = doc.towns   || [];
        const islands = doc.islands || [];
        const rawBytes   = JSON.stringify(towns).length + JSON.stringify(islands).length;
        const towns_gz   = gzJson(towns);
        const islands_gz = gzJson(islands);
        await col.updateOne(
            { _id: doc._id },
            { $set: { towns_gz, islands_gz }, $unset: { towns: '', islands: '' } }
        );
        results.push({
            world_id: doc.world_id,
            status:   'migrated',
            raw_mb:   +(rawBytes / 1048576).toFixed(2),
            gz_mb:    +((towns_gz.length + islands_gz.length) / 1048576).toFixed(2),
            towns:    towns.length,
        });
    }
    return results;
}

// List every world that has map data, with its end-game type (from world_meta).
async function getWorldList() {
    const db = await getDb();
    const rows = await db.collection('world_data')
        .find({}, { projection: { _id: 0, world_id: 1, updated_at: 1 } })
        .toArray();
    const metas = await db.collection('world_meta')
        .find({}, { projection: { _id: 0, world_id: 1, 'world_settings.End Game Type Key': 1 } })
        .toArray();
    const typeByWorld = {};
    for (const m of metas) typeByWorld[m.world_id] = m.world_settings?.['End Game Type Key'] || null;
    return rows
        .map(r => ({ world_id: r.world_id, end_game_type: typeByWorld[r.world_id] || null, updated_at: r.updated_at || 0 }))
        .sort((a, b) => String(a.world_id).localeCompare(String(b.world_id)));
}

// AFTER:
async function upsertWorldMeta(world_id, players, alliances, world_settings = {}) {
    const db = await getDb();
    await db.collection('world_meta').updateOne(
        { world_id },
        { $set: { world_id, players, alliances, world_settings, updated_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
}
 

async function getWorldMeta(world_id) {
    const db = await getDb();
    return db.collection('world_meta').findOne({ world_id }, { projection: { _id: 0 } });
}

// ── World Wonders ─────────────────────────────────────────────────────────────

async function upsertWorldWonders(world_id, wonders) {
    const db = await getDb();
    await db.collection('world_wonders').updateOne(
        { world_id },
        { $set: { world_id, wonders, updated_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
}

async function getWorldWonders(world_id) {
    const db  = await getDb();
    const row = await db.collection('world_wonders').findOne(
        { world_id },
        { projection: { _id: 0, wonders: 1 } }
    );
    return row?.wonders || null;
}

// ── World Temples (Olympus end-game) ──────────────────────────────────────────
// Temples are stored as a flat array. Each push MERGES by temple id so that
// scraping Small and Large tabs separately doesn't wipe the other batch.

async function upsertWorldTemples(world_id, temples) {
    const db  = await getDb();
    const row = await db.collection('world_temples').findOne(
        { world_id },
        { projection: { _id: 0, temples: 1 } }
    );

    // Build a map of existing temples keyed by id, then overwrite with new batch
    const existing = new Map((row?.temples || []).map(t => [t.id, t]));
    for (const t of temples) existing.set(t.id, t);
    const merged = [...existing.values()];

    await db.collection('world_temples').updateOne(
        { world_id },
        { $set: { world_id, temples: merged, updated_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
    return merged.length;
}

async function getWorldTemples(world_id) {
    const db  = await getDb();
    const row = await db.collection('world_temples').findOne(
        { world_id },
        { projection: { _id: 0, temples: 1 } }
    );
    return row?.temples || null;
}

// ── Town Ownership ────────────────────────────────────────────────────────────
// Checks the world_data snapshot to confirm a town_id belongs to a player_id.
// World data format: towns array of [town_id, player_id, name, island_x, island_y, slot, points]
// Used by /watcher/results to cross-check the Watcher's live report against DB.

async function isTownOwnedBy(town_id, player_id, world_id) {
    const db  = await getDb();
    const row = await db.collection('world_data').findOne(
        { world_id },
        { projection: { _id: 0, towns: 1, towns_gz: 1 } }
    );
    const towns = unpackWorldField(row, 'towns');
    if (!towns.length) return false;
    // towns[0] = town_id, towns[1] = player_id
    return towns.some(
        t => String(t[0]) === String(town_id) && String(t[1]) === String(player_id)
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── WATCHER TASK QUEUE ────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
//
// Schema for a watcher_task document:
// {
//   challenge_token: string  — links back to the in-memory challenge
//   town_id:         string  — town the user claims to have renamed
//   world_id:        string  — which Grepolis world (e.g. "en100")
//   expected_code:   string  — the challenge code (e.g. "V-8X4K")
//   player_id:       string  — claimed owner
//   status:          'pending' | 'verified' | 'failed'
//   reason:          string | null
//   created_at:      unix seconds
//   expires_at:      Date object (used by MongoDB TTL index)
// }
// ─────────────────────────────────────────────────────────────────────────────

async function queueWatcherTask({ challenge_token, town_id, world_id, expected_code, player_id }) {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    // expires_at must be a Date for MongoDB TTL index to work
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.collection('watcher_tasks').updateOne(
        { challenge_token },
        { $set: {
            challenge_token,
            town_id:       String(town_id),
            world_id:      String(world_id),
            expected_code: String(expected_code),
            player_id:     String(player_id),
            status:        'pending',
            reason:        null,
            created_at:    now,
            expires_at:    expiresAt,
        }},
        { upsert: true }
    );
}

// Returns all tasks currently in 'pending' status — sent to the Watcher script.
async function getPendingWatcherTasks() {
    const db = await getDb();
    return db.collection('watcher_tasks')
        .find({ status: 'pending' }, { projection: { _id: 0 } })
        .toArray();
}

// Called by /watcher/results after the Watcher checks a town.
// status: 'verified' | 'failed'
// reason: human-readable string (used for 'failed' tasks)
async function resolveWatcherTask(challenge_token, status, reason = null) {
    const db  = await getDb();
    await db.collection('watcher_tasks').updateOne(
        { challenge_token },
        { $set: {
            status,
            reason,
            resolved_at: Math.floor(Date.now() / 1000),
        }}
    );
}

// Called by /auth/verify-status — the client polls this to get their result.
async function getWatcherTaskStatus(challenge_token, player_id) {
    const db    = await getDb();
    // When player_id is null (called from /watcher/results which has no player
    // context), query by challenge_token only. String(null) === "null" which
    // would never match a real player_id and silently return nothing.
    const query = player_id != null
        ? { challenge_token, player_id: String(player_id) }
        : { challenge_token };
    return db.collection('watcher_tasks').findOne(query, { projection: { _id: 0 } });
}

// ═════════════════════════════════════════════════════════════════════════════
// ── WORLD HISTORY (time machine) ──────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
//
// Stores one entry per world per UTC day so the map renderer can scrub back in
// time. Storage is keyframe + deltas (like video compression):
//
//   type: 'keyframe' — full gzipped snapshot { towns, players, alliances }
//   type: 'diff'     — gzipped delta against the PREVIOUS RECORDED day
//
// Snapshots are stored in the exact /map/:worldId format the frontend already
// consumes (8-field town rows, players/alliances maps), so the client can
// apply diffs and reuse its existing parsing code unchanged.
//
// IMPORTANT: diffs chain against the last *recorded* history state, not the
// live world_data doc (which is refreshed every 3h). saveWorldHistory
// reconstructs the last recorded day before diffing — this keeps the chain
// consistent no matter how many intraday pushes happen.
//
// Islands are deliberately excluded — they never change.
// ─────────────────────────────────────────────────────────────────────────────

const KEYFRAME_INTERVAL_DAYS = 30;

function utcDateString(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function gzJson(obj) {
    return zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
}

function gunzJson(bin) {
    // Mongo driver returns a Binary object — .buffer is the underlying bytes
    const buf = Buffer.isBuffer(bin) ? bin : Buffer.from(bin.buffer);
    return JSON.parse(zlib.gunzipSync(buf).toString());
}

// ── Diff helpers ──────────────────────────────────────────────────────────────
// Town rows are arrays [id, player_id, name, island_x, island_y, off_x, off_y, slot]
// keyed by id (index 0). Changed entries store only { arrayIndex: newValue }.

function diffTownRows(oldRows, newRows) {
    const oldMap = new Map((oldRows || []).map(t => [String(t[0]), t]));
    const added = [], removed = [], changed = {};
    const seen = new Set();
    for (const t of (newRows || [])) {
        const id = String(t[0]);
        seen.add(id);
        const o = oldMap.get(id);
        if (!o) { added.push(t); continue; }
        const ch = {};
        const len = Math.max(t.length, o.length);
        for (let i = 1; i < len; i++) if (t[i] !== o[i]) ch[i] = t[i];
        if (Object.keys(ch).length) changed[id] = ch;
    }
    for (const id of oldMap.keys()) if (!seen.has(id)) removed.push(id);
    return { added, removed, changed };
}

// players: { id: [name, alliance_id, points] } — array values, per-index diff
// alliances: { id: name } — scalar values, whole-value diff
function diffKeyedMap(oldObj, newObj) {
    oldObj = oldObj || {}; newObj = newObj || {};
    const added = {}, removed = [], changed = {};
    for (const id in newObj) {
        if (!(id in oldObj)) { added[id] = newObj[id]; continue; }
        const o = oldObj[id], n = newObj[id];
        if (Array.isArray(n) && Array.isArray(o)) {
            const ch = {};
            const len = Math.max(n.length, o.length);
            for (let i = 0; i < len; i++) if (n[i] !== o[i]) ch[i] = n[i];
            if (Object.keys(ch).length) changed[id] = ch;
        } else if (n !== o) {
            changed[id] = n;
        }
    }
    for (const id in oldObj) if (!(id in newObj)) removed.push(id);
    return { added, removed, changed };
}

function diffSnapshots(oldSnap, newSnap) {
    return {
        towns:     diffTownRows(oldSnap.towns, newSnap.towns),
        players:   diffKeyedMap(oldSnap.players, newSnap.players),
        alliances: diffKeyedMap(oldSnap.alliances, newSnap.alliances),
    };
}

function diffIsEmpty(d) {
    const e = s => !s.added.length && !s.removed.length && !Object.keys(s.changed).length;
    const eo = s => !Object.keys(s.added).length && !s.removed.length && !Object.keys(s.changed).length;
    return e(d.towns) && eo(d.players) && eo(d.alliances);
}

// ── Apply helpers (server-side reconstruction) ────────────────────────────────

function applyTownsDiff(rows, d) {
    const map = new Map((rows || []).map(t => [String(t[0]), t]));
    for (const id of d.removed) map.delete(String(id));
    for (const id in d.changed) {
        const t = map.get(String(id));
        if (!t) continue;
        const copy = t.slice();
        for (const i in d.changed[id]) copy[Number(i)] = d.changed[id][i];
        map.set(String(id), copy);
    }
    for (const t of d.added) map.set(String(t[0]), t);
    return [...map.values()];
}

function applyKeyedDiff(obj, d) {
    const out = { ...(obj || {}) };
    for (const id of d.removed) delete out[id];
    for (const id in d.changed) {
        const ch = d.changed[id];
        if (Array.isArray(out[id]) && ch && typeof ch === 'object' && !Array.isArray(ch)) {
            const arr = out[id].slice();
            for (const i in ch) arr[Number(i)] = ch[i];
            out[id] = arr;
        } else {
            out[id] = ch;
        }
    }
    for (const id in d.added) out[id] = d.added[id];
    return out;
}

function applySnapshotDiff(state, diff) {
    return {
        towns:     applyTownsDiff(state.towns, diff.towns),
        players:   applyKeyedDiff(state.players, diff.players),
        alliances: applyKeyedDiff(state.alliances, diff.alliances),
    };
}

// Reconstruct the world state as of `date` (inclusive). Returns the state at
// the latest recorded day <= date, or null if history starts after `date`.
async function reconstructWorldAtDate(world_id, date) {
    const db  = await getDb();
    const col = db.collection('world_history');
    const kf  = await col.find({ world_id, type: 'keyframe', date: { $lte: date } })
        .sort({ date: -1 }).limit(1).toArray();
    if (!kf.length) return null;

    let state = gunzJson(kf[0].data);
    const diffs = await col.find({ world_id, type: 'diff', date: { $gt: kf[0].date, $lte: date } })
        .sort({ date: 1 })
        .toArray();
    for (const row of diffs) state = applySnapshotDiff(state, gunzJson(row.data));
    return state;
}

// Called from /admin/world-data after the live data has been updated.
// snapshot = { towns, players, alliances } in /map format.
// Records at most one entry per world per UTC day (first push of the day wins).
async function saveWorldHistory(world_id, snapshot) {
    const db   = await getDb();
    const col  = db.collection('world_history');
    const date = utcDateString();

    const existing = await col.findOne({ world_id, date }, { projection: { _id: 1 } });
    if (existing) return { saved: false, reason: 'already-recorded', date };

    const clean = {
        towns:     snapshot.towns     || [],
        players:   snapshot.players   || {},
        alliances: snapshot.alliances || {},
    };

    // Days since last keyframe decides keyframe vs diff
    const lastKf = await col.find({ world_id, type: 'keyframe', date: { $lt: date } })
        .sort({ date: -1 }).limit(1).toArray();

    let type, payload;
    if (!lastKf.length) {
        type = 'keyframe';
        payload = clean;
    } else {
        const daysSinceKf = Math.round((Date.parse(date) - Date.parse(lastKf[0].date)) / 86400000);
        if (daysSinceKf >= KEYFRAME_INTERVAL_DAYS) {
            type = 'keyframe';
            payload = clean;
        } else {
            const prevState = await reconstructWorldAtDate(world_id, date); // latest recorded < today
            if (!prevState) { type = 'keyframe'; payload = clean; }
            else {
                type = 'diff';
                payload = diffSnapshots(prevState, clean);
                // Still store empty diffs — they mark the day as recorded.
            }
        }
    }

    const data = gzJson(payload);
    try {
        await col.insertOne({
            world_id,
            date,
            type,
            data,
            gz_bytes:   data.length,
            created_at: Math.floor(Date.now() / 1000),
        });
    } catch (e) {
        if (e.code === 11000) return { saved: false, reason: 'already-recorded', date }; // race with parallel push
        throw e;
    }
    return { saved: true, date, type, bytes: data.length };
}

// List of recorded days (small — dates + types only), oldest first.
async function getHistoryDates(world_id) {
    const db   = await getDb();
    const rows = await db.collection('world_history')
        .find({ world_id }, { projection: { _id: 0, date: 1, type: 1, gz_bytes: 1 } })
        .sort({ date: 1 })
        .toArray();
    return rows;
}

// Range fetch for client-side scrubbing:
// returns { base: { date, state }, diffs: [step, ...] } covering [from, to].
// `base` is the reconstructed state at the latest recorded day <= from.
// Each step is { date, diff } OR { date, keyframe } — keyframes recorded
// mid-range are sent as full states the client swaps in wholesale, because
// the day after a keyframe chains against the keyframe, not the prior diff.
async function getHistoryRange(world_id, from, to) {
    const db  = await getDb();
    const col = db.collection('world_history');

    const kf = await col.find({ world_id, type: 'keyframe', date: { $lte: from } })
        .sort({ date: -1 }).limit(1).toArray();

    // If no keyframe before `from`, fall back to the earliest keyframe
    const anchor = kf.length
        ? kf[0]
        : (await col.find({ world_id, type: 'keyframe' }).sort({ date: 1 }).limit(1).toArray())[0];
    if (!anchor) return null;

    let baseState = gunzJson(anchor.data);
    let baseDate  = anchor.date;

    const rows = await col.find({ world_id, date: { $gt: anchor.date, $lte: to } })
        .sort({ date: 1 })
        .toArray();

    // Fold steps up to `from` into the base so the client only holds
    // [from, to]; keep the rest as individual scrub steps.
    const diffs = [];
    for (const row of rows) {
        const payload = gunzJson(row.data);
        if (row.date <= from) {
            baseState = row.type === 'keyframe' ? payload : applySnapshotDiff(baseState, payload);
            baseDate  = row.date;
        } else if (row.type === 'keyframe') {
            diffs.push({ date: row.date, keyframe: payload });
        } else {
            diffs.push({ date: row.date, diff: payload });
        }
    }
    return { base: { date: baseDate, state: baseState }, diffs };
}

// ── JWT Blacklist ─────────────────────────────────────────────────────────────
// Revoked JTIs are stored here so tokens can be killed before natural expiry.
// MongoDB TTL index auto-cleans entries once the original token would have expired.

async function revokeJti(jti, player_id, world_id, exp) {
    const db = await getDb();
    // exp is the JWT exp claim (unix seconds) — convert to Date for TTL index
    await db.collection('jwt_blacklist').updateOne(
        { jti },
        { $set: {
            jti,
            player_id:  String(player_id),
            world_id:   String(world_id),
            expires_at: new Date(exp * 1000),
            revoked_at: new Date(),
        }},
        { upsert: true }
    );
}

async function isJtiRevoked(jti) {
    const db  = await getDb();
    const row = await db.collection('jwt_blacklist').findOne({ jti });
    return !!row;
}

// ── Startup ───────────────────────────────────────────────────────────────────
getDb().catch(err => console.error('[DB] Connection failed:', err));
setInterval(cleanupStale, 86400000);

module.exports = {
    upsertPlayer,
    getTradesForTown,
    updatePlayerStatus,
    getPlayersByWorld,
    getPlayerTowns,
    pushRequest,
    getRequests,
    fulfillRequest,
    deleteRequest,
    deleteExpiredRequests,
    isPlayerWhitelisted,
    addToWhitelist,
    removeFromWhitelist,
    getWhitelist,
    registerActivation,
    claimActivation,
    verifyToken,
    revokeToken,
    refreshToken,
    getAuthToken,
    getIntegrityHash,
    setIntegrityHash,
    deleteIntegrityHash,
    getScript,
    setScript,
    pushTownData,
    getTownDataByTownId,
    upsertWorldData,
    getWorldData,
    getWorldList,
    upsertWorldMeta,
    getWorldMeta,
    upsertWorldWonders,
    getWorldWonders,
    upsertWorldTemples,
    getWorldTemples,
    migrateWorldDataCompression,
    // ── World history (time machine) ───────────────────────────────────────────
    saveWorldHistory,
    getHistoryDates,
    getHistoryRange,
    reconstructWorldAtDate,
    // ── JWT blacklist ──────────────────────────────────────────────────────────
    revokeJti,
    isJtiRevoked,
    // ── New: watcher system ──────────────────────────────────────────────────
    isTownOwnedBy,
    queueWatcherTask,
    getPendingWatcherTasks,
    resolveWatcherTask,
    getWatcherTaskStatus,
};
