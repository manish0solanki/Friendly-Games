import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fetchMatch } from '../lib/espn';
import { hasLiveRules } from '../lib/espnParse';
import { CONFIRM_SECONDS, fetchQuote, hasQuotes } from '../lib/quote';
import { fmtCoins, formatOdds, stakesFor } from '../lib/odds';
import { sportIcon } from '../lib/sports';
import { ago, isBettable, isLiveBettable, kickoff, pickLabel, storedToMatch } from '../lib/util';
import type { Match } from '../lib/types';
import { Avatar, Empty, TeamLogo } from '../components/bits';
import { OddsButtons, outcomesFor } from '../components/MatchList';
import { ChallengeModal } from '../components/BetSlip';
import { ChallengeCard } from './Challenges';

export function EventPage() {
  const { id: rawId = '' } = useParams();
  const id = decodeURIComponent(rawId);
  const { data, user, oddsFormat, reportMatches, group, backend } = useApp();
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
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, reportMatches]);

  // While a match is live, poll the uncached signed live state every 15s so prices and the score stay fresh
  // (bookmakers suspend prices for a moment after goals; this picks them back up quickly).
  const isLive = live?.state === 'in';
  useEffect(() => {
    if (!isLive || !hasQuotes(id) || backend.mode !== 'online') return;
    let alive = true;
    const poll = async () => {
      try {
        const q = (await fetchQuote(id, live!.startTime)).payload;
        if (!alive) return;
        setLive((m) =>
          m
            ? {
                ...m,
                state: q.state,
                statusText: q.status || m.statusText,
                home: { ...m.home, score: q.homeScore ?? m.home.score },
                away: { ...m.away, score: q.awayScore ?? m.away.score },
                liveOdds: q.odds ?? undefined,
                liveOpen: q.liveOpen,
                challengeOpen: q.challengeOpen,
                result: q.result ?? undefined,
              }
            : m,
        );
      } catch {
        /* keep the last known state */
      }
    };
    poll();
    const t = setInterval(poll, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, isLive, backend]); // eslint-disable-line react-hooks/exhaustive-deps

  const match: Match | null = live ? { ...live, baseProbs: stored?.baseProbs ?? live.baseProbs } : stored ? storedToMatch(stored) : null;
  if (!match) return loading ? <div className="skeleton" style={{ height: 220 }} /> : <Empty icon="🔎" title="Event not found" />;

  const bets = data?.bets.filter((b) => b.eventId === id) ?? [];
  const challenges = data?.challenges.filter((c) => c.eventId === id && c.status !== 'cancelled') ?? [];
  const nameOf = (uid?: string | null) => data?.members.find((m) => m.userId === uid)?.username ?? 'someone';
  const stakes = data ? stakesFor(data.bets, id) : [0, 0, 0];
  const pool = stakes[0] + stakes[1] + stakes[2];
  const k = kickoff(match.startTime);
  const open = !!group && isBettable(match, stored);
  const liveOpen = isLiveBettable(match, stored, group);
  const challengeLive = !!group?.liveBetting && match.state === 'in' && !!match.challengeOpen && !match.custom && !stored?.settledAt;
  const liveClosedReason =
    match.state !== 'in' || match.custom
      ? null
      : !group?.liveBetting
        ? 'Live betting is turned off for this group (admins can switch it on in Group).'
        : !match.liveOdds
          ? hasLiveRules(match.sport)
            ? 'Live prices are suspended for a moment — this usually happens just after a goal or score. Checking again every 15 seconds…'
            : match.sport === 'cricket'
              ? 'In-play odds will appear once the scorecard has enough to go on (after the first ball). You can still challenge a friend below.'
              : 'There are no in-play odds for this sport, so live betting isn’t available. You can still challenge a friend below.'
          : !match.liveOpen
            ? match.sport === 'cricket'
              ? 'In-play betting has closed — the result is all but certain.'
              : 'In-play betting has closed for this match (football closes at 80′, NBA/NFL at the 4th quarter, NHL at the 3rd period, MLB after the 6th).'
            : null;
  const cricketNote =
    match.sport === 'cricket'
      ? match.cricketFormat === 'test'
        ? 'Test / multi-day match: three outcomes — a draw is possible.'
        : match.cricketFormat === 't20'
          ? 'T20 match.'
          : match.cricketFormat === 'odi'
            ? 'One-day match.'
            : null
      : null;
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
              {liveOpen && <span className="live-tag">● IN-PLAY</span>}
              <span className="spacer" />
              {!open && !liveOpen && (
                <span className="dim" style={{ fontWeight: 600, fontSize: 12 }}>
                  {match.state === 'in' && !match.liveOdds && hasLiveRules(match.sport) && group?.liveBetting ? 'Suspended' : 'Closed'}
                </span>
              )}
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
                {liveOpen
                  ? match.sport === 'cricket'
                    ? `In-play odds are calculated from the live scorecard by our cricket model (runs, wickets, overs${match.cricketFormat === 'test' ? ', lead and days left' : ' and target'}). Live bets confirm after ${CONFIRM_SECONDS} seconds if no wicket falls; betting pauses for a minute after every wicket.`
                    : `In-play prices come from a live bookmaker feed. Live bets confirm after ${CONFIRM_SECONDS} seconds if the score hasn’t changed; betting pauses for a minute after every goal or score.`
                  : liveClosedReason ??
                    'The group line starts from bookmaker odds where available and moves as your friends bet. Your odds lock when you place.'}
              </div>
              {cricketNote && (
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                  🏏 {cricketNote}
                </div>
              )}
            </div>
          </div>

          <div className="card market">
            <div className="market-head">
              ⚔️ Head-to-head challenges
              <span className="spacer" />
              {(open || challengeLive) && (
                <button className="btn primary sm" onClick={() => setChallengeOpen(true)}>
                  New challenge
                </button>
              )}
            </div>
            {challenges.length ? (
              challenges.map((c) => <ChallengeCard key={c.id} c={c} compact />)
            ) : (
              <Empty icon="🤝" title="No challenges yet">
                {open || challengeLive ? 'Set your own odds and dare a friend to take the other side.' : 'Challenges are closed for this match.'}
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
                  {b.live && <span className="live-tag" style={{ marginLeft: 8 }}>LIVE</span>}
                  {b.status !== 'open' && (
                    <span className={`status ${b.status}`} style={{ marginLeft: 8 }}>
                      {b.status === 'pending' ? 'confirming' : b.status === 'cashed' ? `cashed out ${fmtCoins(b.payout)}` : b.status}
                    </span>
                  )}
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
