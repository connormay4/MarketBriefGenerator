import React from 'react';

function Stars({ rating }) {
  return <span className="text-amber-500" title={`${rating}★`}>{'★'.repeat(Math.round(rating || 0))}<span className="text-stone-300">{'★'.repeat(5 - Math.round(rating || 0))}</span></span>;
}

function Callout({ tone, label, quote, author, when }) {
  if (!quote) return null;
  const tones = {
    good: 'border-emerald-500 bg-emerald-50 text-emerald-700',
    warn: 'border-amber-500 bg-amber-50 text-amber-700',
  };
  return (
    <div className={`border-l-4 rounded-r-lg px-4 py-3 ${tones[tone]}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide">{label}</div>
      <p className="text-sm text-stone-800 italic mt-1">“{quote}”</p>
      <div className="text-[11px] text-stone-500 mt-1">— {author || 'Guest'}{when ? `, ${when}` : ''}</div>
    </div>
  );
}

export default function OwnStoreReviews({ ownStore }) {
  if (!ownStore || !ownStore.available) return null;
  const { store, highlight = {} } = ownStore;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden mb-5">
      <div className="px-6 pt-5 pb-3 border-b border-stone-100">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-cfa-red">Your store this week</p>
        <div className="flex items-center gap-3 mt-1">
          <h2 className="text-xl font-bold text-stone-900">{store.name}</h2>
          <span className="text-lg font-bold text-stone-800">{store.rating}<Stars rating={store.rating} /></span>
        </div>
        <p className="text-sm text-stone-500 mt-0.5">
          {store.reviewCount?.toLocaleString?.() || store.reviewCount} total Google reviews
          {highlight.headline ? ` · ${highlight.headline}` : ''}
        </p>
      </div>

      <div className="px-6 py-4 space-y-3">
        <Callout tone="good" label="Notable praise" quote={highlight.notablePraise?.quote}
          author={highlight.notablePraise?.author} when={highlight.notablePraise?.when} />
        <Callout tone="warn" label="Worth a look" quote={highlight.notableConcern?.quote}
          author={highlight.notableConcern?.author} when={highlight.notableConcern?.when} />
        {highlight.prompt && (
          <div className="rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-800">
            <span className="font-bold text-cfa-red">This week:</span> {highlight.prompt}
          </div>
        )}
      </div>
    </section>
  );
}
