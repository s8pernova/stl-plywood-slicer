interface SettingsPanelProps {
	thickness: number;
	setThickness: (t: number) => void;
	axis: string;
	setAxis: (a: string) => void;
	margin: number;
	setMargin: (m: number) => void;
	onSlice: () => void;
	disabled: boolean;
}

export function SettingsPanel({
	thickness,
	setThickness,
	axis,
	setAxis,
	margin,
	setMargin,
	onSlice,
	disabled,
}: SettingsPanelProps) {
	return (
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
					onClick={onSlice}
					disabled={disabled}
				>
					Slice
				</button>
			</div>
		</div>
	);
}
