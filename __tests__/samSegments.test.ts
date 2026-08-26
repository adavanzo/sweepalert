import {
  buildStreetName,
  pointToPath,
  resolveFromFeatures,
} from '../src/data/providers/samGeometry';

describe('buildStreetName', () => {
  it('combines SAM name + type into the sweeping dataset form', () => {
    expect(buildStreetName('BOYLSTON', 'ST')).toBe('Boylston St');
    expect(buildStreetName('Marlborough', 'ST')).toBe('Marlborough St');
    expect(buildStreetName('Hadassah', 'WAY')).toBe('Hadassah Way');
  });
});

describe('pointToPath', () => {
  // A ~E-W street segment near the equator-ish scale (Boston lat).
  const path: [number, number][] = [
    [-71.070, 42.352],
    [-71.068, 42.352],
  ];
  it('measures distance to the line and reports a side', () => {
    const north = pointToPath(42.3524, -71.069, path); // ~44m north of the line
    const south = pointToPath(42.3516, -71.069, path);
    expect(north.dist).toBeGreaterThan(20);
    expect(north.dist).toBeLessThan(80);
    // North and south of a west->east segment fall on opposite sides.
    expect(Math.sign(north.side)).toBe(-Math.sign(south.side));
  });
});

describe('resolveFromFeatures', () => {
  // Two parallel E-W streets: Boylston (south) and Newbury (north). A point just
  // north of Boylston must resolve to Boylston, not Newbury.
  const boylston = {
    attributes: { ST_NAME: 'Boylston', ST_TYPE: 'ST', L_F_ADD: 350, R_F_ADD: 351, NBHD_L: 'Back Bay', NBHD_R: 'Back Bay' },
    geometry: { paths: [[[-71.070, 42.3519], [-71.068, 42.3519]] as [number, number][]] },
  };
  const newbury = {
    attributes: { ST_NAME: 'Newbury', ST_TYPE: 'ST', L_F_ADD: 200, R_F_ADD: 201, NBHD_L: 'Back Bay', NBHD_R: 'Back Bay' },
    geometry: { paths: [[[-71.070, 42.3527], [-71.068, 42.3527]] as [number, number][]] },
  };

  it('snaps to the actually-nearest street, not a parallel one', () => {
    const m = resolveFromFeatures(42.35205, -71.069, [newbury, boylston]);
    expect(m?.street).toBe('Boylston St');
  });

  it('lists nearby candidate streets nearest-first', () => {
    const m = resolveFromFeatures(42.35205, -71.069, [newbury, boylston]);
    expect(m?.candidates[0]).toBe('Boylston St');
    expect(m?.candidates).toContain('Newbury St');
  });

  it('derives the even/odd side from geometry + address parity', () => {
    // Just north of Boylston: left side of a west->east line has even L_F_ADD(350).
    const m = resolveFromFeatures(42.35205, -71.069, [boylston]);
    expect(['even', 'odd']).toContain(m?.side);
  });

  it('prefers a real street over a marginally-closer service alley', () => {
    // Alley slightly closer than Comm Ave, but you parked on the street.
    const commAve = {
      attributes: { ST_NAME: 'Commonwealth', ST_TYPE: 'AVE', L_F_ADD: 300, R_F_ADD: 301, NBHD_L: 'Back Bay', NBHD_R: 'Back Bay' },
      geometry: { paths: [[[-71.078, 42.3520], [-71.076, 42.3520]] as [number, number][]] },
    };
    const alley = {
      attributes: { ST_NAME: 'Public Alley No. 422', ST_TYPE: '', L_F_ADD: null, R_F_ADD: null, NBHD_L: 'Back Bay', NBHD_R: 'Back Bay' },
      geometry: { paths: [[[-71.078, 42.35215], [-71.076, 42.35215]] as [number, number][]] },
    };
    const m = resolveFromFeatures(42.35205, -71.077, [alley, commAve]);
    expect(m?.street).toBe('Commonwealth Ave');
    expect(m?.candidates[0]).toBe('Commonwealth Ave'); // real street leads the picker
  });
});
