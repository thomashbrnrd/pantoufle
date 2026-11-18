/**
 * Data model of a project (see docs/data-model.md).
 *
 * Coordinates are plan centimetres: X east, Y south, Z up.
 * Rotations are degrees around the vertical axis, counter-clockwise when the plan
 * is viewed from above with north up (same sign as three.js `rotation.y`).
 */
import { z } from 'zod';

export const Vec2 = z.tuple([z.number(), z.number()]);
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'expected #RRGGBB');
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'expected kebab-case id');
const MaterialRef = z.string().min(1);

export type Vec2 = z.infer<typeof Vec2>;
export type Vec3 = z.infer<typeof Vec3>;

// ---------------------------------------------------------------- materials

export const PROCEDURAL_TEXTURES = [
  'oak-planks',
  'tile-terrace',
  'tile-kitchen',
  'tile-bath-floor',
  'tile-bath-wall',
  'tile-bath-wave',
  'brick',
  'concrete',
  'veneer',
  'linen',
  'wool',
] as const;

export const Material = z
  .object({
    label: z.string().optional(),
    color: Hex.optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    doubleSided: z.boolean().optional(),
    /** Texture repeated every `tile` cm (UVs are generated in cm). */
    texture: z
      .object({ procedural: z.enum(PROCEDURAL_TEXTURES), tile: Vec2 })
      .strict()
      .optional(),
    /** Emissive glow applied in the evening mood (lamp shades, bulbs, LED). */
    night: z.object({ emissive: Hex, intensity: z.number() }).strict().optional(),
  })
  .strict();
export type Material = z.infer<typeof Material>;

export const MaterialLibrary = z.record(Id, Material);
export type MaterialLibrary = z.infer<typeof MaterialLibrary>;

// ---------------------------------------------------------------- parts

/** Per-face materials; n/s/e/w are the faces looking north/south/east/west. */
export const FaceMaterials = z
  .object({
    default: MaterialRef,
    n: MaterialRef.optional(),
    s: MaterialRef.optional(),
    e: MaterialRef.optional(),
    w: MaterialRef.optional(),
    top: MaterialRef.optional(),
    bottom: MaterialRef.optional(),
  })
  .strict();
export type FaceMaterials = z.infer<typeof FaceMaterials>;

const common = {
  name: z.string().optional(),
  /** Cast shadows (default true). */
  shadow: z.boolean().optional(),
};

export const BoxPart = z
  .object({
    type: z.literal('box'),
    min: Vec3,
    max: Vec3,
    material: z.union([MaterialRef, FaceMaterials]),
    /** Blocks the visitor (footprint used as a 2D collider). */
    collide: z.boolean().optional(),
    ...common,
  })
  .strict();

export const CylinderPart = z
  .object({
    type: z.literal('cylinder'),
    from: Vec3,
    to: Vec3,
    radius: z.number().positive(),
    segments: z.number().int().min(3).optional(),
    material: MaterialRef,
    collide: z.boolean().optional(),
    ...common,
  })
  .strict();

export const SpherePart = z
  .object({
    type: z.literal('sphere'),
    center: Vec3,
    radius: z.number().positive(),
    /** Scale along plan axes [x, y, z]. */
    scale: Vec3.optional(),
    segments: z.number().int().min(4).optional(),
    material: MaterialRef,
    ...common,
  })
  .strict();

/** Flat horizontal polygon (floor, slab, threshold). */
export const PolygonPart = z
  .object({
    type: z.literal('polygon'),
    points: z.array(Vec2).min(3),
    z: z.number(),
    facing: z.enum(['up', 'down']).optional(),
    material: MaterialRef,
    ...common,
  })
  .strict();

/** Vertical disc (round mirror, washing-machine door). */
export const DiscPart = z
  .object({
    type: z.literal('disc'),
    center: Vec3,
    radius: z.number().positive(),
    facing: z.enum(['n', 's', 'e', 'w']),
    segments: z.number().int().min(8).optional(),
    material: MaterialRef,
    ...common,
  })
  .strict();

/** Pleated sheer curtain hanging between two plan points. */
export const CurtainPart = z
  .object({
    type: z.literal('curtain'),
    from: Vec2,
    to: Vec2,
    z: Vec2,
    /** Pleat period in cm (default 14) and depth in cm (default 2.5). */
    pleat: z.number().positive().optional(),
    depth: z.number().nonnegative().optional(),
    material: MaterialRef,
    ...common,
  })
  .strict();

/** Identical boxes repeated at plan points (railing balusters). */
export const PostsPart = z
  .object({
    type: z.literal('posts'),
    points: z.array(Vec2).min(1),
    /** Size [x, y, height] in cm. */
    size: Vec3,
    z: z.number(),
    material: MaterialRef,
    ...common,
  })
  .strict();

/** Box stretched along a plan segment (handrail, any angle). */
export const BeamPart = z
  .object({
    type: z.literal('beam'),
    from: Vec2,
    to: Vec2,
    z: Vec2,
    width: z.number().positive(),
    material: MaterialRef,
    /** Blocks the visitor within `width / 2 + 3` cm of the segment. */
    collide: z.boolean().optional(),
    ...common,
  })
  .strict();

/** glTF model, scaled to `fit` and centred on the item origin, resting on z = 0. */
export const ModelPart = z
  .object({
    type: z.literal('model'),
    src: z.string(),
    fit: z
      .object({ w: z.number().optional(), d: z.number().optional(), h: z.number().optional() })
      .strict(),
    /** false: scale each axis independently to match w/d (height uses the mean). */
    uniform: z.boolean().optional(),
    /** Material overrides, first match on mesh/material name wins (`*` matches all). */
    materials: z.array(z.object({ match: z.string(), material: MaterialRef }).strict()).optional(),
    ...common,
  })
  .strict();

/** Point light, only lit in the evening mood. */
export const LightPart = z
  .object({
    type: z.literal('light'),
    at: Vec3,
    color: Hex,
    /** Luminous intensity in candela. */
    intensity: z.number().nonnegative(),
    /** Cut-off distance in cm. */
    distance: z.number().positive(),
    /** Draw a small bulb 4 cm above the light point. */
    bulb: z.boolean().optional(),
    name: z.string().optional(),
  })
  .strict();

export const Part = z.discriminatedUnion('type', [
  BoxPart,
  CylinderPart,
  SpherePart,
  PolygonPart,
  DiscPart,
  CurtainPart,
  PostsPart,
  BeamPart,
  ModelPart,
  LightPart,
]);
export type Part = z.infer<typeof Part>;
export type BoxPart = z.infer<typeof BoxPart>;
export type CylinderPart = z.infer<typeof CylinderPart>;
export type SpherePart = z.infer<typeof SpherePart>;
export type PolygonPart = z.infer<typeof PolygonPart>;
export type DiscPart = z.infer<typeof DiscPart>;
export type CurtainPart = z.infer<typeof CurtainPart>;
export type PostsPart = z.infer<typeof PostsPart>;
export type BeamPart = z.infer<typeof BeamPart>;
export type ModelPart = z.infer<typeof ModelPart>;
export type LightPart = z.infer<typeof LightPart>;

// ---------------------------------------------------------------- items

/** Axis-aligned rectangle [x0, y0, x1, y1] in the item's local frame. */
export const Rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Rect = z.infer<typeof Rect>;

export const Item = z
  .object({
    id: Id,
    name: z.string(),
    /** Room id (informative, used for grouping). */
    room: Id.optional(),
    /** Catalog entry whose parts are used (in addition to `parts`). */
    ref: Id.optional(),
    /** Origin of the local frame, plan cm. Default [0, 0, 0] (parts in absolute coordinates). */
    position: Vec3.optional(),
    /** Degrees, see file header. */
    rotation: z.number().optional(),
    parts: z.array(Part).optional(),
    /** Extra 2D colliders in the local frame. */
    colliders: z.array(Rect).optional(),
  })
  .strict();
export type Item = z.infer<typeof Item>;

export const CatalogEntry = z
  .object({ name: z.string(), parts: z.array(Part).min(1) })
  .strict();
export const Catalog = z.record(Id, CatalogEntry);
export type Catalog = z.infer<typeof Catalog>;

// ---------------------------------------------------------------- building

export const Opening = z
  .object({
    id: Id,
    name: z.string().optional(),
    type: z.enum(['door', 'window', 'french-window', 'bay']),
    /** Distances from wall point `a` along the axis, in cm. */
    from: z.number(),
    to: z.number(),
    /** Sill and head heights, in cm. */
    z: Vec2,
  })
  .strict();
export type Opening = z.infer<typeof Opening>;

export const Wall = z
  .object({
    id: Id,
    name: z.string().optional(),
    /** Axis end points. Faces are at axis ± thickness / 2. */
    a: Vec2,
    b: Vec2,
    thickness: z.number().positive(),
    height: z.number().positive().optional(),
    /** Extension beyond a and b in cm (corner closing). Default 0. */
    extend: z.union([z.number(), Vec2]).optional(),
    /**
     * left/right = face on the left/right when walking from a to b on the plan drawn
     * north-up (walking east, left is north).
     */
    faces: z
      .object({ left: MaterialRef.optional(), right: MaterialRef.optional(), default: MaterialRef.optional() })
      .strict()
      .optional(),
    openings: z.array(Opening).optional(),
  })
  .strict();
export type Wall = z.infer<typeof Wall>;

export const Room = z
  .object({
    id: Id,
    name: z.string(),
    polygon: z.array(Vec2).min(3),
    floor: z.object({ material: MaterialRef, z: z.number().optional() }).strict(),
  })
  .strict();
export type Room = z.infer<typeof Room>;

export const Level = z
  .object({
    id: Id,
    name: z.string(),
    elevation: z.number(),
    height: z.number().positive(),
    walls: z.array(Wall),
    rooms: z.array(Room),
    ceiling: z.object({ polygon: z.array(Vec2).min(3), material: MaterialRef }).strict().optional(),
    /** Existing equipment (as delivered): bathroom, built-ins, windows, doors, terrace… */
    fixtures: z.array(Item),
  })
  .strict();
export type Level = z.infer<typeof Level>;

export const Building = z
  .object({ $schema: z.string().optional(), levels: z.array(Level).min(1) })
  .strict();
export type Building = z.infer<typeof Building>;

// ---------------------------------------------------------------- furnishing

export const Product = z
  .object({
    id: Id,
    label: z.string(),
    details: z.string().optional(),
    qty: z.number().int().positive(),
    room: Id,
    /** Furnishing item ids this product corresponds to. */
    items: z.array(Id).optional(),
    brand: z.string().optional(),
    url: z.url().optional(),
    /** Reference unit price in euros (user-entered prices override it). */
    price: z.number().nonnegative().optional(),
  })
  .strict();
export type Product = z.infer<typeof Product>;

export const Variant = z
  .object({
    id: Id,
    name: z.string(),
    items: z.array(Item),
    products: z.array(Product),
  })
  .strict();
export type Variant = z.infer<typeof Variant>;

export const Furnishing = z
  .object({
    $schema: z.string().optional(),
    /** Items shared by every variant. */
    common: z.object({ items: z.array(Item), products: z.array(Product) }).strict(),
    variants: z.array(Variant).min(1),
    defaultVariant: Id,
  })
  .strict();
export type Furnishing = z.infer<typeof Furnishing>;

// ---------------------------------------------------------------- project

export const ProjectMeta = z
  .object({
    $schema: z.string().optional(),
    id: Id,
    name: z.string(),
    subtitle: z.string(),
    credits: z.string(),
    /** Visitor spawn point (plan cm) and yaw in degrees (0 = north, 180 = south). */
    start: z.object({ x: z.number(), y: z.number(), yaw: z.number() }).strict(),
    eyeHeight: z.number().positive(),
    /** Walkable bounds [x0, y0, x1, y1]. */
    bounds: Rect,
    overview: z
      .object({
        target: Vec3,
        distance: z.number().positive(),
        /** Orbit angles in degrees. */
        azimuth: z.number(),
        polar: z.number(),
      })
      .strict(),
    environment: z
      .object({
        hdri: z.string(),
        background: z.object({ day: z.string(), night: z.string() }).strict(),
        sun: z.object({ from: Vec3, to: Vec3 }).strict(),
        /** Simple procedural neighbourhood (ground, blocks, trees). */
        surroundings: z.object({ seed: z.number().int(), center: Vec2, groundZ: z.number() }).strict(),
      })
      .strict(),
    files: z
      .object({
        building: z.string(),
        furnishing: z.string(),
        materials: z.string(),
        catalog: z.string(),
      })
      .strict(),
  })
  .strict();
export type ProjectMeta = z.infer<typeof ProjectMeta>;

export const ProjectIndex = z.array(
  z.object({ id: Id, name: z.string(), subtitle: z.string() }).strict(),
);
export type ProjectIndex = z.infer<typeof ProjectIndex>;

/** A project with all its files loaded and validated. */
export interface Project {
  meta: ProjectMeta;
  building: Building;
  furnishing: Furnishing;
  materials: MaterialLibrary;
  catalog: Catalog;
}
