'use strict';

const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
let   _db       = null;

async function getDb() {
    if (_db) return _db;
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    _db = client.db('Master');
    console.log('[DB] MongoDB connected');

    // ── Indexes ──────────────────────────────────────────────────────────────
    await _db.collection('players').createIndex({ id: 1, world: 1 }, { unique: true });
    await _db.collection('players').createIndex({ world: 1 });
    await _db.collection('requests').createIndex({ world: 1, expires_at: 1 });
    await _db.collection('whitelist').createIndex({ player_id: 1 }, { unique: true });

    return _db;
}

// ── Players ───────────────────────────────────────────────────────────────────

async function upsertPlayer(data) {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    await db.collection('players').updateOne(
        { id: data.id, world: data.world },
        { $set: {
            name:          data.name,
            alliance:      data.alliance      || '',
            cultural_level:data.cultural_level || 0,
            town_count:    data.town_count     || 0,
            current_cp:    data.current_cp     || 0,
            next_level_cp: data.next_level_cp  || 0,
            troops:        data.troops,
            towns_data:    data.towns_data,
            status:        data.status         || 3,
            status_at:     now,
            pushed_at:     now,
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
    const db = await getDb();
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
    const db  = await getDb();
    const cutoff = Math.floor(Date.now() / 1000) - 604800; // 7 days
    const r = await db.collection('players').deleteMany({ pushed_at: { $lt: cutoff } });
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
    // Convert _id to id for client compatibility
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
    await db.collection('requests').deleteOne(
        { _id: new ObjectId(id), player_id }
    );
}

async function deleteExpiredRequests() {
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);
    const r   = await db.collection('requests').deleteMany({ expires_at: { $lte: now } });
    if (r.deletedCount > 0) console.log(`[DB] Deleted ${r.deletedCount} expired request(s)`);
}

// ── Whitelist ─────────────────────────────────────────────────────────────────

async function isPlayerWhitelisted(player_id) {
    const db  = await getDb();
    const row = await db.collection('whitelist').findOne({ player_id: String(player_id) });
    return !!row;
}

async function addToWhitelist(player_id, note) {
    const db = await getDb();
    await db.collection('whitelist').updateOne(
        { player_id: String(player_id) },
        { $set: { player_id: String(player_id), note: note || '', added_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );
}

async function removeFromWhitelist(player_id) {
    const db = await getDb();
    await db.collection('whitelist').deleteOne({ player_id: String(player_id) });
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

async function claimActivation(player_id, world_id, wood, stone, iron, origin_player_id) {
    const db  = await getDb();
    const act = await db.collection('activations').findOne({
        player_id, world_id, wood, stone, iron,
        origin_player_id: String(origin_player_id), // must match registered sender
        used: false,
    });
    if (!act) return null;

    const crypto = require('crypto');
    const token  = crypto.randomBytes(48).toString('hex');

    await db.collection('activations').updateOne(
        { _id: act._id },
        { $set: { used: true, token, activated_at: Math.floor(Date.now() / 1000) } }
    );

    await db.collection('auth_tokens').updateOne(
        { player_id, world_id },
        { $set: { player_id, world_id, token, created_at: Math.floor(Date.now() / 1000) } },
        { upsert: true }
    );

    return token;
}

async function verifyToken(player_id, world_id, token) {
    const db  = await getDb();
    const row = await db.collection('auth_tokens').findOne({ player_id, world_id, token });
    return !!row;
}

async function revokeToken(player_id, world_id) {
    const db = await getDb();
    await db.collection('auth_tokens').deleteOne({ player_id, world_id });
    await db.collection('activations').deleteMany({ player_id, world_id });
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
};
