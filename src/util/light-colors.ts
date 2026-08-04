export interface LightColor { program: string; hue: number; saturation: number; brightness: number }

export const LIGHT_COLORS: LightColor[] = [
  { program: 'Alpine White', hue: 190, saturation: 12, brightness: 100 },
  { program: 'Sky Blue', hue: 196, saturation: 65, brightness: 100 },
  { program: 'Cobalt Blue', hue: 220, saturation: 88, brightness: 90 },
  { program: 'Caribbean Blue', hue: 203, saturation: 82, brightness: 95 },
  { program: 'Spring Green', hue: 133, saturation: 70, brightness: 90 },
  { program: 'Emerald Green', hue: 155, saturation: 80, brightness: 80 },
  { program: 'Emerald Rose', hue: 350, saturation: 55, brightness: 90 },
  { program: 'Magenta', hue: 302, saturation: 90, brightness: 95 },
  { program: 'Violet', hue: 285, saturation: 70, brightness: 95 },
];

export function nearestProgram(hue: number, saturation: number): string {
  const distance = (candidate: LightColor) => {
    const hueDelta = Math.min(Math.abs(candidate.hue - hue), 360 - Math.abs(candidate.hue - hue)) / 180;
    const saturationDelta = Math.abs(candidate.saturation - saturation) / 100;
    return (hueDelta * hueDelta) + (saturationDelta * saturationDelta * 0.35);
  };
  return [...LIGHT_COLORS].sort((a, b) => distance(a) - distance(b))[0].program;
}

export function colorForProgram(program?: string): LightColor {
  return LIGHT_COLORS.find((candidate) => candidate.program === program) ?? LIGHT_COLORS[0];
}
