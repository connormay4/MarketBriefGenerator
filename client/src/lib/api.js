const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

export async function getBriefs() {
  const res = await fetch(`${BASE}/briefs`);
  if (!res.ok) throw new Error('Failed to load briefs');
  return res.json();
}

export async function getBrief(id) {
  const res = await fetch(`${BASE}/briefs/${id}`);
  if (!res.ok) throw new Error('Brief not found');
  return res.json();
}

export async function deleteBrief(id) {
  const res = await fetch(`${BASE}/briefs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}

export async function getSettings() {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

export async function saveSettings(data) {
  const res = await fetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

export async function addCompetitor(name) {
  const res = await fetch(`${BASE}/settings/competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error('Failed to add competitor');
  return res.json();
}

export async function toggleCompetitor(id, active) {
  const res = await fetch(`${BASE}/settings/competitors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  });
  if (!res.ok) throw new Error('Failed to update competitor');
  return res.json();
}

export async function deleteCompetitor(id) {
  const res = await fetch(`${BASE}/settings/competitors/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}

export async function getPrices() {
  const res = await fetch(`${BASE}/settings/prices`);
  if (!res.ok) throw new Error('Failed to load prices');
  return res.json();
}

export async function savePrice(data) {
  const res = await fetch(`${BASE}/settings/prices`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save price');
  return res.json();
}

export async function getLatestRanking() {
  const res = await fetch(`${BASE}/rankings/latest`);
  if (!res.ok) throw new Error('Failed to load ranking');
  return res.json();
}

// Stream a 25-CFA ranking refresh (SSE). Mirrors generateBrief's reader.
export function refreshRanking({ onProgress, onComplete, onError }) {
  return streamSSE(`${BASE}/rankings/refresh`, { onProgress, onComplete, onError });
}

// Returns an EventSource-compatible reader; calls onProgress(event) and onComplete({id, brief})
export function generateBrief({ onProgress, onComplete, onError }) {
  return streamSSE(`${BASE}/briefs/generate`, { onProgress, onComplete, onError });
}

// Shared SSE POST reader (buffers across chunks; dispatches event blocks).
function streamSSE(url, { onProgress, onComplete, onError }) {
  const controller = new AbortController();

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal
  }).then(async res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    // Parse ONE complete SSE event block ("event: x\ndata: {...}") and dispatch.
    const dispatch = (rawEvent) => {
      let eventType = 'message';
      const dataLines = [];
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (!dataLines.length) return;
      try {
        const payload = JSON.parse(dataLines.join('\n'));
        if (eventType === 'progress') onProgress?.(payload);
        else if (eventType === 'complete') onComplete?.(payload);
        else if (eventType === 'error') onError?.(new Error(payload.message));
      } catch {}
    };

    // CRITICAL: `buffer` persists across reads. SSE events are delimited by a
    // blank line (\n\n). A single network chunk may contain several events, a
    // partial event, or split one event in two — especially the large final
    // "complete" payload. The previous parser reset its state every chunk, so a
    // split event (the brief) was dropped and the UI never updated. Here we keep
    // the trailing partial event in `buffer` until its terminator arrives.
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (rawEvent.trim()) dispatch(rawEvent);
      }
    }
    // Flush a final event that wasn't terminated by a trailing blank line.
    if (buffer.trim()) dispatch(buffer);
  }).catch(err => {
    if (err.name !== 'AbortError') onError?.(err);
  });

  return { abort: () => controller.abort() };
}
