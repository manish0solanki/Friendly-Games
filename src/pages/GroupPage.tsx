import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fmtCoins } from '../lib/odds';
import { ago, eventPath, kickoff, pickLabel } from '../lib/util';
import type { Result, StoredEvent } from '../lib/types';
import { Avatar, Coins, Empty, Modal } from '../components/bits';
import { CreateOrJoin } from './Onboarding';

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#/join/${code}`;
}

export function GroupPage() {
  const { data, user, group, backend, refresh, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [adjust, setAdjust] = useState<{ userId: string; username: string } | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  if (params.get('new') || !group) {
    return (
      <div style={{ maxWidth: 720 }}>
        <div className="page-title">
          <h1>Create or join a group</h1>
          {group && (
            <button className="btn ghost sm" onClick={() => setParams({})}>
              ← Back
            </button>
          )}
        </div>
        <CreateOrJoin onDone={() => setParams({})} />
      </div>
    );
  }
  if (!data || !user) return null;
  const isAdmin = !!user.isSuper || data.members.find((m) => m.userId === user.id)?.role === 'admin';
  const custom = Object.values(data.events).filter((e) => e.groupId === group.id).sort((a, b) => b.startTime.localeCompare(a.startTime));
  const nameOf = (id?: string | null) => data.members.find((m) => m.userId === id)?.username ?? 'someone';

  const feed = [
    ...data.bets.map((b) => ({ at: b.createdAt, who: b.userId, text: <>backed <b>{data.events[b.eventId] ? pickLabel(data.events[b.eventId], b.pick) : '?'}</b> for {fmtCoins(b.stake)}</>, ev: b.eventId })),
    ...data.bets
      .filter((b) => b.status === 'won' && b.settledAt)
      .map((b) => ({ at: b.settledAt!, who: b.userId, text: <>won <b className="pos">{fmtCoins(b.payout)}</b> 🎉</>, ev: b.eventId })),
    ...data.challenges.map((c) => ({ at: c.createdAt, who: c.creatorId, text: <>laid down a challenge{c.targetId ? <> to <b>{nameOf(c.targetId)}</b></> : ''}</>, ev: c.eventId })),
    ...data.challenges
      .filter((c) => c.status === 'settled' && c.settledAt)
      .map((c) => ({ at: c.settledAt!, who: c.winnerId, text: <>won a {fmtCoins(c.stake + c.takerStake)} challenge pot ⚔️</>, ev: c.eventId })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast(text, 'info');
    }
  }

  return (
    <>
      <div className="page-title">
        <h1>👥 {group.name}</h1>
        <span className="pill">{data.members.length} members</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setParams({ new: '1' })}>
          ＋ New / join group
        </button>
      </div>

      <div className="grid-2">
        <div>
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Invite your friends</div>
            <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
              Only people with this code can join. Everyone starts with <b>{fmtCoins(group.startingBalance)}</b> coins.
            </div>
            <div className="code-box">
              {group.inviteCode}
              <span className="spacer" />
              <button className="btn sm" onClick={() => copy(group.inviteCode)}>
                Copy
              </button>
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => copy(inviteLink(group.inviteCode))}>
                🔗 Copy invite link
              </button>
              <a
                className="btn sm"
                target="_blank"
                rel="noreferrer"
                href={`https://wa.me/?text=${encodeURIComponent(`Join my betting group "${group.name}" on Friendly Games 🏆 ${inviteLink(group.inviteCode)}`)}`}
              >
                💬 Share on WhatsApp
              </a>
            </div>
            {backend.mode === 'demo' && (
              <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
                In demo mode, friends must use this same browser (sign out → create another player → join with the code).
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="market-head">Members</div>
            {[...data.members]
              .sort((a, b) => b.balance - a.balance)
              .map((m) => (
                <div className="feed-item" key={m.userId} style={{ alignItems: 'center' }}>
                  <Avatar name={m.username} size="sm" />
                  <div>
                    <b>{m.username}</b> {m.role === 'admin' && <span className="pill">admin</span>}
                    <div className="dim" style={{ fontSize: 12 }}>
                      joined {ago(m.joinedAt)}
                    </div>
                  </div>
                  <span className="spacer" />
                  <Coins n={m.balance} />
                  {isAdmin && (
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setAdjust({ userId: m.userId, username: m.username })} title="Give or take coins">
                        ±
                      </button>
                      {m.userId !== user.id && (
                        <button
                          className="btn ghost sm"
                          title={m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                          onClick={async () => {
                            try {
                              await backend.setRole(group.id, m.userId, m.role === 'admin' ? 'member' : 'admin');
                              await refresh();
                            } catch (e: any) {
                              toast(e.message, 'error');
                            }
                          }}
                        >
                          {m.role === 'admin' ? '★' : '☆'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>

          <div className="card">
            <div className="market-head">
              ⭐ Group specials
              <span className="spacer" />
              {isAdmin && (
                <button className="btn primary sm" onClick={() => setEventOpen(true)}>
                  Create event
                </button>
              )}
            </div>
            {custom.length ? (
              custom.map((e) => <CustomEventRow key={e.id} e={e} isAdmin={isAdmin} />)
            ) : (
              <Empty icon="⭐" title="No custom events">
                {isAdmin
                  ? 'Create your own markets — "Will Rohit hit a century?", the office FIFA final, anything.'
                  : 'Group admins can create custom markets for anything the live feed doesn’t cover.'}
              </Empty>
            )}
          </div>
        </div>

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="market-head">Recent activity</div>
          {feed.length ? (
            feed.map((f, i) => (
              <div className="feed-item" key={i}>
                <Avatar name={nameOf(f.who)} size="sm" />
                <div>
                  <b>{f.who === user.id ? 'You' : nameOf(f.who)}</b> {f.text}
                  {data.events[f.ev] && (
                    <div className="dim" style={{ fontSize: 12 }}>
                      <Link to={eventPath(f.ev)}>{data.events[f.ev].name}</Link>
                    </div>
                  )}
                </div>
                <span className="when">{ago(f.at)}</span>
              </div>
            ))
          ) : (
            <Empty icon="📰" title="Quiet so far">
              Bets and challenges from your group will show up here.
            </Empty>
          )}
        </div>
      </div>

      {adjust && <AdjustModal target={adjust} onClose={() => setAdjust(null)} />}
      {eventOpen && <CustomEventModal onClose={() => setEventOpen(false)} />}
    </>
  );
}

function CustomEventRow({ e, isAdmin }: { e: StoredEvent; isAdmin: boolean }) {
  const { backend, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const k = kickoff(e.startTime);
  const started = new Date(e.startTime) <= new Date();
  async function settle(r: Result) {
    if (!confirm(`Settle "${e.name}" as ${r === 'void' ? 'VOID (refund everyone)' : pickLabel(e, r as any)}? This can't be undone.`)) return;
    setBusy(true);
    try {
      await backend.settleEvent(e.id, r);
      await refresh();
      toast('Event settled and coins paid out');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bet-item">
      <div>
        <Link to={eventPath(e.id)} className="title">
          {e.name}
        </Link>
        <div className="sub">
          {e.home.name} vs {e.away.name} · {k.day} {k.time}
        </div>
      </div>
      <div className="amt">
        {e.settledAt ? (
          <span className={`status ${e.result === 'void' ? 'void' : 'won'}`}>{e.result === 'void' ? 'void' : `${pickLabel(e, e.result as any)}`}</span>
        ) : isAdmin ? (
          <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 }}>
            {!started && <span className="dim" style={{ fontSize: 12 }}>Settle after start:</span>}
            <button className="btn sm" disabled={busy} onClick={() => settle('home')}>
              {e.home.short || '1'}
            </button>
            {e.allowDraw && (
              <button className="btn sm" disabled={busy} onClick={() => settle('draw')}>
                Draw
              </button>
            )}
            <button className="btn sm" disabled={busy} onClick={() => settle('away')}>
              {e.away.short || '2'}
            </button>
            <button className="btn ghost sm" disabled={busy} onClick={() => settle('void')}>
              Void
            </button>
          </div>
        ) : (
          <span className="status open">{started ? 'awaiting result' : 'open'}</span>
        )}
      </div>
    </div>
  );
}

function AdjustModal({ target, onClose }: { target: { userId: string; username: string }; onClose(): void }) {
  const { backend, group, refresh, toast } = useApp();
  const [amount, setAmount] = useState('100');
  const [error, setError] = useState('');
  async function go(sign: 1 | -1) {
    try {
      await backend.adjustBalance(group!.id, target.userId, sign * (parseFloat(amount) || 0));
      await refresh();
      toast(`${sign > 0 ? 'Gave' : 'Took'} ${amount} coins ${sign > 0 ? 'to' : 'from'} ${target.username}`);
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Modal title={`Adjust coins · ${target.username}`} onClose={onClose}>
      <div className="field">
        <label>Amount</label>
        <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
      </div>
      {error && <div className="err">{error}</div>}
      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} onClick={() => go(1)}>
          ＋ Give
        </button>
        <button className="btn danger" style={{ flex: 1 }} onClick={() => go(-1)}>
          − Take
        </button>
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
        Handy for a weekly top-up or a fresh season.
      </div>
    </Modal>
  );
}

function CustomEventModal({ onClose }: { onClose(): void }) {
  const { backend, group, refresh, toast } = useApp();
  const tomorrow = new Date(Date.now() + 864e5);
  tomorrow.setMinutes(0, 0, 0);
  const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ title: '', home: '', away: '', allowDraw: false, startTime: local, league: 'Group specials' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await backend.createCustomEvent(group!.id, { ...f, startTime: new Date(f.startTime).toISOString() });
      await refresh();
      toast('Event created — it now shows in Group specials');
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create a custom event" onClose={onClose}>
      <div className="field">
        <label>Title</label>
        <input className="input" placeholder="Will Kohli score 50+ vs Australia?" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Option 1</label>
          <input className="input" placeholder="Yes" value={f.home} onChange={(e) => setF({ ...f, home: e.target.value })} />
        </div>
        <div className="field">
          <label>Option 2</label>
          <input className="input" placeholder="No" value={f.away} onChange={(e) => setF({ ...f, away: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>Betting closes at (start time)</label>
        <input className="input" type="datetime-local" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
      </div>
      <div className="field">
        <label>Category</label>
        <input className="input" value={f.league} onChange={(e) => setF({ ...f, league: e.target.value })} />
      </div>
      <label className="check" style={{ marginBottom: 14 }}>
        <input type="checkbox" checked={f.allowDraw} onChange={(e) => setF({ ...f, allowDraw: e.target.checked })} /> Allow a draw / tie option
      </label>
      {error && <div className="err">{error}</div>}
      <button className="btn primary block" disabled={busy} onClick={submit}>
        {busy ? 'Creating…' : 'Create event'}
      </button>
      <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
        You (or any admin) settle custom events manually from the Group page once the result is known.
      </div>
    </Modal>
  );
}
