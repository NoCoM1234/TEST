'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS players (
        id             TEXT NOT NULL,
        world          TEXT NOT NULL,
        name           TEXT NOT NULL,
        alliance       TEXT NOT NULL DEFAULT '',
        cultural_level INTEGER NOT NULL DEFAULT 0,
        town_count     INTEGER NOT NULL DEFAULT 0,
        current_cp     INTEGER NOT NULL DEFAULT 0,
        next_level_cp  INTEGER NOT NULL DEFAULT 0,
        troops         TEXT NOT NULL DEFAULT '{}',
        towns_data     TEXT NOT NULL DEFAULT '[]',
        pushed_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (id, world)
    );
`);

// Migration: add towns_data column if it doesn't exist yet (for existing DBs)
try {
    db.exec(`ALTER TABLE players ADD COLUMN towns_data TEXT NOT NULL DEFAULT '[]';`);
    console.log('[DB] Migrated: added towns_data column');
} catch (_) { /* column already exists — ignore */ }

const stmts = {
    upsert: db.prepare(`
        INSERT INTO players
            (id, world, name, alliance, cultural_level,
             town_count, current_cp, next_level_cp, troops, towns_data, pushed_at)
        VALUES
            (@id, @world, @name, @alliance, @cultural_level,
             @town_count, @current_cp, @next_level_cp, @troops, @towns_data, strftime('%s','now'))
        ON CONFLICT(id, world) DO UPDATE SET
            name           = excluded.name,
            alliance       = excluded.alliance,
            cultural_level = excluded.cultural_level,
            town_count     = excluded.town_count,
            current_cp     = excluded.current_cp,
            next_level_cp  = excluded.next_level_cp,
            troops         = excluded.troops,
            towns_data     = excluded.towns_data,
            pushed_at      = excluded.pushed_at
    `),

    getByWorld: db.prepare(`
        SELECT id, name, alliance, cultural_level,
               town_count, current_cp, next_level_cp, troops, towns_data, pushed_at
        FROM players
        WHERE world = ?
        ORDER BY name ASC
    `),

    getPlayerTowns: db.prepare(`
        SELECT towns_data
        FROM players
        WHERE world = ? AND id = ?
    `),

    cleanupStale: db.prepare(`
        DELETE FROM players WHERE pushed_at < strftime('%s','now') - 604800
    `),
};

function upsertPlayer(data) { stmts.upsert.run(data); }
function getPlayersByWorld(world) { return stmts.getByWorld.all(world); }
function getPlayerTowns(world, playerId) {
    const row = stmts.getPlayerTowns.get(world, playerId);
    if (!row) return null;
    try { return JSON.parse(row.towns_data); } catch { return []; }
}
function cleanupStale() {
    const r = stmts.cleanupStale.run();
    if (r.changes > 0) console.log(`[DB] Cleaned up ${r.changes} stale player(s)`);
}

setInterval(cleanupStale, 86400000);
cleanupStale();

module.exports = { upsertPlayer, getPlayersByWorld, getPlayerTowns };
