// node tts.mjs <out.mp3> <text-file> [voiceId]  — ElevenLabs eleven_v3
// Ключ: переменная ELEVENLABS_API_KEY или файл ~/.secrets/elevenlabs.key (в репозиторий не кладётся)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [out = 'vo.mp3', textFile = 'vo.txt', voice = 'TX3LPaxmHKxFdv7VOQHJ'] = process.argv.slice(2);
const keyFile = path.join(os.homedir(), '.secrets', 'elevenlabs.key');
const key = (process.env.ELEVENLABS_API_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!key) { console.error('Нет ключа: положи его в ~/.secrets/elevenlabs.key или ELEVENLABS_API_KEY'); process.exit(1); }
const text = fs.readFileSync(textFile, 'utf8').trim();

const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_192`, {
  method: 'POST',
  headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, model_id: 'eleven_v3', language_code: 'ru', voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
});
if (!r.ok) { console.error(r.status, (await r.text()).slice(0, 300)); process.exit(1); }
const j = await r.json();
fs.writeFileSync(out, Buffer.from(j.audio_base64, 'base64'));
// посимвольные тайминги -> слова
const a = j.alignment, words = [];
let cur = null;
for (let i = 0; i < a.characters.length; i++) {
  const ch = a.characters[i];
  if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null; } continue; }
  if (!cur) cur = { w: '', start: a.character_start_times_seconds[i] };
  cur.w += ch; cur.end = a.character_end_times_seconds[i];
}
if (cur) words.push(cur);
fs.writeFileSync(out.replace(/\.mp3$/, '.words.json'), JSON.stringify(words, null, 1));
console.log(words.map(w => `${w.start.toFixed(2)}-${w.end.toFixed(2)} ${w.w}`).join('\n'));
console.log(`\nГотово: ${out} + ${out.replace(/\.mp3$/, '.words.json')}`);
