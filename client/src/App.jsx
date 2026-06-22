import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import BriefViewer from './components/BriefViewer';
import ProgressTracker from './components/ProgressTracker';
import SettingsPanel from './components/SettingsPanel';
import { getBriefs, getBrief, generateBrief, getLatestRanking, refreshRanking } from './lib/api';

export default function App() {
  const [briefs, setBriefs] = useState([]);
  const [activeBrief, setActiveBrief] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [progressSteps, setProgressSteps] = useState({});
  const [progressMessage, setProgressMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [rankings, setRankings] = useState(null);
  const [rankingUpdatedAt, setRankingUpdatedAt] = useState(null);
  const [rankingStatus, setRankingStatus] = useState(null);

  const loadBriefs = useCallback(async () => {
    try {
      const data = await getBriefs();
      setBriefs(data);
    } catch (err) {
      setError('Could not connect to server. Is it running?');
    }
  }, []);

  const loadRanking = useCallback(async () => {
    try {
      const r = await getLatestRanking();
      if (r) { setRankings(r); setRankingUpdatedAt(r.updatedAt || null); }
    } catch { /* ranking is optional */ }
  }, []);

  useEffect(() => {
    loadBriefs();
    loadRanking();
  }, [loadBriefs, loadRanking]);

  function handleRefreshRanking() {
    if (rankingStatus?.running) return;
    setRankingStatus({ running: true, message: 'Starting…' });
    refreshRanking({
      onProgress: ({ message }) => setRankingStatus({ running: true, message }),
      onComplete: (snapshot) => {
        setRankings(snapshot);
        setRankingUpdatedAt(new Date().toISOString());
        setRankingStatus(null);
      },
      onError: (err) => setRankingStatus({ running: false, message: `Failed: ${err.message}` }),
    });
  }

  async function handleSelectBrief(id) {
    const brief = await getBrief(id);
    setActiveBrief(brief);
    setMobileMenuOpen(false);
  }

  function handleNewBrief() {
    if (generating) return;
    setGenerating(true);
    setActiveBrief(null);
    setProgressSteps({});
    setProgressMessage('Starting research pipeline...');
    setError('');

    generateBrief({
      onProgress: ({ step, status, message }) => {
        setProgressSteps(prev => ({ ...prev, [step]: status }));
        setProgressMessage(message);
      },
      onComplete: async ({ id, brief }) => {
        setGenerating(false);
        setProgressMessage('');
        await loadBriefs();
        // Re-fetch the full brief from the list to get created_at and location
        const full = await getBrief(id);
        setActiveBrief(full);
      },
      onError: err => {
        setGenerating(false);
        setError(`Generation failed: ${err.message}`);
        setProgressMessage('');
      }
    });
  }

  const showProgress = generating;
  const showEmpty = !generating && !activeBrief;

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar
          briefs={briefs}
          activeBriefId={activeBrief?.id}
          onSelect={handleSelectBrief}
          onNewBrief={handleNewBrief}
          generating={generating}
          onSettings={() => setShowSettings(true)}
        />
      </div>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 bg-stone-900 text-white flex items-center justify-between px-4 py-3 no-print">
        <div className="flex items-center gap-2">
          <span className="text-xl">🐔</span>
          <span className="font-semibold text-sm">Market Intel</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleNewBrief}
            disabled={generating}
            className="text-xs bg-red-700 hover:bg-red-600 disabled:bg-stone-700 px-3 py-1.5 rounded font-semibold"
          >
            {generating ? 'Generating...' : '+ New Brief'}
          </button>
          <button onClick={() => setMobileMenuOpen(o => !o)} className="text-stone-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-64" onClick={e => e.stopPropagation()}>
            <Sidebar
              briefs={briefs}
              activeBriefId={activeBrief?.id}
              onSelect={handleSelectBrief}
              onNewBrief={handleNewBrief}
              generating={generating}
              onSettings={() => { setShowSettings(true); setMobileMenuOpen(false); }}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 px-4 py-6 md:px-10 md:py-10 mt-12 md:mt-0">
        {error && (
          <div className="max-w-2xl mx-auto mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {showProgress && (
          <div className="max-w-2xl mx-auto">
            <div className="border-b-2 border-stone-800 pb-4 mb-6">
              <p className="text-xs uppercase tracking-widest text-stone-500 mb-1">Generating</p>
              <h1 className="text-2xl font-serif font-bold">Running Research Pipeline</h1>
            </div>
            <ProgressTracker steps={progressSteps} currentMessage={progressMessage} />
          </div>
        )}

        {showEmpty && (
          <div className="max-w-2xl mx-auto flex flex-col items-center justify-center py-24 text-center">
            <span className="text-6xl mb-4">🐔</span>
            <h2 className="text-2xl font-serif font-bold text-stone-800 mb-2">No Brief Selected</h2>
            <p className="text-stone-500 mb-8 text-sm max-w-sm">
              Click <strong>Generate New Brief</strong> to run a fresh competitive analysis, or select a past brief from the sidebar.
            </p>
            <button
              onClick={handleNewBrief}
              className="bg-red-700 hover:bg-red-600 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors"
            >
              Generate New Brief
            </button>
          </div>
        )}

        {activeBrief && !generating && (
          <BriefViewer
            brief={activeBrief.content}
            createdAt={activeBrief.created_at}
            location={activeBrief.location}
            extras={activeBrief.extras}
          />
        )}
      </main>

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onSaved={loadBriefs}
        />
      )}
    </div>
  );
}
