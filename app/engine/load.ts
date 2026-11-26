import { z } from 'zod';
import {
  Building, Catalog, Furnishing, MaterialLibrary, ProjectMeta, Spec, type Project, type SpecEntry,
} from './schema';

export type ReadJson = (path: string) => Promise<unknown>;

function parse<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`${file} invalide :\n${z.prettifyError(r.error)}`);
  return r.data;
}

/** Loads and validates a project; `read` resolves paths relative to the project folder. */
export async function loadProject(read: ReadJson): Promise<Project> {
  const meta = parse(ProjectMeta, await read('project.json'), 'project.json');
  const f = meta.files;
  const [b, fu, m, c] = await Promise.all([read(f.building), read(f.furnishing), read(f.materials), read(f.catalog)]);
  const project: Project = {
    meta,
    building: parse(Building, b, f.building),
    furnishing: parse(Furnishing, fu, f.furnishing),
    materials: parse(MaterialLibrary, m, f.materials),
    catalog: parse(Catalog, c, f.catalog),
  };
  if (f.spec) project.spec = parse(Spec, await read(f.spec), f.spec);
  const errors = checkReferences(project);
  if (errors.length) throw new Error(`Références invalides :\n${errors.join('\n')}`);
  return project;
}

/** Cross-file checks zod cannot express: material, catalog, room, item and variant ids. */
export function checkReferences(p: Project): string[] {
  const errors: string[] = [];
  const mat = (ref: unknown, where: string) => {
    if (typeof ref === 'string') { if (!(ref in p.materials)) errors.push(`${where}: matériau inconnu "${ref}"`); }
    else if (ref && typeof ref === 'object') Object.values(ref).forEach((r) => mat(r, where));
  };
  const rooms = new Set(p.building.levels.flatMap((l) => l.rooms.map((r) => r.id)));
  const ids = new Set<string>();
  const items = (list: Project['building']['levels'][number]['fixtures'], where: string) => {
    for (const it of list) {
      if (ids.has(it.id)) errors.push(`${where}: id d’item en double "${it.id}"`);
      ids.add(it.id);
      if (it.ref && !(it.ref in p.catalog)) errors.push(`${where}/${it.id}: entrée de catalogue inconnue "${it.ref}"`);
      if (it.room && !rooms.has(it.room)) errors.push(`${where}/${it.id}: pièce inconnue "${it.room}"`);
      for (const part of it.parts ?? []) {
        if ('material' in part) mat(part.material, `${where}/${it.id}`);
        if (part.type === 'model') part.materials?.forEach((r) => mat(r.material, `${where}/${it.id}`));
      }
    }
  };
  if (!('bulb' in p.materials)) errors.push('materials: le matériau "bulb" est requis (ampoules)');
  const usesDevices = [...p.building.levels.flatMap((l) => l.fixtures), ...p.furnishing.common.items].some((it) => it.parts?.some((pt) => pt.type === 'device'));
  if (usesDevices) for (const m of ['white', 'black', 'chrome', 'black-glass']) if (!(m in p.materials)) errors.push(`materials: "${m}" est requis par les équipements (device)`);
  for (const l of p.building.levels) {
    for (const w of l.walls) {
      mat(w.faces, `walls/${w.id}`);
      for (const o of w.openings ?? []) {
        if (!o.door) continue;
        mat(o.door.material, `walls/${w.id}/${o.id}`);
        if (o.door.faces) mat(o.door.faces, `walls/${w.id}/${o.id}`);
        if (o.door.handle) mat(o.door.handle, `walls/${w.id}/${o.id}`);
      }
    }
    for (const r of l.rooms) mat(r.floor.material, `rooms/${r.id}`);
    for (const c of l.ceiling ? (Array.isArray(l.ceiling) ? l.ceiling : [l.ceiling]) : []) mat(c.material, 'ceiling');
    items(l.fixtures, 'fixtures');
  }
  for (const [id, e] of Object.entries(p.catalog)) for (const part of e.parts) if ('material' in part) mat(part.material, `catalog/${id}`);
  items(p.furnishing.common.items, 'common');
  const variantIds = new Set<string>();
  for (const v of p.furnishing.variants) {
    variantIds.add(v.id);
    items(v.items, `variants/${v.id}`);
  }
  if (!variantIds.has(p.furnishing.defaultVariant)) errors.push(`defaultVariant inconnue "${p.furnishing.defaultVariant}"`);
  const productIds = new Set<string>();
  for (const pr of [...p.furnishing.common.products, ...p.furnishing.variants.flatMap((v) => v.products)]) {
    if (productIds.has(pr.id)) errors.push(`produit en double "${pr.id}"`);
    productIds.add(pr.id);
    if (!rooms.has(pr.room)) errors.push(`produit ${pr.id}: pièce inconnue "${pr.room}"`);
    for (const i of pr.items ?? []) if (!ids.has(i)) errors.push(`produit ${pr.id}: item inconnu "${i}"`);
  }
  if (p.spec) errors.push(...checkSpec(p, rooms, ids, mat));
  return errors;
}

/** Spec ↔ model links: rooms, openings, items, materials and source documents must exist. */
function checkSpec(p: Project, rooms: Set<string>, items: Set<string>, mat: (ref: unknown, where: string) => void): string[] {
  const spec = p.spec!;
  const errors: string[] = [];
  const docs = new Set(spec.sources.map((s) => s.id));
  const openings = new Set(p.building.levels.flatMap((l) => l.walls.flatMap((w) => (w.openings ?? []).map((o) => o.id))));
  const entry = (e: SpecEntry, where: string) => {
    for (const s of e.sources ?? []) if (!docs.has(s.doc)) errors.push(`spec ${where}: source inconnue "${s.doc}"`);
    for (const i of e.items ?? []) if (!items.has(i)) errors.push(`spec ${where}: item inconnu "${i}"`);
    if (e.material) mat(e.material, `spec ${where}`);
  };
  const seen = new Set<string>();
  for (const s of spec.spaces) {
    if (!rooms.has(s.room)) errors.push(`spec: pièce inconnue "${s.room}"`);
    if (seen.has(s.room)) errors.push(`spec: pièce en double "${s.room}"`);
    seen.add(s.room);
    for (const [k, e] of Object.entries(s.finishes)) if (e) entry(e, `${s.room}/${k}`);
    for (const e of s.equipment) entry(e, `${s.room}/${e.id}`);
  }
  for (const o of spec.openings) {
    if (!openings.has(o.opening)) errors.push(`spec: ouverture inconnue "${o.opening}"`);
    entry(o, o.opening);
  }
  for (const e of [...spec.site, ...spec.systems]) entry(e, e.id);
  return errors;
}
