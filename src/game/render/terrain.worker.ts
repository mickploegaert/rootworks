/// <reference lib="webworker" />
// Bakes terrain chunks off the main thread, so streaming the world in never stalls a frame.
import { World, type WorldData } from '../world/World.ts';
import { bakeChunk, terrainContext, type ShadeStamp, type TerrainContext } from './TerrainBaker.ts';

export type WorkerIn = { type: 'init'; world: WorldData } | { type: 'bake'; cx: number; cy: number; stamps: ShadeStamp[] };

let tc: TerrainContext | null = null;

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'init') { tc = terrainContext(World.fromData(m.world)); return; }
  if (!tc) return;
  const r = bakeChunk(tc, m.cx, m.cy, m.stamps);
  const transfer = [r.pixels.buffer, ...(r.water?.frames.map((f) => f.buffer) ?? [])];
  (self as unknown as Worker).postMessage(r, transfer);
};
