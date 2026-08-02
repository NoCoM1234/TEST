'use strict';

// ── Shared temple spells ──────────────────────────────────────────────────────
// One document per (world_id, movement_id). Every successful cast is $push-ed
// onto `powers` with the caster's identity, so two players casting on the same
// command in the same second cannot clobber each other — no read-modify-write.
//
// A command vanishes from the game when it lands, so the document carries an
// expires_at of arrival + grace and MongoDB's TTL monitor reaps it. Commands
// whose arrival was never resolved fall back to a flat 7-day expiry.
//
// Kept in its own module so database.js and server.js each need a one-line
// change. Indexes are created lazily on first use rather than in getDb().

const { getDb } = require('./database');

const SPELL_MAX_PER_COMMAND = 24;
const SPELL_GRACE_SECONDS   = 6 * 3600;
const SPELL_FALLBACK_TTL    = 7 * 24 * 3600;
const MAX_IDS_PER_BATCH     = 500;

let _indexes = null;

async function ensureIndexes() {
    if (_indexes) return _indexes;
    _indexes = (async () => {
        const db  = await getDb();
        const col = db.collection('temple_spells');
        await col.createIndex({ world_id: 1, movement_id: 1 }, { unique: true });
        await col.createIndex({ world_id: 1, arrival: 1 });
        // TTL: expires_at is a Date, so Mongo drops landed commands by itself
        await col.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
        console.log('[spells] indexes ready');
    })().catch(err => {
        _indexes = null;          // let a later call retry
        throw err;
    });
    return _indexes;
}

async function recordTempleSpell(data) {
    await ensureIndexes();
    const db  = await getDb();
    const now = Math.floor(Date.now() / 1000);

    const world_id    = String(data.world_id);
    const movement_id = String(data.movement_id);
    const arrival     = Number(data.arrival) || 0;

    const entry = {
        power_id: String(data.power_id),
        by_id:    String(data.player_id || ''),
        by_name:  data.player_name || '',
        cast_at:  Number(data.cast_at) || now,
    };

    const set      = { world_id, movement_id, updated_at: now };
    const onInsert = { created_at: now };

    if (arrival) {
        set.arrival    = arrival;
        set.expires_at = new Date((arrival + SPELL_GRACE_SECONDS) * 1000);
    } else {
        // Only on insert: never downgrade a real arrival-based expiry to the
        // fallback just because a later cast could not resolve the arrival.
        onInsert.expires_at = new Date((now + SPELL_FALLBACK_TTL) * 1000);
    }
    if (data.temple_id) set.temple_id = String(data.temple_id);

    await db.collection('temple_spells').updateOne(
        { world_id, movement_id },
        {
            $set:         set,
            $setOnInsert: onInsert,
            $push: { powers: { $each: [entry], $slice: -SPELL_MAX_PER_COMMAND } },
        },
        { upsert: true }
    );

    return db.collection('temple_spells').findOne(
        { world_id, movement_id },
        { projection: { _id: 0, expires_at: 0 } }
    );
}

async function getTempleSpells(world_id, movement_ids) {
    await ensureIndexes();
    const db  = await getDb();
    const ids = movement_ids.map(String);

    const rows = await db.collection('temple_spells')
        .find(
            { world_id: String(world_id), movement_id: { $in: ids } },
            { projection: { _id: 0, world_id: 0, expires_at: 0 } }
        )
        .toArray();

    const out = {};
    for (const r of rows) out[r.movement_id] = r;
    return out;
}

// ── Routes ────────────────────────────────────────────────────────────────────
// verifyHmac and bad() live in server.js, so they are passed in rather than
// duplicated here.

function mountSpellRoutes(app, deps) {
    const { verifyHmac, bad } = deps;

    // Signed. verifyHmac reads identity from body.id + body.world, so the
    // client must send both. Without a signature anyone could write fake
    // casts into a log the whole alliance trusts.
    app.post('/spells/cast', verifyHmac, async (req, res) => {
        const b = req.body || {};
        const world_id  = String(b.world || b.world_id || '');
        const player_id = String(b.id    || b.player_id || '');

        if (!b.movement_id) return bad(res, 'Missing movement_id');
        if (!b.power_id)    return bad(res, 'Missing power_id');

        try {
            const spell = await recordTempleSpell({
                world_id,
                player_id,
                player_name: b.player_name || '',
                movement_id: b.movement_id,
                power_id:    b.power_id,
                cast_at:     b.cast_at,
                arrival:     b.arrival,
                temple_id:   b.temple_id,
            });
            return res.json({ ok: true, spell });
        } catch (err) {
            console.error('[spells] cast failed:', err);
            return bad(res, 'Could not record cast', 500);
        }
    });

    // Unsigned, matching /towns/batch. Add verifyHmac here if you would rather
    // reads be authenticated too — the client already sends id + world.
    app.post('/spells/batch', async (req, res) => {
        const { world, ids } = req.body || {};
        if (!world) return bad(res, 'Missing world');
        if (!Array.isArray(ids) || ids.length === 0) {
            return bad(res, 'Body must have ids array');
        }
        if (ids.length > MAX_IDS_PER_BATCH) {
            return bad(res, `Max ${MAX_IDS_PER_BATCH} ids per request`);
        }

        try {
            const spells = await getTempleSpells(world, ids);
            return res.json({ ok: true, spells });
        } catch (err) {
            console.error('[spells] batch failed:', err);
            return bad(res, 'Could not read spells', 500);
        }
    });

    console.log('[spells] routes mounted: POST /spells/cast, POST /spells/batch');
}

module.exports = {
    mountSpellRoutes,
    recordTempleSpell,
    getTempleSpells,
};
