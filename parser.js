/* Reads pasted bank / UPI SMS text into transactions. No dependencies, runs in the browser and in Node. */
(function (root) {
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  const BANKS = [
    ['HDFC', /hdfc/i], ['ICICI', /icici/i], ['SBI', /\bsbi\b|state bank/i], ['Axis', /axis/i],
    ['Kotak', /kotak/i], ['PNB', /\bpnb\b|punjab national/i], ['BoB', /\bbob\b|bank of baroda/i],
    ['Canara', /canara/i], ['Union', /union bank/i], ['IDFC', /idfc/i], ['Yes Bank', /yes bank/i],
    ['IndusInd', /indusind/i], ['Federal', /federal/i], ['BoI', /bank of india|\bboi\b/i],
    ['IDBI', /idbi/i], ['Paytm Bank', /paytm payments bank/i], ['AU', /au small|\bau bank/i],
  ];

  const CATEGORIES = [
    ['Food', '🍔', /swiggy|zomato|restaurant|cafe|café|pizza|domino|mcdonald|kfc|burger|bakery|dhaba|biryani|food|eatery|starbucks|chai|juice|sweets/i],
    ['Groceries', '🛒', /bigbasket|blinkit|zepto|instamart|dmart|grocery|kirana|supermarket|provision|vegetable|milk|dairy|fresh/i],
    ['Travel', '🚕', /uber|\bola\b|rapido|irctc|redbus|metro|petrol|diesel|fuel|hpcl|bpcl|iocl|indianoil|fastag|makemytrip|goibibo|indigo|airline|cab|parking/i],
    ['Shopping', '🛍️', /amazon|flipkart|myntra|ajio|meesho|nykaa|lenskart|store|mart|mall|fashion|retail|decathlon/i],
    ['Bills', '💡', /electric|bescom|mseb|msedcl|recharge|\bjio\b|airtel|vodafone|\bvi\b|bsnl|broadband|dth|tata ?sky|gas|water|insurance|\blic\b|postpaid|bill|emi|loan|tax/i],
    ['Fun', '🎬', /netflix|spotify|hotstar|bookmyshow|prime video|youtube|gaming|steam|cinema|pvr|inox|movie/i],
    ['Health', '💊', /pharma|medical|medic|apollo|hospital|clinic|1mg|pharmeasy|doctor|lab|diagnostic|dental/i],
    ['Learning', '📚', /school|college|tuition|course|udemy|coursera|book|exam|fees?/i],
    ['Rent', '🏠', /\brent\b|landlord|society|maintenance/i],
  ];
  const CAT_ICON = { Other: '✨', 'Money in': '💰', Salary: '💼' };
  CATEGORIES.forEach(([n, i]) => (CAT_ICON[n] = i));
  const DEBIT_CATS = CATEGORIES.map((c) => c[0]).concat(['Other']);
  const CREDIT_CATS = ['Money in', 'Salary', 'Other'];

  const toAmount = (s) => parseFloat(String(s).replace(/,/g, ''));
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const fullYear = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y));
  const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;

  function findBalance(text) {
    const re = /(?:avl\.?\s*bal(?:ance)?|available\s*(?:bal(?:ance)?)?|clear\s*bal(?:ance)?|closing\s*bal(?:ance)?|\bbal(?:ance)?)\s*(?:is|:|-|=)?\s*(?:rs\.?|inr|₹)?\s*(-?[\d,]+(?:\.\d{1,2})?)/i;
    const m = re.exec(text);
    if (!m) return { balance: null, rest: text };
    return { balance: toAmount(m[1]), rest: text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length) };
  }

  function findAmount(text) {
    let m = /(?:rs\.?|inr|₹)\s*(-?[\d,]*\d(?:\.\d{1,2})?)/i.exec(text);
    if (!m) m = /(?:debited|credited|sent|paid|received|withdrawn|spent)\s*(?:by|for|with|of)?\s*(?:rs\.?|inr|₹)?\s*([\d,]*\d(?:\.\d{1,2})?)/i.exec(text);
    if (!m) m = /([\d,]*\d(?:\.\d{1,2})?)\s*(?:rs\b|inr\b)/i.exec(text);
    if (!m) return null;
    const v = Math.abs(toAmount(m[1]));
    return v > 0 ? v : null;
  }

  function findType(text) {
    const debit = /debited|\bsent\b|\bpaid\b|\bspent\b|withdrawn|purchase|\bdr\b|payment of/i;
    const credit = /credited|received|deposited|refund|\bcr\b|credit alert|added to/i;
    const d = debit.exec(text), c = credit.exec(text);
    if (d && c) return d.index <= c.index ? 'debit' : 'credit';
    if (d) return 'debit';
    if (c) return 'credit';
    return null;
  }

  function findDate(text) {
    let m;
    const time = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/i.exec(text);
    let t = '';
    if (time) {
      let h = Number(time[1]);
      if (time[3]) { const pm = /pm/i.test(time[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      if (h < 24) t = `${pad(h)}:${time[2]}`;
    }
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text)) && validDate(+m[1], +m[2], +m[3])) return { date: iso(+m[1], +m[2], +m[3]), time: t };
    if ((m = /\b(\d{1,2})[\s\-\/.]?([A-Za-z]{3})[a-z]*[\s\-\/.,]*(\d{2,4})\b/.exec(text)) && MONTHS[m[2].toLowerCase()]) {
      const y = fullYear(m[3]);
      if (validDate(y, MONTHS[m[2].toLowerCase()], +m[1])) return { date: iso(y, MONTHS[m[2].toLowerCase()], +m[1]), time: t };
    }
    if ((m = /\b(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2}|\d{4})\b/.exec(text)) && validDate(fullYear(m[3]), +m[2], +m[1])) return { date: iso(fullYear(m[3]), +m[2], +m[1]), time: t };
    return { date: null, time: t };
  }

  function findAccount(text) {
    let m = /(?:a\/c|acct?\.?|account|a\.c\.?|card)\s*(?:no\.?|number)?\s*(?:ending(?: with| in)?)?\s*[:\-]?\s*(?:[xX*]+\s*)?(\d{3,6})\b/i.exec(text);
    if (!m) m = /\b[xX*]{2,}\s*(\d{3,6})\b/.exec(text);
    const last = m ? m[1].slice(-4) : null;
    let bank = null;
    for (const [name, re] of BANKS) if (re.test(text)) { bank = name; break; }
    if (!last && !bank) return { key: 'unknown', label: 'Unknown account' };
    const label = `${bank || 'Bank'}${last ? ' ••' + last : ''}`;
    return { key: label, label };
  }

  function findRef(text) {
    let m = /(?:upi\s*ref(?:\s*(?:no\.?|number))?|ref(?:erence)?\s*(?:no\.?|number|id)?|refno|utr|rrn|txn\s*(?:id|no\.?)|upi)\s*[:\-.]?\s*(\d{9,16})/i.exec(text);
    if (!m) m = /\b(\d{12})\b/.exec(text);
    return m ? m[1] : null;
  }

  const prettyVpa = (v) => v.split('@')[0].replace(/[._\-\d]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || v;

  function findParty(text, type) {
    const vpa = (/([A-Za-z0-9._\-]{2,}@[A-Za-z]{2,})/.exec(text) || [])[1] || null;
    const word = type === 'credit' ? 'from' : 'to';
    const re = new RegExp(`\\b${word}\\s+(?:vpa\\s+)?([^\\n;,()]+?)(?=\\s+(?:on|via|ref|refno|upi|utr|using|thru|through|if|not|call|avl|bal|dated|txn|date|at|is)\\b|[.;,()\\n]|$)`, 'gi');
    let m, name = null;
    while ((m = re.exec(text))) {
      const cand = m[1].trim();
      if (!cand || /^(a\/c|acct?|account|your|bank|card|date|rs|inr|₹|\d)/i.test(cand)) continue;
      name = cand;
      break;
    }
    if (!name && type === 'debit') { // ICICI style: "... on 07-Oct-26; NAME credited."
      m = /;\s*([^;\n]+?)\s+credited/i.exec(text);
      if (m) name = m[1].trim();
    }
    if (!name && type === 'credit') {
      m = /;\s*([^;\n]+?)\s+debited/i.exec(text);
      if (m) name = m[1].trim();
    }
    if (name && name.includes('@')) return { party: prettyVpa(name), vpa: name };
    if (name) {
      // "to VPA swiggy@icici SWIGGY": the captured name may be "swiggy@icici SWIGGY"
      return { party: name.replace(/\s+/g, ' ').slice(0, 60), vpa };
    }
    if (vpa) return { party: prettyVpa(vpa), vpa };
    return { party: '', vpa: null };
  }

  function categorize(party, vpa, type) {
    if (type === 'credit') return /salary|payroll/i.test(party) ? 'Salary' : 'Money in';
    const hay = `${party} ${vpa || ''}`;
    for (const [name, , re] of CATEGORIES) if (re.test(hay)) return name;
    return 'Other';
  }

  /** Parse one message. Returns null if it doesn't look like a money message at all. */
  function parseOne(raw) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const { balance, rest } = findBalance(text);
    const amount = findAmount(rest);
    const type = findType(rest);
    if (amount == null && !type) return null;
    const { date, time } = findDate(text);
    const acct = findAccount(text);
    const t = type || 'debit';
    const { party, vpa } = findParty(rest, t);
    return {
      type: t, amount, party, vpa, date, time,
      account: acct.key, accountLabel: acct.label,
      balance, ref: findRef(text), category: categorize(party, vpa, t),
      note: '', raw: raw.trim(), complete: amount != null && type != null,
    };
  }

  /** Split a pasted blob into messages: blank lines first, then one-per-line if each line stands alone. */
  function splitMessages(blob) {
    const blocks = blob.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const out = [];
    for (const b of blocks) {
      const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1 && lines.filter((l) => { const p = parseOne(l); return p && p.complete; }).length >= 2) out.push(...lines);
      else out.push(b);
    }
    return out;
  }

  function parseMany(blob) {
    return splitMessages(blob).map((m) => parseOne(m) || {
      type: 'debit', amount: null, party: '', vpa: null, date: null, time: '', account: 'unknown',
      accountLabel: 'Unknown account', balance: null, ref: null, category: 'Other', note: '',
      raw: m, complete: false, unreadable: true,
    });
  }

  const api = { parseOne, parseMany, splitMessages, categorize, CAT_ICON, DEBIT_CATS, CREDIT_CATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
