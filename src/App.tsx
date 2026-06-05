import { useState, useEffect, useRef } from "react";
import "./App.css";

interface Mesh {
	triangles: number[][][];
}

interface Slice {
	idx: number;
	z: number;
	zEnd: number;
	svg: string | null;
}

// STL parser
function parseSTL(buf: ArrayBuffer): Mesh {
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
		const re = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
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
async function parse3MF(buf: ArrayBuffer): Promise<Mesh> {
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
function getBounds(tris: number[][][], axis: string) {
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

function sliceAtPlane(tris: number[][][], t: number, axisIdx: number) {
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

function segsToPolylines(segs: number[][][]) {
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

function polylinesToSVG(polys: number[][][], margin: number) {
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

function sliceFilename(s: { z: number }, i: number) {
	return `slice_${String(i).padStart(3, "0")}_z${s.z.toFixed(1)}mm.svg`;
}

function App() {
	const [mesh, setMesh] = useState<Mesh | null>(null);
	const [slices, setSlices] = useState<Slice[]>([]);
	const [statusText, setStatusText] = useState<string>("");
	const [progress, setProgress] = useState<number | null>(null);
	const [fileName, setFileName] = useState<string>("");

	// Settings
	const [thickness, setThickness] = useState<number>(18);
	const [axis, setAxis] = useState<string>("z");
	const [margin, setMargin] = useState<number>(2);

	// Results display
	const [showResults, setShowResults] = useState<boolean>(false);
	const [modelSpan, setModelSpan] = useState<number>(0);

	// Drag and drop zone state
	const [isOver, setIsOver] = useState<boolean>(false);

	// Refs for WebGL and user controls
	const fileInputRef = useRef<HTMLInputElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const glRef = useRef<WebGLRenderingContext | null>(null);
	const progRef = useRef<WebGLProgram | null>(null);
	const triBufRef = useRef<WebGLBuffer | null>(null);
	const wireBufRef = useRef<WebGLBuffer | null>(null);
	const triCountRef = useRef<number>(0);
	const wireCountRef = useRef<number>(0);
	const meshScaleRef = useRef<number>(1.0);

	const rotXRef = useRef<number>(-0.3);
	const rotYRef = useRef<number>(0.5);
	const zoomRef = useRef<number>(1.0);
	const draggingRef = useRef<boolean>(false);
	const lastXRef = useRef<number>(0);
	const lastYRef = useRef<number>(0);
	const animationFrameIdRef = useRef<number | null>(null);

	// Setup WebGL rendering and interaction
	useEffect(() => {
		if (!mesh || !canvasRef.current) return;

		const canvas = canvasRef.current;
		const gl = canvas.getContext("webgl", {
			antialias: true,
			alpha: false,
		});

		if (!gl) {
			setStatusText("WebGL unavailable");
			return;
		}

		glRef.current = gl;

		canvas.width = canvas.clientWidth;
		canvas.height = canvas.clientHeight;
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.DEPTH_TEST);

		// Setup shaders
		const vs = `
      attribute vec3 aPos;
      uniform float uRotX;
      uniform float uRotY;
      uniform float uZoom;
      void main() {
        vec3 p = aPos;
        float cy = cos(uRotY);
        float sy = sin(uRotY);
        p = vec3(
          p.x * cy + p.z * sy,
          p.y,
         -p.x * sy + p.z * cy
        );
        float cx = cos(uRotX);
        float sx = sin(uRotX);
        p = vec3(
          p.x,
          p.y * cx - p.z * sx,
          p.y * sx + p.z * cx
        );
        float ay = radians(45.0);
        float ax = radians(35.264);
        p = vec3(
          p.x * cos(ay) + p.z * sin(ay),
          p.y,
         -p.x * sin(ay) + p.z * cos(ay)
        );
        p = vec3(
          p.x,
          p.y * cos(ax) - p.z * sin(ax),
          p.y * sin(ax) + p.z * cos(ax)
        );
        p *= uZoom;
        gl_Position = vec4(
          p.xy,
          -p.z * 0.001,
          1.0
        );
      }
    `;

		const fs = `
      precision mediump float;
      uniform vec4 uColor;
      void main() {
        gl_FragColor = uColor;
      }
    `;

		const compile = (type: number, src: string) => {
			const s = gl.createShader(type)!;
			gl.shaderSource(s, src);
			gl.compileShader(s);
			return s;
		};

		const prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
		gl.linkProgram(prog);
		progRef.current = prog;

		// Upload Mesh
		const tris = mesh.triangles;
		const triVerts: number[] = [];
		const wireVerts: number[] = [];

		let minX = Infinity;
		let minY = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let maxZ = -Infinity;

		for (const tri of tris) {
			for (const v of tri) {
				minX = Math.min(minX, v[0]);
				minY = Math.min(minY, v[1]);
				minZ = Math.min(minZ, v[2]);
				maxX = Math.max(maxX, v[0]);
				maxY = Math.max(maxY, v[1]);
				maxZ = Math.max(maxZ, v[2]);
			}
		}

		const cx = (minX + maxX) * 0.5;
		const cy = (minY + maxY) * 0.5;
		const cz = (minZ + maxZ) * 0.5;
		const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
		meshScaleRef.current = 1.5 / size;

		for (const tri of tris) {
			const v = tri.map((p) => [
				(p[0] - cx) * meshScaleRef.current,
				(p[1] - cy) * meshScaleRef.current,
				(p[2] - cz) * meshScaleRef.current,
			]);

			triVerts.push(...v[0], ...v[1], ...v[2]);
			wireVerts.push(
				...v[0],
				...v[1],
				...v[1],
				...v[2],
				...v[2],
				...v[0],
			);
		}

		const triBuf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array(triVerts),
			gl.STATIC_DRAW,
		);
		triBufRef.current = triBuf;
		triCountRef.current = triVerts.length / 3;

		const wireBuf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array(wireVerts),
			gl.STATIC_DRAW,
		);
		wireBufRef.current = wireBuf;
		wireCountRef.current = wireVerts.length / 3;

		// Render function
		let active = true;
		const render = () => {
			if (!active) return;
			const gl = glRef.current;
			const prog = progRef.current;
			const triBuf = triBufRef.current;
			const wireBuf = wireBufRef.current;

			if (gl && prog && triBuf) {
				gl.clearColor(1, 1, 1, 1);
				gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

				gl.useProgram(prog);
				const posLoc = gl.getAttribLocation(prog, "aPos");
				const colorLoc = gl.getUniformLocation(prog, "uColor");

				gl.uniform1f(
					gl.getUniformLocation(prog, "uRotX"),
					rotXRef.current,
				);
				gl.uniform1f(
					gl.getUniformLocation(prog, "uRotY"),
					rotYRef.current,
				);
				gl.uniform1f(
					gl.getUniformLocation(prog, "uZoom"),
					zoomRef.current,
				);

				// SOLID PASS
				gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
				gl.enableVertexAttribArray(posLoc);
				gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
				gl.uniform4f(colorLoc, 1, 1, 1, 1);
				gl.drawArrays(gl.TRIANGLES, 0, triCountRef.current);

				// WIREFRAME PASS
				gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
				gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
				gl.uniform4f(colorLoc, 0, 0, 0, 1);
				gl.drawArrays(gl.LINES, 0, wireCountRef.current);
			}

			animationFrameIdRef.current = requestAnimationFrame(render);
		};

		render();

		// Event listeners
		const onMouseDown = (e: MouseEvent) => {
			draggingRef.current = true;
			lastXRef.current = e.clientX;
			lastYRef.current = e.clientY;
		};

		const onMouseUp = () => {
			draggingRef.current = false;
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!draggingRef.current) return;
			rotYRef.current += (e.clientX - lastXRef.current) * 0.01;
			rotXRef.current += (e.clientY - lastYRef.current) * 0.01;
			lastXRef.current = e.clientX;
			lastYRef.current = e.clientY;
		};

		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			zoomRef.current *= e.deltaY > 0 ? 0.9 : 1.1;
			zoomRef.current = Math.max(0.2, Math.min(10, zoomRef.current));
		};

		const onResize = () => {
			if (!canvas || !gl) return;
			canvas.width = canvas.clientWidth;
			canvas.height = canvas.clientHeight;
			gl.viewport(0, 0, canvas.width, canvas.height);
		};

		canvas.addEventListener("mousedown", onMouseDown);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("mousemove", onMouseMove);
		canvas.addEventListener("wheel", onWheel, { passive: false });
		window.addEventListener("resize", onResize);

		return () => {
			active = false;
			if (animationFrameIdRef.current) {
				cancelAnimationFrame(animationFrameIdRef.current);
			}
			canvas.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("mousemove", onMouseMove);
			canvas.removeEventListener("wheel", onWheel);
			window.removeEventListener("resize", onResize);

			if (gl) {
				if (triBuf) gl.deleteBuffer(triBuf);
				if (wireBuf) gl.deleteBuffer(wireBuf);
				if (prog) gl.deleteProgram(prog);
			}
		};
	}, [mesh]);

	// File loading function
	const handleFile = async (file: File) => {
		if (!file) return;
		const ext = file.name.split(".").pop()?.toLowerCase();
		setStatusText("Loading file...");
		setProgress(10);
		setSlices([]);
		setShowResults(false);

		try {
			const buf = await file.arrayBuffer();
			let parsedMesh: Mesh;
			if (ext === "stl") {
				parsedMesh = parseSTL(buf);
			} else if (ext === "3mf") {
				parsedMesh = await parse3MF(buf);
			} else {
				setStatusText("Unsupported file type. Use .stl or .3mf");
				setProgress(null);
				return;
			}

			setMesh(parsedMesh);
			setStatusText(
				`Loaded ${parsedMesh.triangles.length.toLocaleString()} triangles from "${file.name}"`,
			);
			setProgress(100);
			setFileName(file.name);
		} catch (e: any) {
			setStatusText("Error: " + e.message);
			setProgress(null);
			console.error(e);
		}
	};

	// Slice function
	const runSlice = () => {
		if (!mesh) return;

		const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
		const bounds = getBounds(mesh.triangles, axis);
		const zMin = bounds.mn;
		const zMax = bounds.mx;
		const numSlices = Math.ceil((zMax - zMin) / thickness);

		setStatusText(`Slicing into ${numSlices} layers...`);
		setProgress(20);
		setShowResults(false);
		setSlices([]);

		setTimeout(() => {
			const computedSlices: Slice[] = [];
			for (let i = 0; i < numSlices; i++) {
				const z = zMin + (i + 0.5) * thickness;
				const segs = sliceAtPlane(mesh.triangles, z, axisIdx);
				const polys = segsToPolylines(segs);
				const result = polylinesToSVG(polys, margin);

				computedSlices.push({
					idx: i,
					z: zMin + i * thickness,
					zEnd: Math.min(zMin + (i + 1) * thickness, zMax),
					svg: result ? result.svg : null,
				});
			}

			setSlices(computedSlices);
			const nonEmpty = computedSlices.filter((s) => s.svg);
			setStatusText(
				`Done — ${nonEmpty.length} non-empty slices out of ${numSlices} total`,
			);
			setProgress(100);
			setModelSpan(zMax - zMin);
			setShowResults(true);
		}, 30);
	};

	// Download individual SVG
	const downloadSVG = (s: Slice, i: number) => {
		if (!s.svg) return;
		const blob = new Blob([s.svg], { type: "image/svg+xml" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = sliceFilename(s, i);
		a.click();
		URL.revokeObjectURL(a.href);
	};

	// Download all SVGs
	const downloadAll = async (asZip: boolean) => {
		const nonEmpty = slices.filter((s) => s.svg);
		if (!nonEmpty.length) return;

		if (!asZip) {
			nonEmpty.forEach((s, i) => downloadSVG(s, i + 1));
			return;
		}

		const JSZip = (window as any).JSZip;
		if (!JSZip) {
			setStatusText("Error: JSZip is not loaded.");
			return;
		}

		const zip = new JSZip();
		nonEmpty.forEach((s, i) => {
			if (s.svg) {
				zip.file(sliceFilename(s, i + 1), s.svg);
			}
		});
		const blob = await zip.generateAsync({ type: "blob" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "slices.zip";
		a.click();
		URL.revokeObjectURL(a.href);
	};

	const nonEmptySlices = slices.filter((s) => s.svg);

	return (
		<div style={{ maxWidth: "1000px", margin: "0 auto" }}>
			<div className="card">
				<h2>Mesh Slicer</h2>
				<p className="subtitle">
					Load an STL or 3MF file, preview in 3D, set your material
					thickness, and download per-slice SVGs.
				</p>

				<div
					className={`drop-zone ${isOver ? "over" : ""}`}
					onClick={() => fileInputRef.current?.click()}
					onDragOver={(e) => {
						e.preventDefault();
						setIsOver(true);
					}}
					onDragLeave={() => setIsOver(false)}
					onDrop={(e) => {
						e.preventDefault();
						setIsOver(false);
						if (e.dataTransfer.files && e.dataTransfer.files[0]) {
							handleFile(e.dataTransfer.files[0]);
						}
					}}
				>
					{fileName ? (
						<div style={{ fontSize: "14px" }}>✓ {fileName}</div>
					) : (
						<>
							<div
								style={{
									fontSize: "40px",
									marginBottom: "10px",
								}}
							>
								📦
							</div>
							<div>Drop STL or 3MF here, or click to browse</div>
							<div
								style={{
									fontSize: "12px",
									color: "#999",
									marginTop: "5px",
								}}
							>
								Binary or ASCII STL · 3MF (ZIP-based)
							</div>
						</>
					)}
				</div>
				<input
					type="file"
					ref={fileInputRef}
					style={{ display: "none" }}
					accept=".stl,.3mf"
					onChange={(e) => {
						if (e.target.files && e.target.files[0]) {
							handleFile(e.target.files[0]);
						}
					}}
				/>
				<div className="status-text">{statusText}</div>
				<div
					className={`progress-bar ${progress !== null ? "active" : ""}`}
				>
					<div
						className="progress-fill"
						style={{ width: `${progress || 0}%` }}
					></div>
				</div>
			</div>

			{mesh && (
				<div className="viewer-wrap active">
					<canvas ref={canvasRef} className="viewer-canvas"></canvas>
					<div className="viewer-hint">
						drag to rotate
						<br />
						scroll to zoom
					</div>
				</div>
			)}

			<div className="card">
				<h2>Slice Settings</h2>
				<div className="controls">
					<div className="field">
						<label>Material Thickness (mm)</label>
						<input
							type="number"
							value={thickness}
							onChange={(e) =>
								setThickness(parseFloat(e.target.value) || 0)
							}
							min="0.1"
							max="200"
							step="0.1"
						/>
					</div>
					<div className="field">
						<label>Slice Axis</label>
						<select
							value={axis}
							onChange={(e) => setAxis(e.target.value)}
						>
							<option value="z">Z (horizontal layers)</option>
							<option value="y">Y</option>
							<option value="x">X</option>
						</select>
					</div>
					<div className="field">
						<label>SVG Margin (mm)</label>
						<input
							type="number"
							value={margin}
							onChange={(e) =>
								setMargin(parseFloat(e.target.value) || 0)
							}
							min="0"
							max="20"
							step="0.5"
						/>
					</div>
					<button
						className="btn-primary"
						onClick={runSlice}
						disabled={!mesh}
					>
						Slice
					</button>
				</div>
			</div>

			{showResults && (
				<div className="card">
					<h2>Results</h2>
					<div className="stats">
						<div className="stat">
							<div className="stat-label">Total Slices</div>
							<div className="stat-val">
								{nonEmptySlices.length}
							</div>
						</div>
						<div className="stat">
							<div className="stat-label">Thickness</div>
							<div className="stat-val">{thickness}mm</div>
						</div>
						<div className="stat">
							<div className="stat-label">Model Span</div>
							<div className="stat-val">
								{modelSpan.toFixed(1)}mm
							</div>
						</div>
						<div className="stat">
							<div className="stat-label">Triangles</div>
							<div className="stat-val">
								{mesh
									? mesh.triangles.length.toLocaleString()
									: 0}
							</div>
						</div>
					</div>
					<div className="slice-grid">
						{nonEmptySlices.map((s, i) => {
							const preview = s.svg
								? s.svg
										.replace(
											/stroke="black"/g,
											'stroke="currentColor"',
										)
										.replace(
											/width="[^"]*"/,
											'width="100%"',
										)
										.replace(
											/height="[^"]*"/,
											'height="100px"',
										)
								: "";
							return (
								<div
									key={s.idx}
									className="slice-card"
									title={`Slice ${i + 1} · ${axis.toUpperCase()} ${s.z.toFixed(1)}–${s.zEnd.toFixed(1)}mm`}
									onClick={() => downloadSVG(s, i + 1)}
									dangerouslySetInnerHTML={{
										__html: `${preview}<div class="slice-name">Layer ${i + 1} · ${s.z.toFixed(1)}mm</div>`,
									}}
								/>
							);
						})}
					</div>
					<div className="button-row">
						<button
							className="btn-primary"
							onClick={() => downloadAll(false)}
						>
							Download All SVGs
						</button>
						<button
							className="btn-secondary"
							onClick={() => downloadAll(true)}
						>
							Download as ZIP
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
