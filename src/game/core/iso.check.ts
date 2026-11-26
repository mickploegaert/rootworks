// Run with: npm run check
import assert from 'node:assert';
import { depthOf, footprintDepth, tileToWorld, worldToTile } from './iso.ts';

for (let x = -3; x < 50; x++) for (let y = -3; y < 50; y++) {
  const w = tileToWorld(x, y);
  assert.deepStrictEqual(worldToTile(w.x, w.y), { x, y });
  assert.deepStrictEqual(worldToTile(w.x + 20, w.y), { x, y }); // inside the diamond, right of centre
}
// robots beside buildings are drawn on the correct side (robot depth = tile centre + 1, as EntityRenderer does)
{
  const robot = (x: number, y: number) => depthOf(x + 0.5, y + 0.5) + 1;
  for (const [w, d] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [4, 3], [3, 4]]) {
    const bx = 10, by = 10, z = footprintDepth(bx, by, w, d);
    for (let y = by; y < by + d; y++) {
      assert.ok(robot(bx + w, y) > z, `${w}x${d}: robot on the +x side at y=${y} must be in front`);
      assert.ok(robot(bx - 1, y) < z, `${w}x${d}: robot on the -x side at y=${y} must be behind`);
    }
    for (let x = bx; x < bx + w; x++) {
      assert.ok(robot(x, by + d) > z, `${w}x${d}: robot on the +y side at x=${x} must be in front`);
      assert.ok(robot(x, by - 1) < z, `${w}x${d}: robot on the -y side at x=${x} must be behind`);
    }
  }
}
console.log('iso ok');
