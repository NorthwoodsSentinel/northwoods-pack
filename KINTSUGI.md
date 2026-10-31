# Kintsugi

Kintsugi is the Japanese art of mending broken pottery with gold, so the repair becomes part of the object's history instead of something hidden.

This file is the same idea for code. Every fix here leaves a seam in three places, all carrying the same gold line:

- a short `kintsugi:` comment at the repair site;
- a `Kintsugi:` trailer on the commit;
- an entry in this append-only ledger.

The seam shows the break; it doesn't hide it. Security fixes describe what kind of thing was mended, never how to exploit it.

A repair is entered as "review pending". The reviewer is recorded only after the review has happened, in a later commit that names the verdict and the commit it reviewed, so this ledger never claims a review before it exists.

| Date | What broke | How it was mended | Mended by / reviewed by | Gold line |
|---|---|---|---|---|
| 2026-10-31 | The pack token was checked in five places by plain string comparison. Two of them (`/export` and the API catch-all) skipped the factory-default lockout the other routes enforce. | One `tokenMatches()` check used everywhere: refuses while the token is unset or still the factory default, and compares SHA-256 digests in constant time; `/export` and the catch-all now return the same setup message as every other route. Tests added. | Margin / review pending | *The door was checked five ways by five hands, and two forgot the factory key; now one hand holds it, never opens to the default, and takes the same time for every wrong key.* |
