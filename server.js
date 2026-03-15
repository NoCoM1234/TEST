async function alFetchAndRender() {
    const world = String(uw.Game.world_id);
    const bar   = document.getElementById('alliance-status-bar');
    try {
        const r = await fetch(`${ALLIANCE_API}/players/${world}`);
        const j = await r.json();

        if (bar) {
            bar.className   = 'alliance-status-bar connected';
            bar.textContent = `⚔️ World ${world} — ${j.players.length} player(s) online`;

            // ── Dropdown — injected once into the status bar ──────────────
            if (!document.getElementById('al-troop-mode')) {
                const sel = document.createElement('select');
                sel.id = 'al-troop-mode';
                sel.style.cssText = 'margin-left:12px;font-size:11px;padding:2px 4px;border-radius:3px;cursor:pointer;background:#f5e6c8;border:1px solid #c8a96e;color:#3a2a12;';
                sel.innerHTML = `
                    <option value="total">⚔️ Total Units</option>
                    <option value="in">🏛 In Town</option>
                    <option value="out">🚢 Outside Town</option>
                `;
                sel.addEventListener('change', () => alFetchAndRender());
                bar.appendChild(sel);
            }
        }

        const wrap = document.getElementById('alliance-table-wrap');
        if (!wrap) return;

        if (!j.players.length) {
            wrap.innerHTML = '<div style="color:#aaa;font-style:italic;font-size:12px;padding:8px">No data yet — push your data first!</div>';
            return;
        }

        const mode      = document.getElementById('al-troop-mode')?.value || 'total';
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
            try {
                const raw = mode === 'in'  ? p.troops_in
                          : mode === 'out' ? p.troops_out
                          : p.troops;
                troops = JSON.parse(raw || '{}');
            } catch(e) {}

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
