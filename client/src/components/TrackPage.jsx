import { useEffect, useRef, useState } from "react";
import { getTrack, saveTrack, convertTrack } from "../api";
import { fileToSquareDataUrl } from "../imageUtils";

const emptyForm = { title: "", artist: "", bpm: "", cover: null };
const CONVERT_LABELS = { wav: "Exporter en WAV", mp3: "Exporter en MP3" };

function baseNameOf(fileName) {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

function extensionOf(fileName) {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for contexts where the async clipboard API isn't available.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}

export default function TrackPage({ path, fileName, onBack, recentExports = [], onExported }) {
  const [form, setForm] = useState(emptyForm);
  const [initialCover, setInitialCover] = useState(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cropNotice, setCropNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [convertingFormat, setConvertingFormat] = useState(null);
  const [convertStatus, setConvertStatus] = useState("");
  const [convertError, setConvertError] = useState("");
  const [confirmBack, setConfirmBack] = useState(false);
  const [coverDragging, setCoverDragging] = useState(false);
  const fileInputRef = useRef(null);

  const baseName = baseNameOf(fileName);
  const sourceExt = extensionOf(fileName);
  // Exporting MP3 -> WAV would just decode an already-lossy file into a
  // bigger container with no quality gained, so we only offer conversions
  // for lossless FLAC sources (to WAV or MP3).
  const convertTargets = sourceExt === "flac" ? ["wav", "mp3"] : [];
  const titleFilled = form.title.trim() !== "";
  const artistFilled = form.artist.trim() !== "";
  const canExport = titleFilled && artistFilled;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setStatus("");
    setCropNotice("");
    setCoverRemoved(false);
    setConvertStatus("");
    setConvertError("");
    getTrack(path)
      .then((data) => {
        if (cancelled) return;
        setForm({
          title: data.title || "",
          artist: data.artist || "",
          bpm: data.bpm ? String(data.bpm) : "",
          cover: data.cover || null,
        });
        setInitialCover(data.cover || null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path]);

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setStatus("");
  }

  function applyRecent(entry) {
    setForm((f) => ({
      ...f,
      title: entry.title,
      artist: entry.artist,
      bpm: entry.bpm ? String(entry.bpm) : "",
      cover: entry.cover || f.cover,
    }));
    setCoverRemoved(false);
    setCropNotice("");
    setStatus(`Infos reprises de "${entry.title || entry.artist}".`);
    setError("");
  }

  async function processCoverFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Seuls les fichiers image sont acceptés pour la cover.");
      return;
    }
    try {
      const { dataUrl, wasCropped } = await fileToSquareDataUrl(file);
      setForm((f) => ({ ...f, cover: dataUrl }));
      setCoverRemoved(false);
      setCropNotice(wasCropped ? "Image recadrée automatiquement au centre pour obtenir un carré." : "");
      setStatus("");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  function handleCoverChange(e) {
    processCoverFile(e.target.files?.[0]);
  }

  function handleCoverDragOver(e) {
    e.preventDefault();
    setCoverDragging(true);
  }

  function handleCoverDragLeave() {
    setCoverDragging(false);
  }

  function handleCoverDrop(e) {
    e.preventDefault();
    setCoverDragging(false);
    processCoverFile(e.dataTransfer.files?.[0]);
  }

  function handleRemoveCover() {
    setForm((f) => ({ ...f, cover: null }));
    setCoverRemoved(true);
    setCropNotice("");
  }

  async function handleExport() {
    if (!canExport) {
      setStatus("");
      setError("Le titre et l'artiste sont obligatoires avant d'exporter.");
      return;
    }
    setExporting(true);
    setError("");
    setStatus("");
    try {
      const payload = {
        path,
        title: form.title,
        artist: form.artist,
        bpm: form.bpm,
      };
      if (coverRemoved) {
        payload.removeCover = true;
      } else if (form.cover && form.cover !== initialCover) {
        payload.cover = form.cover;
      }
      const res = await saveTrack(payload);
      let msg = "Exporté ✓ — fichier d'origine mis à jour, audio inchangé";
      if (res.coverInfo) {
        const ko = Math.round(res.coverInfo.bytes / 1024);
        msg += ` · cover optimisée ${res.coverInfo.width}×${res.coverInfo.height} (${ko} Ko)`;
      }
      setStatus(msg);
      setInitialCover(form.cover);
      setCoverRemoved(false);
      onExported?.({ title: form.title, artist: form.artist, bpm: form.bpm, cover: form.cover });
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleCopyFileName() {
    try {
      await copyToClipboard(baseName);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Impossible de copier le nom du fichier.");
    }
  }

  async function handleConvert(format) {
    setConvertingFormat(format);
    setConvertStatus("");
    setConvertError("");
    try {
      const res = await convertTrack(path, format);
      setConvertStatus(`Créé ✓ — ${res.fileName} (même dossier que l'original)`);
    } catch (err) {
      setConvertError(err.message);
    } finally {
      setConvertingFormat(null);
    }
  }

  return (
    <div className="track-page">
      <div className="track-page-header">
        <button type="button" className="back-btn" onClick={() => setConfirmBack(true)}>
          ←
        </button>
        <span className="track-page-filename">{fileName}</span>
      </div>

      {confirmBack && (
        <div className="modal-overlay" onClick={() => setConfirmBack(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-title">Revenir à l'accueil ?</p>
            <p className="modal-text">Tu quitteras la fiche de ce morceau. Dépose-le à nouveau pour la rouvrir.</p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setConfirmBack(false)}>
                Annuler
              </button>
              <button type="button" onClick={onBack}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="track-page-body">
        {loading ? (
          <p className="empty-state">Chargement du morceau…</p>
        ) : (
          <>
            <div className="cover-block">
              <div
                className={`cover-preview${coverDragging ? " dragging" : ""}`}
                onDragOver={handleCoverDragOver}
                onDragLeave={handleCoverDragLeave}
                onDrop={handleCoverDrop}
              >
                {form.cover ? (
                  <img src={form.cover} alt="Cover" />
                ) : (
                  <span className="cover-placeholder">Glisse une image ici</span>
                )}
              </div>
              <div className="cover-actions">
                <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
                  Choisir une image
                </button>
                {form.cover && (
                  <button type="button" className="danger" onClick={handleRemoveCover}>
                    Retirer
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleCoverChange}
                />
              </div>
              {cropNotice && <p className="hint">{cropNotice}</p>}
            </div>

            <div>
              <p className="ios-group-label">Fichier</p>
              <div className="ios-group">
                <div className="ios-row info-row">
                  <div className="info-row-text">
                    <p className="info-row-label">Nom de fichier (sans extension)</p>
                    <p className="info-row-value">{baseName}</p>
                  </div>
                  <button type="button" className="secondary" onClick={handleCopyFileName}>
                    {copied ? "Copié ✓" : "Copier"}
                  </button>
                </div>
              </div>
            </div>

            {recentExports.length > 0 && (
              <div>
                <p className="ios-group-label">Réutiliser un morceau récent</p>
                <div className="ios-group recent-group">
                  {recentExports.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="recent-row"
                      onClick={() => applyRecent(entry)}
                    >
                      <span className="recent-thumb">
                        {entry.cover ? (
                          <img src={entry.cover} alt="" />
                        ) : (
                          <span className="recent-thumb-placeholder">♪</span>
                        )}
                      </span>
                      <span className="recent-text">
                        <span className="recent-title">{entry.title || "—"}</span>
                        <span className="recent-sub">
                          {entry.artist || "—"}
                          {entry.bpm ? ` · ${entry.bpm} BPM` : ""}
                        </span>
                      </span>
                      <span className="recent-apply">Appliquer</span>
                    </button>
                  ))}
                </div>
                <p className="hint">
                  Reprend titre, artiste, BPM et cover sur ce fichier — rien n'est écrit tant que tu
                  n'as pas cliqué sur "Exporter".
                </p>
              </div>
            )}

            <div>
              <p className="ios-group-label">Métadonnées</p>
              <div className="ios-group">
                <label className="ios-row">
                  <span className="ios-row-label">Titre <span className="required-mark">*</span></span>
                  <input
                    type="text"
                    placeholder="—"
                    value={form.title}
                    onChange={(e) => updateField("title", e.target.value)}
                  />
                </label>
                <label className="ios-row">
                  <span className="ios-row-label">Artiste <span className="required-mark">*</span></span>
                  <input
                    type="text"
                    placeholder="—"
                    value={form.artist}
                    onChange={(e) => updateField("artist", e.target.value)}
                  />
                </label>
                <label className="ios-row bpm-row">
                  <span className="ios-row-label">BPM</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    inputMode="numeric"
                    placeholder="—"
                    value={form.bpm}
                    onChange={(e) => updateField("bpm", e.target.value)}
                  />
                </label>
              </div>
            </div>

            {convertTargets.length > 0 && (
              <div>
                <p className="ios-group-label">Exporter dans un autre format</p>
                <div className="ios-group convert-actions">
                  {convertTargets.map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className="convert-row"
                      onClick={() => handleConvert(fmt)}
                      disabled={convertingFormat !== null}
                    >
                      <span>{convertingFormat === fmt ? "Export…" : CONVERT_LABELS[fmt]}</span>
                      <span>›</span>
                    </button>
                  ))}
                </div>
                {(convertStatus || convertError) && (
                  <div className="convert-status-wrap">
                    {convertStatus && <p className="status-ok">{convertStatus}</p>}
                    {convertError && <p className="status-error">{convertError}</p>}
                  </div>
                )}
                <p className="hint">Fichier séparé créé à côté de l'original, qui n'est jamais modifié.</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="track-page-footer">
        {status && <p className="status-ok">{status}</p>}
        {error && <p className="status-error">{error}</p>}
        <button
          type="button"
          className="export-btn"
          onClick={handleExport}
          disabled={exporting || loading || !canExport}
        >
          {exporting ? "Export…" : "Exporter"}
        </button>
        <p className="hint">
          {!canExport && !loading
            ? "Titre et Artiste sont obligatoires pour pouvoir exporter."
            : "Écrit les tags dans le fichier d'origine — l'audio n'est jamais modifié."}
        </p>
      </div>
    </div>
  );
}
