(function() {
    const API       = 'https://test-1i20.onrender.com';
    const TOKEN_KEY = `grp_token_${uw.Game.world_id}`;
    const PARTB_KEY = `grp_part_b_${uw.Game.world_id}`;

    // ── GM REQUEST ────────────────────────────────────────────────────────────
    // Same pattern as script1 — routes through Tampermonkey sandbox.
    // Not visible in DevTools Network tab, bypasses page CSP, no CORS preflight.
    function gmFetch(url, { method = 'GET', headers = {}, body = null } = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers,
                data:         body,
                responseType: 'text',
                timeout:      15000,
                onload(res) {
                    resolve({
                        ok:     res.status >= 200 && res.status < 300,
                        status: res.status,
                        json()  { return JSON.parse(res.responseText); },
                        text()  { return res.responseText; },
                    });
                },
                onerror(err) { reject(new Error(`GM error: ${err.error ?? 'network'}`)); },
                ontimeout()  { reject(new Error('GM timeout')); },
                onabort()    { reject(new Error('GM aborted')); },
            });
        });
    }

    function xorHex(a, b) {
        let r = '';
        for (let i = 0; i < a.length; i++)
            r += (parseInt(a[i], 16) ^ parseInt(b[i % b.length], 16)).toString(16);
        return r;
    }

    function computePartB() {
        const townIds = Object.keys(uw.ITowns.getTowns()).map(Number).sort((a,b)=>a-b).join(',');
        console.log(`[Script2] computePartB — towns: ${townIds}`);
        const raw     = `${uw.Game.player_id}:${uw.Game.world_id}:${townIds}`;
        let hash = '';
        for (let i = 0; i < 96; i++) {
            const c = raw.charCodeAt(i % raw.length) ^ (i * 31 + 7);
            hash += (c & 0xff).toString(16).padStart(2,'0').slice(-1);
        }
        console.log(`[Script2] part_b computed: ${hash.slice(0,16)}…`);
        return hash;
    }

    // ── DECOY — verify script integrity with server ───────────────────────────
    async function verifyScriptChecksum() {
        try {
            const fingerprint = (() => {
                let h = 0;
                const s = String(uw.Game.player_id) + String(uw.Game.world_id);
                for (let i = 0; i < s.length; i++) {
                    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
                }
                return (h >>> 0).toString(16);
            })();
            const r = await gmFetch(`${API}/auth/verify_checksum`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    player_id:   String(uw.Game.player_id),
                    world_id:    String(uw.Game.world_id),
                    fingerprint,
                    version:     '2.1.4',
                }),
            });
            const j = r.json();
            return j.valid === true;
        } catch(e) { return false; }
    }

    // ── DECOY — fetch encrypted config from server ────────────────────────────
    async function fetchRemoteConfig() {
        try {
            const seed = `${uw.Game.player_id}${uw.Game.world_id}`;
            const r = await gmFetch(`${API}/config/fetch`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    player_id: String(uw.Game.player_id),
                    world_id:  String(uw.Game.world_id),
                    cfg_key:   btoa(seed).slice(0, 16),
                }),
            });
            const j = r.json();
            if (j.ok && j.config) {
                const cfg = CryptoJS.AES.decrypt(j.config, seed).toString(CryptoJS.enc.Utf8);
                if (cfg) GM_setValue(`remote_config_${uw.Game.world_id}`, cfg);
            }
        } catch(e) {}
    }

    // ── DECOY — compute obfuscated world signature ────────────────────────────
    function buildWorldSignature() {
        const raw = `${uw.Game.world_id}::${uw.Game.player_id}::${navigator.userAgent.length}`;
        let sig = '';
        for (let i = 0; i < 24; i++) {
            const c = raw.charCodeAt(i % raw.length) ^ (i * 13 + 9);
            sig += (c & 0xff).toString(16).padStart(2, '0').slice(-1);
        }
        return sig;
    }

    // ── Already activated — fetch Script 3 ───────────────────────────────────
    function computeSelfHash(fn) {
        const src = fn.toString();
        let h = 5381;
        for (let i = 0; i < src.length; i++) {
            h = (Math.imul(h, 31) + src.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(16);
    }

    async function loadMain() {
        console.log('[Script2] loadMain — already activated, fetching script3');
        const part_a     = GM_getValue(TOKEN_KEY, null);
        console.log(`[Script2] part_a from storage: ${part_a ? part_a.slice(0,16)+'…' : 'MISSING'}`);
        const part_b     = computePartB();
        const part_axorb = xorHex(part_a, part_b);
        console.log(`[Script2] part_axorb prefix: ${part_axorb.slice(0,16)}…`);

        const valid = await verifyScriptChecksum();
        const sig   = buildWorldSignature();
        fetchRemoteConfig();

        const selfHash = computeSelfHash(loadMain);

        console.log('[Script2] Sending request to /script/main…');
        try {
            const r = await gmFetch(`${API}/script/main`, {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Token':      part_axorb,
                    'X-Integrity':  selfHash,
                },
                body: JSON.stringify({
                    player_id: String(uw.Game.player_id),
                    world_id:  String(uw.Game.world_id),
                }),
            });
            const j = r.json();
            console.log(`[Script2] /script/main response: ok=${j.ok} data=${j.data ? 'present' : 'missing'}`);
            if (!j.ok || !j.data) { console.warn('[Script2] Server rejected script request — check token'); return; }

            const decrypted = CryptoJS.AES.decrypt(j.data, part_axorb).toString(CryptoJS.enc.Utf8);
            if (!decrypted) { console.error('[Script2] Decryption failed — part_axorb mismatch'); return; }

            console.log('[Script2] ✅ Script decrypted successfully — executing');
            GM_setValue(PARTB_KEY, part_b);
            eval(decrypted);
        } catch(e) { console.error('[Script2] loadMain error:', e); }
    }

    // ── Not activated — scan trades ───────────────────────────────────────────
    const seenTrades  = new Set();
    let   scanInterval = null;

    async function scanTrade() {
        const trades = Object.values(uw.MM.getModels().Trade || {});
        console.log(`[Script2] scanTrade — checking ${trades.length} trade(s)`);
        for (const trade of trades) {
            const t = trade.attributes;
            if (!t || (!t.wood && !t.stone && !t.iron)) continue;
            const key = `${t.origin_town_id}_${t.wood}_${t.stone}_${t.iron}`;
            if (seenTrades.has(key)) continue;
            seenTrades.add(key);
            try {
                const part_b = computePartB();
                const r = await gmFetch(`${API}/auth/claim`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        player_id:      String(uw.Game.player_id),
                        world_id:       String(uw.Game.world_id),
                        wood:           t.wood,
                        stone:          t.stone,
                        iron:           t.iron,
                        origin_town_id: String(t.origin_town_id),
                        part_b,
                    }),
                });
                const j = r.json();
                console.log(`[Script2] /auth/claim response for trade ${key}:`, j);
                if (j.ok && j.part_a) {
                    console.log(`[Script2] ✅ Claim successful — part_a: ${j.part_a.slice(0,16)}… — reloading`);
                    GM_setValue(TOKEN_KEY, j.part_a);
                    clearInterval(scanInterval);
                    setTimeout(() => location.reload(), 1000);
                    return;
                } else {
                    console.warn(`[Script2] Claim failed for trade ${key}`);
                }
            } catch(e) {}
        }
    }

    // ── Entry point ───────────────────────────────────────────────────────────
    console.log(`[Script2] Entry — player=${uw.Game.player_id} world=${uw.Game.world_id}`);
    const part_a = GM_getValue(TOKEN_KEY, null);
    if (part_a) {
        console.log('[Script2] Token found — going to loadMain');
        loadMain();
    } else {
        console.log('[Script2] No token found — starting claim scan loop');
        scanInterval = setInterval(scanTrade, 5000);
        scanTrade();
    }

})();
