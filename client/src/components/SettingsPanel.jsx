import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings, addCompetitor, toggleCompetitor, deleteCompetitor, getPrices, savePrice, researchPrices, sendTestEmail } from '../lib/api';

function PriceConfBadge({ confidence, stale }) {
  if (stale) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">stale</span>;
  const map = {
    high: ['bg-emerald-100', 'text-emerald-700', 'high'],
    medium: ['bg-amber-100', 'text-amber-700', 'med'],
    low: ['bg-stone-100', 'text-stone-500', 'low'],
  };
  const entry = map[confidence];
  if (!entry) return null;
  const [bg, text, label] = entry;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${bg} ${text}`}>{label}</span>;
}

function PriceEditor() {
  const [prices, setPrices] = useState(null);
  const [savingFor, setSavingFor] = useState(null);
  const [researching, setResearching] = useState(false);
  const [researchErr, setResearchErr] = useState('');

  useEffect(() => { getPrices().then(setPrices).catch(() => setPrices([])); }, []);

  async function handleSave(competitor, value) {
    setSavingFor(competitor);
    try {
      await savePrice({ competitor, price: value });
      setPrices(await getPrices());
    } finally {
      setSavingFor(null);
    }
  }

  async function handleResearch() {
    setResearching(true);
    setResearchErr('');
    try {
      setPrices(await researchPrices());
    } catch (err) {
      setResearchErr(err.message || 'Research failed');
    } finally {
      setResearching(false);
    }
  }

  if (!prices) return <p className="text-xs text-stone-400">Loading prices…</p>;

  return (
    <div className="space-y-3">
      <button
        onClick={handleResearch}
        disabled={researching}
        className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-cfa-red/30 text-cfa-red hover:bg-cfa-redSoft disabled:opacity-60 transition-colors"
      >
        {researching ? 'Researching local prices… (~20s)' : '✨ Research prices with AI'}
      </button>
      {researchErr && <p className="text-[11px] text-red-600">{researchErr}</p>}

      {prices.map(p => (
        <div key={p.competitor} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-stone-700 truncate">{p.competitor}</div>
            <div className="text-[11px] text-stone-400 truncate">{p.itemLabel}</div>
          </div>
          <PriceConfBadge confidence={p.confidence} stale={p.stale} />
          <div className="flex items-center gap-1">
            <span className="text-stone-400 text-sm">$</span>
            <input
              key={`${p.competitor}:${p.priceCents ?? ''}`}
              type="text"
              defaultValue={p.priceCents != null ? (p.priceCents / 100).toFixed(2) : ''}
              placeholder="0.00"
              onBlur={e => {
                const v = e.target.value.trim();
                if (v && v !== (p.priceCents != null ? (p.priceCents / 100).toFixed(2) : '')) handleSave(p.competitor, v);
              }}
              className="w-20 border border-stone-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-cfa-red"
            />
          </div>
          <span className="w-5 text-[10px] text-stone-400 text-right">{savingFor === p.competitor ? '…' : p.lastVerified ? '✓' : ''}</span>
        </div>
      ))}
      <p className="text-[11px] text-stone-400">
        AI-researched prices show a confidence level. Type a price yourself to mark it <span className="text-emerald-600 font-medium">verified</span> — that always wins over AI.
      </p>
    </div>
  );
}

const ALL_SECTIONS = [
  { key: 'ratings', label: 'Ratings Landscape' },
  { key: 'news', label: "What's Happening This Week" },
  { key: 'recommendations', label: 'Owner Recommendations' },
];

export default function SettingsPanel({ onClose, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [location, setLocation] = useState('');
  const [sections, setSections] = useState([]);
  const [newCompetitor, setNewCompetitor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      setLocation(s.location || '');
      setSections(s.sections || ['ratings', 'news', 'recommendations']);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await saveSettings({ location, sections });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCompetitor(e) {
    e.preventDefault();
    if (!newCompetitor.trim()) return;
    try {
      await addCompetitor(newCompetitor.trim());
      const s = await getSettings();
      setSettings(s);
      setNewCompetitor('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggle(id, active) {
    await toggleCompetitor(id, active);
    const s = await getSettings();
    setSettings(s);
  }

  async function handleDelete(id) {
    if (!confirm('Remove this competitor?')) return;
    await deleteCompetitor(id);
    const s = await getSettings();
    setSettings(s);
  }

  function toggleSection(key) {
    setSections(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  if (!settings) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-end" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white h-full w-full max-w-md overflow-y-auto shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 px-6 py-6 space-y-8">
          {/* Location */}
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-2">Location</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="City, State ZIP"
              className="w-full border border-stone-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
            <p className="text-xs text-stone-400 mt-1">Used to find nearby competitor locations via Google Places.</p>
          </div>

          {/* Sections */}
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-2">Brief Sections</label>
            <div className="space-y-2">
              {ALL_SECTIONS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sections.includes(key)}
                    onChange={() => toggleSection(key)}
                    className="rounded text-red-700 focus:ring-red-600"
                  />
                  <span className="text-sm text-stone-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Competitors */}
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-2">Tracked Competitors</label>
            <ul className="space-y-2 mb-4">
              {settings.competitors?.map(c => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!c.active}
                      onChange={() => handleToggle(c.id, !c.active)}
                      className="rounded text-red-700 focus:ring-red-600"
                    />
                    <span className={c.active ? 'text-stone-800' : 'text-stone-400 line-through'}>{c.name}</span>
                  </label>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-stone-300 hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={handleAddCompetitor} className="flex gap-2">
              <input
                type="text"
                value={newCompetitor}
                onChange={e => setNewCompetitor(e.target.value)}
                placeholder="Add competitor..."
                className="flex-1 border border-stone-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-stone-800 text-white text-sm rounded-md hover:bg-stone-700"
              >
                Add
              </button>
            </form>
          </div>

          {/* Competitor prices */}
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-2">Competitor Prices (Hanover)</label>
            <PriceEditor />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-red-700 hover:bg-red-600 disabled:bg-stone-300 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
