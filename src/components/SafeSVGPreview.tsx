import { useEffect, useRef } from "react";

interface SafeSVGPreviewProps {
	svgContent: string | null;
	className?: string;
	title?: string;
}

export function SafeSVGPreview({ svgContent, className, title }: SafeSVGPreviewProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Clear previous children
		container.replaceChildren();

		if (!svgContent) {
			const emptyMsg = document.createElement("div");
			emptyMsg.className = "svg-empty";
			emptyMsg.textContent = "No slice preview";
			container.appendChild(emptyMsg);
			return;
		}

		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(svgContent, "image/svg+xml");
			const parserError = doc.querySelector("parsererror");

			if (parserError) {
				const errorMsg = document.createElement("div");
				errorMsg.className = "svg-error";
				errorMsg.textContent = "Error loading preview";
				container.appendChild(errorMsg);
				return;
			}

			if (doc.documentElement) {
				const svgElement = doc.documentElement;
				// Adapt styles for previewing
				svgElement.setAttribute("width", "100%");
				svgElement.setAttribute("height", "100px");
				svgElement.style.display = "block";
				// Replace stroke="black" with stroke="currentColor" to allow theme colors to style the path
				const paths = svgElement.getElementsByTagName("path");
				for (let i = 0; i < paths.length; i++) {
					const stroke = paths[i].getAttribute("stroke");
					if (stroke === "black") {
						paths[i].setAttribute("stroke", "currentColor");
					}
				}
				container.appendChild(svgElement);
			}
		} catch (e) {
			console.error("SVG Parsing error", e);
			const errorMsg = document.createElement("div");
			errorMsg.className = "svg-error";
			errorMsg.textContent = "Error rendering preview";
			container.appendChild(errorMsg);
		}
	}, [svgContent]);

	return <div ref={containerRef} className={className} title={title} />;
}
