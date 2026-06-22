import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatBriefDateTime } from '../lib/date';
import RankBoard from './RankBoard';
import OwnStoreReviews from './OwnStoreReviews';
import PriceTable from './PriceTable';
import BreakfastHub from './BreakfastHub';

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden mb-5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-stone-50 transition-colors text-left"
      >
        <span className="font-bold text-stone-800 text-sm tracking-wide uppercase">{title}</span>
        <svg className={`w-4 h-4 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-6 pb-5 brief-content">{children}</div>}
    </div>
  );
}

function splitSections(markdown) {
  const sections = { ratings: '', news: '', recommendations: '', rest: '' };
  const parts = (markdown || '').split(/(?=^## SECTION)/m);
  for (const part of parts) {
    if (/RATINGS LANDSCAPE/i.test(part)) sections.ratings = part;
    else if (/WHAT'S HAPPENING/i.test(part)) sections.news = part;
    else if (/OWNER RECOMMENDATIONS/i.test(part)) sections.recommendations = part;
    else sections.rest += part;
  }
  return sections;
}

export default function BriefViewer({ brief, createdAt, location, extras, rankings, onRefreshRanking, rankingStatus, rankingUpdatedAt }) {
  const sections = splitSections(brief);
  const dateStr = createdAt ? formatBriefDateTime(createdAt) : '';
  const ex = extras || {};
  const handlePrint = () => window.print();
  // Prefer the freshest live ranking; fall back to whatever the brief captured.
  const liveRankings = rankings || ex.rankings;

  return (
    <article className="max-w-2xl mx-auto">
      {/* Masthead */}
      <div className="flex items-start justify-between gap-4 mb-6 no-print">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-cfa-red font-bold mb-1">Chick-fil-A · Market Intel</p>
          <h1 className="text-3xl font-serif font-bold text-stone-900">Weekly Market Brief</h1>
          {location && <p className="text-sm text-stone-500 mt-1">{location}</p>}
          {dateStr && <p className="text-xs text-stone-400 mt-0.5">{dateStr}</p>}
        </div>
        <button
          onClick={handlePrint}
          className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 border border-stone-300 rounded-lg hover:bg-stone-100 text-stone-600 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Print masthead */}
      <div className="hidden print:block mb-8">
        <h1 className="text-3xl font-serif font-bold">Weekly Market Brief</h1>
        <p className="text-sm text-stone-500">{location} · {dateStr}</p>
        <hr className="mt-2 border-cfa-red border-t-2" />
      </div>

      {/* Structured sections (marquee first) */}
      <RankBoard rankings={ex.rankings} />
      <OwnStoreReviews ownStore={ex.ownStore} />
      <PriceTable pricing={ex.pricing} />
      <BreakfastHub breakfast={ex.breakfast} />

      {/* Markdown core */}
      {sections.recommendations && (
        <Section title="Owner Recommendations" defaultOpen={true}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{sections.recommendations.replace(/^## SECTION 3.*\n/m, '')}</ReactMarkdown>
        </Section>
      )}
      {sections.news && (
        <Section title="What's Happening This Week" defaultOpen={true}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{sections.news.replace(/^## SECTION 2.*\n/m, '')}</ReactMarkdown>
        </Section>
      )}
      {sections.ratings && (
        <Section title="Ratings Landscape" defaultOpen={false}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{sections.ratings.replace(/^## SECTION 1.*\n/m, '')}</ReactMarkdown>
        </Section>
      )}

      {!sections.ratings && !sections.news && !sections.recommendations && brief && (
        <div className="brief-content rounded-2xl border border-stone-200 bg-white shadow-sm p-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{brief}</ReactMarkdown>
        </div>
      )}
    </article>
  );
}
