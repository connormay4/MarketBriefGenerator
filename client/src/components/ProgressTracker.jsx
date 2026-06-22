import React from 'react';

const STEPS = [
  { key: 'ratings', label: 'Fetching ratings' },
  { key: 'news', label: 'Searching news & promos' },
  { key: 'synthesis', label: 'Writing brief' },
  { key: 'extras', label: 'Pricing, your reviews & breakfast' },
];

export default function ProgressTracker({ steps, currentMessage }) {
  return (
    <div className="py-8 space-y-4">
      {STEPS.map(({ key, label }) => {
        const status = steps[key] || 'pending';
        return (
          <div key={key} className="flex items-center gap-3">
            <div className="w-6 h-6 flex-shrink-0">
              {status === 'done' && (
                <svg className="text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {status === 'running' && (
                <svg className="animate-spin text-red-700" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {status === 'pending' && (
                <div className="w-6 h-6 rounded-full border-2 border-stone-300" />
              )}
            </div>
            <span className={`text-sm font-medium ${
              status === 'done' ? 'text-green-700' :
              status === 'running' ? 'text-stone-900' :
              'text-stone-400'
            }`}>
              {label}
            </span>
          </div>
        );
      })}
      {currentMessage && (
        <p className="text-xs text-stone-500 mt-2 pl-9">{currentMessage}</p>
      )}
    </div>
  );
}
