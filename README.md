# PackCheck — couple version

Two people share trips with realtime sync and full offline support. Frameworkless PWA
+ Firebase Auth (locked to two accounts) + Firestore with offline persistence.
Templates compose client-side; each item is its own Firestore doc so concurrent
edits merge instead of clobbering (PRD §37).

## What you need
A Firebase project (free Spark plan is fine). You can REUSE an existing project —
this app namespaces everything under the `packcheck_` collection prefix.

## Setup (~5 minutes)

1. **Firebase project**
   - console.firebase.google.com → your project (or create one).
   - Build → **Authentication** → Get started → enable **Google** as a sign-in provider.
   - Build → **Firestore Database** → Create database → Production mode.

2. **Register a web app** (if you don't already have one)
   - Project settings (gear) → Your apps → Web (`</>`) → register.
   - Copy the `firebaseConfig` values.

3. **Fill in config**
   - `cp config.example.js config.js`
   - Paste your config values, set the **two Google emails** in `allowedEmails`.
   - `config.js` is safe to commit — Firebase web keys aren't secrets; access is
     enforced by the emails + Firestore rules, not by hiding this file.

4. **Publish security rules**
   - Firestore → Rules. Put the SAME two emails in `firestore.rules`.
   - **New project:** paste the whole file.
   - **Reusing a project:** copy ONLY the `match /packcheck_trips/...` block into your
     existing rules — don't overwrite what's there. Publish.

5. **Authorize your domain**
   - Authentication → Settings → Authorized domains → add the domain you'll deploy to
     (e.g. `your-site.netlify.app`). `localhost` is allowed by default.

## Run locally (test before deploying)
    npx serve .        # or: python3 -m http.server 8080
Open on your phone and your partner's phone, sign in with each Google account, and
watch a change on one device appear on the other.

## Deploy
Static files — any static host. HTTPS is required (all of these give it free).

- **Firebase Hosting** (natural fit): `npm i -g firebase-tools` → `firebase login` →
  `firebase init hosting` (public dir: `.`, single-page: No) → `firebase deploy`.
- **Netlify:** app.netlify.com → Add new site → Deploy manually → drag this folder.
- **Vercel:** import the repo, preset "Other", build command none, output dir `.`.

After deploy, add the live domain under Authentication → Authorized domains.

## Install to home screen
iPhone Safari → Share → Add to Home Screen. Android Chrome → menu → Install app.

## After ANY change to app.js / styles.css / config.js
Bump `CACHE` in `service-worker.js` (e.g. `packcheck-couple-v2`) or installed phones
keep serving the old cached shell.


## New in this build
- **Custom categories** — Account menu → Manage categories, or "+ Add category…" in any
  category picker. The list is shared between both accounts (stored in `packcheck_meta/config`).
- **Mark for purchase** — item editor → "🛒 Need to buy". Flagged items show a Buy badge.
- **Shopping list export** — trip menu (⋯) → Shopping list → Copy (new lines / comma).
  Paste straight into your shopping-list app's bulk add.

> **Rules update required:** this build reads/writes `packcheck_meta/config`. Re-publish
> `firestore.rules` — it now includes a `match /packcheck_meta/{docId}` block. If you
> reuse an existing project, copy that block in alongside the trips block.

> Clipboard copy needs a secure context (https or localhost). In some in-app browsers it
> falls back to a select-to-copy textarea.

## Data model
- `packcheck_trips/{tripId}`  — trip metadata (name, dates, types, season, travelers)
- `packcheck_trips/{tripId}/items/{itemId}` — one doc per packing item
Offline writes queue locally and sync automatically when a signal returns. "Verified"
records who verified it (verifiedBy) for the couple case (PRD §28).

## Deliberately NOT in this version
Invite flows, roles/households, activity feed, notifications, weather, quantity math,
template-learning. This is the two-person core. Access is a fixed two-email allowlist —
to add a third person you edit `allowedEmails` in config.js AND the emails in the rules.
