import { SAVE_VERSION, captureProgress, type RegionSave, type SaveFile } from '../save/GameSave.ts';
import { Simulation } from '../Simulation.ts';
import { START_REGION, regionById, regionLock, regionSeed, type RegionId } from './regions.ts';

/**
 * Bring the save's active region into existence: generate it from its seed (or regenerate it, for a region visited
 * before) and apply the player's progress and the region's diff. No other region is generated or loaded.
 */
export function loadActiveRegion(save: SaveFile | undefined, worldSeed: number): Simulation {
  const region = save?.region ?? START_REGION;
  const saved = save?.regions[region];
  return Simulation.generate(saved?.seed ?? regionSeed(save?.seed ?? worldSeed, region), saved, region, save);
}

/** The save of a game in progress: the active region captured now, every other region carried over untouched. */
export function composeSave(
  sim: Simulation, other: SaveFile['regions'],
  meta: { worldSeed: number; time: number; tutorial?: string[]; program: RegionSave['program'] },
): SaveFile {
  return {
    version: SAVE_VERSION, seed: meta.worldSeed, savedAt: Date.now(), time: meta.time, region: sim.region,
    regions: { ...other, [sim.region]: { ...sim.capture(), program: meta.program } },
    ...captureProgress(sim),
    tutorial: meta.tutorial,
  };
}

/** The save to load after travelling to `target`, or why the trip is not possible. */
export function travelSave(current: SaveFile, target: RegionId, researched: ReadonlySet<string>): SaveFile | string {
  const def = regionById(target);
  if (!def) return 'Unknown region';
  if (target === current.region) return 'You are already here';
  const lock = regionLock(def, researched);
  return lock ?? { ...current, region: target };
}
