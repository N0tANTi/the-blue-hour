// Canvas-drawn flat art: the leaded stained-glass panel (our own design). A tall panel with a round head; two
// elongated figures rise in long flowing curves, arms raised to two gold discs; big panes, few lead lines,
// pale gold bodies against blue-grey glass.
import * as THREE from 'three/webgpu';

export function stainedGlass(w = 512, h = 1560): THREE.CanvasTexture {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const g = c.getContext('2d') as CanvasRenderingContext2D;
	const LEAD = '#120a06';
	// ground: blue-grey glass, darker toward the foot, in a few big vertical panes
	const bg = g.createLinearGradient(0, 0, 0, h);
	bg.addColorStop(0, '#3a6474');
	bg.addColorStop(0.5, '#294c5c');
	bg.addColorStop(1, '#162c38');
	g.fillStyle = bg;
	g.fillRect(0, 0, w, h);
	const panes: { path: Path2D; fill: string | CanvasGradient }[] = [];
	const add = (path: Path2D, fill: string | CanvasGradient) => panes.push({ path, fill });
	// two gold discs high in the panel
	for (const [x, y, r] of [
		[w * 0.62, h * 0.12, 70],
		[w * 0.4, h * 0.23, 52],
	] as [number, number, number][]) {
		const p = new Path2D();
		p.arc(x, y, r, 0, Math.PI * 2);
		const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 4, x, y, r);
		gr.addColorStop(0, '#ffe4a0');
		gr.addColorStop(1, '#d09a40');
		add(p, gr);
	}
	// a figure: a long S-curve body from the foot to raised arms, drawn as one flowing pane plus an arm and a head
	const figure = (ox: number, lean: number, toX: number, toY: number, tone: [string, string]) => {
		const p = new Path2D();
		p.moveTo(ox - 38, h * 0.97);
		p.bezierCurveTo(ox - 70 + lean, h * 0.75, ox + 40 + lean, h * 0.55, ox + lean * 0.6 - 18, h * 0.4);
		p.bezierCurveTo(ox + lean * 0.4 - 30, h * 0.34, ox + lean * 0.3 - 6, h * 0.31, ox + lean * 0.3, h * 0.3);
		p.bezierCurveTo(ox + lean * 0.3 + 22, h * 0.33, ox + lean * 0.5 + 26, h * 0.38, ox + lean * 0.6 + 16, h * 0.42);
		p.bezierCurveTo(ox + 70 + lean, h * 0.57, ox - 10 + lean, h * 0.76, ox + 34, h * 0.97);
		p.closePath();
		const gr = g.createLinearGradient(ox - 60, 0, ox + 60, 0);
		gr.addColorStop(0, tone[0]);
		gr.addColorStop(1, tone[1]);
		add(p, gr);
		// head
		const hd = new Path2D();
		hd.ellipse(ox + lean * 0.3, h * 0.285, 20, 27, 0.15, 0, Math.PI * 2);
		add(hd, tone[1]);
		// raised arms: two long tapering panes reaching to the disc
		for (const s of [-1, 1]) {
			const a = new Path2D();
			const sx = ox + lean * 0.3 + s * 18,
				sy = h * 0.32;
			a.moveTo(sx - 9, sy);
			a.quadraticCurveTo((sx + toX) / 2 + s * 26, (sy + toY) / 2, toX + s * 18 - 7, toY);
			a.lineTo(toX + s * 18 + 7, toY + 4);
			a.quadraticCurveTo((sx + toX) / 2 + s * 36, (sy + toY) / 2 + 10, sx + 9, sy + 12);
			a.closePath();
			add(a, tone[0]);
		}
		// a flowing drape across the body in deep amber
		const d = new Path2D();
		d.moveTo(ox + lean * 0.5 - 20, h * 0.46);
		d.bezierCurveTo(ox - 110 + lean, h * 0.6, ox + 90, h * 0.8, ox - 60, h * 0.97);
		d.lineTo(ox - 20, h * 0.97);
		d.bezierCurveTo(ox + 110, h * 0.8, ox - 70 + lean, h * 0.62, ox + lean * 0.5 + 6, h * 0.48);
		d.closePath();
		add(d, '#a8622a');
	};
	figure(w * 0.38, 40, w * 0.4, h * 0.25, ['#e0a850', '#f4cc80']);
	figure(w * 0.64, -30, w * 0.62, h * 0.14, ['#c88a38', '#e8b868']);
	// flowing background ribbons in teal and gold behind the figures
	for (const [x0, col] of [
		[w * 0.12, '#46607a'],
		[w * 0.86, '#52707a'],
	] as [number, string][]) {
		const p = new Path2D();
		p.moveTo(x0 - 30, h);
		p.bezierCurveTo(x0 + 60, h * 0.7, x0 - 70, h * 0.45, x0 + 10, h * 0.05);
		p.lineTo(x0 + 50, h * 0.05);
		p.bezierCurveTo(x0 - 30, h * 0.45, x0 + 100, h * 0.7, x0 + 20, h);
		p.closePath();
		add(p, col);
	}
	// paint: panes first (background ribbons under figures), then the lead around each
	const order = [...panes.slice(-2), ...panes.slice(0, -2)];
	for (const p of order) {
		g.fillStyle = p.fill;
		g.fill(p.path);
	}
	g.strokeStyle = LEAD;
	g.lineJoin = 'round';
	g.lineWidth = 7;
	for (const p of order) g.stroke(p.path);
	// a few long lead lines across the ground glass: big panes, not a grid
	g.lineWidth = 6;
	for (const y of [h * 0.36, h * 0.6, h * 0.82]) {
		g.beginPath();
		g.moveTo(0, y);
		g.bezierCurveTo(w * 0.3, y - 40, w * 0.7, y + 40, w, y - 10);
		g.stroke();
	}
	// the round head of the panel: everything above the arch is dark frame
	g.fillStyle = '#0c0806';
	g.beginPath();
	g.moveTo(0, 0);
	g.lineTo(w, 0);
	g.lineTo(w, w / 2);
	g.arc(w / 2, w / 2, w / 2, 0, Math.PI, true);
	g.closePath();
	g.fill();
	g.lineWidth = 16;
	g.beginPath();
	g.moveTo(8, h);
	g.lineTo(8, w / 2);
	g.arc(w / 2, w / 2, w / 2 - 8, Math.PI, 0, false);
	g.lineTo(w - 8, h);
	g.stroke();
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}
