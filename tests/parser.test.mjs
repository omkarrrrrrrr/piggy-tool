import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { parseOne, parseMany } = createRequire(import.meta.url)('../parser.js');

const cases = [
  ['HDFC debit', 'Sent Rs.250.00 from HDFC Bank A/C *1234 to VPA swiggy@icici SWIGGY on 07/10/26. UPI Ref No 628712345678. Avl Bal Rs 12,345.67',
    { type: 'debit', amount: 250, account: 'HDFC ••1234', date: '2026-10-07', ref: '628712345678', balance: 12345.67, category: 'Food' }],
  ['SBI debit', 'Dear UPI user A/C X5678 debited by 120.0 on date 07Oct26 trf to RAMESH KUMAR Refno 628700000001. If not u? call 1800111109. -SBI',
    { type: 'debit', amount: 120, account: 'SBI ••5678', date: '2026-10-07', party: 'RAMESH KUMAR', ref: '628700000001' }],
  ['ICICI debit', 'ICICI Bank Acct XX123 debited for Rs 1,500.00 on 07-Oct-26; BIGBASKET credited. UPI:628711112222. Call 18002662 for dispute.',
    { type: 'debit', amount: 1500, account: 'ICICI ••123', date: '2026-10-07', party: 'BIGBASKET', category: 'Groceries' }],
  ['Credit', 'Credit Alert! Rs.5,000.00 credited to HDFC Bank A/c xx1234 on 07-10-26 from VPA mom@oksbi (UPI 628799998888). Avl bal: Rs 17,345.67',
    { type: 'credit', amount: 5000, account: 'HDFC ••1234', party: 'Mom', balance: 17345.67, category: 'Money in' }],
  ['App text', 'Paid ₹80 to Chai Point', { type: 'debit', amount: 80, party: 'Chai Point', category: 'Food' }],
  ['Received', 'You have received ₹300 from Priya Sharma', { type: 'credit', amount: 300, party: 'Priya Sharma' }],
];
let fail = 0;
for (const [name, text, want] of cases) {
  const got = parseOne(text);
  for (const [k, v] of Object.entries(want)) {
    try { assert.equal(got[k], v); } catch { fail++; console.log(`FAIL ${name}: ${k} want ${JSON.stringify(v)} got ${JSON.stringify(got[k])}`); }
  }
}
const many = parseMany(cases[0][1] + '\n\n' + cases[4][1] + '\nPaid ₹20 to Tea Stall');
try { assert.equal(many.length, 3); } catch { fail++; console.log('FAIL split: got', many.length); }
assert.equal(parseOne('hello how are you'), null);
console.log(fail ? `${fail} failures` : 'all parser tests passed');
process.exit(fail ? 1 : 0);
