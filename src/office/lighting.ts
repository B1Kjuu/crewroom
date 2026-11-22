// Deck lighting by the local hour: full light by day, warm at dawn and dusk, dim and blue at night.
// Applied as a CSS filter on the stage, so both views and every material follow it for free.
export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

export function lighting(hour: number): { phase: Phase; filter: string } {
  if (hour >= 8 && hour < 18) return { phase: 'day', filter: 'none' };
  if (hour >= 5 && hour < 8) return { phase: 'dawn', filter: 'brightness(0.9) sepia(0.25) saturate(1.1)' };
  if (hour >= 18 && hour < 21) return { phase: 'dusk', filter: 'brightness(0.85) sepia(0.35) hue-rotate(-12deg)' };
  return { phase: 'night', filter: 'brightness(0.62) saturate(0.85) hue-rotate(12deg)' };
}
