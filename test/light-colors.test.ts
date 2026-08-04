import { describe, expect, it } from 'vitest';
import { nearestProgram } from '../src/util/light-colors.js';

describe('nearestProgram', () => {
  it('maps blue to Caribbean Blue', () => expect(nearestProgram(203, 82)).toBe('Caribbean Blue'));
  it('maps magenta to Magenta', () => expect(nearestProgram(302, 90)).toBe('Magenta'));
});
