import type { Slice, Mesh } from "../types";
import { SafeSVGPreview } from "./SafeSVGPreview";

interface ResultsPanelProps {
	slices: Slice[];
	thickness: number;
	modelSpan: number;
	mesh: Mesh | null;
	axis: string;
	downloadSVG: (s: Slice, i: number) => void;
	downloadAll: (asZip: boolean) => void;
}

export function ResultsPanel({
	slices,
	thickness,
	modelSpan,
	mesh,
	axis,
	downloadSVG,
	downloadAll,
}: ResultsPanelProps) {
	const nonEmptySlices = slices.filter((s) => s.svg);

	return (
		<div className="card">
			<h2>Results</h2>
			<div className="stats">
				<div className="stat">
					<div className="stat-label">Total Slices</div>
					<div className="stat-val">{nonEmptySlices.length}</div>
				</div>
				<div className="stat">
					<div className="stat-label">Thickness</div>
					<div className="stat-val">{thickness}mm</div>
				</div>
				<div className="stat">
					<div className="stat-label">Model Span</div>
					<div className="stat-val">{modelSpan.toFixed(1)}mm</div>
				</div>
				<div className="stat">
					<div className="stat-label">Triangles</div>
					<div className="stat-val">
						{mesh ? mesh.triangles.length.toLocaleString() : 0}
					</div>
				</div>
			</div>
			<div className="slice-grid">
				{nonEmptySlices.map((s, i) => {
					// Adapt SVG to apply theme color and dimensions
					const preview = s.svg
						? s.svg
								.replace(/stroke="black"/g, 'stroke="currentColor"')
								.replace(/width="[^"]*"/, 'width="100%"')
								.replace(/height="[^"]*"/, 'height="100px"')
						: "";

					return (
						<div
							key={s.idx}
							className="slice-card"
							title={`Slice ${i + 1} · ${axis.toUpperCase()} ${s.z.toFixed(1)}–${s.zEnd.toFixed(1)}mm`}
							onClick={() => downloadSVG(s, i + 1)}
						>
							<SafeSVGPreview svgContent={preview} />
							<div className="slice-name">
								Layer {i + 1} · {s.z.toFixed(1)}mm
							</div>
						</div>
					);
				})}
			</div>
			<div className="button-row">
				<button className="btn-primary" onClick={() => downloadAll(false)}>
					Download All SVGs
				</button>
				<button className="btn-secondary" onClick={() => downloadAll(true)}>
					Download as ZIP
				</button>
			</div>
		</div>
	);
}
