# BloomBrain Media

Video agency portfolio website with AI and video-editing collections, client reviews and a dedicated Meet Dibyendu section.

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Public portfolio needs no database or login
- Private `/payments` workspace (admin + worker logins) stores its ledger in **Supabase**
- Hover video previews with sound where browser autoplay policy allows it; click-to-play fallback and expanded playback

## Local development

Requires Node.js 20.9 or newer.

```sh
npm install
npm run dev
```

## Deploying on Hostinger (Node.js web app)

1. Create a Node.js web app in hPanel and import this GitHub repository, branch `main`.
2. Settings: Node.js **20 or 22**, build command `npm run build`, start command `npm start`, output directory `.next`.
3. Add the environment variables below, then deploy.

## Supabase (payments ledger database)

1. In Supabase: SQL Editor → New query → paste `supabase/schema.sql` → Run.
2. In Supabase: Project Settings → API keys. Copy the project URL and the
   **secret / service_role** key (never the anon key, never put it in client code).
3. In Hostinger hPanel → the Node.js app → Environment variables, add:
   - `SUPABASE_URL` = `https://YOUR-PROJECT.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = the secret key
4. Redeploy. On the first request the app copies the existing private ledger file
   (`$LEDGER_DATA_DIR` or `~/.bloombrain-private/payments/ledger.json`) into Supabase,
   so existing logins, workers, entries and balances carry over. After that the file
   is no longer read or written. Without these variables the app keeps using the file.

Every save keeps the previous version in the `ledger_backups` table (latest 100).
Tables have row-level security on with no policies, so only the server key can read them.


## Main files

- `components/portfolio.tsx`: public website and video interactions
- `app/globals.css`: styling
- `lib/portfolio.json`: video sources and metadata (files live in `public/media/`)
- `lib/collections.ts`: collection grouping and deduplication
- `lib/reviews.json`: client reviews and portrait paths
- `lib/payments/supabase.ts`, `supabase/schema.sql`: payments ledger storage in Supabase

