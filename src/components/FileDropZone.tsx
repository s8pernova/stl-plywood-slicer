import { useState, useRef } from "react";

interface FileDropZoneProps {
	fileName: string;
	onFileSelected: (file: File) => void;
}

export function FileDropZone({ fileName, onFileSelected }: FileDropZoneProps) {
	const [isOver, setIsOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsOver(true);
	};

	const handleDragLeave = () => {
		setIsOver(false);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsOver(false);
		if (e.dataTransfer.files && e.dataTransfer.files[0]) {
			onFileSelected(e.dataTransfer.files[0]);
		}
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files[0]) {
			onFileSelected(e.target.files[0]);
		}
	};

	return (
		<>
			<div
				className={`drop-zone ${isOver ? "over" : ""}`}
				onClick={() => fileInputRef.current?.click()}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
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
				onChange={handleFileChange}
			/>
		</>
	);
}
