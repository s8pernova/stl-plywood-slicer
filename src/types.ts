export interface Mesh {
	triangles: number[][][];
}

export interface Slice {
	idx: number;
	z: number;
	zEnd: number;
	svg: string | null;
}
