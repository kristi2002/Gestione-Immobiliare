import * as THREE from 'three';

/**
 * Cinematic camera choreography for the intro sequence.
 *
 * World layout (see HouseScene): the house sits at the origin with its front
 * door on the +Z face at z = HOUSE_FRONT_Z. The path is a single smooth
 * Catmull-Rom spline sampled by an eased scalar, so the three "phases" blend
 * into one continuous move:
 *
 *   t 0.00 – 0.40  Phase 1: distant wide side shot → zoom toward the house
 *   t 0.40 – 0.75  Phase 2: arc from the side around to the front, settling
 *                            on-axis with the front door
 *   t 0.75 – 1.00  Phase 3: dolly straight forward through the door frame
 */

export const HOUSE_FRONT_Z = 2.2;
export const DOOR_HEIGHT_Y = 1.55;

/** Camera z-coordinate that counts as "crossed the threshold" of the door. */
export const DOOR_THRESHOLD_Z = HOUSE_FRONT_Z - 0.35;

/** Total flight time in seconds (progress is delta-time driven, not frames). */
export const FLIGHT_DURATION = 9;

const positionCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(22, 5.5, 9), // wide hero shot, off to the side by the water
    new THREE.Vector3(14, 3.6, 8), // zooming in, still side-on
    new THREE.Vector3(8, 2.4, 8.5), // beginning the arc
    new THREE.Vector3(3.2, 1.9, 9.5), // swinging around the corner
    new THREE.Vector3(0, DOOR_HEIGHT_Y, 8), // aligned dead-center with the door
    new THREE.Vector3(0, DOOR_HEIGHT_Y, 4.5), // approach
    new THREE.Vector3(0, DOOR_HEIGHT_Y, HOUSE_FRONT_Z - 1.4), // through the frame, inside
  ],
  false,
  'catmullrom',
  0.35,
);

const targetCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 1.6, 0), // gaze at the house body
    new THREE.Vector3(0, 1.6, 0.5),
    new THREE.Vector3(0, DOOR_HEIGHT_Y, 1.2), // tighten onto the door
    new THREE.Vector3(0, DOOR_HEIGHT_Y, HOUSE_FRONT_Z), // lock on the doorway
    new THREE.Vector3(0, DOOR_HEIGHT_Y, -3), // look through into the interior
  ],
  false,
  'catmullrom',
  0.4,
);

/** Cinematic ease: slow launch, confident middle, gentle landing. */
export function easeFlight(t: number): number {
  // easeInOutCubic
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

/** Sample position + lookAt target at eased progress `e` in [0, 1]. */
export function sampleFlight(e: number): { position: THREE.Vector3; target: THREE.Vector3 } {
  positionCurve.getPointAt(THREE.MathUtils.clamp(e, 0, 1), _pos);
  targetCurve.getPointAt(THREE.MathUtils.clamp(e, 0, 1), _look);
  return { position: _pos, target: _look };
}
