#!/usr/bin/env node
// =============================================================================
// Daily Thrive — TTS Greeting Generator
// =============================================================================
// Generates a 10-second daily greeting (date + Berlin weather + affirmation),
// renders it to MP3 with Piper, and updates feed.xml so Spotify can ingest it
// as a new episode of your personal podcast.
//
// Env vars (all optional — sensible defaults):
//   PIPER_BIN          path to piper binary       (default: ./piper/piper)
//   PIPER_VOICE_PATH   path to .onnx voice model  (default: ./voices/en_US-amy-medium.onnx)
//   GITHUB_PAGES_URL   base URL where audio + feed are served
//                                                 (default: https://darianpiro.github.io/dailythrive)
// =============================================================================

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// =============================================================================
// Config — edit these to taste
// =============================================================================
const CONFIG = {
  name: "Piro",
  city: "Berlin",
  // Open-Meteo coords for Berlin
  lat: 52.52,
  lon: 13.41,
  timezone: "Europe/Berlin",

  // Piper
  piperBin: process.env.PIPER_BIN || "./piper/piper",
  voicePath: process.env.PIPER_VOICE_PATH || "./voices/en_US-amy-medium.onnx",

  // Output / hosting
  audioDir: "audio",
  feedFile: "feed.xml",
  baseUrl: process.env.GITHUB_PAGES_URL || "https://darianpiro.github.io/dailythrive",

  // Retention
  keepDays: 30,    // delete audio files older than this many days
  feedItems: 14,   // how many <item>s to keep in feed.xml

  // RSS channel-level metadata (shown in Spotify for Creators)
  authorName: "Daniel Piro",
  authorEmail: "noreply@example.com",
  showTitle: "Daily Thrive Greeting",
  showDescription: "Personal daily greeting for the Daily Thrive playlist.",
};

// =============================================================================
// Slot variants — each slot is picked independently each run
// =============================================================================
const SLOTS = {
  salutation: [
    "Good morning, {name}.",
    "Morning, {name}.",
    "Hi {name}.",
    "Hey {name}.",
  ],
  dateIntro: [
    "It's {date}.",
    "Today is {date}.",
    "Welcome to {date}.",
    "{date} is here.",
    "We've made it to {date}.",
  ],
  weather: [
    "The weather in {city} today: {temp} degrees, {condition}.",
    "Outside in {city}: {temp} degrees and {condition}.",
    "{city}'s looking {condition} today, around {temp} degrees.",
    "In {city} right now, it's {temp} degrees and {condition}.",
    "{temp} degrees and {condition} in {city} today.",
  ],
  setup: [
    "Settle in — your mix is ready.",
    "Your Daily Thrive is queued up.",
    "Let's get into today's mix.",
    "Time to press play.",
    "Your playlist's ready when you are.",
  ],
};

// =============================================================================
// Helpers
// =============================================================================
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDateLong(date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month   = date.toLocaleDateString("en-US", { month: "long" });
  const day     = ordinal(date.getDate());
  return `${weekday}, ${month} ${day}, ${date.getFullYear()}`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c])
  );
}

/**
 * Map an Open-Meteo WMO weather code to a short adjectival description that
 * slots cleanly into all of the weather sentence variants above.
 */
function wmoToCondition(code) {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 67) return "rainy";
  if (code >= 71 && code <= 77) return "snowy";
  if (code >= 80 && code <= 82) return "rainy";
  if (code >= 85 && code <= 86) return "snowy";
  if (code >= 95 && code <= 99) return "stormy";
  return "mixed";
}

async function fetchWeather() {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}` +
    `&current=temperature_2m,weather_code` +
    `&timezone=${encodeURIComponent(CONFIG.timezone)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();
  return {
    temp: Math.round(data.current.temperature_2m),
    condition: wmoToCondition(data.current.weather_code),
  };
}

// =============================================================================
// Audio cleanup + feed regeneration
// =============================================================================
function pruneOldAudio() {
  const cutoff = Date.now() - CONFIG.keepDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(CONFIG.audioDir).filter((f) => f.endsWith(".mp3"));
  let removed = 0;
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.mp3$/);
    if (!m) continue;
    const fileTime = Date.parse(m[1] + "T00:00:00Z");
    if (fileTime < cutoff) {
      fs.unlinkSync(path.join(CONFIG.audioDir, f));
      removed++;
    }
  }
  if (removed > 0) console.log(`🧹 Pruned ${removed} audio file(s) older than ${CONFIG.keepDays} days`);
}

function regenerateFeed() {
  const files = fs
    .readdirSync(CONFIG.audioDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.mp3$/.test(f))
    .sort()
    .reverse() // newest first
    .slice(0, CONFIG.feedItems);

  const items = files
    .map((f) => {
      const isoDate = f.replace(".mp3", "");
      const date = new Date(isoDate + "T06:00:00Z");
      const stat = fs.statSync(path.join(CONFIG.audioDir, f));
      const title = formatDateLong(date);
      return `    <item>
      <title>${escapeXml(title)}</title>
      <description>${escapeXml(CONFIG.showDescription + " " + title)}</description>
      <pubDate>${date.toUTCString()}</pubDate>
      <enclosure url="${CONFIG.baseUrl}/${CONFIG.audioDir}/${f}" length="${stat.size}" type="audio/mpeg"/>
      <guid isPermaLink="false">daily-thrive-${isoDate}</guid>
      <itunes:duration>30</itunes:duration>
    </item>`;
    })
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(CONFIG.showTitle)}</title>
    <link>${CONFIG.baseUrl}/</link>
    <description>${escapeXml(CONFIG.showDescription)}</description>
    <language>en-us</language>
    <itunes:author>${escapeXml(CONFIG.authorName)}</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:owner>
      <itunes:name>${escapeXml(CONFIG.authorName)}</itunes:name>
      <itunes:email>${escapeXml(CONFIG.authorEmail)}</itunes:email>
    </itunes:owner>
    <itunes:category text="Health &amp; Fitness"/>
    <itunes:type>episodic</itunes:type>
${items}
  </channel>
</rss>
`;
  fs.writeFileSync(CONFIG.feedFile, feed);
}

// =============================================================================
// Main
// =============================================================================
async function main() {
  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10);

  // 1. Fetch weather
  console.log("🌤  Fetching Berlin weather...");
  const weather = await fetchWeather();
  console.log(`   ${weather.temp}°C, ${weather.condition}`);

  // 2. Load affirmations
  const affirmations = JSON.parse(
    fs.readFileSync(path.join("scripts", "affirmations.json"), "utf8")
  );

  // 3. Build greeting text by sampling each slot
  const vars = {
    name: CONFIG.name,
    city: CONFIG.city,
    date: formatDateLong(today),
    temp: weather.temp,
    condition: weather.condition,
  };
  const text = [
    fill(pick(SLOTS.salutation), vars),
    fill(pick(SLOTS.dateIntro), vars),
    fill(pick(SLOTS.weather), vars),
    fill(pick(SLOTS.setup), vars),
    pick(affirmations),
  ].join(" ");

  console.log("\n📝 Greeting:\n   " + text + "\n");

  // 4. Render with Piper → WAV
  if (!fs.existsSync(CONFIG.audioDir)) fs.mkdirSync(CONFIG.audioDir, { recursive: true });
  const wavPath = path.join(CONFIG.audioDir, `${isoDate}.wav`);
  const mp3Path = path.join(CONFIG.audioDir, `${isoDate}.mp3`);

  console.log("🔊 Synthesizing with Piper...");
  execSync(
    `${CONFIG.piperBin} --model ${CONFIG.voicePath} --output_file ${wavPath}`,
    { input: text, stdio: ["pipe", "inherit", "inherit"] }
  );

  // 5. Convert to MP3 (smaller, what Spotify ingests)
  console.log("🎵 Encoding MP3...");
  execSync(
    `ffmpeg -y -loglevel error -i ${wavPath} -codec:a libmp3lame -qscale:a 4 ${mp3Path}`
  );
  fs.unlinkSync(wavPath);
  console.log(`✅ ${mp3Path} (${(fs.statSync(mp3Path).size / 1024).toFixed(1)} KB)`);

  // 6. Prune ancient audio files and regenerate the RSS feed
  pruneOldAudio();
  regenerateFeed();
  console.log(`✅ ${CONFIG.feedFile} regenerated (${CONFIG.feedItems} most-recent items)`);
}

main().catch((e) => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
