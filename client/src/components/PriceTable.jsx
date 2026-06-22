import React from 'react';

function ConfBadge({ confidence, stale }) {
  if (stale) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">stale</span>;
  const map = {
    high: ['bg-emerald-100', 'text-emerald-700', 'verified'],
    medium: ['bg-amber-100', 'text-amber-700', 'check'],
    low: ['bg-stone-100', 'text-stone-500', 'low conf.'],
    none: ['bg-stone-100', 'text-stone-400', 'not set'],
    unset: ['bg-stone-100', 'text-stone-400', 'not set'],
  };
  const [bg, text, label] = map[confidence] || map.unset;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${bg} ${text}`}>{label}</span>;
}

export default function PriceTable({ pricing }) {
  if (!pricing || !pricing.length) return null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden mb-5">
      <div className="px-6 pt-5 pb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-cfa-red">Local pricing</p>
        <h2 className="text-xl font-bold text-stone-900 mt-0.5">Competitor signature item — in Hanover</h2>
      </div>
      <div className="px-6 pb-3">
        <table className="w-full">
          <tbody>
            {pricing.map((p, i) => (
              <tr key={i} className="border-b border-stone-100 last:border-0">
                <td className="py-2.5">
                  <div className="text-sm font-semibold text-stone-800">{p.competitor}</div>
                  <div className="text-[11px] text-stone-400">{p.itemLabel}</div>
                </td>
                <td className="py-2.5 text-right">
                  {p.priceDisplay
                    ? <span className="text-base font-bold text-stone-900">{p.priceDisplay}</span>
                    : <span className="text-sm text-stone-300">— not set —</span>}
                </td>
                <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                  <ConfBadge confidence={p.confidence} stale={p.stale} />
                  {p.lastVerified && <div className="text-[10px] text-stone-400 mt-0.5">{p.lastVerified}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-6 pb-4">
        <p className="text-[11px] text-stone-400">
          Operator-verified prices are the source of truth. “Not set” items can be filled in via Settings.
        </p>
      </div>
    </section>
  );
}
