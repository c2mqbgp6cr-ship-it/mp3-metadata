import { useEffect, useState } from "react";
import DropZone from "./components/DropZone";
import TrackPage from "./components/TrackPage";
import { checkHealth } from "./api";
import { useTheme } from "./useTheme";
import "./App.css";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [currentTrack, setCurrentTrack] = useState(null);
  const [serverUp, setServerUp] = useState(true);
  const [dropError, setDropError] = useState("");
  // In-memory only: cleared on refresh/app restart, never written to disk.
  // Lets the user reuse title/artist/bpm/cover from a track exported
  // earlier in this session onto a different file for the same song.
  const [recentExports, setRecentExports] = useState([]);

  useEffect(() => {
    // In dev, `wait-on` (see package.json) already blocks Electron from
    // opening until the API server answers, so this succeeds instantly.
    // In a packaged app, main.js spawns the server itself right before
    // opening this window, so it can take a beat to come up — retry with
    // backoff instead of flashing a permanent "server down" banner.
    let cancelled = false;
    const delays = [300, 600, 1000, 1500, 2000, 2000, 2000];
    async function pingUntilUp() {
      for (const delay of delays) {
        if (cancelled) return;
        try {
          await checkHealth();
          if (!cancelled) setServerUp(true);
          return;
        } catch {
          if (!cancelled) setServerUp(false);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    pingUntilUp();
    return () => {
      cancelled = true;
    };
  }, []);

  function addRecentExport({ title, artist, bpm, cover }) {
    const trimmedTitle = (title || "").trim();
    const trimmedArtist = (artist || "").trim();
    if (!trimmedTitle && !trimmedArtist) return;
    setRecentExports((prev) => {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: trimmedTitle,
        artist: trimmedArtist,
        bpm: bpm || "",
        cover: cover || null,
      };
      // Drop any earlier entry with the exact same title/artist/bpm so the
      // freshest export of a given song floats to the top instead of
      // piling up duplicates.
      const deduped = prev.filter(
        (e) => !(e.title === entry.title && e.artist === entry.artist && String(e.bpm) === String(entry.bpm))
      );
      return [entry, ...deduped].slice(0, 8);
    });
  }

  function handleFiles(fileList) {
    setDropError("");

    if (!window.electronAPI?.isElectron) {
      setDropError(
        "Le glisser-déposer ne peut écrire sur le disque que dans l'app desktop (Electron), pas dans un onglet de navigateur classique."
      );
      return;
    }

    const SUPPORTED = [".mp3", ".wav", ".flac"];
    const files = Array.from(fileList).filter((f) =>
      SUPPORTED.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (!files.length) {
      setDropError("Seuls les fichiers .mp3, .wav et .flac sont acceptés.");
      return;
    }

    const file = files[0];
    setCurrentTrack({
      path: window.electronAPI.getPathForFile(file),
      fileName: file.name,
    });
  }

  if (currentTrack) {
    return (
      <div className="app">
        <TrackPage
          path={currentTrack.path}
          fileName={currentTrack.fileName}
          onBack={() => setCurrentTrack(null)}
          recentExports={recentExports}
          onExported={addRecentExport}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-icon">♪</span>
          <div>
            <h1>MP3 Metadata</h1>
            <p className="app-sub">MP3 · WAV · FLAC — édition locale sans réencodage audio</p>
          </div>
        </div>
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Changer de thème">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </header>

      {!serverUp && (
        <div className="banner-error">
          Le serveur local ne répond pas sur http://localhost:4321.
        </div>
      )}
      {dropError && <p className="status-error">{dropError}</p>}

      <DropZone onFiles={handleFiles} />
    </div>
  );
}
