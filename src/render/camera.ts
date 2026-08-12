/**
 * A camera in Source's own convention, so a rendering and a screenshot are comparable.
 *
 * The convention is not a detail and it is not ours to choose. Source's world axes are
 * **+x forward, +y left, +z up**, and an `angles` triple is **pitch, yaw, roll** in degrees,
 * applied in that order -- pitch about the *left* axis, positive pitch looking **down**.
 * gmod-mcp's `read_view` reports a player's eye in exactly those terms.
 *
 * Matching it means a `render_vmf_view` from the same origin and angles as a `capture_screen`
 * frames the same thing, and the two pictures can be laid over each other. That costs
 * nothing to do now and cannot be retrofitted later without invalidating every rendering
 * anyone has looked at, which is why it is here in the block that has no in-game half yet.
 *
 * The other half of the convention is the projection. Source's `fov` is the **horizontal**
 * field of view, so the vertical one follows from the aspect ratio rather than the other way
 * round. Getting that backwards produces a picture that is right at 4:3 and subtly wrong at
 * every other shape, which is the sort of error nobody sees and everybody measures against.
 */
import type { Vec3 } from "../vmf/solid.js";

export interface Camera {
  origin: Vec3;
  /** Pitch, yaw, roll, in degrees, as Source writes them. */
  angles: Vec3;
  /** Horizontal field of view in degrees, as Source's `fov` means it. */
  fov: number;
  width: number;
  height: number;
  /** Nothing nearer than this is drawn. Source's own default is 7 units. */
  near: number;
}

export interface CameraBasis {
  /** Where the camera looks. */
  forward: Vec3;
  /** Source's +y at zero yaw: to the camera's left. */
  left: Vec3;
  up: Vec3;
}

const RAD = Math.PI / 180;

/**
 * The three axes of a camera, from Source's `AngleVectors`.
 *
 * Written out rather than composed from three rotation matrices, because the order and the
 * signs are the whole content of it and a composed version hides both.
 */
export function basisOf(angles: Vec3): CameraBasis {
  const [pitch, yaw, roll] = angles;
  const sp = Math.sin(pitch * RAD);
  const cp = Math.cos(pitch * RAD);
  const sy = Math.sin(yaw * RAD);
  const cy = Math.cos(yaw * RAD);
  const sr = Math.sin(roll * RAD);
  const cr = Math.cos(roll * RAD);

  // Positive pitch looks down, hence the minus on the z component of forward.
  const forward: Vec3 = [cp * cy, cp * sy, -sp];
  // Source calls this `right`, and it points along -y at zero yaw. Named `left` here for
  // what it is in world terms, so nothing has to remember which of the two the name means.
  const right: Vec3 = [
    -sr * sp * cy + cr * sy,
    -sr * sp * sy - cr * cy,
    -sr * cp,
  ];
  const up: Vec3 = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  return { forward, left: [-right[0], -right[1], -right[2]], up };
}

export interface ViewPoint {
  /** Distance in front of the camera. Negative is behind it. */
  z: number;
  /** Right of centre, in view units. */
  x: number;
  /** Up from centre, in view units. */
  y: number;
}

/** Puts a world point in the camera's frame: x right, y up, z forward. */
export function toView(camera: Camera, basis: CameraBasis, p: Vec3): ViewPoint {
  const dx = p[0] - camera.origin[0];
  const dy = p[1] - camera.origin[1];
  const dz = p[2] - camera.origin[2];
  return {
    z: basis.forward[0] * dx + basis.forward[1] * dy + basis.forward[2] * dz,
    x: -(basis.left[0] * dx + basis.left[1] * dy + basis.left[2] * dz),
    y: basis.up[0] * dx + basis.up[1] * dy + basis.up[2] * dz,
  };
}

export interface Screen {
  /** Pixels from the left edge. */
  px: number;
  /** Pixels from the **top** edge, which is where both PNG and the rasteriser start. */
  py: number;
}

/**
 * The half-width and half-height of the view plane at unit depth.
 *
 * Horizontal from `fov`; vertical from the aspect ratio, because Source's `fov` is the
 * horizontal one.
 */
export function planeScale(camera: Camera): { sx: number; sy: number } {
  const sx = Math.tan((camera.fov * RAD) / 2);
  return { sx, sy: (sx * camera.height) / camera.width };
}

/** Projects a point already in view space. The caller must have clipped `z >= near`. */
export function project(camera: Camera, v: ViewPoint): Screen {
  const { sx, sy } = planeScale(camera);
  return {
    px: ((v.x / (v.z * sx)) * 0.5 + 0.5) * camera.width,
    py: (0.5 - (v.y / (v.z * sy)) * 0.5) * camera.height,
  };
}

/**
 * The world-space ray through the centre of a pixel.
 *
 * This is what makes the rasteriser checkable: the same pixel reached two ways, once by
 * scan-converting polygons and once by tracing this ray through the BVH. They share the
 * camera and nothing else.
 */
export function rayThrough(
  camera: Camera,
  basis: CameraBasis,
  px: number,
  py: number,
  distance: number,
): Vec3 {
  const { sx, sy } = planeScale(camera);
  const ndcX = ((px + 0.5) / camera.width) * 2 - 1;
  const ndcY = 1 - ((py + 0.5) / camera.height) * 2;
  const right: Vec3 = [-basis.left[0], -basis.left[1], -basis.left[2]];
  const dir: Vec3 = [
    basis.forward[0] + right[0] * ndcX * sx + basis.up[0] * ndcY * sy,
    basis.forward[1] + right[1] * ndcX * sx + basis.up[1] * ndcY * sy,
    basis.forward[2] + right[2] * ndcX * sx + basis.up[2] * ndcY * sy,
  ];
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  return [
    camera.origin[0] + (dir[0] / len) * distance,
    camera.origin[1] + (dir[1] / len) * distance,
    camera.origin[2] + (dir[2] / len) * distance,
  ];
}
