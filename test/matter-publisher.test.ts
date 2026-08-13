import type { MatterAccessory } from 'homebridge';
import { describe, expect, it } from 'vitest';
import { associateMatterAccessory } from '../src/matter/matter-publisher.js';

describe('associateMatterAccessory', () => {
  it('sets the ownership fields serialized by Homebridge 2.2.1', () => {
    const accessory = {} as MatterAccessory & {
      _associatedPlugin?: string;
      _associatedPlatform?: string;
    };

    expect(associateMatterAccessory(accessory)).toBe(accessory);
    expect(accessory._associatedPlugin).toBe('homebridge-iaqualink-matter');
    expect(accessory._associatedPlatform).toBe('iAquaLink');
  });
});
