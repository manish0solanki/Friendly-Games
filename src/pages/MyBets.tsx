import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fmtCoins, formatOdds } from '../lib/odds';
import { sportIcon } from '../lib/sports';
import { eventPath, kickoff, pickLabel } from '../lib/util';
import { Coins, Empty } from '../components/bits';

export function MyBets() {
  const { data, user, oddsFormat } = useApp();
  const [tab, setTab] = useState<'open' | 'settled'>('open');
  if (!data || !user) return null;
  const mine = data.bets.filter((b) => b.userId === user.id);
  const open = mine.filter((b) => b.status === 'open');
  const settled = mine.filter((b) => b.status !== 'open').sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''));
  const decided = settled.filter((b) => b.status === 'won' || b.status === 'lost');
  const won = decided.filter((b) => b.status === 'won');
  const profit = decided.reduce((a, b) => a + (b.payout - b.stake), 0);
  const me = data.members.find((m) => m.userId === user.id);
  const list = tab === 'open' ? open : settled;

  return (
    <>
      <div className="page-title">
        <h1>🎟️ My bets</h1>
      </div>
      <div className="grid-3" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="card stat">
          <div className="k">Balance</div>
          <div className="v">
            <Coins n={me?.balance ?? 0} />
          </div>
        </div>
        <div className="card stat">
          <div className="k">In play</div>
          <div className="v num">{fmtCoins(open.reduce((a, b) => a + b.stake, 0))}</div>
        </div>
        <div className="card stat">
          <div className="k">Profit / loss</div>
          <div className={`v num ${profit > 0 ? 'pos' : profit < 0 ? 'neg' : ''}`}>
            {profit > 0 ? '+' : ''}
            {fmtCoins(profit)}
          </div>
        </div>
        <div className="card stat">
          <div className="k">Win rate</div>
          <div className="v num">{decided.length ? `${Math.round((won.length / decided.length) * 100)}%` : '—'}</div>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
          Open <span className="dim">{open.length}</span>
        </button>
        <button className={`tab ${tab === 'settled' ? 'active' : ''}`} onClick={() => setTab('settled')}>
          Settled <span className="dim">{settled.length}</span>
        </button>
      </div>
      <div className="card">
        {list.length ? (
          list.map((b) => {
            const ev = data.events[b.eventId];
            if (!ev) return null;
            const k = kickoff(ev.startTime);
            return (
              <div className="bet-item" key={b.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="title">
                    {pickLabel(ev, b.pick)} <span style={{ color: 'var(--gold)' }}>@ {formatOdds(b.odds, oddsFormat)}</span>
                  </div>
                  <div className="sub">
                    {sportIcon(ev.sport)}{' '}
                    <Link to={eventPath(ev.id)} style={{ textDecoration: 'underline' }}>
                      {ev.name}
                    </Link>
                  </div>
                  <div className="sub">
                    {ev.league} · {k.day} {k.time}
                  </div>
                </div>
                <div className="amt">
                  <span className={`status ${b.status}`}>{b.status}</span>
                  <div className="num" style={{ marginTop: 6 }}>
                    Stake <b>{fmtCoins(b.stake)}</b>
                  </div>
                  <div className="sub num">
                    {b.status === 'open' ? (
                      <>To return {fmtCoins(b.stake * b.odds)}</>
                    ) : b.status === 'won' ? (
                      <span className="pos">Returned {fmtCoins(b.payout)}</span>
                    ) : b.status === 'void' ? (
                      <>Refunded {fmtCoins(b.payout)}</>
                    ) : (
                      <span className="neg">Lost</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <Empty icon="🎟️" title={tab === 'open' ? 'No open bets' : 'Nothing settled yet'}>
            <Link to="/" className="btn primary sm" style={{ marginTop: 12 }}>
              Browse matches
            </Link>
          </Empty>
        )}
      </div>
    </>
  );
}
