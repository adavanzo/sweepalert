import { isWithinBoston } from '../src/data/coverage';

describe('isWithinBoston', () => {
  it('accepts Boston-area coordinates', () => {
    expect(isWithinBoston(42.3554, -71.0708)).toBe(true); // downtown Boston
    expect(isWithinBoston(42.3736, -71.1097)).toBe(true); // Cambridge
    expect(isWithinBoston(42.3369, -71.0478)).toBe(true); // South Boston
  });

  it('rejects coordinates outside greater Boston', () => {
    expect(isWithinBoston(40.7128, -74.006)).toBe(false); // New York City
    expect(isWithinBoston(37.7749, -122.4194)).toBe(false); // San Francisco
    expect(isWithinBoston(42.3601, -73.5)).toBe(false); // western MA (too far west)
  });
});
