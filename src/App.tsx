import { useState } from "react";
import JSZip from "jszip";
import "./App.css";
import type { Mesh, Slice } from "./types";
import {
	parseSTL,
	parse3MF,
	getBounds,
	sliceAtPlane,
	segsToPolylines,
	polylinesToSVG,
	sliceFilename,
} from "./utils/slicerEngine";
import { FileDropZone } from "./components/FileDropZone";
import { ThreeDViewer } from "./components/ThreeDViewer";
import { SettingsPanel } from "./components/SettingsPanel";
import { ResultsPanel } from "./components/ResultsPanel";

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
		} catch (e: unknown) {
			const errMsg = e instanceof Error ? e.message : String(e);
			setStatusText("Error: " + errMsg);
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

	return (
		<div style={{ maxWidth: "1000px", margin: "0 auto" }}>
			<div className="card">
				<h2>Plywood Slicer</h2>
				<p className="subtitle">
					Load an STL or 3MF file, preview in 3D, set your material
					thickness, and download per-slice SVGs.
				</p>

				<FileDropZone fileName={fileName} onFileSelected={handleFile} />

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

			<ThreeDViewer mesh={mesh} onWebGLError={setStatusText} />

			<SettingsPanel
				thickness={thickness}
				setThickness={setThickness}
				axis={axis}
				setAxis={setAxis}
				margin={margin}
				setMargin={setMargin}
				onSlice={runSlice}
				disabled={!mesh}
			/>

			{showResults && (
				<ResultsPanel
					slices={slices}
					thickness={thickness}
					modelSpan={modelSpan}
					mesh={mesh}
					axis={axis}
					downloadSVG={downloadSVG}
					downloadAll={downloadAll}
				/>
			)}
		</div>
	);
}

export default App;
