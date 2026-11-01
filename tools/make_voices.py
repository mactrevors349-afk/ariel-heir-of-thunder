"""
Generate the game's spoken dialogue with Microsoft neural voices.

Usage (from the project folder):
    python -m pip install edge-tts
    python tools/make_voices.py            # only makes clips that are missing
    python tools/make_voices.py --force    # re-records every line
    python tools/make_voices.py --redo=Ares,Narrator   # re-records those speakers (after a recast)

It reads every spoken line straight from the game code:
  - cutscenes:  c.say('Speaker', '...')         in js/cutscenes.js
  - narration:  const narration = [ '...', ]    in js/cutscenes.js
  - Hermes:     hermes('...')                   in js/game.js
  - echoes:     text: '...'                     in js/world.js
  - mid-fight:  UI.subtitle('Speaker', '...')   in js/enemies.js
  - Ares' hold: const GRIP_LINES = { Speaker: ['...'] }  in js/player.js
  (God Mode's cutscene, SCRIPTS.godMode, is in cutscenes.js with the rest)
Each line is delivered with its own rate, pitch and volume on top of the speaker's (see delivery).
and writes assets/voice/<id>.mp3 plus assets/voice/manifest.json.
The id is an FNV-1a hash of "Speaker|text", the same hash js/core.js uses,
so editing a line in the code simply needs this script run again.
"""
import asyncio
import json
import pathlib
import re
import sys

import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'voice'

# speaker: (voice, rate, pitch)
CAST = {
    # Andrew is the most human-sounding neural voice: slowed and lowered he becomes a warm, deep storyteller
    # (the game also plays him back a little slower with a low-end lift, see Voice.FX in js/core.js)
    'Narrator': ('en-US-AndrewMultilingualNeural', '-14%', '-11Hz'),
    'Ariel': ('en-US-BrianMultilingualNeural', '+4%', '+0Hz'),
    'Hermes': ('en-GB-RyanNeural', '+7%', '+0Hz'),
    # Guy carries anger best of the deep voices: the God of War raging, not reading a statement
    'Ares': ('en-US-GuyNeural', '-7%', '-11Hz'),
    'Zeus': ('en-GB-ThomasNeural', '-12%', '-7Hz'),
    # Ariel's ordinary life: the most human-sounding voices, each kept to one person
    'Anna': ('en-US-EmmaMultilingualNeural', '-5%', '-2Hz'),      # his mother: warm, tired, wry
    'Jesse': ('en-US-AvaMultilingualNeural', '+3%', '+1Hz'),      # seventeen, quick, teasing
    'Marcus': ('en-US-RogerNeural', '+4%', '+2Hz'),               # a classmate: lively
    'Principal': ('en-US-EricNeural', '-4%', '-3Hz'),
}
# each echo message is a different fallen demigod (none shares a voice with the cast above)
ECHO_VOICES = [
    ('en-US-JennyNeural', '-4%', '+0Hz'),
    ('en-IE-ConnorNeural', '-4%', '+0Hz'),
    ('en-US-MichelleNeural', '-4%', '+0Hz'),
    ('en-AU-WilliamMultilingualNeural', '-4%', '+0Hz'),
    ('en-GB-SoniaNeural', '-4%', '+0Hz'),
    ('en-US-EricNeural', '-6%', '+0Hz'),
]
# how a line is pronounced when it differs from how it is written
SPOKEN = [('ARES', 'Ares'), ('GIANT', 'giant'), ('▸', ',')]

STR = r"'((?:[^'\\]|\\.)*)'"


def unescape(s):
    return re.sub(r'\\(.)', lambda m: {'n': '\n', 't': '\t'}.get(m.group(1), m.group(1)), s)


def collect():
    lines = []
    js = lambda name: (ROOT / 'js' / name).read_text(encoding='utf-8')
    cut = js('cutscenes.js')
    for m in re.finditer(r"\bsay\(\s*'(\w+)'\s*,\s*" + STR, cut):
        lines.append((m.group(1), unescape(m.group(2)), None))
    block = re.search(r'const narration = \[(.*?)\];', cut, re.S)
    if block:
        for m in re.finditer(STR, block.group(1)):
            lines.append(('Narrator', unescape(m.group(1)), None))
    for m in re.finditer(r"\bhermes\(\s*" + STR, js('game.js')):
        lines.append(('Hermes', unescape(m.group(1)), None))
    for m in re.finditer(r"UI\.subtitle\(\s*'(\w+)'\s*,\s*" + STR, js('enemies.js')):
        lines.append((m.group(1), unescape(m.group(2)), None))
    grip = re.search(r'const GRIP_LINES = \{(.*?)\};', js('player.js'), re.S)
    if grip:
        for who, body in re.findall(r'(\w+):\s*\[(.*?)\]', grip.group(1), re.S):
            for m in re.finditer(STR, body):
                lines.append((who, unescape(m.group(1)), None))
    for i, m in enumerate(re.finditer(r"\btext:\s*" + STR, js('world.js'))):
        lines.append(('Echo', unescape(m.group(1)), ECHO_VOICES[i % len(ECHO_VOICES)]))
    seen, out = set(), []
    for who, text, voice in lines:
        if (who, text) not in seen:
            seen.add((who, text))
            out.append((who, text, voice))
    return out


def delivery(text, rate, pitch):
    """Each line's own delivery on top of its speaker's: a shout comes quicker, higher and louder, a line
    that trails off (…) slower, a question lifts, and a very short line is slowed so it isn't clipped."""
    r, p, v = int(rate.rstrip('%')), int(pitch.rstrip('Hz')), 0
    t = text.strip()
    shout = t.endswith('!') or sum(1 for w in t.split() if len(w) > 2 and w.isupper()) >= 1
    if shout:
        r += 5; p += 3; v += 10
    if '…' in t or '...' in t:
        r -= 5
    if t.endswith('?'):
        p += 2
    if len(t) < 20:
        r -= 4
    return f'{r:+d}%', f'{p:+d}Hz', f'{v:+d}%'


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f'{h:08x}'


async def record(who, text, voice, force, sem, manifest):
    key = fnv1a(f'{who}|{text}')
    path = OUT / f'{key}.mp3'
    name, rate, pitch = voice or CAST[who]
    rate, pitch, volume = delivery(text, rate, pitch)
    spoken = text
    for a, b in SPOKEN:
        spoken = spoken.replace(a, b)
    async with sem:
        if force or not path.exists() or path.stat().st_size < 2000:
            for attempt in range(6):
                try:
                    await edge_tts.Communicate(spoken, name, rate=rate, pitch=pitch, volume=volume).save(str(path))
                    break
                except Exception as e:  # the free service throttles bursts: back off and retry
                    path.unlink(missing_ok=True)
                    if attempt == 5:
                        print(f'  FAILED {who}: {text[:60]} ({e})')
                        return
                    await asyncio.sleep(3 * (attempt + 1))
            print(f'  recorded {who:8} {text[:60]}')
    # edge-tts writes 48 kbit/s mono MP3, so duration follows from the size
    manifest[key] = {'who': who, 'dur': round(path.stat().st_size * 8 / 48000, 2), 'voice': name, 'text': text}


async def main():
    force = '--force' in sys.argv
    redo = {s for a in sys.argv if a.startswith('--redo=') for s in a[7:].split(',') if s}
    OUT.mkdir(parents=True, exist_ok=True)
    lines = collect()
    missing = [w for w, _, v in lines if v is None and w not in CAST]
    if missing:
        sys.exit(f'No voice cast for: {sorted(set(missing))}. Add them to CAST.')
    print(f'{len(lines)} spoken lines')
    manifest, sem = {}, asyncio.Semaphore(2)
    await asyncio.gather(*(record(w, t, v, force or w in redo, sem, manifest) for w, t, v in lines))
    failed = len(lines) - len(manifest)
    if failed:
        print(f'{failed} line(s) failed: run the script again to retry just those')
    for old in OUT.glob('*.mp3'):
        if old.stem not in manifest:
            old.unlink()
            print(f'  removed unused {old.name}')
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding='utf-8')
    total = sum(m['dur'] for m in manifest.values())
    print(f'done: {len(manifest)} clips, {total / 60:.1f} minutes of dialogue in {OUT}')


if __name__ == '__main__':
    # (a Windows console can't print every character in the lines, ▸ among them: never let that stop a recording)
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    # the selector loop avoids noisy connection-reset warnings on Windows
    asyncio.run(main(), loop_factory=asyncio.SelectorEventLoop if sys.platform == 'win32' else None)
