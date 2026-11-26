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
    /** Multiplies `color`, may exceed 1 (brightens a photo texture that is too dark). */
    colorScale: z.number().positive().optional(),
    /** Procedural colour texture repeated every `tile` cm (UVs are generated in cm). */
    texture: z
      .object({ procedural: z.enum(PROCEDURAL_TEXTURES), tile: Vec2 })
      .strict()
      .optional(),
    /**
     * Image maps (paths relative to the project folder) repeated every `tile` cm.
     * `color` replaces the procedural texture; `normal` is OpenGL-style; `arm` packs
     * ambient occlusion (R), roughness (G) and metalness (B). With `arm`, `roughness`
     * multiplies the map (default 1).
     */
    maps: z
      .object({
        tile: Vec2,
        /** Degrees, rotates the maps on the surface (e.g. 90 to turn planks). */
        rotation: z.number().optional(),
        color: z.string().optional(),
        normal: z.string().optional(),
        normalScale: z.number().optional(),
        arm: z.string().optional(),
        /** Strength of the occlusion baked in `arm` (default 1; 0 for flat painted walls). */
        aoIntensity: z.number().min(0).optional(),
      })
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

/** Vertical prism: a plan polygon extruded between two heights (curved curb, site blocks). */
export const PrismPart = z
  .object({
    type: z.literal('prism'),
    points: z.array(Vec2).min(3),
    z: Vec2,
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
  PrismPart,
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
export type PrismPart = z.infer<typeof PrismPart>;
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

/** Hinged leaf filling an opening; the visitor can open and close it. */
export const DoorLeaf = z
  .object({
    /** Jamb carrying the hinges: `start` = the one closest to wall point a. */
    hinge: z.enum(['start', 'end']),
    /** Side of the wall the leaf swings into (same left/right convention as wall faces). */
    side: z.enum(['left', 'right']),
    material: MaterialRef,
    /** Per-face finish when the two faces differ (wall convention: left/right of a→b, door closed). */
    faces: z.object({ left: MaterialRef.optional(), right: MaterialRef.optional() }).strict().optional(),
    /** Lever handles on both faces. */
    handle: MaterialRef.optional(),
    /** Leaf thickness in cm (default 4). */
    thickness: z.number().positive().optional(),
    /** Maximum opening angle in degrees (default 90). */
    angle: z.number().positive().max(180).optional(),
    /** Initial state (default open). */
    open: z.boolean().optional(),
  })
  .strict();
export type DoorLeaf = z.infer<typeof DoorLeaf>;

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
    door: DoorLeaf.optional(),
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

const CeilingPlane = z.object({ polygon: z.array(Vec2).min(3), material: MaterialRef }).strict();

export const Level = z
  .object({
    id: Id,
    name: z.string(),
    elevation: z.number(),
    height: z.number().positive(),
    walls: z.array(Wall),
    rooms: z.array(Room),
    /** Ceiling(s) at elevation + height; hidden in overview. */
    ceiling: z.union([CeilingPlane, z.array(CeilingPlane)]).optional(),
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

// ---------------------------------------------------------------- technical specification

/**
 * Technical specification ("fiche technique") in the spirit of an architect's documents:
 * room finish schedule, door/window schedule, equipment per trade, site data. Each entry
 * says where the information comes from and how sure it is. IFC equivalents: spaces ↔
 * IfcSpace, finishes ↔ IfcCovering, openings ↔ IfcDoor/IfcWindow, equipment ↔ IfcElement.
 * Source documents themselves may be private: only their technical content is copied here.
 */
export const SpecStatus = z.enum([
  /** Contractual document (notice, sales plan): what was promised. */
  'contrat',
  /** Measured or checked on site. */
  'releve',
  /** Seen on delivery photos. */
  'photo',
  /** Assumption, to be checked. */
  'hypothese',
]);

/** Trades, after the usual French "lots" of a building specification (CCTP). */
export const SpecLot = z.enum([
  'gros-oeuvre', 'facades', 'menuiseries-exterieures', 'menuiseries-interieures', 'serrurerie',
  'sols', 'revetements-muraux', 'peinture', 'plomberie-sanitaires', 'chauffage-ventilation',
  'electricite', 'courants-faibles', 'amenagement', 'parties-communes', 'espaces-exterieurs',
]);

const SpecSourceRef = z
  .object({ doc: Id, page: z.number().int().positive().optional(), note: z.string().optional() })
  .strict();

const specFields = {
  /** Plain description, as an architect would write it in a schedule. */
  description: z.string(),
  /** Brand and reference ("Malerba MBS024"), "ou équivalent" implied for contract items. */
  product: z.string().optional(),
  /** Dimensions in free form ("80 × 120 cm", "h 2,14 m"). */
  size: z.string().optional(),
  finish: z.string().optional(),
  /** 3D material used for it in the model. */
  material: MaterialRef.optional(),
  /** 3D items (building fixtures or furnishing) that represent it. */
  items: z.array(Id).optional(),
  status: SpecStatus,
  sources: z.array(SpecSourceRef).optional(),
  /** Open question or discrepancy to resolve. */
  todo: z.string().optional(),
};
export const SpecEntry = z.object(specFields).strict();
export type SpecEntry = z.infer<typeof SpecEntry>;

export const SpecEquipment = z
  .object({ id: Id, label: z.string(), lot: SpecLot, qty: z.number().int().positive().optional(), ...specFields })
  .strict();
export type SpecEquipment = z.infer<typeof SpecEquipment>;

export const Spec = z
  .object({
    $schema: z.string().optional(),
    sources: z
      .array(
        z
          .object({
            id: Id,
            title: z.string(),
            kind: z.enum(['notice', 'plan', 'contrat', 'photos', 'releve', 'autre']),
            date: z.string().optional(),
            /** Kept outside the repository (personal data). */
            private: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
    site: z.array(z.object({ id: Id, label: z.string(), ...specFields }).strict()),
    /** Room finish schedule + equipment, one entry per room of the building. */
    spaces: z.array(
      z
        .object({
          room: Id,
          /** Area in m² from the sales plan. */
          area: z.number().positive().optional(),
          height: z.number().positive().optional(),
          finishes: z
            .object({ floor: SpecEntry.optional(), skirting: SpecEntry.optional(), walls: SpecEntry.optional(), ceiling: SpecEntry.optional() })
            .strict(),
          equipment: z.array(SpecEquipment),
        })
        .strict(),
    ),
    /** Door and window schedule, keyed by the opening ids of the building. */
    openings: z.array(
      z
        .object({
          opening: Id,
          kind: z.enum(['porte-paliere', 'porte', 'porte-fenetre', 'baie', 'fenetre']),
          hardware: z.string().optional(),
          ...specFields,
        })
        .strict(),
    ),
    /** Building-wide systems (heating, hot water, ventilation, power, telecom). */
    systems: z.array(SpecEquipment),
  })
  .strict();
export type Spec = z.infer<typeof Spec>;

// ---------------------------------------------------------------- project

/** Neighbourhood around the apartment (plan cm, heights relative to the apartment floor). */
export const Surroundings = z
  .object({
    /** Street/garden level. */
    groundZ: z.number(),
    groundColor: z.string().optional(),
    /** Flat areas on the ground (roads, pavements, lawns), drawn in order. */
    surfaces: z.array(z.object({ name: z.string().optional(), polygon: z.array(Vec2).min(3), color: z.string() }).strict()).optional(),
    /** Building volumes. `facade` draws a storey/window pattern; `overview: false` hides it in the overview. */
    blocks: z
      .array(
        z
          .object({
            name: z.string().optional(),
            polygon: z.array(Vec2).min(3),
            z: Vec2,
            color: z.string().optional(),
            facade: z.boolean().optional(),
            overview: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    /**
     * Balcony edges: a curb (h `curb`, 12 cm wide) topped by a barred railing up to `height`,
     * following `path` at floor level `z`.
     */
    railings: z
      .array(
        z
          .object({
            name: z.string().optional(),
            path: z.array(Vec2).min(2),
            z: z.number(),
            curb: z.number().nonnegative().optional(),
            height: z.number().positive().optional(),
            color: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    /** Trees standing on the ground; rows are expanded every `spacing` cm from `from` to `to`. */
    trees: z.array(z.object({ at: Vec2, height: z.number().positive().optional() }).strict()).optional(),
    treeRows: z.array(z.object({ from: Vec2, to: Vec2, spacing: z.number().positive(), height: z.number().positive().optional() }).strict()).optional(),
    /** Generic city blocks in a ring around the site (horizon). */
    distant: z.object({ seed: z.number().int(), center: Vec2, minDistance: z.number(), maxDistance: z.number(), count: z.number().int() }).strict().optional(),
  })
  .strict();
export type Surroundings = z.infer<typeof Surroundings>;

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
        /**
         * Sky seen through the windows, per mood: equirectangular image, brightness and
         * rotation in degrees (to put the sun of the photo on the side of the scene sun).
         */
        background: z
          .object({
            day: z.object({ src: z.string(), intensity: z.number().positive().optional(), rotation: z.number().optional() }).strict(),
            night: z.object({ src: z.string(), intensity: z.number().positive().optional(), rotation: z.number().optional() }).strict(),
          })
          .strict(),
        /**
         * True bearing (degrees clockwise from north) of the plan's -Y axis ("plan north").
         * Used to place the sun from a real azimuth.
         */
        north: z.number(),
        /** Sun direction: true azimuth (degrees from north, clockwise) and elevation (degrees). */
        sun: z.object({ azimuth: z.number(), elevation: z.number().min(1).max(90) }).strict(),
        surroundings: Surroundings,
      })
      .strict(),
    files: z
      .object({
        building: z.string(),
        furnishing: z.string(),
        materials: z.string(),
        catalog: z.string(),
        /** Optional technical specification (finish/door schedules, equipment, sources). */
        spec: z.string().optional(),
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
  spec?: Spec;
}
