import { describe, expect, it } from 'vitest';
import { formatSceneHeading, splitSceneHeading } from '../../src/services/sceneHeading';
import { scenePayload, toScene } from '../../src/services/workspaceData';
import { workspaceFixture } from '../support/fixtures';

describe('scene heading parsing', () => {
  it.each([
    ['WN. DOM - RANO', 'WN. DOM', 'RANO'],
    ['PL. STADION – POŁUDNIE', 'PL. STADION', 'POŁUDNIE'],
    ['INT. TRAIN — NIGHT', 'INT. TRAIN', 'NIGHT'],
    ['  wn. dom - noc  ', 'wn. dom', 'NOC'],
    ['WN. DOM-NOC', 'WN. DOM', 'NOC'],
    ['PL. BIELSKO-BIAŁA - ŚWIT', 'PL. BIELSKO-BIAŁA', 'ŚWIT'],
    ['WN. DOM - KUCHNIA - WIECZÓR', 'WN. DOM - KUCHNIA', 'WIECZÓR'],
    ['PL. LAS - NAD RANEM', 'PL. LAS', 'NAD RANEM'],
    ['INT. HALL - DAY / NIGHT', 'INT. HALL', 'DAY / NIGHT'],
    ['WN. DOM - CHWILĘ PÓŹNIEJ', 'WN. DOM', 'CHWILĘ PÓŹNIEJ'],
    ['WN. DOM', 'WN. DOM', ''],
    ['PL. BIELSKO-BIAŁA', 'PL. BIELSKO-BIAŁA', ''],
    ['WN. DOM - KUCHNIA', 'WN. DOM - KUCHNIA', ''],
    ['WN. DOM -', 'WN. DOM -', ''],
    ['', '', ''],
  ])('splits %s without confusing locations with time labels', (heading, location, time) => {
    expect(splitSceneHeading(heading)).toEqual({ location_heading: location, time_of_day: time });
  });

  it.each([
    ['WN. DOM', 'RANO', 'WN. DOM - RANO'],
    ['WN. DOM - RANO', 'RANO', 'WN. DOM - RANO'],
    ['WN. DOM – RANO', 'rano', 'WN. DOM – RANO'],
    ['WN. DOM - RANO', '', 'WN. DOM - RANO'],
    ['WN. DOM - KUCHNIA', 'RANO', 'WN. DOM - KUCHNIA - RANO'],
    ['WN. DOM - RANO', 'NOC', 'WN. DOM - NOC'],
    ['', '', ''],
    ['', 'NOC', '- NOC'],
  ])('composes separate and legacy fields: %s / %s', (location, time, heading) => {
    expect(formatSceneHeading(location, time)).toBe(heading);
  });

  it('preserves custom time labels returned by the API on unrelated scene edits', () => {
    const original = workspaceFixture().scenes[0];
    const scene = toScene({ ...original, location_heading: 'WN. DOM - KUCHNIA', time_of_day: 'PRZED BURZĄ' }, 1);
    expect(scene.heading).toBe('WN. DOM - KUCHNIA - PRZED BURZĄ');
    expect(scenePayload({ ...scene, notes: 'Zmiana notatek' })).toMatchObject({
      location_heading: 'WN. DOM - KUCHNIA', time_of_day: 'PRZED BURZĄ', content_text: original.content_text,
    });
  });

  it('normalizes legacy headings on save without duplicating the time or changing blocks', () => {
    const original = workspaceFixture().scenes[0];
    const scene = toScene({ ...original, location_heading: 'WN. DOM - RANO', time_of_day: 'RANO' }, 1);
    expect(scene.heading).toBe('WN. DOM - RANO');
    expect(scenePayload(scene)).toMatchObject({ location_heading: 'WN. DOM', time_of_day: 'RANO', content_text: original.content_text });
  });

  it('clears stale time after removing it from the header and clears both fields for an empty header', () => {
    const scene = toScene({ ...workspaceFixture().scenes[0], location_heading: 'WN. DOM', time_of_day: 'RANO' }, 1);
    expect(scenePayload({ ...scene, heading: 'WN. DOM' })).toMatchObject({ location_heading: 'WN. DOM', time_of_day: '' });
    expect(scenePayload({ ...scene, heading: '' })).toMatchObject({ location_heading: '', time_of_day: '' });
  });
});
