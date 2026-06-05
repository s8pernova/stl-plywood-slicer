import type { Mesh } from "../types";

// STL parser
export function parseSTL(buf: ArrayBuffer): Mesh {
	const view = new DataView(buf);
	const triangles: number[][][] = [];
	const count = view.getUint32(80, true);

	if (buf.byteLength >= 84 + count * 50 && count > 0) {
		// Binary STL
		for (let i = 0; i < count; i++) {
			const off = 84 + i * 50;
			triangles.push([
				[
					view.getFloat32(off + 12, true),
					view.getFloat32(off + 16, true),
					view.getFloat32(off + 20, true),
				],
				[
					view.getFloat32(off + 24, true),
					view.getFloat32(off + 28, true),
					view.getFloat32(off + 32, true),
				],
				[
					view.getFloat32(off + 36, true),
					view.getFloat32(off + 40, true),
					view.getFloat32(off + 44, true),
				],
			]);
		}
	} else {
		// ASCII STL
		const text = new TextDecoder().decode(buf);
		const re = /vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;
		let m: RegExpExecArray | null;
		let verts: number[][] = [];
		while ((m = re.exec(text)) !== null) {
			verts.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
			if (verts.length === 3) {
				triangles.push([...verts]);
				verts = [];
			}
		}
	}

	return { triangles };
}

// 3MF parser
export async function parse3MF(buf: ArrayBuffer): Promise<Mesh> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const JSZip = (window as any).JSZip;
	if (!JSZip) {
		throw new Error(
			"JSZip is not loaded. Please wait or check your internet connection.",
		);
	}
	const zip = await JSZip.loadAsync(buf);
	let modelXml: string | null = null;

	for (const [name, file] of Object.entries(zip.files)) {
		if (name.toLowerCase().endsWith(".model")) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			modelXml = await (file as any).async("string");
			break;
		}
	}

	if (!modelXml) throw new Error("No 3D model found in 3MF file");

	const doc = new DOMParser().parseFromString(modelXml, "text/xml");
	const vertices: number[][] = [];
	const triangles: number[][][] = [];

	for (let i = 0; i < doc.getElementsByTagName("vertex").length; i++) {
		const v = doc.getElementsByTagName("vertex")[i];
		const x = v.getAttribute("x");
		const y = v.getAttribute("y");
		const z = v.getAttribute("z");
		if (x && y && z) {
			vertices.push([parseFloat(x), parseFloat(y), parseFloat(z)]);
		}
	}

	for (let i = 0; i < doc.getElementsByTagName("triangle").length; i++) {
		const t = doc.getElementsByTagName("triangle")[i];
		const v1Val = t.getAttribute("v1") || t.getAttribute("p1");
		const v2Val = t.getAttribute("v2") || t.getAttribute("p2");
		const v3Val = t.getAttribute("v3") || t.getAttribute("p3");
		if (v1Val && v2Val && v3Val) {
			const a = parseInt(v1Val);
			const b = parseInt(v2Val);
			const c = parseInt(v3Val);
			if (!isNaN(a) && !isNaN(b) && !isNaN(c)) {
				triangles.push([vertices[a], vertices[b], vertices[c]]);
			}
		}
	}

	return { triangles };
}

// Slicer helper functions
export function getBounds(tris: number[][][], axis: string) {
	const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
	let mn = Infinity,
		mx = -Infinity;
	for (const tri of tris) {
		for (const v of tri) {
			mn = Math.min(mn, v[idx]);
			mx = Math.max(mx, v[idx]);
		}
	}
	return { mn, mx };
}

export function sliceAtPlane(tris: number[][][], t: number, axisIdx: number) {
	const a1 = (axisIdx + 1) % 3,
		a2 = (axisIdx + 2) % 3;
	const segs: number[][][] = [];

	for (const tri of tris) {
		const d = tri.map((v) => v[axisIdx] - t);
		const pts: number[][] = [];

		for (let i = 0; i < 3; i++) {
			const j = (i + 1) % 3;
			if ((d[i] < 0 && d[j] > 0) || (d[i] > 0 && d[j] < 0)) {
				const f = d[i] / (d[i] - d[j]);
				pts.push([
					tri[i][a1] + f * (tri[j][a1] - tri[i][a1]),
					tri[i][a2] + f * (tri[j][a2] - tri[i][a2]),
				]);
			} else if (Math.abs(d[i]) < 1e-9) {
				pts.push([tri[i][a1], tri[i][a2]]);
			}
		}

		if (pts.length === 2) segs.push(pts);
	}

	return segs;
}

export function segsToPolylines(segs: number[][][]) {
	if (!segs.length) return [];

	const eps = 1e-4;
	const used = new Uint8Array(segs.length);
	const polys: number[][][] = [];

	for (let s = 0; s < segs.length; s++) {
		if (used[s]) continue;
		used[s] = 1;
		const poly = [...segs[s]];
		let changed = true;

		while (changed) {
			changed = false;
			const tail = poly[poly.length - 1];

			for (let i = 0; i < segs.length; i++) {
				if (used[i]) continue;
				const [a, b] = segs[i];
				const da = Math.hypot(tail[0] - a[0], tail[1] - a[1]);
				const db = Math.hypot(tail[0] - b[0], tail[1] - b[1]);

				if (da < eps) {
					poly.push(b);
					used[i] = 1;
					changed = true;
					break;
				}
				if (db < eps) {
					poly.push(a);
					used[i] = 1;
					changed = true;
					break;
				}
			}
		}

		if (poly.length > 2) polys.push(poly);
	}

	return polys;
}

export function polylinesToSVG(polys: number[][][], margin: number) {
	if (!polys.length) return null;

	let mnX = Infinity,
		mnY = Infinity,
		mxX = -Infinity,
		mxY = -Infinity;
	for (const p of polys) {
		for (const [x, y] of p) {
			mnX = Math.min(mnX, x);
			mnY = Math.min(mnY, y);
			mxX = Math.max(mxX, x);
			mxY = Math.max(mxY, y);
		}
	}

	const W = mxX - mnX + margin * 2;
	const H = mxY - mnY + margin * 2;

	const paths = polys
		.map((p) => {
			const d =
				p
					.map(
						(pt, i) =>
							`${i ? "L" : "M"}${(pt[0] - mnX + margin).toFixed(3)},${(pt[1] - mnY + margin).toFixed(3)}`,
					)
					.join(" ") + " Z";
			return `<path d="${d}" fill="none" stroke="black" stroke-width="0.5"/>`;
		})
		.join("\n");

	return {
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}mm" height="${H.toFixed(2)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">\n${paths}\n</svg>`,
	};
}

export function sliceFilename(s: { z: number }, i: number) {
	return `slice_${String(i).padStart(3, "0")}_z${s.z.toFixed(1)}mm.svg`;
}
