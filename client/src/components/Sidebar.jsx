import React from 'react';

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function Sidebar({ briefs, activeBriefId, onSelect, onNewBrief, generating, onSettings }) {
  return (
    <aside className="w-64 flex-shrink-0 bg-stone-900 text-stone-100 flex flex-col h-screen sticky top-0 no-print">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-stone-700">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐔</span>
          <div>
            <p className="text-xs text-stone-400 uppercase tracking-widest">CFA</p>
            <p className="text-sm font-semibold leading-tight">Market Intel</p>
          </div>
        </div>
      </div>

      {/* Generate button */}
      <div className="px-4 py-4">
        <button
          onClick={onNewBrief}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 bg-red-700 hover:bg-red-600 disabled:bg-stone-700 disabled:text-stone-400 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors text-sm"
        >
          {generating ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Generating...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Generate New Brief
            </>
          )}
        </button>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto px-2">
        <p className="text-xs uppercase tracking-widest text-stone-500 px-3 mb-2">Past Briefs</p>
        {briefs.length === 0 && (
          <p className="text-xs text-stone-500 px-3">No briefs yet. Generate your first one!</p>
        )}
        {briefs.map(b => (
          <button
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={`w-full text-left px-3 py-2.5 rounded-md mb-0.5 transition-colors ${
              activeBriefId === b.id
                ? 'bg-stone-700 text-white'
                : 'text-stone-300 hover:bg-stone-800 hover:text-white'
            }`}
          >
            <p className="text-xs font-medium">{formatDate(b.created_at)}</p>
            <p className="text-xs text-stone-400">{formatTime(b.created_at)} · {b.location}</p>
          </button>
        ))}
      </div>

      {/* Settings button */}
      <div className="px-4 py-4 border-t border-stone-700">
        <button
          onClick={onSettings}
          className="w-full flex items-center gap-2 text-stone-400 hover:text-white transition-colors text-sm py-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>
    </aside>
  );
}
