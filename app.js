/* Piggy – paste bank SMS, get an organised UPI diary. All data lives in localStorage. */
(function () {
  const { parseMany, DEBIT_CATS, CREDIT_CATS } = Parser;
  const KEY = 'piggy.v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let state = load();
  let drafts = [];
  const view = { period: null, account: 'all', type: 'all', q: '', editing: null };

  /* ---------- storage: localStorage + an IndexedDB mirror on this device ---------- */
  const DRAFT_KEY = 'piggy.draft.v1';
  function normalize(s) {
    s = s && Array.isArray(s.txns) ? s : { txns: [] };
    s.accounts = Array.isArray(s.accounts) ? s.accounts : [];
    s.seq = s.seq || s.txns.length; s.rev = s.rev || 0;
    return s;
  }
  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return normalize(null); } // private mode or corrupt data: start fresh
  }
  const idb = {
    open() {
      return new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('no idb'));
        const r = indexedDB.open('piggy', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async get(k) {
      const db = await this.open();
      return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    },
    async set(k, v) {
      const db = await this.open();
      return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
    },
  };
  function save() {
    state.rev = (state.rev || 0) + 1;
    const json = JSON.stringify(state);
    try { localStorage.setItem(KEY, json); }
    catch (e) { toast('Could not save – is browser storage blocked?'); }
    idb.set('state', json).catch(() => {});
    askPersist();
  }
  let persistAsked = false;
  function askPersist() {
    if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
    persistAsked = true;
    navigator.storage.persist().then(showStoreNote).catch(() => {});
  }
  function showStoreNote() {
    const el = $('storeNote'); if (!el) return;
    const p = navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false);
    p.then((ok) => { el.textContent = ok ? 'Saved on this device and protected from automatic clean-up.' : 'Saved on this device. Download a backup now and then to be safe.'; }).catch(() => {});
  }
  function persistDraft() {
    try {
      const blob = $('blob').value;
      if (!blob && !drafts.length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ blob, drafts }));
    } catch (e) { /* drafts are a convenience only */ }
  }
  function restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (!d) return;
      $('blob').value = d.blob || ''; drafts = Array.isArray(d.drafts) ? d.drafts : [];
      if (drafts.length) renderPreview();
    } catch (e) { /* ignore */ }
  }
  // if the browser dropped localStorage but IndexedDB survived (or the other way round), recover the newer copy
  function syncFromIdb() {
    idb.get('state').then((raw) => {
      if (!raw) { if (state.txns.length || state.accounts.length) idb.set('state', JSON.stringify(state)).catch(() => {}); return; }
      const s = normalize(JSON.parse(raw));
      if (s.rev > state.rev) { state = s; try { localStorage.setItem(KEY, raw); } catch (e) { /* ignore */ } view.period = null; render(); toast('Restored your data from this device'); }
      else if (s.rev < state.rev) idb.set('state', JSON.stringify(state)).catch(() => {});
    }).catch(() => {});
  }

  /* ---------- category icons (line icons, one accent colour each) ---------- */
  const PATHS = {
    Food: 'M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10',
    Groceries: 'M3 4h2l2.4 11h10.2L20 8H6M9 20h.01M17 20h.01',
    Travel: 'M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3h-2v-1H6v1H4zM7.5 13h.01M16.5 13h.01',
    Shopping: 'M6 8h12l1 12H5L6 8zM9 8a3 3 0 0 1 6 0',
    Bills: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
    Fun: 'M5 4h14v16H5zM10 9l5 3-5 3z',
    Health: 'M12 8v8M8 12h8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    Learning: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13',
    Rent: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
    Other: 'M5 12h.01M12 12h.01M19 12h.01',
    'Money in': 'M17 7L7 17M7 8v9h9',
    Salary: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
    Search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  };
  const COLORS = { Food: '#ea580c', Groceries: '#16a34a', Travel: '#2563eb', Shopping: '#db2777', Bills: '#ca8a04', Fun: '#7c3aed', Health: '#dc2626', Learning: '#0891b2', Rent: '#64748b', Other: '#64748b', 'Money in': '#059669', Salary: '#059669' };
  const icon = (c) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="${c === 'Other' ? 3 : 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[c] || PATHS.Other}"/></svg>`;
  const catStyle = (c) => `--c:${COLORS[c] || COLORS.Other}`;

  /* ---------- helpers ---------- */
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  const signed = (t) => (t.type === 'credit' ? '+' : '−') + money(t.amount);
  const monthOf = (d) => d.slice(0, 7);
  const monthName = (m) => new Date(m + '-01T00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const dayName = (d) => {
    if (d === today()) return 'Today';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (d === `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`) return 'Yesterday';
    return new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  const sortKey = (t) => `${t.date} ${t.time || '00:00'} ${String(t.seq).padStart(8, '0')}`;
  let toastTimer;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------- duplicates ---------- */
  function sameTxn(a, b) {
    if (a.type !== b.type || Number(a.amount) !== Number(b.amount)) return false;
    if (a.ref && b.ref) return a.ref === b.ref;
    return a.date && a.date === b.date && (a.time || '') === (b.time || '') && a.account === b.account && (a.party || '') === (b.party || '');
  }

  /* ---------- bank accounts ---------- */
  const UNKNOWN = 'Unknown account';
  const acctKey = (bank, last4) => (last4 ? `${bank || 'Bank'} ••${last4}` : bank);
  const last4Of = (label) => ((/••(\d{3,4})/.exec(label || '') || [])[1]) || null;
  function matchAccount(d) { // map a parsed "HDFC ••1234" onto a saved account with the same trailing digits
    const l = last4Of(d.accountLabel);
    if (!l) return null;
    return state.accounts.find((x) => x.last4 && (x.last4.endsWith(l) || l.endsWith(x.last4))) || null;
  }
  function defaultAccount() {
    const keys = state.accounts.map((x) => x.key);
    if (state.lastAccount && (keys.includes(state.lastAccount) || state.txns.some((t) => t.account === state.lastAccount))) return state.lastAccount;
    return keys.length === 1 ? keys[0] : UNKNOWN;
  }
  function applyAccount(d) {
    const m = matchAccount(d);
    if (m) d.accountLabel = m.key;
    else if (d.accountLabel === UNKNOWN || !d.accountLabel) d.accountLabel = defaultAccount();
    d.account = d.accountLabel;
  }
  function allAccountKeys(extra) {
    return [...new Set([...state.accounts.map((x) => x.key), ...state.txns.map((t) => t.account), extra].filter(Boolean))];
  }

  /* ---------- paste / preview ---------- */
  function readBlob() {
    const text = $('blob').value.trim();
    if (!text) { toast('Paste a message first'); return; }
    const parsed = parseMany(text).map((p) => ({ ...p, keep: true, dateGuessed: !p.date }));
    parsed.forEach(applyAccount);
    const seen = [];
    parsed.forEach((d) => {
      d.dup = state.txns.some((t) => sameTxn(t, d)) || seen.some((s) => sameTxn(s, d));
      if (d.dup || !d.complete) d.keep = false;
      seen.push(d);
    });
    drafts = parsed;
    renderPreview();
  }

  function addBlank() {
    drafts.push({ type: 'debit', amount: null, party: '', vpa: null, date: today(), time: '', account: defaultAccount(), accountLabel: defaultAccount(), balance: null, ref: null, category: 'Other', note: '', raw: '', complete: false, keep: true, manual: true });
    renderPreview();
  }

  function renderPreview() {
    const box = $('preview');
    if (!drafts.length) { box.innerHTML = ''; persistDraft(); return; }
    const ready = drafts.filter((d) => d.keep).length;
    box.innerHTML = `<div class="pv-head"><span>${drafts.length} message${drafts.length > 1 ? 's' : ''} found — review, add a note if you like</span></div>` +
      drafts.map((d, i) => {
        const cats = d.type === 'credit' ? CREDIT_CATS : DEBIT_CATS;
        const tags = [
          d.dup ? '<span class="tag warn">Already saved</span>' : '',
          d.unreadable ? '<span class="tag err">Couldn’t read this one – fill it in</span>' : '',
          !d.unreadable && !d.manual && d.amount == null ? '<span class="tag err">No amount found</span>' : '',
          d.dateGuessed && !d.unreadable && !d.manual ? '<span class="tag warn">No date – using today</span>' : '',
          d.balance != null ? `<span class="tag">Balance ${money(d.balance)}</span>` : '',
        ].join(' ');
        return `<div class="pv ${d.dup ? 'dup' : ''} ${d.keep && !(d.amount > 0) ? 'bad' : ''}" data-i="${i}">
          <div class="pv-top"><input type="checkbox" data-f="keep" ${d.keep ? 'checked' : ''} aria-label="Save this one">
            <div class="seg" role="group" aria-label="Type"><button data-type="debit" class="${d.type === 'debit' ? 'on debit' : ''}">Paid</button><button data-type="credit" class="${d.type === 'credit' ? 'on credit' : ''}">Received</button></div>
            <span class="tags">${tags}</span></div>
          <div class="grid">
            <label>Amount ₹<input data-f="amount" type="number" inputmode="decimal" min="0" step="0.01" value="${d.amount ?? ''}"></label>
            <label>${d.type === 'credit' ? 'From' : 'To'}<input data-f="party" value="${esc(d.party)}" placeholder="Name or UPI id"></label>
            <label>Date<input data-f="date" type="date" value="${esc(d.date || today())}"></label>
            <label>Account<select data-f="accountLabel">${allAccountKeys(d.accountLabel).map((k) => `<option value="${esc(k)}" ${k === d.accountLabel ? 'selected' : ''}>${esc(k)}</option>`).join('')}<option value="__new">+ Add bank account…</option></select></label>
            <label>Category<select data-f="category">${cats.map((c) => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            <label>Balance after (optional)<input data-f="balance" type="number" inputmode="decimal" step="0.01" value="${d.balance ?? ''}"></label>
            <label class="full">Note<input data-f="note" value="${esc(d.note)}" placeholder="e.g. birthday gift, split with Rahul…"></label>
          </div>
          ${d.raw ? `<details class="raw"><summary>Original message</summary><p>${esc(d.raw)}</p></details>` : ''}
        </div>`;
      }).join('') + `<div class="pv-bar"><button class="btn ghost" data-act="cancel">Clear</button><button class="btn primary" data-act="commit">Save ${ready} transaction${ready === 1 ? '' : 's'}</button></div>`;
    persistDraft();
  }

  function commit() {
    let saved = 0, skipped = 0;
    drafts.forEach((d) => {
      if (!d.keep) return;
      if (!(d.amount > 0)) { skipped++; return; }
      const label = (d.accountLabel || '').trim() || UNKNOWN;
      state.txns.push({
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        seq: ++state.seq, type: d.type, amount: Number(d.amount), party: (d.party || '').trim(), vpa: d.vpa || null,
        date: d.date || today(), time: d.time || '', account: label, accountLabel: label,
        balance: d.balance === '' || d.balance == null ? null : Number(d.balance),
        ref: d.ref || null, category: d.category, note: (d.note || '').trim(), raw: d.raw,
      });
      saved++;
    });
    if (!saved && skipped) { toast('Add an amount first'); renderPreview(); return; }
    if (!saved) { toast('Nothing ticked to save'); return; }
    const lastSaved = drafts.filter((d) => d.keep && d.amount > 0).pop();
    if (lastSaved && lastSaved.accountLabel !== UNKNOWN) state.lastAccount = lastSaved.accountLabel;
    save();
    drafts = []; $('blob').value = ''; renderPreview();
    view.period = null; // jump to the newest month
    render();
    toast(`Saved ${saved} transaction${saved > 1 ? 's' : ''}${skipped ? ` (${skipped} skipped – no amount)` : ''}. Paste the next one anytime.`);
    $('pasteCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- derived data ---------- */
  function balanceOf(key, acct) {
    const mine = state.txns.filter((t) => t.account === key);
    let base = null;
    mine.forEach((t) => { if (t.balance != null && (!base || sortKey(t) > sortKey(base))) base = t; });
    const op = acct && acct.opening;
    const opKey = op ? `${op.date} 23:59 ${String(op.seq).padStart(8, '0')}` : '';
    if (op && (!base || opKey >= sortKey(base))) { // a balance typed in by hand is the newest anchor
      const adj = mine.filter((t) => t.balance == null && t.date >= op.date && t.seq > op.seq).reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0);
      return { bal: op.amount + adj, asOf: op.date, source: 'entered' };
    }
    if (base) {
      const bk = sortKey(base);
      const adj = mine.filter((t) => t.balance == null && sortKey(t) > bk).reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0);
      return { bal: base.balance + adj, asOf: base.date, source: 'sms' };
    }
    return { bal: null, asOf: null, source: null };
  }
  function accounts() {
    return allAccountKeys().map((key) => {
      const acct = state.accounts.find((x) => x.key === key) || null;
      return { key, label: key, acct, count: state.txns.filter((t) => t.account === key).length, ...balanceOf(key, acct) };
    }).sort((x, y) => x.label.localeCompare(y.label));
  }
  const months = () => [...new Set(state.txns.map((t) => monthOf(t.date)))].sort().reverse();
  function scoped() {
    return state.txns.filter((t) => (view.period === 'all' || monthOf(t.date) === view.period) && (view.account === 'all' || t.account === view.account));
  }

  /* ---------- render ---------- */
  function render() {
    const ms = months();
    if (!view.period || (view.period !== 'all' && !ms.includes(view.period))) view.period = ms[0] || 'all';
    const accts = accounts();
    if (view.account !== 'all' && !accts.some((a) => a.key === view.account)) view.account = 'all';
    renderHero(accts); renderFilters(ms, accts);
    const sc = scoped();
    renderStats(sc); renderAccounts(accts); renderCats(sc); renderList(sc);
  }

  function renderHero(accts) {
    const known = accts.filter((x) => x.bal != null);
    const el = $('hero');
    if (!state.txns.length && !known.length) {
      el.innerHTML = '<small>Total balance</small><div class="big">₹0</div><div class="sub">Add a bank account or paste your first bank message to get started.</div>';
      return;
    }
    if (known.length) {
      const total = known.reduce((s, x) => s + x.bal, 0);
      const latest = known.map((x) => x.asOf).sort().pop();
      el.innerHTML = `<small>Total balance</small><div class="big">${total < 0 ? '−' : ''}${money(Math.abs(total))}</div>
        <div class="sub">across ${known.length} account${known.length > 1 ? 's' : ''} · updated ${esc(dayName(latest).toLowerCase())}</div>`;
    } else {
      const net = state.txns.reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0);
      el.innerHTML = `<small>Net so far</small><div class="big">${net < 0 ? '−' : ''}${money(Math.abs(net))}</div>
        <div class="sub">No balance yet. Add your bank account with its current balance, or paste messages that say “Avl Bal”.</div>`;
    }
  }

  function renderStats(sc) {
    const out = sc.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
    const inn = sc.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
    $('stats').innerHTML = `<div class="stat out"><small>Spent</small><b>${money(out)}</b></div>
      <div class="stat in"><small>Received</small><b>${money(inn)}</b></div>
      <div class="stat"><small>Transactions</small><b>${sc.length}</b></div>`;
  }

  function renderAccounts(accts) {
    $('accounts').innerHTML = accts.length ? accts.map((x) => `<div class="acct${view.account === x.key ? ' on' : ''}" data-acct="${esc(x.key)}" role="button" tabindex="0" title="Show only this account">
      <b>${esc(x.label)}</b><div class="amt">${x.bal != null ? (x.bal < 0 ? '−' : '') + money(Math.abs(x.bal)) : '—'}</div>
      <small>${x.bal != null ? (x.source === 'entered' ? 'balance you entered' : 'from your messages') + ' · ' + esc(dayName(x.asOf)) : 'no balance yet'} · ${x.count} txn${x.count === 1 ? '' : 's'}</small>
      ${x.acct ? `<button class="mini" data-edit="${esc(x.key)}">Edit</button>` : `<button class="mini" data-save-acct="${esc(x.key)}">Save as account</button>`}</div>`).join('')
      : '<p class="hint">No accounts yet. Add your bank account so balances can be tracked.</p>';
  }

  function renderCats(sc) {
    const spent = {};
    sc.filter((t) => t.type === 'debit').forEach((t) => { spent[t.category] = (spent[t.category] || 0) + t.amount; });
    const rows = Object.entries(spent).sort((a, b) => b[1] - a[1]);
    $('catCard').hidden = !rows.length;
    const total = rows.reduce((s, r) => s + r[1], 0) || 1;
    $('cats').innerHTML = rows.map(([c, v]) => `<div class="cat"><span class="ico sm" style="${catStyle(c)}">${icon(c)}</span>
      <div><div class="nm">${esc(c)} <small style="color:var(--muted)">${Math.round((v / total) * 100)}%</small></div><div class="bar"><i style="width:${(v / total) * 100}%"></i></div></div>
      <span class="v">${money(v)}</span></div>`).join('');
  }

  function renderFilters(ms, accts) {
    $('fPeriod').innerHTML = ms.map((m) => `<option value="${m}">${monthName(m)}</option>`).join('') + '<option value="all">All time</option>';
    $('fPeriod').value = view.period;
    $('fAccount').innerHTML = '<option value="all">All accounts</option>' + accts.map((a) => `<option value="${esc(a.key)}">${esc(a.label)}</option>`).join('');
    $('fAccount').value = view.account;
    $('fType').value = view.type;
  }

  function renderList(sc) {
    const q = view.q.trim().toLowerCase();
    const rows = sc.filter((t) => (view.type === 'all' || t.type === view.type) &&
      (!q || `${t.party} ${t.note} ${t.category} ${t.amount} ${t.accountLabel}`.toLowerCase().includes(q)))
      .sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
    const el = $('list');
    if (!rows.length) {
      el.innerHTML = state.txns.length
        ? `<div class="empty"><span class="em">${icon('Search')}</span>Nothing matches these filters</div>`
        : `<div class="empty"><span class="em">${icon('Other')}</span>No transactions yet.<br>Paste a bank message above to add your first one.</div>`;
      return;
    }
    let html = '', day = null, i = 0;
    while (i < rows.length) {
      const d = rows[i].date;
      const group = []; while (i < rows.length && rows[i].date === d) group.push(rows[i++]);
      const net = group.reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0);
      html += `<div class="day"><span>${esc(dayName(d))}</span><span>${net < 0 ? '−' : '+'}${money(Math.abs(net))}</span></div>`;
      html += group.map(txHtml).join('');
    }
    el.innerHTML = html;
    const inp = el.querySelector('input[data-note]'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }

  function txHtml(t) {
    const editing = view.editing === t.id;
    return `<div class="tx ${t.type}" data-id="${t.id}">
      <div class="ico" style="${catStyle(t.type === 'credit' && t.category === 'Other' ? 'Money in' : t.category)}">${icon(t.category)}</div>
      <div style="min-width:0"><div class="who">${esc(t.party || (t.type === 'credit' ? 'Money received' : 'Payment'))}</div>
        <div class="meta">${esc(t.category)} · ${esc(t.accountLabel)}${t.time ? ' · ' + esc(t.time) : ''}</div></div>
      <div class="amt">${signed(t)}</div>
      ${editing ? `<div style="grid-column:2/-1"><input data-note value="${esc(t.note)}" placeholder="Write a note, press Enter to save" maxlength="200"></div>`
        : t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
      <div class="tx-actions"><button data-act="note">${t.note ? 'Edit note' : '+ Note'}</button>
        <button data-act="cat">Category</button><button data-act="del">Delete</button></div></div>`;
  }

  /* ---------- events ---------- */
  $('btnRead').onclick = readBlob;
  $('blob').addEventListener('input', persistDraft);
  $('btnAddAcct').onclick = () => openAcct(null, null);
  let acctEditing = null, acctForDraft = null;
  function openAcct(acct, draftIdx, prefillKey) {
    acctEditing = acct; acctForDraft = draftIdx;
    $('acctTitle').textContent = acct ? 'Edit bank account' : 'Add bank account';
    $('aBank').value = acct ? acct.bank : (prefillKey ? prefillKey.replace(/\s*••.*$/, '') : '');
    $('aLast').value = acct ? acct.last4 || '' : (prefillKey ? last4Of(prefillKey) || '' : '');
    $('aBal').value = acct && acct.opening ? acct.opening.amount : '';
    $('aDelete').hidden = !acct; $('aErr').textContent = '';
    $('dlgAcct').showModal();
  }
  $('aCancel').onclick = () => $('dlgAcct').close();
  $('aDelete').onclick = () => {
    if (!acctEditing || !confirm(`Remove ${acctEditing.key} from your accounts? Its transactions stay in your list.`)) return;
    state.accounts = state.accounts.filter((x) => x.id !== acctEditing.id); save(); $('dlgAcct').close(); render(); toast('Account removed');
  };
  $('aSave').onclick = () => {
    const bank = $('aBank').value.trim(), last4 = $('aLast').value.replace(/\D/g, '').slice(-4), balRaw = $('aBal').value;
    if (!bank) { $('aErr').textContent = 'Enter the bank name.'; return; }
    const key = acctKey(bank, last4);
    if (state.accounts.some((x) => x.key === key && (!acctEditing || x.id !== acctEditing.id))) { $('aErr').textContent = 'You already added this account.'; return; }
    const opening = balRaw === '' ? (acctEditing ? acctEditing.opening : null) : { amount: Number(balRaw), date: today(), seq: ++state.seq };
    const wasEditing = !!acctEditing;
    if (acctEditing) {
      const old = acctEditing.key;
      Object.assign(acctEditing, { bank, last4: last4 || null, key, opening });
      if (old !== key) { state.txns.forEach((t) => { if (t.account === old) { t.account = key; t.accountLabel = key; } }); if (state.lastAccount === old) state.lastAccount = key; if (view.account === old) view.account = key; }
    } else {
      state.accounts.push({ id: 'a' + Date.now().toString(36), bank, last4: last4 || null, key, opening });
      state.lastAccount = key;
      // messages already saved under this account's trailing digits now belong to it
      if (last4) state.txns.forEach((t) => { const l = last4Of(t.account); if (l && t.account !== key && (last4.endsWith(l) || l.endsWith(last4))) { t.account = key; t.accountLabel = key; } });
    }
    if (acctForDraft != null && drafts[acctForDraft]) { drafts[acctForDraft].accountLabel = key; drafts[acctForDraft].account = key; }
    save(); $('dlgAcct').close(); render(); renderPreview(); toast(wasEditing ? 'Account updated' : 'Account added');
  };
  $('btnManual').onclick = addBlank;
  $('btnDemo').onclick = () => {
    $('blob').value = 'Sent Rs.250.00 from HDFC Bank A/C *1234 to VPA swiggy@icici SWIGGY on 07/10/26. UPI Ref No 628712345678. Avl Bal Rs 12,345.67\n\n' +
      'Dear UPI user A/C X5678 debited by 120.0 on date 07Oct26 trf to RAMESH KUMAR Refno 628700000001. -SBI\n\n' +
      'Credit Alert! Rs.5,000.00 credited to HDFC Bank A/c xx1234 on 06-10-26 from VPA mom@oksbi (UPI 628799998888). Avl bal: Rs 17,345.67';
    readBlob();
  };
  $('blob').addEventListener('paste', () => setTimeout(() => { if ($('blob').value.trim() && !drafts.length) readBlob(); }, 0));

  $('preview').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (act === 'commit') return commit();
    if (act === 'cancel') { drafts = []; return renderPreview(); }
    const typeBtn = e.target.closest('[data-type]');
    if (typeBtn) {
      const d = drafts[typeBtn.closest('.pv').dataset.i];
      d.type = typeBtn.dataset.type; d.category = Parser.categorize(d.party, d.vpa, d.type);
      renderPreview();
    }
  });
  $('preview').addEventListener('change', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const d = drafts[e.target.closest('.pv').dataset.i];
    if (f === 'keep') d.keep = e.target.checked;
    else if (f === 'amount' || f === 'balance') d[f] = e.target.value === '' ? null : Number(e.target.value);
    else if (f === 'accountLabel' && e.target.value === '__new') { openAcct(null, Number(e.target.closest('.pv').dataset.i)); return renderPreview(); }
    else { d[f] = e.target.value; if (f === 'accountLabel') d.account = e.target.value; if (f === 'date') d.dateGuessed = false; }
    d.dup = state.txns.some((t) => sameTxn(t, { ...d, account: d.account }));
    renderPreview();
  });

  const refilter = () => { view.period = $('fPeriod').value; view.account = $('fAccount').value; view.type = $('fType').value; render(); };
  ['fPeriod', 'fAccount', 'fType'].forEach((id) => $(id).addEventListener('change', refilter));
  $('fSearch').addEventListener('input', (e) => { view.q = e.target.value; renderList(scoped()); });
  const pickAccount = (el) => { const a = el.closest('[data-acct]'); if (a) { view.account = view.account === a.dataset.acct ? 'all' : a.dataset.acct; render(); } };
  $('accounts').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) return openAcct(state.accounts.find((x) => x.key === ed.dataset.edit), null);
    const sv = e.target.closest('[data-save-acct]');
    if (sv) return openAcct(null, null, sv.dataset.saveAcct);
    pickAccount(e.target);
  });
  $('accounts').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickAccount(e.target); } });

  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const row = btn.closest('.tx'), t = state.txns.find((x) => x.id === row.dataset.id); if (!t) return;
    if (btn.dataset.act === 'note') { view.editing = view.editing === t.id ? null : t.id; renderList(scoped()); }
    if (btn.dataset.act === 'del') {
      if (!confirm(`Delete ${signed(t)} ${t.party || ''}?`)) return;
      state.txns = state.txns.filter((x) => x.id !== t.id); save(); render(); toast('Deleted');
    }
    if (btn.dataset.act === 'cat') {
      const cats = t.type === 'credit' ? CREDIT_CATS : DEBIT_CATS;
      const sel = document.createElement('select');
      sel.innerHTML = cats.map((c) => `<option ${c === t.category ? 'selected' : ''}>${c}</option>`).join('');
      btn.replaceWith(sel); sel.focus();
      const done = () => { t.category = sel.value; save(); render(); };
      sel.onchange = done; sel.onblur = () => render();
    }
  });
  $('list').addEventListener('keydown', (e) => {
    if (!e.target.matches('input[data-note]')) return;
    if (e.key === 'Escape') { view.editing = null; renderList(scoped()); }
    if (e.key === 'Enter') commitNote(e.target);
  });
  $('list').addEventListener('focusout', (e) => { if (e.target.matches('input[data-note]')) commitNote(e.target); });
  function commitNote(input) {
    if (view.editing == null) return;
    const t = state.txns.find((x) => x.id === view.editing);
    view.editing = null;
    if (t) { t.note = input.value.trim(); save(); }
    renderList(scoped());
  }

  /* ---------- export / backup ---------- */
  function download(name, type, content) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  $('btnExport').onclick = () => {
    if (!state.txns.length) return toast('Nothing to export yet');
    const head = ['Date', 'Time', 'Type', 'Amount', 'Party', 'Category', 'Account', 'Balance after', 'Reference', 'Note'];
    const rows = [...state.txns].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1)).map((t) =>
      [t.date, t.time, t.type === 'debit' ? 'Paid' : 'Received', t.amount, t.party, t.category, t.accountLabel, t.balance ?? '', t.ref ?? '', t.note].map(csvCell).join(','));
    download(`piggy-${today()}.csv`, 'text/csv;charset=utf-8', '﻿' + [head.join(','), ...rows].join('\r\n'));
  };
  $('btnBackup').onclick = () => $('dlgBackup').showModal();
  $('btnCloseBackup').onclick = () => $('dlgBackup').close();
  $('btnSaveJson').onclick = () => download(`piggy-backup-${today()}.json`, 'application/json', JSON.stringify(state, null, 1));
  $('fileJson').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const s = JSON.parse(await f.text());
      if (!Array.isArray(s.txns)) throw new Error('bad file');
      if (state.txns.length && !confirm(`Replace your ${state.txns.length} saved transactions with ${s.txns.length} from this backup?`)) return;
      state = normalize({ txns: s.txns, accounts: s.accounts, seq: s.seq, lastAccount: s.lastAccount, rev: state.rev }); save(); view.period = null; render();
      $('dlgBackup').close(); toast('Backup restored');
    } catch (err) { toast('That doesn’t look like a Piggy backup'); }
  };
  $('btnWipe').onclick = () => {
    if (!confirm('Erase ALL saved transactions from this browser? This cannot be undone.')) return;
    state = normalize({ txns: [], rev: state.rev }); save(); render(); toast('All data erased');
  };

  /* ---------- install as an app (PWA) ---------- */
  let installEvt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const hiddenInstall = () => { try { return localStorage.getItem('piggy.installHidden') === '1'; } catch (e) { return false; } };
  function showInstallBar() { $('installBar').hidden = standalone() || hiddenInstall(); }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; showInstallBar(); });
  window.addEventListener('appinstalled', () => { installEvt = null; $('installBar').hidden = true; toast('Piggy installed'); });
  $('btnInstall').onclick = async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('installBar').hidden = true; return; }
    $('installHow').innerHTML = isIOS
      ? 'Tap the <b>Share</b> button in Safari, then choose <b>Add to Home Screen</b>.'
      : 'Open your browser menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.';
    $('dlgInstall').showModal();
  };
  $('btnInstallClose').onclick = () => $('dlgInstall').close();
  $('btnInstallHide').onclick = () => { $('installBar').hidden = true; try { localStorage.setItem('piggy.installHidden', '1'); } catch (e) { /* ignore */ } };
  // Always offer it: the native prompt only fires in some browsers (and not at all on iPhone), so the button falls back to manual steps
  showInstallBar();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}));
  }

  render();
  restoreDraft();
  syncFromIdb();
  showStoreNote();
})();
