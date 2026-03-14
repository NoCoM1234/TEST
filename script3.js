// ==UserScript==
// @name         Grepolis Master 3
// @version      7.5
// @description  All-in-one automation suite for Grepolis. Features: AutoBuild (queue buildings per town), AutoResearch (queue academy researches), AutoHide-Trade (auto-hide resources via incoming trades), AutoTroop (auto-recruit troops per town), AutoFarm (farm collector + village upgrader), AutoCulture (auto-spend culture points), Sleep Schedule (pause bot during set hours), Auto-Reload (scheduled page refresh), Alliance Tab (live troop/CP data for all alliance members with online status indicators), Resource Requests Tab (share resource requests with alliance members in real time), Town Navigation (z/x keys to cycle your towns sorted by trade travel time), CS Detection (identify colonization ships from incoming attacks with Discord alerts), Athena Protection scheduler, Troop Counter (barracks/docks queue display), Attack Simulator counter, per-town statistics tracking, and a full config UI accessible from the game toolbar.
// @author       Stamas
// @match        https://*.grepolis.com/game/*
// @match        http://*.grepolis.com/game/*
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIj4KICA8cmVjdCB4PSI1IiB5PSI2IiB3aWR0aD0iMTQiIGhlaWdodD0iMTAiIHJ4PSIyIiBmaWxsPSIjY2NlMGZmIiBzdHJva2U9IiM1NTg4Y2MiIHN0cm9rZS13aWR0aD0iMSIvPgogIDxsaW5lIHgxPSIxMiIgeTE9IjYiIHgyPSIxMiIgeTI9IjMiIHN0cm9rZT0iIzU1ODhjYyIgc3Ryb2tlLXdpZHRoPSIxLjIiLz4KICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjIuNSIgcj0iMSIgZmlsbD0iI2ZmY2M0NCIvPgogIDxwYXRoIGQ9Ik03LjUgMTAgUTguNSA4LjUgOS41IDEwIiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzY2YWEiIHN0cm9rZS13aWR0aD0iMS4yIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8cGF0aCBkPSJNMTQuNSAxMCBRMTUuNSA4LjUgMTYuNSAxMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzM2NmFhIiBzdHJva2Utd2lkdGg9IjEuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPHBhdGggZD0iTTEwIDEzIFExMiAxNC41IDE0IDEzIiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzY2YWEiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+CiAgPHJlY3QgeD0iNyIgeT0iMTYiIHdpZHRoPSIxMCIgaGVpZ2h0PSI1IiByeD0iMS41IiBmaWxsPSIjYWFjOGVlIiBzdHJva2U9IiM1NTg4Y2MiIHN0cm9rZS13aWR0aD0iMSIvPgogIDx0ZXh0IHg9IjE3IiB5PSI4IiBmb250LXNpemU9IjUiIGZpbGw9IiNmZmRkNTUiIGZvbnQtd2VpZ2h0PSJib2xkIiBmb250LWZhbWlseT0iQXJpYWwiPno8L3RleHQ+CiAgPHRleHQgeD0iMTkiIHk9IjUuNSIgZm9udC1zaXplPSI0IiBmaWxsPSIjZmZkZDU1IiBmb250LXdlaWdodD0iYm9sZCIgZm9udC1mYW1pbHk9IkFyaWFsIj56PC90ZXh0Pgo8L3N2Zz4=
// ==/UserScript==

// ════════════════════════════════════════════════════════════════════
//  HOW TO ADD A NEW FEATURE
//  1. Add its config to CONFIG section below
//  2. Wire config to savePersistedConfig / loadPersistedConfig
//  3. If it needs per-town storage: add a makeLocalCache('yourKey') entry
//  4. Write a processXxxTown(townId) function
//  5. Write a runXxxCycle() function using the same loop pattern
//  6. Add it to masterLoop() cycleRunners (or start an independent loop)
//  7. Expose toggle in createMasterConfigWindow() if needed
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
(function () {

    const uw = unsafeWindow || window;


    // ════════════════════════════════════════════════════════════════
    //  § 1  CONFIG
    // ════════════════════════════════════════════════════════════════

    // ── Timing ───────────────────────────────────────────────────────
    let MIN_RUN_DELAY = 1000 * 60 * 30;
    let MAX_RUN_DELAY = 1000 * 60 * 60;

    const MIN_ACTION_DELAY      = 4000;
    const MAX_ACTION_DELAY      = 8000;
    const MIN_TOWN_SWITCH_DELAY = 2000;
    const MAX_TOWN_SWITCH_DELAY = 5000;
    const MAX_ACTIONS_PER_TOWN  = 7;
    const USER_ACTIVE_TIMEOUT   = 20000;

    // ── Sleep schedule ───────────────────────────────────────────────
    const SLEEP_CONFIG = {
        enabled:      true,
        sleepHour:    1,
        sleepMinMs:   21600000,
        sleepMaxMs:   30600000,
        wakeJitterMs: 2700000,
    };

    // ── Culture events ───────────────────────────────────────────────
    const CULTURE_CONFIG = {
        runTheater:    false,
        runParty:      false,
        runTriumph:    false,
        runGames:      false,
        cultureKeepBP:   100000,
        cultureKeepGold: 100000,
        waitLowMin:    1800000,
        waitLowMax:    3600000,
        waitHighMin:   3600000,
        waitHighMax:   5400000,
    };

    // ── Farm villages ────────────────────────────────────────────────
    const FARM_CONFIG = {
        useFarm:          true,
        autoOpenVillages: true,
        upgradeVillages:  true,
        villagesMaxLevel: 6,
    };

    // ── Town keyboard navigation ─────────────────────────────────────
    const NAV_CONFIG = {
        enabled: true,
        keyNext: 'x',
        keyPrev: 'z',
    };

    // ── Discord notifications ─────────────────────────────────────────
   let NOTIF_CONFIG = {
    attackEnabled:    false,
    csEnabled:        false,
    possibleCsEnabled: false,   // ← add
    attackWebhook:    '',
    csWebhook:        '',
    possibleCsWebhook: '',      // ← add (blank = reuse csWebhook)
};

    // ── AutoTroop — cycles with no trades before per-town disable ────
    let NO_TROOP_TRADE_DISABLE_THRESHOLD = 10;

    // ── Alliance API ─────────────────────────────────────────────────
    const ALLIANCE_API = GM_getValue('allianceApiUrl', 'https://test-1i20.onrender.com');

    // ── UI visibility toggles (persisted) ───────────────────────────
    let UI_CONFIG = (() => {
        try {
            const stored = GM_getValue('uiConfig', null);
            if (stored) return typeof stored === 'string' ? JSON.parse(stored) : stored;
        } catch (e) {}
        return {
            showBuild: true, showResearch: true, showHide: true,
            showTroop: true, showTroopCounter: true, showSimCounter: true,
        };
    })();

    function saveUIConfig() {
        GM_setValue('uiConfig', JSON.stringify(UI_CONFIG));
    }


    // ════════════════════════════════════════════════════════════════
    //  § 2  PERSIST CONFIG — save / load all config to GM storage
    // ════════════════════════════════════════════════════════════════

    function savePersistedConfig() {
        GM_setValue('cfg_minRun',   MIN_RUN_DELAY);
        GM_setValue('cfg_maxRun',   MAX_RUN_DELAY);
        GM_setValue('cfg_noTradeThr', NO_TROOP_TRADE_DISABLE_THRESHOLD);
        GM_setValue('cfg_sleep',    JSON.stringify(SLEEP_CONFIG));
        GM_setValue('cfg_culture',  JSON.stringify(CULTURE_CONFIG));
        GM_setValue('cfg_farm',     JSON.stringify(FARM_CONFIG));
        GM_setValue('cfg_nav',      JSON.stringify(NAV_CONFIG));
        GM_setValue('cfg_notif',    JSON.stringify(NOTIF_CONFIG));  // ← webhooks + toggles
    }

    function loadPersistedConfig() {
        const minRun  = GM_getValue('cfg_minRun', null);
        if (minRun  !== null) MIN_RUN_DELAY = minRun;

        const maxRun  = GM_getValue('cfg_maxRun', null);
        if (maxRun  !== null) MAX_RUN_DELAY = maxRun;

        const noTrade = GM_getValue('cfg_noTradeThr', null);
        if (noTrade !== null) NO_TROOP_TRADE_DISABLE_THRESHOLD = noTrade;

        const sleep   = GM_getValue('cfg_sleep',   null);
        if (sleep)   Object.assign(SLEEP_CONFIG,   safeParseGM(sleep));

        const culture = GM_getValue('cfg_culture', null);
        if (culture) Object.assign(CULTURE_CONFIG, safeParseGM(culture));

        const farm    = GM_getValue('cfg_farm',    null);
        if (farm)    Object.assign(FARM_CONFIG,    safeParseGM(farm));

        const nav     = GM_getValue('cfg_nav',     null);
        if (nav)     Object.assign(NAV_CONFIG,     safeParseGM(nav));

        // Load webhooks early so NOTIF_CONFIG is populated before notifInit() runs
        const notif   = GM_getValue('cfg_notif',   null);
        if (notif)   Object.assign(NOTIF_CONFIG,   safeParseGM(notif));

        console.log('[MasterConfig] Settings loaded from storage.');
    }

    loadPersistedConfig();

    // ════════════════════════════════════════════════════════════════
    //  § 3  CORE UTILITIES
    // ════════════════════════════════════════════════════════════════

    const sleep  = ms        => new Promise(r => setTimeout(r, ms));
    const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const rand   = (min, max) => Math.random() * (max - min) + min;

    /**
     * Safely parse a value retrieved from GM_getValue.
     * Handles three cases:
     *   1. Already an object  — old scripts stored raw objects; return as-is.
     *   2. A JSON string      — parse and return.
     *   3. Anything else      — return null so the caller keeps defaults.
     */
    function safeParseGM(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'object') return value;          // already parsed by TM
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch(e) {}
        }
        return null;
    }

    let lastActivity = Date.now();
    let isSleeping   = false;

    // Status tracking (read by Config window)
    let statusNextRunAt = null;
    let statusLastTask  = null;
    let statusLog       = [];

    // Activity listeners
    document.addEventListener('mousemove', () => { lastActivity = Date.now(); }, { passive: true });
    document.addEventListener('click',     () => { lastActivity = Date.now(); }, { passive: true });
    document.addEventListener('keydown',   () => { lastActivity = Date.now(); }, { passive: true });

    function isUserActive() {
        return Date.now() - lastActivity < USER_ACTIVE_TIMEOUT;
    }

    function botcheck() {
        return uw.CaptchaWindowFactory?.captcha_window_opened || false;
    }

    function fakeSwitchToTown(townId) {
        const orig = uw.Game.townId;
        uw.Game.townId = Number(townId);
        setTimeout(() => { uw.Game.townId = orig; }, 0);
    }

    function updateCycleDelaysBasedOnSpeed() {
        const speed = Number(uw.Game?.game_speed) || 1;
        if (GM_getValue('cfg_minRun', null) === null) {
            MIN_RUN_DELAY = Math.round((30 / speed) * 60 * 1000);
            MAX_RUN_DELAY = Math.round((60 / speed) * 60 * 1000);
            console.log(`[Master] First load — cycle delay set to ${Math.round(30/speed)}–${Math.round(60/speed)} min (speed ${speed}x)`);
        } else {
            console.log(`[Master] Using saved cycle delay: ${Math.round(MIN_RUN_DELAY/60000)}–${Math.round(MAX_RUN_DELAY/60000)} min`);
        }
    }

    // ── Troop UI state ───────────────────────────────────────────────
    let isBarracksOpen     = false;
    let isDocksOpen        = false;
    let selectedTroops     = [];
    let sessionTownId      = null;
    let currentBuildingType = null;


    // ════════════════════════════════════════════════════════════════
    //  § 4  ACTION QUEUE
    //  Priority 0 : AutoHide-Trade + AutoTroop (highest — always runs)
    //  Priority 1 : AutoBuild
    //  Priority 2 : AutoResearch
    //  Priority 3 : AutoHide (regular)
    //  Priority 4 : AutoFarm Collector
    //  Priority 5 : FarmVillage Upgrader
    //  Priority 6 : AutoCulture
    // ════════════════════════════════════════════════════════════════

    const actionQueue = new class {
        constructor() { this.queue = []; }

        _uniqueID() {
            const id = random(1, 10000);
            return this.queue.find(e => e.queueID === id) ? this._uniqueID() : id;
        }
        enqueue(priority) {
            const queueID = this._uniqueID();
            this.queue.push({ queueID, priority });
            return queueID;
        }
        getNext() {
            return this.queue.length
                ? [...this.queue].sort((a, b) => a.priority - b.priority)[0]
                : null;
        }
        dequeue(queueID) {
            this.queue = this.queue.filter(e => e.queueID !== queueID);
        }
    };


    // ════════════════════════════════════════════════════════════════
    //  § 5  CYCLE COUNTER FACTORY
    //  Replaces the two near-identical counter systems that previously
    //  existed for AutoHide-Trade and AutoTroop separately.
    //
    //  Usage:
    //    const myCounter = createCycleCounter(threshold);
    //    myCounter.increment(townId)  → new count
    //    myCounter.reset(townId)
    //    myCounter.clear(townId)
    //    myCounter.get(townId)        → current count
    //    myCounter.isOver(townId)     → count >= threshold
    // ════════════════════════════════════════════════════════════════

    function createCycleCounter(threshold) {
        const map = new Map();
        return {
            increment(townId) {
                const c = (map.get(townId) || 0) + 1;
                map.set(townId, c);
                return c;
            },
            reset(townId)  { map.set(townId, 0); },
            clear(townId)  { map.delete(townId); },
            get(townId)    { return map.get(townId) || 0; },
            isOver(townId) { return (map.get(townId) || 0) >= threshold; },
        };
    }

    // One counter per independent auto-disable system
    const hideTradeCycles = createCycleCounter(10);   // AutoHide-Trade
    const troopTradeCycles = createCycleCounter(      // AutoTroop (threshold is configurable)
        NO_TROOP_TRADE_DISABLE_THRESHOLD
    );

    // Backward-compatible aliases used internally (kept so callers are readable)
    const NO_TRADE_DISABLE_THRESHOLD = 10; // for AutoHide-Trade (fixed)


    // ════════════════════════════════════════════════════════════════
    //  § 6  STORAGE LAYER
    //  makeLocalCache(key) returns { load(), save(data) } with an
    //  in-memory cache so repeated calls don't hit localStorage.
    //
    //  Each feature gets its own named storage entry.
    // ════════════════════════════════════════════════════════════════

    function makeLocalCache(key) {
        let cache = null;
        return {
            load() {
                if (cache) return cache;
                try { cache = JSON.parse(localStorage.getItem(key) || '{}'); }
                catch (e) { cache = {}; }
                return cache;
            },
            save(data) {
                cache = data;
                try { localStorage.setItem(key, JSON.stringify(data)); }
                catch (e) {}
            },
        };
    }

    // ── Per-feature storage instances ────────────────────────────────
    const buildStore    = makeLocalCache('buildingTargets');
    const researchStore = makeLocalCache('academyTargets');
    const hideStore     = makeLocalCache('hideTargets');

    // ── Build storage helpers ─────────────────────────────────────────

    function loadBuildingTargets()   { return buildStore.load(); }
    function saveBuildingTargets_raw(data) { buildStore.save(data); }

    function saveBuildingTargets(townId, queue, autoBuild, schematicsEnabled, selectedSchematic = '') {
        if (schematicsEnabled && (!selectedSchematic || selectedSchematic === '-- Select schematic --'))
            schematicsEnabled = false;
        if (schematicsEnabled) autoBuild = false;
        if (autoBuild) schematicsEnabled = false;

        const storage = loadBuildingTargets();
        storage[townId] = {
            id: townId,
            queue: [...(queue || [])],
            autoBuild: !!autoBuild,
            schematicsEnabled: !!schematicsEnabled,
            selectedSchematic: selectedSchematic || '',
        };
        saveBuildingTargets_raw(storage);
    }

    // ── Research storage helpers ─────────────────────────────────────

    function loadResearchStorage()       { return researchStore.load(); }
    function saveResearchStorage(data)   { researchStore.save(data); }

    function getGameResearchAttrs(townId) {
        try { return uw.ITowns.towns[townId].researches().attributes || {}; }
        catch (e) { return {}; }
    }

    function getGameResearchLevels(townId) {
        const attrs = getGameResearchAttrs(townId);
        const levels = {};
        for (const [k, v] of Object.entries(attrs)) {
            if (typeof v === 'boolean') levels[k] = v ? 1 : 0;
        }
        return levels;
    }

    function getLevelsAfterActiveOrders(townId) {
        const levels = getGameResearchLevels(townId);
        try {
            Object.values(uw.MM.getModels().ResearchOrder || {}).forEach(o => {
                const attr = o.attributes;
                if (attr.town_id != townId) return;
                if (typeof levels[attr.research_type] === 'undefined') return;
                levels[attr.research_type] = (attr.action_name === 'revert') ? 0 : 1;
            });
        } catch (e) {}
        return levels;
    }

    function saveAcademyTargets(townId, queue, autoResearch, schematicsEnabled, selectedSchematic) {
        if (schematicsEnabled && !selectedSchematic) schematicsEnabled = false;
        if (schematicsEnabled) autoResearch = false;
        if (autoResearch) schematicsEnabled = false;

        const storage  = loadResearchStorage();
        const existing = storage[townId] || {};
        storage[townId] = {
            levels: existing.levels || getLevelsAfterActiveOrders(townId),
            queue:  [...(queue || [])],
            autoResearch:      !!autoResearch,
            schematicsEnabled: !!schematicsEnabled,
            selectedSchematic: selectedSchematic || '',
        };
        saveResearchStorage(storage);
    }

    function getResearchTownEntry(townId) {
        const storage = loadResearchStorage();
        if (!storage[townId]) {
            saveAcademyTargets(townId, [], false, false, '');
            return loadResearchStorage()[townId];
        }
        const e = storage[townId];
        let dirty = false;
        if (!e.levels)                 { e.levels            = getLevelsAfterActiveOrders(townId); dirty = true; }
        if (!e.queue)                  { e.queue             = [];    dirty = true; }
        if (e.autoResearch == null)    { e.autoResearch      = false; dirty = true; }
        if (e.schematicsEnabled == null){ e.schematicsEnabled = false; dirty = true; }
        if (e.selectedSchematic == null){ e.selectedSchematic = '';    dirty = true; }
        if (dirty) { storage[townId] = e; saveResearchStorage(storage); }
        return e;
    }

    function saveResearchTownEntry(townId, entry) {
        const storage = loadResearchStorage();
        storage[townId] = entry;
        saveResearchStorage(storage);
    }

    function simulateResearchLevels(baseLevels, queue) {
        const sim = { ...baseLevels };
        for (const s of queue) {
            sim[s.type] = s.dir === 'up'
                ? Math.min(1, (sim[s.type] ?? 0) + 1)
                : Math.max(0, (sim[s.type] ?? 0) - 1);
        }
        return sim;
    }

    function canAddResearchStep(type, dir, baseLevels, queue) {
        const sim = simulateResearchLevels(baseLevels, queue);
        const cur = sim[type] ?? 0;
        return dir === 'up' ? cur < 1 : cur > 0;
    }

    function sanitizeResearchQueue(queue, baseLevels) {
        const sim   = { ...baseLevels };
        const valid = [];
        for (const s of queue) {
            const cur = sim[s.type] ?? 0;
            if      (s.dir === 'up'   && cur < 1) { sim[s.type] = cur + 1; valid.push(s); }
            else if (s.dir === 'down' && cur > 0) { sim[s.type] = cur - 1; valid.push(s); }
        }
        return valid;
    }

    function addResearchToQueue(townId, type, dir) {
        const entry = getResearchTownEntry(townId);
        if (!canAddResearchStep(type, dir, entry.levels, entry.queue)) return false;
        entry.queue.push({ type, dir });
        saveResearchTownEntry(townId, entry);
        return true;
    }

    function removeResearchFromQueue(townId, idx) {
        const entry = getResearchTownEntry(townId);
        entry.queue.splice(idx, 1);
        entry.queue = sanitizeResearchQueue(entry.queue, entry.levels);
        saveResearchTownEntry(townId, entry);
    }

    const IGNORED_RESEARCH_CLASSES = new Set([
        'research_icon','item_icon','research40x40','inactive','active',
        'js-item-icon','research','locked','unlocked','current-research',
        'obs-arrow-small',
    ]);

    function getResearchType(icon) {
        for (const cls of icon.classList) {
            if (!IGNORED_RESEARCH_CLASSES.has(cls)) return cls;
        }
        return null;
    }

    // ── Hide storage helpers ──────────────────────────────────────────

    function loadHideStorage()       { return hideStore.load(); }
    function saveHideStorage(data)   { hideStore.save(data); }

    function saveHideTargets(townId, autoHide, autoHideTrade, targetCapacity) {
        const storage = loadHideStorage();
        storage[townId] = {
            autoHide:       !!autoHide,
            autoHideTrade:  !!autoHideTrade,
            targetCapacity: (targetCapacity === null || targetCapacity === undefined)
                ? null : Number(targetCapacity),
        };
        saveHideStorage(storage);
    }

    function getHideEntry(townId) {
        return loadHideStorage()[townId] || { autoHide: false, autoHideTrade: false, targetCapacity: null };
    }

    // ── Troop storage helpers ─────────────────────────────────────────
    //  Note: troop storage is not wrapped in makeLocalCache because it
    //  contains migration logic and is written directly in many places.

    function loadTroopStorage() {
        let storage = {};
        try {
            const raw = localStorage.getItem('troopStorage');
            if (raw) storage = JSON.parse(raw);
        } catch (e) { storage = {}; }

        // One-time migration: flatten nested barracks/docks structure
        let migrated = false;
        Object.keys(storage).forEach(townId => {
            if (storage[townId]?.troops && (storage[townId].troops.barracks || storage[townId].troops.docks)) {
                const { barracks = {}, docks = {} } = storage[townId].troops;
                storage[townId].troops = { ...barracks, ...docks };
                migrated = true;
            }
            if (storage[townId]?.id && storage[townId].recruit === undefined) {
                storage[townId].recruit = false;
                migrated = true;
            }
        });
        if (migrated) saveTroopStorage(storage);
        return storage;
    }

    function saveTroopStorage(data) {
        try { localStorage.setItem('troopStorage', JSON.stringify(data)); }
        catch (e) {}
    }


    // ════════════════════════════════════════════════════════════════
    //  § 7  STATISTICS SYSTEM
    // ════════════════════════════════════════════════════════════════

    const SESSION_STATS = { builds: 0, researches: 0, farmRuns: 0, villageUpgrades: 0, troops: {} };

    function loadLifetimeStats() {
        try {
            return JSON.parse(GM_getValue('lifetimeStats', 'null'))
                || { builds: 0, researches: 0, farmRuns: 0, villageUpgrades: 0, troops: {}, daily: {} };
        } catch (e) {
            return { builds: 0, researches: 0, farmRuns: 0, villageUpgrades: 0, troops: {}, daily: {} };
        }
    }

    function saveLifetimeStats(s) {
        try { GM_setValue('lifetimeStats', JSON.stringify(s)); } catch (e) {}
    }

    function todayKey() { return new Date().toISOString().slice(0, 10); }

    function trackStat(type, unitOrCount, count) {
        const ls  = loadLifetimeStats();
        const day = todayKey();
        if (!ls.daily[day]) ls.daily[day] = { builds: 0, researches: 0, farmRuns: 0, villageUpgrades: 0 };

        // Prune daily entries older than 14 days
        const keys = Object.keys(ls.daily).sort();
        while (keys.length > 14) delete ls.daily[keys.shift()];

        switch (type) {
            case 'build':
                ls.builds++; SESSION_STATS.builds++;
                ls.daily[day].builds++;
                break;
            case 'research':
                ls.researches++; SESSION_STATS.researches++;
                ls.daily[day].researches++;
                break;
            case 'farmRun':
                ls.farmRuns++; SESSION_STATS.farmRuns++;
                ls.daily[day].farmRuns = (ls.daily[day].farmRuns || 0) + 1;
                break;
            case 'villageUpgrade':
                ls.villageUpgrades++; SESSION_STATS.villageUpgrades++;
                ls.daily[day].villageUpgrades = (ls.daily[day].villageUpgrades || 0) + 1;
                break;
            case 'troop': {
                const uid = unitOrCount, amt = count || 0;
                ls.troops[uid]              = (ls.troops[uid]              || 0) + amt;
                SESSION_STATS.troops[uid]   = (SESSION_STATS.troops[uid]   || 0) + amt;
                break;
            }
        }
        saveLifetimeStats(ls);
    }


    // ════════════════════════════════════════════════════════════════
    //  § 8  ALERTS SYSTEM
    // ════════════════════════════════════════════════════════════════

    let ALERT_CONFIG = {
        troopBelowTarget:   { enabled: true },
        troopTradeDisabled: { enabled: true },
        botStuck:           { enabled: true, minutes: 120 },
        captchaDetected:    { enabled: true },
    };

    function loadAlertConfig() {
        try {
            const saved = JSON.parse(GM_getValue('alertConfig', 'null'));
            if (saved) Object.assign(ALERT_CONFIG, saved);
        } catch (e) {}
    }
    function saveAlertConfig() {
        try { GM_setValue('alertConfig', JSON.stringify(ALERT_CONFIG)); } catch (e) {}
    }
    loadAlertConfig();

    const alertLog = [];

    function loadAlertedTowns() {
        try { return new Set(JSON.parse(GM_getValue('alertedTowns', '[]'))); }
        catch (e) { return new Set(); }
    }
    function saveAlertedTowns() {
        try { GM_setValue('alertedTowns', JSON.stringify([...alertedTowns])); } catch (e) {}
    }
    const alertedTowns = loadAlertedTowns();

    // ── Toast notification ───────────────────────────────────────────

    function showToast(level, msg) {
        const colors = { warn: '#c8860a', danger: '#c0392b', info: '#2471a3', success: '#27ae60' };
        const icons  = { warn: '⚠️',     danger: '🚨',       info: 'ℹ️',     success: '✅' };
        const toast  = document.createElement('div');
        toast.style.cssText = `
            position:fixed;bottom:20px;right:20px;z-index:99999;
            background:${colors[level] || colors.warn};color:#fff;
            padding:10px 16px;border-radius:8px;font-family:Arial,sans-serif;
            font-size:13px;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.5);
            display:flex;align-items:flex-start;gap:8px;
            animation:slideIn 0.3s ease;`;
        toast.innerHTML = `
            <span style="font-size:16px;flex-shrink:0">${icons[level]||'⚠️'}</span>
            <div><strong>Grepolis Master</strong><br>${msg}</div>
            <span style="margin-left:8px;cursor:pointer;opacity:0.7;font-size:16px"
                  onclick="this.parentElement.remove()">✕</span>`;
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 8000);
    }
    function showRequestAlert(msg) {
    const alert = document.createElement('div');
    alert.style.cssText = `
        position:fixed;bottom:20px;right:20px;z-index:99999;
        background:#6a0dad;color:#fff;
        padding:10px 16px;border-radius:8px;font-family:Arial,sans-serif;
        font-size:13px;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.5);
        display:flex;align-items:flex-start;gap:8px;
        animation:slideIn 0.3s ease;`;
    alert.innerHTML = `
        <span style="font-size:16px;flex-shrink:0">📦</span>
        <div><strong>New Resource Request</strong><br>${msg}</div>
        <span style="margin-left:8px;cursor:pointer;opacity:0.7;font-size:16px"
              onclick="this.parentElement.remove()">✕</span>`;
    document.body.appendChild(alert);
    // No auto-remove — user must click ✕
}
    // showToastOnly is an alias kept for callers that don't want an alert-log entry
    const showToastOnly = showToast;

    function pushAlert(level, msg) {
        alertLog.unshift({ time: new Date().toLocaleTimeString(), level, msg });
        if (alertLog.length > 50) alertLog.pop();
        showToast(level, msg);
        console.warn(`[Alert][${level}] ${msg}`);
    }

    // ── Alert checker (runs every 60 s) ─────────────────────────────

    let lastAlertBotStuck = 0;
    let lastAlertCaptcha  = 0;

    function runAlertChecker() {
        try {
            const troopSt = loadTroopStorage();
            const allIds  = Object.keys(uw.ITowns?.towns || {});

            // Troop below target
            if (ALERT_CONFIG.troopBelowTarget.enabled) {
                allIds.forEach(id => {
                    const td = troopSt[id];
                    if (!td?.recruit || !td?.troops) return;
                    let belowAny = false;
                    try {
                        const current = getGroundPopulationInTown(id);
                        for (const [unit, want] of Object.entries(td.troops)) {
                            if (want > 0 && (current[unit] || 0) < want) { belowAny = true; break; }
                        }
                    } catch (e) { return; }
                    const key = `below_${id}`;
                    if (belowAny && !alertedTowns.has(key)) {
                        pushAlert('warn', `<b>${uw.ITowns.towns[id]?.name || id}</b>: troops below saved target`);
                        alertedTowns.add(key); saveAlertedTowns();
                    } else if (!belowAny) {
                        alertedTowns.delete(`below_${id}`); saveAlertedTowns();
                    }
                });
            }

            // AutoTroop trade-disabled but below target
            if (ALERT_CONFIG.troopTradeDisabled.enabled) {
                allIds.forEach(id => {
                    const td = troopSt[id];
                    if (td?.recruit) { alertedTowns.delete(`tradedis_${id}`); saveAlertedTowns(); return; }
                    if (!td?.troops || Object.keys(td.troops).length === 0) return;
                    let belowTarget = false;
                    try {
                        const current = getGroundPopulationInTown(id);
                        for (const [unit, want] of Object.entries(td.troops)) {
                            if (want > 0 && (current[unit] || 0) < want) { belowTarget = true; break; }
                        }
                    } catch (e) { return; }
                    const key = `tradedis_${id}`;
                    if (belowTarget && !alertedTowns.has(key)) {
                        pushAlert('danger', `<b>${uw.ITowns.towns[id]?.name || id}</b>: AutoTroop disabled (no trades) but troops not at target!`);
                        alertedTowns.add(key); saveAlertedTowns();
                    }
                });
            }

            // Bot stuck
            if (ALERT_CONFIG.botStuck.enabled && statusNextRunAt) {
                const overdue    = Date.now() - statusNextRunAt;
                const threshold  = (ALERT_CONFIG.botStuck.minutes || 120) * 60000;
                if (overdue > threshold && Date.now() - lastAlertBotStuck > 1800000) {
                    pushAlert('danger', `Bot hasn't completed a run in over ${ALERT_CONFIG.botStuck.minutes} minutes — may be stuck!`);
                    lastAlertBotStuck = Date.now();
                }
            }

            // Captcha
            if (ALERT_CONFIG.captchaDetected.enabled && botcheck()) {
                if (Date.now() - lastAlertCaptcha > 300000) {
                    pushAlert('danger', 'Captcha detected! Bot is paused.');
                    lastAlertCaptcha = Date.now();
                }
            }
        } catch (e) {}
    }

    setInterval(runAlertChecker, 60000);


    // ════════════════════════════════════════════════════════════════
    //  § 9  ALLIANCE API
    // ════════════════════════════════════════════════════════════════

    const UNIT_LIST = [
        'sword','slinger','archer','hoplite','rider','chariot','catapult',
        'big_transporter','small_transporter','bireme','attack_ship',
        'demolition_ship','trireme','colonize_ship',
        'minotaur','manticore','medusa','harpy','zyklop','centaur',
        'pegasus','sea_monster','cerberus','fury','griffin','satyr',
        'spartoi','ladon','calydonian_boar',
    ];

    async function alPushData() {
        try {
            const playerId   = uw.Game.player_id;
            const playerName = uw.Game.player_name;
            const world      = String(uw.Game.world_id);
            const pl         = uw.MM.getModels().Player[playerId]?.attributes || {};

            const totalTroops = {};
            const townsData   = [];

            Object.values(uw.ITowns.getTowns()).forEach(town => {
                const townId = town.getId ? town.getId() : (town.id || '');
                const units  = town.units()      || {};
                const outer  = town.unitsOuter() || {};

                const townTroops = {};
                UNIT_LIST.forEach(u => {
                    const n = (units[u] || 0) + (outer[u] || 0);
                    if (n > 0) {
                        totalTroops[u]   = (totalTroops[u] || 0) + n;
                        townTroops[u]    = n;
                    }
                });

                const bAttrs    = uw.ITowns.towns[townId]?.buildings()?.attributes || {};
                const buildings = {};
                for (const [k, v] of Object.entries(bAttrs)) {
                    if (typeof v === 'number' && v > 0) buildings[k] = v;
                }

                const rAttrs     = uw.ITowns.towns[townId]?.researches()?.attributes || {};
                const researched = Object.keys(rAttrs).filter(k => rAttrs[k] === true);

                const x = town.get?.('island_x') ?? town.attributes?.island_x ?? 0;
                const y = town.get?.('island_y') ?? town.attributes?.island_y ?? 0;

                townsData.push({
                    id:         String(townId),
                    name:       town.getName ? town.getName() : (town.get?.('name') ?? ''),
                    x, y,
                    buildings,
                    researched,
                    troops: townTroops,
                });
            });

            const body = {
                id:             String(playerId),
                world,
                name:           playerName,
                alliance:       pl.alliance_name || '',
                cultural_level: pl.cultural_step || 0,
                town_count:     Object.keys(uw.ITowns.getTowns()).length,
                current_cp:     pl.cultural_points || 0,
                next_level_cp:  pl.needed_cultural_points_for_next_step || 0,
                troops:         JSON.stringify(totalTroops),
                towns_data:     JSON.stringify(townsData),
                status:         isUserActive() ? 1 : 2,
            };

            const r = await fetch(`${ALLIANCE_API}/players/push`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', ...authSignRequest(body) },
                body:    JSON.stringify(body),
            });
            const j = await r.json();
            if (j.ok) {
                console.log('[Alliance] Data pushed');
                showToastOnly('success', '⚔️ Alliance data synced');
            }
        } catch (e) {
            console.error('[Alliance] Push error:', e);
        }
    }
async function alPushStatus() {
    try {
        const body = {
            id:     String(uw.Game.player_id),
            world:  String(uw.Game.world_id),
            status: isUserActive() ? 1 : 2,
        };
        await fetch(`${ALLIANCE_API}/players/status`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', ...authSignRequest(body) },
            body:    JSON.stringify(body),
        });
    } catch (e) {
        console.error('[Alliance] Status push error:', e);
    }
}

    // ════════════════════════════════════════════════════════════════
    //  § 10  SCHEMATICS (build & research target lists)
    // ════════════════════════════════════════════════════════════════

    const buildSchematicTargets = {
        'ΕΠΙΘΕΤΙΚΗ': [
            { barracks: 5, academy: 13, market: 5 },
            { main: 25, storage: 10, hide: 10 },
            { lumber: 15, ironer: 10, storage: 13, docks: 10, farm: 15 },
            { academy: 30 }, { storage: 23 },
            { storage: 25, market: 15, temple: 5, trade_office: 1 },
            { farm: 35, thermal: 1 }, { farm: 45 }, { storage: 35 },
            { barracks: 30 }, { academy: 36 }, { market: 30 },
            { lumber: 40, stoner: 40, ironer: 40 }, { temple: 10 },
        ],
        'ΑΜΥΝΤΙΚΗ ΛΟΥΤΡΑ': [
            { barracks: 5, academy: 13, market: 5 },
            { main: 25, storage: 10, hide: 10 },
            { lumber: 15, ironer: 10, storage: 13, docks: 10, farm: 15 },
            { academy: 30 }, { storage: 23 },
            { storage: 25, market: 15, temple: 5, trade_office: 1 },
            { farm: 35, thermal: 1 }, { farm: 45 }, { storage: 35 },
            { barracks: 30 }, { academy: 36 }, { market: 30 },
            { lumber: 40, stoner: 40, ironer: 40 }, { temple: 10 },
        ],
        'ΑΜΥΝΤΙΚΗ ΘΕΑΤΡΟ': [
            { barracks: 5, academy: 13, market: 5 },
            { main: 25, storage: 10, hide: 10 },
            { lumber: 15, ironer: 10, storage: 13, docks: 10, farm: 15 },
            { storage: 25, market: 15, temple: 5, academy: 36 },
            { farm: 45, trade_office: 1, barracks: 15 }, { wall: 10 },
            { lumber: 35, ironer: 32, theater: 1 }, { storage: 35 },
            { wall: 20 }, { lumber: 40, stoner: 40, ironer: 40 },
            { wall: 25 }, { barracks: 30 }, { market: 30 }, { temple: 30 },
        ],
        'ΔΙΗΡΕΙΣ': [
            { barracks: 5, academy: 13, market: 5 },
            { main: 25, storage: 10, hide: 10 },
            { lumber: 15, ironer: 10, storage: 13, docks: 10, farm: 15 },
            { academy: 30 }, { storage: 23 },
            { storage: 25, market: 15, temple: 5, academy: 36, trade_office: 1 },
            { farm: 35, thermal: 1 }, { farm: 45 }, { storage: 35 },
            { docks: 30 }, { market: 30 },
            { lumber: 40, stoner: 40, ironer: 40 }, { temple: 30 },
        ],
        'ΦΑΡΟΙ': [
            { barracks: 5, academy: 13, market: 5 },
            { main: 25, storage: 10, hide: 10 },
            { lumber: 15, ironer: 10, storage: 13, docks: 10, farm: 15 },
            { academy: 30 }, { storage: 23 },
            { storage: 25, market: 15, temple: 5, trade_office: 1 },
            { farm: 35, thermal: 1 }, { farm: 45 }, { storage: 35 },
            { docks: 30 }, { academy: 36 },
            { lumber: 20, stoner: 20, ironer: 20 }, { market: 30 },
        ],
        'MAX ΘΕΑΤΡΟ': [
            { barracks: 5, academy: 13, market: 5 },
            { main: 25, storage: 10, hide: 10 },
            { lumber: 15, ironer: 10, storage: 13, docks: 10, farm: 15 },
            { academy: 30 }, { storage: 23 },
            { storage: 25, market: 15, temple: 5, academy: 36, trade_office: 1 },
            { farm: 45 }, { storage: 35 }, { barracks: 15 }, { market: 30 },
            { lumber: 40, stoner: 40, ironer: 40 }, { theater: 1 },
            { temple: 30 }, { docks: 30, barracks: 30 },
        ],
        'MAX ΛΟΥΤΡΑ': [
            { barracks: 5, academy: 13, market: 5 },
            { main: 25, storage: 10, hide: 10 },
            { lumber: 15, ironer: 10, storage: 13, docks: 10, farm: 15 },
            { academy: 30 }, { storage: 23 },
            { storage: 25, market: 15, temple: 5, academy: 36, trade_office: 1 },
            { farm: 45 }, { thermal: 1 }, { storage: 35 }, { barracks: 15 },
            { market: 30 }, { lumber: 40, stoner: 40, ironer: 40 },
            { temple: 30 }, { docks: 30, barracks: 30 },
        ],
    };

    const researchSchematicTargets = {
        'ΦΑΡΟΙ':    [{ town_guard:true, booty:true, pottery:true, architecture:true, building_crane:true, espionage:true, plow:true, mathematics:true, cartography:true, combat_experience:true, strong_wine:true, shipwright:true, phalanx:true, ram:true, attack_ship:true, colonize_ship:true, take_over:true }],
        'ΑΜΥΝΤΙΚΗ': [{ berth:true, town_guard:true, booty:true, pottery:true, architecture:true, building_crane:true, espionage:true, plow:true, mathematics:true, cartography:true, combat_experience:true, strong_wine:true, shipwright:true, phalanx:true, ram:true, hoplite:true, instructor:true, conscription:true, archer:true, colonize_ship:true, take_over:true, small_transporter:true }],
        'ΟΠΛΙΤΕΣ':  [{ berth:true, town_guard:true, booty:true, pottery:true, architecture:true, building_crane:true, espionage:true, plow:true, mathematics:true, cartography:true, combat_experience:true, strong_wine:true, shipwright:true, phalanx:true, ram:true, hoplite:true, instructor:true, conscription:true, colonize_ship:true, take_over:true, small_transporter:true, attack_ship:true, catapult:true, trireme:true, breach:true }],
        'ΣΦΕΝΤΟΝΕΣ':[{ berth:true, town_guard:true, booty:true, pottery:true, architecture:true, building_crane:true, espionage:true, plow:true, mathematics:true, cartography:true, combat_experience:true, strong_wine:true, shipwright:true, phalanx:true, ram:true, slinger:true, instructor:true, conscription:true, colonize_ship:true, take_over:true, small_transporter:true, attack_ship:true, catapult:true, trireme:true, breach:true }],
        'ΑΛΟΓΑ':    [{ berth:true, town_guard:true, booty:true, pottery:true, architecture:true, building_crane:true, espionage:true, plow:true, mathematics:true, cartography:true, combat_experience:true, strong_wine:true, shipwright:true, phalanx:true, ram:true, rider:true, instructor:true, conscription:true, colonize_ship:true, take_over:true, small_transporter:true, attack_ship:true, catapult:true, trireme:true, breach:true }],
        'ΔΙΗΡΕΙΣ':  [{ town_guard:true, booty:true, pottery:true, architecture:true, building_crane:true, espionage:true, plow:true, mathematics:true, cartography:true, combat_experience:true, strong_wine:true, shipwright:true, phalanx:true, ram:true, bireme:true, attack_ship:true, demolition_ship:true, colonize_ship:true, take_over:true }],
        'other':    [{ berth:true, town_guard:true, booty:true, pottery:true, architecture:true, building_crane:true, espionage:true, plow:true, mathematics:true, cartography:true, combat_experience:true, strong_wine:true, shipwright:true, phalanx:true, ram:true, instructor:true, conscription:true, colonize_ship:true, take_over:true }],
    };


    // ════════════════════════════════════════════════════════════════
    //  § 11  FESTIVAL STATE
    // ════════════════════════════════════════════════════════════════

    let Festivals            = new Set();
    let ActivePartyCloseToEnd = new Set();

    function updateFestivalEligibleTowns() {
        Festivals             = new Set();
        ActivePartyCloseToEnd = new Set();
        const speed         = Number(uw.Game?.game_speed) || 1;
        const closeToEndTime = (24 * 60 * 60 / speed) * 0.20;
        const nowUnix        = Date.now() / 1000;
        const celebrations   = Object.values(uw.MM.getModels().Celebration || {});
        const townsWithParty = new Set();

        celebrations.forEach(c => {
            if (c.attributes?.celebration_type !== 'party') return;
            const tid  = Number(c.attributes.town_id);
            townsWithParty.add(tid);
            const town = uw.ITowns.towns[tid];
            if (!town) return;
            const { wood, stone, iron } = town.resources();
            if (c.attributes.finished_at < nowUnix + closeToEndTime
                && wood >= 15000 && stone >= 18000 && iron >= 15000) {
                ActivePartyCloseToEnd.add(tid);
            }
        });

        Object.keys(uw.ITowns.towns).forEach(tidStr => {
            const tid  = Number(tidStr);
            if (townsWithParty.has(tid)) return;
            const town = uw.ITowns.towns[tid];
            if (!town) return;
            const { academy, storage } = town.buildings().attributes || {};
            if (academy >= 30 && storage >= 23) Festivals.add(tid);
        });

        if (Festivals.size > 0 || ActivePartyCloseToEnd.size > 0)
            console.log(`[Festival] ${Festivals.size} party-eligible | ${ActivePartyCloseToEnd.size} close-to-end`);
    }

    setInterval(updateFestivalEligibleTowns, 1000 * 60 * 5);

    function refreshTownFestivalState(townId) {
        const tid  = Number(townId);
        Festivals.delete(tid);
        ActivePartyCloseToEnd.delete(tid);
        const speed          = Number(uw.Game?.game_speed) || 1;
        const closeToEndTime  = (24 * 60 * 60 / speed) * 0.20;
        const nowUnix         = Date.now() / 1000;
        const town            = uw.ITowns.towns[tid];
        if (!town) return;
        const celebrations    = Object.values(uw.MM.getModels().Celebration || {});
        const townParty       = celebrations.find(
            c => c.attributes?.celebration_type === 'party' && Number(c.attributes.town_id) === tid
        );
        if (townParty) {
            const { wood, stone, iron } = town.resources();
            if (townParty.attributes.finished_at < nowUnix + closeToEndTime
                && wood >= 15000 && stone >= 18000 && iron >= 15000)
                ActivePartyCloseToEnd.add(tid);
        } else {
            const { academy, storage } = town.buildings().attributes || {};
            if (academy >= 30 && storage >= 23) Festivals.add(tid);
        }
    }

    function isFestivalSkip(townId) {
        if (Festivals.has(Number(townId))) return true;
        if (!ActivePartyCloseToEnd.has(Number(townId))) {
            const celebrations = Object.values(uw.MM.getModels().Celebration || {});
            return celebrations.some(c =>
                c.attributes?.celebration_type === 'party'
                && c.attributes.town_id === Number(townId)
                && c.attributes.finished_at < (Date.now() / 1000) + (24 * 60 * 60 / (uw.Game?.game_speed || 1)) * 0.20
            );
        }
        return false;
    }

    function wouldBreachPartyThreshold(townId, resourceCost) {
        if (!ActivePartyCloseToEnd.has(Number(townId))) return false;
        const res = uw.ITowns.towns[townId].resources();
        return (res.wood  - (resourceCost.wood  || 0)) < 15000
            || (res.stone - (resourceCost.stone || 0)) < 18000
            || (res.iron  - (resourceCost.iron  || 0)) < 15000;
    }


    // ════════════════════════════════════════════════════════════════
    //  § 12  CSS  (all styles in one place)
    // ════════════════════════════════════════════════════════════════

    GM_addStyle(`
        /* ── Senate build panel ── */
        .custom-senate-build-panel {
            position: absolute !important;
            z-index: 1005 !important;
            bottom: -20px;
            right: -10px;
            width: 230px;
            max-height: 17vh;
            overflow-y: auto;
            background: #f8f1d9;
            border: 2px solid #8b5a2b;
            border-radius: 8px;
            padding: 10px 10px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: Arial, Helvetica, sans-serif;
            color: #3c220a;
        }
        .custom-senate-build-panel h3 { margin: 0 0 10px; text-align: center; color: #5c3a1a; font-size: 14px; }

        /* ── Academy research panel ── */
        .custom-academy-panel {
            position: absolute !important;
            z-index: 1005 !important;
            bottom: 8px !important;
            right: 8px !important;
            width: 230px;
            max-height: 17vh;
            overflow-y: auto;
            background: #f8f1d9;
            border: 2px solid #8b5a2b;
            border-radius: 8px;
            padding: 10px 10px 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: Arial, Helvetica, sans-serif;
            color: #3c220a;
            pointer-events: auto;
        }
        .custom-academy-panel h3 { margin: 0 0 10px; text-align: center; color: #5c3a1a; font-size: 14px; }

        /* ── Shared panel internals ── */
        .toggle-row {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; margin: 10px 0; font-weight: bold; font-size: 12px; flex-wrap: nowrap;
        }
        .toggle-row label { white-space: nowrap; }
        .schematics-select-row {
            display: flex; align-items: center; gap: 8px; margin: 8px 0;
            font-weight: bold; font-size: 12px;
        }
        .schematics-select-row label { white-space: nowrap; }
        .schematics-select {
            padding: 4px; font-size: 12px; border: 1px solid #8b5a2b;
            border-radius: 4px; background: #fff8e1; flex: 1; min-width: 0;
        }
        .planned-queue-box {
            margin: 8px 0 12px; padding: 8px; background: #e8d9b0;
            border: 1px solid #c9a875; border-radius: 6px; max-height: 140px;
            overflow-y: auto; overflow-x: hidden; scroll-behavior: smooth;
        }
        .planned-queue-box h4 { margin: 0 0 6px; font-size: 12px; text-align: center; color: #5c3a1a; }
        .planned-empty { text-align: center; color: #666; font-style: italic; padding: 8px 0; font-size: 11px; }

        /* ── Senate build queue items ── */
        .planned-queue { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; padding-right: 4px; }
        .planned-item {
            position: relative; width: 40px; height: 40px; cursor: pointer;
            border-radius: 4px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        }
        .planned-item.upgrade   { border: 2px solid #90ee90; }
        .planned-item.downgrade { border: 2px solid #ff6347; }
        .planned-item.invalid   { border: 2px solid #ff0000 !important; opacity: 0.6; }
        .planned-item .item_icon { width: 100%; height: 100%; }
        .planned-item .building_level {
            position: absolute; bottom: -2px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.7); color: white; font-size: 11px; font-weight: bold;
            padding: 1px 6px; border-radius: 8px; white-space: nowrap; text-shadow: 0 0 3px black;
        }
        .planned-item.upgrade   .building_level { background: rgba(0,128,0,0.9); }
        .planned-item.downgrade .building_level { background: rgba(139,0,0,0.9); }

        /* ── Senate building arrows ── */
        .arrow-container {
            display: inline-flex; align-items: center; gap: 4px;
            flex-wrap: nowrap; white-space: nowrap; margin-left: 8px;
        }
        .arrow-btn-game {
            width: 22px; height: 22px; font-size: 14px; line-height: 1;
            background: #6b8e23; color: white; border: none; border-radius: 4px; cursor: pointer;
        }
        .arrow-btn-game.down { background: #a52a2a; }
        .arrow-btn-game:disabled { background: #999; cursor: not-allowed; opacity: 0.6; }
        .arrow-btn-game:hover:not(:disabled) { opacity: 0.85; }
        .test-arrows {
            position: absolute; bottom: -40px; right: 0px;
            display: flex; gap: 2px; z-index: 10;
        }
        .test-arrows button {
            padding: 1px 5px; font-size: 11px; min-width: 20px;
            background: #6b8e23; color: white; border: 1px solid #4a6c18;
            border-radius: 3px; cursor: pointer;
        }
        .test-arrows button.down { background: #a52a2a; border-color: #7a1e1e; }
        .test-arrows button:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Academy research queue items ── */
        .queue-items { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding-right: 4px; }
        .queued-item {
            width: 42px; height: 42px; border-radius: 6px; position: relative; cursor: pointer;
            overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            display: flex; align-items: center; justify-content: center;
            padding: 0; box-sizing: border-box;
        }
        .queued-item.up   { border: 3px solid #90ee90 !important; }
        .queued-item.down { border: 3px solid #ff6347 !important; }
        .queued-item .item_icon.research_icon.research40x40 {
            width: 40px !important; height: 40px !important; margin: 0;
        }

        /* ── Academy research arrows ── */
        .obs-arrow-small {
            position: absolute; bottom: 30px; right: 10px; display: flex; gap: 3px; z-index: 15;
        }
        .obs-arrow-small button {
            width: 18px; height: 18px; font-size: 11px; line-height: 1;
            color: white; border: none; border-radius: 3px; cursor: pointer;
        }
        .obs-arrow-small button.up   { background: #6b8e23; }
        .obs-arrow-small button.down { background: #a52a2a; }
        .obs-arrow-small button:disabled,
        .obs-arrow-small button[disabled] {
            opacity: 0.45 !important; filter: grayscale(70%);
            box-shadow: none !important; cursor: not-allowed !important;
        }

        /* ── Town list status icons ── */
        .autobuild-status-icon, .schematics-status-icon,
        .autoresearch-status-icon, .schematics-research-status-icon,
        .autohide-status-icon, .autohide-trade-status-icon,
        .custom-recruit-icon {
            display: inline-block; vertical-align: middle; margin-left: 3px;
            transform: scale(0.7); transform-origin: center center;
        }
        .town_name { display: inline-flex; align-items: center; gap: 0px; flex-wrap: nowrap; }

        /* ── Auto-Hide panel ── */
        .custom-hide-panel {
            position: absolute; z-index: 1005;
            bottom: 200px; right: 400px;
            width: 400px; min-height: 80px; box-sizing: border-box;
            background: #f8f1d9; border: 2px solid #8b5a2b;
            border-radius: 8px; padding: 12px 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: Arial, Helvetica, sans-serif; color: #3c220a; font-size: 12px;
        }
        .custom-hide-panel h3 { margin: 0 0 10px; text-align: center; color: #5c3a1a; font-size: 14px; }
        .hide-toggle-row {
            display: flex; align-items: center; justify-content: space-between;
            font-weight: bold; font-size: 12px;
        }
        .hide-input-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; }
        .hide-input-row label { white-space: nowrap; font-weight: bold; }
        .hide-capacity-input {
            flex: 1; min-width: 0; padding: 3px 6px; font-size: 12px;
            border: 1px solid #8b5a2b; border-radius: 4px; background: #fff8e1; box-sizing: border-box;
        }
        .hide-capacity-input:disabled { opacity: 0.45; cursor: not-allowed; }
        .hide-trade-cycle-info { margin-top: 4px; font-size: 11px; color: #7a4a1a; font-style: italic; }

        /* ── Auto-Troop UI ── */
        .town-recruit-active { background-color: #90EE90 !important; }
        .troop-dropdown-container {
            position: absolute; z-index: 1000;
            font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; color: #000;
            display: flex; flex-direction: row; gap: 15px; align-items: flex-start;
            top: 380px; left: 20px;
        }
        .controls-container { display: flex; flex-direction: column; gap: 10px; max-width: 250px; }
        .troop-dropdown, .troop-input, .troop-button {
            padding: 5px; border-radius: 5px; background-color: #f0e5c5;
            border: 1px solid #8b5a2b; font-family: Arial, sans-serif;
            font-size: 14px; font-weight: bold; color: #000;
        }
        .troop-dropdown { cursor: pointer; }
        .troop-input    { width: 100px; text-align: center; }
        .troop-button   { cursor: pointer; margin-right: 4px; }
        .troop-button.save  { background-color: #d4a017; }
        .troop-button.add   { background-color: #8b5a2b; color: #fff; }
        .troop-button.clear { background-color: #a83232; color: #fff; }
        .troop-display-container { display: flex; flex-direction: column; gap: 5px; max-width: 260px; position: relative; }
        .recruit-toggle-container {
            display: flex; align-items: center; gap: 10px;
            position: absolute; top: 80px; left: 260px;
            z-index: 1001; flex-direction: column;
        }
        .recruit-toggle-label { font-size: 12px; color: #4a2b0f; }
        .recruit-toggle {
            width: 40px; height: 30px; background-color: #ccc;
            border-radius: 10px; position: absolute; cursor: pointer; top: 20px; left: 20px;
        }
        .recruit-toggle input { display: none; }
        .recruit-toggle label {
            width: 25px; height: 25px; background-color: #fff; border-radius: 50%;
            position: absolute; top: 2px; left: 2px; transition: 0.2s;
        }
        .recruit-toggle input:checked + label { left: 12px; background-color: #8b5a2b; }
        .troop-display-section {
            background-color: #f0e5c5; border: 1px solid #8b5a2b;
            border-radius: 5px; padding: 5px;
        }
        .troop-display-section h4 { margin: 0 0 5px 0; font-size: 12px; color: #4a2b0f; }
        .troop-display-list { display: flex; flex-wrap: wrap; gap: 6px; }
        .troop-display-item { position: relative; display: inline-block; }
        .troop-display-icon { width: 50px; height: 50px; background-size: 50px 50px; position: relative; }
        .troop-display-quantity {
            position: absolute; bottom: 2px; right: 2px; font-size: 11px;
            font-weight: bold; color: #fff; text-shadow: 1px 1px 1px #000;
        }
        [id^="gpwnd_"] { overflow: visible !important; }
        .game_border, .window_content, .gpwindow_content, .barracks_building, .docks_building {
            overflow: visible !important;
        }
        .button-container { display: flex; justify-content: flex-start; margin-left: -27px; }

        /* ── Toast ── */
        @keyframes slideIn {
            from { transform: translateX(120%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
        }

        /* ── Stats tab ── */
        .stats-counter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
        .stats-card { background: #fff8e1; border: 1px solid #c9a875; border-radius: 6px; padding: 8px 12px; }
        .stats-card-title { font-size: 10px; color: #999; text-transform: uppercase; margin-bottom: 4px; }
        .stats-card-val   { font-size: 20px; font-weight: bold; color: #3a2a12; }
        .stats-card-sub   { font-size: 11px; color: #888; margin-top: 2px; }
        .stats-section-title {
            font-size: 12px; font-weight: bold; color: #5c3a1a;
            border-bottom: 1px solid rgba(90,59,18,0.25);
            padding-bottom: 4px; margin: 12px 0 8px;
            text-transform: uppercase; letter-spacing: 0.4px;
        }
        .stats-chart-wrap { background: #fff8e1; border: 1px solid #c9a875; border-radius: 6px; padding: 10px 10px 4px; margin-bottom: 12px; }
        .stats-chart-bar-row { display: flex; align-items: flex-end; gap: 3px; height: 60px; margin-bottom: 4px; }
        .stats-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; }
        .stats-chart-bar { width: 100%; border-radius: 3px 3px 0 0; min-height: 2px; transition: height 0.3s; }
        .stats-chart-label { font-size: 9px; color: #aaa; margin-top: 2px; }
        .stats-troop-row {
            display: flex; align-items: center; gap: 8px; padding: 4px 0;
            border-bottom: 1px solid rgba(0,0,0,0.06); font-size: 12px;
        }
        .stats-troop-row:last-child { border-bottom: none; }
        .stats-reset-btn {
            background: #a83232; color: #fff; border: none; border-radius: 5px;
            padding: 7px 14px; font-size: 12px; cursor: pointer; margin-top: 8px;
        }
        .stats-reset-btn:hover { background: #8b2222; }

        /* ── Alerts tab ── */
        .alert-cfg-row {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.08);
            font-size: 12px; color: #4a2b0f;
        }
        .alert-cfg-row:last-child { border-bottom: none; }
        .alert-cfg-row label { flex: 1; }
        .alert-cfg-row input[type="checkbox"] { accent-color: #6b8e23; width:16px; height:16px; }
        .alert-cfg-row input[type="number"]   {
            width: 56px; padding: 3px 5px; font-size: 12px;
            border: 1px solid #8b5a2b; border-radius: 4px; background: #fff; text-align: right;
        }
        .alert-log-entry { padding: 5px 8px; border-radius: 5px; margin-bottom: 5px; font-size: 12px; line-height: 1.4; }
        .alert-log-entry.warn   { background: #fff3cd; border-left: 3px solid #c8860a; color: #7a5000; }
        .alert-log-entry.danger { background: #fde8e8; border-left: 3px solid #c0392b; color: #7a1010; }
        .alert-log-entry.info   { background: #dbeafe; border-left: 3px solid #2471a3; color: #14426a; }
        .alert-log-time { font-size: 10px; opacity: 0.7; margin-right: 4px; }
        .alert-save-btn {
            display:block; width:100%; padding:8px; margin-top:10px;
            background:#6b8e23; color:#fff; font-weight:bold; font-size:12px;
            border:none; border-radius:6px; cursor:pointer;
        }
        .alert-save-btn:hover { background: #557a1a; }

        /* ── 5 λέπτα tab ── */
        .fivemin-input { width:100%; padding:5px 8px; font-size:12px; box-sizing:border-box;
            border:1px solid #8b5a2b; border-radius:4px; background:#fff; color:#3a2a12; margin-top:3px; margin-bottom:8px; }
        .fivemin-btn { padding:7px 10px; font-size:12px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; }
        .fivemin-btn.green  { background:#4caf50; color:#fff; }
        .fivemin-btn.red    { background:#c62828; color:#fff; }
        .fivemin-btn.blue   { background:#4a6fa5; color:#fff; }
        .fivemin-btn.purple { background:#7f5a83; color:#fff; }
        .fivemin-btn:hover  { opacity:0.85; }
        .fivemin-btn:disabled { opacity:0.4; cursor:not-allowed; }
        .fivemin-unit-btn {
            display:block; width:100%; margin-bottom:6px; padding:7px 10px;
            background:#3a5a8a; color:#fff; border:none; border-radius:5px;
            cursor:pointer; font-size:12px; text-align:left;
        }
        .fivemin-unit-btn.selected { background:#4caf50; }
        .fivemin-unit-btn:hover    { opacity:0.85; }
        .fivemin-status { padding:7px 10px; border-radius:5px; margin-bottom:10px;
            font-size:12px; background:#fff8e1; border:1px solid #c9a875; color:#4a2b0f; }
        .fivemin-attack-row {
            display:flex; align-items:center; padding:5px 8px;
            background:#fff8e1; border-radius:4px; margin-bottom:5px;
            font-size:11px; border:1px solid #c9a875; gap:6px;
        }
        .fivemin-timer { color:#8b5a2b; font-weight:bold; min-width:70px; text-align:right; }
        .fivemin-section-title {
            font-size:11px; font-weight:bold; color:#5c3a1a; text-transform:uppercase;
            letter-spacing:0.4px; border-bottom:1px solid rgba(90,59,18,0.25);
            padding-bottom:4px; margin:10px 0 7px;
        }

        /* ── Alliance tab ── */
        .alliance-setup-box { background: #fff8e1; border: 1px solid #c9a875; border-radius: 6px; padding: 12px; margin-bottom: 10px; }
        .alliance-setup-box input[type="text"] {
            width: 100%; padding: 5px 8px; font-size: 12px; box-sizing: border-box;
            border: 1px solid #8b5a2b; border-radius: 4px; background: #fff; color: #3a2a12;
            margin-top: 4px; margin-bottom: 8px;
        }
        .alliance-action-btn { padding: 7px 14px; font-size: 12px; font-weight: bold; border: none; border-radius: 5px; cursor: pointer; margin-right: 6px; margin-top: 4px; }
        .alliance-action-btn.green  { background: #6b8e23; color: #fff; }
        .alliance-action-btn.brown  { background: #8b5a2b; color: #fff; }
        .alliance-action-btn.red    { background: #a83232; color: #fff; }
        .alliance-action-btn.blue   { background: #2471a3; color: #fff; }
        .alliance-action-btn:hover  { opacity: 0.85; }
        .alliance-status-bar { font-size: 11px; padding: 6px 10px; border-radius: 5px; margin-bottom: 10px; font-weight: bold; }
        .alliance-status-bar.connected    { background: #1a3a1a; color: #88ee88; }
        .alliance-status-bar.disconnected { background: #3a2010; color: #ee8844; }
        .alliance-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .alliance-table th {
            background: #3b2510; color: #c9a875; padding: 6px 4px; text-align: center;
            position: sticky; top: -12px; z-index: 2; font-size: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .alliance-table th:first-child { text-align: left; padding-left: 8px; }
        .alliance-table td { padding: 5px 4px; text-align: center; border-bottom: 1px solid rgba(0,0,0,0.08); color: #3a2a12; font-size: 11px; }
        .alliance-table td:first-child { text-align: left; padding-left: 8px; font-weight: bold; }
        .alliance-table tr:hover td { background: rgba(139,90,43,0.07); }
        .alliance-updated { font-size: 10px; color: #aaa; }
        .alliance-copy-box { background: #e8f4e8; border: 1px solid #6b8e23; border-radius: 5px; padding: 8px 10px; margin-top: 8px; font-size: 11px; color: #1a3a1a; word-break: break-all; }
        .alliance-copy-box strong { display: block; margin-bottom: 4px; color: #3a6a1a; }

        /* ── Master Window Tabs ── */
        #masterWindow { position: absolute; inset: 0; display: flex; flex-direction: column; background: #f8f1d9; font-family: Arial, Helvetica, sans-serif; overflow: hidden; }
        #masterWindow .tab-bar { display: flex; flex-shrink: 0; flex-wrap: wrap; background: #3b2510; border-bottom: 2px solid #8b5a2b; }
        #masterWindow .tab-btn {
            flex: 1; min-width: 20%; padding: 7px 2px; font-size: 10px; font-weight: bold;
            color: #c9a875; background: transparent; border: none; cursor: pointer;
            border-bottom: 3px solid transparent; transition: all 0.15s; white-space: nowrap;
        }
        #masterWindow .tab-bar .tab-row-divider { width: 100%; height: 1px; background: #5a3a1a; flex-shrink: 0; }
        #masterWindow .tab-btn:hover  { color: #fff; background: rgba(255,255,255,0.07); }
        #masterWindow .tab-btn.active { color: #fff; border-bottom: 3px solid #6b8e23; }
        #masterWindow .tab-pane { display: none; flex: 1; overflow-y: auto; padding: 12px 14px 16px; }
        #masterWindow .tab-pane.active { display: block; }

        /* ── Status tab ── */
        .status-state-box { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; font-weight: bold; font-size: 13px; }
        .status-state-box .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
        .status-state-box.sleeping { background: #1a2a4a; color: #7ab0ff; }
        .status-state-box.sleeping .dot { background: #4488ff; box-shadow: 0 0 6px #4488ff; }
        .status-state-box.paused  { background: #3a2a00; color: #ffd966; }
        .status-state-box.paused  .dot { background: #ffcc00; box-shadow: 0 0 6px #ffcc00; }
        .status-state-box.active  { background: #1a3a1a; color: #88ee88; }
        .status-state-box.active  .dot { background: #44cc44; box-shadow: 0 0 6px #44cc44; }
        .status-card { background: #fff8e1; border: 1px solid #c9a875; border-radius: 6px; padding: 9px 12px; margin-bottom: 8px; }
        .status-card-title { font-size: 11px; color: #888; margin-bottom: 5px; text-transform: uppercase; }
        .status-card-value { font-size: 14px; font-weight: bold; color: #3a2a12; }
        .status-log-entry { font-size: 11px; color: #555; padding: 3px 0; border-bottom: 1px solid rgba(0,0,0,0.06); }

        /* ── Town Overview tab ── */
        .town-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .town-table th {
            background: #3b2510; color: #c9a875; padding: 8px 5px; text-align: center;
            font-size: 11px; position: sticky; top: -12px; z-index: 2;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .town-table th:first-child { text-align: left; padding-left: 8px; }
        .town-table td { padding: 5px; text-align: center; border-bottom: 1px solid rgba(0,0,0,0.08); color: #3a2a12; }
        .town-table td:first-child { text-align: left; padding-left: 8px; font-weight: bold; }
        .town-table tr:hover td { background: rgba(139,90,43,0.07); }
        .feature-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ddd; }
        .feature-dot.on { background: #44cc44; box-shadow: 0 0 4px #44cc44; }

        /* ── Config Panel ── */
        #masterConfigPanel { font-family: Arial, Helvetica, sans-serif; color: #3a2a12; background: #f8f1d9; box-sizing: border-box; }
        #masterConfigPanel .cfg-section { background: #fff8e1; border: 1px solid #c9a875; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
        #masterConfigPanel .cfg-section-title { font-size: 13px; font-weight: bold; color: #5c3a1a; border-bottom: 1px solid rgba(90,59,18,0.3); padding-bottom: 5px; margin-bottom: 9px; }
        #masterConfigPanel .cfg-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; font-size: 12px; }
        #masterConfigPanel .cfg-row label { flex: 1; color: #4a2b0f; }
        #masterConfigPanel .cfg-row input[type="number"] { width: 68px; padding: 3px 5px; font-size: 12px; border: 1px solid #8b5a2b; border-radius: 4px; background: #fff; color: #3a2a12; text-align: right; }
        #masterConfigPanel .cfg-row input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; accent-color: #6b8e23; }
        #masterConfigPanel .cfg-unit { font-size: 11px; color: #999; min-width: 32px; text-align: left; }
        #masterConfigPanel .cfg-save-btn { display: block; width: 100%; padding: 9px; margin-top: 6px; background: #6b8e23; color: #fff; font-weight: bold; font-size: 13px; border: none; border-radius: 6px; cursor: pointer; }
        #masterConfigPanel .cfg-save-btn:hover { background: #557a1a; }
        #masterConfigPanel .cfg-saved-msg { text-align: center; color: #3a7a1a; font-size: 12px; font-weight: bold; margin-top: 7px; min-height: 16px; }

        .barracks .btn_recruit, .harbor .btn_recruit,
        .barracks .confirm, .harbor .confirm {
            width: 100px !important; height: 40px !important;
            font-size: 16px !important; padding: 8px !important; line-height: 24px !important;
        }
        .resource-info-box {
            background-color: #f0e5c5; border: 1px solid #8b5a2b; border-radius: 5px;
            padding: 10px; font-family: Arial, sans-serif; font-size: 12px; color: #4a2b0f;
            min-width: 160px; max-width: 200px;
            position: absolute; top: 60px; left: 360px; z-index: 1001;
        }
        .resource-info-box h4 { margin: 0 0 8px 0; font-size: 12px; color: #4a2b0f; }
        .resource-info-box .resource-container { display: flex; flex-direction: column; gap: 10px; }
        .resource-info-box .resource-row { display: flex; align-items: center; gap: 8px; }
        .resource-info-box .unit_order_res { width: 18px; height: 18px; vertical-align: middle; }
        .resource-info-box .resource-amount { font-size: 12px; font-weight: bold; color: #4a2b0f; }
    `);


    // ════════════════════════════════════════════════════════════════
    //  § 13  TRADE HELPERS  (shared by AutoHide-Trade & AutoTroop)
    //  Previously these existed as two near-identical sets of functions
    //  with different naming conventions. Unified here.
    // ════════════════════════════════════════════════════════════════

    /** All incoming trades to a specific town */
    function filterTradesByTown(townId) {
        return Object.values(uw.MM.getModels().Trade || {})
            .filter(t => t.attributes.destination_town_id === townId);
    }

    /** Trade arriving soonest from a list */
    function findMinArrivalTrade(trades) {
        return trades.reduce((min, cur) =>
            cur.attributes.arrival_at < min.attributes.arrival_at ? cur : min
        );
    }

    /** Towns (owned) that have any incoming non-farm trade */
    function getTownsWithIncomingTrades() {
        const trades = Object.values(uw.MM.getModels().Trade || {});
        const s = new Set();
        trades.forEach(t => s.add(t.attributes.destination_town_id));
        return s;
    }

    /**
     * Returns { isOverflow, resource } indicating whether the next trade
     * will push the dominant resource over storage by >3.5%.
     */
    function getNextTradeOverflow(trade, townId) {
        const { iron: ironTrade, wood: woodTrade, stone: stoneTrade } = trade.attributes;
        const townRss  = uw.ITowns.towns[townId].resources();
        const storage  = uw.ITowns.towns[townId].getStorage();
        const incoming = { iron: ironTrade, wood: woodTrade, stone: stoneTrade };
        let maxResource = null, maxValue = -Infinity;
        for (const [res, val] of Object.entries(incoming)) {
            if (val > maxValue) { maxResource = res; maxValue = val; }
        }
        const after    = townRss[maxResource] + maxValue;
        const overflow = (after - storage) / storage;
        return overflow > 0.035
            ? { isOverflow: true,  resource: maxResource }
            : { isOverflow: false, resource: null };
    }

    /** True if an incoming iron trade would overflow storage */
    function wouldTradeOverflowStorage(trade, townId) {
        return (uw.ITowns.towns[townId].resources().iron + (trade.attributes.iron || 0))
            > uw.ITowns.towns[townId].getStorage();
    }

    // ══════════════════════════════════════════════════════════════
    //  SENATE UI
    // ══════════════════════════════════════════════════════════════

    let isSenateOpen = false;

    function getCurrentBuildingLevels(townId) {
        const town = uw.ITowns?.towns?.[townId];
        if (!town) return {};
        return town.buildings()?.attributes || {};
    }

    function getBuildingLevelsAfterQueue(townId) {
        const real = getCurrentBuildingLevels(townId);
        let sim = {
            ...real
        };
        const orders = uw.ITowns.towns[townId].buildingOrders()?.models || [];
        orders.forEach(o => {
            const attr = o.attributes;
            const b = attr.building_type;
            sim[b] = attr.tear_down ? (sim[b] || 0) - 1 : (sim[b] || 0) + 1;
        });
        return sim;
    }

    function pruneCompletedBuilds(queue, townId) {
        const sim = getBuildingLevelsAfterQueue(townId);
        let i = 0;
        while (i < queue.length) {
            const s = queue[i];
            const cur = sim[s.building] ?? 0;
            if (s.level == null || (s.dir === 'upgrade' && s.level <= cur) || (s.dir === 'downgrade' && s.level >= cur)) {
                queue.splice(i, 1);
            } else {
                sim[s.building] = s.dir === 'upgrade' ? cur + 1 : cur - 1;
                i++;
            }
        }
    }

    function sanitizeBuildQueue(queue, townId) {
        const sim = getBuildingLevelsAfterQueue(townId);
        pruneCompletedBuilds(queue, townId);
        const newQ = [];
        for (const step of queue) {
            const futureLevel = step.dir === 'upgrade' ? (sim[step.building] ?? 0) + 1 : (sim[step.building] ?? 0) - 1;
            const gb = uw.GameData?.buildings?.[step.building];
            if (!gb) continue;
            const max = Number(gb.max_level) || 30;
            const min = Number(gb.min_level) || 0;
            const levelOk = step.dir === 'upgrade' ? futureLevel <= max : futureLevel >= min;
            let depsOk = true;
            if (step.dir === 'upgrade') {
                for (const [dep, req] of Object.entries(gb.dependencies || {})) {
                    if ((sim[dep] ?? 0) < req) {
                        depsOk = false;
                        break;
                    }
                }
            }
            if (levelOk && depsOk) {
                newQ.push(step);
                sim[step.building] = futureLevel;
                step.level = futureLevel;
            }
        }
        queue.length = 0;
        queue.push(...newQ);
    }

    function canAddBuildStep(newStep, queue, townId) {
        let sim = getBuildingLevelsAfterQueue(townId);
        for (const s of queue) {
            sim[s.building] = s.dir === 'upgrade' ? (sim[s.building] ?? 0) + 1 : (sim[s.building] ?? 0) - 1;
        }
        const futureLevel = newStep.dir === 'upgrade' ? (sim[newStep.building] ?? 0) + 1 : (sim[newStep.building] ?? 0) - 1;
        const gb = uw.GameData?.buildings?.[newStep.building];
        if (!gb) return false;
        const max = Number(gb.max_level) || 30;
        const min = Number(gb.min_level) || 0;
        if (!(newStep.dir === 'upgrade' ? futureLevel <= max : futureLevel >= min)) return false;
        if (newStep.dir === 'upgrade') {
            for (const [dep, req] of Object.entries(gb.dependencies || {})) {
                if ((sim[dep] ?? 0) < req) return false;
            }
        }
        return true;
    }

    function removeAllBuildArrows() {
        document.querySelectorAll('.arrow-container, .test-arrows').forEach(el => el.remove());
    }

    function addArrowsToBuildingNames(townId) {
        const storage = loadBuildingTargets();
        if (storage[townId]?.schematicsEnabled) {
            removeAllBuildArrows();
            return;
        }
        removeAllBuildArrows();
        const nameSelectors = ['#buildings .name.small.bold', '#buildings .name.bold', '#buildings .name', '#buildings li .building_name', '#buildings li a[onclick]'];
        let nameElements = [];
        for (const sel of nameSelectors) {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) {
                nameElements = Array.from(found);
                break;
            }
        }
        nameElements.forEach(nameDiv => {
            const link = nameDiv.tagName === 'A' ? nameDiv : nameDiv.querySelector('a');
            const clickable = link || nameDiv;
            const onclickAttr = clickable.getAttribute('onclick') || '';
            let buildingKey = null;
            const q1 = onclickAttr.match(/'([a-z_]+)'/);
            const q2 = onclickAttr.match(/"([a-z_]+)"/);
            const q3 = onclickAttr.match(/[,(]\s*([a-z_]+)\s*[,)]/);
            if (q1) buildingKey = q1[1];
            else if (q2) buildingKey = q2[1];
            else if (q3) buildingKey = q3[1];
            if (!buildingKey || !uw.GameData?.buildings?.[buildingKey] || clickable.parentElement?.querySelector('.arrow-container')) return;
            const container = document.createElement('span');
            container.className = 'arrow-container';
            const upBtn = document.createElement('button');
            upBtn.className = 'arrow-btn-game';
            upBtn.textContent = '↑';
            upBtn.disabled = !canAddBuildStep({
                building: buildingKey,
                dir: 'upgrade',
                level: 99
            }, storage[townId]?.queue || [], townId);
            upBtn.onclick = e => {
                e.preventDefault();
                e.stopPropagation();
                let st = loadBuildingTargets();
                let q = st[townId]?.queue || [];
                const step = {
                    building: buildingKey,
                    dir: 'upgrade',
                    level: 99
                };
                if (canAddBuildStep(step, q, townId)) {
                    q.push(step);
                    sanitizeBuildQueue(q, townId);
                    saveBuildingTargets(townId, q, st[townId]?.autoBuild || false, false, st[townId]?.selectedSchematic || '');
                    updateSenatePanel(document.querySelector('.custom-senate-build-panel'), townId);
                }
            };
            const downBtn = document.createElement('button');
            downBtn.className = 'arrow-btn-game down';
            downBtn.textContent = '↓';
            downBtn.disabled = !canAddBuildStep({
                building: buildingKey,
                dir: 'downgrade',
                level: -1
            }, storage[townId]?.queue || [], townId);
            downBtn.onclick = e => {
                e.preventDefault();
                e.stopPropagation();
                let st = loadBuildingTargets();
                let q = st[townId]?.queue || [];
                const step = {
                    building: buildingKey,
                    dir: 'downgrade',
                    level: -1
                };
                if (canAddBuildStep(step, q, townId)) {
                    q.push(step);
                    sanitizeBuildQueue(q, townId);
                    saveBuildingTargets(townId, q, st[townId]?.autoBuild || false, false, st[townId]?.selectedSchematic || '');
                    updateSenatePanel(document.querySelector('.custom-senate-build-panel'), townId);
                }
            };
            container.append(upBtn, downBtn);
            if (link && link.parentElement === nameDiv) link.after(container);
            else clickable.after(container);
        });
        document.querySelectorAll('#special_group_1 .image.special_build, #special_group_2 .image.special_build').forEach(icon => {
            const id = icon.id;
            if (!id || !id.startsWith('special_building_')) return;
            const building = id.replace('special_building_', '');
            if (!uw.GameData?.buildings?.[building] || icon.querySelector('.test-arrows')) return;
            icon.style.position = 'relative';
            const container = document.createElement('span');
            container.className = 'test-arrows';
            const queue = loadBuildingTargets()[townId]?.queue || [];
            const up = document.createElement('button');
            up.textContent = '↑';
            up.disabled = !canAddBuildStep({
                building,
                dir: 'upgrade',
                level: 99
            }, queue, townId);
            up.onclick = e => {
                e.preventDefault();
                e.stopPropagation();
                let st = loadBuildingTargets();
                let q = st[townId]?.queue || [];
                const step = {
                    building,
                    dir: 'upgrade',
                    level: 99
                };
                if (canAddBuildStep(step, q, townId)) {
                    q.push(step);
                    sanitizeBuildQueue(q, townId);
                    saveBuildingTargets(townId, q, st[townId]?.autoBuild || false, false, st[townId]?.selectedSchematic || '');
                    updateSenatePanel(document.querySelector('.custom-senate-build-panel'), townId);
                }
            };
            const down = document.createElement('button');
            down.textContent = '↓';
            down.className = 'down';
            down.disabled = !canAddBuildStep({
                building,
                dir: 'downgrade',
                level: -1
            }, queue, townId);
            down.onclick = e => {
                e.preventDefault();
                e.stopPropagation();
                let st = loadBuildingTargets();
                let q = st[townId]?.queue || [];
                const step = {
                    building,
                    dir: 'downgrade',
                    level: -1
                };
                if (canAddBuildStep(step, q, townId)) {
                    q.push(step);
                    sanitizeBuildQueue(q, townId);
                    saveBuildingTargets(townId, q, st[townId]?.autoBuild || false, false, st[townId]?.selectedSchematic || '');
                    updateSenatePanel(document.querySelector('.custom-senate-build-panel'), townId);
                }
            };
            container.append(up, down);
            icon.appendChild(container);
        });
    }

    function updateSenatePanel(container, townId) {
        if (!townId) return;
        const panelScrollTop = container.scrollTop;
        let storage = loadBuildingTargets();
        let queue = storage[townId]?.queue || [];
        sanitizeBuildQueue(queue, townId);
        saveBuildingTargets(townId, queue, storage[townId]?.autoBuild || false, storage[townId]?.schematicsEnabled || false, storage[townId]?.selectedSchematic || '');
        const oldQueueBox = container.querySelector('.planned-queue-box');
        const scrollTop = oldQueueBox ? oldQueueBox.scrollTop : 0;
        Array.from(container.children).forEach(child => {
            if (child.tagName !== 'H3') child.remove();
        });
        const autoRow = document.createElement('div');
        autoRow.className = 'toggle-row';
        autoRow.innerHTML = `<label>Auto-build enabled</label><input type="checkbox" ${storage[townId]?.autoBuild ? 'checked' : ''}>`;
        autoRow.querySelector('input').onchange = e => {
            saveBuildingTargets(townId, queue, e.target.checked, storage[townId]?.schematicsEnabled || false, storage[townId]?.selectedSchematic || '');
            updateSenatePanel(container, townId);
        };
        container.appendChild(autoRow);
        const queueBox = document.createElement('div');
        queueBox.className = 'planned-queue-box';
        queueBox.innerHTML = '<h4>Planned Queue</h4>';
        const queueContainer = document.createElement('div');
        queueContainer.className = 'planned-queue';
        let hasActions = false;
        queue.forEach((step, idx) => {
            hasActions = true;
            const item = document.createElement('div');
            item.className = `planned-item ${step.dir}`;
            item.title = `Click to remove (${step.dir} to level ${step.level})`;
            item.innerHTML = `<div class="item_icon building_icon40x40 ${step.building} js-item-icon"><div class="building_level">${step.dir === 'upgrade' ? '<span class="construction_queue_sprite arrow_green_ver"></span>' : '<span class="construction_queue_sprite arrow_red_ver"></span>'}${step.level ?? '?'}</div></div>`;
            item.onclick = () => {
                let st = loadBuildingTargets();
                let q = st[townId]?.queue || [];
                q.splice(idx, 1);
                sanitizeBuildQueue(q, townId);
                saveBuildingTargets(townId, q, st[townId]?.autoBuild || false, st[townId]?.schematicsEnabled || false, st[townId]?.selectedSchematic || '');
                updateSenatePanel(container, townId);
            };
            queueContainer.appendChild(item);
        });
        if (!hasActions) queueContainer.innerHTML = '<div class="planned-empty">No actions queued yet</div>';
        queueBox.appendChild(queueContainer);
        container.appendChild(queueBox);
        queueBox.scrollTop = scrollTop;
        const schemToggleRow = document.createElement('div');
        schemToggleRow.className = 'toggle-row';
        const schemToggleLabel = document.createElement('label');
        schemToggleLabel.textContent = 'Auto-Build with Schematics';
        const schemCheckbox = document.createElement('input');
        schemCheckbox.type = 'checkbox';
        schemCheckbox.checked = !!storage[townId]?.schematicsEnabled;
        schemCheckbox.disabled = !(storage[townId]?.selectedSchematic && storage[townId].selectedSchematic !== '-- Select schematic --');
        schemCheckbox.onchange = e => {
            const nv = e.target.checked;
            saveBuildingTargets(townId, nv ? [] : queue, false, nv, storage[townId]?.selectedSchematic || '');
            updateSenatePanel(container, townId);
            nv ? removeAllBuildArrows() : addArrowsToBuildingNames(townId);
        };
        schemToggleRow.append(schemToggleLabel, schemCheckbox);
        container.appendChild(schemToggleRow);
        const selectRow = document.createElement('div');
        selectRow.className = 'schematics-select-row';
        const selectLabel = document.createElement('label');
        selectLabel.textContent = 'Schematic:';
        const select = document.createElement('select');
        select.className = 'schematics-select';
        ['-- Select schematic --', ...Object.keys(buildSchematicTargets)].forEach(txt => {
            const opt = document.createElement('option');
            opt.value = txt;
            opt.textContent = txt;
            if (txt === (storage[townId]?.selectedSchematic || '')) opt.selected = true;
            select.appendChild(opt);
        });
        select.onchange = e => {
            const val = (e.target.value === '-- Select schematic --') ? '' : e.target.value;
            saveBuildingTargets(townId, queue, false, storage[townId]?.schematicsEnabled || false, val);
            updateSenatePanel(container, townId);
        };
        selectRow.append(selectLabel, select);
        container.appendChild(selectRow);
        storage[townId]?.schematicsEnabled ? removeAllBuildArrows() : addArrowsToBuildingNames(townId);
        container.scrollTop = panelScrollTop;
    }

    function createOrRefreshSenateUI() {
        let panel = document.querySelector('.custom-senate-build-panel');
        const townId = uw.Game?.townId;
        if (!townId) return;
        if (panel) {
            updateSenatePanel(panel, townId);
            return;
        }
        panel = document.createElement('div');
        panel.className = 'custom-senate-build-panel';
        const title = document.createElement('h3');
        title.textContent = 'Building Targets';
        panel.appendChild(title);
        const parent = document.querySelector('.gpwindow_content') || document.querySelector('#buildings')?.parentElement || document.body;
        if (parent && !parent.contains(panel)) parent.appendChild(panel);
        updateSenatePanel(panel, townId);
    }


// ════════════════════════════════════════════════════════════════
//  § 14  SENATE UI — wrapped from original
// ════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════
    //  ACADEMY UI
    // ══════════════════════════════════════════════════════════════

    let isAcademyOpen = false;
    let academyMutationObserver = null;
    let _academyDebounceTimer   = null;

    function refreshResearchArrows() {
        const townId = uw.Game?.townId;
        if (!townId) return;
        const entry = getResearchTownEntry(townId);
        const base = getLevelsAfterActiveOrders(townId);
        const simLevels = simulateResearchLevels(base, entry.queue);
        document.querySelectorAll('.obs-arrow-small').forEach(cont => {
            if (cont.closest('.custom-academy-panel')) return;
            const icon = cont.parentElement;
            if (!icon) return;
            const type = getResearchType(icon);
            if (!type) return;
            const upBtn = cont.querySelector('button.up');
            const downBtn = cont.querySelector('button.down');
            if (!upBtn || !downBtn) return;
            const sim = simLevels[type] ?? 0;
            upBtn.disabled = sim >= 1;
            downBtn.disabled = sim <= 0;
        });
    }

    function updateAcademyPanel(panel, townId) {
        if (!panel || !townId) return;
        const panelScrollTop = panel.scrollTop;
        const entry = getResearchTownEntry(townId);
        const liveBase = getLevelsAfterActiveOrders(townId);
        entry.queue = sanitizeResearchQueue(entry.queue, liveBase);
        saveResearchTownEntry(townId, entry);
        const queue = entry.queue || [];
        const oldBox = panel.querySelector('.planned-queue-box');
        const scrollTop = oldBox ? oldBox.scrollTop : 0;
        Array.from(panel.children).forEach(c => {
            if (c.tagName !== 'H3') c.remove();
        });
        const autoRow = document.createElement('div');
        autoRow.className = 'toggle-row';
        autoRow.innerHTML = `<label>Auto-research</label><input type="checkbox" ${entry.autoResearch ? 'checked' : ''}>`;
        autoRow.querySelector('input').onchange = e => {
            saveAcademyTargets(townId, queue, e.target.checked, entry.schematicsEnabled, entry.selectedSchematic);
            updateAcademyPanel(panel, townId);
        };
        panel.appendChild(autoRow);
        const queueBox = document.createElement('div');
        queueBox.className = 'planned-queue-box';
        queueBox.innerHTML = '<h4>Planned Queue</h4>';
        const queueContainer = document.createElement('div');
        queueContainer.className = 'queue-items';
        if (queue.length === 0) {
            queueContainer.innerHTML = '<div class="planned-empty">No researches queued yet</div>';
        } else {
            queue.forEach((item, idx) => {
                const wrapper = document.createElement('div');
                wrapper.className = `queued-item ${item.dir}`;
                wrapper.title = `Click to remove (${item.dir} – ${item.type})`;
                const iconDiv = document.createElement('div');
                iconDiv.className = `item_icon research_icon research40x40 ${item.type} js-item-icon`;
                wrapper.appendChild(iconDiv);
                wrapper.onclick = () => {
                    removeResearchFromQueue(townId, idx);
                    updateAcademyPanel(panel, townId);
                };
                queueContainer.appendChild(wrapper);
            });
        }
        queueBox.appendChild(queueContainer);
        panel.appendChild(queueBox);
        queueBox.scrollTop = scrollTop;
        const schemRow = document.createElement('div');
        schemRow.className = 'toggle-row';
        const schemLabel = document.createElement('label');
        schemLabel.textContent = 'Auto with schematics';
        const schemCb = document.createElement('input');
        schemCb.type = 'checkbox';
        schemCb.checked = !!entry.schematicsEnabled;
        schemCb.disabled = !entry.selectedSchematic;
        schemCb.onchange = e => {
            saveAcademyTargets(townId, e.target.checked ? [] : queue, false, e.target.checked, entry.selectedSchematic);
            updateAcademyPanel(panel, townId);
        };
        schemRow.append(schemLabel, schemCb);
        panel.appendChild(schemRow);
        const selectRow = document.createElement('div');
        selectRow.className = 'schematics-select-row';
        const selectLabel = document.createElement('label');
        selectLabel.textContent = 'Schematic:';
        const select = document.createElement('select');
        select.className = 'schematics-select';
        const blankOpt = document.createElement('option');
        blankOpt.value = '';
        blankOpt.textContent = '-- Select schematic --';
        if (!entry.selectedSchematic) blankOpt.selected = true;
        select.appendChild(blankOpt);
        Object.keys(researchSchematicTargets).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === entry.selectedSchematic) opt.selected = true;
            select.appendChild(opt);
        });
        select.onchange = e => {
            saveAcademyTargets(townId, queue, entry.autoResearch, false, e.target.value);
            updateAcademyPanel(panel, townId);
        };
        selectRow.append(selectLabel, select);
        panel.appendChild(selectRow);
        refreshResearchArrows();
        panel.scrollTop = panelScrollTop;
    }

    function createOrUpdateAcademyPanel() {
        const townId = uw.Game?.townId;
        if (!townId) return;
        let panel = document.querySelector('.custom-academy-panel');
        if (panel) {
            updateAcademyPanel(panel, townId);
            return;
        }
        panel = document.createElement('div');
        panel.className = 'custom-academy-panel';
        const title = document.createElement('h3');
        title.textContent = 'Research Targets';
        panel.appendChild(title);
        let target = document.querySelector('#academy');
        if (!target) {
            for (const cand of document.querySelectorAll('.js-window-content, .window_content')) {
                if (cand.querySelector('.tech_tree_box') || cand.querySelector('.research_icon')) {
                    target = cand;
                    break;
                }
            }
        }
        if (!target) target = document.querySelector('.game_inner_body') || document.body;
        if (window.getComputedStyle(target).position === 'static') target.style.position = 'relative';
        target.appendChild(panel);
        updateAcademyPanel(panel, townId);
    }

    function addArrowsToResearchIcons() {
        const townId = uw.Game?.townId;
        if (!townId) return;
        document.querySelectorAll('.research_icon, .item_icon.research_icon').forEach(icon => {
            if (icon.querySelector('.obs-arrow-small') || icon.closest('.custom-academy-panel') || icon.closest('.researches_queue')) return;
            const type = getResearchType(icon);
            if (!type) return;
            const cont = document.createElement('div');
            cont.className = 'obs-arrow-small';
            const up = document.createElement('button');
            up.className = 'up';
            up.textContent = '↑';
            up.onclick = e => {
                e.stopPropagation();
                e.preventDefault();
                if (addResearchToQueue(townId, type, 'up')) updateAcademyPanel(document.querySelector('.custom-academy-panel'), townId);
            };
            const down = document.createElement('button');
            down.className = 'down';
            down.textContent = '↓';
            down.onclick = e => {
                e.stopPropagation();
                e.preventDefault();
                if (addResearchToQueue(townId, type, 'down')) updateAcademyPanel(document.querySelector('.custom-academy-panel'), townId);
            };
            cont.append(up, down);
            icon.style.position = 'relative';
            icon.appendChild(cont);
        });
        refreshResearchArrows();
    }


    // ══════════════════════════════════════════════════════════════
    //  HIDE UI
    // ══════════════════════════════════════════════════════════════

    let isHideOpen = false;

    function updateHidePanel(panel, townId) {
        if (!panel || !townId) return;
        const entry = getHideEntry(townId);
        Array.from(panel.children).forEach(c => {
            if (c.tagName !== 'H3') c.remove();
        });
        const toggleRow = document.createElement('div');
        toggleRow.className = 'hide-toggle-row';
        const label = document.createElement('label');
        label.textContent = 'Auto-hide silver';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!entry.autoHide;
        cb.onchange = e => {
            saveHideTargets(townId, e.target.checked, e.target.checked ? false : entry.autoHideTrade, entry.targetCapacity);
            updateHidePanel(panel, townId);
            updateTownListIcons();
        };
        toggleRow.append(label, cb);
        panel.appendChild(toggleRow);
        const inputRow = document.createElement('div');
        inputRow.className = 'hide-input-row';
        const inputLabel = document.createElement('label');
        inputLabel.textContent = 'Target capacity:';
        inputLabel.title = 'Leave empty for infinite';
        const capInput = document.createElement('input');
        capInput.type = 'number';
        capInput.min = '0';
        capInput.step = '1000';
        capInput.className = 'hide-capacity-input';
        capInput.placeholder = 'empty = infinite';
        capInput.disabled = !entry.autoHide;
        capInput.value = entry.targetCapacity !== null ? entry.targetCapacity : '';
        capInput.onchange = e => {
            const raw = e.target.value.trim();
            const val = raw === '' ? null : Math.max(0, parseInt(raw) || 0);
            if (val !== null) capInput.value = val;
            saveHideTargets(townId, entry.autoHide, entry.autoHideTrade, val);
        };
        inputRow.append(inputLabel, capInput);
        panel.appendChild(inputRow);
        const tradeRow = document.createElement('div');
        tradeRow.className = 'hide-toggle-row';
        tradeRow.style.marginTop = '10px';
        const tradeLabel = document.createElement('label');
        tradeLabel.textContent = 'Auto-hide with Trade';
        const tradeCb = document.createElement('input');
        tradeCb.type = 'checkbox';
        tradeCb.checked = !!entry.autoHideTrade;
        tradeCb.onchange = e => {
            const nts = e.target.checked;
            if (nts) clearNoTradeCycle(Number(townId));
            saveHideTargets(townId, nts ? false : entry.autoHide, nts, entry.targetCapacity);
            updateHidePanel(panel, townId);
            updateTownListIcons();
        };
        tradeRow.append(tradeLabel, tradeCb);
        panel.appendChild(tradeRow);
        if (entry.autoHideTrade) {
            const cycleCount = getNoTradeCycleCount(Number(townId));
            if (cycleCount > 0) {
                const cycleInfo = document.createElement('div');
                cycleInfo.className = 'hide-trade-cycle-info';
                cycleInfo.textContent = `No trades detected: ${cycleCount}/${NO_TRADE_DISABLE_THRESHOLD} cycles — will auto-disable at ${NO_TRADE_DISABLE_THRESHOLD}`;
                panel.appendChild(cycleInfo);
            }
        }
    }

    function createOrUpdateHidePanel() {
        const townId = uw.Game?.townId;
        if (!townId) return;
        let panel = document.querySelector('.custom-hide-panel');
        if (panel) {
            updateHidePanel(panel, townId);
            return;
        }
        panel = document.createElement('div');
        panel.className = 'custom-hide-panel';
        const title = document.createElement('h3');
        title.textContent = 'Auto-Hide Settings';
        panel.appendChild(title);
        const wrapper = document.querySelector('.hide_window_wrapper');
        if (wrapper) {
            if (window.getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';
            wrapper.appendChild(panel);
        } else {
            document.body.appendChild(panel);
        }
        updateHidePanel(panel, townId);
    }

    setInterval(() => {
    if (!isHideOpen || !UI_CONFIG.showHide || document.querySelector('.custom-hide-panel')) return;
    createOrUpdateHidePanel();
}, 4000);


    // ══════════════════════════════════════════════════════════════
    //  TOWN LIST ICONS
    // ══════════════════════════════════════════════════════════════

    function updateTownListIcons() {
        if (isUserActive()) return;  // skip while player is actively clicking
        const buildStorage = loadBuildingTargets();
        const researchStorage = loadResearchStorage();
        const hideStorage = loadHideStorage();
        const townItems = document.querySelectorAll('.town_groups_list .item.town_group_town');
        if (townItems.length === 0) return;
        townItems.forEach(townItem => {
            const townId = townItem.getAttribute('data-townid');
            if (!townId) return;
            const span = townItem.querySelector('span.town_name');
            if (!span) return;

            // ── FIX: cleanup selector includes ALL icon classes including recruit ──
            span.querySelectorAll(
                '.autobuild-status-icon,.schematics-status-icon,.autoresearch-status-icon,' +
                '.schematics-research-status-icon,.autohide-status-icon,.autohide-trade-status-icon,' +
                '.custom-recruit-icon'
            ).forEach(el => el.remove());

            // ── FIX: always remove active class before conditionally re-adding ──
            townItem.classList.remove('town-recruit-active');

            const bd = buildStorage[townId] || {};
            const rd = researchStorage[townId] || {};
            const hd = hideStorage[townId] || {};

            if (bd.schematicsEnabled) {
                const icon = document.createElement('div');
                icon.className = 'autobuild-status-icon';
                icon.innerHTML = '<div class="option_s dio_icon_small townicon_bu" name="bu"></div>';
                icon.title = 'Auto-Build with Schematics enabled';
                span.appendChild(icon);
            } else if (bd.autoBuild) {
                const icon = document.createElement('div');
                icon.className = 'autobuild-status-icon';
                icon.innerHTML = '<div class="option_s dio_icon_small townicon_O4" name="O4"></div>';
                icon.title = 'Auto-build enabled';
                span.appendChild(icon);
            }

            if (rd.schematicsEnabled) {
                const icon = document.createElement('div');
                icon.className = 'schematics-research-status-icon';
                icon.innerHTML = '<div class="option_s dio_icon_small townicon_bo" name="bo"></div>';
                icon.title = 'Auto-Research with Schematics enabled';
                span.appendChild(icon);
            } else if (rd.autoResearch) {
                const icon = document.createElement('div');
                icon.className = 'autoresearch-status-icon';
                icon.innerHTML = '<div class="option_s dio_icon_small townicon_ch" name="ch"></div>';
                icon.title = 'Auto-research enabled';
                span.appendChild(icon);
            }

            if (hd.autoHide) {
                const icon = document.createElement('div');
                icon.className = 'autohide-status-icon';
                icon.innerHTML = '<div class="option_s dio_icon_small townicon_si" name="si"></div>';
                icon.title = 'Auto-hide silver enabled';
                span.appendChild(icon);
            }

            if (hd.autoHideTrade) {
                const cycleCount = getNoTradeCycleCount(Number(townId));
                const icon = document.createElement('div');
                icon.className = 'autohide-trade-status-icon';
                icon.innerHTML = '<div style="background-image:url(https://gpgr.innogamescdn.com/images/game/main/hide.png);width:20px;height:20px;background-size:contain;background-repeat:no-repeat;display:inline-block;"></div>';
                icon.title = cycleCount > 0 ? `Auto-hide with Trade enabled — no trades: ${cycleCount}/${NO_TRADE_DISABLE_THRESHOLD} cycles` : 'Auto-hide with Trade enabled';
                span.appendChild(icon);
            }

            // ── Troop recruit icon ──
            const troopData = loadTroopStorage()[townId];
         if (troopData?.recruit === true) {
          townItem.classList.add('town-recruit-active');
          }
        });
    }


    // ══════════════════════════════════════════════════════════════
    //  UI EVENT LISTENERS & SETUP
    // ══════════════════════════════════════════════════════════════

    function isSenateWindowEvent(data) {
        if (!data) return false;
        const ctx = data.context || data.window_type || '';
        const wt = data.attributes?.window_type || data.attributes?.context || '';
        const nm = data.name || '';
        return ctx === 'building_senate' || wt === 'building_senate' || nm === 'building_senate' || ctx === 'senate' || wt === 'senate';
    }

    uw.$.Observer(uw.GameEvents.window.open).subscribe((e, data) => {
        if (isSenateWindowEvent(data)) {
            isSenateOpen = true;
            if (UI_CONFIG.showBuild) setTimeout(() => { if (!isUserActive()) createOrRefreshSenateUI(); }, 800);
        }
        if (data?.attributes?.window_type === 'academy') {
            isAcademyOpen = true;
            const townId = uw.Game?.townId;
            if (townId) getResearchTownEntry(townId);
            if (UI_CONFIG.showResearch) setTimeout(() => {
                if (isUserActive()) return;
                createOrUpdateAcademyPanel();
                if (UI_CONFIG.showResearch) addArrowsToResearchIcons();
                const techArea = document.querySelector('.tech_tree_box, .researches_queue_box, #academy');
                if (techArea) {
                    academyMutationObserver?.disconnect();
                    academyMutationObserver = new MutationObserver(() => {
                        clearTimeout(_academyDebounceTimer);
                        _academyDebounceTimer = setTimeout(() => {
                            if (!UI_CONFIG.showResearch) return;
                            addArrowsToResearchIcons();
                            refreshResearchArrows();
                        }, 150);
                    });
                    academyMutationObserver.observe(techArea, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['class']
                    });
                }
            }, 1500);
        }
        if (data?.attributes?.window_type === 'hide') {
            isHideOpen = true;
            if (UI_CONFIG.showHide) setTimeout(() => { if (!isUserActive()) createOrUpdateHidePanel(); }, 800);
        }
        // ── Barracks / Docks ──
        if (data?.context === 'building_barracks') {
            isBarracksOpen = true;
            isDocksOpen = false;
            currentBuildingType = 'barracks';
            if (UI_CONFIG.showTroop) setTimeout(() => { if (!isUserActive()) createTroopDropdown(); }, 500);
        } else if (data?.context === 'building_docks') {
            isDocksOpen = true;
            isBarracksOpen = false;
            currentBuildingType = 'docks';
            if (UI_CONFIG.showTroop) setTimeout(() => { if (!isUserActive()) createTroopDropdown(); }, 500);
        }
    });

    uw.$.Observer(uw.GameEvents.window.close).subscribe((e, data) => {
        if (data?.type === 24 || isSenateWindowEvent(data)) {
            isSenateOpen = false;
            document.querySelector('.custom-senate-build-panel')?.remove();
        }
        if (data?.type === 'academy' || data?.window_type === 'academy') {
            isAcademyOpen = false;
            academyMutationObserver?.disconnect();
            academyMutationObserver = null;
            document.querySelector('.custom-academy-panel')?.remove();
            document.querySelectorAll('.obs-arrow-small').forEach(el => el.remove());
        }
        if (data?.type === 'hide') {
            isHideOpen = false;
            document.querySelector('.custom-hide-panel')?.remove();
        }
        // ── Barracks (25) / Docks (27) ──
        if (data?.type === 25 || data?.type === 27) {
            isBarracksOpen = false;
            isDocksOpen = false;
            currentBuildingType = null;
            selectedTroops = [];
            sessionTownId = null;
            document.querySelector('.troop-dropdown-container')?.remove();
        }
    });

    // ── ajaxComplete — fast early-exit so unrelated requests cost nothing ──
    uw.$(document).ajaxComplete((event, xhr, settings) => {
        const url    = settings.url ?? '';
        const townId = uw.Game?.townId;
        if (!townId) return;

        // Bail immediately if this URL can't affect any of our panels
        const relevant =
            url.includes('building_main')    ||
            url.includes('academy')          ||
            url.includes('building_barracks')||
            url.includes('building_docks')   ||
            url.includes('town')             ||
            url.includes('group')            ||
            url.includes('switch')           ||
            url.includes('overviews');
        if (!relevant) return;

        if (isSenateOpen && UI_CONFIG.showBuild && url.includes('building_main'))
            setTimeout(() => { if (!isUserActive()) createOrRefreshSenateUI(); }, 300);

        if (isAcademyOpen && UI_CONFIG.showResearch && url.includes('academy'))
            setTimeout(() => { if (!isUserActive()) createOrUpdateAcademyPanel(); }, 300);

        if (url.includes('town') || url.includes('group') ||
            url.includes('switch') || url.includes('overviews'))
            setTimeout(debouncedUpdateTownListIcons, 400);

        if ((isBarracksOpen || isDocksOpen) && UI_CONFIG.showTroop &&
            (url.includes('building_barracks') || url.includes('building_docks'))) {
            try {
                const responseData = JSON.parse(xhr.responseText);
                if (responseData.json && responseData.plain?.html)
                    setTimeout(() => { if (!isUserActive()) createTroopDropdown(); }, 500);
            } catch (e) {}
        }
    });

    // Debounce timer — prevents rapid-fire icon redraws when the DOM mutates quickly
    let _iconDebounceTimer = null;
    function debouncedUpdateTownListIcons() {
        clearTimeout(_iconDebounceTimer);
        _iconDebounceTimer = setTimeout(updateTownListIcons, 150);
    }

    function setupTownDropdownListenerForIcons() {
        const button = document.querySelector('.town_groups_dropdown .button.js-button-caption');
        if (button) button.addEventListener('click', () => setTimeout(debouncedUpdateTownListIcons, 350));
        else setTimeout(setupTownDropdownListenerForIcons, 700);
    }

    function setupTownListMutationObserver() {
        const target = document.querySelector('.content.js-dropdown-item-list') || document.querySelector('.town_groups_list');
        if (target) new MutationObserver(debouncedUpdateTownListIcons).observe(target, {
            childList: true,
            subtree: true
        });
        else setTimeout(setupTownListMutationObserver, 900);
    }
    setupTownDropdownListenerForIcons();
    setupTownListMutationObserver();

    setInterval(() => {
        if (!isSenateOpen && !isAcademyOpen) return;
        if (isSenateOpen && UI_CONFIG.showBuild) {
            const panel = document.querySelector('.custom-senate-build-panel');
            const townId = uw.Game?.townId;
            if (!panel) createOrRefreshSenateUI();
            else if (townId) updateSenatePanel(panel, townId);
        }
        if (isAcademyOpen && UI_CONFIG.showResearch) {
            const panel = document.querySelector('.custom-academy-panel');
            const townId = uw.Game?.townId;
            if (!panel) createOrUpdateAcademyPanel();
            else if (townId) updateAcademyPanel(panel, townId);
            if (UI_CONFIG.showResearch) addArrowsToResearchIcons();
        }
    }, 4000);

    setTimeout(() => {
        const townId = uw.Game?.townId;
        if (UI_CONFIG.showBuild    && document.querySelector('#buildings') && townId && !document.querySelector('.custom-senate-build-panel')) createOrRefreshSenateUI();
        if (UI_CONFIG.showResearch && document.querySelector('#academy') && townId && !document.querySelector('.custom-academy-panel')) {
            getResearchTownEntry(townId);
            createOrUpdateAcademyPanel();
            if (UI_CONFIG.showResearch) addArrowsToResearchIcons();
        }
        if (UI_CONFIG.showHide && document.querySelector('.hide_window_wrapper') && townId && !document.querySelector('.custom-hide-panel')) createOrUpdateHidePanel();
        updateTownListIcons();
    }, 1800);

    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 0 — AUTO HIDE-TRADE
    // ══════════════════════════════════════════════════════════════

    function getAllHideTradeTowns() {
        const hs = loadHideStorage();
        return Object.keys(uw.ITowns.towns || {}).map(Number).filter(id => hs[id]?.autoHideTrade);
    }

    async function runAutoHideTradeCycle() {
        const allTradeTowns = getAllHideTradeTowns();
        if (allTradeTowns.length === 0) return;
        const townsWithTrades = getTownsWithIncomingTrades();
        console.log(`[AutoHide-Trade] Checking ${allTradeTowns.length} town(s)`);
        for (const townId of allTradeTowns) {
            if (botcheck()) {
                console.log('[AutoHide-Trade] Captcha — stopping');
                return;
            }
            const townName = uw.ITowns.towns[townId]?.name || townId;
            if (!townsWithTrades.has(townId)) {
                const count = hideTradeCycles.increment(townId);
                console.log(`[AutoHide-Trade] ${townName} — no trades (${count}/${NO_TRADE_DISABLE_THRESHOLD})`);
                if (count >= NO_TRADE_DISABLE_THRESHOLD) {
                    const entry = getHideEntry(townId);
                    saveHideTargets(townId, entry.autoHide, false, entry.targetCapacity);
                    hideTradeCycles.clear(townId);
                    updateTownListIcons();
                    const panel = document.querySelector('.custom-hide-panel');
                    if (panel && Number(uw.Game?.townId) === townId) updateHidePanel(panel, townId);
                    console.log(`[AutoHide-Trade] ${townName} — AUTO-DISABLED`);
                }
                continue;
            }
            hideTradeCycles.reset(townId);
            if (!caveBuildingExists(townId)) {
                console.log(`[AutoHide-Trade] ${townName} — skipped: no cave`);
                continue;
            }
            const trades = filterTradesByTown(townId);
            const nextTrade = findMinArrivalTrade(trades);
            if (!wouldTradeOverflowStorage(nextTrade, townId)) {
                console.log(`[AutoHide-Trade] ${townName} — skipped: no overflow`);
                continue;
            }
            const iron = uw.ITowns.towns[townId].resources().iron;
            if (iron <= 1000) {
                console.log(`[AutoHide-Trade] ${townName} — skipped: no iron`);
                continue;
            }
            await caveIronRequest(townId, iron, 0);
            await sleep(random(MIN_ACTION_DELAY, MAX_ACTION_DELAY));
        }
    }

    async function masterHideTradeLoop() {
        console.log('[AutoHide-Trade v1.3] Trade hide loop started');
        while (true) {
            try {
                await sleep(6000);
                if (!botcheck()) await runAutoHideTradeCycle();
            } catch (e) {
                console.error('[AutoHide-Trade] Error:', e);
            }
            await sleep(random(5000, 10000));
        }
    }


    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 0 — AUTO TROOP RECRUIT
    //  Same priority as AutoHide-Trade. Independent loop.
    //  Auto-disables per town after N cycles with no incoming trades.
    // ══════════════════════════════════════════════════════════════

    // ── Trade helpers (shared with findTarget) ───────────────────────



    // ── Unit order counters ──────────────────────────────────────────

    const unitOrderNaval = (town) => {
        let n = 0;
        const orders = uw.ITowns.towns[town].getUnitOrdersCollection().models;
        const len = uw.ITowns.towns[town].getUnitOrdersCollection().length;
        for (let i = 0; i < len; i++)
            if (orders[i].attributes.kind === 'naval') n++;
        return n;
    };
    const unitOrderGround = (town) => {
        let g = 0;
        const orders = uw.ITowns.towns[town].getUnitOrdersCollection().models;
        const len = uw.ITowns.towns[town].getUnitOrdersCollection().length;
        for (let i = 0; i < len; i++)
            if (orders[i].attributes.kind === 'ground') g++;
        return g;
    };
    const hasMaxOrders = (town, troop) => {
        const tt = uw.GameData.units[troop];
        return tt.is_naval ? unitOrderNaval(town) === 7 : unitOrderGround(town) === 7;
    };

    // ── Troop cost & discount helpers ────────────────────────────────

    function getTownResearch(townId) {
        const r = uw.ITowns.getTown(townId).getResearches().attributes;
        return {
            conscription: r.conscription,
            mathematics: r.mathematics
        };
    }

    function getExtras(townId) {
        const models = uw.ITowns.getTown(townId).getCastedPowersCollection().models;
        let passionateTraining = false,
            nereidCall = false,
            greatArming = false;
        models.forEach(m => {
            passionateTraining = passionateTraining || m.attributes.power_id === 'passionate_training';
            nereidCall = nereidCall || m.attributes.power_id === 'help_of_the_nereids';
            greatArming = greatArming || m.attributes.power_id === 'great_arming';
        });
        return {
            passionateTraining,
            nereidCall,
            greatArming
        };
    }

    function getHeroDiscount(townId, troop) {
        const heroTroopMap = {
            argus: {
                appliesTo: () => troop.is_naval
            },
            aristotle: {
                appliesTo: () => troop.id === 'attack_ship'
            },
            daidalos: {
                appliesTo: () => troop.id === 'bireme',
                discount: level => 0.1 + 0.01 * level
            },
            eurybia: {
                appliesTo: () => troop.id === 'trireme'
            },
            odysseus: {
                appliesTo: () => troop.id === 'sword'
            },
            philoctetes: {
                appliesTo: () => troop.id === 'archer'
            },
            cheiron: {
                appliesTo: () => troop.id === 'hoplite'
            }
        };
        let discount = 1;
        Object.entries(heroTroopMap).forEach(([heroType, {
            appliesTo,
            discount: getDiscount
        }]) => {
            if (uw.ITowns.towns[townId].hasHero(heroType) && appliesTo()) {
                const hero = Object.values(uw.MM.getModels().PlayerHero).find(h => h.attributes.type === heroType);
                if (hero) {
                    const level = hero.attributes.level;
                    discount *= (1 - (getDiscount ? getDiscount(level) : 0.2 + 0.02 * level));
                }
            }
        });
        return discount;
    }

    function getAlliancePowerDiscount(troopType) {
        let discount = 1;
        Object.values(uw.MM.getModels().CastedAlliancePowers).forEach(power => {
            if (power.attributes.power_id === 'unit_order_cost_alliance') {
                const {
                    type,
                    percent
                } = power.attributes.configuration;
                if ((type === 'naval' && troopType.is_naval) || (type === 'ground' && !troopType.is_naval)) discount *= (1 - percent / 100);
            }
        });
        return discount;
    }

    function getTotalDiscount(townId, troopType) {
        const townResearch = getTownResearch(townId);
        const townExtras = getExtras(townId);
        let discount = 1;
        if (townExtras.greatArming) discount *= 0.5;
        if (troopType.is_naval) {
            if (townResearch.mathematics) discount *= 0.9;
            if (townExtras.nereidCall) discount *= 0.7;
        } else {
            if (townResearch.conscription) discount *= 0.9;
            if (townExtras.passionateTraining) discount *= 0.7;
        }
        discount *= getHeroDiscount(townId, troopType);
        if ('end_game_type_olympus' === uw.Game.features.end_game_type) discount *= getAlliancePowerDiscount(troopType);
        return discount;
    }

    function totalTroopCost(townId, troop, queue) {
        const troopType = uw.GameData.units[troop];
        const troopCost = troopType.resources;
        const discount = getTotalDiscount(townId, troopType);
        return {
            wood: troopCost.wood * discount * queue,
            stone: troopCost.stone * discount * queue,
            iron: troopCost.iron * discount * queue
        };
    }

    function getMaxTroopsFromResources(townId, troopCost, discount) {
        const storage = uw.ITowns.towns[townId].getStorage();
        return Math.min(troopCost.wood !== 0 ? storage / (troopCost.wood * discount) : Infinity, troopCost.stone !== 0 ? storage / (troopCost.stone * discount) : Infinity, troopCost.iron !== 0 ? storage / (troopCost.iron * discount) : Infinity);
    }

    function getMaxTroopsFromCurrentResources(townId, troopCost, discount) {
        const r = uw.ITowns.towns[townId].resources();
        return Math.min(troopCost.wood !== 0 ? r.wood / (troopCost.wood * discount) : Infinity, troopCost.stone !== 0 ? r.stone / (troopCost.stone * discount) : Infinity, troopCost.iron !== 0 ? r.iron / (troopCost.iron * discount) : Infinity);
    }

    // ── Troop prerequisite checks ────────────────────────────────────

    const hasEnoughRsss = (town, troop, queue) => {
        const r = uw.ITowns.towns[town].resources();
        const c = totalTroopCost(town, troop, queue);
        return r.wood >= c.wood && r.stone >= c.stone && r.iron >= c.iron;
    };
    const hasPopulation = (town, troop, queue) => {
        const tp = uw.GameData.units[troop].population;
        return uw.ITowns.towns[town].getAvailablePopulation() >= tp * queue;
    };
    const hasResearch = (town, troop) => {
        const r = uw.ITowns.towns[town].getResearches().attributes[troop];
        return r || r === undefined;
    };
    const hasBuildingDependancies = (town, troop) => {
        const data = uw.GameData.units[troop];
        if (data.building_dependencies == null) return !data.is_naval || uw.ITowns.towns[town].buildings().attributes.docks > 0;
        for (let building in data.building_dependencies)
            if (uw.ITowns.towns[town].buildings().attributes[building] < data.building_dependencies[building]) return false;
        return true;
    };

    // ── Population in town (counts units + outer + queue) ────────────

    const getGroundPopulationInTown = (town) => {
        let all = {};
        Object.keys(uw.GameData.units).forEach(t => all[t] = 0);
        const units = uw.ITowns.towns[town].units();
        Object.keys(units).forEach(k => all[k] += units[k]);
        const unitsOuter = uw.ITowns.towns[town].unitsOuter();
        Object.keys(unitsOuter).forEach(k => all[k] += unitsOuter[k]);
        uw.ITowns.towns[town].getUnitOrdersCollection().models.forEach(o => {
            all[o.attributes.unit_type] += o.attributes.units_left;
        });
        return all;
    };

    // ── Queue size & sort ────────────────────────────────────────────

    const getQueueSize = (townId, troop, desiredQuantity) => {
        const troopType = uw.GameData.units[troop];
        const troopCost = troopType.resources;
        const discount = getTotalDiscount(townId, troopType);
        const queMax = getMaxTroopsFromResources(townId, troopCost, discount);
        const currentTroops = getGroundPopulationInTown(townId)[troop] || 0;
        if (currentTroops >= desiredQuantity) return 0;
        const toBuild = desiredQuantity - currentTroops;
        return Math.floor(toBuild < queMax ? toBuild : queMax);
    };

    const sortTroopsByPopulationNeed = (townId, desiredTroops) => {
        const needs = [];
        for (let troop in desiredTroops) {
            const q = getQueueSize(townId, troop, desiredTroops[troop]);
            needs.push({
                troop,
                troopPopulation: uw.GameData.units[troop].population * q
            });
        }
        needs.sort((b, a) => a.troopPopulation - b.troopPopulation);
        return needs.map(e => e.troop);
    };

    // ── Resource cost display ────────────────────────────────────────

    function calculateRequiredResources(townId, buildingType) {
        const storage = loadTroopStorage();
        const townData = storage[townId] || {
            troops: {}
        };
        const orderedTroops = townData.troops || {};
        const currentTroops = getGroundPopulationInTown(townId);
        let totalResources = {
            wood: 0,
            stone: 0,
            iron: 0
        };
        Object.entries(orderedTroops).forEach(([troopId, orderedQuantity]) => {
            const isNaval = uw.GameData.units[troopId]?.is_naval || false;
            if (buildingType === 'barracks' ? isNaval : !isNaval) return;
            const additionalQuantity = Math.max(0, orderedQuantity - (currentTroops[troopId] || 0));
            if (additionalQuantity > 0) {
                const c = totalTroopCost(townId, troopId, additionalQuantity);
                totalResources.wood += c.wood;
                totalResources.stone += c.stone;
                totalResources.iron += c.iron;
            }
        });
        return totalResources;
    }

    // ── Target finder ────────────────────────────────────────────────

    function findTarget(townId) {
        const troopStorage = loadTroopStorage();
        const townData = troopStorage[townId];
        if (!townData || !townData.recruit) return null;
        const desiredTroops = townData.troops || {};
        const storage = uw.ITowns.towns[townId].getStorage();
        const storageRatio = (storage - 6000) / storage;
        const trades = filterTradesByTown(townId);
        const minTrade = trades.length ? findMinArrivalTrade(trades) : null;
        const overflowStorage = minTrade ? getNextTradeOverflow(minTrade, townId) : {
            isOverflow: false,
            resource: null
        };
        const sortedTroops = sortTroopsByPopulationNeed(townId, desiredTroops);
        for (let troop of sortedTroops) {
            const queue = getQueueSize(townId, troop, desiredTroops[troop] || 0);
            if (botcheck()) continue;
            if (queue > 0 && hasEnoughRsss(townId, troop, queue) && hasPopulation(townId, troop, queue) && hasResearch(townId, troop) && hasBuildingDependancies(townId, troop) && !hasMaxOrders(townId, troop))
                return {
                    build: troop,
                    amount: queue
                };
            const populationQueue = Math.floor(uw.ITowns.towns[townId].getAvailablePopulation() / uw.GameData.units[troop].population);
            if (!hasPopulation(townId, troop, queue) && populationQueue > 0 && hasEnoughRsss(townId, troop, populationQueue) && hasResearch(townId, troop) && hasBuildingDependancies(townId, troop) && !hasMaxOrders(townId, troop))
                return {
                    build: troop,
                    amount: populationQueue
                };
            if (overflowStorage.isOverflow) {
                const troopType = uw.GameData.units[troop];
                const troopCost = troopType.resources;
                const discount = getTotalDiscount(townId, troopType);
                const resourceQueue = Math.floor(getMaxTroopsFromCurrentResources(townId, troopCost, discount));
                if (queue > 0 && resourceQueue > 0 && resourceQueue > queue * storageRatio && hasEnoughRsss(townId, troop, resourceQueue) && hasResearch(townId, troop) && hasPopulation(townId, troop, resourceQueue) && hasBuildingDependancies(townId, troop) && !hasMaxOrders(townId, troop))
                    return {
                        build: troop,
                        amount: resourceQueue
                    };
            }
        }
        return null;
    }

    // ── Recruit request (priority 0) ─────────────────────────────────

    async function troopRecruitRequest(targetTownId, troop, queue, currentTown) {
        if (botcheck()) return false;
        const queueID = actionQueue.enqueue(0);
        while (actionQueue.getNext()?.queueID !== queueID) {
            await sleep(random(440, 1000));
        }
        fakeSwitchToTown(currentTown);
        try {
            await new Promise((resolve, reject) => {
                uw.gpAjax.ajaxPost('town_overviews', 'recruit_units', {
                    towns: {
                        [targetTownId]: {
                            [troop]: queue
                        }
                    },
                    town_id: currentTown
                }, false, {
                    success: resolve,
                    error: reject
                });
            });
            console.log(`[AutoTroop] OK: ${queue}x ${troop} in town ${uw.ITowns.towns[targetTownId]?.name || targetTownId}`);
            trackStat('troop', troop, queue);
            return true;
        } catch (e) {
            console.warn(`[AutoTroop] FAIL: ${troop} town ${targetTownId}`, e);
            return false;
        } finally {
            setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
        }
    }

    async function runAutoTroopCycle() {
        const troopStorage = loadTroopStorage();
        const enabledTowns = Object.keys(uw.ITowns.towns || {}).map(Number).filter(id => troopStorage[id]?.recruit === true);
        if (enabledTowns.length === 0) return;
        const townsWithTrades = new Set(
            Object.values(uw.MM.getModels().Trade || {})
            .filter(t => t.attributes?.origin_town_type !== 'game_farm_town' && t.attributes?.destination_town_id != null)
            .map(t => t.attributes.destination_town_id)
        );
        const currentTown = uw.Game.townId;
        console.log(`[AutoTroop] Checking ${enabledTowns.length} town(s) with recruit enabled`);
        for (const townId of enabledTowns) {
            if (botcheck()) {
                console.log('[AutoTroop] Captcha — stopping');
                return;
            }
            const townName = uw.ITowns.towns[townId]?.name || townId;
            if (!townsWithTrades.has(townId)) {
                const count = troopTradeCycles.increment(townId);
                console.log(`[AutoTroop] ${townName} — no trades (${count}/${NO_TROOP_TRADE_DISABLE_THRESHOLD})`);
                if (count >= NO_TROOP_TRADE_DISABLE_THRESHOLD) {
                    const st = loadTroopStorage();
                    if (st[townId]) st[townId].recruit = false;
                    try {
                        localStorage.setItem('troopStorage', JSON.stringify(st));
                    } catch (e) {}
                    troopTradeCycles.clear(townId);
                    updateTownListIcons();
                    console.log(`[AutoTroop] ${townName} — AUTO-DISABLED: no trades for ${NO_TROOP_TRADE_DISABLE_THRESHOLD} cycles`);
                }
                continue;
            }
            troopTradeCycles.reset(townId);
            const target = findTarget(townId);
            if (!target) {
                console.log(`[AutoTroop] ${townName} — no recruit target`);
                continue;
            }
            await troopRecruitRequest(townId, target.build, target.amount, currentTown);
            await sleep(random(1000, 2000));
        }
    }

    async function masterAutoTroopLoop() {
        console.log('[AutoTroop] Independent loop started (priority 0)');
        while (true) {
            try {
                await sleep(3000);
                if (!botcheck()) await runAutoTroopCycle();
            } catch (e) {
                console.error('[AutoTroop] Error:', e);
            }
            await sleep(random(60000, 120000));
        }
    }

    // ── Barracks / Docks UI ──────────────────────────────────────────

    function createTroopDropdown() {
        let buildingWindow = null;
        if (isBarracksOpen) buildingWindow = document.getElementsByClassName('barracks_building')[0];
        else if (isDocksOpen) buildingWindow = document.getElementsByClassName('docks_building')[0];
        else return;
        if (!buildingWindow) return;
        let container = buildingWindow.querySelector('#unit_orders_queue');
        if (!container) return;
        const currentTownId = uw.Game.townId;
        if (selectedTroops.length > 0 && sessionTownId !== null && currentTownId !== sessionTownId) {
            selectedTroops = [];
            sessionTownId = null;
        }
        document.querySelector('.troop-dropdown-container')?.remove();
        let troops = document.getElementById('units');
        if (!troops) return;
        let availableTroops = [];
        for (let tab of troops.getElementsByClassName('unit_tab')) {
            if (tab.classList.contains('unavailable') || tab.style.display === 'none') continue;
            const troopId = tab.id;
            if (uw.GameData.units[troopId]) {
                const iconDiv = tab.querySelector(`.unit_icon50x50.${troopId}`);
                availableTroops.push({
                    id: troopId,
                    name: uw.GameData.units[troopId].name,
                    iconClass: iconDiv ? `unit_icon50x50 ${troopId}` : ''
                });
            }
        }
        if (availableTroops.length === 0) return;

        // ── Build DOM ──
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'troop-dropdown-container';
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'controls-container';

        const label = document.createElement('span');
        label.innerText = 'Επιλέξτε μονάδα για εκπαίδευση: ';
        label.style.marginRight = '10px';
        controlsContainer.appendChild(label);

        const dropdown = document.createElement('select');
        dropdown.className = 'troop-dropdown';
        const defOpt = document.createElement('option');
        defOpt.value = '';
        defOpt.innerText = '-- Επιλέξτε --';
        defOpt.disabled = true;
        defOpt.selected = true;
        dropdown.appendChild(defOpt);
        availableTroops.forEach(t => {
            const o = document.createElement('option');
            o.value = t.id;
            o.innerText = t.name;
            dropdown.appendChild(o);
        });
        controlsContainer.appendChild(dropdown);

        const inputContainer = document.createElement('div');
        const inputLabel = document.createElement('span');
        inputLabel.innerText = 'Ποσότητα: ';
        inputLabel.style.marginRight = '10px';
        inputContainer.appendChild(inputLabel);
        const quantityInput = document.createElement('input');
        quantityInput.type = 'number';
        quantityInput.className = 'troop-input';
        quantityInput.min = '0';
        quantityInput.value = '';
        quantityInput.placeholder = 'Εισάγετε αριθμό';
        quantityInput.addEventListener('input', function() {
            if (this.value < 0) this.value = 0;
        });
        inputContainer.appendChild(quantityInput);
        controlsContainer.appendChild(inputContainer);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'button-container';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '5px';

        const saveButton = document.createElement('button');
        saveButton.className = 'troop-button save';
        saveButton.innerText = 'Αποθήκευση';
        saveButton.addEventListener('click', function() {
            if (selectedTroops.length === 0) return;
            const townId = uw.Game.townId;
            if (!townId) return;
            let storage = loadTroopStorage();
            let troopsObject = {};
            selectedTroops.forEach(t => {
                troopsObject[t.id] = t.quantity;
            });
            if (!storage[townId]) storage[townId] = {
                id: townId,
                troops: {},
                recruit: false
            };
            const recruitToggle = document.getElementById('recruit-toggle');
            storage[townId] = {
                id: townId,
                troops: {
                    ...storage[townId].troops,
                    ...troopsObject
                },
                recruit: recruitToggle ? recruitToggle.checked : storage[townId].recruit
            };
            try {
                saveTroopStorage(storage);
            } catch (e) {}
            selectedTroops = [];
            sessionTownId = null;
            quantityInput.value = '';
            dropdown.value = '';
            updateTroopDisplay();
        });
        buttonContainer.appendChild(saveButton);

        const addButton = document.createElement('button');
        addButton.className = 'troop-button add';
        addButton.innerText = 'Προσθήκη';
        addButton.addEventListener('click', function() {
            const selectedTroopId = dropdown.value;
            const quantity = parseInt(quantityInput.value) || 0;
            if (!selectedTroopId || quantity < 0) return;
            if (selectedTroops.length === 0) sessionTownId = uw.Game.townId;
            const selectedTroop = availableTroops.find(t => t.id === selectedTroopId);
            if (selectedTroop) {
                const existing = selectedTroops.find(t => t.id === selectedTroopId);
                if (existing) existing.quantity += quantity;
                else selectedTroops.push({
                    id: selectedTroop.id,
                    name: selectedTroop.name,
                    quantity,
                    iconClass: selectedTroop.iconClass
                });
                quantityInput.value = '';
                dropdown.value = '';
                updateTroopDisplay();
            }
        });
        buttonContainer.appendChild(addButton);

        const clearButton = document.createElement('button');
        clearButton.className = 'troop-button clear';
        clearButton.innerText = 'Καθαρισμός';
        clearButton.addEventListener('click', function() {
            const townId = uw.Game.townId;
            if (!townId) return;
            if (selectedTroops.length > 0) {
                selectedTroops = [];
                sessionTownId = null;
                quantityInput.value = '';
                dropdown.value = '';
            } else {
                let storage = loadTroopStorage();
                if (storage[townId]?.troops) {
                    storage[townId] = {
                        id: townId,
                        troops: {},
                        recruit: storage[townId].recruit
                    };
                    if (!storage[townId].recruit) delete storage[townId];
                    try {
                        saveTroopStorage(storage);
                    } catch (e) {}
                }
            }
            updateTroopDisplay();
        });
        buttonContainer.appendChild(clearButton);
        controlsContainer.appendChild(buttonContainer);
        dropdownContainer.appendChild(controlsContainer);

        const troopDisplayContainer = document.createElement('div');
        troopDisplayContainer.className = 'troop-display-container';

        const sessionSection = document.createElement('div');
        sessionSection.className = 'troop-display-section';
        const sessionHeader = document.createElement('h4');
        sessionHeader.innerText = 'Τρέχουσα Επιλογή Μονάδων:';
        sessionSection.appendChild(sessionHeader);
        const sessionList = document.createElement('div');
        sessionList.className = 'troop-display-list';
        sessionSection.appendChild(sessionList);

        const savedSection = document.createElement('div');
        savedSection.className = 'troop-display-section';
        const savedHeader = document.createElement('h4');
        savedHeader.innerText = 'Αποθηκευμένες Μονάδες για την Πόλη:';
        savedSection.appendChild(savedHeader);
        const savedList = document.createElement('div');
        savedList.className = 'troop-display-list';
        savedSection.appendChild(savedList);

        const recruitToggleContainer = document.createElement('div');
        recruitToggleContainer.className = 'recruit-toggle-container';
        const recruitLabel = document.createElement('span');
        recruitLabel.className = 'recruit-toggle-label';
        recruitLabel.innerText = 'Recruitment: ';
        recruitToggleContainer.appendChild(recruitLabel);
        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'recruit-toggle';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.id = 'recruit-toggle';
        const troopSt = loadTroopStorage();
        toggleInput.checked = troopSt[currentTownId]?.recruit ?? false;
        const toggleLabel = document.createElement('label');
        toggleLabel.setAttribute('for', 'recruit-toggle');
        toggleContainer.appendChild(toggleInput);
        toggleContainer.appendChild(toggleLabel);
        toggleInput.addEventListener('change', function() {
            let st = loadTroopStorage();
            if (!st[currentTownId]) st[currentTownId] = {
                id: currentTownId,
                troops: {},
                recruit: this.checked
            };
            else st[currentTownId].recruit = this.checked;
            try {
                saveTroopStorage(st);
            } catch (e) {}
            updateTownListIcons();
            updateTroopDisplay();
        });
        recruitToggleContainer.appendChild(toggleContainer);

        const resourceInfoBox = document.createElement('div');
        resourceInfoBox.className = 'resource-info-box';
        troopDisplayContainer.appendChild(resourceInfoBox);
        troopDisplayContainer.appendChild(sessionSection);
        troopDisplayContainer.appendChild(savedSection);
        troopDisplayContainer.appendChild(recruitToggleContainer);
        dropdownContainer.appendChild(troopDisplayContainer);
        container.appendChild(dropdownContainer);

        function updateTroopDisplay() {
            sessionList.innerHTML = '';
            if (selectedTroops.length === 0) {
                const m = document.createElement('span');
                m.innerText = 'Καμία μονάδα.';
                m.style.color = '#4a2b0f';
                sessionList.appendChild(m);
            } else {
                selectedTroops.forEach(troop => {
                    const item = document.createElement('div');
                    item.className = 'troop-display-item';
                    const icon = document.createElement('div');
                    icon.className = 'troop-display-icon';
                    if (troop.iconClass) icon.classList.add(...troop.iconClass.split(' '));
                    item.appendChild(icon);
                    const qty = document.createElement('span');
                    qty.className = 'troop-display-quantity';
                    qty.innerText = troop.quantity;
                    item.appendChild(qty);
                    sessionList.appendChild(item);
                });
            }

            savedList.innerHTML = '';
            const townId = uw.Game.townId;
            const st = loadTroopStorage();
            const savedTroops = (st[townId] || {
                troops: {}
            }).troops;
            if (Object.keys(savedTroops).length === 0) {
                const m = document.createElement('span');
                m.innerText = 'Καμία αποθηκευμένη μονάδα.';
                m.style.color = '#4a2b0f';
                savedList.appendChild(m);
            } else {
                Object.entries(savedTroops).forEach(([troopId, quantity]) => {
                    const troopData = availableTroops.find(t => t.id === troopId);
                    if (!troopData) return;
                    const item = document.createElement('div');
                    item.className = 'troop-display-item';
                    const icon = document.createElement('div');
                    icon.className = 'troop-display-icon';
                    if (troopData.iconClass) icon.classList.add(...troopData.iconClass.split(' '));
                    item.appendChild(icon);
                    const qty = document.createElement('span');
                    qty.className = 'troop-display-quantity';
                    qty.innerText = quantity;
                    item.appendChild(qty);
                    savedList.appendChild(item);
                });
            }

            resourceInfoBox.innerHTML = '';
            const rh = document.createElement('h4');
            rh.innerText = 'Required Resources:';
            resourceInfoBox.appendChild(rh);
            const resources = calculateRequiredResources(currentTownId, currentBuildingType);
            if (resources.wood === 0 && resources.stone === 0 && resources.iron === 0) {
                const p = document.createElement('p');
                p.innerText = 'No additional resources needed.';
                resourceInfoBox.appendChild(p);
            } else {
                const rc = document.createElement('div');
                rc.className = 'resource-container';
                [
                    ['wood', 'Ξύλο'],
                    ['stone', 'Πέτρα'],
                    ['iron', 'Σίδερο']
                ].forEach(([res, alt]) => {
                    const row = document.createElement('div');
                    row.className = 'resource-row';
                    const img = document.createElement('img');
                    img.src = `https://gpgr.innogamescdn.com/images/game/res/${res}.png`;
                    img.className = `unit_order_res ${res}`;
                    img.alt = alt;
                    const amt = document.createElement('span');
                    amt.className = 'resource-amount';
                    amt.innerText = Math.floor(resources[res]);
                    row.appendChild(img);
                    row.appendChild(amt);
                    rc.appendChild(row);
                });
                resourceInfoBox.appendChild(rc);
            }
        }
        updateTroopDisplay();
    }

    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 1 — AUTO BUILD
    // ══════════════════════════════════════════════════════════════

    function getBuildingModel(townId) {
        return uw.MM.getModels().BuildingBuildData?.[townId];
    }

    function hasBuildResources(townId, needed) {
        const res = uw.ITowns.towns[townId].resources();
        return res.wood >= needed.wood && res.stone >= needed.stone && res.iron >= needed.iron;
    }

    function isBuildSchematicComplete(townId, schematicName) {
        const targetsList = buildSchematicTargets[schematicName];
        if (!targetsList) return false;
        const levels = getCurrentBuildingLevels(townId);
        return targetsList.every(stage => Object.entries(stage).every(([b, lvl]) => (levels[b] || 0) >= lvl));
    }

    async function tryBuild(townId, building, tearDown = false, priority = 1) {
        if (botcheck()) return false;
        const queueID = actionQueue.enqueue(priority);
        while (actionQueue.getNext()?.queueID !== queueID) {
            await sleep(random(440, 1000));
        }
        fakeSwitchToTown(townId);
        try {
            await new Promise((resolve, reject) => {
                uw.gpAjax.ajaxPost('town_overviews', 'build_building', {
                    building_id: building,
                    town_id: townId,
                    tear_down: tearDown ? 1 : 0,
                    no_bar: 0,
                    build_for_gold: false
                }, false, {
                    success: resolve,
                    error: reject
                });
            });
            console.log(`[AutoBuild] OK: ${tearDown ? '↓' : '↑'} ${building} town ${townId}`);
            return true;
        } catch (e) {
            console.warn(`[AutoBuild] FAIL: ${building} town ${townId}`, e);
            return false;
        } finally {
            setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
        }
    }

    function findNextSchematicBuild(townId, schematicName, buildData) {
        const targetsList = buildSchematicTargets[schematicName];
        if (!targetsList) return null;
        for (const stage of targetsList) {
            let best = null;
            for (const [building, targetLvl] of Object.entries(stage)) {
                const data = buildData[building];
                if (!data) continue;
                const current = getCurrentBuildingLevels(townId)[building] || 0;
                if (current < targetLvl && !data.has_max_level && data.next_level <= targetLvl && hasBuildResources(townId, data.resources_for) && data.population_for <= uw.ITowns.towns[townId].getAvailablePopulation()) {
                    const cost = (data.resources_for.wood || 0) + (data.resources_for.stone || 0) + (data.resources_for.iron || 0);
                    if (!best || cost <= best.cost) best = {
                        building,
                        data,
                        cost
                    };
                }
            }
            if (best) return best;
            if (!Object.entries(stage).every(([b, lvl]) => (getBuildingLevelsAfterQueue(townId)[b] || 0) >= lvl)) return null;
        }
        return null;
    }

    let lastBuildTownIndex = -1;

    async function processBuildTown(townId) {
        const townName = uw.ITowns.towns[townId]?.name || townId;
        if (isFestivalSkip(townId)) {
            console.log(`[AutoBuild] ${townName} — skipped: festival eligible`);
            return;
        }
        let isCloseToEnd = ActivePartyCloseToEnd.has(Number(townId));
        let targets = loadBuildingTargets();
        let townSettings = targets[townId];
        if (townSettings.autoBuild && (!townSettings.queue || townSettings.queue.length === 0)) {
            console.log(`[AutoBuild] ${townName} — queue empty, disabling`);
            saveBuildingTargets(townId, [], false, false, townSettings.selectedSchematic);
            return;
        }
        let model = getBuildingModel(townId);
        if (!model) {
            console.log(`[AutoBuild] ${townName} — no building model`);
            return;
        }
        console.log(`[AutoBuild] ${townName} — starting`);
        let buildsDone = 0;
        while (buildsDone < MAX_ACTIONS_PER_TOWN && !model.attributes.is_building_order_queue_full) {
            if (botcheck() || isUserActive()) {
                console.log(`[AutoBuild] ${townName} — pausing`);
                break;
            }
            const buildData = model.attributes.building_data;
            let success = false;
            if (townSettings.schematicsEnabled && townSettings.selectedSchematic) {
                const next = findNextSchematicBuild(townId, townSettings.selectedSchematic, buildData);
                if (!next) {
                    if (isBuildSchematicComplete(townId, townSettings.selectedSchematic)) {
                        console.log(`[AutoBuild] ${townName} — schematic complete`);
                        townSettings.schematicsEnabled = false;
                        saveBuildingTargets(townId, townSettings.queue, false, false, townSettings.selectedSchematic);
                    } else {
                        console.log(`[AutoBuild] ${townName} — no affordable step`);
                    }
                    break;
                }
                if (isCloseToEnd && wouldBreachPartyThreshold(townId, next.data.resources_for)) {
                    console.log(`[AutoBuild] ${townName} — breach party threshold`);
                    break;
                }
                success = await tryBuild(townId, next.building, false);
            } else if (townSettings.autoBuild && townSettings.queue?.length > 0) {
                const step = townSettings.queue[0];
                const current = getCurrentBuildingLevels(townId)[step.building] || 0;
                const isDown = step.dir === 'downgrade';
                if ((isDown && current <= step.level) || (!isDown && current >= step.level)) {
                    townSettings.queue.shift();
                    saveBuildingTargets(townId, townSettings.queue, townSettings.autoBuild, townSettings.schematicsEnabled, townSettings.selectedSchematic);
                    continue;
                }
                const data = buildData[step.building];
                if (!data) break;
                if (!(hasBuildResources(townId, data.resources_for) && data.population_for <= uw.ITowns.towns[townId].getAvailablePopulation() && (isDown ? current > 0 : !data.has_max_level))) {
                    console.log(`[AutoBuild] ${townName} — can't build ${step.building}`);
                    break;
                }
                if (isCloseToEnd && wouldBreachPartyThreshold(townId, data.resources_for)) {
                    console.log(`[AutoBuild] ${townName} — breach party threshold`);
                    break;
                }
                success = await tryBuild(townId, step.building, isDown);
                if (success) {
                    townSettings.queue.shift();
                    if (townSettings.queue.length === 0) townSettings.autoBuild = false;
                    saveBuildingTargets(townId, townSettings.queue, townSettings.autoBuild, townSettings.schematicsEnabled, townSettings.selectedSchematic);
                }
            } else break;
            if (success) {
                buildsDone++;
                trackStat('build', 1);
                await sleep(random(MIN_ACTION_DELAY, MAX_ACTION_DELAY));
                model = getBuildingModel(townId);
                if (!model) break;
                refreshTownFestivalState(townId);
                isCloseToEnd = ActivePartyCloseToEnd.has(Number(townId));
            } else break;
        }
        console.log(`[AutoBuild] ${townName} — done: ${buildsDone} build(s)`);
    }

    async function runAutoBuildCycle() {
        updateFestivalEligibleTowns();
        const buildStorage = loadBuildingTargets();
        const townIds = Object.keys(uw.ITowns.towns || {}).filter(id => buildStorage[id]?.autoBuild || buildStorage[id]?.schematicsEnabled);
        if (townIds.length === 0) return true;
        let startIndex = (lastBuildTownIndex >= 0 && lastBuildTownIndex < townIds.length - 1) ? lastBuildTownIndex + 1 : 0;
        for (let i = startIndex; i < townIds.length; i++) {
            if (isUserActive() || botcheck()) {
                lastBuildTownIndex = i - 1;
                console.log(`[AutoBuild] Interrupted at index ${i}`);
                return false;
            }
            await processBuildTown(townIds[i]);
            lastBuildTownIndex = i;
            await sleep(random(MIN_TOWN_SWITCH_DELAY, MAX_TOWN_SWITCH_DELAY));
            if (isUserActive() || botcheck()) {
                console.log(`[AutoBuild] Interrupted after town ${townIds[i]}`);
                return false;
            }
        }
        if (lastBuildTownIndex >= townIds.length - 1) lastBuildTownIndex = -1;
        console.log('[AutoBuild] Full cycle complete');
        return true;
    }


    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 2 — AUTO RESEARCH
    // ══════════════════════════════════════════════════════════════

    function researchIsActive(townId, type) {
        return getGameResearchAttrs(townId)[type] === true;
    }

    function researchIsOrdered(townId, type) {
        try {
            return Object.values(uw.MM.getModels().ResearchOrder || {}).some(o => o.attributes.research_type === type && o.attributes.town_id == townId);
        } catch {
            return false;
        }
    }

    function isResearchSchematicComplete(townId, schematicName) {
        const stages = researchSchematicTargets[schematicName];
        if (!stages) return false;
        return stages.every(stage => Object.keys(stage).every(type => researchIsActive(townId, type)));
    }

    function getAvailableResearchPoints(townId) {
        try {
            const perAcad = uw.GameDataResearches.getResearchPointsPerAcademyLevel();
            const acad = uw.ITowns.towns[townId].buildings().attributes.academy || 0;
            let libBonus = 0;
            if (uw.ITowns.towns[townId].buildings().attributes.library > 0) libBonus = uw.GameDataResearches.getResearchPointsPerLibraryLevel();
            const total = perAcad * acad + libBonus;
            let used = 0;
            for (const [k, active] of Object.entries(getGameResearchAttrs(townId))) {
                if (k !== 'id' && active) used += uw.GameData.researches[k]?.research_points || 0;
            }
            let progress = 0;
            Object.values(uw.MM.getModels().ResearchOrder || {}).forEach(o => {
                if (o.attributes.town_id == townId) progress += uw.GameData.researches[o.attributes.research_type]?.research_points || 0;
            });
            return total - used - progress;
        } catch (e) {
            return 0;
        }
    }

    function canExecuteResearchStep(townId, step) {
        const {
            type,
            dir
        } = step;
        if (botcheck() || isUserActive()) return false;
        if (researchIsOrdered(townId, type)) return false;
        if (dir === 'up') {
            if (researchIsActive(townId, type)) return false;
            if ((uw.ITowns.towns[townId].buildings().attributes.academy || 0) < (uw.GameData.researches[type]?.building_dependencies?.academy || 0)) return false;
            const cost = uw.GameData.researches[type]?.resources || {};
            const res = uw.ITowns.towns[townId].resources();
            if (res.wood < (cost.wood || 0) || res.stone < (cost.stone || 0) || res.iron < (cost.iron || 0)) return false;
            if (getAvailableResearchPoints(townId) < (uw.GameData.researches[type]?.research_points || 9999)) return false;
        } else {
            if (!researchIsActive(townId, type)) return false;
        }
        return true;
    }

    async function sendResearch(townId, type, dir, priority = 2) {
        if (botcheck()) return false;
        const queueID = actionQueue.enqueue(priority);
        while (actionQueue.getNext()?.queueID !== queueID) {
            await sleep(random(440, 1000));
        }
        fakeSwitchToTown(townId);
        try {
            await new Promise((res, rej) => {
                uw.gpAjax.ajaxPost('frontend_bridge', 'execute', {
                    model_url: 'ResearchOrder',
                    action_name: dir === 'up' ? 'research' : 'revert',
                    captcha: null,
                    arguments: {
                        id: type
                    },
                    town_id: Number(townId),
                    nl_init: true
                }, false, {
                    success: res,
                    error: rej
                });
            });
            console.log(`[AutoResearch] OK: ${dir === 'up' ? '↑' : '↓'} ${type} town ${townId}`);
            return true;
        } catch (e) {
            console.warn(`[AutoResearch] FAIL: ${type} town ${townId}`, e);
            return false;
        } finally {
            setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
        }
    }

    function removeAndSanitizeResearch(townId, index) {
        const st = loadResearchStorage();
        const e = st[townId];
        if (!e) return;
        e.queue.splice(index, 1);
        e.levels = getGameResearchLevels(townId);
        e.queue = sanitizeResearchQueue(e.queue, e.levels);
        st[townId] = e;
        saveResearchStorage(st);
    }

    function findNextSchematicResearch(townId, schematicName) {
        const stages = researchSchematicTargets[schematicName];
        if (!stages) return null;
        for (const stage of stages) {
            let best = null;
            for (const [type] of Object.entries(stage)) {
                if (researchIsActive(townId, type) || researchIsOrdered(townId, type)) continue;
                if ((uw.ITowns.towns[townId].buildings().attributes.academy || 0) < (uw.GameData.researches[type]?.building_dependencies?.academy || 0)) continue;
                const cost = uw.GameData.researches[type]?.resources || {};
                const res = uw.ITowns.towns[townId].resources();
                if (res.wood < (cost.wood || 0) || res.stone < (cost.stone || 0) || res.iron < (cost.iron || 0)) continue;
                if (getAvailableResearchPoints(townId) < (uw.GameData.researches[type]?.research_points || 9999)) continue;
                const total = (cost.wood || 0) + (cost.stone || 0) + (cost.iron || 0);
                if (!best || total < best.total) best = {
                    type,
                    total,
                    cost
                };
            }
            if (best) return best;
            if (!Object.keys(stage).every(t => researchIsActive(townId, t))) return null;
        }
        return null;
    }

    let lastResearchTownIndex = -1;

    async function processResearchTown(townId) {
        const townName = uw.ITowns.towns[townId]?.name || townId;
        if (isFestivalSkip(townId)) {
            console.log(`[AutoResearch] ${townName} — skipped: festival`);
            return;
        }
        let isCloseToEnd = ActivePartyCloseToEnd.has(Number(townId));
        let entry = loadResearchStorage()[townId];
        if (!entry) return;
        if (entry.autoResearch && (!entry.queue || entry.queue.length === 0)) {
            console.log(`[AutoResearch] ${townName} — queue empty, disabling`);
            saveAcademyTargets(townId, [], false, false, entry.selectedSchematic);
            return;
        }
        const academyLvl = uw.ITowns.towns[townId]?.buildings()?.attributes?.academy || 0;
        const isMaxAcad = academyLvl >= (uw.GameData?.buildings?.academy?.max_level || 30);
        if (isMaxAcad && entry.autoResearch) {
            if (getAvailableResearchPoints(townId) <= 3) {
                const before = entry.queue.length;
                entry.queue = entry.queue.filter(s => s.dir !== 'up');
                if (entry.queue.length < before) {
                    const st = loadResearchStorage();
                    st[townId] = entry;
                    saveResearchStorage(st);
                }
            }
        }
        entry = loadResearchStorage()[townId];
        if (!entry) return;
        console.log(`[AutoResearch] ${townName} — starting`);
        let actions = 0;
        while (actions < MAX_ACTIONS_PER_TOWN) {
            if (botcheck() || isUserActive()) {
                console.log(`[AutoResearch] ${townName} — pausing`);
                break;
            }
            if (entry.schematicsEnabled && entry.selectedSchematic) {
                const next = findNextSchematicResearch(townId, entry.selectedSchematic);
                if (!next) {
                    if (isResearchSchematicComplete(townId, entry.selectedSchematic)) {
                        console.log(`[AutoResearch] ${townName} — schematic complete`);
                        saveAcademyTargets(townId, [], false, false, entry.selectedSchematic);
                    } else {
                        console.log(`[AutoResearch] ${townName} — no affordable step`);
                    }
                    break;
                }
                if (isCloseToEnd && wouldBreachPartyThreshold(townId, next.cost)) {
                    console.log(`[AutoResearch] ${townName} — breach party threshold`);
                    break;
                }
                const ok = await sendResearch(townId, next.type, 'up');
                if (ok) {
                    actions++;
                    trackStat('research', 1);
                    await sleep(random(MIN_ACTION_DELAY, MAX_ACTION_DELAY));
                    entry = loadResearchStorage()[townId];
                    if (!entry) break;
                    refreshTownFestivalState(townId);
                    isCloseToEnd = ActivePartyCloseToEnd.has(Number(townId));
                } else break;
            } else if (entry.autoResearch && entry.queue?.length > 0) {
                const fresh = loadResearchStorage()[townId];
                if (!fresh?.queue?.length) break;
                let index = -1,
                    step = null;
                if (isMaxAcad) {
                    for (let i = 0; i < fresh.queue.length; i++) {
                        if (canExecuteResearchStep(townId, fresh.queue[i])) {
                            index = i;
                            step = fresh.queue[i];
                            break;
                        }
                    }
                } else {
                    if (canExecuteResearchStep(townId, fresh.queue[0])) {
                        index = 0;
                        step = fresh.queue[0];
                    }
                }
                if (index === -1) {
                    console.log(`[AutoResearch] ${townName} — no executable step`);
                    break;
                }
                if (isCloseToEnd && wouldBreachPartyThreshold(townId, uw.GameData.researches[step.type]?.resources || {})) {
                    console.log(`[AutoResearch] ${townName} — breach party threshold`);
                    break;
                }
                const ok = await sendResearch(townId, step.type, step.dir);
                if (ok) {
                    removeAndSanitizeResearch(townId, index);
                    const updatedEntry = loadResearchStorage()[townId];
                    if (updatedEntry && updatedEntry.queue.length === 0) {
                        console.log(`[AutoResearch] ${townName} — queue complete, disabling`);
                        saveAcademyTargets(townId, [], false, false, updatedEntry.selectedSchematic);
                    }
                    actions++;
                    trackStat('research', 1);
                    await sleep(random(MIN_ACTION_DELAY, MAX_ACTION_DELAY));
                    entry = loadResearchStorage()[townId];
                    if (!entry) break;
                    refreshTownFestivalState(townId);
                    isCloseToEnd = ActivePartyCloseToEnd.has(Number(townId));
                } else break;
            } else break;
        }
        console.log(`[AutoResearch] ${townName} — done: ${actions} research(s)`);
    }

    async function runAutoResearchCycle() {
        updateFestivalEligibleTowns();
        const researchStorage = loadResearchStorage();
        const townIds = Object.keys(uw.ITowns.towns || {}).filter(id => researchStorage[id]?.autoResearch || researchStorage[id]?.schematicsEnabled);
        if (townIds.length === 0) return true;
        let startIndex = (lastResearchTownIndex >= 0 && lastResearchTownIndex < townIds.length - 1) ? lastResearchTownIndex + 1 : 0;
        for (let i = startIndex; i < townIds.length; i++) {
            if (isUserActive() || botcheck()) {
                lastResearchTownIndex = i - 1;
                console.log(`[AutoResearch] Interrupted at index ${i}`);
                return false;
            }
            await processResearchTown(townIds[i]);
            lastResearchTownIndex = i;
            await sleep(random(MIN_TOWN_SWITCH_DELAY, MAX_TOWN_SWITCH_DELAY));
            if (isUserActive() || botcheck()) {
                console.log(`[AutoResearch] Interrupted after town ${townIds[i]}`);
                return false;
            }
        }
        if (lastResearchTownIndex >= townIds.length - 1) lastResearchTownIndex = -1;
        console.log('[AutoResearch] Full cycle complete');
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 3 — AUTO HIDE (regular)
    // ══════════════════════════════════════════════════════════════

    function getLowCave(townId) {
        return (uw.ITowns.towns[townId].getEspionageStorage?.() || 0) <= 100000;
    }

    function getCavePercentage(townId) {
        return getLowCave(townId) ? 0.60 : 0.80;
    }

    function hasEnoughResources(townId) {
        const r = uw.ITowns.towns[townId].resources();
        return r.iron >= uw.ITowns.towns[townId].getStorage() * getCavePercentage(townId);
    }

    function calculateIronToHide(townId) {
        const r = uw.ITowns.towns[townId].resources();
        return Math.floor((r.iron - uw.ITowns.towns[townId].getStorage() * getCavePercentage(townId)) / 100) * 100;
    }

    function ironAboveThreshold(townId) {
        return calculateIronToHide(townId) >= 1000;
    }

    function caveBuildingExists(townId) {
        return (uw.ITowns.towns[townId].buildings().attributes.hide || 0) > 9;
    }

    function getCurrentCaveAmount(townId) {
        return uw.ITowns.towns[townId].getEspionageStorage?.() || 0;
    }

    async function caveIronRequest(townId, iron, priority = 3) {
        if (botcheck()) return false;
        const queueID = actionQueue.enqueue(priority);
        while (actionQueue.getNext()?.queueID !== queueID) {
            await sleep(random(440, 1000));
        }
        fakeSwitchToTown(townId);
        try {
            await new Promise((resolve, reject) => {
                uw.gpAjax.ajaxPost('town_overviews', 'store_iron', {
                    town_id: Number(townId),
                    active_town_id: Number(townId),
                    iron_to_keep: 0,
                    iron_to_store: iron
                }, false, {
                    success: resolve,
                    error: reject
                });
            });
            console.log(`[AutoHide] OK: hid ${iron.toLocaleString()} iron in ${uw.ITowns.towns[townId]?.name || townId}`);
            return true;
        } catch (e) {
            console.warn(`[AutoHide] FAIL: town ${townId}`, e);
            return false;
        } finally {
            setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
        }
    }

    let lastHideTownIndex = -1;

    async function runAutoHideCycle() {
        updateFestivalEligibleTowns();
        const hideStorage = loadHideStorage();
        const townIds = Object.keys(uw.ITowns.towns || {}).filter(id => hideStorage[id]?.autoHide);
        if (townIds.length === 0) return true;
        const startIndex = (lastHideTownIndex >= 0 && lastHideTownIndex < townIds.length - 1) ? lastHideTownIndex + 1 : 0;
        console.log(`[AutoHide] Starting — ${townIds.length} town(s), from index ${startIndex}`);
        for (let i = startIndex; i < townIds.length; i++) {
            if (isUserActive() || botcheck()) {
                lastHideTownIndex = i - 1;
                return false;
            }
            const townId = townIds[i];
            const townName = uw.ITowns.towns[townId]?.name || townId;
            const entry = getHideEntry(townId);
            if (entry.targetCapacity !== null) {
                const cc = getCurrentCaveAmount(townId);
                if (cc >= entry.targetCapacity) {
                    console.log(`[AutoHide] ${townName} — target reached, disabling`);
                    saveHideTargets(townId, false, false, entry.targetCapacity);
                    updateTownListIcons();
                    lastHideTownIndex = i;
                    continue;
                }
            }
            if (isFestivalSkip(townId)) {
                console.log(`[AutoHide] ${townName} — festival skip`);
                lastHideTownIndex = i;
                continue;
            }
            if (!caveBuildingExists(townId)) {
                console.log(`[AutoHide] ${townName} — no cave`);
                lastHideTownIndex = i;
                continue;
            }
            if (ActivePartyCloseToEnd.has(Number(townId))) {
                const {
                    wood,
                    stone,
                    iron: currentIron
                } = uw.ITowns.towns[townId].resources();
                if (wood < 15000 || stone < 18000 || currentIron < 15000) {
                    lastHideTownIndex = i;
                    continue;
                }
                const multiplier = Math.random() * 0.5 + 0.5;
                let iron = Math.floor((currentIron - 15000) * multiplier / 100) * 100;
                if (iron <= 0) {
                    lastHideTownIndex = i;
                    continue;
                }
                if (entry.targetCapacity !== null) {
                    iron = Math.min(iron, Math.floor((entry.targetCapacity - getCurrentCaveAmount(townId)) / 100) * 100);
                    if (iron <= 0) {
                        lastHideTownIndex = i;
                        continue;
                    }
                }
                await caveIronRequest(townId, iron, 3);
            } else {
                if (!hasEnoughResources(townId) || !ironAboveThreshold(townId)) {
                    lastHideTownIndex = i;
                    continue;
                }
                let iron = calculateIronToHide(townId);
                if (entry.targetCapacity !== null) {
                    iron = Math.min(iron, Math.floor((entry.targetCapacity - getCurrentCaveAmount(townId)) / 100) * 100);
                    if (iron <= 0) {
                        lastHideTownIndex = i;
                        continue;
                    }
                }
                await caveIronRequest(townId, iron, 3);
            }
            refreshTownFestivalState(townId);
            lastHideTownIndex = i;
            await sleep(random(MIN_ACTION_DELAY, MAX_ACTION_DELAY));
            if (isUserActive() || botcheck()) {
                return false;
            }
        }
        if (lastHideTownIndex >= townIds.length - 1) lastHideTownIndex = -1;
        console.log('[AutoHide] Full cycle complete');
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 4 — AUTO FARM COLLECTOR
    // ══════════════════════════════════════════════════════════════

    function hasCaptain() {
        try {
            return 100 < (uw.layout_main_controller.models.premium_features.attributes.captain || -1) - uw.Timestamp.now();
        } catch (e) {
            return false;
        }
    }

    function farmChooseBestTown(islandTowns, estimatedLootPerResource) {
        const collections = uw.layout_main_controller.collections;
        const castedPowers = Object.values(collections.town_casted_powers?._byId || {}).map(p => p.attributes);
        let best = null;
        for (const town of islandTowns) {
            if (town.has_conqueror) continue;
            const storage = town.storage || 99999;
            const resources = town.resources || {
                wood: 0,
                stone: 0,
                iron: 0
            };
            const production = town.production || {
                wood: 0,
                stone: 0,
                iron: 0
            };
            const elapsed = Math.max(0, (Date.now() - (town.resources_last_update || 0) * 1000) / 3600000);
            const current = {
                wood: resources.wood + production.wood * elapsed,
                stone: resources.stone + production.stone * elapsed,
                iron: resources.iron + production.iron * elapsed
            };
            if (!Object.values(current).some(v => v + estimatedLootPerResource < storage)) continue;
            const hasHymn = castedPowers.some(p => p.town_id === town.id && p.power_id === 'longterm_festival_resource_boost' && (!p.end_at || p.end_at * 1000 > Date.now()));
            const lowestResource = Math.min(current.wood, current.stone, current.iron);
            if (!best || (!best.hasHymn && hasHymn) || (!hasHymn && lowestResource < best.lowestResource)) best = {
                town,
                lowestResource,
                hasHymn
            };
        }
        return best?.town ?? null;
    }

    function buildFarmData() {
        const townFarmData = {};
        const farmsToUpgrade = [];
        const collections = uw.layout_main_controller.collections;
        const relations = Object.values(collections.farm_town_player_relations._byId).map(e => e.attributes);
        const farmTowns = Object.values(collections.farm_towns._byId).map(e => e.attributes);
        const allTowns = collections.towns.models.map(m => m.attributes).filter(t => !t.on_small_island);
        const farmResourcesBase = uw.GameData?.farm_town?.max_resources_per_day || [13, 16, 18, 21, 24, 26];
        const worldSpeed = uw.Game?.game_speed || 1;
        const islandMap = {};
        for (const town of allTowns) {
            const key = `${town.island_x}_${town.island_y}`;
            if (!islandMap[key]) islandMap[key] = [];
            islandMap[key].push(town);
        }
        for (const [islandKey, islandTowns] of Object.entries(islandMap)) {
            const [ix, iy] = islandKey.split('_').map(Number);
            const nearbyFarms = farmTowns.filter(f => f.island_x === ix && f.island_y === iy).slice(0, 6).map(f => {
                const rel = relations.find(r => r.farm_town_id === f.id);
                if (!rel) return null;
                return {
                    farmID: f.id,
                    farmRelationID: rel.id,
                    currentLevel: rel.expansion_stage,
                    tradeRatio: rel.current_trade_ratio,
                    expandedAt: rel.expansion_at,
                    isBuilt: rel.relation_status === 1,
                    lootableAt: rel.lootable_at * 1000
                };
            }).filter(Boolean);
            if (!nearbyFarms.length) continue;
            const readyFarms = nearbyFarms.filter(f => f.isBuilt && Date.now() > f.lootableAt);
            const estimatedLootPerResource = readyFarms.reduce((sum, f) => {
                const li = Math.max(0, Math.min(f.currentLevel - 1, farmResourcesBase.length - 1));
                return sum + (farmResourcesBase[li] || 13) * worldSpeed;
            }, 0);
            const bestTown = farmChooseBestTown(islandTowns, estimatedLootPerResource);
            const base = bestTown || islandTowns[0];
            const villagesWithTownID = nearbyFarms.map(f => ({
                ...f,
                townID: base.id
            }));
            if (bestTown) townFarmData[bestTown.id] = {
                name: bestTown.name,
                townID: bestTown.id,
                island_x: ix,
                island_y: iy,
                villages: villagesWithTownID
            };
            farmsToUpgrade.push(...villagesWithTownID.filter(v => v.currentLevel < 6 && !v.expandedAt));
        }
        return {
            townFarmData,
            farmsToUpgrade
        };
    }

    async function runFarmCollector() {
        console.log('[FarmCollect] Loop started (priority 4)');
        let idleTimer = new Date();
        let prevSleeping = false;
        const farmLoop = async (townIDs = null) => {
            try {
                if (!FARM_CONFIG.useFarm) {
                    await sleep(60000);
                    idleTimer = new Date();
                    return farmLoop();
                }
                if (!hasCaptain()) {
                    console.log('[FarmCollect] No captain — paused 10 min');
                    await sleep(600000);
                    return farmLoop();
                }
                if (botcheck()) {
                    await sleep(60000);
                    idleTimer = new Date();
                    return farmLoop();
                }
                if (prevSleeping && !isSleeping) {
                    idleTimer = new Date();
                    console.log('[FarmCollect] Wake — idle timer reset');
                }
                prevSleeping = isSleeping;
                if (!townIDs) {
    const {
        townFarmData
    } = buildFarmData();
    const ids = Object.values(townFarmData).map(t => t.townID);
    if (!ids.length) {
        console.log('[FarmCollect] No farm town IDs found — retrying in 5 min');
        await sleep(300000);
        return farmLoop();
    }
    return farmLoop(ids);
}
                let farmWindow = uw.GPWindowMgr.getOpen(uw.GPWindowMgr.TYPE_FARM_TOWN_OVERVIEWS);
                if ((!Array.isArray(farmWindow) || !farmWindow.length) && FARM_CONFIG.autoOpenVillages) {
                    uw.Layout.wnd.Create(uw.Layout.wnd.TYPE_FARM_TOWN_OVERVIEWS, 'Αγροτικά χωριά');
                    await sleep(rand(1000, 3000));
                    farmWindow = uw.GPWindowMgr.getOpen(uw.GPWindowMgr.TYPE_FARM_TOWN_OVERVIEWS);
                }
                if (!Array.isArray(farmWindow) || !farmWindow.length) {
                    await sleep(60000);
                    idleTimer = new Date();
                    return farmLoop();
                }
                const secondsIdle = (Date.now() - idleTimer.getTime()) / 1000;
                const isLongRest = isSleeping || secondsIdle > rand(36000, 43200);
                let timeOption = 300;
                if (isLongRest) timeOption *= 18;
                if (isSleeping) console.log('[FarmCollect] Sleep — using long-rest');
                if (!townIDs.length) {
    console.log('[FarmCollect] townIDs is empty — skipping request, retrying in 5 min');
    await sleep(300000);
    return farmLoop();
}
                const queueID = actionQueue.enqueue(4);
                while (actionQueue.getNext()?.queueID !== queueID) {
                    await sleep(random(440, 1000));
                }
                try {
                    console.log('[FarmCollect] ' , townIDs);
                    farmWindow[0].getHandler().wnd.ajaxRequestGet('farm_town_overviews', 'get_farm_towns_from_multiple_towns', {
                        town_ids: townIDs,
                        town_id: uw.Game.townId,
                        nl_init: true
                    });
                    await sleep(rand(1000, 2000));
                    farmWindow[0].getHandler().wnd.ajaxRequestPost('farm_town_overviews', 'claim_loads_multiple', {
                        towns: townIDs,
                        time_option_base: timeOption,
                        time_option_booty: timeOption * 2,
                        claim_factor: 'normal',
                        town_id: uw.Game.townId
                    });
                    console.log(`[FarmCollect] Collected — timeOption=${timeOption * 2}s`);
                    trackStat('farmRun', 1);
                } finally {
                    setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
                }
                const nextDelay = rand(timeOption * 2, timeOption * 3) * 1000;
                showToastOnly('success', '🌾 Farm collection completed');
                console.log(`[FarmCollect] Next in ~${Math.round(nextDelay / 60000)} min`);
                await sleep(nextDelay);
                if (isLongRest) {
                    idleTimer = new Date();
                    return farmLoop();
                }
                return farmLoop(townIDs);
            } catch (e) {
                console.error('[FarmCollect] Error:', e);
                await sleep(60000);
                return farmLoop(townIDs);
            }
        };
        farmLoop();
    }


    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 5 — FARM VILLAGE UPGRADER
    // ══════════════════════════════════════════════════════════════

    const FARM_BP_COST = {
        1: 2,
        2: 8,
        3: 10,
        4: 30,
        5: 50,
        6: 100
    };

    async function upgradeFarmVillage({
        townID,
        farmID,
        farmRelationID,
        isBuilt,
        currentLevel
    }) {
        if (botcheck()) return null;
        const getQueueID = actionQueue.enqueue(5);
        while (actionQueue.getNext()?.queueID !== getQueueID) {
            await sleep(random(440, 1000));
        }
        fakeSwitchToTown(townID);
        try {
            await new Promise((resolve, reject) => {
                uw.gpAjax.ajaxGet('frontend_bridge', 'execute', {
                    model_url: 'FarmTownPlayerRelation',
                    action_name: 'getTownSpecificData',
                    arguments: {
                        farm_town_id: farmID
                    },
                    town_id: Number(townID)
                }, false, {
                    success: resolve,
                    error: reject
                });
            });
        } catch (e) {
            console.warn('[FarmUpgrade] GET failed:', e);
            return null;
        } finally {
            setTimeout(() => actionQueue.dequeue(getQueueID), random(1000, 3000));
        }
        await sleep(random(800, 1500));
        const postQueueID = actionQueue.enqueue(5);
        while (actionQueue.getNext()?.queueID !== postQueueID) {
            await sleep(random(440, 1000));
        }
        fakeSwitchToTown(townID);
        try {
            await new Promise((resolve, reject) => {
                uw.gpAjax.ajaxPost('frontend_bridge', 'execute', {
                    model_url: `FarmTownPlayerRelation/${farmRelationID}`,
                    action_name: isBuilt ? 'upgrade' : 'unlock',
                    arguments: {
                        farm_town_id: farmID
                    },
                    town_id: Number(townID)
                }, false, {
                    success: resolve,
                    error: reject
                });
            });
            console.log(`[FarmUpgrade] OK: ${isBuilt ? 'upgrade' : 'unlock'} village ${farmID}`);
            return (isBuilt && FARM_BP_COST[currentLevel + 1]) || 100;
        } catch (e) {
            console.warn('[FarmUpgrade] POST failed:', e);
            return null;
        } finally {
            setTimeout(() => actionQueue.dequeue(postQueueID), random(1000, 3000));
        }
    }

    async function runVillageUpgrader() {
        console.log('[FarmUpgrade] Loop started (priority 5)');
        while (true) {
            try {
                if (!FARM_CONFIG.upgradeVillages) {
                    await sleep(60000);
                    continue;
                }
                while (isUserActive()) {
                    await sleep(5000);
                }
                while (isSleeping) {
                    await sleep(60000);
                }
                if (botcheck()) {
                    await sleep(10000);
                    continue;
                }
                const maxLevel = parseInt(FARM_CONFIG.villagesMaxLevel) || 1;
                let {
                    farmsToUpgrade
                } = buildFarmData();
                farmsToUpgrade = farmsToUpgrade.filter(v => !v.isBuilt || v.currentLevel < maxLevel);
                if (!farmsToUpgrade.length) {
                    await sleep(rand(6000000, 12000000));
                    continue;
                }
                console.log(`[FarmUpgrade] ${farmsToUpgrade.length} eligible`);
                const kp = uw.layout_main_controller.models.player_killpoints?.attributes || {};
                let availableBP = (kp.att || 0) + (kp.def || 0) - (kp.used || 0);
                let upgraded = 0;
                for (let i = 0; i < farmsToUpgrade.length; i++) {
                    if (isUserActive() || botcheck()) {
                        console.log(`[FarmUpgrade] Interrupted at ${i}`);
                        break;
                    }
                    if (availableBP < 100) {
                        console.log(`[FarmUpgrade] Not enough BP`);
                        break;
                    }
                    const spent = await upgradeFarmVillage(farmsToUpgrade[i]);
                    if (spent !== null) {
                        availableBP -= spent;
                        upgraded++;
                        trackStat('villageUpgrade', 1);
                    }
                    await sleep(rand(500, 1500));
                    if (i > 0 && i % 6 === 0) await sleep(rand(2000, 3500));
                }
                if (upgraded > 0) console.log(`[FarmUpgrade] Upgraded ${upgraded} village(s)`);
                await sleep(rand(1800000, 3600000));
            } catch (e) {
                console.error('[FarmUpgrade] Error:', e);
                await sleep(60000);
            }
        }
    }


    // ══════════════════════════════════════════════════════════════
    //  PRIORITY 6 — AUTO CULTURE
    // ══════════════════════════════════════════════════════════════

    function hasAdministrator() {
        try {
            return (uw.layout_main_controller.models.premium_features.attributes.curator || -1) - (uw.Timestamp?.now() || Date.now() / 1000) > 100;
        } catch (e) {
            return false;
        }
    }

    async function cultureAction(method, controller, func, data = {}) {
        if (botcheck()) return null;
        const queueID = actionQueue.enqueue(6);
        while (actionQueue.getNext()?.queueID !== queueID) {
            await sleep(random(440, 1000));
        }
        try {
            const payload = {
                town_id: uw.Game.townId,
                ...data
            };
            return method === 'GET' ? await uw.gpAjax.get(controller, func, payload) : await uw.gpAjax.post(controller, func, payload);
        } catch (e) {
            console.warn(`[AutoCulture] FAIL: ${controller}/${func}`, e);
            return null;
        } finally {
            setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
        }
    }

    async function runAutoCultureLoop() {
        console.log('[AutoCulture] Loop started (priority 6)');
        while (true) {
            try {
                if (!hasAdministrator()) {
                    await sleep(3600000);
                    continue;
                }
                if (botcheck()) {
                    await sleep(60000);
                    continue;
                }
                console.log('[AutoCulture] Running culture round...');
                const raw = await cultureAction('GET', 'town_overviews', 'culture_overview');
                if (!raw) {
                    await sleep(300000);
                    continue;
                }
                let parsed;
                try {
                    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                } catch (e) {
                    await sleep(300000);
                    continue;
                }
                const htmlPart = parsed?.json?.html || '';
                if (!htmlPart || !htmlPart.includes('CultureOverview.init(')) {
                    await sleep(300000);
                    continue;
                }
                // CultureOverview.init(activeArray, durationsObj)
                // Wrap both args in [] so JSON.parse sees a valid array, then destructure.
                const initStr = htmlPart.split('CultureOverview.init(')[1].split(');')[0];
                const [activeCelebrations] = JSON.parse('[' + initStr + ']');

                // activeCelebrations is an array of running celebration objects,
                // each with a 'type' key (e.g. "triumph", "party", "theater", "games").
                const activeCounts = {};
                if (Array.isArray(activeCelebrations)) {
                    for (const cel of activeCelebrations) {
                        if (cel?.type) activeCounts[cel.type] = (activeCounts[cel.type] || 0) + 1;
                    }
                }
                const allTowns = Object.values(uw.ITowns.getTowns());
                const theaterTowns = [];
                const partyTowns = [];
                const academyTowns = [];
                for (const town of allTowns) {
                    const {
                        theater,
                        storage,
                        academy
                    } = town.getBuildings()?.attributes || {};
                    if ((academy || 0) < 30) continue;
                    academyTowns.push(town.id);
                    if (theater) theaterTowns.push(town.id);
                    if ((storage || 0) >= 23) partyTowns.push(town.id);
                }
                const toRun = [];
                if (CULTURE_CONFIG.runTheater && theaterTowns.length) toRun.push('theater');
                if (CULTURE_CONFIG.runParty && partyTowns.length) toRun.push('party');
                if (CULTURE_CONFIG.runTriumph && academyTowns.length) {
                    const {
                        att = 0, def = 0, used = 0
                    } = uw.layout_main_controller.models.player_killpoints.attributes || {};
                    if (att + def - used - CULTURE_CONFIG.cultureKeepBP > 300 * allTowns.length) toRun.push('triumph');
                }
                if (CULTURE_CONFIG.runGames && academyTowns.length) {
                    const gold = (uw.layout_main_controller.models.player_ledger.attributes || {}).gold || 0;
                    if (gold - CULTURE_CONFIG.cultureKeepGold > 50 * allTowns.length) toRun.push('games');
                }
                const eligibleCount = {
                    theater: theaterTowns.length || 1,
                    party: partyTowns.length || 1,
                    triumph: academyTowns.length || 1,
                    games: academyTowns.length || 1
                };
                const fillRatios = {};
                for (const type of toRun) {
                    fillRatios[type] = (activeCounts[type] || 0) / eligibleCount[type];
                }
                await cultureAction('POST', 'frontend_bridge', 'execute', {
                    model_url: 'TownGroup/-1',
                    action_name: 'setActive',
                    captcha: null,
                    arguments: {
                        id: -1
                    }
                });
                await sleep(random(1000, 2000));
                let anyFired = false;
                for (const type of toRun) {
                    if ((fillRatios[type] || 0) >= 1) continue;
                    await sleep(random(3000, 10000));
                    await cultureAction('POST', 'town_overviews', 'start_all_celebrations', {
                        celebration_type: type
                    });
                    const typeLabel = { theater: '🎭 Theater', party: '🎉 Party', triumph: '🏆 Triumph', games: '🎮 Games' }[type] || type;
                    showToastOnly('success', `${typeLabel} celebrations started`);
                    anyFired = true;
                }
                if (!anyFired) console.log('[AutoCulture] All already running.');
                const minRatio = toRun.length ? Math.min(...toRun.map(t => fillRatios[t] || 0)) : 1;
                const waitMs = minRatio < 0.5 ? rand(CULTURE_CONFIG.waitLowMin, CULTURE_CONFIG.waitLowMax) : rand(CULTURE_CONFIG.waitHighMin, CULTURE_CONFIG.waitHighMax);
                console.log(`[AutoCulture] Next run in ~${Math.round(waitMs/60000)} min`);
                await sleep(waitMs);
            } catch (e) {
                console.error('[AutoCulture] Error:', e);
                await sleep(300000);
            }
        }
    }


    // ══════════════════════════════════════════════════════════════
    //  MASTER ALTERNATING LOOP
    // ══════════════════════════════════════════════════════════════

    async function masterLoop() {
        console.log('[Master v2.0] AutoBuild + AutoResearch + AutoHide random-order loop started');

        function shuffleTasks() {
            const arr = ['build', 'research', 'hide'];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }
        const cycleRunners = {
            build: {
                label: 'AutoBuild',
                fn: runAutoBuildCycle
            },
            research: {
                label: 'AutoResearch',
                fn: runAutoResearchCycle
            },
            hide: {
                label: 'AutoHide',
                fn: runAutoHideCycle
            }
        };
        let queue = shuffleTasks();
        console.log(`[Master] ✦ First round: ${queue.join(' → ')}`);
        while (true) {
            updateFestivalEligibleTowns();
            while (isUserActive()) {
                await sleep(5000);
            }
            while (isSleeping) {
                await sleep(60000);
            }
            if (botcheck()) {
                await sleep(10000);
                continue;
            }
            if (queue.length === 0) {
                queue = shuffleTasks();
                console.log(`[Master] ✦ New round: ${queue.join(' → ')}`);
            }
            const {
                label,
                fn
            } = cycleRunners[queue[0]];
            console.log(`[Master] ▶ ${label} — remaining: [${queue.join(', ')}]`);
            const cycleCompleted = await fn();
            console.log(`[Master] ${cycleCompleted ? `✓ ${label} done` : `↺ ${label} interrupted`}`);
            if (cycleCompleted) {
                queue.shift();
                const delay = random(MIN_RUN_DELAY, MAX_RUN_DELAY);
                statusNextRunAt = Date.now() + delay;
                statusLastTask = label;
                statusLog.unshift(`${new Date().toLocaleTimeString()} — ✓ ${label}`);
                if (statusLog.length > 20) statusLog.pop();
                // Auto-push alliance data after each completed cycle
                if (typeof alPushData === 'function') {
                    alPushData().catch(() => {});
                }
                console.log(`[Master] Sleeping ${Math.round(delay/60000)} min`);
                await sleep(delay);
            }
        }
    }


    // ══════════════════════════════════════════════════════════════
    //  SLEEP SCHEDULE
    // ══════════════════════════════════════════════════════════════

    function startSleepSchedule() {
        if (!SLEEP_CONFIG.enabled) {
            console.log('[SleepSchedule] Disabled.');
            return;
        }
        const wakeJitterSecs = random(-Math.round(SLEEP_CONFIG.wakeJitterMs / 1000), Math.round(SLEEP_CONFIG.wakeJitterMs / 1000));
        const sleepWindowSecs = -random(Math.round(SLEEP_CONFIG.sleepMinMs / 1000), Math.round(SLEEP_CONFIG.sleepMaxMs / 1000));
        const checkSleep = async () => {
            const now = new Date();
            const sleepHour = SLEEP_CONFIG.sleepHour;
            const todayTarget = new Date(now);
            todayTarget.setHours(sleepHour, 0, 0, 0);
            const yesterdayTarget = new Date(now);
            yesterdayTarget.setDate(yesterdayTarget.getDate() - 1);
            yesterdayTarget.setHours(sleepHour, 0, 0, 0);
            const secsToToday = (todayTarget - now) / 1000;
            const secsToYesterday = (yesterdayTarget - now) / 1000;
            const secsToSleep = Math.abs(secsToToday) < Math.abs(secsToYesterday) ? secsToToday : secsToYesterday;
            const shouldSleep = secsToSleep <= wakeJitterSecs && secsToSleep >= sleepWindowSecs;
            if (shouldSleep && !isSleeping) {
                isSleeping = true;
                pushAlert('info', '😴 Bot entered sleep mode — AutoBuild/Research/Hide paused');
                console.log('[SleepSchedule] Sleeping — AutoBuild/Research/Hide/FarmUpgrade paused.');
            } else if (!shouldSleep && isSleeping) {
                isSleeping = false;
                console.log('[SleepSchedule] Waking up.');
            }
            await sleep(60000);
            checkSleep();
        };
        checkSleep();
    }


    // ══════════════════════════════════════════════════════════════
    //  AUTO RELOAD
    // ══════════════════════════════════════════════════════════════

    function startAutoReload() {
        console.log('[AutoReload] Watching for update banner.');
        setInterval(async () => {
            let detected = false;
            uw.$('.message').each(function() {
                if (this.innerHTML.includes('Για να συνεχίσεις να παίζεις, ανανέωσε τη σελίδα')) detected = true;
            });
            if (!detected) return;
            if (botcheck()) {
                console.warn('[AutoReload] Captcha active — NOT reloading.');
                return;
            }
            const delay = random(10000, 45000);
            console.log(`[AutoReload] Reloading in ${Math.round(delay/1000)}s.`);
            await sleep(delay);
            if (botcheck()) return;
            location.reload();
        }, 60000);
    }


    // ══════════════════════════════════════════════════════════════
    //  MASTER CONFIG WINDOW
    // ══════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════
    //  5 ΛΕΠΤΑ — HELPER FUNCTIONS
    // ══════════════════════════════════════════════════════════════
      let _fmRafId = null;
    let _fmTickInterval = null;
    function fmGetTownTroopsFull(townId) {
        if (!uw.ITowns?.towns?.[townId]) return null;
        let all = {};
        Object.keys(uw.GameData?.units || {}).forEach(u => all[u] = 0);
        const units = uw.ITowns.towns[townId].units() || {};
        Object.keys(units).forEach(u => all[u] += units[u]);
        const outer = uw.ITowns.towns[townId].unitsOuter() || {};
        Object.keys(outer).forEach(u => all[u] += outer[u]);
        const orders = uw.ITowns.towns[townId].getUnitOrdersCollection()?.models || [];
        orders.forEach(o => {
            if (o.attributes.units_left > 0) all[o.attributes.unit_type] += o.attributes.units_left;
        });
        return all;
    }

    function fmGetTotalPop(townId) {
        const troops = fmGetTownTroopsFull(townId);
        if (!troops) return 0;
        let total = 0;
        Object.keys(troops).forEach(u => {
            const pop = uw.GameData?.units?.[u]?.population || 0;
            if (troops[u] > 0 && pop > 0) total += troops[u] * pop;
        });
        return total;
    }

    async function fmSendAttack(enemyTownId, unit, amount, myTownId) {
    const queueID = actionQueue.enqueue(0);
    while (actionQueue.getNext()?.queueID !== queueID) {
        await sleep(random(440, 1000));
    }
    fakeSwitchToTown(myTownId);
    try {
        const response = await uw.gpAjax.ajaxPost('town_info', 'send_units', {
            id:      enemyTownId,
            type:    'attack',
            town_id: myTownId,
            [unit]:  amount,
            nl_init: true
        }, false);

        const data   = (typeof response === 'string') ? JSON.parse(response) : response;
        const notifs = data?.json?.notifications || data?.notifications || [];

        for (const n of notifs) {
            if (n.subject === 'MovementsUnits') {
                const parsed    = JSON.parse(n.param_str).MovementsUnits;
                const commandId = parsed?.command_id;
                if (commandId) {
                    console.log('%c[5λεπτα OK]', 'color:#2ecc71;font-weight:bold', `fmSendAttack | command_id=${commandId}`);
                    return commandId;
                }
            }
        }
        throw new Error('command_id not found in notifications');
    } finally {
        setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
    }
}

    async function fmCancelCommand(commandId, myTownId) {
    const queueID = actionQueue.enqueue(0);
    while (actionQueue.getNext()?.queueID !== queueID) {
        await sleep(random(440, 1000));
    }
    fakeSwitchToTown(myTownId);
    try {
        await new Promise((resolve, reject) => {
            const data = { id: commandId, town_id: myTownId, nl_init: true };
            uw.gpAjax.ajaxPost('town_overviews', 'cancel_command', data, false, {
                success: () => resolve(true), error: (e) => reject(e)
            });
        });
    } finally {
        setTimeout(() => actionQueue.dequeue(queueID), random(1000, 3000));
    }
}



    function createMasterConfigWindow() {
    if (document.getElementById('masterWindow')) {
        uw.GPWindowMgr.getOpenFirst(uw.GPWindowMgr.TYPE_DIALOG)?.focus?.();
        return;
    }
    uw.GPWindowMgr.Create(uw.GPWindowMgr.TYPE_DIALOG, 'Grepolis Master');
    const w = uw.GPWindowMgr.getOpenFirst(uw.GPWindowMgr.TYPE_DIALOG);
        setTimeout(() => w.setPosition(['center', 50]), 50);
        w.setSize(460, 600);

        function ms2min(ms) { return Math.round(ms / 60000); }
        function ms2hr(ms)  { return +(ms / 3600000).toFixed(2); }

        const html = `
        <div id="masterWindow">
            <div class="tab-bar">
    <button class="tab-btn active" data-tab="status">📊 Status</button>
    <button class="tab-btn" data-tab="towns">🏛 Towns</button>
    <button class="tab-btn" data-tab="stats">📈 Stats</button>
    <button class="tab-btn" data-tab="alerts">🔔 Alerts</button>
    <button class="tab-btn" data-tab="alliance">⚔️ Alliance</button>
<button class="tab-btn" data-tab="requests" style="position:relative;padding-left:26px;">
    <span style="background:url(https://gpgr.innogamescdn.com/images/game/overviews/town_tile.png) 0 -500px no-repeat;width:22px;height:16px;display:inline-block;vertical-align:middle;margin-right:4px;"></span>
    Requests
</button>
    <div class="tab-row-divider"></div>
    <button class="tab-btn" data-tab="fivemins">⚡ 5 λέπτα</button>
    <button class="tab-btn" data-tab="protection">🛡️ Προστασία</button>
    <button class="tab-btn" data-tab="uitoggle">🎨 UI</button>
    <button class="tab-btn" data-tab="config">⚙️ Config</button>
    <button class="tab-btn" data-tab="info">🔍 Info</button>
</div>

            <!-- ── STATUS TAB ── -->
            <div class="tab-pane active" id="tab-status">
                <div id="status-state-box" class="status-state-box active">
                    <div class="dot"></div>
                    <span id="status-state-label">Checking...</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                    <div class="status-card">
                        <div class="status-card-title">Next run in</div>
                        <div class="status-card-value" id="status-next-run">—</div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-title">Last completed</div>
                        <div class="status-card-value" id="status-last-task">—</div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-title">AutoBuild towns</div>
                        <div class="status-card-value" id="status-build-count">—</div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-title">AutoResearch towns</div>
                        <div class="status-card-value" id="status-research-count">—</div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-title">AutoHide towns</div>
                        <div class="status-card-value" id="status-hide-count">—</div>
                    </div>
                    <div class="status-card">
                        <div class="status-card-title">AutoTroop towns</div>
                        <div class="status-card-value" id="status-troop-count">—</div>
                    </div>
                </div>
                <div class="status-card">
                    <div class="status-card-title">Recent activity</div>
                    <div id="status-log"></div>
                </div>
            </div>

            <!-- ── TOWNS TAB ── -->
            <div class="tab-pane" id="tab-towns">
                <div id="towns-table-wrap">
                    <table class="town-table">
                        <thead>
                            <tr>
                                <th>Town</th>
                                <th>Build</th>
                                <th>Research</th>
                                <th>Hide</th>
                                <th>Troop</th>
                            </tr>
                        </thead>
                        <tbody id="towns-tbody"></tbody>
                    </table>
                </div>
            </div>

            <!-- ── STATS TAB ── -->
            <div class="tab-pane" id="tab-stats">
                <div class="stats-counter-grid" id="stats-counters"></div>
                <div class="stats-section-title">📅 Last 7 Days Activity</div>
                <div class="stats-chart-wrap"><div class="stats-chart-bar-row" id="stats-chart"></div></div>
                <div class="stats-section-title">⚔️ Troops Recruited (Lifetime)</div>
                <div id="stats-troops"></div>
                <button class="stats-reset-btn" id="stats-reset-btn">🗑 Reset Lifetime Stats</button>
            </div>

            <!-- ── ALERTS TAB ── -->
            <div class="tab-pane" id="tab-alerts">
                <div class="stats-section-title">🔧 Alert Settings</div>
                <div style="background:#fff8e1;border:1px solid #c9a875;border-radius:6px;padding:8px 12px;margin-bottom:12px;">
                    <div class="alert-cfg-row">
                        <label>Troops below saved target</label>
                        <input type="checkbox" id="alrt_troopBelow">
                    </div>
                    <div class="alert-cfg-row">
                        <label>AutoTroop disabled but troops not at target</label>
                        <input type="checkbox" id="alrt_tradeDisabled">
                    </div>
                    <div class="alert-cfg-row">
                        <label>Bot stuck — no run in</label>
                        <input type="number" id="alrt_botStuckMin" min="10" style="width:56px">
                        <span style="font-size:11px;color:#999;white-space:nowrap">min</span>
                        <input type="checkbox" id="alrt_botStuck">
                    </div>
                    <div class="alert-cfg-row">
                        <label>Captcha detected</label>
                        <input type="checkbox" id="alrt_captcha">
                    </div>
                    <button class="alert-save-btn" id="alrt_saveBtn">💾 Save Alert Settings</button>
                </div>
                <div style="border-top:1px solid rgba(0,0,0,0.1);margin-top:10px;padding-top:10px;">
    <div style="font-size:12px;font-weight:bold;color:#5c3a1a;margin-bottom:8px;">🔔 Discord Notifications</div>
    <div class="alert-cfg-row">
        <label>Enable attack notifications</label>
        <input type="checkbox" id="notif_attack_toggle">
    </div>
    <div class="alert-cfg-row">
    <label>Enable possible CS notifications</label>
    <input type="checkbox" id="notif_possible_cs_toggle">
</div>
    <div class="alert-cfg-row">
        <label>Enable CS (colonization) notifications</label>
        <input type="checkbox" id="notif_cs_toggle">
    </div>
</div>
                <div class="stats-section-title">📋 Alert Log
                    <button id="alrt_clearLog" style="float:right;background:#a83232;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;">Clear</button>
                </div>
                <div id="alert-log-list"></div>
            </div>
<!-- ── ALLIANCE TAB ── -->
            <div class="tab-pane" id="tab-alliance">
                <div id="alliance-status-bar" class="alliance-status-bar disconnected">⚔️ Not connected</div>
                <div style="display:flex;gap:6px;margin-bottom:10px;">
                    <button id="al_pushBtn"  class="alliance-action-btn green">📤 Push My Data</button>
                    <button id="al_fetchBtn" class="alliance-action-btn blue">🔄 Refresh</button>
                </div>
                <div id="al_lastFetch" class="alliance-updated" style="margin-bottom:8px;"></div>
                <div id="alliance-table-wrap" style="overflow-x:auto;"></div>
            </div>
            <!-- ── REQUESTS TAB ── -->
<div class="tab-pane" id="tab-requests">
    <div id="req-status-bar" style="font-size:11px;color:#8b5a2b;margin-bottom:8px;"></div>
    <div style="background:rgba(0,0,0,0.1);border-radius:6px;padding:8px;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:bold;color:#5c3a1a;margin-bottom:6px;">📤 New Request</div>
        <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
            <select id="req-town" style="flex:2;padding:4px;font-size:11px;background:#fff;border:1px solid #8b5a2b;border-radius:4px;">
                <option value="">-- Select your town --</option>
            </select>
            <select id="req-expires" style="flex:1;padding:4px;font-size:11px;background:#fff;border:1px solid #8b5a2b;border-radius:4px;">
                <option value="3600">1 hour</option>
                <option value="7200">2 hours</option>
                <option value="14400">4 hours</option>
                <option value="28800">8 hours</option>
                <option value="86400">24 hours</option>
            </select>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
            <div style="display:flex;gap:6px;margin-bottom:6px;">
    <div style="flex:1;display:flex;align-items:center;gap:2px;min-width:0;">
        <div style="background:url(https://gpgr.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -25px -671px;width:25px;height:20px;flex-shrink:0;"></div>
        <input id="req-wood" type="number" min="0" placeholder="Wood" style="flex:1;padding:2px;font-size:10px;background:#fff;border:1px solid #8b5a2b;border-radius:4px;min-width:0;width:100%;">
    </div>
    <div style="flex:1;display:flex;align-items:center;gap:2px;min-width:0;">
        <div style="background:url(https://gpgr.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat 0 -671px;width:25px;height:20px;flex-shrink:0;"></div>
        <input id="req-stone" type="number" min="0" placeholder="Stone" style="flex:1;padding:2px;font-size:10px;background:#fff;border:1px solid #8b5a2b;border-radius:4px;min-width:0;width:100%;">
    </div>
    <div style="flex:1;display:flex;align-items:center;gap:2px;min-width:0;">
        <div style="background:url(https://gpgr.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -672px -647px;width:25px;height:20px;flex-shrink:0;"></div>
        <input id="req-iron" type="number" min="0" placeholder="Iron" style="flex:1;padding:2px;font-size:10px;background:#fff;border:1px solid #8b5a2b;border-radius:4px;min-width:0;width:100%;">
    </div>
</div>
        </div>
        <button id="req-push-btn" style="width:100%;padding:6px;background:linear-gradient(180deg,#7a5500,#4a3200);border:1px solid #c8960c;border-radius:4px;color:#f0d070;cursor:pointer;font-size:11px;">📤 Push Request</button>
    </div>
    <div style="font-size:11px;font-weight:bold;color:#5c3a1a;margin-bottom:6px;">
        📋 Active Requests
        <button id="req-refresh-btn" style="float:right;background:#4a6fa5;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;">🔄 Refresh</button>
    </div>
    <div id="req-list"></div>
</div>
            <!-- ── 5 ΛΕΠΤΑ TAB ── -->
            <div class="tab-pane" id="tab-fivemins">
                <div id="fm-status" class="fivemin-status">Enter source & target town ID</div>
                <div id="fm-screen"></div>
            </div>

<!-- ── INFO TAB ── -->
            <div class="tab-pane" id="tab-info">
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                    <select id="info-player-sel" style="flex:1;min-width:140px;background:#1a1a2e;border:1px solid #5588cc;color:#d8c59a;padding:5px 8px;border-radius:4px;font-size:12px;cursor:pointer;">
                        <option value="">— Loading players… —</option>
                    </select>
                    <select id="info-town-sel" disabled style="flex:1;min-width:140px;background:#1a1a2e;border:1px solid #5588cc;color:#d8c59a;padding:5px 8px;border-radius:4px;font-size:12px;cursor:pointer;opacity:0.5;">
                        <option value="">— Select player first —</option>
                    </select>
                    <button id="info-refresh-btn" style="background:#2a4a7f;border:1px solid #5588cc;color:#d8c59a;padding:5px 10px;border-radius:4px;font-size:12px;cursor:pointer;white-space:nowrap;">🔄 Refresh</button>
                </div>
                <div id="info-display" style="background:#0d1117;border:1px solid #2a3a5a;border-radius:6px;padding:10px;min-height:180px;max-height:370px;overflow-y:auto;font-size:12px;color:#d8c59a;">
                    <div style="text-align:center;color:#555;padding-top:60px;">Select a player and town above to view details.</div>
                </div>
            </div>

            <!-- ── UI TOGGLE TAB ── -->
            <div class="tab-pane" id="tab-uitoggle">
                <div class="stats-section-title">In-Game UI Panels</div>
                <div style="font-size:11px;color:#7a4a1a;margin-bottom:12px">
                    Toggle the overlay panels that appear when you open buildings in game. Changes take effect immediately — reopen the building to see the result.
                </div>

                <div class="cfg-row" style="margin-bottom:10px">
                    <label class="cfg-label" style="font-size:13px">🏛 Build Panel (Senate)</label>
                    <label class="cfg-toggle">
                        <input type="checkbox" id="ui_showBuild">
                        <span class="cfg-toggle-slider"></span>
                    </label>
                </div>
                <div class="cfg-row" style="margin-bottom:10px">
                    <label class="cfg-label" style="font-size:13px">🔬 Research Panel (Academy)</label>
                    <label class="cfg-toggle">
                        <input type="checkbox" id="ui_showResearch">
                        <span class="cfg-toggle-slider"></span>
                    </label>
                </div>
                <div class="cfg-row" style="margin-bottom:10px">
                    <label class="cfg-label" style="font-size:13px">🏦 Hide Panel (Warehouse)</label>
                    <label class="cfg-toggle">
                        <input type="checkbox" id="ui_showHide">
                        <span class="cfg-toggle-slider"></span>
                    </label>
                </div>
                <div class="cfg-row" style="margin-bottom:14px">
                    <label class="cfg-label" style="font-size:13px">⚔️ Troop Panel (Barracks/Docks)</label>
                    <label class="cfg-toggle">
                        <input type="checkbox" id="ui_showTroop">
                        <span class="cfg-toggle-slider"></span>
                    </label>
                </div>
                 <div class="cfg-row" style="margin-bottom:14px">
                    <label class="cfg-label" style="font-size:13px">⚔️ Troop Counter (Barracks/Docks)</label>
                    <label class="cfg-toggle">
                        <input type="checkbox" id="ui_showTroopCounter">
                        <span class="cfg-toggle-slider"></span>
                    </label>
                </div>
                <div class="cfg-row" style="margin-bottom:14px">
    <label class="cfg-label" style="font-size:13px">🗡️ Simulator Attack Counter</label>
    <label class="cfg-toggle">
        <input type="checkbox" id="ui_showSimCounter">
        <span class="cfg-toggle-slider"></span>
    </label>
</div>
                <div id="ui_saved" style="font-size:11px;color:#27ae60;min-height:18px;text-align:center"></div>
            </div>
                <!-- ── ΠΡΟΣΤΑΣΙΑ TAB ── -->
<div class="tab-pane" id="tab-protection">
    <div class="stats-section-title">🛡️ Athena City Protection Scheduler</div>

    <div style="background:#fff8e1; border:1px solid #c9a875; border-radius:6px; padding:12px; margin-bottom:12px;">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
            <input id="prot-cityId" type="number" min="0" placeholder="Target City ID" style="flex:1; padding:6px; font-size:13px;">
            <div style="display:flex; gap:4px;">
                <input id="prot-hh" type="number" min="0" max="23" placeholder="HH" style="width:50px; padding:6px; text-align:center; font-size:13px;">
                <input id="prot-mm" type="number" min="0" max="59" placeholder="MM" style="width:50px; padding:6px; text-align:center; font-size:13px;">
                <input id="prot-ss" type="number" min="0" max="59" placeholder="SS" style="width:50px; padding:6px; text-align:center; font-size:13px;">
            </div>
        </div>
        <button id="prot-add" class="fivemin-btn green" style="width:100%; padding:8px; font-size:13px;">+ Add Schedule</button>
    </div>

    <div class="stats-section-title">Scheduled Protections</div>
    <div id="prot-list" style="display:flex; flex-direction:column; gap:8px; max-height:280px; overflow-y:auto; padding-right:6px;"></div>

    <div id="prot-status" style="margin-top:12px; font-size:12px; color:#4a2b0f; text-align:center; min-height:20px;"></div>
</div>
            <!-- ── CONFIG TAB ── -->
            <div class="tab-pane" id="tab-config">
                <div id="masterConfigPanel">

                    <div class="cfg-section">
                        <div class="cfg-section-title">⏱ Run Timing</div>
                        <div class="cfg-row">
                            <label>Min run delay</label>
                            <input type="number" id="cfg_minRun" value="${ms2min(MIN_RUN_DELAY)}" min="1">
                            <span class="cfg-unit">min</span>
                        </div>
                        <div class="cfg-row">
                            <label>Max run delay</label>
                            <input type="number" id="cfg_maxRun" value="${ms2min(MAX_RUN_DELAY)}" min="1">
                            <span class="cfg-unit">min</span>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">😴 Sleep Schedule</div>
                        <div class="cfg-row">
                            <label>Enable sleep</label>
                            <input type="checkbox" id="cfg_sleepEnabled" ${SLEEP_CONFIG.enabled ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Sleep start hour (0–23)</label>
                            <input type="number" id="cfg_sleepHour" value="${SLEEP_CONFIG.sleepHour}" min="0" max="23">
                            <span class="cfg-unit">hr</span>
                        </div>
                        <div class="cfg-row">
                            <label>Min sleep duration</label>
                            <input type="number" id="cfg_sleepMin" value="${ms2hr(SLEEP_CONFIG.sleepMinMs)}" min="0" step="0.5">
                            <span class="cfg-unit">hr</span>
                        </div>
                        <div class="cfg-row">
                            <label>Max sleep duration</label>
                            <input type="number" id="cfg_sleepMax" value="${ms2hr(SLEEP_CONFIG.sleepMaxMs)}" min="0" step="0.5">
                            <span class="cfg-unit">hr</span>
                        </div>
                        <div class="cfg-row">
                            <label>Wake jitter</label>
                            <input type="number" id="cfg_wakeJitter" value="${ms2min(SLEEP_CONFIG.wakeJitterMs)}" min="0">
                            <span class="cfg-unit">min</span>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">🎭 Culture Events</div>
                        <div class="cfg-row">
                            <label>Run Theater</label>
                            <input type="checkbox" id="cfg_runTheater" ${CULTURE_CONFIG.runTheater ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Run Party</label>
                            <input type="checkbox" id="cfg_runParty" ${CULTURE_CONFIG.runParty ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Run Triumph</label>
                            <input type="checkbox" id="cfg_runTriumph" ${CULTURE_CONFIG.runTriumph ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Run Games</label>
                            <input type="checkbox" id="cfg_runGames" ${CULTURE_CONFIG.runGames ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Keep BP reserve</label>
                            <input type="number" id="cfg_keepBP" value="${CULTURE_CONFIG.cultureKeepBP}" min="0" step="1000">
                            <span class="cfg-unit">bp</span>
                        </div>
                        <div class="cfg-row">
                            <label>Keep Gold reserve</label>
                            <input type="number" id="cfg_keepGold" value="${CULTURE_CONFIG.cultureKeepGold}" min="0" step="1000">
                            <span class="cfg-unit">gold</span>
                        </div>
                        <div class="cfg-row">
                            <label>Wait low min</label>
                            <input type="number" id="cfg_waitLowMin" value="${ms2min(CULTURE_CONFIG.waitLowMin)}" min="1">
                            <span class="cfg-unit">min</span>
                        </div>
                        <div class="cfg-row">
                            <label>Wait low max</label>
                            <input type="number" id="cfg_waitLowMax" value="${ms2min(CULTURE_CONFIG.waitLowMax)}" min="1">
                            <span class="cfg-unit">min</span>
                        </div>
                        <div class="cfg-row">
                            <label>Wait high min</label>
                            <input type="number" id="cfg_waitHighMin" value="${ms2min(CULTURE_CONFIG.waitHighMin)}" min="1">
                            <span class="cfg-unit">min</span>
                        </div>
                        <div class="cfg-row">
                            <label>Wait high max</label>
                            <input type="number" id="cfg_waitHighMax" value="${ms2min(CULTURE_CONFIG.waitHighMax)}" min="1">
                            <span class="cfg-unit">min</span>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">🌾 Farm</div>
                        <div class="cfg-row">
                            <label>Use farm collector</label>
                            <input type="checkbox" id="cfg_useFarm" ${FARM_CONFIG.useFarm ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Auto-open villages</label>
                            <input type="checkbox" id="cfg_autoOpenVillages" ${FARM_CONFIG.autoOpenVillages ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Upgrade villages</label>
                            <input type="checkbox" id="cfg_upgradeVillages" ${FARM_CONFIG.upgradeVillages ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Max village level</label>
                            <input type="number" id="cfg_villagesMaxLevel" value="${FARM_CONFIG.villagesMaxLevel}" min="1" max="6">
                            <span class="cfg-unit">lvl</span>
                        </div>
                    </div>

                    <div class="cfg-section">
                        <div class="cfg-section-title">⚔️ AutoTroop</div>
                        <div class="cfg-row">
                            <label>No-trade auto-disable after</label>
                            <input type="number" id="cfg_noTradeThr" value="${NO_TROOP_TRADE_DISABLE_THRESHOLD}" min="1">
                            <span class="cfg-unit">cycles</span>
                        </div>
                    </div>
                     <div class="cfg-section">
                        <div class="cfg-section-title">🗺️ Town Navigation</div>
                        <div class="cfg-row">
                            <label>Enable (z/x keys)</label>
                            <input type="checkbox" id="cfg_navEnabled" ${NAV_CONFIG.enabled ? 'checked' : ''}>
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Next town key</label>
                            <input type="text" id="cfg_navNext" value="${NAV_CONFIG.keyNext}" maxlength="1" style="width:36px;text-align:center;">
                            <span class="cfg-unit"></span>
                        </div>
                        <div class="cfg-row">
                            <label>Prev town key</label>
                            <input type="text" id="cfg_navPrev" value="${NAV_CONFIG.keyPrev}" maxlength="1" style="width:36px;text-align:center;">
                            <span class="cfg-unit"></span>
                        </div>
                        <!-- ── Discord Webhooks ── -->
<div class="cfg-section-title">Discord Webhooks</div>

<div class="cfg-row">
    <label class="cfg-label">Attack Webhook URL</label>
    <input type="text" id="cfg-attack-webhook"
           style="width:100%;padding:4px 6px;font-size:11px;
                  border:1px solid #8b5a2b;border-radius:4px;
                  background:#fff;color:#3a2a12;box-sizing:border-box;"
           value="${NOTIF_CONFIG.attackWebhook}"
           placeholder="https://discord.com/api/webhooks/...">
</div>
<div class="cfg-row" style="margin-top:6px;">
    <label class="cfg-label">Possible CS Webhook URL
        <span style="font-size:10px;color:#aaa;">(leave blank to reuse CS webhook)</span>
    </label>
    <input type="text" id="cfg-possible-cs-webhook"
           style="width:100%;padding:4px 6px;font-size:11px;
                  border:1px solid #8b5a2b;border-radius:4px;
                  background:#fff;color:#3a2a12;box-sizing:border-box;"
           placeholder="https://discord.com/api/webhooks/...">
</div>
<div class="cfg-row" style="margin-top:6px;">
    <label class="cfg-label">CS Webhook URL
        <span style="font-size:10px;color:#aaa;">
            (leave blank to reuse attack webhook)
        </span>
    </label>
    <input type="text" id="cfg-cs-webhook"
           style="width:100%;padding:4px 6px;font-size:11px;
                  border:1px solid #8b5a2b;border-radius:4px;
                  background:#fff;color:#3a2a12;box-sizing:border-box;"
           value="${NOTIF_CONFIG.csWebhook}"
           placeholder="https://discord.com/api/webhooks/...">
</div>
                    </div>
                    <button class="cfg-save-btn" id="cfg_saveBtn">💾 Save & Apply</button>
                    <div class="cfg-saved-msg" id="cfg_savedMsg"></div>

                </div>
            </div>
        </div>`;

        w.setContent2(html);

        setTimeout(() => {

            // ── Fix 2: always populate webhook fields from live NOTIF_CONFIG,
            //    regardless of when the template string was evaluated ──
            const atkInput = document.getElementById('cfg-attack-webhook');
            const csInput  = document.getElementById('cfg-cs-webhook');
            const possibleCsInput = document.getElementById('cfg-possible-cs-webhook');
            if (atkInput) atkInput.value = NOTIF_CONFIG.attackWebhook || '';
            if (csInput)  csInput.value  = NOTIF_CONFIG.csWebhook     || '';
            if (possibleCsInput) possibleCsInput.value = NOTIF_CONFIG.possibleCsWebhook || '';

            // ── Fix 3: auto-save webhooks when the user leaves the field,
            //    so they don't need to remember to click Save ──
            function autoSaveWebhook() {
                NOTIF_CONFIG.attackWebhook = (atkInput?.value || '').trim();
                NOTIF_CONFIG.csWebhook     = (csInput?.value  || '').trim();
                NOTIF_CONFIG.possibleCsWebhook     = (possibleCsInput?.value  || '').trim();
                GM_setValue('cfg_notif', JSON.stringify(NOTIF_CONFIG));
            }
            atkInput?.addEventListener('blur',  autoSaveWebhook);
            csInput ?.addEventListener('blur',  autoSaveWebhook);
            possibleCsInput ?.addEventListener('blur',  autoSaveWebhook);
            atkInput?.addEventListener('change', autoSaveWebhook);
            csInput ?.addEventListener('change', autoSaveWebhook);
            possibleCsInput?.addEventListener('change', autoSaveWebhook);
            // ── Tab switching — track which tab is active (change 5) ──
            let _activeTab = 'status';
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
                    _activeTab = btn.dataset.tab;   // ← lazy-render target
                });
            });

            // ── Status tab live update ──
            function updateStatusTab() {
                // Bot state
                const stateBox   = document.getElementById('status-state-box');
                const stateLabel = document.getElementById('status-state-label');
                if (stateBox && stateLabel) {
                    if (isSleeping) {
                        stateBox.className = 'status-state-box sleeping';
                        stateLabel.textContent = '😴 Bot is sleeping';
                    } else if (isUserActive()) {
                        stateBox.className = 'status-state-box paused';
                        stateLabel.textContent = '⏸ Paused — user activity detected';
                    } else {
                        stateBox.className = 'status-state-box active';
                        stateLabel.textContent = '✅ Bot is active';
                    }
                }
                // Next run
                const nextEl = document.getElementById('status-next-run');
                if (nextEl) {
                    if (isSleeping) {
                        nextEl.textContent = 'Sleeping…';
                    } else if (statusNextRunAt) {
                        const ms = statusNextRunAt - Date.now();
                        if (ms <= 0) {
                            nextEl.textContent = 'Running now…';
                        } else {
                            const m = Math.floor(ms / 60000);
                            const s = Math.floor((ms % 60000) / 1000);
                            nextEl.textContent = `${m}m ${s}s`;
                        }
                    } else {
                        nextEl.textContent = 'Starting…';
                    }
                }
                // Last task
                const lastEl = document.getElementById('status-last-task');
                if (lastEl) lastEl.textContent = statusLastTask || '—';

                // Feature counts
                try {
                    const buildSt    = loadBuildingTargets();
                    const researchSt = loadResearchStorage();
                    const hideSt     = loadHideStorage();
                    const troopSt    = loadTroopStorage();
                    const allIds     = Object.keys(uw.ITowns?.towns || {});

                    const buildCount    = allIds.filter(id => buildSt[id]?.autoBuild || buildSt[id]?.schematicsEnabled).length;
                    const researchCount = allIds.filter(id => researchSt[id]?.autoResearch || researchSt[id]?.schematicsEnabled).length;
                    const hideCount     = allIds.filter(id => hideSt[id]?.autoHide || hideSt[id]?.autoHideTrade).length;
                    const troopCount    = allIds.filter(id => troopSt[id]?.recruit === true).length;

                    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
                    el('status-build-count',    `${buildCount} / ${allIds.length}`);
                    el('status-research-count', `${researchCount} / ${allIds.length}`);
                    el('status-hide-count',     `${hideCount} / ${allIds.length}`);
                    el('status-troop-count',    `${troopCount} / ${allIds.length}`);
                } catch(e) {}

                // Activity log
                const logEl = document.getElementById('status-log');
                if (logEl) {
                    if (statusLog.length === 0) {
                        logEl.innerHTML = '<div class="status-log-entry" style="color:#aaa;font-style:italic;">No activity yet this session</div>';
                    } else {
                        logEl.innerHTML = statusLog.map(e => `<div class="status-log-entry">${e}</div>`).join('');
                    }
                }
            }

            // ── Towns tab ──
            function updateTownsTab() {
                const tbody = document.getElementById('towns-tbody');
                if (!tbody) return;
                try {
                    const towns      = uw.ITowns?.towns || {};
                    const buildSt    = loadBuildingTargets();
                    const researchSt = loadResearchStorage();
                    const hideSt     = loadHideStorage();
                    const troopSt    = loadTroopStorage();

                    const rows = Object.values(towns).sort((a, b) => {
    const nameA = a.getName ? a.getName() : (a.attributes?.name || '');
    const nameB = b.getName ? b.getName() : (b.attributes?.name || '');
    return nameA.localeCompare(nameB);
}).map(town => {
                        const id   = town.getId ? town.getId() : town.id;
                        const name = town.getName ? town.getName() : (town.attributes?.name || id);
                        const b = buildSt[id]?.autoBuild || buildSt[id]?.schematicsEnabled;
                        const r = researchSt[id]?.autoResearch || researchSt[id]?.schematicsEnabled;
                        const h = hideSt[id]?.autoHide || hideSt[id]?.autoHideTrade;
                        const t = troopSt[id]?.recruit === true;
                        const dot = (on) => `<span class="feature-dot ${on ? 'on' : ''}"></span>`;
                        return `<tr>
                            <td>${name}</td>
                            <td>${dot(b)}</td>
                            <td>${dot(r)}</td>
                            <td>${dot(h)}</td>
                            <td>${dot(t)}</td>
                        </tr>`;
                    });
                    tbody.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;color:#aaa;">No towns found</td></tr>';
                } catch(e) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#e44;">Error loading towns</td></tr>';
                }
            }

            updateStatusTab();
            updateTownsTab();

            // ── Stats tab ──
            function updateStatsTab() {
                const ls = loadLifetimeStats();

                // Counters
                const countersEl = document.getElementById('stats-counters');
                if (countersEl) {
                    const cards = [
                        { title: 'Buildings Upgraded', val: ls.builds,          sub: `+${SESSION_STATS.builds} this session` },
                        { title: 'Researches Done',    val: ls.researches,       sub: `+${SESSION_STATS.researches} this session` },
                        { title: 'Farm Runs',          val: ls.farmRuns,         sub: `+${SESSION_STATS.farmRuns} this session` },
                        { title: 'Villages Upgraded',  val: ls.villageUpgrades,  sub: `+${SESSION_STATS.villageUpgrades} this session` },
                    ];
                    countersEl.innerHTML = cards.map(c => `
                        <div class="stats-card">
                            <div class="stats-card-title">${c.title}</div>
                            <div class="stats-card-val">${c.val.toLocaleString()}</div>
                            <div class="stats-card-sub">${c.sub}</div>
                        </div>`).join('');
                }

                // 7-day chart
                const chartEl = document.getElementById('stats-chart');
                if (chartEl) {
                    const days = [];
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date(); d.setDate(d.getDate() - i);
                        days.push(d.toISOString().slice(0,10));
                    }
                    const maxVal = Math.max(1, ...days.map(d => (ls.daily[d]?.builds||0) + (ls.daily[d]?.researches||0)));
                    chartEl.innerHTML = days.map(d => {
                        const b = ls.daily[d]?.builds || 0;
                        const r = ls.daily[d]?.researches || 0;
                        const total = b + r;
                        const h = Math.max(2, Math.round((total / maxVal) * 56));
                        const label = d.slice(5); // MM-DD
                        return `<div class="stats-chart-col">
                            <div class="stats-chart-bar" style="height:${h}px;background:linear-gradient(to top,#6b8e23,#a8c84a)" title="Builds: ${b} | Research: ${r}"></div>
                            <span class="stats-chart-label">${label}</span>
                        </div>`;
                    }).join('');
                }

                // Troops
                const troopsEl = document.getElementById('stats-troops');
                if (troopsEl) {
                    const entries = Object.entries(ls.troops).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
                    if (!entries.length) {
                        troopsEl.innerHTML = '<div style="color:#aaa;font-style:italic;font-size:12px;padding:6px 0">No troops recruited yet</div>';
                    } else {
                        troopsEl.innerHTML = entries.map(([unit, count]) => `
                            <div class="stats-troop-row">
                                <div style="width:28px;height:28px;overflow:hidden;flex-shrink:0;"><div class="unit index_unit unit_icon25x25 ${unit}"></div></div>
                                <span style="flex:1;text-transform:capitalize">${unit.replace(/_/g,' ')}</span>
                                <span style="font-weight:bold;color:#3a2a12">${count.toLocaleString()}</span>
                                <span style="font-size:11px;color:#aaa">+${(SESSION_STATS.troops[unit]||0)} session</span>
                            </div>`).join('');
                    }
                }

                // Reset button
                const resetBtn = document.getElementById('stats-reset-btn');
                if (resetBtn && !resetBtn._wired) {
                    resetBtn._wired = true;
                    resetBtn.addEventListener('click', () => {
                        if (confirm('Reset ALL lifetime statistics? This cannot be undone.')) {
                            saveLifetimeStats({ builds:0, researches:0, farmRuns:0, villageUpgrades:0, troops:{}, daily:{} });
                            updateStatsTab();
                        }
                    });
                }
            }

            // ── Alerts tab ──
            function updateAlertsTab() {
                // Wire checkboxes/inputs to current config (once)
                const setChk = (id, val) => { const e = document.getElementById(id); if (e) e.checked = val; };
                const setNum = (id, val) => { const e = document.getElementById(id); if (e) e.value  = val; };
                setChk('alrt_troopBelow',    ALERT_CONFIG.troopBelowTarget.enabled);
                setChk('alrt_tradeDisabled', ALERT_CONFIG.troopTradeDisabled.enabled);
                setChk('alrt_botStuck',      ALERT_CONFIG.botStuck.enabled);
                setNum('alrt_botStuckMin',   ALERT_CONFIG.botStuck.minutes);
                setChk('alrt_captcha',       ALERT_CONFIG.captchaDetected.enabled);

                const saveBtn = document.getElementById('alrt_saveBtn');
                if (saveBtn && !saveBtn._wired) {
                    saveBtn._wired = true;
                    saveBtn.addEventListener('click', () => {
                        const chk = (id) => document.getElementById(id)?.checked;
                        const num = (id) => parseFloat(document.getElementById(id)?.value) || 0;
                        ALERT_CONFIG.troopBelowTarget.enabled   = chk('alrt_troopBelow');
                        ALERT_CONFIG.troopTradeDisabled.enabled = chk('alrt_tradeDisabled');
                        ALERT_CONFIG.botStuck.enabled           = chk('alrt_botStuck');
                        ALERT_CONFIG.botStuck.minutes           = num('alrt_botStuckMin');
                        ALERT_CONFIG.captchaDetected.enabled    = chk('alrt_captcha');
                        saveAlertConfig();
                        const btn = document.getElementById('alrt_saveBtn');
                        if (btn) { btn.textContent = '✓ Saved!'; setTimeout(() => { btn.textContent = '💾 Save Alert Settings'; }, 2000); }
                    });
                }

                const clearBtn = document.getElementById('alrt_clearLog');
                if (clearBtn && !clearBtn._wired) {
                    clearBtn._wired = true;
                    clearBtn.addEventListener('click', () => {
                        alertLog.length = 0;
                        alertedTowns.clear();
                        saveAlertedTowns();
                        updateAlertsTab();
                    });
                }

                // Log
                const logEl = document.getElementById('alert-log-list');
                if (logEl) {
                    if (!alertLog.length) {
                        logEl.innerHTML = '<div style="color:#aaa;font-style:italic;font-size:12px;padding:6px 0">No alerts triggered yet</div>';
                    } else {
                        logEl.innerHTML = alertLog.map(e => `
                            <div class="alert-log-entry ${e.level}">
                                <span class="alert-log-time">${e.time}</span>${e.msg}
                            </div>`).join('');
                    }
                }
                // ── Discord notification toggles ──
const notifAtkChk = document.getElementById('notif_attack_toggle');
const notifCsChk  = document.getElementById('notif_cs_toggle');
if (notifAtkChk) {
    notifAtkChk.checked = NOTIF_CONFIG.attackEnabled;
    if (!notifAtkChk._wired) {
        notifAtkChk._wired = true;
        notifAtkChk.addEventListener('change', () => {
            NOTIF_CONFIG.attackEnabled = notifAtkChk.checked;
            saveNotifConfig();
        });
    }
}
if (notifCsChk) {
    notifCsChk.checked = NOTIF_CONFIG.csEnabled;
    if (!notifCsChk._wired) {
        notifCsChk._wired = true;
        notifCsChk.addEventListener('change', () => {
            NOTIF_CONFIG.csEnabled = notifCsChk.checked;
            saveNotifConfig();
        });
    }
}
                const notifPossibleCsChk = document.getElementById('notif_possible_cs_toggle');
if (notifPossibleCsChk) {
    notifPossibleCsChk.checked = NOTIF_CONFIG.possibleCsEnabled;
    notifPossibleCsChk.addEventListener('change', () => {
        NOTIF_CONFIG.possibleCsEnabled = notifPossibleCsChk.checked;
        saveNotifConfig();
    });
}
            }

            updateStatsTab();
            updateAlertsTab();

             // ── Info tab ──────────────────────────────────────────────────
            function initInfoTab() {
                const world  = String(uw.Game.world_id);
                const api    = GM_getValue('allianceApiUrl', 'https://test-1i20.onrender.com');
                let   playersCache = [];          // all players for this world
                let   townsCache   = {};          // playerId → towns[]

                const selPlayer  = document.getElementById('info-player-sel');
                const selTown    = document.getElementById('info-town-sel');
                const btnRefresh = document.getElementById('info-refresh-btn');
                const display    = document.getElementById('info-display');

                if (!selPlayer || !selTown || !display) return; // panel not open

                function setDisplay(html) { display.innerHTML = html; }

                function labelOf(key) {
                    return String(key).replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
                }

                // ── Render one town ──────────────────────────────────────
                function renderTown(town) {
                    const buildings  = town.buildings  || {};
                    const researched = town.researched || [];
                    const troops     = town.troops     || {};

                    const bList = Object.entries(buildings)
                        .filter(([,v]) => Number(v) > 0)
                        .sort(([,a],[,b]) => b - a);

                    const tList = Object.entries(troops)
                        .filter(([,v]) => Number(v) > 0)
                        .sort(([,a],[,b]) => b - a);

                    const grid = (items, color, badge) => items.map(([k, v]) => `
                        <div style="background:#111827;border:1px solid #2a3a5a;border-radius:4px;
                            padding:4px 8px;display:flex;justify-content:space-between;align-items:center;gap:6px;">
                            <span style="color:#c9d8f0;">${labelOf(k)}</span>
                            <span style="background:${badge};color:${color};font-weight:bold;
                                border-radius:3px;padding:1px 7px;font-size:11px;min-width:28px;text-align:center;">
                                ${Number(v).toLocaleString()}
                            </span>
                        </div>`).join('');

                    const chips = [...researched].sort().map(t =>
                        `<span style="background:#1a3a1a;border:1px solid #2a6a2a;color:#88dd88;
                            border-radius:12px;padding:2px 10px;font-size:11px;">${labelOf(t)}</span>`
                    ).join('');

                    setDisplay(`
                        <div style="font-weight:bold;font-size:13px;color:#ffcc44;margin-bottom:10px;">
                            🏛️ ${town.name}
                            <span style="color:#888;font-size:11px;font-weight:normal;">(${town.x}:${town.y})</span>
                        </div>

                        <div style="color:#aabbdd;font-weight:bold;border-bottom:1px solid #2a3a5a;
                            padding-bottom:3px;margin-bottom:7px;">🏗️ Buildings (${bList.length})</div>
                        ${bList.length
                            ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:4px;margin-bottom:12px;">${grid(bList,'#ffcc44','#2a4a7f')}</div>`
                            : `<div style="color:#555;margin-bottom:12px;">No building data.</div>`}

                        <div style="color:#aabbdd;font-weight:bold;border-bottom:1px solid #2a3a5a;
                            padding-bottom:3px;margin-bottom:7px;">🔬 Researches (${researched.length})</div>
                        ${researched.length
                            ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;">${chips}</div>`
                            : `<div style="color:#555;margin-bottom:12px;">No research data.</div>`}

                        <div style="color:#aabbdd;font-weight:bold;border-bottom:1px solid #2a3a5a;
                            padding-bottom:3px;margin-bottom:7px;">⚔️ Troops (${tList.length} types)</div>
                        ${tList.length
                            ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:4px;">${grid(tList,'#ffaa33','#3a2a0a')}</div>`
                            : `<div style="color:#555;">No troops in this town.</div>`}
                    `);
                }

                // ── Populate town dropdown ───────────────────────────────
                function populateTowns(playerId) {
                    const towns = townsCache[playerId] || [];
                    selTown.innerHTML = towns.length
                        ? `<option value="">— Select town (${towns.length}) —</option>`
                        : `<option value="">— No town data for this player —</option>`;
                    towns.forEach(t => {
                        const o = document.createElement('option');
                        o.value       = t.id;
                        o.textContent = t.name;
                        selTown.appendChild(o);
                    });
                    selTown.disabled  = (towns.length === 0);
                    selTown.style.opacity = towns.length ? '1' : '0.5';
                }

                // ── Load all players for the world ───────────────────────
                async function loadPlayers() {
                    selPlayer.innerHTML = '<option value="">⏳ Loading…</option>';
                    selPlayer.disabled  = true;
                    selTown.innerHTML   = '<option value="">— Select player first —</option>';
                    selTown.disabled    = true;
                    selTown.style.opacity = '0.5';
                    setDisplay('<div style="text-align:center;color:#888;padding-top:60px;">⏳ Loading players…</div>');
                    try {
                        const r = await fetch(`${api}/players/${world}`);
                        const j = await r.json();
                        if (!j.ok) throw new Error(j.error);
                        playersCache = j.players || [];
                        selPlayer.innerHTML = playersCache.length
                            ? `<option value="">— Select player (${playersCache.length}) —</option>`
                            : `<option value="">— No data yet —</option>`;
                        playersCache.forEach(p => {
                            const o = document.createElement('option');
                            o.value       = p.id;
                            o.textContent = `${p.name}${p.alliance ? '  ['+p.alliance+']' : ''}  (${p.town_count} towns)`;
                            selPlayer.appendChild(o);
                        });
                        selPlayer.disabled = false;
                        setDisplay('<div style="text-align:center;color:#555;padding-top:60px;">Select a player, then a town.</div>');
                    } catch(e) {
                        selPlayer.innerHTML = '<option value="">❌ Error loading</option>';
                        selPlayer.disabled  = false;
                        setDisplay(`<div style="text-align:center;color:#cc4444;padding-top:60px;">❌ Could not reach API: ${e.message}</div>`);
                        console.error('[InfoTab] loadPlayers error:', e);
                    }
                }

                // ── Load towns for a player ──────────────────────────────
                async function loadTowns(playerId) {
                    if (townsCache[playerId]) { populateTowns(playerId); return; }
                    selTown.innerHTML   = '<option value="">⏳ Loading towns…</option>';
                    selTown.disabled    = true;
                    selTown.style.opacity = '0.5';
                    setDisplay('<div style="text-align:center;color:#888;padding-top:60px;">⏳ Loading town data…</div>');
                    try {
                        const r = await fetch(`${api}/players/${world}/${playerId}/towns`);
                        const j = await r.json();
                        if (!j.ok) throw new Error(j.error);
                        townsCache[playerId] = j.towns || [];
                        populateTowns(playerId);
                        setDisplay('<div style="text-align:center;color:#555;padding-top:60px;">Select a town above.</div>');
                    } catch(e) {
                        selTown.innerHTML   = '<option value="">❌ Error</option>';
                        selTown.style.opacity = '0.5';
                        setDisplay(`<div style="text-align:center;color:#cc4444;padding-top:60px;">❌ Could not load towns: ${e.message}</div>`);
                        console.error('[InfoTab] loadTowns error:', e);
                    }
                }

                // ── Events ───────────────────────────────────────────────
                selPlayer.addEventListener('change', function() {
                    const pid = this.value;
                    selTown.innerHTML = '<option value="">— Select town —</option>';
                    selTown.disabled  = true;
                    selTown.style.opacity = '0.5';
                    if (!pid) {
                        setDisplay('<div style="text-align:center;color:#555;padding-top:60px;">Select a player and town above.</div>');
                        return;
                    }
                    loadTowns(pid);
                });
                selTown.addEventListener('change', function() {
                    const pid  = selPlayer.value;
                    const tid  = this.value;
                    if (!pid || !tid) return;
                    const town = (townsCache[pid] || []).find(t => t.id === tid);
                    if (town) renderTown(town);
                });

                btnRefresh.addEventListener('click', () => {
                    townsCache = {};
                    loadPlayers();
                });

                // ── Kick off ─────────────────────────────────────────────
                loadPlayers();
            }
            // ── Alliance tab ──────────────────────────────────────────
            // alPushData and UNIT_LIST are defined at outer scope

            async function alFetchAndRender() {
                const world = String(uw.Game.world_id);
                const bar   = document.getElementById('alliance-status-bar');
                try {
                    const r = await fetch(`${ALLIANCE_API}/players/${world}`);
                    const j = await r.json();

                    if (bar) {
                        bar.className   = 'alliance-status-bar connected';
                        bar.textContent = `⚔️ World ${world} — ${j.players.length} player(s) online`;
                    }

                    const wrap = document.getElementById('alliance-table-wrap');
                    if (!wrap) return;

                    if (!j.players.length) {
                        wrap.innerHTML = '<div style="color:#aaa;font-style:italic;font-size:12px;padding:8px">No data yet — push your data first!</div>';
                        return;
                    }

                    // Show all units always
                    const usedUnits = UNIT_LIST;

                        let html = `<table class="alliance-table"><thead><tr>
                        <th title="Status">●</th>
                        <th>Player</th>
                        <th title="Alliance">🤝</th>
                        <th title="Cultural Level">CL</th>
                        <th title="Towns">🏛</th>
                        <th title="CP Progress">CP</th>`;
                    usedUnits.forEach(u => {
                        html += `<th title="${u}"><div style="width:28px;height:28px;overflow:hidden;margin:0 auto;"><div style="width:30px;height:26.5px;overflow:hidden;margin:0 auto;">
    <div class="unit index_unit unit_icon25x25 ${u}" style="margin-left:0px;margin-top:0px;"></div>
</div></div></th>`;
                    });
                    html += `<th>Updated</th></tr></thead><tbody>`;

                    j.players.forEach(p => {
                        let troops = {};
                        try { troops = JSON.parse(p.troops); } catch(e) {}
                        const cl = p.cultural_level;
                        const cpForCurrentLevel = Math.round(1.5 * (cl*cl - 3*cl + 2));
                        const cpPct = p.next_level_cp > 0
                            ? Math.round(((p.current_cp - cpForCurrentLevel) / (p.next_level_cp - cpForCurrentLevel)) * 100)
                            : '?';
                        const ageMin = Math.floor((Date.now() / 1000 - p.pushed_at) / 60);
                        const ageStr = ageMin < 60 ? `${ageMin}m ago` : ageMin < 1440 ? `${Math.floor(ageMin/60)}h ago` : `${Math.floor(ageMin/1440)}d ago`;
const statusCircle = (p.status ?? 3) === 1
    ? `<span style="color:#27ae60;font-size:14px;">●</span>`
    : (p.status ?? 3) === 2
    ? `<span style="color:#f39c12;font-size:14px;">●</span>`
    : `<span style="color:#c0392b;font-size:14px;">●</span>`;
html += `<tr>
    <td style="text-align:center">${statusCircle}</td>
    <td>${p.name}</td>
                            <td style="font-size:10px;color:#888">${p.alliance || '—'}</td>
                            <td>${p.cultural_level}</td>
                            <td>${p.town_count}</td>
                            <td>${cpPct}%</td>`;
                        usedUnits.forEach(u => {
                            const n = troops[u] || 0;
                            html += `<td style="${n > 0 ? 'color:#3a2a12;font-weight:bold' : 'color:#ccc'}">${n > 0 ? n.toLocaleString() : '—'}</td>`;
                        });
                        html += `<td class="alliance-updated">${ageStr}</td></tr>`;
                    });
                    html += '</tbody></table>';
                    wrap.innerHTML = html;

                    const fetchEl = document.getElementById('al_lastFetch');
                    if (fetchEl) fetchEl.textContent = `Last fetched: ${new Date().toLocaleTimeString()}`;

                } catch(e) {
                    if (bar) {
                        bar.className   = 'alliance-status-bar disconnected';
                        bar.textContent = '⚔️ Could not reach server';
                    }
                    console.error('[Alliance] Fetch error:', e);
                }
            }

            function initAllianceTab() {
                // Only fetch on open, no push
                alFetchAndRender();

                const pushBtn = document.getElementById('al_pushBtn');
                if (pushBtn && !pushBtn._wired) {
                    pushBtn._wired = true;
                    pushBtn.addEventListener('click', async () => {
                        pushBtn.textContent = '⏳ Pushing...';
                        pushBtn.disabled = true;
                        await alPushData();
                        await alFetchAndRender();
                        pushBtn.textContent = '📤 Push My Data';
                        pushBtn.disabled = false;
                    });
                }

                const fetchBtn = document.getElementById('al_fetchBtn');
                if (fetchBtn && !fetchBtn._wired) {
                    fetchBtn._wired = true;
                    fetchBtn.addEventListener('click', async () => {
                        fetchBtn.textContent = '⏳...';
                        fetchBtn.disabled = true;
                        await alFetchAndRender();
                        fetchBtn.textContent = '🔄 Refresh';
                        fetchBtn.disabled = false;
                    });
                }
            }

initAllianceTab();
document.querySelector('[data-tab="requests"]')?.addEventListener('click', initRequestsTab);

            // ── UI toggle tab ─────────────────────────────────────────
            ['showBuild','showResearch','showHide','showTroop','showTroopCounter','showSimCounter'].forEach(key => {
                const el = document.getElementById(`ui_${key}`);
                if (!el) return;
                el.checked = UI_CONFIG[key];
                el.addEventListener('change', () => {
                    UI_CONFIG[key] = el.checked;
                    saveUIConfig();
                    // If turning off, remove any open panel immediately
                    if (!el.checked) {
                        if (key === 'showBuild')    document.querySelector('.custom-senate-build-panel')?.remove();
                        if (key === 'showResearch') {
                            document.querySelector('.custom-academy-panel')?.remove();
                            document.querySelectorAll('.obs-arrow-small').forEach(el => el.remove());
                        }
                        if (key === 'showHide')     document.querySelector('.custom-hide-panel')?.remove();
                        if (key === 'showTroop')    document.querySelector('.custom-troop-dropdown')?.remove();
                        if (key === 'showTroopCounter') {
          document.querySelector('.big-box-Barracks-container')?.remove();
         document.querySelector('.big-box-Docks-container')?.remove();
         document.querySelector('.small-box-Barracks')?.remove();
        document.querySelector('.small-box-Docks')?.remove();
     }
                        if (key === 'showSimCounter') document.getElementById('survives_counter')?.remove();
                    }
                    const saved = document.getElementById('ui_saved');
                    if (saved) { saved.textContent = '✓ Saved'; setTimeout(() => { saved.textContent = ''; }, 1500); }
                });
            });

          (function initFiveMin() {
    // Kill any rAF loop left over from a previous window open
    if (_fmRafId !== null) { cancelAnimationFrame(_fmRafId); _fmRafId = null; }

    const STORAGE_KEY = 'fm_scheduler_v3';

    const FM_DBG = (...a) => console.log('%c[5λεπτα]',   'color:#f39c12;font-weight:bold', ...a);
    const FM_ERR = (...a) => console.error('%c[5λεπτα ERR]', 'color:#e74c3c;font-weight:bold', ...a);
    const FM_OK  = (...a) => console.log('%c[5λεπτα OK]',  'color:#2ecc71;font-weight:bold', ...a);

    // ── Job list — each job: { id, myTownId, enemyTownId, unit, commandId, nextFireAt, _timeout } ──
    let jobs = [];

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // ── Persistence ──────────────────────────────────────────────────
    function saveJobs() {
        const saveable = jobs.map(j => ({
            id:          j.id,
            myTownId:    j.myTownId,
            enemyTownId: j.enemyTownId,
            unit:        j.unit,
            commandId:   j.commandId,
            nextFireAt:  j.nextFireAt
            // _timeout is NOT saved — re-created on restore
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saveable));
        FM_DBG(`saveJobs | saved ${saveable.length} jobs`);
    }

    function loadPersistedJobs() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch(e) { return []; }
    }

    // ── Calculate how many units to send (3% of total pop) ───────────
    function calcAmount(myTownId, unit) {
        const troops = fmGetTownTroopsFull(myTownId);
        if (!troops || !troops[unit]) return 0;
        const totalPop = fmGetTotalPop(myTownId);
        const upop = uw.GameData?.units?.[unit]?.population || 1;
        return Math.max(1, Math.ceil(Math.ceil(totalPop * 0.03) / upop));
    }

    // ── Schedule a job's next fire ────────────────────────────────────
   function startTickLoop() {
    if (_fmTickInterval) return;
    _fmTickInterval = setInterval(() => {
        jobs.forEach(job => {
            if (!job._firing && job.nextFireAt && Date.now() >= job.nextFireAt) {
                job._firing = true;
                fireJob(job.id);
            }
        });
    }, 1000);
    FM_DBG('startTickLoop | started');
}

function stopTickLoop() {
    if (_fmTickInterval) { clearInterval(_fmTickInterval); _fmTickInterval = null; }
}
    // ── Core cycle: send attack → parse commandId → cancel old → reschedule ──
    async function fireJob(jobId) {
        const job = jobs.find(j => j.id === jobId);
        if (!job) { FM_ERR(`fireJob | job ${jobId} not found — already removed`); return; }

        FM_DBG(`fireJob | START id=${jobId} ${job.myTownId}→${job.enemyTownId} unit=${job.unit}`);

        const oldCommandId = job.commandId;
        const amount = calcAmount(job.myTownId, job.unit);

        if (!amount) {
            FM_ERR(`fireJob | calcAmount=0 for unit=${job.unit} in town=${job.myTownId} — stopping job`);
            fmStatus(`Not enough troops for ${job.unit} — attack stopped`, '#c0392b');
            await stopJob(jobId);
            return;
        }

      // ── 1. Send the new attack, get commandId directly ────────────
        let newCommandId;
        try {
            newCommandId = await fmSendAttack(job.enemyTownId, job.unit, amount, job.myTownId);
            FM_OK(`fireJob | attack sent. oldCommandId=${oldCommandId} newCommandId=${newCommandId}`);
        } catch(e) {
            FM_ERR(`fireJob | fmSendAttack failed:`, e);
            fmStatus(`Attack failed: ${e.message} — retrying in 30s`, '#c0392b');
            job.nextFireAt = Date.now() + 30000;
            job._firing    = false;
            saveJobs();
            return;
        }

        // ── 3. Update job: store new commandId + schedule next fire ───
        const interval = (180 + Math.random() * 90) * 1000;   // 3–4.5 min
        job.commandId  = newCommandId;
        job.nextFireAt = Date.now() + interval;
        job._firing    = false;   // ready for next tick
        saveJobs();
        FM_OK(`fireJob | done. nextFire in ${Math.round(interval / 1000)}s. newCommandId=${newCommandId}`);

        // ── 4. Cancel old attack AFTER new one is live ─────────────────
        if (oldCommandId) {
            try {
                await fmCancelCommand(oldCommandId, job.myTownId);
                FM_OK(`fireJob | cancelled old commandId=${oldCommandId}`);
            } catch(e) {
                FM_ERR(`fireJob | cancel failed for commandId=${oldCommandId}:`, e);
            }
        }

        // ── 5. Refresh UI so timer shows new countdown immediately ─────
        fmRender();
    }

    // ── Start a brand-new job ─────────────────────────────────────────
    async function startJob(myTownId, enemyTownId, unit) {
        if (jobs.some(j => j.myTownId === myTownId && j.enemyTownId === enemyTownId)) {
            fmStatus('Already running for this pair', '#c8860a');
            return;
        }
        const job = {
            id:          genId(),
            myTownId,
            enemyTownId,
            unit,
            commandId:   null,
            nextFireAt:  Date.now(),   // fire immediately
            _timeout:    null
        };
        jobs.push(job);
        saveJobs();
        startTickLoop();
        fmRender();
        fmStatus(`▶ Starting attack ${myTownId} → ${enemyTownId}…`, '#27ae60');

        await fireJob(job.id);
        fmRender();   // refresh UI to show live timer
    }

    // ── Stop a job: cancel timeout + cancel active attack ─────────────
    async function stopJob(jobId) {
        const idx = jobs.findIndex(j => j.id === jobId);
        if (idx === -1) return;

        const job = jobs[idx];
        FM_DBG(`stopJob | id=${jobId} commandId=${job.commandId}`);

        job._firing = true;   // prevent tick from re-firing while we cancel

        if (job.commandId) {
            try {
                await fmCancelCommand(job.commandId, job.myTownId);
                FM_OK(`stopJob | cancelled commandId=${job.commandId}`);
            } catch(e) {
                FM_ERR(`stopJob | cancel failed:`, e);
            }
        }

        jobs.splice(idx, 1);
        saveJobs();

        if (jobs.length === 0) stopTimerLoop();
        fmRender();
    }

    // ── Stop all jobs ─────────────────────────────────────────────────
    async function stopAllJobs() {
        const snapshot = [...jobs];
        for (const j of snapshot) await stopJob(j.id);
    }

    // ── rAF countdown timer ───────────────────────────────────────────
    function startTimerLoop() {
        if (_fmRafId !== null) return;   // already running
        let lastTick = 0;
        function loop(ts) {
            if (_fmRafId === null) return;   // cancelled → loop dies
            if (ts - lastTick > 1000) {
                lastTick = ts;
                jobs.forEach(job => {
                    const el = document.getElementById(`fm-timer-${job.id}`);
                    if (!el || !job.nextFireAt) return;
                    const left = job.nextFireAt - Date.now();
                    if (left <= 0) { el.textContent = 'Sending...'; return; }
                    const m = Math.floor(left / 60000);
                    const s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
                    el.textContent = `${m}:${s}`;
                });
            }
            _fmRafId = requestAnimationFrame(loop);
        }
        _fmRafId = requestAnimationFrame(loop);
        FM_DBG('startTimerLoop | rAF loop started');
    }

    function stopTimerLoop() {
        if (_fmRafId !== null) {
            cancelAnimationFrame(_fmRafId);
            _fmRafId = null;
            FM_DBG('stopTimerLoop | rAF loop stopped');
        }
    }

    // ── Render the active jobs list ───────────────────────────────────
    function renderJobList(wrap) {
        wrap.innerHTML = '';
        if (!jobs.length) {
            wrap.innerHTML = '<div style="color:#888;font-style:italic;font-size:11px;padding:4px 0">No active attacks</div>';
            return;
        }
        jobs.forEach(job => {
            const row = document.createElement('div');
            row.className = 'fivemin-attack-row';
            row.innerHTML = `
                <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">
                    <div style="width:25px;height:25px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:4px">
                        <div class="unit index_unit unit_icon25x25 ${job.unit}"></div>
                    </div>
                    ${job.myTownId} → ${job.enemyTownId}
                </div>
                <span id="fm-timer-${job.id}" class="fivemin-timer">--:--</span>`;
            const x = document.createElement('button');
            x.textContent = '×';
            x.className = 'fivemin-btn red';
            x.style.cssText = 'padding:2px 7px;font-size:12px;margin-left:6px';
            x.onclick = () => stopJob(job.id);
            row.appendChild(x);
            wrap.appendChild(row);
        });
    }

    // ── UI state ──────────────────────────────────────────────────────
    let curMy = null, curEnemy = null, curUnit = null;
    let curTroops = null, curTotalPop = 0;

    function fmStatus(txt, color = '#4a2b0f') {
        const el = document.getElementById('fm-status');
        if (el) { el.textContent = txt; el.style.color = color; }
    }

    // ── Main render ───────────────────────────────────────────────────
    function fmRender() {
        const screen = document.getElementById('fm-screen');
        if (!screen) return;

        if (!curMy || !curEnemy) {
            // ── Setup screen ──
            screen.innerHTML = `
                <div class="fivemin-section-title">Source Town</div>
                <input id="fm-src" class="fivemin-input" type="text" placeholder="Your town ID">
                <div class="fivemin-section-title">Target Town</div>
                <input id="fm-tgt" class="fivemin-input" type="text" placeholder="Enemy town ID">
                <button id="fm-load" class="fivemin-btn blue" style="width:100%;margin-top:4px">Load Troops →</button>
                <div class="fivemin-section-title" style="margin-top:12px">Active Attacks</div>
                <div id="fm-active-list"></div>`;
            renderJobList(document.getElementById('fm-active-list'));
            document.getElementById('fm-load').onclick = () => {
                const src = document.getElementById('fm-src').value.trim();
                const tgt = document.getElementById('fm-tgt').value.trim();
                if (!src || !uw.ITowns?.towns?.[src]) return fmStatus('Invalid source town ID', '#c0392b');
                if (!tgt) return fmStatus('Enter target town ID', '#c0392b');
                curMy = src; curEnemy = tgt;
                curTroops   = fmGetTownTroopsFull(src);
                curTotalPop = fmGetTotalPop(src);
                curUnit     = null;
                fmRender();
            };
        } else {
            // ── Unit selection + control screen ──
            const minPop = Math.ceil(curTotalPop * 0.03);
            screen.innerHTML = `
                <div style="font-size:11px;color:#7a4a1a;margin-bottom:4px">
                    <b>${curMy}</b> → <b>${curEnemy}</b> &nbsp;|&nbsp; Pop: ${curTotalPop} &nbsp;|&nbsp; Min wave ≈ ${minPop}
                </div>
                <div class="fivemin-section-title">Choose Unit</div>
                <div id="fm-unit-list"></div>
                <div style="display:flex;gap:6px;margin-top:10px">
                    <button id="fm-start"   class="fivemin-btn green"  style="flex:2">▶ START</button>
                    <button id="fm-stopall" class="fivemin-btn red"    style="flex:1">■ Stop All</button>
                    <button id="fm-newpair" class="fivemin-btn purple" style="flex:1">+ New</button>
                </div>
                <div class="fivemin-section-title" style="margin-top:12px">Active Attacks</div>
                <div id="fm-active-list"></div>`;

            const ul = document.getElementById('fm-unit-list');
            Object.keys(curTroops || {}).forEach(u => {
                const cnt = curTroops[u];
                if (cnt <= 0) return;
                const btn = document.createElement('button');
                btn.className = 'fivemin-unit-btn' + (curUnit === u ? ' selected' : '');
                btn.innerHTML = `<div style="display:inline-block;width:25px;height:25px;overflow:hidden;vertical-align:middle;margin-right:6px"><div class="unit index_unit unit_icon25x25 ${u}"></div></div>${u}: <b>${cnt}</b>`;
                btn.onclick = () => { curUnit = u; fmStatus(`Selected: ${u}`, '#27ae60'); fmRender(); };
                ul.appendChild(btn);
            });

            renderJobList(document.getElementById('fm-active-list'));

            document.getElementById('fm-start').onclick   = () => {
                if (!curUnit) return fmStatus('Select a unit first', '#c0392b');
                startJob(curMy, curEnemy, curUnit);
            };
            document.getElementById('fm-stopall').onclick = () => stopAllJobs();
            document.getElementById('fm-newpair').onclick = () => {
                curMy = curEnemy = curUnit = curTroops = null;
                curTotalPop = 0;
                fmRender();
            };
        }

        if (jobs.length > 0) startTimerLoop();
        else stopTimerLoop();
    }

    // ── Bootstrap: restore saved jobs from localStorage ───────────────
    const savedJobs = loadPersistedJobs();
    FM_DBG(`BOOTSTRAP | restoring ${savedJobs.length} job(s) from storage`);

    savedJobs.forEach(saved => {
        const job = { ...saved, _firing: false };
        jobs.push(job);
        FM_DBG(`BOOTSTRAP | job ${job.id} restored, fires in ${Math.round((job.nextFireAt - Date.now()) / 1000)}s`);
    });

    if (jobs.length > 0) { startTimerLoop(); startTickLoop(); }

      if (jobs.length === 0) { stopTimerLoop(); stopTickLoop(); }

    // Initial render
    fmRender();

    // Refresh troop counts when the tab is clicked
    const fmTabBtn = document.querySelector('[data-tab="fivemins"]');
    if (fmTabBtn && !fmTabBtn._fmWired) {
        fmTabBtn._fmWired = true;
        fmTabBtn.addEventListener('click', () => {
            if (curMy && uw.ITowns?.towns?.[curMy]) {
                curTroops   = fmGetTownTroopsFull(curMy);
                curTotalPop = fmGetTotalPop(curMy);
            }
            fmRender();
        });
    }
})();
    // ─────────────────────────────────────────────
//  ΠΡΟΣΤΑΣΙΑ — Priority 0 Athena Protection
// ─────────────────────────────────────────────

const PROTECTION_STORAGE_KEY = 'master_protection_schedules_v1';

let protectionSchedules = [];

function loadProtectionSchedules() {
    try {
        const saved = localStorage.getItem(PROTECTION_STORAGE_KEY);
        if (saved) {
            protectionSchedules = JSON.parse(saved).map(s => ({
                ...s,
                status: 'Scheduled',
                lastChecked: 0
            }));
            renderProtectionList();
        }
    } catch(e) {}
}

function saveProtectionSchedules() {
    const saveable = protectionSchedules.map(s => ({
        cityId: s.cityId,
        targetHour: s.targetHour,
        targetMinute: s.targetMinute,
        targetSecond: s.targetSecond
    }));
    localStorage.setItem(PROTECTION_STORAGE_KEY, JSON.stringify(saveable));
}

function addProtectionSchedule(cityId, h, m, s) {
    if (protectionSchedules.some(sc => sc.cityId === cityId && sc.targetHour === h && sc.targetMinute === m && sc.targetSecond === s)) {
        showToast('warn', 'This exact schedule already exists');
        return;
    }
    protectionSchedules.push({
        cityId: parseInt(cityId),
        targetHour: parseInt(h),
        targetMinute: parseInt(m),
        targetSecond: parseInt(s),
        status: 'Scheduled',
        lastChecked: 0
    });
    saveProtectionSchedules();
    renderProtectionList();
    showToast('success', `Added protection for city ${cityId} at ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
}

function removeProtectionSchedule(index) {
    if (index < 0 || index >= protectionSchedules.length) return;
    protectionSchedules.splice(index, 1);
    saveProtectionSchedules();
    renderProtectionList();
}

function renderProtectionList() {
    const list = document.getElementById('prot-list');
    if (!list) return;
    list.innerHTML = '';

    if (protectionSchedules.length === 0) {
        list.innerHTML = '<div style="color:#888; font-style:italic; padding:8px;">No scheduled protections yet</div>';
        return;
    }

    protectionSchedules.forEach((sch, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:8px; background:#f5f5dc; border:1px solid #c9a875; border-radius:4px; padding:6px 10px; font-size:13px;';

        const text = document.createElement('span');
        text.style.flex = '1';
        text.innerHTML = `City <b>${sch.cityId}</b> @ <b>${sch.targetHour.toString().padStart(2,'0')}:${sch.targetMinute.toString().padStart(2,'0')}:${sch.targetSecond.toString().padStart(2,'0')}</b> — <span style="color:#6b8e23;">${sch.status}</span>`;

        const btn = document.createElement('button');
        btn.textContent = '×';
        btn.style.cssText = 'background:#c62828; color:white; border:none; border-radius:4px; padding:2px 8px; cursor:pointer; font-size:12px;';
        btn.onclick = () => removeProtectionSchedule(i);

        row.appendChild(text);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

// Priority 0 checker — runs very frequently
function protectionPriorityLoop() {
    if (!protectionSchedules.length) return;

    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    protectionSchedules.forEach(async (sch) => {
        if (sch.status !== 'Scheduled') return;

        // Check in a ~4 second window
        if (h === sch.targetHour && m === sch.targetMinute && Math.abs(s - sch.targetSecond) <= 2) {
            if (Date.now() - sch.lastChecked < 1500) return; // debounce
            sch.lastChecked = Date.now();

            sch.status = 'Casting...';
            renderProtectionList();

            try {
                const towns = MM.getCollections().Town[0].models;
                let athenaTown = null;
                for (let town of towns) {
                    if (town.attributes.god === 'athena') {
                        athenaTown = town;
                        break;
                    }
                }
                if (!athenaTown) throw new Error('No Athena city found');

                const favor = ITowns.player_gods.attributes.athena_favor || 0;
                if (favor < 130) throw new Error('Not enough favor (need ≥130)');

                const request = {
                    model_url: 'CastedPowers',
                    action_name: 'cast',
                    arguments: {
                        power_id: 'town_protection',
                        target_id: sch.cityId,
                        town_id: athenaTown.attributes.id,
                        csrfToken: Game.csrfToken
                    }
                };

                await new Promise((resolve, reject) => {
                    gpAjax.ajaxPost('frontend_bridge', 'execute', request, {
                        success: () => resolve(),
                        error: (e) => reject(e)
                    });
                });

                sch.status = 'Cast OK!';
                showToast('success', `Protection cast on city ${sch.cityId}`);
            } catch (err) {
                sch.status = `Error: ${err.message}`;
                showToast('danger', `Failed protection ${sch.cityId}: ${err.message}`);
            }

            // Optional: keep in list for history or auto-remove?
            // For now we keep it (you can cancel manually)
            renderProtectionList();
            saveProtectionSchedules();
        }
    });
}

// ── Wire UI events ──
setTimeout(() => {
    loadProtectionSchedules();

    const addBtn = document.getElementById('prot-add');
    if (addBtn) {
        addBtn.onclick = () => {
            const cid = parseInt(document.getElementById('prot-cityId')?.value) || 0;
            const hh  = parseInt(document.getElementById('prot-hh')?.value)   || 0;
            const mm  = parseInt(document.getElementById('prot-mm')?.value)   || 0;
            const ss  = parseInt(document.getElementById('prot-ss')?.value)   || 0;

            if (!cid || hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) {
                showToast('warn', 'Invalid input — check city ID and time');
                return;
            }

            addProtectionSchedule(cid, hh, mm, ss);

            // Optional: clear inputs after add
            document.getElementById('prot-cityId').value = '';
            document.getElementById('prot-hh').value = '';
            document.getElementById('prot-mm').value = '';
            document.getElementById('prot-ss').value = '';
        };
    }

    // Refresh list when tab opened
    document.querySelector('[data-tab="protection"]')?.addEventListener('click', renderProtectionList);

  document.querySelector('[data-tab="info"]')?.addEventListener('click', () => {
    if (document.getElementById('info-player-sel')?._wired) return;
    const sel = document.getElementById('info-player-sel');
    if (sel) sel._wired = true;
    initInfoTab();
});
}, 1500);

// Add to priority 0 loop (very frequent)
setInterval(protectionPriorityLoop, 800 + Math.random() * 400);  // ~1× per second

            // ── Change 4+5: rAF loop replaces setInterval, only renders the visible tab ──
            let _lastLiveUpdate = 0;
            let _liveRafId = null;

            function liveLoop(ts) {
                if (!document.getElementById('masterWindow')) {
                    _liveRafId = null;
                    return;
                }
                if (ts - _lastLiveUpdate > 2000) {
                    _lastLiveUpdate = ts;
                    updateStatusTab();                              // always — has sleep countdown
                    if (_activeTab === 'towns')  updateTownsTab();
                    if (_activeTab === 'stats')  updateStatsTab();
                    if (_activeTab === 'alerts') updateAlertsTab();
                    // 'alliance' and 'info' tabs refresh themselves on click, no polling needed
                }
                _liveRafId = requestAnimationFrame(liveLoop);
            }
            if (_liveRafId) cancelAnimationFrame(_liveRafId);
            _liveRafId = requestAnimationFrame(liveLoop);

            // ── Config save button ──
            const btn = document.getElementById('cfg_saveBtn');
            if (btn) {
                btn.addEventListener('click', () => {
                    const v   = (id) => document.getElementById(id);
                    const num = (id) => parseFloat(v(id).value) || 0;
                    const chk = (id) => v(id).checked;

                    MIN_RUN_DELAY = num('cfg_minRun') * 60000;
                    MAX_RUN_DELAY = num('cfg_maxRun') * 60000;

                    SLEEP_CONFIG.enabled      = chk('cfg_sleepEnabled');
                    SLEEP_CONFIG.sleepHour    = Math.min(23, Math.max(0, num('cfg_sleepHour')));
                    SLEEP_CONFIG.sleepMinMs   = num('cfg_sleepMin') * 3600000;
                    SLEEP_CONFIG.sleepMaxMs   = num('cfg_sleepMax') * 3600000;
                    SLEEP_CONFIG.wakeJitterMs = num('cfg_wakeJitter') * 60000;

                    CULTURE_CONFIG.runTheater      = chk('cfg_runTheater');
                    CULTURE_CONFIG.runParty        = chk('cfg_runParty');
                    CULTURE_CONFIG.runTriumph      = chk('cfg_runTriumph');
                    CULTURE_CONFIG.runGames        = chk('cfg_runGames');
                    CULTURE_CONFIG.cultureKeepBP   = num('cfg_keepBP');
                    CULTURE_CONFIG.cultureKeepGold = num('cfg_keepGold');
                    CULTURE_CONFIG.waitLowMin      = num('cfg_waitLowMin') * 60000;
                    CULTURE_CONFIG.waitLowMax      = num('cfg_waitLowMax') * 60000;
                    CULTURE_CONFIG.waitHighMin     = num('cfg_waitHighMin') * 60000;
                    CULTURE_CONFIG.waitHighMax     = num('cfg_waitHighMax') * 60000;

                    FARM_CONFIG.useFarm           = chk('cfg_useFarm');
                    FARM_CONFIG.autoOpenVillages  = chk('cfg_autoOpenVillages');
                    FARM_CONFIG.upgradeVillages   = chk('cfg_upgradeVillages');
                    FARM_CONFIG.villagesMaxLevel  = num('cfg_villagesMaxLevel');

                    NO_TROOP_TRADE_DISABLE_THRESHOLD = num('cfg_noTradeThr');
                    NAV_CONFIG.enabled = chk('cfg_navEnabled');
                    NAV_CONFIG.keyNext = (v('cfg_navNext').value || 'x').trim()[0];
                    NAV_CONFIG.keyPrev = (v('cfg_navPrev').value || 'z').trim()[0];
                    NOTIF_CONFIG.attackWebhook = (document.getElementById('cfg-attack-webhook')?.value || '').trim();
                    NOTIF_CONFIG.csWebhook     = (document.getElementById('cfg-cs-webhook')?.value || '').trim();
                    NOTIF_CONFIG.possibleCsWebhook = (document.getElementById('cfg-possible-cs-webhook')?.value || '').trim();
                    console.log('[MasterConfig] Settings applied live.');
                    savePersistedConfig();   // persists everything including webhooks
                    const msg = document.getElementById('cfg_savedMsg');
                    if (msg) {
                        msg.textContent = '✓ Settings applied!';
                        setTimeout(() => { msg.textContent = ''; }, 3000);
                    }
                });
            }

        }, 200);
    }

    function addMasterConfigButton() {
        if (document.getElementById('masterConfigBtn')) return;
        const area = document.getElementsByClassName('gods_area_buttons')[0];
        if (!area) return;

        const btn = document.createElement('div');
        btn.id = 'masterConfigBtn';
        btn.className = 'btn_settings circle_button';
        btn.title = 'Master Config';
        btn.style.cssText = 'left:-5px; margin-top:40px; z-index:9999; cursor:pointer;';

        // Gear icon using inline SVG
        const icon = document.createElement('div');
        icon.style.cssText = 'width:20px;height:20px;margin:6px 0 0 5px;display:flex;align-items:center;justify-content:center;';
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
            <!-- Robot head -->
            <rect x="5" y="6" width="14" height="10" rx="2" fill="#cce0ff" stroke="#5588cc" stroke-width="1"/>
            <!-- Antenna -->
            <line x1="12" y1="6" x2="12" y2="3" stroke="#5588cc" stroke-width="1.2"/>
            <circle cx="12" cy="2.5" r="1" fill="#ffcc44"/>
            <!-- Closed sleepy eyes (curved lines) -->
            <path d="M7.5 10 Q8.5 8.5 9.5 10" fill="none" stroke="#3366aa" stroke-width="1.2" stroke-linecap="round"/>
            <path d="M14.5 10 Q15.5 8.5 16.5 10" fill="none" stroke="#3366aa" stroke-width="1.2" stroke-linecap="round"/>
            <!-- Small mouth -->
            <path d="M10 13 Q12 14.5 14 13" fill="none" stroke="#3366aa" stroke-width="1" stroke-linecap="round"/>
            <!-- Body -->
            <rect x="7" y="16" width="10" height="5" rx="1.5" fill="#aac8ee" stroke="#5588cc" stroke-width="1"/>
            <!-- Zzz -->
            <text x="17" y="8" font-size="5" fill="#ffdd55" font-weight="bold" font-family="Arial">z</text>
            <text x="19" y="5.5" font-size="4" fill="#ffdd55" font-weight="bold" font-family="Arial">z</text>
        </svg>`;

        btn.appendChild(icon);
        btn.addEventListener('click', createMasterConfigWindow);
        area.appendChild(btn);
    }


    // ══════════════════════════════════════════════════════════════
    //  TROOP COUNTER — Barracks & Docks queue totals
    //  tcCountBuilding(type) merges the two identical tcCountDocks /
    //  tcCountBarracks functions from v4.
    // ══════════════════════════════════════════════════════════════

    let tcBarracksOpen  = false;
    let tcBarracksReady = false;
    let tcDocksOpen     = false;
    let tcDocksReady    = false;

    // DOM cache — avoids repeated querySelector on every count call.
    // Entries are cleared when the corresponding window closes.
    const _tcDomCache = {};

    function tcGetDom(type) {
        if (!_tcDomCache[type]) {
            const cls = type === 'docks' ? 'docks_building' : 'barracks_building';
            _tcDomCache[type] = {
                win      : document.getElementsByClassName(cls)[0] ?? null,
                troops   : document.getElementById('units'),
                queue    : document.querySelector(`.ui_various_orders.type_unit_queue.${type}`),
                container: null,   // filled lazily by tcCreateBoxes / tcRenderIcons
            };
        }
        return _tcDomCache[type];
    }

    /** Count queued units for 'barracks' or 'docks' and render the overlay. */
    function tcCountBuilding(type) {
        const dom = tcGetDom(type);
        const { queue, troops } = dom;
        if (!queue || !troops) return;

        const counts = {};
        troops.querySelectorAll('.unit_tab').forEach(tab => {
            const n = Number(tab.querySelector('span.unit_order_total')?.innerText);
            if (n > 0) counts[tab.id] = (counts[tab.id] || 0) + n;
        });
        queue.querySelectorAll('.js-queue-item').forEach(item => {
            const n = Number(item.querySelector('.unit_count.text_shadow')?.innerText);
            if (n > 0) {
                const t = item.classList[item.classList.length - 1];
                counts[t] = (counts[t] || 0) + n;
            }
        });

        tcCreateBoxes(type);
        tcRenderIcons(type, counts);
    }

    uw.$(document).ajaxComplete(function(_event, xhr, settings) {
        if (!UI_CONFIG.showTroopCounter) return;

        if (settings.url.includes('building_docks')) {
            try {
                const data = JSON.parse(xhr.responseText);
                if (data.json && data.plain?.html) {
                    if (tcDocksOpen) tcCountBuilding('docks');
                    else tcDocksReady = true;
                }
            } catch(e) { tcDocksReady = false; }
        }

        if (settings.url.includes('building_barracks')) {
            try {
                const data = JSON.parse(xhr.responseText);
                if (data.json && data.plain?.html) {
                    if (tcBarracksOpen) tcCountBuilding('barracks');
                    else tcBarracksReady = true;
                }
            } catch(e) { tcBarracksReady = false; }
        }
    });

    uw.$.Observer(uw.GameEvents.window.open).subscribe((_e, data) => {
        if (!data?.context || !UI_CONFIG.showTroopCounter) return;
        if (data.context === 'building_barracks') {
            tcBarracksOpen = true;
            if (tcBarracksReady) tcCountBuilding('barracks');
        }
        if (data.context === 'building_docks') {
            tcDocksOpen = true;
            if (tcDocksReady) tcCountBuilding('docks');
        }
    });

    uw.$.Observer(uw.GameEvents.window.close).subscribe((_e, data) => {
        if (data?.type === 25) { tcBarracksOpen = false; tcBarracksReady = false; delete _tcDomCache.barracks; }
        if (data?.type === 26) { tcDocksOpen    = false; tcDocksReady    = false; delete _tcDomCache.docks;    }
    });

    function tcCreateBoxes(type) {
        const dom = tcGetDom(type);
        const cap = type === 'docks' ? 'Docks' : 'Barracks';
        const win = dom.win ?? document.getElementsByClassName(type === 'docks' ? 'docks_building' : 'barracks_building')[0];
        if (!win) return;

        const container = win.querySelector('#unit_orders_queue');
        if (!container) return;
        dom.container = container;   // cache for tcRenderIcons

        document.querySelector(`.small-box-${cap}`)?.remove();
        document.querySelector(`.big-box-${cap}`)?.remove();

        const smallBox = document.createElement('div');
        smallBox.className = `small-box-${cap}`;
        smallBox.innerHTML = '<span>Σύνολο μαζί με την σειρά κατασκευών:</span>';
        Object.assign(smallBox.style, {
            width: '320px', height: '30px', textAlign: 'left',
            fontWeight: 'bold', padding: '3px', borderRadius: '5px',
            position: 'absolute', top: '270px', left: '480px',
        });
        container.appendChild(smallBox);
    }

    function tcRenderIcons(type, counts) {
        const dom = tcGetDom(type);
        const cap = type === 'docks' ? 'Docks' : 'Barracks';
        // Use cached container, fall back to a fresh query if needed
        const container = dom.container
            ?? (dom.win ?? document.getElementsByClassName(type === 'docks' ? 'docks_building' : 'barracks_building')[0])
               ?.querySelector('#unit_orders_queue');
        if (!container) return;

        let box = document.querySelector(`.big-box-${cap}-container`);
        if (!box) {
            box = document.createElement('div');
            box.className = `big-box-${cap}-container`;
            Object.assign(box.style, {
                position: 'absolute', top: '295px', left: '550px',
                width: '220px', height: 'auto', zIndex: '1000',
            });
            box.innerHTML = `
                <div class="grepo-frame">
                    <div class="frame-border-left"></div><div class="frame-border-right"></div>
                    <div class="frame-border-top"></div><div class="frame-border-bottom"></div>
                    <div class="frame-corner-top-left"></div><div class="frame-corner-top-right"></div>
                    <div class="frame-corner-bottom-left"></div><div class="frame-corner-bottom-right"></div>
                    <div class="frame-content">
                        <div class="various_orders_background">
                            <div class="various_orders_middle"></div>
                            <div class="various_orders_content js-researches-queue instant_buy">
                                <div class="big-box" style="display:flex;flex-direction:column;gap:5px;padding:2px 5px 0 5px;"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
            container.appendChild(box);
        }

        const bigBox = box.querySelector('.big-box');
        if (!bigBox) return;

        // ── Change 7: build off-screen with DocumentFragment, single DOM write ──
        const frag = document.createDocumentFragment();
        let row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', justifyContent: 'center', gap: '5px' });

        let i = 0;
        for (const [unitType, count] of Object.entries(counts)) {
            const icon = document.createElement('div');
            icon.className = `unit_order_unit_image unit_icon50x50 ${unitType} js-item-icon`;
            Object.assign(icon.style, {
                display: 'inline-block', position: 'relative',
                marginTop: '5px', marginBottom: '5px',
            });

            const lbl = document.createElement('div');
            lbl.className = 'unit_count text_shadow';
            Object.assign(lbl.style, {
                position: 'absolute', right: '0', bottom: '-2px',
                fontSize: '12px', color: 'white', fontWeight: 'bold',
            });
            lbl.textContent = count;

            icon.appendChild(lbl);
            row.appendChild(icon);
            i++;

            if (i % 3 === 0) {
                frag.appendChild(row);
                row = document.createElement('div');
                Object.assign(row.style, { display: 'flex', justifyContent: 'center', gap: '5px' });
            }
        }
        if (i % 3 !== 0) frag.appendChild(row);

        bigBox.replaceChildren(frag);   // single atomic DOM write, no innerHTML thrash
    }

    // ══════════════════════════════════════════════════════════════
    //  SIMULATOR ATTACK COUNTER — building_place window
    // ══════════════════════════════════════════════════════════════

    uw.$.Observer(uw.GameEvents.window.open).subscribe((_e, data) => {
        if (data?.context !== 'building_place' || !UI_CONFIG.showSimCounter) return;

        let attempts = 10;
        const setupTrigger = () => {
            setTimeout(() => {
                const sim = document.getElementById('building_place-simulator');
                if (!sim) {
                    if (attempts-- > 0) setupTrigger();
                    return;
                }
                $(sim).on('click', onSimClick);
            }, 100);
        };

        const onSimClick = () => {
            setTimeout(() => {
                let footerAttempts = 10;
                const trySetup = () => {
                    setTimeout(() => {
                        if (!UI_CONFIG.showSimCounter) return;
                        const footer = document.querySelector('.game_list_footer');
                        if (!footer) {
                            if (footerAttempts-- > 0) trySetup();
                            return;
                        }
                        if (document.getElementById('survives_counter')) return;

                        const btn = document.getElementById('insert_survives_def_units');
                        if (!btn) return;

                        const counter    = document.createElement('a');
                        counter.id        = 'survives_counter';
                        counter.className = 'button';
                        counter.href      = '#';
                        counter.innerHTML = `<span class="left"><span class="right"><span class="middle">Total atks: 0</span></span></span><span style="clear:both"></span>`;
                        footer.appendChild(counter);

                        const label = counter.querySelector('.middle');
                        let count = 0;
                        $(btn).on('click', () => {
                            count++;
                            label.textContent = `Total atks: ${count}`;
                        });
                    }, 100);
                };
                trySetup();
            }, 200);
        };

        setupTrigger();
    });

     // ── Requests tab ──────────────────────────────────────────────────────────────

const reqFmtTime = (secs) => {
    if (secs <= 0) return 'Expired';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

  let reqSeenIds = new Set();

async function reqFetch() {
    const statusEl = document.getElementById('req-status-bar');
    try {
        const res  = await fetch(`${NOTIF_API_BASE}/requests/${uw.Game.world_id}`);
        const data = await res.json();
        if (data.ok) {
            // Detect new requests
            data.requests.forEach(r => {
                if (!reqSeenIds.has(r.id)) {
                    if (reqSeenIds.size > 0) {
                        // Only alert if not first load
                        showRequestAlert(`${r.player_name} [${r.alliance_name}] needs resources for <strong>${r.town_name}</strong>`);
                    }
                    reqSeenIds.add(r.id);
                }
            });
            reqRender(data.requests);
            if (statusEl) statusEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
        }
    } catch { if (statusEl) statusEl.textContent = '⚠ Failed to load requests'; }
}
async function reqRender(requests) {
    const list  = document.getElementById('req-list');
    const myId  = String(uw.Game.player_id);
    const now   = Math.floor(Date.now() / 1000);
    if (!list) return;
    if (!requests.length) {
        list.innerHTML = '<div style="color:#888;font-size:11px;text-align:center;padding:10px;">No active requests</div>';
        return;
    }
    list.innerHTML = requests.map(r => {
        const remaining   = r.expires_at - now;
        const isOwn       = String(r.player_id) === myId;
        const isFulfilled = r.fulfilled === 1;
       const resources = [
    r.wood  > 0 ? `<span style="background:url(https://gpgr.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -25px -671px;width:25px;height:20px;display:inline-block;vertical-align:middle;"></span> ${r.wood.toLocaleString()}` : '',
    r.stone > 0 ? `<span style="background:url(https://gpgr.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat 0 -671px;width:25px;height:20px;display:inline-block;vertical-align:middle;"></span> ${r.stone.toLocaleString()}` : '',
    r.iron  > 0 ? `<span style="background:url(https://gpgr.innogamescdn.com/images/game/autogenerated/layout/layout_095495a.png) no-repeat -672px -647px;width:25px;height:20px;display:inline-block;vertical-align:middle;"></span> ${r.iron.toLocaleString()}` : '',
].filter(Boolean).join('  ');
        return `
        <div style="background:${isFulfilled ? 'rgba(0,180,0,0.08)' : 'rgba(0,0,0,0.08)'};
                    border:1px solid ${isFulfilled ? '#4a8' : 'rgba(139,90,42,0.3)'};
                    border-radius:6px;padding:8px;margin-bottom:6px;font-size:11px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <span style="font-weight:bold;color:#3a2a12;">${r.player_name}</span>
                    ${r.alliance_name ? `<span style="color:#888;"> [${r.alliance_name}]</span>` : ''}
                    ${isFulfilled ? '<span style="color:#4a8;font-weight:bold;"> ✅ Fulfilled</span>' : ''}
                </div>
                <div style="display:flex;gap:4px;align-items:center;">
                    <span style="color:#888;font-size:10px;">⏱ ${reqFmtTime(remaining)}</span>
                    ${!isFulfilled ? `<button data-req-fulfill="${r.id}" title="Mark as fulfilled"
                        style="background:none;border:1px solid #4a8;border-radius:3px;color:#4a8;cursor:pointer;padding:1px 5px;font-size:11px;">✅</button>` : ''}
                    ${isOwn ? `<button data-req-delete="${r.id}"
    style="background:none;border:none;color:#c44;cursor:pointer;padding:1px 5px;font-size:13px;font-weight:bold;">✕</button>` : ''}
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;margin-top:3px;">
    <span style="background:url('https://dio-david1327.github.io/img/dio/btn/logo-grepolis.png') -23px 0px;width:21px;height:22px;display:inline-block;flex-shrink:0;"></span>
    <span style="color:#5c3a1a;">${r.town_name}</span>
</div>
            <div style="color:#3a2a12;margin-top:3px;font-weight:bold;">${resources}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-req-fulfill]').forEach(btn => {
        btn.addEventListener('click', async () => {
     const body = { player_id: String(uw.Game.player_id), world_id: String(uw.Game.world_id) };
    await fetch(`${NOTIF_API_BASE}/requests/${btn.getAttribute('data-req-fulfill')}/fulfill`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authSignRequest(body) } });
            reqFetch();
        });
    });
    list.querySelectorAll('[data-req-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const body = { player_id: uw.Game.player_id };
await fetch(`${NOTIF_API_BASE}/requests/${btn.getAttribute('data-req-delete')}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authSignRequest(body) },
    body: JSON.stringify(body),
});
            reqFetch();
        });
    });
};

async function reqPopulateTowns() {
    const sel = document.getElementById('req-town');
    if (!sel) return;
    const towns = uw.ITowns?.towns || {};
    sel.innerHTML = '<option value="">-- Select your town --</option>' +
        Object.values(towns)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(t => `<option value="${t.id}">${t.name}</option>`)
            .join('');
}
async function reqPushRequest() {
    const townSelect = document.getElementById('req-town');
    const townId     = townSelect?.value;
    const townName   = townSelect?.options[townSelect.selectedIndex]?.text;
    const wood       = parseInt(document.getElementById('req-wood')?.value)  || 0;
    const stone      = parseInt(document.getElementById('req-stone')?.value) || 0;
    const iron       = parseInt(document.getElementById('req-iron')?.value)  || 0;
    const expiresSecs= parseInt(document.getElementById('req-expires')?.value) || 3600;
    if (!townId)                  { alert('Select a town'); return; }
    if (!wood && !stone && !iron) { alert('Enter at least one resource amount'); return; }
      const allianceId = uw.MM.getModels().Player?.[uw.Game.player_id]?.attributes?.alliance_id;
let allianceName = '';
if (allianceId) {
    try {
        const ar = await fetch(`${NOTIF_API_BASE}/alliance/${allianceId}`);
        const ad = await ar.json();
        allianceName = ad.name || '';
    } catch {}
}
    try {
        const res = await fetch(`${NOTIF_API_BASE}/requests/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authSignRequest(body) },
            body: JSON.stringify({
                world: uw.Game.world_id, player_id: uw.Game.player_id,
                player_name: uw.Game.player_name, alliance_name: allianceName || '',
                town_id: townId, town_name: townName,
                wood, stone, iron,
                expires_at: Math.floor(Date.now() / 1000) + expiresSecs,
            }),
        });
        const data = await res.json();
        if (data.ok) {
            document.getElementById('req-wood').value  = '';
            document.getElementById('req-stone').value = '';
            document.getElementById('req-iron').value  = '';
            reqFetch();
        }
    } catch (e) { console.error('[Requests] Push failed:', e); }
};

function initRequestsTab() {
    reqPopulateTowns();
    reqFetch();
    const pushBtn = document.getElementById('req-push-btn');
    if (pushBtn && !pushBtn._wired) {
        pushBtn._wired = true;
        pushBtn.addEventListener('click', reqPushRequest);
    }
    const refreshBtn = document.getElementById('req-refresh-btn');
    if (refreshBtn && !refreshBtn._wired) {
        refreshBtn._wired = true;
        refreshBtn.addEventListener('click', reqFetch);
    }
}
    // ══════════════════════════════════════════════════════════════
    //  TOWN NAVIGATION BY DISTANCE — z/x keys (configurable)
    // ══════════════════════════════════════════════════════════════

    let navTownId    = null;
let navTownArray = [];
let navIndex     = 0;
let navCoordsCache = null; // { townId: { island_x, island_y, offset_x, offset_y } }
let navBoostsCache = {};
let navForeignCoordsCache = {}; // not persisted, just in-memory per session
    // ── Nav coords watcher (runs every 8 hours) ───────────────────────────────────
const NAV_COORDS_KEY = 'grp_nav_coords'; // { townId: { island_x, island_y, offset_x, offset_y } }


    const NAV_BOOSTS_KEY = 'grp_nav_boosts'; // { townId: end_at }

const navSaveBoosts = () => {
    localStorage.setItem(NAV_BOOSTS_KEY, JSON.stringify(navBoostsCache));
};

const navLoadBoosts = () => {
    try {
        const raw = localStorage.getItem(NAV_BOOSTS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
};

const navSyncBoosts = () => {
    const now     = uw.Timestamp.now();
    const towns   = uw.ITowns?.towns || {};
    let   changed = false;

    for (const townId of Object.keys(towns)) {
        try {
            const models = towns[townId].getCastedPowersCollection().models || [];
            const boost  = models.find(m => m.attributes.power_id === 'longterm_trade_speed_boost' && m.attributes.end_at > now);
            const cached = navBoostsCache[townId];

            if (boost && !cached) {
                navBoostsCache[townId] = boost.attributes.end_at;
                changed = true;
                console.log(`[Nav] Trade boost added for town ${townId} (ends ${new Date(boost.attributes.end_at * 1000).toLocaleString()})`);
            } else if (!boost && cached) {
                delete navBoostsCache[townId];
                changed = true;
                console.log(`[Nav] Trade boost removed for town ${townId}`);
            }
        } catch {}
    }

    if (changed) navSaveBoosts();
};

const navSaveCoords = () => {
    localStorage.setItem(NAV_COORDS_KEY, JSON.stringify(navCoordsCache));
};

const navLoadCoords = () => {
    try {
        const raw = localStorage.getItem(NAV_COORDS_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
};

const navPrefetchCoords = async () => {
    const currentIds = new Set(Object.keys(uw.ITowns?.towns || {}));
    const stored = navLoadCoords();

    if (stored) {
        navCoordsCache = stored;
        const cachedIds = new Set(Object.keys(stored));
        const added   = [...currentIds].filter(id => !cachedIds.has(id));
        const removed = [...cachedIds].filter(id => !currentIds.has(id));

        // First time boost setup — no localStorage entry yet
const boostsExist = localStorage.getItem(NAV_BOOSTS_KEY) !== null;
if (!boostsExist) {
    navSyncBoosts();
} else {
    navBoostsCache = navLoadBoosts(); // ← always load into memory
}

        // No town changes and boosts already synced — nothing to do
        if (added.length === 0 && removed.length === 0 && boostsExist) {
            console.log(`[Nav] Coords loaded from localStorage — no changes`);
            return;
        }

        // Apply coord changes
        for (const id of removed) delete navCoordsCache[id];
        if (added.length > 0) {
            try {
                const res  = await fetch(`${NOTIF_API_BASE}/towns/batch`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ ids: added.map(Number) }),
                });
                const data = await res.json();
                if (data.ok) Object.assign(navCoordsCache, data.towns);
                console.log(`[Nav] Fetched ${added.length} new + removed ${removed.length}`);
            } catch (e) {
                console.warn('[Nav] Failed to fetch new town coords:', e.message);
            }
        }

        navSyncBoosts();
        navSaveCoords();
        return;
    }

    // No localStorage at all — full fetch
    try {
        const res  = await fetch(`${NOTIF_API_BASE}/towns/batch`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ids: [...currentIds].map(Number) }),
        });
        const data = await res.json();
        if (data.ok) {
            navCoordsCache = data.towns;
            navSaveCoords();
            console.log(`[Nav] Full fetch — cached ${Object.keys(navCoordsCache).length} towns`);
        }
    } catch (e) {
        console.warn('[Nav] Failed to prefetch coords:', e.message);
    }
    navSyncBoosts();
};

const navWatchTowns = async () => {
    const currentIds = new Set(Object.keys(uw.ITowns?.towns || {}));
    const cachedIds  = new Set(Object.keys(navCoordsCache || {}));
    const added   = [...currentIds].filter(id => !cachedIds.has(id));
    const removed = [...cachedIds].filter(id => !currentIds.has(id));

    if (added.length === 0 && removed.length === 0) {
        console.log('[Nav] No town changes detected');
        return;
    }

    for (const id of removed) delete navCoordsCache[id];

    if (added.length > 0) {
        try {
            const res  = await fetch(`${NOTIF_API_BASE}/towns/batch`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ ids: added.map(Number) }),
            });
            const data = await res.json();
            if (data.ok) Object.assign(navCoordsCache, data.towns);
        } catch (e) {
            console.warn('[Nav] Failed to fetch new town coords:', e.message);
        }
    }
    if (added.length > 0 || removed.length > 0) {
    try {
const oldPartB = GM_getValue('grp_part_b_' + uw.Game.world_id, null);
const newPartB = authComputePartB();
        if (oldPartA) {
            const r = await fetch(`${NOTIF_API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_id: String(uw.Game.player_id),
                    world_id:  String(uw.Game.world_id),
                    old_part_a: oldPartA,
                    old_part_b: authComputePartB(), // computed BEFORE town list updates
                    new_part_b: newPartB,
                }),
            });
            const j = await r.json();
            if (j.ok && j.part_a) {
                GM_setValue(AUTH_TOKEN_KEY, j.part_a);
                console.log('[Auth] Token refreshed after town change');
            }
        }
    } catch(e) {
        console.warn('[Auth] Token refresh failed:', e.message);
    }
}
    navSyncBoosts();
    navSaveCoords();
    console.log(`[Nav] Updated — added ${added.length}, removed ${removed.length}`);
};
const navTradeTime = (senderId, t1, t2) => {
    if (!t1 || !t2) return Infinity;
    if (t1.offset_x == null || t2.offset_x == null) return Infinity;
    const ws      = uw.Game.game_speed || 1;
    const captain = hasCaptain() ? 2 : 1;
    const boost   = navBoostsCache[senderId] ? 2 : 1;
    console.log(`[NavTT] senderId=${senderId} (type=${typeof senderId}) | boostKeys=${JSON.stringify(Object.keys(navBoostsCache))} | boost=${boost}`);
    const cx1 = t1.island_x * 128 + t1.offset_x;
    const cy1 = t1.island_y * 128 + (t1.island_x % 2 === 1 ? 64 : 0) + t1.offset_y;
    const cx2 = t2.island_x * 128 + t2.offset_x;
    const cy2 = t2.island_y * 128 + (t2.island_x % 2 === 1 ? 64 : 0) + t2.offset_y;

    const dist       = Math.sqrt((cx1-cx2)**2 + (cy1-cy2)**2);
    const sameIsland = t1.island_x === t2.island_x && t1.island_y === t2.island_y;
    const i          = sameIsland ? 0 : 1;

    return Math.floor((5/3 * dist + i * 450) / (ws * Math.pow(captain, i) * boost));
};


const navBuildArray = (targetId, targetCoords) => {
    try {
        const allIds = Object.keys(uw.ITowns?.towns || {}).map(Number)
                           .filter(t => t !== Number(targetId));
        return [
            Number(targetId),
            ...allIds
                .map(id => ({ id, tt: navTradeTime(String(id), navCoordsCache?.[String(id)], targetCoords) }))
                .sort((a, b) => a.tt - b.tt)
                .map(t => t.id),
        ];
    } catch (e) { return []; }
};
const navInit = async (id) => {
    if (!id) { navTownArray = []; return; }

    let targetCoords = navCoordsCache?.[String(id)];

    // Foreign town — fetch coords if not cached
    if (!targetCoords) {
        if (navForeignCoordsCache[String(id)]) {
            targetCoords = navForeignCoordsCache[String(id)];
        } else {
            try {
                const res  = await fetch(`${NOTIF_API_BASE}/towns/batch`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ ids: [Number(id)] }),
                });
                const data = await res.json();
                if (data.ok && data.towns[String(id)]) {
                    targetCoords = data.towns[String(id)];
                    navForeignCoordsCache[String(id)] = targetCoords;
                }
            } catch (e) {
                console.warn('[Nav] Failed to fetch foreign town coords:', e.message);
            }
        }
    }

    if (!targetCoords) { navTownArray = []; return; }

    navTownArray = navBuildArray(id, targetCoords);
    navIndex     = 0;
};
    if (uw.GPWindowMgr?.Create) {
        const _origCreate = uw.GPWindowMgr.Create;
        uw.GPWindowMgr.Create = function(type, title, params, id) {
            if (type === uw.GPWindowMgr.TYPE_TOWN && id) {
                navTownId = id;
                navInit(id?.id ?? id);
            }
            return _origCreate.apply(this, arguments);
        };
    }

    document.addEventListener('keydown', (e) => {
        if (!NAV_CONFIG.enabled) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (navTownArray.length === 0) return;

        if (e.key === NAV_CONFIG.keyNext) {
            e.preventDefault();
            navIndex = (navIndex + 1) % navTownArray.length;
            uw.HelperTown?.townSwitch?.(navTownArray[navIndex]);
        } else if (e.key === NAV_CONFIG.keyPrev) {
            e.preventDefault();
            navIndex = (navIndex - 1 + navTownArray.length) % navTownArray.length;
            uw.HelperTown?.townSwitch?.(navTownArray[navIndex]);
        }
    });

// ══════════════════════════════════════════════════════════════
    //  DISCORD ATTACK NOTIFICATIONS
    //  Config persisted via savePersistedConfig / loadPersistedConfig.
    //  Uses shared sleep() and botcheck() — no local aliases needed.
    // ══════════════════════════════════════════════════════════════

    const NOTIF_API_BASE   = 'https://test-1i20.onrender.com';
function authSignRequest(body) {
    const part_a     = GM_getValue(`grp_token_${uw.Game.world_id}`, null);
    if (!part_a) return {};
    const part_b     = authComputePartB();
    const part_axorb = authXorHex(part_a, part_b);
    const ts         = Math.floor(Date.now() / 1000).toString();
    const payload    = ts + JSON.stringify(body);
    const sig        = CryptoJS.HmacSHA256(payload, part_axorb).toString();
    return { 'X-Timestamp': ts, 'X-Signature': sig, 'X-Token': part_axorb };
}
function authXorHex(a, b) {
    let result = '';
    for (let i = 0; i < a.length; i++) {
        result += (parseInt(a[i], 16) ^ parseInt(b[i % b.length], 16)).toString(16);
    }
    return result;
}

function authComputePartB() {
    const townIds = Object.keys(uw.ITowns.getTowns()).map(Number).sort((a,b) => a-b).join(',');
    const raw = `${uw.Game.player_id}:${uw.Game.world_id}:${townIds}`;
    let hash = '';
    for (let i = 0; i < 96; i++) {
        const charCode = raw.charCodeAt(i % raw.length) ^ (i * 31 + 7);
        hash += (charCode & 0xff).toString(16).padStart(2, '0').slice(-1);
    }
    return hash;
}

function authComputeAndSavePartB() {
    const partB = authComputePartB();
    GM_setValue(`grp_part_b_${uw.Game.world_id}`, partB);
    return partB;
}
    // NOTIF_CONFIG is declared up in §1 CONFIG and populated by loadPersistedConfig()
    // which runs at startup. savePersistedConfig() persists it alongside everything else.
    // saveNotifConfig() is kept as a lightweight alias used by the checkbox toggles.
    function saveNotifConfig() {
        GM_setValue('cfg_notif', JSON.stringify(NOTIF_CONFIG));
    }

    const notifGetTimeNow = () => {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };

    const notifGetArrivalTime = (unixTime) => {
        const h = Math.floor(unixTime / 3600) % 24;
        const m = Math.floor(unixTime / 60)   % 60;
        const s = unixTime % 60;
        const p = n => String(n).padStart(2, '0');
        return `${p(h)}:${p(m)}:${p(s)}`;
    };

    const notifGetTimeOffset = () => {
        try {
            const tz        = uw.MM.getModels().PlayerSettings[uw.Game.player_id].attributes.timezone;
            const formatted = new Intl.DateTimeFormat('en-US', {
                timeZone: tz, timeZoneName: 'short',
            }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value;
            const sign  = formatted.includes('+') ? 1 : -1;
            const hours = parseFloat((formatted.split('+')[1] || formatted.split('-')[1]) ?? 0);
            return sign * hours * 3600;
        } catch { return 0; }
    };

// ── CS speed table — loaded once from server, cached in localStorage ──────
    const CS_SPEEDS_KEY = 'grp_cs_speeds';

    const notifLoadCsSpeeds = async () => {
        const cached = localStorage.getItem(CS_SPEEDS_KEY);
        if (cached) return JSON.parse(cached);
        try {
            const res    = await fetch(`${NOTIF_API_BASE}/cs-speeds`);
            const speeds = await res.json();
            localStorage.setItem(CS_SPEEDS_KEY, JSON.stringify(speeds));
            console.log(`%c[AttackNotif] CS speed table loaded (${speeds.length} entries)`, 'color:lime');
            return speeds;
        } catch (e) {
            console.error('[AttackNotif] Failed to load CS speed table:', e);
            return null;
        }
    };

    const CONFLICTING_SPEEDS_KEY = 'grp_conflicting_speeds';

    const notifLoadConflictingSpeeds = async () => {
        const cached = localStorage.getItem(CONFLICTING_SPEEDS_KEY);
        if (cached) return JSON.parse(cached);
        try {
            const res  = await fetch(`${NOTIF_API_BASE}/conflicting-speeds`);
            const data = await res.json();
            localStorage.setItem(CONFLICTING_SPEEDS_KEY, JSON.stringify(data));
            console.log(`%c[AttackNotif] Conflicting speeds loaded (${Object.keys(data).length} units)`, 'color:lime');
            return data;
        } catch (e) {
            console.error('[AttackNotif] Failed to load conflicting speeds:', e);
            return null;
        }
    };

    // Given a matched CS speed, returns array of human-readable modifier strings
    // e.g. ["Cartography + Set Sail | Boots | 3 Sirens", ...]
    const notifComputeCsModifiers = (targetTT, distance, overhead) => {
        const cart_vals  = [0, 0.1];
        const sail_vals  = [0, 0.1];
        const light_vals = [0, 0.15];
        const boots_vals = [0, 0.3];
        const atal_vals  = [0, ...Array.from({length: 20}, (_, n) => parseFloat((0.132 + n * 0.012).toFixed(3)))];
        const siren_vals = Array.from({length: 51}, (_, n) => parseFloat((n * 0.02).toFixed(2)));

        const results = [];

        for (const cart of cart_vals) {
            for (const sail of sail_vals) {
                for (const light of light_vals) {
                    for (const boots of boots_vals) {
                        for (const atal of atal_vals) {
                            for (const siren of siren_vals) {
                                const g1    = 1 + cart + sail + light;
                                const g2    = 1 + boots + atal;
                                const g3    = 1 + siren;
                                const speed = 6 * g1 * g2 * g3;
                                const tt    = Math.floor(50 * distance / speed + overhead);
                                if (Math.abs(tt - targetTT) <= 11) {
                                    const g1parts = [];
                                    if (cart)  g1parts.push('Cartography');
                                    if (sail)  g1parts.push('Set Sail');
                                    if (light) g1parts.push('Lighthouse');

                                    const g2parts = [];
                                    if (boots) g2parts.push('Boots');
                                    if (atal > 0) {
                                        const lvl = Math.round((atal - 0.132) / 0.012) + 1;
                                        g2parts.push(`Atalanta lvl ${lvl}`);
                                    }

                                    const g3parts = siren > 0
                                        ? [`${Math.round(siren / 0.02)} Siren${siren > 0.02 ? 's' : ''}`]
                                        : [];

                                    const allParts = [
                                        g1parts.length ? g1parts.join(' + ') : null,
                                        g2parts.length ? g2parts.join(' + ') : null,
                                        g3parts.length ? g3parts[0]          : null,
                                    ].filter(Boolean);

                                    results.push(allParts.length ? allParts.join(' + ') : 'No modifiers');
                                }
                            }
                        }
                    }
                }
            }
        }
        return results;
    };

    const UNIT_PRETTY = {
        sword:           'Sword Fighter',
        hoplite:         'Hoplite',
        catapult:        'Catapult',
        cerberus:        'Cerberus',
        medusa:          'Medusa',
        zyklop:          'Cyclops',
        big_transporter: 'Big Transporter',
        sea_monster:     'Sea Monster',
        archer:          'Archer',
        minotaur:        'Minotaur',
        fury:            'Fury',
        attack_ship:     'Attack Ship',
    };

    const UNIT_BASE_SPEED = {
        sword: 16, hoplite: 12, catapult: 4, cerberus: 8,
        medusa: 12, zyklop: 16, archer: 24, minotaur: 20, fury: 20,
        big_transporter: 16, sea_monster: 16, attack_ship: 26,
    };
    const NAVAL_UNITS = new Set(['big_transporter', 'sea_monster', 'attack_ship']);

    // Compresses a list of modifier combo strings into ranged lines
    // e.g. ["23 Sirens","24 Sirens","Atalanta lvl 1 + 14 Sirens"] → ["23-24 Sirens", "Atalanta lvl 1 + 14 Sirens"]
    const compressModifiers = (combos) => {
        if (!combos?.length) return [];

        // Parse a combo string into a structured object
        const parse = (s) => {
            if (s === 'No modifiers') return { cart:false, sail:false, light:false, boots:false, atal:0, siren:0, raw: s };
            const cart  = s.includes('Cartography');
            const sail  = s.includes('Set Sail');
            const light = s.includes('Lighthouse');
            const boots = s.includes('Boots');
            const atalM = s.match(/Atalanta lvl (\d+)/);
            const sirenM = s.match(/(\d+) Siren/);
            return {
                cart, sail, light, boots,
                atal:  atalM  ? parseInt(atalM[1])  : 0,
                siren: sirenM ? parseInt(sirenM[1]) : 0,
            };
        };

        // Group by boolean pattern (everything except atal/siren numbers)
        const groups = {};
        for (const combo of combos) {
            const p = parse(combo);
            if (p.raw) { groups['__none__'] = { cart:false, sail:false, light:false, boots:false, atals:new Set([0]), sirens:new Set([0]) }; continue; }
            const key = `${p.cart?1:0}${p.sail?1:0}${p.light?1:0}${p.boots?1:0}`;
            if (!groups[key]) groups[key] = { ...p, atals: new Set(), sirens: new Set() };
            groups[key].atals.add(p.atal);
            groups[key].sirens.add(p.siren);
        }

        // Format each group as a ranged string
        const lines = [];
        for (const [key, g] of Object.entries(groups)) {
            if (key === '__none__') { lines.push('No modifiers'); continue; }

            const boolParts = [
                g.cart  ? 'Cartography' : null,
                g.sail  ? 'Set Sail'    : null,
                g.light ? 'Lighthouse'  : null,
                g.boots ? 'Boots'       : null,
            ].filter(Boolean);

            const atals  = [...g.atals].sort((a,b) => a-b).filter(v => v > 0);
            const sirens = [...g.sirens].sort((a,b) => a-b).filter(v => v > 0);

            const atalStr  = atals.length  ? (atals.length  > 1 ? `Atalanta lvl ${atals[0]}-${atals[atals.length-1]}`   : `Atalanta lvl ${atals[0]}`)   : null;
            const sirenStr = sirens.length ? (sirens.length > 1 ? `${sirens[0]}-${sirens[sirens.length-1]} Sirens` : `${sirens[0]} Siren${sirens[0]>1?'s':''}`) : null;

            const all = [...boolParts, atalStr, sirenStr].filter(Boolean);
            lines.push(all.length ? all.join(' + ') : 'No modifiers');
        }
        return lines;
    };

    // Returns modifier combos for a unit whose travel_time falls within ±11s of targetTT
    const notifComputeUnitModifiers = (unit, targetTT, distance, overhead) => {
        const base = UNIT_BASE_SPEED[unit];
        if (!base) return [];

        const cart_vals  = [0, 0.1];
        const light_vals = [0, 0.15];
        const boots_vals = [0, 0.3];
        const atal_vals  = [0, ...Array.from({length: 20}, (_, n) => parseFloat((0.132 + n * 0.012).toFixed(3)))];
        const siren_vals = Array.from({length: 51}, (_, n) => parseFloat((n * 0.02).toFixed(2)));

        const isNaval = NAVAL_UNITS.has(unit);
        const results = [];

        const tryCombo = (speed, g1parts, g2parts, g3parts) => {
            const tt = Math.floor(50 * distance / speed + overhead);
            if (Math.abs(tt - targetTT) <= 11) {
                const allParts = [
                    g1parts.length ? g1parts.join(' + ') : null,
                    g2parts.length ? g2parts.join(' + ') : null,
                    g3parts.length ? g3parts[0]          : null,
                ].filter(Boolean);
                results.push(allParts.length ? allParts.join(' + ') : 'No modifiers');
            }
        };

        if (isNaval) {
            for (const cart of cart_vals) for (const light of light_vals)
            for (const boots of boots_vals) for (const atal of atal_vals)
            for (const siren of siren_vals) {
                const speed = parseFloat((base * (1 + cart + light) * (1 + boots + atal) * (1 + siren)).toFixed(14));
                const g1 = [cart ? 'Cartography' : null, light ? 'Lighthouse' : null].filter(Boolean);
                const g2 = [boots ? 'Boots' : null, atal > 0 ? `Atalanta lvl ${Math.round((atal - 0.132) / 0.012) + 1}` : null].filter(Boolean);
                const g3 = siren > 0 ? [`${Math.round(siren / 0.02)} Siren${siren > 0.02 ? 's' : ''}`] : [];
                tryCombo(speed, g1, g2, g3);
            }
        } else {
            for (const cart of cart_vals)
            for (const boots of boots_vals) for (const atal of atal_vals) {
                const speed = parseFloat((base * (1 + cart) * (1 + boots + atal)).toFixed(14));
                const g1 = [cart ? 'Cartography' : null].filter(Boolean);
                const g2 = [boots ? 'Boots' : null, atal > 0 ? `Atalanta lvl ${Math.round((atal - 0.132) / 0.012) + 1}` : null].filter(Boolean);
                tryCombo(speed, g1, g2, []);
            }
        }
        return results;
    };

    // GET /attacker/:townId → { player_name, alliance_name }
    const notifFindAttackerName = async (homeTownID) => {
        try {
            const res  = await fetch(`${NOTIF_API_BASE}/attacker/${homeTownID}`);
            const data = await res.json();
            return data.ok ? {
                player_name  : data.player_name   || 'Unknown',
                alliance_name: data.alliance_name || null,
            } : { player_name: 'Unknown', alliance_name: null };
        } catch {
            return { player_name: 'Unknown', alliance_name: null };
        }
    };

    // ── CS detection via cap_of_invisibility_effective_until ──────────────────
    // Returns { status: 'safe'|'cs'|'possible_cs', matchedSpeed, conflictingUnits, csModifiers }
    const notifIsSafe = async (defenderID, attackerID, arrival_at, cap_effective_until, commandID) => {
        const tag = `[isSafe cmd:${commandID}]`;
        const SAFE = { status: 'safe', matchedSpeed: null, conflictingUnits: [], csModifiers: [] };
        const ERR  = { status: 'safe', matchedSpeed: null, conflictingUnits: [], csModifiers: [] };
        try {
            console.log(`%c${tag} ── START ──────────────────────────────`, 'color:cyan');
            console.log(`${tag} defenderID=${defenderID} attackerID=${attackerID}`);
            console.log(`${tag} arrival_at=${arrival_at} cap_effective_until=${cap_effective_until}`);

            // Step 1: town data
            const res  = await fetch(`${NOTIF_API_BASE}/towns/${attackerID}/${defenderID}`);
            const data = await res.json();
            if (!data.ok) { console.warn(`${tag} Server error: ${data.error}`); return ERR; }
            if (data.town1.offset_x === null || data.town2.offset_x === null) {
                console.warn(`${tag} Missing offsets — town1.offset_x=${data.town1.offset_x} town2.offset_x=${data.town2.offset_x}`);
                return ERR;
            }
            console.log(`${tag} town1: ${JSON.stringify(data.town1)}`);
            console.log(`${tag} town2: ${JSON.stringify(data.town2)}`);

            // Step 2: distance
            const coords = (t) => ({
                x: t.island_x * 128 + t.offset_x,
                y: t.island_y * 128 + (t.island_x % 2 === 1 ? 64 : 0) + t.offset_y,
            });
            const c1 = coords(data.town1), c2 = coords(data.town2);
            console.log(`${tag} c1=(${c1.x}, ${c1.y})  c2=(${c2.x}, ${c2.y})`);
            const dx = c1.x - c2.x, dy = c1.y - c2.y;
            const distance = parseFloat(Math.sqrt(dx * dx + dy * dy).toFixed(14));
            console.log(`${tag} dx=${dx} dy=${dy} distance=${distance}`);

            // Step 3: world speed
            const world_speed = uw.Game.game_speed || 1;
            const overhead    = 900 / world_speed;
            console.log(`${tag} world_speed=${world_speed} overhead=${overhead}`);

            // Step 4: load tables
            const csTable          = await notifLoadCsSpeeds();
            const conflictingTable = await notifLoadConflictingSpeeds();
            if (!csTable) { console.warn(`${tag} CS table unavailable`); return ERR; }
            console.log(`${tag} CS table has ${csTable.length} entries`);

            // Step 5: log first 3 speeds for debugging
            for (const speed of csTable.slice(0, 3)) {
                const travel_time = Math.floor(50 * distance / speed + overhead);
                const time_10pct  = Math.floor(0.1 * travel_time);
                const started_at  = cap_effective_until - time_10pct;
                const duration    = arrival_at - started_at;
                console.log(`${tag} [debug] speed=${speed} travel_time=${travel_time}s time_10pct=${time_10pct}s started_at=${started_at} derived_duration=${duration}s diff=${duration - travel_time}s`);
            }

            // Step 6: find closest CS speed match across full table
            let matchedSpeed = null;
            let closestSpeed = null, closestTT = null, closestDur = null, closestDiff = Infinity;
            for (const speed of csTable) {
                const travel_time = Math.floor(50 * distance / speed + overhead);
                const time_10pct  = Math.floor(0.1 * travel_time);
                const started_at  = cap_effective_until - time_10pct;
                const duration    = arrival_at - started_at;
                const diff        = Math.abs(duration - travel_time);
                if (diff < closestDiff) {
                    closestDiff = diff; closestSpeed = speed; closestTT = travel_time; closestDur = duration;
                }
            }
            console.log(`${tag} closest: speed=${closestSpeed} travel_time=${closestTT}s derived_duration=${closestDur}s diff=${closestDiff}s`);

            if (closestDiff <= 11) {
                matchedSpeed = closestSpeed;
                console.log(`%c${tag} ✓ CS match — speed=${matchedSpeed} diff=${closestDiff}s`, 'color:orange');
            }
            console.log(`${tag} matchedSpeed=${matchedSpeed}`);

            // Step 7: no CS match → safe
            if (matchedSpeed === null) {
                console.log(`%c${tag} → SAFE (no CS match)`, 'color:lime');
                console.log(`%c${tag} ── END ────────────────────────────────`, 'color:cyan');
                return SAFE;
            }

            // Step 8: check conflicting units — use ±11s travel_time tolerance, not exact speed match
            const sameIsland = data.town1.island_x === data.town2.island_x && data.town1.island_y === data.town2.island_y;
            console.log(`${tag} sameIsland=${sameIsland}`);

            const csMatchTT = Math.floor(50 * distance / matchedSpeed + overhead);
            const conflictingUnits = [];
            const conflictingModifiers = {}; // { prettyName: [combo, ...] }
            if (conflictingTable) {
                for (const [unit, speeds] of Object.entries(conflictingTable)) {
                    // If different islands, skip land units — only naval can attack across sea
                    if (!sameIsland && !NAVAL_UNITS.has(unit)) continue;
                    const hasOverlap = speeds.some(s => {
                        const tt = Math.floor(50 * distance / s + overhead);
                        return Math.abs(tt - csMatchTT) <= 11;
                    });
                    if (hasOverlap) {
                        const pretty = UNIT_PRETTY[unit] || unit;
                        conflictingUnits.push(pretty);
                        conflictingModifiers[pretty] = notifComputeUnitModifiers(unit, csMatchTT, distance, overhead);
                    }
                }
            }
            console.log(`${tag} conflictingUnits (±11s): [${conflictingUnits.join(', ')}]`);

            // Step 9: compute CS modifier combos using travel_time comparison
            const csModifiers = notifComputeCsModifiers(csMatchTT, distance, overhead);
            console.log(`${tag} csModifiers: ${csModifiers.length} combos`);
            csModifiers.slice(0, 5).forEach(m => console.log(`${tag}   • ${m}`));
            if (csModifiers.length > 5) console.log(`${tag}   ...and ${csModifiers.length - 5} more`);

            if (conflictingUnits.length === 0) {
                console.log(`%c${tag} → CS CONFIRMED speed=${matchedSpeed}`, 'color:red;font-weight:bold');
                console.log(`%c${tag} ── END ────────────────────────────────`, 'color:cyan');
                return { status: 'cs', matchedSpeed, conflictingUnits: [], conflictingModifiers: {}, csModifiers };
            } else {
                console.log(`%c${tag} → POSSIBLE CS — also matches: ${conflictingUnits.join(', ')}`, 'color:yellow;font-weight:bold');
                console.log(`%c${tag} ── END ────────────────────────────────`, 'color:cyan');
                return { status: 'possible_cs', matchedSpeed, conflictingUnits, conflictingModifiers, csModifiers };
            }

        } catch (e) {
            console.error(`${tag} EXCEPTION:`, e);
            return ERR;
        }
    };

    // ── notifBuildData ────────────────────────────────────────────────────────
    const notifBuildData = async (attr, fetchName = true) => {
        const offset      = notifGetTimeOffset();
        const arrivalTime = notifGetArrivalTime(attr.arrival_at + offset);
        const cap         = attr.cap_of_invisibility_effective_until;

        console.log(`[notifBuildData] cmd=${attr.command_id ?? attr.id} arrival_at=${attr.arrival_at} cap=${cap}`);

        const csResult = await notifIsSafe(
            attr.target_town_id,
            attr.home_town_id,
            attr.arrival_at,
            cap,
            attr.command_id ?? attr.id,
        );

        let attackerName = attr.town_name_origin ?? 'Unknown';
        let allianceName = null;
        if (fetchName && !botcheck()) {
            try {
                const info   = await notifFindAttackerName(attr.home_town_id);
                attackerName = info.player_name;
                allianceName = info.alliance_name;
            } catch {}
        }

        const tz   = uw.MM.getModels()?.PlayerSettings?.[uw.Game.player_id]?.attributes?.timezone ?? 'UTC';
        const sign = offset >= 0 ? '+' : '-';

        return {
            attackerName,
            allianceName,
            fromName        : attr.town_name_origin,
            fromID          : attr.home_town_id,
            toName          : attr.town_name_destination,
            toID            : attr.target_town_id,
            timezone        : tz,
            tzLabel         : `UTC${sign}${Math.abs(offset / 3600)}:00 ${tz}`,
            arrivalTime,
            attackID        : attr.id,
            csStatus         : csResult.status,           // 'safe' | 'cs' | 'possible_cs'
            csMatchedSpeed   : csResult.matchedSpeed,
            csConflicting    : csResult.conflictingUnits,  // ['Hoplite', ...]
            csConflictingMods: csResult.conflictingModifiers || {}, // { 'Hoplite': ['No modifiers', ...] }
            csModifiers      : csResult.csModifiers,       // ['Cartography | Boots | 3 Sirens', ...]
        };
    };

    const notifSendDiscord = (data) => {
    let status = data.csStatus;

    // Downgrade possible_cs to safe if possibleCsEnabled is off
    if (status === 'possible_cs' && !NOTIF_CONFIG.possibleCsEnabled) {
        status = 'safe';
    }

    const isCS       = status === 'cs';
    const isPossible = status === 'possible_cs';
    const isAttack   = status === 'safe';

    if (isCS     && !NOTIF_CONFIG.csEnabled)     return;
    if (isAttack && !NOTIF_CONFIG.attackEnabled) return;

    const webhook = isCS       ? (NOTIF_CONFIG.csWebhook        || NOTIF_CONFIG.attackWebhook)
                  : isPossible ? (NOTIF_CONFIG.possibleCsWebhook || NOTIF_CONFIG.csWebhook || NOTIF_CONFIG.attackWebhook)
                  :               NOTIF_CONFIG.attackWebhook;

        const worldID    = uw.Game.world_id;
        const playerName = uw.Game.player_name;

        // ── Embed header & color per status ──
        const authorName = isCS
            ? '🚨 CS INCOMING — COLONIZATION ATTACK 🚨'
            : isPossible
                ? '⚠️ POSSIBLE CS — VERIFY INTEL ⚠️'
                : '⚔️ INCOMING ATTACK ⚔️';
        const color = isCS ? 0xff0000 : isPossible ? 0xff8c00 : 0x00ffff;

        // ── Status field value ──
        let statusValue;
        if (isCS) {
            statusValue = '**🚨🚨 COLONIZATION SHIP DETECTED 🚨🚨**';
        } else if (isPossible) {
            const units = data.csConflicting.join(' or ');
            statusValue = `**⚠️ Could be CS or ${units}**`;
        } else {
            statusValue = '✅ Safe (no CS detected)';
        }

        // ── CS modifier field — only for cs / possible_cs ──
        const modifierFields = [];
        if (isCS || isPossible) {
            if (data.csModifiers?.length) {
                const lines = compressModifiers(data.csModifiers);
                modifierFields.push({
                    name  : '⚙️ Colonize Ship Could Be From:',
                    value : lines.map((m, i) => `${i + 1}. ${m}`).join('\n'),
                    inline: false,
                });
            }
            if (isPossible && data.csConflictingMods) {
                for (const [unit, mods] of Object.entries(data.csConflictingMods)) {
                    if (!mods?.length) continue;
                    const lines = compressModifiers(mods);
                    modifierFields.push({
                        name  : `⚙️ ${unit} Could Be From:`,
                        value : lines.map((m, i) => `${i + 1}. ${m}`).join('\n'),
                        inline: false,
                    });
                }
            }
        }

        // ── Alliance field — only when available ──
        const allianceField = data.allianceName ? [{
            name  : '🚩 Attacker Alliance',
            value : data.allianceName,
            inline: true,
        }] : [];

        const payload = {
            content: '@everyone',
            embeds: [{
                author: { name: authorName },
                fields: [
                    { name: '🕐 Arrival Time',   value: `\`${data.arrivalTime}\` (${data.tzLabel})`,         inline: false },
                    { name: '🛡️ Defender',       value: playerName,                                          inline: true  },
                    { name: '🏛️ Defending City', value: `${data.toName}\n\`[town]${data.toID}[/town]\``,     inline: true  },
                    { name: '\u200b',            value: '\u200b',                                            inline: true  },
                    { name: '⚔️ Attacker',       value: data.attackerName,                                   inline: true  },
                    ...allianceField,
                    { name: '🏛️ Attacking City', value: `${data.fromName}\n\`[town]${data.fromID}[/town]\``, inline: true  },
                    { name: '\u200b',            value: '\u200b',                                            inline: true  },
                    { name: '🔍 Status',         value: statusValue,                                         inline: false },
                    ...modifierFields,
                ],
                color,
                footer: { text: `World: ${worldID} | Detected at: ${notifGetTimeNow()}` },
            }],
        };

        fetch(webhook, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify(payload),
        })
        .then(r => r.ok
            ? console.log('[AttackNotif] Alert sent.')
            : console.warn('[AttackNotif] Webhook error:', r.status)
        )
        .catch(e => console.error('[AttackNotif] Fetch error:', e));
    };

    const notifGetSeenIDs = () => {
        try { return new Set(JSON.parse(localStorage.getItem('notif_seenAttacks')) ?? []); }
        catch { return new Set(); }
    };

    const notifMarkSeen = (id) => {
        const seen = notifGetSeenIDs();
        seen.add(id);
        localStorage.setItem('notif_seenAttacks', JSON.stringify([...seen].slice(-500)));
    };

    const notifCleanSeenIDs = () => {
    const movements = uw.MM.getModels().MovementsUnits;
    if (!movements) return;
    const activeIds = new Set(
        Object.values(movements)
            .map(m => m?.attributes?.id)
            .filter(Boolean)
    );
    const seen    = notifGetSeenIDs();
    const cleaned = new Set([...seen].filter(id => activeIds.has(id)));
    localStorage.setItem('notif_seenAttacks', JSON.stringify([...cleaned]));
    console.log(`[AttackNotif] Cleaned seenAttacks: ${seen.size} → ${cleaned.size}`);
};

    const notifProcessExisting = async () => {
        const movements = uw.MM.getModels().MovementsUnits;
        if (!movements) return;
        for (const key in movements) {
            const attr = movements[key]?.attributes;
            if (!attr || attr.type !== 'attack') continue;
            if (notifGetSeenIDs().has(attr.id))  continue;
            notifMarkSeen(attr.id);
            if (botcheck()) continue;
            const data = await notifBuildData(attr, false);
            notifSendDiscord(data);
            await sleep(500);
        }
    };

    const notifCreateObserver = () => {
        uw.$.Observer(uw.GameEvents.attack.incoming).subscribe(async () => {
            const movements = uw.MM.getModels().MovementsUnits;
            if (!movements) return;
            for (const key in movements) {
                const attr = movements[key]?.attributes;
                if (!attr || attr.type !== 'attack') continue;
                if (notifGetSeenIDs().has(attr.id)) continue;
                notifMarkSeen(attr.id);
                if (botcheck()) continue;
                const data = await notifBuildData(attr, true);
                notifSendDiscord(data);
            }
        });
    };

    const notifInit = async () => {
    await sleep(8000);
    await notifLoadCsSpeeds();
    await notifProcessExisting();
    notifCreateObserver();
    setInterval(notifCleanSeenIDs, 10 * 60 * 1000); // clean every 10 min
    console.log('%c[AttackNotif] Running ✓', 'color: lime; font-weight: bold;');
};

    // ══════════════════════════════════════════════════════════════
    //  GAME LOAD — wire everything up
    // ══════════════════════════════════════════════════════════════

    uw.$.Observer(uw.GameEvents.game.load).subscribe(() => {
       //GM_deleteValue('grp_token_gr112');
    addMasterConfigButton();
    notifInit();
    setTimeout(async () => {
        updateCycleDelaysBasedOnSpeed();
        updateFestivalEligibleTowns();
        alPushData().catch(() => {});
        masterLoop();
        masterHideTradeLoop();
        masterAutoTroopLoop();
        if (FARM_CONFIG.useFarm)         runFarmCollector();
        if (FARM_CONFIG.upgradeVillages) runVillageUpgrader();
        runAutoCultureLoop();
        startSleepSchedule();
        startAutoReload();
        reqFetch();
        setInterval(reqFetch, 60 * 1000);
        setTimeout(navPrefetchCoords, 5000);
        setInterval(navWatchTowns, 8 * 60 * 60 * 1000);
        setInterval(alPushStatus, 60 * 1000);
    }, 20000);
});
console.log('[Grepolis Master v7.5 — AutoBuild + AutoResearch + AutoHide + AutoFarm + AutoTroop] Loaded ✓');
})()
})()
