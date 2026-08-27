const API_BASE = "http://localhost:4321";

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur HTTP ${res.status}`);
  }
  return data;
}

export function getTrack(path) {
  const url = `${API_BASE}/api/track?path=${encodeURIComponent(path)}`;
  return fetch(url).then(handle);
}

export function saveTrack(payload) {
  return fetch(`${API_BASE}/api/track`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function checkHealth() {
  return fetch(`${API_BASE}/api/health`).then(handle);
}

export function convertTrack(path, format) {
  return fetch(`${API_BASE}/api/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, format }),
  }).then(handle);
}
