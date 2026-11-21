# 🏆 Friendly Games

A free, private sportsbook for you and your friends: **virtual coins only, no real money.**

- **Real fixtures and live scores** for football (Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Champions League, Europa League, MLS, ISL, Saudi Pro League and more), cricket, NBA, NFL, NHL, MLB, tennis (ATP/WTA) and UFC. The data comes from ESPN's public feed, which needs no key and costs nothing.
- **Group line betting:** every match has 1X2 or moneyline odds. They start from real bookmaker prices where ESPN publishes them, and shift as your group bets. Your odds lock in when you place the bet.
- **Head-to-head challenges:** set your own odds and stake, send the challenge to one friend or the whole group, and the winner takes the pot.
- **Live betting (in-play):** bet during matches at live bookmaker prices. Football closes at the 80th minute, NBA/NFL at the 4th quarter, NHL at the 3rd period and MLB after the 6th inning. Betting pauses for 60 seconds after any score change, and each live bet confirms 30 seconds after it's placed, but only if the score hasn't changed (the standard bookmaker defence against delayed feeds). Group admins can switch live betting off.
- **Cash out:** settle an open bet early at the current live price (`stake × your odds ÷ current odds`), confirmed the same way after 30 seconds.
- **Automatic settlement:** when a match finishes, bets and challenges settle on their own, but only with a server-signed result, so nobody can fake a score. Postponed or abandoned games are voided and stakes refunded.
- **Private groups** you join with an invite code or a WhatsApp invite link, plus a leaderboard, win streaks and an activity feed.
- **Group specials:** admins can create custom markets ("Will Rohit score a century?") and settle them by hand.
- Decimal, fractional or American odds. Works on phones and desktops.

## Costs: nothing

| Piece | Service | Free tier |
|---|---|---|
| Website hosting | GitHub Pages (or Vercel / Netlify) | Free |
| Accounts + database | Supabase | Free (500 MB DB, 50k monthly users) |
| Sports data | ESPN public API | Free, no key |

> Supabase pauses free projects after about a week with no activity. If the app stops loading after a quiet spell, open the Supabase dashboard and click **Restore**.

---

## 1. Try it right now (demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no database configured, the app runs in **Demo mode**: everything is stored in your browser. You can create several players and switch between them to try it out.

## 2. Set up the free database (about 5 minutes)

1. Create a free account at https://supabase.com and click **New project**.
2. Go to **SQL Editor → New query**, paste in all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. Everything is prefixed `fg_`, so it is safe to add to a project that already runs another app.
3. Players sign up with a username and password through the `fg_sign_up` database function, which creates a ready-to-use login. There is no confirmation email, and you don't need to change any Auth settings.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key**. The anon key is meant to be public; row-level security protects the data.
5. For local development, copy `.env.example` to `.env.local` and fill in both values.

## 3. Put it online for your friends (free)

**GitHub Pages:**

1. Push this repo to GitHub, onto the `main` branch.
2. Under **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Under **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Push again, or run the "Deploy to GitHub Pages" workflow. Your site appears at `https://<you>.github.io/<repo>/`.

**Vercel / Netlify:** import the repo, use build command `npm run build` and output folder `dist`, and add the same two environment variables.

Then open the site, create your account, **create a group**, and share the invite code or link.

### Site admin

A site admin can see every group, player, bet and challenge on the **Admin** page, with no invite code needed, and has admin rights in every group. To make someone a site admin, run this in the Supabase SQL Editor:

```sql
update public.fg_profiles set is_super = true where username = 'their_username';
```

### Live sports data

The browser fetches ESPN data through `api/espn.ts`, a small Vercel Edge Function on your own site that caches each response for 30 seconds. On hosts without it, such as GitHub Pages, the app calls ESPN directly. ESPN only accepts one date per request, so the app loads one request per day, from yesterday to six days ahead.

---

## How it works

- `src/lib/espn.ts` fetches and normalises ESPN scoreboards and works out results; `api/espn.ts` is the same-origin relay.
- `src/lib/odds.ts` holds the group line: `odds = 1 / ((base_prob × 1000 + coins_on_outcome) / (1000 + total_coins))`, with the same formula in SQL.
- `supabase/schema.sql` contains the tables, row-level security, and all the coin-moving functions (`place_bet`, `create_challenge`, `accept_challenge`, `settle_event`, and the others). The browser cannot edit balances directly.
- `src/lib/backend/` has two interchangeable backends: Supabase (online) and localStorage (demo).

**Trust model:** live prices and final results come from `api/quote.ts`, which reads ESPN on the server and signs the data with a secret (`QUOTE_SECRET` in Vercel, also stored in the locked `fg_secrets` table). The database refuses any live bet, cash out or settlement without a valid, fresh signature, so nobody can fake odds or results from the browser. If you set up a new deployment, put the same random value in both places:

```sql
insert into public.fg_secrets (key, value) values ('quote', '<random 64-char hex>')
  on conflict (key) do update set value = excluded.value;
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Type-check and build into `dist/` |
| `npm run preview` | Serve the production build |
