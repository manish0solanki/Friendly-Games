import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fmtCoins, formatOdds } from '../lib/odds';
import { sportIcon } from '../lib/sports';
import { ago, eventPath, kickoff, pickLabel } from '../lib/util';
import type { AdminOverview, Bet } from '../lib/types';
import { Avatar, Coins, Empty } from '../components/bits';

type Tab = 'players' | 'bets' | 'challenges' | 'groups';

/** Site-admin dashboard: every player, group, bet and challenge across the whole site. */
export function AdminPage() {
  const { backend, user, setGroupId, oddsFormat, toast } = useApp();
  const nav = useNavigate();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [tab, setTab] = useState<Tab>('players');
  const [q, setQ] = useState('');
  const [betFilter, setBetFilter] = useState<'all' | 'open' | 'settled'>('all');
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await backend.adminOverview());
    } catch (e: any) {
      toast(e.message ?? 'Could not load admin data', 'error');
    }
  }, [backend, toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const idx = useMemo(() => {
    if (!data) return null;
    const userName = new Map(data.players.map((p) => [p.id, p.username]));
    const groupName = new Map(data.groups.map((g) => [g.id, g.name]));
    return { userName, groupName };
  }, [data]);

  if (!user?.isSuper) return <Empty icon="🔒" title="Admins only" />;
  if (!data || !idx) return <div className="skeleton" style={{ height: 300 }} />;

  const name = (id?: string | null) => (id ? idx.userName.get(id) ?? 'unknown' : '—');
  const gname = (id: string) => idx.groupName.get(id) ?? 'unknown group';
  const ql = q.trim().toLowerCase();
  const openBets = data.bets.filter((b) => b.status === 'open');
  const inPlay =
    openBets.reduce((a, b) => a + b.stake, 0) +
    data.challenges.filter((c) => c.status === 'open' || c.status === 'matched').reduce((a, c) => a + c.stake + (c.takerId ? c.takerStake : 0), 0);

  const playerRows = data.players
    .filter((p) => !ql || p.username.includes(ql))
    .map((p) => {
      const memberships = data.members.filter((m) => m.userId === p.id);
      const bets = data.bets.filter((b) => b.userId === p.id);
      const decided = bets.filter((b) => b.status === 'won' || b.status === 'lost');
      const profit = decided.reduce((a, b) => a + b.payout - b.stake, 0);
      return { p, memberships, bets, open: bets.filter((b) => b.status === 'open').length, decided, won: decided.filter((b) => b.status === 'won').length, profit };
    });

  const betRow = (b: Bet, showPlayer = true) => {
    const ev = data.events[b.eventId];
    return (
      <tr key={b.id}>
        <td className="dim" style={{ whiteSpace: 'nowrap' }}>{ago(b.createdAt)}</td>
        {showPlayer && (
          <td>
            <div className="row">
              <Avatar name={name(b.userId)} size="sm" />
              <b>{name(b.userId)}</b>
            </div>
          </td>
        )}
        <td className="hide-mobile dim">{gname(b.groupId)}</td>
        <td style={{ minWidth: 180 }}>
          {ev ? (
            <>
              <Link to={eventPath(ev.id)} style={{ textDecoration: 'underline' }}>
                {sportIcon(ev.sport)} {ev.name}
              </Link>
              <div className="dim" style={{ fontSize: 12 }}>
                {ev.league} · {kickoff(ev.startTime).day}
              </div>
            </>
          ) : (
            <span className="dim">{b.eventId}</span>
          )}
        </td>
        <td>
          <b>{ev ? pickLabel(ev, b.pick) : b.pick}</b>
        </td>
        <td className="r num" style={{ whiteSpace: 'nowrap' }}>
          {fmtCoins(b.stake)} <span style={{ color: 'var(--gold)' }}>@ {formatOdds(b.odds, oddsFormat)}</span>
        </td>
        <td className="r">
          <span className={`status ${b.status}`}>{b.status}</span>
          {b.status !== 'open' && b.status !== 'lost' && <div className="dim num" style={{ fontSize: 12 }}>{fmtCoins(b.payout)}</div>}
        </td>
      </tr>
    );
  };

  const betHead = (showPlayer = true) => (
    <thead>
      <tr>
        <th>When</th>
        {showPlayer && <th>Player</th>}
        <th className="hide-mobile">Group</th>
        <th>Event</th>
        <th>Pick</th>
        <th className="r">Stake</th>
        <th className="r">Status</th>
      </tr>
    </thead>
  );

  const bets = data.bets.filter(
    (b) =>
      (betFilter === 'all' || (betFilter === 'open' ? b.status === 'open' : b.status !== 'open')) &&
      (!ql || name(b.userId).includes(ql) || (data.events[b.eventId]?.name ?? '').toLowerCase().includes(ql)),
  );

  return (
    <>
      <div className="page-title">
        <h1>🛡️ Admin</h1>
        <span className="muted">Everything across all groups</span>
        <span className="spacer" />
        <button className="btn sm" onClick={load}>
          ↻ Refresh
        </button>
      </div>

      <div className="grid-3" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="card stat">
          <div className="k">Players</div>
          <div className="v num">{data.players.filter((p) => !p.isSuper).length}</div>
        </div>
        <div className="card stat">
          <div className="k">Groups</div>
          <div className="v num">{data.groups.length}</div>
        </div>
        <div className="card stat">
          <div className="k">Open bets</div>
          <div className="v num">{openBets.length}</div>
        </div>
        <div className="card stat">
          <div className="k">Coins in play</div>
          <div className="v">
            <Coins n={inPlay} />
          </div>
        </div>
      </div>

      <div className="tabs">
        {(['players', 'bets', 'challenges', 'groups'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}{' '}
            <span className="dim">
              {t === 'players' ? data.players.length : t === 'bets' ? data.bets.length : t === 'challenges' ? data.challenges.length : data.groups.length}
            </span>
          </button>
        ))}
      </div>

      {(tab === 'players' || tab === 'bets') && (
        <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="input" style={{ maxWidth: 320 }} placeholder={tab === 'players' ? 'Search players…' : 'Search player or match…'} value={q} onChange={(e) => setQ(e.target.value)} />
          {tab === 'bets' && (
            <div className="seg">
              {(['all', 'open', 'settled'] as const).map((f) => (
                <button key={f} className={betFilter === f ? 'on' : ''} onClick={() => setBetFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'players' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {playerRows.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Groups · balance</th>
                  <th className="r">Open</th>
                  <th className="r hide-mobile">Won</th>
                  <th className="r">P/L</th>
                  <th className="r hide-mobile">Joined</th>
                </tr>
              </thead>
              <tbody>
                {playerRows.map((r) => (
                  <Fragment key={r.p.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setOpenPlayer(openPlayer === r.p.id ? null : r.p.id)}>
                      <td>
                        <div className="row">
                          <span className="dim">{openPlayer === r.p.id ? '▾' : '▸'}</span>
                          <Avatar name={r.p.username} size="sm" />
                          <b>{r.p.username}</b>
                          {r.p.isSuper && <span className="pill">site admin</span>}
                        </div>
                      </td>
                      <td>
                        {r.memberships.length ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {r.memberships.map((m) => (
                              <span key={m.groupId} className="pill">
                                {gname(m.groupId)} · {fmtCoins(m.balance)}
                                {m.role === 'admin' ? ' ★' : ''}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="dim">no group</span>
                        )}
                      </td>
                      <td className="r num">{r.open}</td>
                      <td className="r num hide-mobile">
                        {r.won}/{r.decided.length}
                      </td>
                      <td className={`r num ${r.profit > 0 ? 'pos' : r.profit < 0 ? 'neg' : ''}`}>
                        {r.profit > 0 ? '+' : ''}
                        {fmtCoins(r.profit)}
                      </td>
                      <td className="r dim hide-mobile">{r.p.createdAt ? ago(r.p.createdAt) : ''}</td>
                    </tr>
                    {openPlayer === r.p.id && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--bg-2)', padding: 0 }}>
                          {r.bets.length ? (
                            <div style={{ overflowX: 'auto' }}>
                              <table className="table">
                                {betHead(false)}
                                <tbody>{r.bets.map((b) => betRow(b, false))}</tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="empty" style={{ padding: 16 }}>
                              No bets yet.
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon="👤" title="No players found" />
          )}
        </div>
      )}

      {tab === 'bets' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {bets.length ? (
            <table className="table">
              {betHead()}
              <tbody>{bets.map((b) => betRow(b))}</tbody>
            </table>
          ) : (
            <Empty icon="🎟️" title="No bets match" />
          )}
        </div>
      )}

      {tab === 'challenges' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {data.challenges.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Challenge</th>
                  <th className="hide-mobile">Group</th>
                  <th>Event</th>
                  <th className="r">Pot</th>
                  <th className="r">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.challenges.map((c) => {
                  const ev = data.events[c.eventId];
                  return (
                    <tr key={c.id}>
                      <td className="dim" style={{ whiteSpace: 'nowrap' }}>{ago(c.createdAt)}</td>
                      <td>
                        <b>{name(c.creatorId)}</b> backs <b>{ev ? pickLabel(ev, c.pick) : c.pick}</b> @{' '}
                        <span style={{ color: 'var(--gold)' }}>{formatOdds(c.odds, oddsFormat)}</span>
                        <div className="dim" style={{ fontSize: 12 }}>
                          vs {c.takerId ? name(c.takerId) : c.targetId ? `${name(c.targetId)} (invited)` : 'anyone'}
                          {c.message && <> · “{c.message}”</>}
                        </div>
                      </td>
                      <td className="hide-mobile dim">{gname(c.groupId)}</td>
                      <td>{ev ? <Link to={eventPath(ev.id)} style={{ textDecoration: 'underline' }}>{ev.name}</Link> : '—'}</td>
                      <td className="r num" style={{ whiteSpace: 'nowrap' }}>
                        {fmtCoins(c.stake)} vs {fmtCoins(c.takerStake)}
                      </td>
                      <td className="r">
                        <span className={`status ${c.status === 'settled' ? 'won' : c.status}`}>{c.status === 'settled' ? `${name(c.winnerId)} won` : c.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty icon="⚔️" title="No challenges yet" />
          )}
        </div>
      )}

      {tab === 'groups' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {data.groups.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Invite code</th>
                  <th className="r">Members</th>
                  <th className="r hide-mobile">Bets</th>
                  <th className="hide-mobile">Created by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <b>{g.name}</b>
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: '.1em' }}>{g.inviteCode}</td>
                    <td className="r num">{data.members.filter((m) => m.groupId === g.id).length}</td>
                    <td className="r num hide-mobile">{data.bets.filter((b) => b.groupId === g.id).length}</td>
                    <td className="hide-mobile">{name(g.createdBy)}</td>
                    <td className="r">
                      <button
                        className="btn sm"
                        onClick={() => {
                          setGroupId(g.id);
                          nav('/group');
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon="👥" title="No groups yet" />
          )}
        </div>
      )}
    </>
  );
}
