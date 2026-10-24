import RAPIER from '@dimforge/rapier3d-compat';

/** World-space candidate bounds, not collision geometry. Infinite casts may
 * contain infinities; the compact static index clamps them to its finite grid. */
export interface CompactQueryBounds {
  readonly minX: number; readonly maxX: number;
  readonly minY: number; readonly maxY: number;
  readonly minZ: number; readonly maxZ: number;
}

export interface CompactQueryRefreshOptions {
  isDirty(): boolean;
  /** Must include all potentially intersecting live static, rubble and projectile
   * colliders. Overinclusive candidates are safe: native pairwise casts decide. */
  candidates(bounds: CompactQueryBounds): Iterable<RAPIER.Collider>;
  /** External projectile creation/removal also invalidates the world's BVH. */
  markDirty?(): void;
}

const ZERO = { x: 0, y: 0, z: 0 };

function sweptBounds(position: RAPIER.Vector, velocity: RAPIER.Vector, maxToi: number, radius = 0): CompactQueryBounds {
  // WASM uses f32. Preserve both JS and native endpoints, with outward arithmetic
  // slack, so a ray that rounds onto a half-cell face cannot lose its candidate.
  // 0 * Infinity is NaN, but a stationary coordinate stays stationary.
  const axis = (p: number, v: number): [number, number] => {
    if (radius === Infinity) return [-Infinity, Infinity];
    const fp = Math.fround(p), fv = Math.fround(v), ft = Math.fround(maxToi);
    const end = v === 0 ? p : p + v * maxToi, fend = fv === 0 ? fp : fp + fv * ft;
    const low = Math.min(p, fp, end, fend), high = Math.max(p, fp, end, fend);
    if (Number.isNaN(low) || Number.isNaN(high)) return [-Infinity, Infinity];
    const scale = Math.max(1, Math.abs(p), Math.abs(fp), Number.isFinite(end) ? Math.abs(end) : 0, Number.isFinite(fend) ? Math.abs(fend) : 0, radius);
    const padding = radius + scale * 2 ** -21;
    return [low - padding, high + padding];
  };
  const [minX, maxX] = axis(position.x, velocity.x), [minY, maxY] = axis(position.y, velocity.y), [minZ, maxZ] = axis(position.z, velocity.z);
  return {
    minX, maxX, minY, maxY, minZ, maxZ,
  };
}

/** A rotation-independent conservative radius, used only to select candidates.
 * Unsupported/infinite shapes use all finite static chunks, never a smaller
 * surrogate collider. The hit itself always comes from Collider.castShape. */
function shapeRadius(shape: RAPIER.Shape): number {
  if (shape instanceof RAPIER.Ball) return shape.radius;
  if (shape instanceof RAPIER.Capsule) return shape.halfHeight + shape.radius;
  if (shape instanceof RAPIER.Cuboid || shape instanceof RAPIER.RoundCuboid) {
    const h = shape.halfExtents;
    return Math.hypot(h.x, h.y, h.z) + (shape instanceof RAPIER.RoundCuboid ? shape.borderRadius : 0);
  }
  if (shape instanceof RAPIER.Cylinder || shape instanceof RAPIER.Cone || shape instanceof RAPIER.RoundCylinder || shape instanceof RAPIER.RoundCone) {
    return Math.hypot(shape.halfHeight, shape.radius) + ('borderRadius' in shape ? shape.borderRadius : 0);
  }
  return Infinity;
}

function rotate(v: RAPIER.Vector, q: RAPIER.Rotation): RAPIER.Vector {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
}

function allowed(collider: RAPIER.Collider, flags: RAPIER.QueryFilterFlags | undefined, groups: number | undefined,
  excludedCollider: RAPIER.Collider | undefined, excludedBody: RAPIER.RigidBody | undefined,
  predicate: ((collider: RAPIER.Collider) => boolean) | undefined): boolean {
  if (!collider.isValid() || !collider.isEnabled() || collider.handle === excludedCollider?.handle) return false;
  const parent = collider.parent();
  if (parent && (!parent.isEnabled() || parent.handle === excludedBody?.handle)) return false;
  const f = flags ?? 0, Q = RAPIER.QueryFilterFlags;
  if ((f & Q.EXCLUDE_FIXED) && (!parent || parent.isFixed())) return false;
  if ((f & Q.EXCLUDE_KINEMATIC) && parent?.isKinematic()) return false;
  if ((f & Q.EXCLUDE_DYNAMIC) && parent?.isDynamic()) return false;
  if ((f & Q.EXCLUDE_SENSORS) && collider.isSensor()) return false;
  if ((f & Q.EXCLUDE_SOLIDS) && !collider.isSensor()) return false;
  if (groups !== undefined) {
    const own = collider.collisionGroups();
    if (((groups >>> 16) & (own & 0xffff)) === 0 || ((own >>> 16) & (groups & 0xffff)) === 0) return false;
  }
  return !predicate || predicate(collider);
}

/** Rapier 0.21 has no public query-pipeline rebuild without a solver step.
 * Until the owner completes its next REAL step, query the same world's native
 * colliders directly. Never step, mutate body poses, create a second world, or
 * synthesize a collision from compact voxel metadata.
 *
 * Locked 0.21 contracts: Collider.castShape returns both sides in local space;
 * World.castShape requires side 1 in world space and side 2 still local.
 * https://rapier.rs/javascript3d/classes/ColliderShapeCastHit.html
 * Native BVH tie ordering is unspecified. Dirty queries deterministically pick
 * the smaller collider handle at exactly equal TOI, without an epsilon that
 * could incorrectly select a more distant surface. */
export function installCompactQueryRefresh(world: RAPIER.World, options: CompactQueryRefreshOptions): () => void {
  const names = ['castRay', 'castRayAndGetNormal', 'castShape', 'createCollider', 'removeCollider', 'removeRigidBody'] as const;
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(world, name));
  const nativeRay = world.castRay, nativeNormal = world.castRayAndGetNormal, nativeShape = world.castShape;
  const nativeCreate = world.createCollider, nativeRemove = world.removeCollider, nativeRemoveBody = world.removeRigidBody;

  world.castRay = (...args) => {
    if (!options.isDirty()) return nativeRay.apply(world, args);
    const [ray, maxToi, solid, flags, groups, excludedCollider, excludedBody, predicate] = args;
    const limit = Math.fround(maxToi);
    if (!(limit > 0)) return null;
    let best: RAPIER.RayColliderHit | null = null;
    for (const collider of options.candidates(sweptBounds(ray.origin, ray.dir, maxToi))) {
      if (!allowed(collider, flags, groups, excludedCollider, excludedBody, predicate)) continue;
      const toi = collider.castRay(ray, maxToi, solid);
      // The native World BVH rejects hits at maxToi, while Collider accepts
      // them. Preserve World's strict boundary after its f32 conversion.
      if (toi >= 0 && toi < limit && (!best || toi < best.timeOfImpact || toi === best.timeOfImpact && collider.handle < best.collider.handle)) best = new RAPIER.RayColliderHit(collider, toi);
    }
    return best;
  };
  world.castRayAndGetNormal = (...args) => {
    if (!options.isDirty()) return nativeNormal.apply(world, args);
    const [ray, maxToi, solid, flags, groups, excludedCollider, excludedBody, predicate] = args;
    const limit = Math.fround(maxToi);
    if (!(limit > 0)) return null;
    let best: RAPIER.RayColliderIntersection | null = null;
    for (const collider of options.candidates(sweptBounds(ray.origin, ray.dir, maxToi))) {
      if (!allowed(collider, flags, groups, excludedCollider, excludedBody, predicate)) continue;
      const hit = collider.castRayAndGetNormal(ray, maxToi, solid);
      if (hit && hit.timeOfImpact >= 0 && hit.timeOfImpact < limit && (!best || hit.timeOfImpact < best.timeOfImpact || hit.timeOfImpact === best.timeOfImpact && collider.handle < best.collider.handle)) {
        best = new RAPIER.RayColliderIntersection(collider, hit.timeOfImpact, hit.normal, hit.featureType, hit.featureId);
      }
    }
    return best;
  };
  world.castShape = (...args) => {
    if (!options.isDirty()) return nativeShape.apply(world, args);
    const [position, rotation, velocity, shape, targetDistance, maxToi, stopAtPenetration, flags, groups, excludedCollider, excludedBody, predicate] = args;
    const limit = Math.fround(maxToi);
    if (!(limit > 0)) return null;
    let best: RAPIER.ColliderShapeCastHit | null = null;
    for (const collider of options.candidates(sweptBounds(position, velocity, maxToi, shapeRadius(shape) + Math.max(0, targetDistance)))) {
      if (!allowed(collider, flags, groups, excludedCollider, excludedBody, predicate)) continue;
      const hit = collider.castShape(ZERO, shape, position, rotation, velocity, targetDistance, maxToi, stopAtPenetration);
      if (hit && hit.time_of_impact >= 0 && hit.time_of_impact < limit && (!best || hit.time_of_impact < best.time_of_impact || hit.time_of_impact === best.time_of_impact && collider.handle < best.collider.handle)) {
        const q = collider.rotation(), p = collider.translation(), witness = rotate(hit.witness1, q);
        best = new RAPIER.ColliderShapeCastHit(collider, hit.time_of_impact,
          { x: witness.x + p.x, y: witness.y + p.y, z: witness.z + p.z }, hit.witness2, rotate(hit.normal1, q), hit.normal2);
      }
    }
    return best;
  };

  world.createCollider = (...args) => { const collider = nativeCreate.apply(world, args); options.markDirty?.(); return collider; };
  world.removeCollider = (...args) => { nativeRemove.apply(world, args); options.markDirty?.(); };
  world.removeRigidBody = (...args) => { nativeRemoveBody.apply(world, args); options.markDirty?.(); };

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    names.forEach((name, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(world, name, descriptor);
      else delete (world as unknown as Record<string, unknown>)[name];
    });
  };
}
