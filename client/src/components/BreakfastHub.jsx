import React from 'react';

export default function BreakfastHub({ breakfast }) {
  const ideas = breakfast?.ideas;
  if (!ideas || !ideas.length) return null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden mb-5">
      <div className="px-6 pt-5 pb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-cfa-red">Breakfast hub</p>
        <h2 className="text-xl font-bold text-stone-900 mt-0.5">Grow the morning daypart this week</h2>
      </div>
      <div className="px-6 pb-5 grid gap-3 sm:grid-cols-2">
        {ideas.map((idea, i) => (
          <div key={i} className="rounded-xl border border-stone-200 p-4 hover:border-cfa-red/40 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold text-stone-900">{idea.title}</h3>
              {idea.effort && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 whitespace-nowrap">
                  {idea.effort} effort
                </span>
              )}
            </div>
            {idea.goal && <div className="text-[11px] font-medium text-cfa-red mt-0.5">{idea.goal}</div>}
            <p className="text-[13px] text-stone-600 mt-2 leading-relaxed">{idea.how}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {idea.reward && idea.reward !== 'none' && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cfa-redSoft text-cfa-red">🎁 {idea.reward}</span>
              )}
              {idea.audience && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">🎯 {idea.audience}</span>
              )}
            </div>
            {idea.metric && <div className="text-[11px] text-stone-400 mt-2.5">📈 Watch: {idea.metric}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
