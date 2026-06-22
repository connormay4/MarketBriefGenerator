import React from 'react';

// Marquee feature: how Jack's store ranks vs the nearest CFAs across categories.
// Ranks are 1 = best. Color: top tier green, mid amber, lower stone.
function rankColor(rank, rankedOf) {
  if (rank == null) return { bar: 'bg-stone-300', text: 'text-stone-400' };
  if (rank <= 3) return { bar: 'bg-emerald-500', text: 'text-emerald-700' };
  if (rank <= Math.ceil(rankedOf / 2)) return { bar: 'bg-amber-500', text: 'text-amber-700' };
  return { bar: 'bg-stone-400', text: 'text-stone-500' };
}

function medal(rank) {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
}

function RefreshBtn({ onRefresh, status, label }) {
  if (!onRefresh) return null;
  const running = status?.running;
  return (
    <button
      onClick={onRefresh}
      disabled={running}
      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white transition-colors whitespace-nowrap"
    >
      {running ? 'Working…' : label}
    </button>
  );
}

export default function RankBoard({ rankings, onRefresh, status, updatedAt }) {
  const has = rankings && Array.isArray(rankings.categories) && rankings.categories.length;

  // Empty state — invite the operator to run the ranking.
  if (!has) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden mb-5">
        <div className="bg-gradient-to-r from-cfa-red to-cfa-redDark px-6 py-5 text-white flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/80">You vs nearby Chick-fil-As</p>
            <h2 className="text-xl font-bold mt-0.5">See how you rank against the 24 closest CFAs</h2>
          </div>
          <RefreshBtn onRefresh={onRefresh} status={status} label="Run ranking" />
        </div>
        <div className="px-6 py-5 text-sm text-stone-500">
          {status?.running
            ? <span className="text-stone-700">{status.message || 'Pulling reviews and scoring…'}</span>
            : 'Rank your store on overall rating, recent review volume, speed, accuracy, taste, and team courtesy — against the nearest Chick-fil-A locations.'}
        </div>
      </section>
    );
  }

  const total = rankings.totalStores || 25;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden mb-5">
      <div className="bg-gradient-to-r from-cfa-red to-cfa-redDark px-6 py-5 text-white flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/80">You vs nearby Chick-fil-As</p>
          <h2 className="text-xl font-bold mt-0.5">Ranked against the {total - 1} closest CFAs</h2>
        </div>
        <RefreshBtn onRefresh={onRefresh} status={status} label="Refresh" />
      </div>

      <div className="px-6 py-5 space-y-4">
        {rankings.categories.map((cat, i) => {
          const ranked = cat.rankedOf || total;
          const insufficient = cat.rank == null;
          const pct = insufficient ? 0 : 100 * (1 - (cat.rank - 1) / Math.max(1, ranked - 1));
          const { bar, text } = rankColor(cat.rank, ranked);
          return (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-x-3 items-center">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-800 truncate">{cat.label}</span>
                  <span className={`text-sm font-bold ${text} whitespace-nowrap`}>
                    {medal(cat.rank)} {insufficient ? 'Insufficient data' : `#${cat.rank} of ${ranked}`}
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${bar} animate-bar-grow`}
                    style={{ '--bar-w': `${Math.max(3, pct)}%`, width: `${Math.max(3, pct)}%` }}
                  />
                </div>
                {cat.n != null && (
                  <div className="text-[11px] text-stone-400 mt-1">{cat.n} reviews considered</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rankings.note && (
        <div className="px-6 pb-4 -mt-1">
          <p className="text-[11px] text-stone-400">{rankings.note}</p>
        </div>
      )}
    </section>
  );
}
