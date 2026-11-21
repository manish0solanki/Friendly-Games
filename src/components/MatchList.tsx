import { Link } from 'react-router-dom';
import { useApp } from '../lib/store';
import { formatOdds } from '../lib/odds';
import { sportIcon } from '../lib/sports';
import { hasLiveRules } from '../lib/espnParse';
import { eventPath, isBettable, isLiveBettable, kickoff, lineFor } from '../lib/util';
import type { Match, Outcome } from '../lib/types';
import { TeamLogo } from './bits';

export function outcomesFor(m: { allowDraw: boolean }): Outcome[] {
  return m.allowDraw ? ['home', 'draw', 'away'] : ['home', 'away'];
}

const SHORT: Record<Outcome, string> = { home: '1', draw: 'X', away: '2' };

export function OddsButtons({ match, big }: { match: Match; big?: boolean }) {
  const { data, slip, toggleSelection, oddsFormat, group } = useApp();
  const line = lineFor(match, data);
  const stored = data?.events[match.id];
  const live = isLiveBettable(match, stored, group);
  const open = (!!group && isBettable(match, stored)) || live;
  const sel = slip.find((s) => s.match.id === match.id);
  const outs = outcomesFor(match);
  const idx = { home: 0, away: 1, draw: 2 } as const;
  if (match.state === 'in' && !live && !big) {
    const why = !match.liveOdds
      ? hasLiveRules(match.sport)
        ? 'Odds suspended'
        : 'No in-play odds'
      : !group?.liveBetting
        ? 'Live betting off'
        : 'In-play closed';
    return (
      <div className="odds-grid" style={{ ['--cols' as any]: outs.length }}>
        <Link to={eventPath(match.id)} className="odd-note" style={{ gridColumn: '1 / -1' }} title="Pre-match odds closed at kick-off. In-play challenges may still be open.">
          {why}
          <span>Challenge a friend ›</span>
        </Link>
      </div>
    );
  }
  return (
    <div className={big ? 'big-odds' : 'odds-grid'} style={{ ['--cols' as any]: outs.length }}>
      {outs.map((o) => (
        <button
          key={o}
          className={`odd ${live ? 'live' : ''} ${sel?.pick === o ? 'sel' : ''} ${match.result === o ? 'result-win' : ''}`}
          disabled={!open}
          onClick={() => toggleSelection(match, o)}
          title={
            open
              ? `${live ? 'Live: back' : 'Back'} ${o === 'draw' ? 'the draw' : o === 'home' ? match.home.name : match.away.name}`
              : match.state === 'in'
                ? 'In-play betting is closed for this match'
                : 'Betting closed'
          }
        >
          <span className="lbl">{big ? (o === 'home' ? match.home.name : o === 'away' ? match.away.name : 'Draw') : SHORT[o]}</span>
          <span className="val">{open ? formatOdds(line[idx[o]], oddsFormat) : match.result === o ? '✓' : '—'}</span>
        </button>
      ))}
    </div>
  );
}

export function MatchRow({ m, showLeague }: { m: Match; showLeague?: boolean }) {
  const { data } = useApp();
  const { day, time } = kickoff(m.startTime);
  const betCount = data ? data.bets.filter((b) => b.eventId === m.id).length + data.challenges.filter((c) => c.eventId === m.id && c.status !== 'cancelled').length : 0;
  const showScore = m.state !== 'pre' && (m.home.score != null || m.away.score != null);
  return (
    <div className="match">
      <div className="m-time">
        {m.state === 'in' ? (
          <>
            <span className="live-pill">LIVE</span>
            <span>{m.statusText}</span>
          </>
        ) : m.state === 'post' ? (
          <>
            <b>{m.result === 'void' ? 'Off' : 'FT'}</b>
            <span>{day}</span>
          </>
        ) : (
          <>
            <b>{time}</b>
            <span>{day}</span>
          </>
        )}
      </div>
      <Link to={eventPath(m.id)} className="m-teams">
        {m.custom && <div style={{ fontWeight: 800 }}>{m.name}</div>}
        {(['home', 'away'] as const).map((side) => {
          const t = m[side];
          return (
            <div key={side} className={`m-team ${m.result === side ? 'win' : ''}`}>
              <TeamLogo src={t.logo} name={t.name} />
              <span className="nm">{t.name}</span>
              {showScore && <span className="sc">{t.score ?? ''}</span>}
            </div>
          );
        })}
        <div className="m-meta">
          {showLeague && (
            <span>
              {sportIcon(m.sport)} {m.league}
            </span>
          )}
          {betCount > 0 && <span style={{ color: 'var(--accent)' }}>● {betCount} in your group</span>}
          <span>More markets ›</span>
        </div>
      </Link>
      <OddsButtons match={m} />
    </div>
  );
}

export function LeagueBlock({ title, sport, matches }: { title: string; sport: string; matches: Match[] }) {
  return <ListBlock icon={sportIcon(sport)} title={title} matches={matches} />;
}

/** A card of match rows. With `showLeague`, each row names its competition (for mixed lists). */
export function ListBlock({ icon, title, matches, showLeague }: { icon: string; title: string; matches: Match[]; showLeague?: boolean }) {
  const colSet = new Set(matches.map((m) => (m.allowDraw ? 3 : 2)));
  const cols = colSet.size === 1 ? [...colSet][0] : 0; // mixed 2- and 3-way markets: buttons carry their own labels
  return (
    <div className="card league-block">
      <div className="league-head">
        <span>{icon}</span>
        <span>{title}</span>
        <span className="dim" style={{ fontWeight: 600 }}>
          {matches.length}
        </span>
        {cols > 0 && (
          <div className="mk" style={{ ['--cols' as any]: cols }}>
            {cols === 3 ? (
              <>
                <span>1</span>
                <span>X</span>
                <span>2</span>
              </>
            ) : (
              <>
                <span>1</span>
                <span>2</span>
              </>
            )}
          </div>
        )}
      </div>
      {matches.map((m) => (
        <MatchRow key={m.id} m={m} showLeague={showLeague} />
      ))}
    </div>
  );
}

/** Upcoming matches in kick-off order, one card per day. */
export function DayGroupedMatches({ matches }: { matches: Match[] }) {
  const days = new Map<string, Match[]>();
  for (const m of matches) {
    const d = kickoff(m.startTime).day;
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(m);
  }
  return (
    <>
      {[...days.entries()].map(([d, ms]) => (
        <ListBlock key={d} icon="📅" title={d} matches={ms} showLeague />
      ))}
    </>
  );
}

export function GroupedMatches({ matches }: { matches: Match[] }) {
  const groups = new Map<string, Match[]>();
  for (const m of matches) {
    const k = `${m.sport}|${m.league}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }
  return (
    <>
      {[...groups.entries()].map(([k, ms]) => (
        <LeagueBlock key={k} title={ms[0].league} sport={ms[0].sport} matches={ms} />
      ))}
    </>
  );
}
