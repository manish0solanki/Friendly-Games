import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fmtCoins, formatOdds, OUTCOME_INDEX } from '../lib/odds';
import { CONFIRM_SECONDS, fetchQuote, hasQuotes } from '../lib/quote';
import type { Outcome } from '../lib/types';
import { sportIcon } from '../lib/sports';
import { eventPath, kickoff, pickLabel } from '../lib/util';
import { Coins, ConfirmingNote, Empty } from '../components/bits';

function CashOutButton({ betId, eventId, startTime, stake, odds, pick }: { betId: string; eventId: string; startTime: string; stake: number; odds: number; pick: Outcome }) {
  const { backend, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const q = await fetchQuote(eventId, startTime);
      const now = q.payload.odds?.[OUTCOME_INDEX[pick]];
      if (q.payload.state !== 'in' || !now) throw new Error('Cash out is only available while the match is live with a price');
      const est = Math.max(0.01, Math.round(((stake * odds) / now) * 100) / 100);
      if (!confirm(`Cash out now for about ${fmtCoins(est)} coins?\n\nScore ${q.payload.score} (${q.payload.status}). It confirms after ${CONFIRM_SECONDS} seconds if the score doesn't change.`)) return;
      const v = await backend.requestCashout(betId, q);
      toast(`Cash out of ${fmtCoins(v)} requested — confirms in ${CONFIRM_SECONDS}s ⏱️`, 'info');
      await refresh();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="btn sm" style={{ marginTop: 6, borderColor: 'rgba(168,85,247,.5)' }} disabled={busy} onClick={go}>
      {busy ? 'Checking price…' : '💸 Cash out'}
    </button>
  );
}

export function MyBets() {
  const { data, user, oddsFormat } = useApp();
  const [tab, setTab] = useState<'open' | 'settled'>('open');
  if (!data || !user) return null;
  const mine = data.bets.filter((b) => b.userId === user.id);
  const open = mine.filter((b) => b.status === 'open' || b.status === 'pending');
  const settled = mine.filter((b) => b.status !== 'open' && b.status !== 'pending').sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''));
  const decided = settled.filter((b) => b.status === 'won' || b.status === 'lost');
  const won = decided.filter((b) => b.status === 'won');
  const profit = settled.filter((b) => b.status !== 'void').reduce((a, b) => a + (b.payout - b.stake), 0);
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
                    {b.live && <span className="live-tag" style={{ marginRight: 6 }}>● LIVE</span>}
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
                  {b.status === 'pending' && <ConfirmingNote since={b.createdAt} />}
                  {b.status === 'open' && b.cashoutRequestedAt && <ConfirmingNote since={b.cashoutRequestedAt} what="Cash out" />}
                </div>
                <div className="amt">
                  <span className={`status ${b.status}`}>{b.status === 'pending' ? 'confirming…' : b.status === 'cashed' ? 'cashed out' : b.status}</span>
                  <div className="num" style={{ marginTop: 6 }}>
                    Stake <b>{fmtCoins(b.stake)}</b>
                  </div>
                  <div className="sub num">
                    {b.status === 'pending' ? (
                      <>To return {fmtCoins(b.stake * b.odds)}</>
                    ) : b.status === 'open' ? (
                      <>To return {fmtCoins(b.stake * b.odds)}</>
                    ) : b.status === 'cashed' ? (
                      <span className={b.payout >= b.stake ? 'pos' : 'neg'}>Cashed out {fmtCoins(b.payout)}</span>
                    ) : b.status === 'won' ? (
                      <span className="pos">Returned {fmtCoins(b.payout)}</span>
                    ) : b.status === 'void' ? (
                      <>Refunded {fmtCoins(b.payout)}</>
                    ) : (
                      <span className="neg">Lost</span>
                    )}
                  </div>
                  {b.status === 'open' && b.cashoutRequestedAt && (
                    <div className="sub" style={{ color: '#d8b4fe' }}>
                      Cashing out for {fmtCoins(b.cashoutValue ?? 0)}
                    </div>
                  )}
                  {b.status === 'open' && !b.cashoutRequestedAt && data.group.liveBetting && hasQuotes(ev.id) && !ev.settledAt && Date.parse(ev.startTime) <= Date.now() && (
                    <CashOutButton betId={b.id} eventId={ev.id} startTime={ev.startTime} stake={b.stake} odds={b.odds} pick={b.pick} />
                  )}
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
