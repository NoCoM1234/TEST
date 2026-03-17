'use strict';

const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');

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
    await _db.collection('whitelist').createIndex({ player_id: 1, world_id: 1 }, { unique: true });
    await _db.collection('activations').createIndex({ player_id: 1, world_id: 1 });
    await _db.collection('auth_tokens').createIndex({ player_id: 1, world_id: 1 }, { unique: true });
    await _db.collection('integrity_hashes').createIndex({ type: 1 }, { unique: true });
    await _db.collection('town_data').createIndex({ player_id: 1, world_id: 1 }, { unique: true });
    await _db.collection('town_data').createIndex({ world_id: 1 });
    await _db.collection('town_data').createIndex({ 'towns.id': 1 });
    await _db.collection('world_data').createIndex({ world_id: 1 }, { unique: true });
    await _db.collection('world_meta').createIndex({ world_id: 1 }, { unique: true });

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

async function upsertWorldData(world_id, towns, islands) {
    const db = await getDb();
    await db.collection('world_data').updateOne(
        { world_id },
        { $set: { world_id, towns, islands, updated_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
}

async function getWorldData(world_id) {
    const db = await getDb();
    return db.collection('world_data').findOne({ world_id }, { projection: { _id: 0 } });
}

async function upsertWorldMeta(world_id, players, alliances) {
    const db = await getDb();
    await db.collection('world_meta').updateOne(
        { world_id },
        { $set: { world_id, players, alliances, updated_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
}

async function getWorldMeta(world_id) {
    const db = await getDb();
    return db.collection('world_meta').findOne({ world_id }, { projection: { _id: 0 } });
}

// ── Town Ownership ────────────────────────────────────────────────────────────
// Checks the world_data snapshot to confirm a town_id belongs to a player_id.
// World data format: towns array of [town_id, player_id, name, island_x, island_y, slot, points]
// Used by /watcher/results to cross-check the Watcher's live report against DB.

async function isTownOwnedBy(town_id, player_id, world_id) {
    const db  = await getDb();
    const row = await db.collection('world_data').findOne(
        { world_id },
        { projection: { _id: 0, towns: 1 } }
    );
    if (!row?.towns) return false;
    // towns[0] = town_id, towns[1] = player_id
    return row.towns.some(
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

// ── Startup ───────────────────────────────────────────────────────────────────
getDb().catch(err => console.error('[DB] Connection failed:', err));
setInterval(cleanupStale, 86400000);

module.exports = {
    upsertPlayer,
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
    upsertWorldMeta,
    getWorldMeta,
    // ── New: watcher system ──────────────────────────────────────────────────
    isTownOwnedBy,
    queueWatcherTask,
    getPendingWatcherTasks,
    resolveWatcherTask,
    getWatcherTaskStatus,
};
