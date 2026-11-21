import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store';
import { commissionOn, fmtCoins, formatOdds, netReturn, OUTCOME_INDEX, pct } from '../lib/odds';
import { CONFIRM_SECONDS, fetchQuote, hasQuotes, type Quote } from '../lib/quote';
import { cashOutValue, useLiveMatches } from '../lib/useLiveMatches';
import type { Bet, StoredEvent } from '../lib/types';
import { sportIcon } from '../lib/sports';
import { eventPath, kickoff, pickLabel } from '../lib/util';
import { Coins, ConfirmingNote, Empty, Modal } from '../components/bits';

interface CashOutTarget {
  bet: Bet;
  event: StoredEvent;
}

/** In-app cash-out sheet: shows the live score and the value before you commit. */
function CashOutModal({ target, onClose }: { target: CashOutTarget; onClose(): void }) {
  const { backend, refresh, toast, oddsFormat } = useApp();
  const { bet, event } = target;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // fetch a fresh signed price now, and keep it fresh while the sheet is open
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const q = await fetchQuote(event.id, event.startTime);
        if (alive) {
          setQuote(q);
          setError('');
        }
      } catch (e: any) {
        if (alive) setError(e.message);
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [event.id, event.startTime]);

  const p = quote?.payload;
  const current = p?.odds?.[OUTCOME_INDEX[bet.pick]];
  const rate = bet.commissionRate ?? 0;
  const gross = p?.state === 'in' ? cashOutValue(bet.stake, bet.odds, current) : null;
  const fee = gross ? commissionOn(gross - bet.stake, rate) : 0;
  const value = gross ? Math.round((gross - fee) * 100) / 100 : null;
  const unavailable = p && (p.state !== 'in' || !value);

  async function confirmCashOut() {
    setBusy(true);
    setError('');
    try {
      // prices are only valid for a few seconds, so sign a fresh one at the moment you confirm
      const q = await fetchQuote(event.id, event.startTime);
      const v = await backend.requestCashout(bet.id, q);
      const net = v - commissionOn(v - bet.stake, rate);
      toast(`Cashing out for ${fmtCoins(net)} — confirms in ${CONFIRM_SECONDS}s if the score holds ⏱️`, 'info');
      await refresh();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="💸 Cash out" onClose={onClose}>
      <div className="co-match">
        <div className="muted" style={{ fontSize: 12 }}>
          {sportIcon(event.sport)} {event.league}
        </div>
        <div className="co-teams">
          <span>{event.home.name}</span>
          <b className="co-score">{p ? `${p.homeScore ?? '-'} – ${p.awayScore ?? '-'}` : '…'}</b>
          <span>{event.away.name}</span>
        </div>
        {p && (
          <div style={{ textAlign: 'center' }}>
            {p.state === 'in' ? <span className="live-pill">LIVE {p.status}</span> : <span className="muted">{p.status}</span>}
          </div>
        )}
      </div>

      <div className="co-row">
        <span className="muted">Your bet</span>
        <b>
          {pickLabel(event, bet.pick)} @ <span style={{ color: 'var(--gold)' }}>{formatOdds(bet.odds, oddsFormat)}</span>
        </b>
      </div>
      <div className="co-row">
        <span className="muted">Stake · if it wins{rate > 0 ? ' (after commission)' : ''}</span>
        <b className="num">
          {fmtCoins(bet.stake)} · {fmtCoins(netReturn(bet.stake, bet.odds, rate))}
        </b>
      </div>
      <div className="co-row">
        <span className="muted">Current price</span>
        <b className="num">{current ? formatOdds(current, oddsFormat) : '—'}</b>
      </div>

      <div className="co-value">
        <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Cash out now for
        </div>
        <div className="co-amount">{!quote && !error ? '…' : value ? <Coins n={value} /> : '—'}</div>
        {value != null && (
          <div className={value >= bet.stake ? 'pos' : 'neg'} style={{ fontSize: 13, fontWeight: 700 }}>
            {value >= bet.stake ? '+' : ''}
            {fmtCoins(value - bet.stake)} vs your stake
          </div>
        )}
      </div>

      {unavailable && !error && <div className="err">Cash out isn’t available right now — prices may be suspended after a goal. Try again in a moment.</div>}
      {error && <div className="err">{error}</div>}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" style={{ flex: 1 }} onClick={onClose} disabled={busy}>
          Keep bet
        </button>
        <button className="btn primary" style={{ flex: 1.4 }} onClick={confirmCashOut} disabled={busy || !value}>
          {busy ? 'Cashing out…' : value ? `Cash out ${fmtCoins(value)}` : 'Cash out'}
        </button>
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 10, textAlign: 'center' }}>
        {fee > 0 && (
          <>
            Includes {pct(rate)} house commission on the profit ({fmtCoins(fee)}).{' '}
          </>
        )}
        Confirms after {CONFIRM_SECONDS} seconds if the score doesn’t change. The final amount uses the price at the moment you confirm.
      </div>
    </Modal>
  );
}

export function MyBets() {
  const { data, user, oddsFormat } = useApp();
  const [tab, setTab] = useState<'open' | 'settled'>('open');
  const [cashOut, setCashOut] = useState<CashOutTarget | null>(null);
  const openEvents = (data && user ? data.bets.filter((b) => b.userId === user.id && (b.status === 'open' || b.status === 'pending')) : [])
    .map((b) => data!.events[b.eventId])
    .filter(Boolean)
    .map((e) => ({ id: e.id, startTime: e.startTime, settled: !!e.settledAt }));
  const live = useLiveMatches(openEvents);
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
                  {live[ev.id] && live[ev.id].state !== 'pre' && (b.status === 'open' || b.status === 'pending') && (
                    <div className="bet-score">
                      {live[ev.id].state === 'in' ? <span className="live-pill">LIVE</span> : <b>FT</b>}
                      <span className="num">
                        {live[ev.id].home.short} <b>{live[ev.id].home.score ?? '-'}</b> – <b>{live[ev.id].away.score ?? '-'}</b> {live[ev.id].away.short}
                      </span>
                      {live[ev.id].state === 'in' && <span className="dim">{live[ev.id].statusText}</span>}
                    </div>
                  )}
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
                      <>To return {fmtCoins(netReturn(b.stake, b.odds, b.commissionRate ?? 0))}</>
                    ) : b.status === 'open' ? (
                      <>To return {fmtCoins(netReturn(b.stake, b.odds, b.commissionRate ?? 0))}</>
                    ) : b.status === 'cashed' ? (
                      <span className={b.payout >= b.stake ? 'pos' : 'neg'}>
                        Cashed out {fmtCoins(b.payout)}
                        {b.commission ? <span className="dim"> · commission {fmtCoins(b.commission)}</span> : null}
                      </span>
                    ) : b.status === 'won' ? (
                      <span className="pos">
                        Returned {fmtCoins(b.payout)}
                        {b.commission ? <span className="dim"> · commission {fmtCoins(b.commission)}</span> : null}
                      </span>
                    ) : b.status === 'void' ? (
                      <>Refunded {fmtCoins(b.payout)}</>
                    ) : (
                      <span className="neg">Lost</span>
                    )}
                  </div>
                  {b.status === 'open' && b.cashoutRequestedAt && (
                    <div className="sub" style={{ color: '#d8b4fe' }}>
                      Cashing out for {fmtCoins((b.cashoutValue ?? 0) - commissionOn((b.cashoutValue ?? 0) - b.stake, b.commissionRate ?? 0))}
                    </div>
                  )}
                  {b.status === 'open' && !b.cashoutRequestedAt && data.group.liveBetting && hasQuotes(ev.id) && !ev.settledAt && Date.parse(ev.startTime) <= Date.now() && (
                    <button className="btn sm cashout-btn" onClick={() => setCashOut({ bet: b, event: ev })}>
                      💸 Cash out
                      {(() => {
                        const m = live[ev.id];
                        const g = m?.state === 'in' ? cashOutValue(b.stake, b.odds, m.liveOdds?.[OUTCOME_INDEX[b.pick]]) : null;
                        const v = g ? g - commissionOn(g - b.stake, b.commissionRate ?? 0) : null;
                        return v ? <span className="num"> ≈ {fmtCoins(v)}</span> : null;
                      })()}
                    </button>
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
      {cashOut && <CashOutModal target={cashOut} onClose={() => setCashOut(null)} />}
    </>
  );
}
