import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useLeagues } from '../lib/store';
import { FEATURED_LEAGUES, findSport, SPORTS } from '../lib/sports';
import { lineFor, storedToMatch } from '../lib/util';
import type { Match } from '../lib/types';
import { Coins, Empty, SkeletonRows } from '../components/bits';
import { DayGroupedMatches, GroupedMatches, ListBlock } from '../components/MatchList';

type When = 'upcoming' | 'live' | 'results';

function SportChips({ active }: { active?: string }) {
  return (
    <div className="chips mobile-only" style={{ marginBottom: 14 }}>
      <Link to="/" className={`chip ${!active ? 'active' : ''}`}>
        🔥 Top
      </Link>
      {SPORTS.map((s) => (
        <Link key={s.key} to={`/sport/${s.key}`} className={`chip ${active === s.key ? 'active' : ''}`}>
          {s.icon} {s.name}
        </Link>
      ))}
    </div>
  );
}

function WhenTabs({ when, setWhen, counts }: { when: When; setWhen(w: When): void; counts: Record<When, number> }) {
  return (
    <div className="tabs">
      {(['upcoming', 'live', 'results'] as When[]).map((w) => (
        <button key={w} className={`tab ${when === w ? 'active' : ''}`} onClick={() => setWhen(w)}>
          {w === 'upcoming' ? 'Upcoming' : w === 'live' ? 'Live' : 'Results'}
          <span className="dim" style={{ marginLeft: 6 }}>
            {counts[w]}
          </span>
        </button>
      ))}
    </div>
  );
}

function filterWhen(ms: Match[], when: When): Match[] {
  // matches you can bet on in-play come first; long-running cricket etc. go below
  if (when === 'live') return ms.filter((m) => m.state === 'in').sort((a, b) => Number(!!b.liveOpen) - Number(!!a.liveOpen));
  if (when === 'results') return ms.filter((m) => m.state === 'post').reverse();
  return ms.filter((m) => m.state === 'pre');
}

// ---- upcoming: sort & filter ---------------------------------------------------
type SortBy = 'time' | 'league' | 'popular' | 'closest';
type DayFilter = 'all' | 'today' | 'tomorrow' | '3days';
interface UpcomingPrefs {
  sort: SortBy;
  day: DayFilter;
  sport: string;
  q: string;
}
const PREFS_KEY = 'fg-upcoming-prefs';
const DEFAULT_PREFS: UpcomingPrefs = { sort: 'time', day: 'all', sport: 'all', q: '' };

function loadPrefs(): UpcomingPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'), q: '' };
  } catch {
    return DEFAULT_PREFS;
  }
}

const SORTS: { key: SortBy; label: string }[] = [
  { key: 'time', label: '🕒 Time' },
  { key: 'league', label: '🏆 League' },
  { key: 'popular', label: '🔥 Popular' },
  { key: 'closest', label: '⚖️ Closest odds' },
];
const DAYS: { key: DayFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: '3days', label: 'Next 3 days' },
];

function dayStart(offset: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

function inDay(m: Match, day: DayFilter): boolean {
  if (day === 'all') return true;
  const t = Date.parse(m.startTime);
  if (day === 'today') return t < dayStart(1);
  if (day === 'tomorrow') return t >= dayStart(1) && t < dayStart(2);
  return t < dayStart(3);
}

function UpcomingToolbar({ prefs, setPrefs, sports }: { prefs: UpcomingPrefs; setPrefs(p: UpcomingPrefs): void; sports: string[] }) {
  const set = (patch: Partial<UpcomingPrefs>) => setPrefs({ ...prefs, ...patch });
  return (
    <div className="toolbar card">
      <div className="toolbar-row">
        <span className="toolbar-label">Sort</span>
        <div className="chips">
          {SORTS.map((o) => (
            <button key={o.key} className={`chip sm ${prefs.sort === o.key ? 'active' : ''}`} onClick={() => set({ sort: o.key })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar-row">
        <span className="toolbar-label">When</span>
        <div className="chips">
          {DAYS.map((o) => (
            <button key={o.key} className={`chip sm ${prefs.day === o.key ? 'active' : ''}`} onClick={() => set({ day: o.key })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar-row">
        <input className="input sm" placeholder="🔍 Search team or league" value={prefs.q} onChange={(e) => set({ q: e.target.value })} />
        {sports.length > 1 && (
          <select className="input sm" style={{ maxWidth: 180 }} value={sports.includes(prefs.sport) ? prefs.sport : 'all'} onChange={(e) => set({ sport: e.target.value })}>
            <option value="all">All sports</option>
            {sports.map((k) => (
              <option key={k} value={k}>
                {k === 'custom' ? '⭐ Group specials' : `${findSport(k)?.icon ?? ''} ${findSport(k)?.name ?? k}`}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function UpcomingList({ matches }: { matches: Match[] }) {
  const { data } = useApp();
  const [prefs, setPrefsState] = useState<UpcomingPrefs>(loadPrefs);
  const setPrefs = (p: UpcomingPrefs) => {
    setPrefsState(p);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...p, q: '' }));
    } catch {
      /* ignore */
    }
  };
  const sports = useMemo(() => [...new Set(matches.map((m) => m.sport))], [matches]);
  const q = prefs.q.trim().toLowerCase();
  const filtered = matches.filter(
    (m) =>
      inDay(m, prefs.day) &&
      (prefs.sport === 'all' || m.sport === prefs.sport || !sports.includes(prefs.sport)) &&
      (!q || `${m.home.name} ${m.away.name} ${m.league}`.toLowerCase().includes(q)),
  );
  const activity = (id: string) =>
    data ? data.bets.filter((b) => b.eventId === id).length + data.challenges.filter((c) => c.eventId === id && c.status !== 'cancelled').length : 0;
  // how evenly matched: gap between the two sides' implied chances (smaller = closer)
  const closeness = (m: Match) => {
    const l = lineFor(m, data);
    return Math.abs(1 / l[0] - 1 / l[1]);
  };

  let body;
  if (!filtered.length) {
    body = (
      <div className="card">
        <Empty icon="🔍" title="No matches match these filters">
          Try another day, sport or search.
        </Empty>
      </div>
    );
  } else if (prefs.sort === 'league') body = <GroupedMatches matches={filtered} />;
  else if (prefs.sort === 'popular') {
    const ms = [...filtered].sort((a, b) => activity(b.id) - activity(a.id) || a.startTime.localeCompare(b.startTime));
    body = <ListBlock icon="🔥" title="Most popular in your group" matches={ms} showLeague />;
  } else if (prefs.sort === 'closest') {
    const ms = [...filtered].sort((a, b) => closeness(a) - closeness(b) || a.startTime.localeCompare(b.startTime));
    body = <ListBlock icon="⚖️" title="Closest contests first" matches={ms} showLeague />;
  } else body = <DayGroupedMatches matches={filtered} />;

  return (
    <>
      <UpcomingToolbar prefs={prefs} setPrefs={setPrefs} sports={sports} />
      {body}
    </>
  );
}

function MatchesView({
  leagues,
  defaultWhen = 'upcoming',
  extra = [],
  range = 'full',
}: {
  leagues: string[];
  defaultWhen?: When;
  extra?: Match[];
  range?: 'live' | 'short' | 'full';
}) {
  const { matches, loading, errors } = useLeagues(leagues, defaultWhen === 'live' ? 'live' : range);
  const [when, setWhen] = useState<When>(defaultWhen);
  const all = useMemo(() => [...extra, ...matches].sort((a, b) => a.startTime.localeCompare(b.startTime)), [matches, extra]);
  const counts = { upcoming: filterWhen(all, 'upcoming').length, live: filterWhen(all, 'live').length, results: filterWhen(all, 'results').length };
  const shown = filterWhen(all, when);
  return (
    <>
      <WhenTabs when={when} setWhen={setWhen} counts={counts} />
      {loading && !all.length ? (
        <>
          <SkeletonRows />
          <SkeletonRows n={3} />
        </>
      ) : when === 'upcoming' && shown.length ? (
        <UpcomingList matches={shown} />
      ) : shown.length ? (
        <GroupedMatches matches={shown} />
      ) : (
        <div className="card">
          <Empty icon={when === 'live' ? '📡' : '📅'} title={when === 'live' ? 'Nothing live right now' : 'No matches in this window'}>
            {when === 'upcoming' ? 'Upcoming fixtures appear here. Try another league or sport from the menu.' : 'Check the other tabs.'}
          </Empty>
        </div>
      )}
      {errors.length > 0 && !loading && (
        <div className="banner info" style={{ marginTop: 10 }}>
          ⚠️ Couldn't reach the live feed for {errors.length} competition{errors.length > 1 ? 's' : ''}. It will retry automatically.
        </div>
      )}
    </>
  );
}

function useSpecials(): Match[] {
  const { data } = useApp();
  return useMemo(() => (data ? Object.values(data.events).filter((e) => e.sport === 'custom').map(storedToMatch) : []), [data]);
}

export function Home() {
  const { data, user, group } = useApp();
  const me = data?.members.find((m) => m.userId === user?.id);
  const specials = useSpecials();
  const openBets = data?.bets.filter((b) => b.userId === user?.id && b.status === 'open').length ?? 0;
  const rank = data ? [...data.members].sort((a, b) => b.balance - a.balance).findIndex((m) => m.userId === user?.id) + 1 : 0;
  return (
    <>
      <SportChips />
      <section className="hero">
        <h1>Welcome back, {user?.username} 👋</h1>
        <p>
          Back your calls on real matches against the group line, or send a head-to-head challenge with your own odds. Results settle automatically from the live feed.
        </p>
        {group && (
          <div className="hero-stats">
            <div className="hero-stat">
              <b>
                <Coins n={me?.balance ?? 0} />
              </b>
              <span>Your balance</span>
            </div>
            <div className="hero-stat">
              <b>
                #{rank || '—'} <span className="dim" style={{ fontSize: 14 }}>/ {data?.members.length ?? 0}</span>
              </b>
              <span>Group rank</span>
            </div>
            <div className="hero-stat">
              <b>{openBets}</b>
              <span>Open bets</span>
            </div>
          </div>
        )}
      </section>
      <div className="section-head">
        <h2>Top events</h2>
        <span className="count">Football · Cricket · NBA · NFL</span>
      </div>
      <MatchesView leagues={FEATURED_LEAGUES} extra={specials} range="short" />
    </>
  );
}

export function LivePage() {
  const all = useMemo(() => SPORTS.flatMap((s) => s.leagues.map((l) => l.key)), []);
  return (
    <>
      <SportChips />
      <div className="page-title">
        <h1>📡 Live now</h1>
      </div>
      <MatchesView leagues={all} defaultWhen="live" />
    </>
  );
}

export function SpecialsPage() {
  const specials = useSpecials();
  return (
    <>
      <div className="page-title">
        <h1>⭐ Group specials</h1>
        <span className="muted">Custom markets created by your group admins</span>
      </div>
      <MatchesView leagues={[]} extra={specials} />
    </>
  );
}

export function SportPage() {
  const { sport = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const s = findSport(sport);
  const leagueKey = params.get('league');
  const leagues = useMemo(() => {
    if (!s) return [];
    if (leagueKey && s.leagues.some((l) => l.key === leagueKey)) return [leagueKey];
    return s.leagues.slice(0, 7).map((l) => l.key);
  }, [s, leagueKey]);
  if (!s) return <Empty icon="🤷" title="Unknown sport" />;
  return (
    <>
      <SportChips active={s.key} />
      <div className="page-title">
        <h1>
          {s.icon} {s.name}
        </h1>
      </div>
      {s.leagues.length > 1 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={`chip ${!leagueKey ? 'active' : ''}`} onClick={() => setParams({})}>
            All
          </button>
          {s.leagues.map((l) => (
            <button key={l.key} className={`chip ${leagueKey === l.key ? 'active' : ''}`} onClick={() => setParams({ league: l.key })}>
              {l.name}
            </button>
          ))}
        </div>
      )}
      <MatchesView key={leagues.join()} leagues={leagues} />
    </>
  );
}
