# PackCheck PWA

A small offline-first packing and independent verification PWA.

## Current behavior
- Trip name + trip date
- Verification is deliberately locked until the trip date or the day before
- Two-stage state: To Pack -> Packed -> Verified
- Failed verification becomes Needs Attention
- Collapsible categories
- Add/delete categories
- Optional quantity
- Optional tags for each item
- LocalStorage persistence
- Offline service worker
- Readiness dashboard
- Independent one-item-at-a-time verification flow

## Run
Serve this folder from localhost (a PWA service worker will not work from file://).

Example:
python3 -m http.server 8080

Then open http://localhost:8080 in a browser.

For iPhone installation, deploy it over HTTPS and use Safari -> Share -> Add to Home Screen.

## Next logical upgrades
- Couple/shared sync with a backend
- Reusable templates and duplicate-trip
- Verification history UI
- Edit/delete item actions
- Cloud backup
- Photo/receipt attachment for unusual items
