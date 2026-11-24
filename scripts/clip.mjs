// Cut a listing clip from a recording: 15 s of h264 mp4 (+ vp9 webm), no audio.
//   node scripts/clip.mjs <input.mp4|webm> <out-basename> [start-seconds=20] [duration=15]
// The bot already writes shots/<renderer>/clip.mp4; use this to re-cut a run kept with --keep-run.
import { execFileSync } from 'node:child_process';

const [input, out = 'shots/clip', start = '20', dur = '15'] = process.argv.slice(2);
if (!input) {
	console.log('usage: node scripts/clip.mjs <input> <out-basename> [start] [duration]');
	process.exit(1);
}
const common = ['-y', '-loglevel', 'error', '-ss', start, '-t', dur, '-i', input, '-an'];
execFileSync('ffmpeg', [...common, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', `${out}.mp4`]);
execFileSync('ffmpeg', [...common, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', `${out}.webm`]);
console.log(`${out}.mp4 ${out}.webm`);
