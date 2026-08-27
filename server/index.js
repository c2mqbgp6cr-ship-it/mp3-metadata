import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { File as TagFile, Picture, ByteVector, PictureType } from "node-taglib-sharp";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 4321;

const SUPPORTED_EXTENSIONS = [".mp3", ".wav", ".flac"];
// FLAC (lossless) can export to WAV or MP3. MP3 (already lossy) can only
// export to... nothing useful — decoding it to WAV gains no quality, and
// MP3-to-MP3 is a no-op — so MP3 sources get no conversion options at all.
const CONVERT_TARGETS_BY_SOURCE = { ".flac": ["wav", "mp3"] };
const CONVERT_TARGET_EXT = { wav: ".wav", mp3: ".mp3" };

// --- cover image optimizer ------------------------------------------------
//
// Goal: always end up with a strictly square cover, re-encoded as JPEG
// (the best size/quality trade-off for photographic cover art embedded in
// audio files), capped at ~500 KB without a visible quality hit. We try
// decreasing sizes, and for each size decreasing JPEG qualities, and stop
// as soon as we're under the target. This only ever touches the cover
// image buffer — never the audio file.

const COVER_MAX_BYTES = 500 * 1024;
const COVER_DIMENSIONS = [1400, 1100, 900, 700, 500];
const COVER_QUALITIES = [88, 80, 72, 64, 56, 48, 40];

async function optimizeCoverImage(inputBuffer) {
  let smallest = null;

  for (const size of COVER_DIMENSIONS) {
    for (const quality of COVER_QUALITIES) {
      const buffer = await sharp(inputBuffer)
        .rotate() // respect EXIF orientation before we bake in a square crop
        .resize(size, size, { fit: "cover", position: "centre" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (!smallest || buffer.length < smallest.buffer.length) {
        smallest = { buffer, size, quality };
      }
      if (buffer.length <= COVER_MAX_BYTES) {
        return {
          buffer,
          mime: "image/jpeg",
          width: size,
          height: size,
          quality,
          bytes: buffer.length,
        };
      }
    }
  }

  // Nothing hit the target (extremely detailed image) — ship the smallest
  // variant we managed to produce rather than failing the export.
  return {
    buffer: smallest.buffer,
    mime: "image/jpeg",
    width: smallest.size,
    height: smallest.size,
    quality: smallest.quality,
    bytes: smallest.buffer.length,
  };
}

// --- helpers ---------------------------------------------------------------

function assertSupportedAudio(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Chemin de fichier manquant.");
  }
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Format non supporté (${ext || "sans extension"}). Formats acceptés : ${SUPPORTED_EXTENSIONS.join(", ")}.`
    );
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("Fichier introuvable : " + resolved);
  }
  return resolved;
}

function readTagsSummary(filePath) {
  const file = TagFile.createFromPath(filePath);
  try {
    const tag = file.tag;
    return {
      path: filePath,
      fileName: path.basename(filePath),
      title: tag.title || "",
      artist: (tag.performers && tag.performers[0]) || "",
      bpm: tag.beatsPerMinute || null,
      hasCover: !!(tag.pictures && tag.pictures.length),
    };
  } finally {
    file.dispose();
  }
}

// --- audio format conversion (export) --------------------------------------
//
// Produces a NEW file next to the original in a different container (WAV or
// MP3) — the original file is never touched by this. Uses ffmpeg (bundled
// via ffmpeg-static, or FFMPEG_PATH if set) purely for audio transcoding,
// then re-applies the current tags with node-taglib-sharp so the exported
// copy carries the same Title/Artist/BPM/Cover.

let cachedFfmpegPath = null;

async function resolveFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;
  if (process.env.FFMPEG_PATH) {
    cachedFfmpegPath = process.env.FFMPEG_PATH;
    return cachedFfmpegPath;
  }
  try {
    const mod = await import("ffmpeg-static");
    cachedFfmpegPath = mod.default || mod;
    return cachedFfmpegPath;
  } catch {
    throw new Error(
      "ffmpeg introuvable. Réinstalle les dépendances serveur (npm install --prefix server) puis réessaie."
    );
  }
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d;
    });
    proc.on("error", (err) => reject(new Error("Impossible de lancer ffmpeg : " + err.message)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Échec de la conversion audio (ffmpeg) : " + stderr.slice(-500)));
    });
  });
}

function uniqueOutputPath(dir, baseName, ext) {
  let candidate = path.join(dir, `${baseName}${ext}`);
  let n = 1;
  while (fs.existsSync(candidate)) {
    n += 1;
    candidate = path.join(dir, `${baseName} (export ${n})${ext}`);
  }
  return candidate;
}

// --- routes ------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, formats: SUPPORTED_EXTENSIONS });
});

app.get("/api/track", (req, res) => {
  let file;
  try {
    const filePath = assertSupportedAudio(req.query.path);
    file = TagFile.createFromPath(filePath);
    const tag = file.tag;

    let cover = null;
    if (tag.pictures && tag.pictures.length) {
      const pic = tag.pictures[0];
      const mime = pic.mimeType || "image/jpeg";
      const buffer = Buffer.from(pic.data.toByteArray());
      cover = `data:${mime};base64,${buffer.toString("base64")}`;
    }

    res.json({
      path: filePath,
      title: tag.title || "",
      artist: (tag.performers && tag.performers[0]) || "",
      bpm: tag.beatsPerMinute || null,
      cover,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    file?.dispose();
  }
});

app.put("/api/track", async (req, res) => {
  let file;
  try {
    const { path: filePath, title, artist, bpm, cover, removeCover } = req.body || {};
    const resolved = assertSupportedAudio(filePath);

    file = TagFile.createFromPath(resolved);
    const tag = file.tag;

    if (typeof title === "string") tag.title = title;
    if (typeof artist === "string") tag.performers = artist ? [artist] : [];
    if (bpm !== undefined) {
      const parsed = bpm === "" || bpm === null ? 0 : Math.round(Number(bpm));
      tag.beatsPerMinute = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    // Title and Artist are required — mirrors the "obligatoire" validation
    // in the UI, enforced again here so the API can't be used to bypass it.
    const finalTitle = (tag.title || "").trim();
    const finalArtist = ((tag.performers && tag.performers[0]) || "").trim();
    if (!finalTitle || !finalArtist) {
      throw new Error("Le titre et l'artiste sont obligatoires.");
    }

    let coverInfo = null;
    if (removeCover) {
      tag.pictures = [];
    } else if (cover && typeof cover === "string" && cover.startsWith("data:")) {
      const match = cover.match(/^data:(.+);base64,(.*)$/);
      if (!match) throw new Error("Format d'image invalide.");
      const rawBuffer = Buffer.from(match[2], "base64");

      const optimized = await optimizeCoverImage(rawBuffer);
      coverInfo = optimized;

      const picture = Picture.fromFullData(
        ByteVector.fromByteArray(optimized.buffer),
        PictureType.FrontCover,
        optimized.mime,
        "Cover"
      );
      tag.pictures = [picture];
    }

    // save() only rewrites the tagging container appropriate to the file
    // format (ID3v2 for MP3/WAV, Xiph comments + picture block for FLAC).
    // The audio sample data itself is copied through untouched.
    file.save();
    file.dispose();
    file = undefined;

    const summary = readTagsSummary(resolved);
    const coverInfoOut = coverInfo
      ? { width: coverInfo.width, height: coverInfo.height, quality: coverInfo.quality, bytes: coverInfo.bytes, mime: coverInfo.mime }
      : null;
    res.json({ ok: true, track: summary, coverInfo: coverInfoOut });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    file?.dispose();
  }
});

app.post("/api/convert", async (req, res) => {
  let sourceFile;
  let outFile;
  try {
    const { path: filePath, format } = req.body || {};
    const resolved = assertSupportedAudio(filePath);
    const sourceExt = path.extname(resolved).toLowerCase();

    const allowedFormats = CONVERT_TARGETS_BY_SOURCE[sourceExt] || [];
    if (!allowedFormats.includes(format)) {
      throw new Error("Aucun export n'est proposé pour ce fichier dans ce format.");
    }
    const targetExt = CONVERT_TARGET_EXT[format];

    const dir = path.dirname(resolved);
    const baseName = path.basename(resolved, sourceExt);
    const outputPath = uniqueOutputPath(dir, baseName, targetExt);

    const ffmpegPath = await resolveFfmpegPath();
    const args =
      format === "wav"
        ? ["-y", "-i", resolved, "-map_metadata", "-1", "-c:a", "pcm_s16le", outputPath]
        : ["-y", "-i", resolved, "-map_metadata", "-1", "-c:a", "libmp3lame", "-q:a", "0", outputPath];
    await runFfmpeg(ffmpegPath, args);

    // Carry the current tags (title/artist/bpm/cover) over to the
    // freshly exported copy — ffmpeg was told to strip metadata (-map_metadata
    // -1) so we control exactly what lands in the new file.
    sourceFile = TagFile.createFromPath(resolved);
    outFile = TagFile.createFromPath(outputPath);
    outFile.tag.title = sourceFile.tag.title;
    outFile.tag.performers = sourceFile.tag.performers;
    outFile.tag.beatsPerMinute = sourceFile.tag.beatsPerMinute;
    if (sourceFile.tag.pictures && sourceFile.tag.pictures.length) {
      outFile.tag.pictures = sourceFile.tag.pictures;
    }
    outFile.save();

    res.json({ ok: true, path: outputPath, fileName: path.basename(outputPath) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    sourceFile?.dispose();
    outFile?.dispose();
  }
});

// Bind explicitly to loopback only — this server has no auth and can read/
// write files on request, so it must never be reachable from the local
// network (the Express/Node default of binding all interfaces would
// expose it to anyone on the same Wi-Fi while the app is open).
app.listen(PORT, "127.0.0.1", () => {
  console.log(`MP3 Metadata server listening on http://127.0.0.1:${PORT}`);
});
