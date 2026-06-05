import { describe, it, expect } from "vitest";
import {
	parseSTL,
	getBounds,
	sliceAtPlane,
	segsToPolylines,
	polylinesToSVG,
	sliceFilename,
} from "./slicerEngine";

describe("slicerEngine", () => {
	// Sample tetrahedron model: 4 vertices, 4 triangles
	const sampleTriangles = [
		[[0, 0, 0], [10, 0, 0], [0, 10, 0]],     // base
		[[0, 0, 0], [0, 10, 0], [0, 0, 10]],     // back
		[[0, 0, 0], [0, 0, 10], [10, 0, 0]],     // left
		[[10, 0, 0], [0, 0, 10], [0, 10, 0]],    // front
	];

	describe("getBounds", () => {
		it("calculates min and max values along the chosen axis correctly", () => {
			const zBounds = getBounds(sampleTriangles, "z");
			expect(zBounds.mn).toBe(0);
			expect(zBounds.mx).toBe(10);

			const xBounds = getBounds(sampleTriangles, "x");
			expect(xBounds.mn).toBe(0);
			expect(xBounds.mx).toBe(10);
		});
	});

	describe("sliceAtPlane", () => {
		it("intersects triangles at a given plane and returns line segments", () => {
			// Slice sampleTriangles at Z = 5.0 (horizontal cross section of the tetrahedron)
			// Triangle 1 (base): Z is entirely 0, shouldn't intersect Z=5
			// Triangle 2 (back): Vertices are [0,0,0], [0,10,0], [0,0,10].
			//                    At Z=5, it intersects at Y=5 (between [0,10,0] and [0,0,10]) and [0,0,5] (between [0,0,0] and [0,0,10])
			const segs = sliceAtPlane(sampleTriangles, 5.0, 2); // 2 is Z axis
			expect(segs.length).toBeGreaterThan(0);

			// Each segment should contain exactly 2 endpoints
			for (const seg of segs) {
				expect(seg.length).toBe(2);
				expect(seg[0].length).toBe(2); // X and Y components
				expect(seg[1].length).toBe(2);
			}
		});
	});

	describe("segsToPolylines", () => {
		it("assembles connected segments into continuous polylines", () => {
			// Define 3 connected segments in sequential order: (0,0) -> (1,1) -> (2,2) -> (3,3)
			const segs = [
				[[0, 0], [1, 1]],
				[[1, 1], [2, 2]],
				[[2, 2], [3, 3]],
			];
			const polys = segsToPolylines(segs);
			expect(polys.length).toBe(1);
			expect(polys[0].length).toBe(4);
			expect(polys[0][0]).toEqual([0, 0]);
			expect(polys[0][3]).toEqual([3, 3]);
		});

		it("returns an empty array when no segments are supplied", () => {
			expect(segsToPolylines([])).toEqual([]);
		});
	});

	describe("polylinesToSVG", () => {
		it("generates a valid SVG document string from polylines", () => {
			const polys = [
				[[0, 0], [10, 0], [10, 10], [0, 0]],
			];
			const result = polylinesToSVG(polys, 2); // margin = 2
			expect(result).not.toBeNull();
			expect(result?.svg).toContain("<svg");
			expect(result?.svg).toContain("viewBox");
			expect(result?.svg).toContain("<path");
			expect(result?.svg).toContain("stroke=\"black\"");
		});

		it("returns null if the polyline array is empty", () => {
			expect(polylinesToSVG([], 2)).toBeNull();
		});
	});

	describe("sliceFilename", () => {
		it("formats slice index and Z height into an SVG filename", () => {
			const filename = sliceFilename({ z: 12.345 }, 4);
			expect(filename).toBe("slice_004_z12.3mm.svg");
		});
	});

	describe("parseSTL", () => {
		it("correctly parses STL in ASCII format", () => {
			const asciiStl = `solid test_mesh
  facet normal 0 0 0
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 0
    endloop
  endfacet
endsolid test_mesh`;
			const buf = new TextEncoder().encode(asciiStl).buffer;
			const mesh = parseSTL(buf);
			expect(mesh.triangles.length).toBe(1);
			expect(mesh.triangles[0]).toEqual([
				[0, 0, 0],
				[10, 0, 0],
				[0, 10, 0],
			]);
		});
	});
});
