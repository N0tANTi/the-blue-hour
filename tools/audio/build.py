"""Build every shipped sound for Last Set: src/assets/audio/<id>.ogg + .m4a and audio.json.

python -I tools/audio/build.py [--only id,id] [--skip-music]

Work files go to a temp folder outside the game (Sonniss audio must never sit in the game as loose
WAVs); only the encoded .ogg (Opus) / .m4a (AAC) land in src/assets/audio/.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np

GAME = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = f"{GAME}/src/assets/audio"
RAW = os.environ.get("AUDIO_RAW_DIR", f"{GAME}/assets-src/audio/raw")
SON = os.environ.get("SONNISS_DIR", "sonniss")
WORK = os.path.join(tempfile.gettempdir(), "deco-audio-work")
SR = 48000
os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(" ".join(cmd) + "\n" + r.stderr[-2000:])
    return r


def decode(path, ss=None, t=None, af=None, mono=False):
    cmd = ["ffmpeg", "-v", "error"]
    if ss is not None:
        cmd += ["-ss", f"{ss}"]
    if t is not None:
        cmd += ["-t", f"{t}"]
    cmd += ["-i", path]
    if af:
        cmd += ["-af", af]
    ch = 1 if mono else 2
    cmd += ["-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).astype(np.float64)


def write_wav(path, x):
    x = np.asarray(x, dtype=np.float32)
    if x.ndim == 1:
        x = x[:, None]
    p = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]),
                        "-i", "-", "-c:a", "pcm_f32le", path], input=x.tobytes(), capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode()[-1000:])


def ffilter(x, af):
    """Run an ffmpeg filter chain over an array."""
    src = os.path.join(WORK, "_f_in.wav")
    dst = os.path.join(WORK, "_f_out.wav")
    write_wav(src, x)
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", af, "-ar", str(SR), "-c:a", "pcm_f32le", dst])
    return decode(dst, mono=(x.shape[1] == 1))


def db(v):
    return 20 * np.log10(max(v, 1e-12))


def fades(x, fin=0.005, fout=0.01):
    x = x.copy()
    n = len(x)
    a = int(fin * SR)
    b = int(fout * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None]
    if b:
        x[n - b:] *= np.linspace(1, 0, b)[:, None] ** 2
    return x


def tail_fade(x, start_s, end_s):
    """Gentle equal-power fade from start_s to end of clip (natural decay shaping)."""
    x = x.copy()
    s = int(start_s * SR)
    e = min(int(end_s * SR), len(x))
    if e > s:
        x[s:e] *= np.cos(np.linspace(0, np.pi / 2, e - s))[:, None]
    x[e:] = 0
    return x[:e]


def onset(x, below=30):
    """Index of first 1 ms frame within `below` dB of the clip's peak (for <5 ms transient trims)."""
    m = np.abs(x).max(axis=1)
    hop = SR // 1000
    fr = m[: len(m) // hop * hop].reshape(-1, hop).max(axis=1)
    thr = fr.max() * 10 ** (-below / 20)
    i = int(np.argmax(fr > thr))
    return i * hop


def peak_norm(x, target_db):
    return x * 10 ** ((target_db - db(np.abs(x).max())) / 20)


def measure(path, pad_to=0.0):
    """Integrated LUFS + true peak (ebur128 via loudnorm json) and RMS (astats) of a file."""
    af = "loudnorm=print_format=json"
    pre = f"apad=whole_dur={pad_to}," if pad_to else ""
    r = run(["ffmpeg", "-hide_banner", "-i", path, "-af", pre + af, "-f", "null", "-"])
    j = json.loads(re.search(r"\{[\s\S]*\}", r.stderr).group(0))
    r2 = run(["ffmpeg", "-hide_banner", "-i", path, "-af", "astats=measure_perchannel=none", "-f", "null", "-"])
    rms = float(re.findall(r"RMS level dB: (-?[\d.inf]+)", r2.stderr)[-1])
    pk = float(re.findall(r"Peak level dB: (-?[\d.inf]+)", r2.stderr)[-1])
    return {"integratedLufs": float(j["input_i"]), "truePeakDbtp": float(j["input_tp"]), "rmsDb": round(rms, 2),
            "samplePeakDb": round(pk, 2), "lra": float(j["input_lra"])}


def encode(x, stem, kbps_opus, kbps_aac):
    wav = os.path.join(WORK, stem + ".wav")
    write_wav(wav, x)
    ogg = f"{OUT}/{stem}.ogg"
    m4a = f"{OUT}/{stem}.m4a"
    run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "libopus", "-b:a", f"{kbps_opus}k", "-vbr", "on",
         "-application", "audio", "-map_metadata", "-1", ogg])
    run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", f"{kbps_aac}k", "-map_metadata", "-1",
         "-movflags", "+faststart", m4a])
    return wav, ogg, m4a


def duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
    return float(r.stdout.strip())


# ------------------------------------------------------------------ music
JV = {
    "wild-cat-blues": f"{RAW}/ia/JV-653-1923-QmbKBTdABAnkjdogSkNH4VHaGvRCK4W1zv4daEcGaYfaUR/JV-653-1923-QmbKBTdABAnkjdogSkNH4VHaGvRCK4W1zv4daEcGaYfaUR.mp3",
    "bleeding-hearted-blues": f"{RAW}/ia/JV-621-1923-QmQavyrgUpzaFHKZPrV3bucALMTQaZdBk4eoVKZz5o434L/JV-621-1923-QmQavyrgUpzaFHKZPrV3bucALMTQaZdBk4eoVKZz5o434L.mp3",
    "spain": f"{RAW}/ia/JV-1021-1924-QmaxbxuneXRhkibSACiP9BShPsYhUVQRsLidYySdziyUg1/JV-1021-1924-QmaxbxuneXRhkibSACiP9BShPsYhUVQRsLidYySdziyUg1.mp3",
    "in-the-evening": f"{RAW}/ia/JV-965-1924-QmXKuB71AinBAvVpenFTttyUsKmGanuzoiKXuj7xLb6BNm/JV-965-1924-QmXKuB71AinBAvVpenFTttyUsKmGanuzoiKXuj7xLb6BNm.mp3",
}
RESTORE = "highpass=f=60:poles=2,adeclick=window=55:overlap=75:threshold=4,afftdn=nr=4:nf=-50:tn=0"


def limit_to(x, gain_db, ceiling_dbtp=-2.0):
    """Gain, then a 4x oversampled peak limiter (true-peak-ish ceiling)."""
    lim = 10 ** (ceiling_dbtp / 20)
    return ffilter(x, f"volume={gain_db:.3f}dB,aresample=192000,alimiter=limit={lim:.4f}:attack=1:release=80:level=disabled,aresample={SR}")


def build_music(stem):
    x = decode(JV[stem], af=RESTORE, mono=True)
    # trim: start 150 ms before first frame within 40 dB of peak; end 400 ms after last frame within 45 dB
    m = np.abs(x[:, 0])
    hop = SR // 100
    fr = np.sqrt(np.mean(m[: len(m) // hop * hop].reshape(-1, hop) ** 2, axis=1))
    pk = fr.max()
    on = np.where(fr > pk * 10 ** (-40 / 20))[0]
    s = max(0, (on[0] - 15) * hop)
    e = min(len(x), (on[-1] + 40) * hop)
    x = x[s:e]
    x = fades(x, 0.15, 0.8)
    # loudness to -16 LUFS with TP <= -1.5 dBTP: iterate gain + limiter
    tmp = os.path.join(WORK, stem + "_m.wav")
    write_wav(tmp, x)
    g = -16.0 - measure(tmp)["integratedLufs"]
    for _ in range(3):
        y = limit_to(x, g, -2.4)
        write_wav(tmp, y)
        mm = measure(tmp)
        if abs(mm["integratedLufs"] + 16.0) < 0.2:
            break
        g += -16.0 - mm["integratedLufs"]
    return y, {"trimS": [round(s / SR, 3), round(e / SR, 3)], "gainDb": round(g, 2)}


# ------------------------------------------------------------------ loops
def make_loop(x, length_s, xfade_s):
    """Seamless loop: out = x[0:L] with its first C s crossfaded (equal power) with x[L:L+C]."""
    L = int(length_s * SR)
    C = int(xfade_s * SR)
    assert len(x) >= L + C
    out = x[:L].copy()
    t = np.linspace(0, np.pi / 2, C)[:, None]
    out[:C] = x[L:L + C] * np.cos(t) + x[:C] * np.sin(t)
    return out


def seam_check(y):
    """50 ms RMS around the wrap point vs the loop's median: worst deviation in dB."""
    z = np.concatenate([y[-SR * 3:], y[: SR * 6]])
    hop = SR // 20
    fr = np.sqrt(np.mean(z[: len(z) // hop * hop].mean(axis=1).reshape(-1, hop) ** 2, axis=1))
    ref = np.sqrt(np.mean(y.mean(axis=1)[: len(y) // hop * hop].reshape(-1, hop) ** 2, axis=1))
    med = np.median(ref)
    jump = np.abs(np.diff(20 * np.log10(fr + 1e-12)))
    refjump = np.abs(np.diff(20 * np.log10(ref + 1e-12)))
    return {"wrapRmsJumpDb": round(float(jump[len(jump) // 3]), 2), "seamWindowMaxJumpDb": round(float(jump.max()), 2),
            "loopTypicalJumpP95Db": round(float(np.percentile(refjump, 95)), 2),
            "seamMinVsMedianDb": round(float(20 * np.log10(fr.min() / med)), 2)}


def norm_lufs(x, target, stem):
    tmp = os.path.join(WORK, stem + "_n.wav")
    write_wav(tmp, x)
    g = target - measure(tmp)["integratedLufs"]
    return x * 10 ** (g / 20), round(g, 2)


WEDDING_PAN = "pan=stereo|c0=0.45*c0+0.32*c2+0.32*c3|c1=0.45*c1+0.32*c2+0.32*c4"  # 5.0 (L R C Ls Rs) to stereo
WALLA_LAYERS = [
    # path, start s, relative dB after RMS matching, decode filter
    (f"{SON}/2018/West Wolf - Restaurant Ambiences/RA_06_Restaurant_Dinner_Int_Walla_Crowd_50-75 People_Germany_Zoom H4.wav", 34.0, -2.0, None),
    (f"{SON}/2020/Sonik Sound Library - Spatial Crowds/Ambience, Wedding Crowd, Crowd in a Open Bar Wedding Banquet-Surround.wav", 10.0, -4.0, WEDDING_PAN),
    (f"{SON}/2016/Chupapsound -  CROWD AMBIANCE/hall ambiance people far st.wav", 0.3, 2.0, None),
]
WALLA_LAUGHS = [
    (f"{SON}/2018/Soundrangers - Audience Reactions/sitcom_studio_crowd_laughter_10.wav", 0.0, 3.07, 21.0, -9.0),
    (f"{SON}/2018/Soundrangers - Audience Reactions/theater_audience_laughter_applause_01.wav", 0.0, 2.3, 52.0, -11.0),
]


def build_walla():
    L, C = 74.0, 4.0
    y = None
    for path, ss, rel, af in WALLA_LAYERS:
        x = decode(path, ss=ss, t=L + C + 0.2, af=af)
        x = x / np.sqrt(np.mean(x ** 2)) * 10 ** (rel / 20)
        y = x if y is None else y[: min(len(y), len(x))] + x[: min(len(y), len(x))]
    y = ffilter(y * 0.05, "highpass=f=70:poles=2,lowpass=f=7000")
    y = make_loop(y, L, C)
    bed_rms = np.sqrt(np.mean(y ** 2))
    for path, ss, ln, at, rel in WALLA_LAUGHS:
        l = decode(path, ss=ss, t=ln)
        l = ffilter(l, "highpass=f=150:poles=2,lowpass=f=4500")  # push it to a far table
        l = fades(l, 0.08, 0.6)
        hop = SR // 20
        lr = np.sqrt(np.mean(l[: len(l) // hop * hop].mean(axis=1).reshape(-1, hop) ** 2, axis=1)).max()
        l *= bed_rms / lr * 10 ** (rel / 20)
        a = int(at * SR)
        y[a:a + len(l)] += l
    y, g = norm_lufs(y, -28.0, "walla")
    return y, {"layers": [{"file": p, "startS": s0, "relDb": r} for p, s0, r, _ in WALLA_LAYERS], "loopS": L, "xfadeS": C, "gainDb": g,
               "seam": seam_check(y), "laughs": [{"file": p, "atS": a, "relDb": r} for p, _, _, a, r in WALLA_LAUGHS]}


def build_roomtone():
    src = f"{SON}/2018/West Wolf - Restaurant Ambiences/RA_40_Restaurant_Bar_Night_Fridges_Empty_Room Tone_Neumann KM184 ORTF.wav"
    L, C = 48.0, 4.0
    x = decode(src, ss=60.0, t=L + C + 0.5)
    x = ffilter(x, "highpass=f=40:poles=2")
    y = make_loop(x, L, C)
    y, g = norm_lufs(y, -42.0, "roomtone")
    return y, {"source": src, "sectionS": [60.0, 60.0 + L + C], "xfadeS": C, "gainDb": g, "seam": seam_check(y)}


# ------------------------------------------------------------------ sfx
S = SON
SFX = [
    # id, source, start, length, kind-specific options
    ("glass-clink-1", f"{S}/2019/3maze - Kitchenware/drinks_glasses_touching_003.wav", 0.0, 0.69, dict(tail=0.35)),
    ("glass-clink-2", f"{S}/2016/George Karagioules - The Source Collection SFX Pack/Wine Glass Hit Higher Pitch.wav", 0.19, 0.8, dict(tail=0.35)),
    ("glass-clink-3", f"{S}/2016/George Karagioules - The Source Collection SFX Pack/Wine Glass Hit Higher Pitch.wav", 1.07, 1.2, dict(tail=0.5)),
    ("glass-clink-4", f"{S}/2016/George Karagioules - The Source Collection SFX Pack/Wine Glass Hit Higher Pitch.wav", 4.80, 1.2, dict(tail=0.5)),
    ("ice-1", f"{S}/2016/Qbsound Studio - Bar Effects/Ice filling glass 01 NT1-A.wav", 0.16, 1.5, dict(tail=0.9)),
    ("ice-2", f"{S}/2018/Airborne Sound - Kitchen/Ice Cubes,Glass,Tumbler,Water,Swirl,Rattle.wav", 0.09, 2.0, dict(tail=1.3)),
    ("pour-1", f"{S}/2020/SpillAudio - Bar and Coffee Shop/pouring_007.wav", 0.25, 1.65, dict(tail=1.3, below=45)),
    ("glass-set-down-1", f"{S}/2020/Wav Junction Sound Effects - Glassware/0081_Glass_large_slide_on_wood_surface_2.wav", 4.37, 0.21, dict(tail=0.08)),
    ("glass-set-down-2", f"{S}/2016/Qbsound Studio - Bar Effects/Glasses handle 03 NTG-2.wav", 2.67, 0.55, dict(tail=0.25)),
    ("glass-set-down-3", f"{S}/2016/Qbsound Studio - Bar Effects/Glasses handle 03 NTG-2.wav", 0.345, 0.5, dict(tail=0.2)),
    ("lighter-1", f"{RAW}/freesound/700894/700894_4131999-hq.ogg", 0.20, 1.32, dict(tail=1.2, below=20, peak=-4.5)),
    ("floor-creak-1", f"{S}/2019/Matt Script - Squeaks & Creaks/Old wood floor_creak_creaking_slow_back and forth_04.wav", 0.38, 1.2, dict(tail=0.9, below=40)),
    ("floor-creak-2", f"{S}/2019/Matt Script - Squeaks & Creaks/Old wood floor_creak_creaking_slow_back and forth_04.wav", 2.82, 1.75, dict(tail=1.2, below=40)),
]
APPLAUSE = [
    ("applause-1", f"{S}/2019/2496SoundEffects - Bits, Scraps and Pieces Super Pack/Cheer Clapping Small Group In Theater Applause sound effect.wav", 0.0, 9.6, 6.8),
    ("applause-2", f"{S}/2019/2496SoundEffects - Bits, Scraps and Pieces Super Pack/Cheer Clapping Small Group In Theater Applause sound effect.wav", 23.95, 8.1, 5.6),
]
STEP_WOOD_SRC = f"{RAW}/freesound/161756/161756_1116512-hq.ogg"
STEP_WOOD = [3.644, 4.861, 6.190, 6.721, 7.812, 8.391, 12.114, 12.637]
STEP_CARPET_SRC = f"{S}/2018/The Sound Pack Tree - Footstep Loops/1806 - Footsteps - Sneakers on Carpet - 90 fpm - Loop.wav"
STEP_CARPET = [2.832, 6.830, 12.162, 13.497, 16.832, 20.164]


def build_sfx(src, start, length, tail, below=30, peak=-3.0):
    x = decode(src, ss=max(0, start - 0.02), t=length + 0.05, mono=True, af="highpass=f=40:poles=2")
    i = onset(x, below)
    x = x[max(0, i - int(0.004 * SR)):]  # start 4 ms before the transient
    x = x[: int(length * SR)]
    x = tail_fade(x, tail, len(x) / SR)
    x = fades(x, 0.005, 0.01)
    return peak_norm(x, peak), {"onsetTrimS": round(start - 0.02 + i / SR - 0.004, 4), "peakDbfs": peak}


def build_step(src, t, maxlen, hp=60):
    x = decode(src, ss=max(0, t - 0.03), t=maxlen + 0.06, mono=True, af=f"highpass=f={hp}:poles=2")
    i = onset(x, 18)  # the main heel/sole transient, not a faint scuff before it
    x = x[max(0, i - int(0.004 * SR)):][: int(maxlen * SR)]
    # end once the tail is 45 dB under the peak (short natural tail), shape the last 60%
    env = np.abs(x[:, 0])
    hop = SR // 500
    fr = env[: len(env) // hop * hop].reshape(-1, hop).max(axis=1)
    pkf = int(np.argmax(fr))
    below = np.where(fr[pkf:] < fr.max() * 10 ** (-45 / 20))[0]
    end = (pkf + below[0]) * hop if len(below) else len(x)
    end = max(end, int(0.12 * SR))
    x = x[:end]
    x = tail_fade(x, len(x) / SR * 0.4, len(x) / SR)
    x = fades(x, 0.005, 0.008)
    return peak_norm(x, -6.0), {"srcOnsetS": round(t - 0.03 + i / SR - 0.004, 4)}


# ------------------------------------------------------------------ main
def main():
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    skip_music = "--skip-music" in sys.argv
    built = {}

    def ship(id_, x, kind, loop, opus, aac, extra):
        if only and id_ not in only:
            return
        wav, ogg, m4a = encode(x, id_, opus, aac)
        d = duration(ogg)
        pad = 0.5 if d < 0.5 else 0.0
        meas = measure(ogg, pad_to=pad)
        meas_m4a = measure(m4a, pad_to=pad)
        built[id_] = {"kind": kind, "loop": loop, "durationS": round(len(x) / SR, 4), "oggDurationS": round(d, 4),
                      "measured": meas, "measuredM4a": meas_m4a, "padded": pad, "build": extra,
                      "bytes": os.path.getsize(ogg) + os.path.getsize(m4a)}
        print(f"{id_:22s} {len(x)/SR:7.2f}s I={meas['integratedLufs']:6.1f} TP={meas['truePeakDbtp']:5.1f} "
              f"RMS={meas['rmsDb']:6.1f} | m4a TP={meas_m4a['truePeakDbtp']:5.1f} | {built[id_]['bytes']/1e3:.0f} kB", flush=True)

    if not skip_music:
        for stem in JV:
            if only and stem not in only:
                continue
            y, info = build_music(stem)
            ship(stem, y, "music", False, 96, 128, info)
    if not only or "ambience-walla" in only:
        y, info = build_walla()
        ship("ambience-walla", y, "ambience", True, 80, 112, info)
    if not only or "ambience-roomtone" in only:
        y, info = build_roomtone()
        ship("ambience-roomtone", y, "ambience", True, 64, 96, info)
    for id_, src, st, ln, o in SFX:
        if only and id_ not in only:
            continue
        y, info = build_sfx(src, st, ln, o["tail"], o.get("below", 30), o.get("peak", -3.0))
        ship(id_, y, "sfx", False, 96, 96, {"source": src, **info})
    for id_, src, st, ln, tail in APPLAUSE:
        if only and id_ not in only:
            continue
        x = decode(src, ss=st, t=ln, af="highpass=f=80:poles=2")
        x = tail_fade(x, tail, ln)
        x = fades(x, 0.15 if st > 0 else 0.005, 0.01)
        ship(id_, peak_norm(x, -3.0), "sfx", False, 96, 128, {"source": src, "sectionS": [st, st + ln], "tailFadeFromS": tail})
    for n, t in enumerate(STEP_WOOD, 1):
        id_ = f"step-wood-{n}"
        if only and id_ not in only:
            continue
        y, info = build_step(STEP_WOOD_SRC, t, 0.32)
        ship(id_, y, "step", False, 96, 96, {"source": STEP_WOOD_SRC, **info})
    for n, t in enumerate(STEP_CARPET, 1):
        id_ = f"step-carpet-{n}"
        if only and id_ not in only:
            continue
        y, info = build_step(STEP_CARPET_SRC, t, 0.30)
        ship(id_, y, "step", False, 96, 96, {"source": STEP_CARPET_SRC, **info})

    rep = os.path.join(WORK, "build-report.json")
    old = json.load(open(rep)) if os.path.exists(rep) else {}
    old.update(built)
    json.dump(old, open(rep, "w"), indent=1)


if __name__ == "__main__":
    main()
