(function() {

    const API        = 'https://test-1i20.onrender.com';
    const TOKEN_KEY  = `grp_token_${uw.Game.world_id}`;
    const PARTB_KEY  = `grp_part_b_${uw.Game.world_id}`;

    function xorHex(a, b) {
        let r = '';
        for (let i = 0; i < a.length; i++)
            r += (parseInt(a[i], 16) ^ parseInt(b[i % b.length], 16)).toString(16);
        return r;
    }

    function computePartB() {
        const townIds = Object.keys(uw.ITowns.getTowns()).map(Number).sort((a,b)=>a-b).join(',');
        const raw     = `${uw.Game.player_id}:${uw.Game.world_id}:${townIds}`;
        let hash = '';
        for (let i = 0; i < 96; i++) {
            const c = raw.charCodeAt(i % raw.length) ^ (i * 31 + 7);
            hash += (c & 0xff).toString(16).padStart(2,'0').slice(-1);
        }
        return hash;
    }

    // ── Already activated — fetch Script 3 ───────────────────────────────────
async function loadMain() {
    const part_a     = GM_getValue(TOKEN_KEY, null);
    const part_b     = computePartB();
    const part_axorb = xorHex(part_a, part_b);

    try {
        const r = await fetch(`${API}/script/main`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Token': part_axorb },
            body:    JSON.stringify({
                player_id: String(uw.Game.player_id),
                world_id:  String(uw.Game.world_id),
            }),
        });
        const j = await r.json();
        if (!j.ok || !j.data) return;

        const decrypted = CryptoJS.AES.decrypt(j.data, part_axorb).toString(CryptoJS.enc.Utf8);
        if (!decrypted) {
            console.error('[loadMain] Decryption failed — key mismatch?');
            return;
        }

        GM_setValue(PARTB_KEY, part_b);
        eval(decrypted);
    } catch(e) { console.error('[loadMain] Error:', e); }
}

    // ── Not activated — scan trades ───────────────────────────────────────────
    const seenTrades = new Set();
    let scanInterval = null;

    async function scanTrade() {
        const trades = Object.values(uw.MM.getModels().Trade || {});
        for (const trade of trades) {
            const t = trade.attributes;
            if (!t || (!t.wood && !t.stone && !t.iron)) continue;
            const key = `${t.origin_town_id}_${t.wood}_${t.stone}_${t.iron}`;
            if (seenTrades.has(key)) continue;
            seenTrades.add(key);
            try {
                const part_b = computePartB();
                const r = await fetch(`${API}/auth/claim`, {
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
                const j = await r.json();
                if (j.ok && j.part_a) {
                    GM_setValue(TOKEN_KEY, j.part_a);
                    clearInterval(scanInterval);
                    setTimeout(() => location.reload(), 1000);
                    return;
                }
            } catch(e) {}
        }
    }

    // ── Entry point ───────────────────────────────────────────────────────────
    const part_a = GM_getValue(TOKEN_KEY, null);
    if (part_a) {
        loadMain();
    } else {
        scanInterval = setInterval(scanTrade, 5000);
        scanTrade();
    }

})();
