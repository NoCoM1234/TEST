'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
        token       TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        world       TEXT NOT NULL,
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS players (
        id              TEXT NOT NULL,
        token           TEXT NOT NULL,
        name            TEXT NOT NULL,
        world           TEXT NOT NULL,
        towns           TEXT NOT NULL,
        alliance        TEXT NOT NULL,
        cultural_level  TEXT NOT NULL,
        additional_towns TEXT NOT NULL,
        current_cp      TEXT NOT NULL,
        next_level_cp   TEXT NOT NULL,
        last_updated    TEXT NOT NULL,
        pushed_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (id, token),
        FOREIGN KEY (token) REFERENCES groups(token) ON DELETE CASCADE
    );
`);

// ── Prepared statements ───────────────────────────────────────────────────────

const stmts = {
    createGroup: db.prepare(`
        INSERT INTO groups (token, name, world)
        VALUES (@token, @name, @world)
    `),

    getGroup: db.prepare(`
        SELECT * FROM groups WHERE token = ?
    `),

    groupExists: db.prepare(`
        SELECT 1 FROM groups WHERE token = ?
    `),

    upsertPlayer: db.prepare(`
        INSERT INTO players
            (id, token, name, world, towns, alliance, cultural_level,
             additional_towns, current_cp, next_level_cp, last_updated, pushed_at)
        VALUES
            (@id, @token, @name, @world, @towns, @alliance, @cultural_level,
             @additional_towns, @current_cp, @next_level_cp, @last_updated, strftime('%s','now'))
        ON CONFLICT(id, token) DO UPDATE SET
            name            = excluded.name,
            world           = excluded.world,
            towns           = excluded.towns,
            alliance        = excluded.alliance,
            cultural_level  = excluded.cultural_level,
            additional_towns = excluded.additional_towns,
            current_cp      = excluded.current_cp,
            next_level_cp   = excluded.next_level_cp,
            last_updated    = excluded.last_updated,
            pushed_at       = excluded.pushed_at
    `),

    getPlayers: db.prepare(`
        SELECT id, name, towns, alliance, cultural_level,
               additional_towns, current_cp, next_level_cp,
               last_updated, pushed_at
        FROM players
        WHERE token = ?
        ORDER BY name ASC
    `),

    deletePlayer: db.prepare(`
        DELETE FROM players WHERE id = @id AND token = @token
    `),

    // Auto-cleanup: remove players not updated in 7 days
    cleanupStale: db.prepare(`
        DELETE FROM players
        WHERE pushed_at < strftime('%s','now') - 604800
    `),
};

// ── Exported functions ────────────────────────────────────────────────────────

function createGroup({ token, name, world }) {
    try {
        stmts.createGroup.run({ token, name, world });
        return { ok: true };
    } catch (e) {
        if (e.message.includes('UNIQUE')) return { ok: false, error: 'Token already exists' };
        throw e;
    }
}

function groupExists(token) {
    return !!stmts.groupExists.get(token);
}

function upsertPlayer(data) {
    stmts.upsertPlayer.run(data);
}

function getPlayers(token) {
    return stmts.getPlayers.all(token);
}

function deletePlayer({ id, token }) {
    const result = stmts.deletePlayer.run({ id, token });
    return result.changes > 0;
}

function cleanupStale() {
    const result = stmts.cleanupStale.run();
    if (result.changes > 0) {
        console.log(`[DB] Cleaned up ${result.changes} stale player(s)`);
    }
}

// Run cleanup once a day
setInterval(cleanupStale, 86400000);
cleanupStale();

module.exports = { createGroup, groupExists, upsertPlayer, getPlayers, deletePlayer };
