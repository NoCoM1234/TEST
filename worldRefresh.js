'use strict';
// ═════════════════════════════════════════════════════════════════════════════
// ── WORLD DATA REFRESH (replaces the GitHub Actions workflow) ────────────────
// ═════════════════════════════════════════════════════════════════════════════
//
// NEW FILE — save next to server.js as  worldRefresh.js
//
// The server now downloads towns/islands/players/alliances/world_settings from
// grepolis.com itself. Triggered by:
//   • cron-job.org → POST /admin/refresh-world-data   (every 3h)
//   • startup catch-up → refreshes any world whose data is older than 3h
//     (covers runs missed while Render was asleep)
//
// Downloads from grepolis.com are INBOUND traffic for Render, so this does not
// count toward the 5 GB/month outbound limit.
//
// Worlds come from the WORLD_IDS env var (comma-separated) so you can change
// them in the Render dashboard without editing code.
// ─────────────────────────────────────────────────────────────────────────────

const db = require('./database');
const { invalidateCache, getMapData } = require('./towns');

const WORLDS = (process.env.WORLD_IDS || 'gr122,gr123,gr126')
    .split(',').map(s => s.trim()).filter(Boolean);

const STALE_SECONDS     = 3 * 3600;   // startup catch-up threshold
const STARTUP_DELAY_MS  = 20000;      // let Mongo connect first
const FETCH_TIMEOUT_MS  = 30000;
const FETCH_RETRIES     = 3;
const UA = 'Mozilla/5.0 (compatible; MasterAPI-WorldRefresh/1.0)';

// ── Fetch helper (same behaviour as curl -sf --max-time 30 --retry 3) ────────
async function fetchText(url) {
    let lastErr;
    for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
        try {
            const r = await fetch(url, {
                headers: { 'User-Agent': UA },
                signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.text();
        } catch (e) {
            lastErr = e;
            if (attempt < FETCH_RETRIES) await new Promise(res => setTimeout(res, 2000 * attempt));
        }
    }
    throw new Error(`${url} → ${lastErr && lastErr.message}`);
}

// ── Parsers (copied 1:1 from main.yml, now taking strings instead of files) ──
function parseTxt(text) {
    return text
        .split('\n')
        .filter(l => l.trim())
        .map(l => l.split(',').map(p => decodeURIComponent(p.trim().replace(/\+/g, ' '))));
}

function parseWorldSettings(html) {
    const settings = {};

    // Scope to the settings panel only (avoids sidebar interference)
    const panelMatch = html.match(/<ul[^>]+class="[^"]*world_settings_information[^"]*">([\s\S]*?)<\/ul>/);
    const panel = panelMatch ? panelMatch[1] : html;

    // World name (from header, e.g. "Himera (gr120)")
    const nameMatch = panel.match(/<span class="center">\s*([\s\S]*?)\s*<\/span>/);
    if (nameMatch) settings['World Name'] = nameMatch[1].trim();

    // Preview fields
    const previewMap = [
        ['world_date',     'Date'],
        ['world_players',  'Players'],
        ['starting_towns', 'Starting Towns'],
    ];
    for (const [cls, key] of previewMap) {
        const m = panel.match(new RegExp(`<div class="${cls}">\\s*([\\s\\S]*?)\\s*<\\/div>`));
        if (m) settings[key] = m[1].replace(/<[^>]+>/g, '').trim();
    }

    // End game type — wildcard suffix (world_wonder / olympus / domination / ...)
    const endGameMatch = panel.match(/<div class="end_game_type_(\w+)">\s*([\s\S]*?)\s*<\/div>/);
    if (endGameMatch) {
        settings['End Game Type']     = endGameMatch[2].replace(/<[^>]+>/g, '').trim();
        settings['End Game Type Key'] = endGameMatch[1];
    }

    // World description
    const descMatch = panel.match(/<pre class="world_description">([\s\S]*?)<\/pre>/);
    if (descMatch) {
        settings['Description'] = descMatch[1]
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .trim();
    }

    // Settings table
    const rows = panel.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m =>
            m[1].replace(/<[^>]+>/g, '').trim()
        );
        if (cells.length === 2 && cells[0] && cells[1]) settings[cells[0]] = cells[1];
    }

    return settings;
}

// ── Ingest (the old /admin/world-data handler body, now shared) ──────────────
// Used by BOTH /admin/world-data (old GitHub path) and the new refresh.
async function ingestWorldData(world_id, { towns, islands, players, alliances, world_settings }) {
    await db.upsertWorldData(world_id, towns, islands);
    if (Array.isArray(players) && Array.isArray(alliances)) {
        await db.upsertWorldMeta(world_id, players, alliances, world_settings || {});
    }
    invalidateCache(world_id);
    console.log(`[Admin] World data updated for ${world_id} — ${towns.length} towns, ${islands.length} islands, settings keys: ${Object.keys(world_settings || {}).length}`);

    // History capture: first push of each UTC day becomes that day's snapshot.
    // getMapData is called AFTER upsert+invalidate so we diff the transformed
    // /map format. saveWorldHistory no-ops if today is already recorded.
    try {
        const snap = await getMapData(world_id);
        if (snap) {
            const r = await db.saveWorldHistory(world_id, {
                towns:     snap.towns,
                players:   snap.players,
                alliances: snap.alliances,
            });
            if (r.saved) console.log(`[History] ${world_id} ${r.date} recorded as ${r.type} (${(r.bytes / 1024).toFixed(1)} KB gz)`);
        }
    } catch (e) {
        console.error(`[History] Capture failed for ${world_id}:`, e.message);
    }
}

// world_settings is optional: if its fetch/parse fails, keep the stored one
// instead of overwriting it with {} (which would lose the map's world type).
async function previousWorldSettings(world_id) {
    const d   = await db.getDb();
    const row = await d.collection('world_meta').findOne(
        { world_id }, { projection: { _id: 0, world_settings: 1 } }
    );
    return (row && row.world_settings) || {};
}

// ── One world ─────────────────────────────────────────────────────────────────
async function refreshWorld(world_id) {
    const t0   = Date.now();
    const base = `https://${world_id}.grepolis.com`;

    const [townsTxt, islandsTxt, playersTxt, alliancesTxt] = await Promise.all([
        fetchText(`${base}/data/towns.txt`),
        fetchText(`${base}/data/islands.txt`),
        fetchText(`${base}/data/players.txt`),
        fetchText(`${base}/data/alliances.txt`),
    ]);

    let world_settings = {};
    try {
        world_settings = parseWorldSettings(await fetchText(`${base}/game/world_settings`));
    } catch (e) {
        console.warn(`[WorldRefresh] ${world_id}: world_settings fetch failed (${e.message}) — keeping stored settings`);
    }
    if (!Object.keys(world_settings).length) world_settings = await previousWorldSettings(world_id);

    const data = {
        towns:     parseTxt(townsTxt),
        islands:   parseTxt(islandsTxt),
        players:   parseTxt(playersTxt),
        alliances: parseTxt(alliancesTxt),
        world_settings,
    };
    if (!data.towns.length || !data.islands.length) {
        throw new Error(`empty towns/islands (${data.towns.length}/${data.islands.length}) — not overwriting`);
    }

    await ingestWorldData(world_id, data);
    return {
        towns:     data.towns.length,
        islands:   data.islands.length,
        players:   data.players.length,
        alliances: data.alliances.length,
        seconds:   +((Date.now() - t0) / 1000).toFixed(1),
    };
}

// ── All worlds (one run at a time) ────────────────────────────────────────────
let _running = null;
let _status  = { running: false, trigger: null, started_at: null, finished_at: null, results: {} };

function refreshAllWorlds(worlds = WORLDS, trigger = 'manual') {
    if (_running) return { started: false, reason: 'already-running', worlds: Object.keys(_status.results) };

    _status = {
        running:     true,
        trigger,
        started_at:  new Date().toISOString(),
        finished_at: null,
        results:     {},
    };
    console.log(`[WorldRefresh] Start (${trigger}): ${worlds.join(', ')}`);

    // Sequential on purpose — keeps memory low on the free instance.
    _running = (async () => {
        for (const w of worlds) {
            try {
                const r = await refreshWorld(w);
                _status.results[w] = { ok: true, ...r };
                console.log(`[WorldRefresh] ${w} ok — ${r.towns} towns in ${r.seconds}s`);
            } catch (e) {
                _status.results[w] = { ok: false, error: e.message };
                console.error(`[WorldRefresh] ${w} FAILED: ${e.message}`);
            }
        }
    })().finally(() => {
        _running = null;
        _status.running     = false;
        _status.finished_at = new Date().toISOString();
        console.log(`[WorldRefresh] Done (${trigger})`);
    });

    return { started: true, worlds };
}

function getRefreshStatus() {
    return { worlds: WORLDS, ..._status };
}

// ── Startup catch-up ──────────────────────────────────────────────────────────
// Render's free instance restarts after every sleep; only refresh worlds whose
// data is actually older than 3h, so a restart doesn't refetch everything.
async function getStaleWorlds() {
    const d    = await db.getDb();
    const rows = await d.collection('world_data')
        .find({ world_id: { $in: WORLDS } }, { projection: { _id: 0, world_id: 1, updated_at: 1 } })
        .toArray();
    const at  = Object.fromEntries(rows.map(r => [r.world_id, r.updated_at || 0]));
    const now = Math.floor(Date.now() / 1000);
    return WORLDS.filter(w => now - (at[w] || 0) >= STALE_SECONDS);
}

function scheduleStartupCatchUp() {
    setTimeout(async () => {
        try {
            const stale = await getStaleWorlds();
            if (stale.length) refreshAllWorlds(stale, 'startup');
            else console.log('[WorldRefresh] Startup: all worlds fresh');
        } catch (e) {
            console.error('[WorldRefresh] Startup check failed:', e.message);
        }
    }, STARTUP_DELAY_MS);
}

module.exports = {
    WORLDS,
    ingestWorldData,
    refreshAllWorlds,
    getRefreshStatus,
    scheduleStartupCatchUp,
};
