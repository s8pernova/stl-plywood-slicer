import { useEffect, useRef } from "react";
import type { Mesh } from "../types";
import vertexShaderSrc from "../shaders/viewer.vert.glsl?raw";
import fragmentShaderSrc from "../shaders/viewer.frag.glsl?raw";

interface ThreeDViewerProps {
	mesh: Mesh | null;
	onWebGLError?: (message: string) => void;
}

export function ThreeDViewer({ mesh, onWebGLError }: ThreeDViewerProps) {
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

	useEffect(() => {
		if (!mesh || !canvasRef.current) return;

		const canvas = canvasRef.current;
		const gl = canvas.getContext("webgl", {
			antialias: true,
			alpha: false,
		});

		if (!gl) {
			if (onWebGLError) onWebGLError("WebGL unavailable");
			return;
		}

		glRef.current = gl;

		canvas.width = canvas.clientWidth;
		canvas.height = canvas.clientHeight;
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.DEPTH_TEST);

		const compile = (type: number, src: string) => {
			const s = gl.createShader(type)!;
			gl.shaderSource(s, src);
			gl.compileShader(s);
			return s;
		};

		const prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertexShaderSrc));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragmentShaderSrc));
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

				// SOLID PASS (White model fill)
				gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
				gl.enableVertexAttribArray(posLoc);
				gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
				gl.uniform4f(colorLoc, 1, 1, 1, 1);
				gl.drawArrays(gl.TRIANGLES, 0, triCountRef.current);

				// WIREFRAME PASS (Black outlines)
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
	}, [mesh, onWebGLError]);

	if (!mesh) return null;

	return (
		<div className="viewer-wrap active">
			<canvas ref={canvasRef} className="viewer-canvas"></canvas>
			<div className="viewer-hint">
				drag to rotate
				<br />
				scroll to zoom
			</div>
		</div>
	);
}
