import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fetchMatch } from '../lib/espn';
import { fmtCoins, formatOdds, stakesFor } from '../lib/odds';
import { sportIcon } from '../lib/sports';
import { ago, isBettable, kickoff, pickLabel, storedToMatch } from '../lib/util';
import type { Match } from '../lib/types';
import { Avatar, Empty, TeamLogo } from '../components/bits';
import { OddsButtons, outcomesFor } from '../components/MatchList';
import { ChallengeModal } from '../components/BetSlip';
import { ChallengeCard } from './Challenges';

export function EventPage() {
  const { id: rawId = '' } = useParams();
  const id = decodeURIComponent(rawId);
  const { data, user, oddsFormat, reportMatches, group } = useApp();
  const stored = data?.events[id];
  const [live, setLive] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [challengeOpen, setChallengeOpen] = useState(false);

  useEffect(() => {
    if (id.startsWith('custom:')) {
      setLoading(false);
      return;
    }
    let alive = true;
    const load = async () => {
      const m = await fetchMatch(id);
      if (!alive) return;
      setLive(m);
      setLoading(false);
      if (m) reportMatches([m]);
    };
    load();
    const t = setInterval(load, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, reportMatches]);

  const match: Match | null = live ? { ...live, baseProbs: stored?.baseProbs ?? live.baseProbs } : stored ? storedToMatch(stored) : null;
  if (!match) return loading ? <div className="skeleton" style={{ height: 220 }} /> : <Empty icon="🔎" title="Event not found" />;

  const bets = data?.bets.filter((b) => b.eventId === id) ?? [];
  const challenges = data?.challenges.filter((c) => c.eventId === id && c.status !== 'cancelled') ?? [];
  const nameOf = (uid?: string | null) => data?.members.find((m) => m.userId === uid)?.username ?? 'someone';
  const stakes = data ? stakesFor(data.bets, id) : [0, 0, 0];
  const pool = stakes[0] + stakes[1] + stakes[2];
  const k = kickoff(match.startTime);
  const open = !!group && isBettable(match, stored);
  const colors = { home: '#3b82f6', draw: '#94a3b8', away: '#f97316' };
  const showScore = match.state !== 'pre' && (match.home.score != null || match.away.score != null);

  return (
    <>
      <div className="row muted" style={{ marginBottom: 12, fontSize: 13 }}>
        <Link to="/">Sports</Link> › <span>{match.league}</span>
      </div>
      <section className="scoreboard">
        <div className="sb-league">
          {sportIcon(match.sport)} {match.league}
        </div>
        <div className="sb-main">
          <div className="sb-team">
            <TeamLogo src={match.home.logo} name={match.home.name} />
            {match.home.name}
          </div>
          <div className="sb-score">{showScore ? `${match.home.score ?? '-'} – ${match.away.score ?? '-'}` : 'vs'}</div>
          <div className="sb-team">
            <TeamLogo src={match.away.logo} name={match.away.name} />
            {match.away.name}
          </div>
        </div>
        <div className="sb-status">
          {match.state === 'in' ? (
            <span className="live-pill">LIVE {match.statusText}</span>
          ) : match.state === 'post' ? (
            <b>{match.result === 'void' ? 'Called off / no result — stakes returned' : `Final${match.result ? ` · ${pickLabel(match, match.result as any)}${match.result === 'draw' ? '' : ' won'}` : ''}`}</b>
          ) : (
            <>
              {k.day} · {k.time}
            </>
          )}
          {match.venue && <div className="dim">{match.venue}</div>}
        </div>
      </section>

      <div className="grid-2">
        <div>
          <div className="card market">
            <div className="market-head">
              Match result <span className="pill">{match.allowDraw ? '1X2' : 'Moneyline'}</span>
              <span className="spacer" />
              {!open && <span className="dim" style={{ fontWeight: 600, fontSize: 12 }}>Closed</span>}
            </div>
            <div className="market-body">
              <OddsButtons match={match} big />
              {pool > 0 && (
                <>
                  <div className="split-bar">
                    {outcomesFor(match).map((o) => {
                      const v = stakes[o === 'home' ? 0 : o === 'away' ? 1 : 2];
                      return <span key={o} style={{ width: `${(v / pool) * 100}%`, background: colors[o] }} />;
                    })}
                  </div>
                  <div className="legend">
                    {outcomesFor(match).map((o) => (
                      <span key={o}>
                        <i style={{ background: colors[o] }} />
                        {pickLabel(match, o)} {fmtCoins(stakes[o === 'home' ? 0 : o === 'away' ? 1 : 2])}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <div className="dim" style={{ fontSize: 12, marginTop: 12 }}>
                The group line starts from bookmaker odds where available and moves as your friends bet. Your odds lock when you place.
              </div>
            </div>
          </div>

          <div className="card market">
            <div className="market-head">
              ⚔️ Head-to-head challenges
              <span className="spacer" />
              {open && (
                <button className="btn primary sm" onClick={() => setChallengeOpen(true)}>
                  New challenge
                </button>
              )}
            </div>
            {challenges.length ? (
              challenges.map((c) => <ChallengeCard key={c.id} c={c} compact />)
            ) : (
              <Empty icon="🤝" title="No challenges yet">
                {open ? 'Set your own odds and dare a friend to take the other side.' : 'Challenges close at kick-off.'}
              </Empty>
            )}
          </div>
        </div>

        <div className="card">
          <div className="market-head">
            Group action <span className="pill">{bets.length} bets</span>
          </div>
          {bets.length ? (
            bets.map((b) => (
              <div className="feed-item" key={b.id}>
                <Avatar name={nameOf(b.userId)} size="sm" />
                <div>
                  <b>{b.userId === user?.id ? 'You' : nameOf(b.userId)}</b> backed <b>{pickLabel(match, b.pick)}</b> — {fmtCoins(b.stake)} @{' '}
                  <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{formatOdds(b.odds, oddsFormat)}</span>
                  {b.status !== 'open' && <span className={`status ${b.status}`} style={{ marginLeft: 8 }}>{b.status}</span>}
                </div>
                <span className="when">{ago(b.createdAt)}</span>
              </div>
            ))
          ) : (
            <Empty icon="🎯" title="Be the first to bet">
              Nobody in {group?.name ?? 'your group'} has a bet on this yet.
            </Empty>
          )}
        </div>
      </div>
      {challengeOpen && <ChallengeModal match={match} onClose={() => setChallengeOpen(false)} />}
    </>
  );
}
