import { useApp } from '../lib/store';
import { fmtCoins } from '../lib/odds';
import { Avatar, Coins } from '../components/bits';

export function Leaderboard() {
  const { data, user } = useApp();
  if (!data) return null;
  const rows = data.members
    .map((m) => {
      const bets = data.bets.filter((b) => b.userId === m.userId && (b.status === 'won' || b.status === 'lost'));
      const ch = data.challenges.filter((c) => c.status === 'settled' && (c.creatorId === m.userId || c.takerId === m.userId));
      const wins = bets.filter((b) => b.status === 'won').length + ch.filter((c) => c.winnerId === m.userId).length;
      const total = bets.length + ch.length;
      const biggest = Math.max(0, ...bets.filter((b) => b.status === 'won').map((b) => b.payout - b.stake));
      // current streak from most recent settled straight bets
      const recent = [...bets].sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''));
      let streak = 0;
      for (const b of recent) {
        if (b.status === 'won') streak++;
        else break;
      }
      const inPlay =
        data.bets.filter((b) => b.userId === m.userId && b.status === 'open').reduce((a, b) => a + b.stake, 0) +
        data.challenges
          .filter((c) => c.status === 'open' || c.status === 'matched')
          .reduce((a, c) => a + (c.creatorId === m.userId ? c.stake : 0) + (c.takerId === m.userId ? c.takerStake : 0), 0);
      const worth = m.balance + inPlay;
      return { m, wins, total, biggest, streak, inPlay, worth, profit: worth - data.group.startingBalance };
    })
    .sort((a, b) => b.worth - a.worth);

  return (
    <>
      <div className="page-title">
        <h1>🏆 Leaderboard</h1>
        <span className="muted">{data.group.name}</span>
      </div>
      {rows.length >= 2 && (
        <div className="grid-3" style={{ marginBottom: 16 }}>
          {rows.slice(0, 3).map((r, i) => (
            <div className="card card-pad" key={r.m.userId} style={{ textAlign: 'center', borderColor: i === 0 ? 'rgba(250,204,21,.5)' : undefined }}>
              <div style={{ fontSize: 26 }}>{['🥇', '🥈', '🥉'][i]}</div>
              <div className="row" style={{ justifyContent: 'center', margin: '6px 0' }}>
                <Avatar name={r.m.username} size="lg" />
              </div>
              <div style={{ fontWeight: 800 }}>{r.m.username}</div>
              <div style={{ marginTop: 4 }}>
                <Coins n={r.worth} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className="r">Total</th>
              <th className="r hide-mobile">In play</th>
              <th className="r">P/L</th>
              <th className="r hide-mobile">Won</th>
              <th className="r hide-mobile">Win %</th>
              <th className="r hide-mobile">Best win</th>
              <th className="r hide-mobile">Streak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.m.userId} style={r.m.userId === user?.id ? { background: 'rgba(34,197,94,.06)' } : undefined}>
                <td>
                  <span className={`rank r${i + 1}`}>{i + 1}</span>
                </td>
                <td>
                  <div className="row">
                    <Avatar name={r.m.username} size="sm" />
                    <b>{r.m.username}</b>
                    {r.m.userId === user?.id && <span className="pill">you</span>}
                    {r.m.role === 'admin' && <span className="pill">admin</span>}
                  </div>
                </td>
                <td className="r num">
                  <b>{fmtCoins(r.worth)}</b>
                </td>
                <td className="r num hide-mobile dim">{r.inPlay ? fmtCoins(r.inPlay) : '—'}</td>
                <td className={`r num ${r.profit > 0 ? 'pos' : r.profit < 0 ? 'neg' : ''}`}>
                  {r.profit > 0 ? '+' : ''}
                  {fmtCoins(r.profit)}
                </td>
                <td className="r num hide-mobile">
                  {r.wins}/{r.total}
                </td>
                <td className="r num hide-mobile">{r.total ? `${Math.round((r.wins / r.total) * 100)}%` : '—'}</td>
                <td className="r num hide-mobile">{r.biggest ? `+${fmtCoins(r.biggest)}` : '—'}</td>
                <td className="r num hide-mobile">{r.streak ? `🔥 ${r.streak}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="footer-note">Total = available coins + coins currently staked on open bets and challenges. P/L is measured from the group's starting balance.</div>
    </>
  );
}
