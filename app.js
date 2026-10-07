/* Piggy – paste bank SMS, get an organised UPI diary. All data lives in localStorage. */
(function () {
  const { parseMany, CAT_ICON, DEBIT_CATS, CREDIT_CATS } = Parser;
  const KEY = 'piggy.v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let state = load();
  let drafts = [];
  const view = { period: null, account: 'all', type: 'all', q: '', editing: null };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.txns)) return s;
    } catch (e) { /* private mode or corrupt data: start fresh */ }
    return { txns: [], seq: 0 };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save – is browser storage blocked?'); }
  }

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

  /* ---------- paste / preview ---------- */
  function readBlob() {
    const text = $('blob').value.trim();
    if (!text) { toast('Paste a message first 💌'); return; }
    const parsed = parseMany(text).map((p) => ({ ...p, keep: true, dateGuessed: !p.date }));
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
    drafts.push({ type: 'debit', amount: null, party: '', vpa: null, date: today(), time: '', account: 'unknown', accountLabel: 'Unknown account', balance: null, ref: null, category: 'Other', note: '', raw: '', complete: false, keep: true, manual: true });
    renderPreview();
  }

  function renderPreview() {
    const box = $('preview');
    if (!drafts.length) { box.innerHTML = ''; return; }
    const known = [...new Set(state.txns.map((t) => t.accountLabel))];
    const ready = drafts.filter((d) => d.keep).length;
    box.innerHTML = `<div class="pv-head"><span>I found ${drafts.length} message${drafts.length > 1 ? 's' : ''} 🔍 — check and add a note if you like</span>
      <span><button class="btn ghost" data-act="cancel">Clear</button> <button class="btn mint" data-act="commit">Save ${ready} 💖</button></span></div>` +
      drafts.map((d, i) => {
        const cats = d.type === 'credit' ? CREDIT_CATS : DEBIT_CATS;
        const tags = [
          d.dup ? '<span class="tag warn">Already saved 🔁</span>' : '',
          d.unreadable ? '<span class="tag err">Couldn’t read this one – fill it in</span>' : '',
          !d.unreadable && !d.manual && d.amount == null ? '<span class="tag err">No amount found</span>' : '',
          d.dateGuessed && !d.unreadable && !d.manual ? '<span class="tag warn">No date – using today</span>' : '',
          d.balance != null ? `<span class="tag">Balance ${money(d.balance)}</span>` : '',
        ].join(' ');
        return `<div class="pv ${d.dup ? 'dup' : ''} ${d.keep && !(d.amount > 0) ? 'bad' : ''}" data-i="${i}">
          <div class="pv-top"><input type="checkbox" data-f="keep" ${d.keep ? 'checked' : ''} aria-label="Save this one">
            <div class="seg" role="group" aria-label="Type"><button data-type="debit" class="${d.type === 'debit' ? 'on debit' : ''}">Paid</button><button data-type="credit" class="${d.type === 'credit' ? 'on credit' : ''}">Received</button></div>
            <span>${tags}</span></div>
          <div class="grid">
            <label>Amount ₹<input data-f="amount" type="number" inputmode="decimal" min="0" step="0.01" value="${d.amount ?? ''}"></label>
            <label>${d.type === 'credit' ? 'From' : 'To'}<input data-f="party" value="${esc(d.party)}" placeholder="Name or UPI id"></label>
            <label>Date<input data-f="date" type="date" value="${esc(d.date || today())}"></label>
            <label>Account<input data-f="accountLabel" list="acctList" value="${esc(d.accountLabel)}"></label>
            <label>Category<select data-f="category">${cats.map((c) => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            <label>Balance after (optional)<input data-f="balance" type="number" inputmode="decimal" step="0.01" value="${d.balance ?? ''}"></label>
            <label class="full">Note 📝<input data-f="note" value="${esc(d.note)}" placeholder="e.g. birthday gift, split with Rahul…"></label>
          </div>
          ${d.raw ? `<details class="raw"><summary>Original message</summary><p>${esc(d.raw)}</p></details>` : ''}
        </div>`;
      }).join('') + `<datalist id="acctList">${known.map((k) => `<option value="${esc(k)}">`).join('')}</datalist>`;
  }

  function commit() {
    let saved = 0, skipped = 0;
    drafts.forEach((d) => {
      if (!d.keep) return;
      if (!(d.amount > 0)) { skipped++; return; }
      const label = (d.accountLabel || '').trim() || 'Unknown account';
      state.txns.push({
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        seq: ++state.seq, type: d.type, amount: Number(d.amount), party: (d.party || '').trim(), vpa: d.vpa || null,
        date: d.date || today(), time: d.time || '', account: label, accountLabel: label,
        balance: d.balance === '' || d.balance == null ? null : Number(d.balance),
        ref: d.ref || null, category: d.category, note: (d.note || '').trim(), raw: d.raw,
      });
      saved++;
    });
    if (!saved && skipped) { toast('Add an amount first 🙈'); renderPreview(); return; }
    if (!saved) { toast('Nothing ticked to save'); return; }
    save();
    drafts = []; $('blob').value = ''; renderPreview();
    view.period = null; // jump to the newest month
    render();
    toast(`Saved ${saved} transaction${saved > 1 ? 's' : ''} 🎉${skipped ? ` (${skipped} skipped – no amount)` : ''}`);
  }

  /* ---------- derived data ---------- */
  function accounts() {
    const map = new Map();
    state.txns.forEach((t) => {
      const a = map.get(t.account) || { key: t.account, label: t.accountLabel, count: 0, last: null };
      a.count++;
      if (t.balance != null && (!a.last || sortKey(t) > sortKey(a.last))) a.last = t;
      map.set(t.account, a);
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
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
    const known = accts.filter((a) => a.last);
    const el = $('hero');
    if (!state.txns.length) {
      el.innerHTML = '<small>Your balance</small><div class="big">₹0</div><div class="sub">Paste your first bank message below and I’ll start counting 🐷</div>';
      return;
    }
    if (known.length) {
      const total = known.reduce((s, a) => s + a.last.balance, 0);
      const latest = known.map((a) => a.last).sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))[0];
      el.innerHTML = `<small>Money in the bank</small><div class="big">${money(total)}</div>
        <div class="sub">across ${known.length} account${known.length > 1 ? 's' : ''} · latest message ${esc(dayName(latest.date).toLowerCase())}</div>`;
    } else {
      const net = state.txns.reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0);
      el.innerHTML = `<small>Net so far</small><div class="big">${net < 0 ? '−' : ''}${money(Math.abs(net))}</div>
        <div class="sub">None of your messages had a balance. Paste ones that say “Avl Bal” and I’ll show your real balance.</div>`;
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
    $('accountsCard').hidden = !accts.length;
    $('accounts').innerHTML = accts.map((a) => `<div class="acct" data-acct="${esc(a.key)}" role="button" tabindex="0" title="Show only this account">
      <b>${esc(a.label)}</b><div class="amt">${a.last ? money(a.last.balance) : '—'}</div>
      <small>${a.last ? 'as of ' + esc(dayName(a.last.date)) : 'no balance in messages'} · ${a.count} txn${a.count > 1 ? 's' : ''}</small></div>`).join('');
  }

  function renderCats(sc) {
    const spent = {};
    sc.filter((t) => t.type === 'debit').forEach((t) => { spent[t.category] = (spent[t.category] || 0) + t.amount; });
    const rows = Object.entries(spent).sort((a, b) => b[1] - a[1]);
    $('catCard').hidden = !rows.length;
    const total = rows.reduce((s, r) => s + r[1], 0) || 1;
    $('cats').innerHTML = rows.map(([c, v]) => `<div class="cat"><span>${CAT_ICON[c] || '✨'}</span>
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
        ? '<div class="empty"><span class="em">🔎</span>Nothing matches these filters</div>'
        : '<div class="empty"><span class="em">🌱</span>No transactions yet.<br>Paste a bank message above to plant the first one!</div>';
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
      <div class="ico">${CAT_ICON[t.category] || '✨'}</div>
      <div style="min-width:0"><div class="who">${esc(t.party || (t.type === 'credit' ? 'Money received' : 'Payment'))}</div>
        <div class="meta">${esc(t.category)} · ${esc(t.accountLabel)}${t.time ? ' · ' + esc(t.time) : ''}</div></div>
      <div class="amt">${signed(t)}</div>
      ${editing ? `<div style="grid-column:2/-1"><input data-note value="${esc(t.note)}" placeholder="Write a note, press Enter to save" maxlength="200"></div>`
        : t.note ? `<div class="note">📝 ${esc(t.note)}</div>` : ''}
      <div class="tx-actions"><button data-act="note">${t.note ? 'Edit note' : '+ Note'}</button>
        <button data-act="cat">Category</button><button data-act="del">Delete</button></div></div>`;
  }

  /* ---------- events ---------- */
  $('btnRead').onclick = readBlob;
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
    else { d[f] = e.target.value; if (f === 'accountLabel') d.account = e.target.value.trim() || 'Unknown account'; if (f === 'date') d.dateGuessed = false; }
    d.dup = state.txns.some((t) => sameTxn(t, { ...d, account: d.account }));
    renderPreview();
  });

  const refilter = () => { view.period = $('fPeriod').value; view.account = $('fAccount').value; view.type = $('fType').value; render(); };
  ['fPeriod', 'fAccount', 'fType'].forEach((id) => $(id).addEventListener('change', refilter));
  $('fSearch').addEventListener('input', (e) => { view.q = e.target.value; renderList(scoped()); });
  const pickAccount = (el) => { const a = el.closest('[data-acct]'); if (a) { view.account = view.account === a.dataset.acct ? 'all' : a.dataset.acct; render(); } };
  $('accounts').addEventListener('click', (e) => pickAccount(e.target));
  $('accounts').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickAccount(e.target); } });

  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const row = btn.closest('.tx'), t = state.txns.find((x) => x.id === row.dataset.id); if (!t) return;
    if (btn.dataset.act === 'note') { view.editing = view.editing === t.id ? null : t.id; renderList(scoped()); }
    if (btn.dataset.act === 'del') {
      if (!confirm(`Delete ${signed(t)} ${t.party || ''}?`)) return;
      state.txns = state.txns.filter((x) => x.id !== t.id); save(); render(); toast('Deleted 🗑️');
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
      state = { txns: s.txns, seq: s.seq || s.txns.length }; save(); view.period = null; render();
      $('dlgBackup').close(); toast('Backup restored 🎉');
    } catch (err) { toast('That doesn’t look like a Piggy backup'); }
  };
  $('btnWipe').onclick = () => {
    if (!confirm('Erase ALL saved transactions from this browser? This cannot be undone.')) return;
    state = { txns: [], seq: 0 }; save(); render(); toast('All clean ✨');
  };

  render();
})();
