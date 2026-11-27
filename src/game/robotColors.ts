/** Each robot's colour, by its index: its program tab, its name and its speech bubble share it. */
export const ROBOT_COLORS = [0xf2c062, 0x8fd0c0, 0xf0a060, 0xb5dc8e, 0xc9a2e8, 0x86c3e6, 0xe88a8a, 0xd8d0c2] as const;
export const robotColor = (i: number) => `#${ROBOT_COLORS[i % ROBOT_COLORS.length].toString(16).padStart(6, '0')}`;
