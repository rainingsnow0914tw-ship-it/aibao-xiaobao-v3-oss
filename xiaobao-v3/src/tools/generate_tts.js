import { spawn } from "node:child_process";
import { getAccessToken } from "../gcp-auth.js";
import { uploadBytes } from "../gcs.js";

const TTS_MODE = (process.env.TTS_MODE || "cloud").toLowerCase();

const CLOUD_TTS_VOICE = process.env.CLOUD_TTS_VOICE || "cmn-TW-Wavenet-A";
const CLOUD_TTS_LANG = process.env.CLOUD_TTS_LANG || "cmn-TW";

const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Kore";
const GEMINI_PCM_RATE = 24000;

const VERTEX_PROJECT = process.env.VERTEX_PROJECT || "aibao-v3";

function randomKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mp3ToM4a(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "mp3",
      "-i", "pipe:0",
      "-c:a", "aac",
      "-b:a", "64k",
      "-movflags", "frag_keyframe+empty_moov",
      "-f", "mp4",
      "pipe:1",
    ]);
    const chunks = [];
    let err = "";
    ff.stdout.on("data", c => chunks.push(c));
    ff.stderr.on("data", c => { err += c.toString(); });
    ff.on("error", e => reject(e));
    ff.on("close", code => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg mp3→m4a exit ${code}: ${err.slice(0, 200)}`));
    });
    ff.stdin.write(mp3Buffer);
    ff.stdin.end();
  });
}

function pcmToM4a(pcmBuffer, sampleRate = GEMINI_PCM_RATE) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "s16le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "-i", "pipe:0",
      "-c:a", "aac",
      "-b:a", "64k",
      "-movflags", "frag_keyframe+empty_moov",
      "-f", "mp4",
      "pipe:1",
    ]);
    const chunks = [];
    let err = "";
    ff.stdout.on("data", c => chunks.push(c));
    ff.stderr.on("data", c => { err += c.toString(); });
    ff.on("error", e => reject(e));
    ff.on("close", code => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg pcm→m4a exit ${code}: ${err.slice(0, 200)}`));
    });
    ff.stdin.write(pcmBuffer);
    ff.stdin.end();
  });
}

function estimateDurationMsFromMp3ByteSize(byteSize) {
  return Math.round(byteSize * 1000 / 8000);
}

function estimateDurationMsFromPcm(pcm, sampleRate = GEMINI_PCM_RATE) {
  const samples = pcm.length / 2;
  return Math.round(samples * 1000 / sampleRate);
}

async function synthesizeCloudTts(text) {
  const token = await getAccessToken();
  if (!token) throw new Error("no access token");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
        "x-goog-user-project": VERTEX_PROJECT,
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: CLOUD_TTS_LANG, name: CLOUD_TTS_VOICE },
        audioConfig: { audioEncoding: "MP3" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Cloud TTS ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const data = await response.json();
    const mp3 = Buffer.from(data.audioContent, "base64");
    return { pcm: null, mp3, sampleRate: null };
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeGeminiTts(text) {
  const token = await getAccessToken();
  if (!token) throw new Error("no access token");
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/global/publishers/google/models/${GEMINI_TTS_MODEL}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Gemini TTS ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find(p => (p.inlineData || p.inline_data)?.data);
    if (!audioPart) throw new Error("Gemini TTS empty");
    const inline = audioPart.inlineData || audioPart.inline_data;
    const pcm = Buffer.from(inline.data, "base64");
    return { pcm, mp3: null, sampleRate: GEMINI_PCM_RATE };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateTts(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const t0 = Date.now();
  console.log(`[tts] start mode=${TTS_MODE} len=${trimmed.length}`);

  let result;
  try {
    if (TTS_MODE === "gemini") {
      result = await synthesizeGeminiTts(trimmed);
    } else {
      result = await synthesizeCloudTts(trimmed);
    }
    console.log(`[tts] synth ${Date.now() - t0}ms`);
  } catch (e) {
    console.warn(`[tts] ${TTS_MODE} synth error after ${Date.now() - t0}ms:`, e.message);
    return null;
  }

  let m4a;
  let duration;
  try {
    if (result.mp3) {
      m4a = await mp3ToM4a(result.mp3);
      duration = estimateDurationMsFromMp3ByteSize(result.mp3.length);
    } else if (result.pcm) {
      m4a = await pcmToM4a(result.pcm, result.sampleRate);
      duration = estimateDurationMsFromPcm(result.pcm, result.sampleRate);
    } else {
      return null;
    }
  } catch (e) {
    console.warn("[tts] ffmpeg m4a error:", e.message);
    return null;
  }

  const filename = `audio/${randomKey()}.m4a`;
  try {
    const url = await uploadBytes({
      name: filename,
      bytes: m4a,
      mimeType: "audio/mp4",
    });
    return { url, duration };
  } catch (e) {
    console.warn("[tts] GCS upload error:", e.message);
    return null;
  }
}
