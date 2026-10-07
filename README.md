# Piggy – UPI money diary

Paste bank/UPI SMS text; Piggy extracts amount, direction, party, account, date and balance, categorises it, and keeps a running balance per account. Notes can be added per transaction. Static site, no backend: data lives in the browser's localStorage (CSV export and JSON backup built in).

- Run: open `index.html`, or serve the folder with any static server.
- Test the parser: `node tests/parser.test.mjs`
- Deploy: any static host; no build step (publish the `expense-tool/` folder as-is).
