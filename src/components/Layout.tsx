import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/store';
import { SPORTS } from '../lib/sports';
import type { OddsFormat } from '../lib/odds';
import { Avatar, Coins } from './bits';
import { BetSlip } from './BetSlip';

export function useIncomingChallenges(): number {
  const { data, user } = useApp();
  if (!data || !user) return 0;
  return data.challenges.filter(
    (c) => c.status === 'open' && c.creatorId !== user.id && (!c.targetId || c.targetId === user.id) && new Date(data.events[c.eventId]?.startTime ?? 0) > new Date(),
  ).length;
}

function TopBar() {
  const { user, data, groups, group, setGroupId, backend, oddsFormat, setOddsFormat } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const incoming = useIncomingChallenges();
  const me = data?.members.find((m) => m.userId === user?.id);

  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark">FG</span>
        <span>
          Friendly Games
          <small>{group ? group.name : 'Bragging rights only'}</small>
        </span>
      </Link>
      <nav className="topnav">
        <NavLink to="/" end>
          Sports
        </NavLink>
        <NavLink to="/bets">My Bets</NavLink>
        <NavLink to="/challenges">
          Challenges{incoming > 0 && <span className="badge">{incoming}</span>}
        </NavLink>
        <NavLink to="/leaderboard">Leaderboard</NavLink>
        <NavLink to="/group">Group</NavLink>
        {user?.isSuper && <NavLink to="/admin">🛡️ Admin</NavLink>}
      </nav>
      <span className="spacer" />
      {me && (
        <Link to="/bets" className="balance-chip" title="Your coins in this group">
          <Coins n={me.balance} />
        </Link>
      )}
      {user && (
        <div className="menu" ref={ref}>
          <button className="row" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => setOpen((v) => !v)} aria-label="Account menu">
            <Avatar name={user.username} />
          </button>
          {open && (
            <div className="menu-pop">
              <div className="label">Signed in as</div>
              <div className="item" style={{ fontWeight: 700 }}>
                <Avatar name={user.username} size="sm" /> {user.username}
                {user.isSuper && <span className="pill">site admin</span>}
              </div>
              {user.isSuper && (
                <button
                  className="item"
                  onClick={() => {
                    setOpen(false);
                    nav('/admin');
                  }}
                >
                  🛡️ Admin dashboard
                </button>
              )}
              <div className="sep" />
              <div className="label">Your groups</div>
              {groups.map((g) => (
                <button
                  key={g.id}
                  className="item"
                  onClick={() => {
                    setGroupId(g.id);
                    setOpen(false);
                  }}
                >
                  <span style={{ width: 16 }}>{g.id === group?.id ? '✓' : ''}</span> {g.name}
                </button>
              ))}
              <button
                className="item"
                onClick={() => {
                  setOpen(false);
                  nav('/group?new=1');
                }}
              >
                <span style={{ width: 16 }}>＋</span> Create or join a group
              </button>
              <div className="sep" />
              <div className="label">Odds format</div>
              <div style={{ padding: '4px 8px 8px' }}>
                <div className="seg">
                  {(['decimal', 'fractional', 'american'] as OddsFormat[]).map((f) => (
                    <button key={f} className={oddsFormat === f ? 'on' : ''} onClick={() => setOddsFormat(f)}>
                      {f === 'decimal' ? '2.50' : f === 'fractional' ? '3/2' : '+150'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sep" />
              <button className="item" onClick={() => backend.signOut()}>
                ⎋ Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function Sidebar() {
  const loc = useLocation();
  const { data } = useApp();
  const hasSpecials = data && Object.values(data.events).some((e) => e.sport === 'custom');
  return (
    <aside className="sidebar">
      <div className="side-title">Browse</div>
      <NavLink to="/" end className="side-link">
        <span className="ico">🔥</span> Top events
      </NavLink>
      <NavLink to="/live" className="side-link">
        <span className="ico">📡</span> Live now
      </NavLink>
      {hasSpecials && (
        <NavLink to="/specials" className="side-link">
          <span className="ico">⭐</span> Group specials
        </NavLink>
      )}
      <div className="side-title" style={{ marginTop: 10 }}>
        Sports
      </div>
      {SPORTS.map((s) => {
        const active = loc.pathname.startsWith(`/sport/${s.key}`);
        const params = new URLSearchParams(loc.search);
        return (
          <div key={s.key}>
            <NavLink to={`/sport/${s.key}`} className="side-link">
              <span className="ico">{s.icon}</span> {s.name}
            </NavLink>
            {active && s.leagues.length > 1 && (
              <div className="side-sub">
                {s.leagues.map((l) => (
                  <Link key={l.key} to={`/sport/${s.key}?league=${encodeURIComponent(l.key)}`} className={params.get('league') === l.key ? 'active' : ''}>
                    {l.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="footer-note">
        Free live data via ESPN.
        <br />
        Coins have no cash value.
      </div>
    </aside>
  );
}

function BottomNav() {
  const incoming = useIncomingChallenges();
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end>
        <span className="i">🏟️</span>Sports
      </NavLink>
      <NavLink to="/bets">
        <span className="i">🎟️</span>My Bets
      </NavLink>
      <NavLink to="/challenges">
        <span className="i">⚔️</span>Challenges
        {incoming > 0 && <span className="dot" />}
      </NavLink>
      <NavLink to="/leaderboard">
        <span className="i">🏆</span>Ranks
      </NavLink>
      <NavLink to="/group">
        <span className="i">👥</span>Group
      </NavLink>
    </nav>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'success' ? '✅' : t.kind === 'error' ? '⚠️' : 'ℹ️'} {t.text}
        </div>
      ))}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { slip, slipOpen, setSlipOpen, backend } = useApp();
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <>
      <TopBar />
      <div className="shell">
        <Sidebar />
        <main className="main">
          {backend.mode === 'demo' && (
            <div className="banner warn">
              🧪 <span>
                <b>Demo mode</b> — data is saved in this browser only. Connect the free Supabase database (see README) so your friends can play from their own phones.
              </span>
            </div>
          )}
          {children}
        </main>
        <aside className="slip-col">
          <BetSlip />
        </aside>
      </div>
      <BottomNav />
      {slip.length > 0 && !slipOpen && (
        <button className="slip-fab" onClick={() => setSlipOpen(true)}>
          🎟️ Bet slip · {slip.length}
        </button>
      )}
      {slipOpen && (
        <>
          <div className="drawer-bg" onClick={() => setSlipOpen(false)} />
          <div className="drawer">
            <BetSlip onClose={() => setSlipOpen(false)} />
          </div>
        </>
      )}
      <Toasts />
    </>
  );
}
