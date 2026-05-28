const BASE = '/api';

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

// Returns an EventSource-compatible reader; calls onProgress(event) and onComplete({id, brief})
export function generateBrief({ onProgress, onComplete, onError }) {
  const controller = new AbortController();

  fetch(`${BASE}/briefs/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal
  }).then(async res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      let eventType = null;
      let dataLine = null;

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataLine = line.slice(6).trim();
        } else if (line === '' && eventType && dataLine) {
          try {
            const payload = JSON.parse(dataLine);
            if (eventType === 'progress') onProgress?.(payload);
            else if (eventType === 'complete') onComplete?.(payload);
            else if (eventType === 'error') onError?.(new Error(payload.message));
          } catch {}
          eventType = null;
          dataLine = null;
        }
      }
    }
  }).catch(err => {
    if (err.name !== 'AbortError') onError?.(err);
  });

  return { abort: () => controller.abort() };
}
