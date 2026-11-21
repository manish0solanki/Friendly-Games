import { useState } from 'react';
import { useApp } from '../lib/store';
import { fmtCoins, formatOdds, OUTCOME_INDEX, takerStake } from '../lib/odds';
import { lineFor, pickLabel } from '../lib/util';
import type { Match, Outcome } from '../lib/types';
import { Coins, Modal } from './bits';
import { outcomesFor } from './MatchList';

export function BetSlip({ onClose }: { onClose?: () => void }) {
  const { slip, data, user, oddsFormat, updateStake, removeSelection, clearSlip, backend, group, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ match: Match; pick: Outcome } | null>(null);
  const me = data?.members.find((m) => m.userId === user?.id);
  const balance = me?.balance ?? 0;

  const items = slip.map((s) => {
    const odds = lineFor(s.match, data)[OUTCOME_INDEX[s.pick]];
    const stake = parseFloat(s.stake) || 0;
    return { ...s, odds, stakeN: stake, returns: stake * odds };
  });
  const total = items.reduce((a, x) => a + x.stakeN, 0);
  const totalReturns = items.reduce((a, x) => a + x.returns, 0);
  const valid = items.length > 0 && items.every((x) => x.stakeN >= 1) && total <= balance;

  async function place() {
    if (!group) return;
    setBusy(true);
    let ok = 0;
    for (const it of items) {
      try {
        await backend.placeBet(group.id, it.match, it.pick, it.stakeN);
        removeSelection(it.match.id);
        ok++;
      } catch (e: any) {
        toast(`${it.match.name}: ${e.message}`, 'error');
      }
    }
    await refresh();
    setBusy(false);
    if (ok) {
      toast(`${ok} bet${ok > 1 ? 's' : ''} placed. Good luck! 🍀`);
      if (!slip.length || ok === items.length) onClose?.();
    }
  }

  return (
    <div className="slip">
      <div className="slip-head">
        Bet slip {slip.length > 0 && <span className="n">{slip.length}</span>}
        <span className="spacer" />
        {slip.length > 0 && (
          <button className="btn ghost sm" onClick={clearSlip}>
            Clear
          </button>
        )}
        {onClose && (
          <button className="x" onClick={onClose} aria-label="Close bet slip">
            ×
          </button>
        )}
      </div>
      <div className="slip-body">
        {!group ? (
          <div className="slip-empty">
            <div className="big">👥</div>
            Join or create a group to start betting with friends.
          </div>
        ) : data && !me ? (
          <div className="slip-empty">
            <div className="big">🛡️</div>
            You're viewing <b>{group.name}</b> as site admin. Join it with its invite code to place bets.
          </div>
        ) : slip.length === 0 ? (
          <div className="slip-empty">
            <div className="big">🎟️</div>
            <div style={{ fontWeight: 700, color: 'var(--text)' }}>Your bet slip is empty</div>
            Tap any odds to add a selection.
            <div style={{ marginTop: 18 }}>
              <Coins n={balance} /> <span className="dim">available</span>
            </div>
          </div>
        ) : (
          items.map((it) => (
            <div className="sel-card" key={it.match.id}>
              <div className="top">
                <div style={{ minWidth: 0 }}>
                  <div className="pick">{pickLabel(it.match, it.pick)}</div>
                  <div className="ev">{it.match.name}</div>
                  <div className="ev">Match result · {it.match.league}</div>
                </div>
                <span className="price">{formatOdds(it.odds, oddsFormat)}</span>
                <button className="x" onClick={() => removeSelection(it.match.id)} aria-label="Remove">
                  ×
                </button>
              </div>
              <div className="stake-row">
                <input
                  className="input num"
                  inputMode="decimal"
                  placeholder="Stake"
                  value={it.stake}
                  onChange={(e) => updateStake(it.match.id, e.target.value.replace(/[^0-9.]/g, ''))}
                />
              </div>
              <div className="quick">
                {[10, 50, 100].map((q) => (
                  <button key={q} onClick={() => updateStake(it.match.id, String((it.stakeN || 0) + q))}>
                    +{q}
                  </button>
                ))}
                <button onClick={() => updateStake(it.match.id, String(Math.floor(balance)))}>Max</button>
              </div>
              <div className="returns">
                <span>Potential return</span>
                <b className="num">{fmtCoins(it.returns)}</b>
              </div>
              <button className="btn ghost sm block" style={{ marginTop: 8 }} onClick={() => setChallenge({ match: it.match, pick: it.pick })}>
                ⚔️ Challenge a friend on this instead
              </button>
            </div>
          ))
        )}
      </div>
      {group && slip.length > 0 && (
        <div className="slip-foot">
          <div className="tot">
            <span>Total stake</span>
            <b className="num">{fmtCoins(total)}</b>
          </div>
          <div className="tot">
            <span>Potential returns</span>
            <b className="num" style={{ color: 'var(--accent)' }}>
              {fmtCoins(totalReturns)}
            </b>
          </div>
          <div className="tot">
            <span>Balance</span>
            <b className="num">{fmtCoins(balance)}</b>
          </div>
          {total > balance && <div className="err">Not enough coins for these stakes.</div>}
          <button className="btn primary block" style={{ marginTop: 8 }} disabled={!valid || busy} onClick={place}>
            {busy ? 'Placing…' : `Place ${items.length > 1 ? `${items.length} bets` : 'bet'}`}
          </button>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 8, textAlign: 'center' }}>
            Odds lock in when you place. Coins only — no real money.
          </div>
        </div>
      )}
      {challenge && <ChallengeModal match={challenge.match} initialPick={challenge.pick} onClose={() => setChallenge(null)} onDone={() => removeSelection(challenge.match.id)} />}
    </div>
  );
}

export function ChallengeModal({
  match,
  initialPick,
  onClose,
  onDone,
}: {
  match: Match;
  initialPick?: Outcome;
  onClose(): void;
  onDone?(): void;
}) {
  const { data, user, group, backend, refresh, toast, oddsFormat } = useApp();
  const [pick, setPick] = useState<Outcome>(initialPick ?? 'home');
  const line = lineFor(match, data);
  const [odds, setOdds] = useState(String(line[OUTCOME_INDEX[initialPick ?? 'home']].toFixed(2)));
  const [stake, setStake] = useState('50');
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const others = data?.members.filter((m) => m.userId !== user?.id) ?? [];
  const o = parseFloat(odds) || 0;
  const s = parseFloat(stake) || 0;
  const risk = o > 1 ? takerStake(s, o) : 0;

  async function submit() {
    if (!group) return;
    setBusy(true);
    setError('');
    try {
      await backend.createChallenge(group.id, match, pick, o, s, target || null, message);
      await refresh();
      toast('Challenge sent! ⚔️');
      onDone?.();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Challenge a friend" onClose={onClose}>
      <div className="muted" style={{ marginBottom: 14 }}>
        {match.name} · {match.league}
      </div>
      <div className="field">
        <label>You are backing</label>
        <div className="seg" style={{ width: '100%' }}>
          {outcomesFor(match).map((x) => (
            <button
              key={x}
              className={pick === x ? 'on' : ''}
              style={{ flex: 1 }}
              onClick={() => {
                setPick(x);
                setOdds(line[OUTCOME_INDEX[x]].toFixed(2));
              }}
            >
              {pickLabel(match, x)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Your odds (decimal)</label>
          <input className="input num" inputMode="decimal" value={odds} onChange={(e) => setOdds(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <div className="field">
          <label>Your stake</label>
          <input className="input num" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
      </div>
      <div className="field">
        <label>Send to</label>
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Open to anyone in the group</option>
          {others.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.username}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Trash talk (optional)</label>
        <input className="input" maxLength={140} placeholder="Bet you won't…" value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="card card-pad" style={{ background: 'var(--bg)', marginBottom: 12, fontSize: 13 }}>
        You put up <b>{fmtCoins(s)}</b> on <b>{pickLabel(match, pick)}</b> at <b>{o > 1 ? formatOdds(o, oddsFormat) : '—'}</b>. Your friend
        risks <b>{fmtCoins(risk)}</b> that it doesn't happen. Winner takes <b style={{ color: 'var(--accent)' }}>{fmtCoins(s + risk)}</b>.
        <div className="dim" style={{ marginTop: 6 }}>
          Current group line: {formatOdds(line[OUTCOME_INDEX[pick]], oddsFormat)}
        </div>
      </div>
      {error && <div className="err">{error}</div>}
      <button className="btn primary block" disabled={busy || s < 1 || o < 1.01} onClick={submit}>
        {busy ? 'Sending…' : 'Send challenge'}
      </button>
    </Modal>
  );
}
