import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fmtCoins, formatOdds } from '../lib/odds';
import { eventPath, kickoff, pickLabel } from '../lib/util';
import type { Challenge } from '../lib/types';
import { Avatar, Empty } from '../components/bits';

export function ChallengeCard({ c, compact }: { c: Challenge; compact?: boolean }) {
  const { data, user, backend, refresh, toast, oddsFormat } = useApp();
  const [busy, setBusy] = useState(false);
  const ev = data?.events[c.eventId];
  if (!ev || !data) return null;
  const nameOf = (id?: string | null) => (id === user?.id ? 'You' : data.members.find((m) => m.userId === id)?.username ?? 'someone');
  const started = new Date(ev.startTime) <= new Date();
  const canAccept = c.status === 'open' && c.creatorId !== user?.id && (!c.targetId || c.targetId === user?.id) && !started;
  const canCancel = c.status === 'open' && (c.creatorId === user?.id || !!user?.isSuper || data.members.find((m) => m.userId === user?.id)?.role === 'admin');
  const k = kickoff(ev.startTime);
  const iWon = c.status === 'settled' && c.winnerId === user?.id;
  const involved = c.creatorId === user?.id || c.takerId === user?.id;
  const statusClass = c.status === 'settled' ? (involved ? (iWon ? 'won' : 'lost') : 'won') : c.status;
  const statusText =
    c.status === 'settled' ? `${nameOf(c.winnerId)} won` : c.status === 'open' && started ? 'expired' : c.status === 'void' ? 'void · refunded' : c.status;

  async function act(fn: () => Promise<void>, msg: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast(msg);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bet-item">
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Avatar name={nameOf(c.creatorId) === 'You' ? user!.username : nameOf(c.creatorId)} size="sm" />
          <span className="title">
            {nameOf(c.creatorId)} {c.creatorId === user?.id ? 'back' : 'backs'} {pickLabel(ev, c.pick)} @{' '}
            <span style={{ color: 'var(--gold)' }}>{formatOdds(c.odds, oddsFormat)}</span>
          </span>
          <span className={`status ${statusClass}`}>{statusText}</span>
        </div>
        {!compact && (
          <div className="sub">
            <Link to={eventPath(ev.id)} style={{ textDecoration: 'underline' }}>
              {ev.name}
            </Link>{' '}
            · {ev.league} · {k.day} {k.time}
          </div>
        )}
        <div className="sub">
          {c.status === 'open'
            ? c.targetId
              ? `Sent to ${nameOf(c.targetId)}`
              : 'Open to anyone'
            : c.takerId
              ? `${nameOf(c.takerId)} took the other side`
              : ''}
          {c.message && <> · “{c.message}”</>}
        </div>
      </div>
      <div className="amt">
        <div className="num" style={{ fontWeight: 800 }}>
          {fmtCoins(c.stake)} <span className="dim">vs</span> {fmtCoins(c.takerStake)}
        </div>
        <div className="sub">Pot {fmtCoins(c.stake + c.takerStake)}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          {canAccept && (
            <button className="btn primary sm" disabled={busy} onClick={() => act(() => backend.acceptChallenge(c.id), 'Challenge accepted! 🔥')}>
              Accept · risk {fmtCoins(c.takerStake)}
            </button>
          )}
          {canCancel && (
            <button className="btn ghost sm danger" disabled={busy} onClick={() => act(() => backend.cancelChallenge(c.id), 'Challenge cancelled, stake refunded')}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Tab = 'incoming' | 'mine' | 'all';

export function ChallengesPage() {
  const { data, user } = useApp();
  const [tab, setTab] = useState<Tab>('incoming');
  if (!data || !user) return null;
  const now = new Date();
  const incoming = data.challenges.filter(
    (c) => c.status === 'open' && c.creatorId !== user.id && (!c.targetId || c.targetId === user.id) && new Date(data.events[c.eventId]?.startTime ?? 0) > now,
  );
  const mine = data.challenges.filter((c) => c.creatorId === user.id || c.takerId === user.id);
  const list = tab === 'incoming' ? incoming : tab === 'mine' ? mine : data.challenges;
  return (
    <>
      <div className="page-title">
        <h1>⚔️ Challenges</h1>
        <span className="muted">Set your own odds. Winner takes the pot.</span>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'incoming' ? 'active' : ''}`} onClick={() => setTab('incoming')}>
          Waiting for you {incoming.length > 0 && <span className="badge">{incoming.length}</span>}
        </button>
        <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>
          Mine
        </button>
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          Whole group
        </button>
      </div>
      <div className="card">
        {list.length ? (
          list.map((c) => <ChallengeCard key={c.id} c={c} />)
        ) : (
          <Empty icon="🤝" title={tab === 'incoming' ? 'No challenges waiting' : 'No challenges yet'}>
            Open any match and hit <b>New challenge</b>, or use “Challenge a friend” from your bet slip.
          </Empty>
        )}
      </div>
    </>
  );
}
