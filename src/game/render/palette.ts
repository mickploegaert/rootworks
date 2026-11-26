import { ramp } from './pixel/PixelCanvas.ts';

/**
 * The ROOTWORKS "Cozy Industrial" palette. Every ramp runs dark -> light.
 * Forest and meadow greens, warm wood and brick, copper, cream plaster, honey-coloured light.
 * Shadows lean warm-purple instead of blue-black so nothing reads cold or neon.
 */
export const P = {
  grass: ramp('#28401f', '#365a24', '#4a762a', '#629232', '#7fad3e', '#a3c655', '#c9de7c'),
  grassWarm: ramp('#3b4a20', '#52682a', '#6f8a30', '#90a83a', '#b2c24c', '#d2d86a', '#ece898'),
  grassCool: ramp('#21391f', '#2e5226', '#3f6c2d', '#548a36', '#6ca442', '#8cbd58', '#b0d47a'),
  maple: ramp('#4a1d12', '#7a3016', '#ad481c', '#d86a26', '#ee9238', '#ffbd5a', '#ffdf92'),
  cherry: ramp('#5a2a44', '#8a3f66', '#bb5f8e', '#de8bb0', '#f4b5cc', '#ffdce8'),
  birch: ramp('#2c4020', '#3f5e28', '#587c2e', '#77993a', '#9cb84e', '#c2d46e', '#e2ec9e'),
  willow: ramp('#27402a', '#345e36', '#477c42', '#62995a', '#88b56e', '#b2d18e'),
  moss: ramp('#253620', '#304a24', '#3f6028', '#527a2e', '#6c9436', '#8fae48'),
  leaf: ramp('#1f3a20', '#2b5226', '#3a6c2c', '#4f8834', '#6ba43e', '#92c052', '#bbd977'),
  leafWarm: ramp('#34441c', '#4e6420', '#6e8628', '#93a736', '#bac34a', '#dcd96e'),
  pine: ramp('#1a2f22', '#22432c', '#2c5a36', '#3a7442', '#518e52', '#72aa68'),
  bark: ramp('#2e1d15', '#47291b', '#623a24', '#7e4f2f', '#9c683e'),
  dirt: ramp('#3f2b1f', '#5b3d2a', '#7a5437', '#9a6e48', '#b88a5c', '#d4ab7a'),
  stone: ramp('#3a3436', '#524a4a', '#6c6461', '#8a817a', '#a99f95', '#c8beb1', '#e4dccd'),
  /** Warm cobbles and dressed stone of the yard. */
  concrete: ramp('#4f443d', '#6a5d53', '#87786a', '#a39382', '#bfae9a', '#d8c9b2'),
  sand: ramp('#8c6c48', '#b38f62', '#d1b07e', '#e7cc9c', '#f4e2bc', '#fff4dc'),
  cream: ramp('#7c6a55', '#a38f73', '#c6b291', '#e2d2b0', '#f3e8cc', '#fdf8e8'),
  rust: ramp('#3a1e15', '#5e2d1a', '#83401f', '#a85826', '#c87432', '#e2984e'),
  copper: ramp('#4a2414', '#76391c', '#a05226', '#c76f36', '#e3934e', '#f6be7c', '#ffe0b0'),
  verdigris: ramp('#2c4a40', '#3e6a58', '#548c72', '#74ad8c', '#9ccaa8'),
  /** Iron and machine metal: warm grey, never blue. */
  steel: ramp('#2b2a2e', '#3f3d41', '#56535a', '#716d72', '#8f8a8c', '#b2aca8'),
  brick: ramp('#4a2219', '#6c3123', '#8f432d', '#b0583a', '#c97552', '#e09a74'),
  roof: ramp('#4a1f17', '#6e2d1f', '#93402a', '#b55634', '#d27142', '#e89660'),
  slate: ramp('#2e2c34', '#403e48', '#55525c', '#6d6973', '#87828a'),
  wood: ramp('#33221a', '#4f3424', '#6f4a30', '#91643e', '#b0804f', '#cda067'),
  teal: ramp('#1e3d3a', '#2a5650', '#3a7268', '#529081', '#76ae9c', '#a6cebd'),
  amber: ramp('#5e3612', '#97581b', '#cc8423', '#eeab3a', '#ffd067', '#fff0b4'),
  water: ramp('#1a4a5c', '#226478', '#2e8090', '#479ea6', '#71bdbc', '#a9dcd3', '#e6f6ee'),
  glass: ramp('#1f2a36', '#2c4050', '#3e5a6a', '#5a7c88', '#86a8ac'),
  hazard: ramp('#2a2420', '#e2b23a'),
  flowers: ramp('#faf4e4', '#f6d14a', '#e8708e', '#a487d8', '#ff9e52'),
  ironOre: ramp('#3e1c15', '#6c2e1e', '#9a472b', '#c4693b', '#e8955c'),
  copperOre: ramp('#1d4a3e', '#2a6c56', '#3c9070', '#62b690', '#9ad8b6'),
  /** Soft sage light for indicator glows (kept muted: no neon). */
  glowTeal: ramp('#2e4a3e', '#3f6a54', '#5a8f6c', '#7fb48a', '#ade0b2', '#e2f8d8'),
  white: ramp('#d8d0c2', '#f6f1e6'),
};
