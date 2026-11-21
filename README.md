# 🏆 Friendly Games

A free, private sportsbook for you and your friends: **virtual coins only, no real money.**

- **Real fixtures and live scores** for football (Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Champions League, Europa League, MLS, ISL, Saudi Pro League and more), cricket, NBA, NFL, NHL, MLB, tennis (ATP/WTA) and UFC. The data comes from ESPN's public feed, which needs no key and costs nothing.
- **Group line betting:** every match has 1X2 or moneyline odds. They start from real bookmaker prices where ESPN publishes them, and shift as your group bets. Your odds lock in when you place the bet.
- **Head-to-head challenges:** set your own odds and stake, send the challenge to one friend or the whole group, and the winner takes the pot.
- **Automatic settlement:** when a match finishes, bets and challenges settle on their own. Postponed or abandoned games are voided and stakes refunded.
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
2. Go to **SQL Editor → New query**, paste in all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Go to **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". Players sign in with a username and password, so there are no emails to confirm.
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

### Optional: ESPN proxy

The app calls ESPN directly from the browser. If a browser or network ever blocks that, deploy the included fallback proxy with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase functions deploy espn-proxy --no-verify-jwt --project-ref <your-project-ref>
```

The app switches to the proxy automatically when a direct request fails.

---

## How it works

- `src/lib/espn.ts` fetches and normalises ESPN scoreboards and works out results.
- `src/lib/odds.ts` holds the group line: `odds = 1 / ((base_prob × 1000 + coins_on_outcome) / (1000 + total_coins))`, with the same formula in SQL.
- `supabase/schema.sql` contains the tables, row-level security, and all the coin-moving functions (`place_bet`, `create_challenge`, `accept_challenge`, `settle_event`, and the others). The browser cannot edit balances directly.
- `src/lib/backend/` has two interchangeable backends: Supabase (online) and localStorage (demo).

**Trust model:** this is built for friends. The first app that sees a final score from ESPN settles the event. Any group member could, in principle, use developer tools to report a wrong result for a real match. If your group is that competitive, have a stern word with them 😄

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Type-check and build into `dist/` |
| `npm run preview` | Serve the production build |
