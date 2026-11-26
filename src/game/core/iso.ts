/** Isometric 2:1 projection. Tile (tx,ty): +x runs screen down-right, +y runs screen down-left. */
export const TILE_W = 64;
export const TILE_H = 32;

export interface Vec2 { x: number; y: number }

/** Continuous tile coords (u,v) -> world pixels. Tile (i,j) spans u∈[i,i+1), v∈[j,j+1). */
export const uvToWorld = (u: number, v: number): Vec2 => ({
  x: ((u - v) * TILE_W) / 2,
  y: ((u + v) * TILE_H) / 2,
});

/** World pixels -> continuous tile coords. */
export const worldToUV = (wx: number, wy: number): Vec2 => ({
  x: wx / TILE_W + wy / TILE_H,
  y: wy / TILE_H - wx / TILE_W,
});

/** World position of a tile's centre. */
export const tileToWorld = (tx: number, ty: number): Vec2 => uvToWorld(tx + 0.5, ty + 0.5);

export const worldToTile = (wx: number, wy: number): Vec2 => {
  const { x, y } = worldToUV(wx, wy);
  return { x: Math.floor(x), y: Math.floor(y) };
};

/** Painter's-algorithm depth for a continuous tile position. */
export const depthOf = (u: number, v: number): number => (u + v) * (TILE_H / 2);

/**
 * Draw depth of a static w x d footprint: the depth of its centre. Anything on a 1x1 tile touching its visible
 * (+x or +y) side is deeper, anything touching its hidden (-x or -y) side is shallower, for footprints up to |w - d| = 1.
 */
export const footprintDepth = (x: number, y: number, w: number, d: number): number => depthOf(x + w / 2, y + d / 2);

/** Screen pixels per elevation level. */
export const HEIGHT_UNIT = 10;
