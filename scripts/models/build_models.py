"""
Custom 3D models for Pantoufle, built procedurally in Blender (bpy) at real dimensions and
exported as GLB into public/projects/<project>/models/custom/.

Run from Blender (Scripting tab, the MCP, or `blender -b -P scripts/models/build_models.py`):
    build_all()            # every model
    build('stool_oak')     # one model

Conventions: 1 Blender unit = 1 m, model front facing −Y (it ends up facing +Y / south on the
plan at rotation 0), base on z = 0. Material names are semantic (oak, linen, ceramic, chrome…):
the project maps them to its own materials with `materials: [{ match, material }]`.
Works in a dedicated scene `pantoufle_models`, never in the user's scenes.
"""
import math
import os

import bmesh
import bpy

REPO = '/Users/thomasbernard/dev/pantoufle'
OUT = os.path.join(REPO, 'public', 'projects', 'arboreal-143', 'models', 'custom')
CM = 0.01

# Semantic materials (base colours only: the viewer replaces them with the project's).
PALETTE = {
    'oak': (0.80, 0.70, 0.55, 0.55), 'linen': (0.88, 0.85, 0.78, 0.9), 'paper': (0.96, 0.94, 0.89, 0.85),
    'ceramic': (0.96, 0.96, 0.95, 0.15), 'chrome': (0.85, 0.85, 0.87, 0.08), 'black': (0.06, 0.06, 0.06, 0.5),
    'white': (0.95, 0.95, 0.94, 0.4), 'dark-oak': (0.35, 0.26, 0.19, 0.6), 'mattress': (0.95, 0.95, 0.93, 0.9),
    'duvet': (0.93, 0.91, 0.86, 0.95), 'cushion': (0.78, 0.72, 0.63, 0.95), 'steel': (0.7, 0.71, 0.72, 0.3),
    'sofa': (0.36, 0.35, 0.22, 1.0), 'black-basin': (0.94, 0.94, 0.93, 0.15), 'headboard': (0.80, 0.75, 0.66, 0.95), 'throw': (0.55, 0.47, 0.38, 0.95),
}


# ------------------------------------------------------------------ helpers

SCN = None  # the dedicated scene; objects are linked here explicitly (bpy.context.scene may lag)


def scene():
    """Headless runs (blender -b --factory-startup) use the throw-away default scene; an interactive
    session gets a dedicated scene so the user's work is never touched."""
    global SCN
    if bpy.app.background:
        SCN = bpy.context.scene
    else:
        SCN = bpy.data.scenes.get('pantoufle_models') or bpy.data.scenes.new('pantoufle_models')
    return SCN


def clear(scn):
    for o in list(scn.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def mat(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        r, g, b, rough = PALETTE.get(name, (0.8, 0.8, 0.8, 0.5))
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (r, g, b, 1)
        bsdf.inputs['Roughness'].default_value = rough
        if name in ('chrome', 'steel'):
            bsdf.inputs['Metallic'].default_value = 1.0
    return m


def link(obj, material):
    SCN.collection.objects.link(obj)
    obj.data.materials.append(mat(material))
    return obj


def mesh_obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me), material)


def box(name, size, loc, material, bevel=0.0, segments=3):
    """Box of size (x, y, z) in cm, centred at loc (cm), optionally bevelled."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(size[0] * CM, size[1] * CM, size[2] * CM), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(loc[0] * CM, loc[1] * CM, loc[2] * CM), verts=bm.verts)
    o = mesh_obj(name, bm, material)
    if bevel:
        md = o.modifiers.new('bevel', 'BEVEL')
        md.width = bevel * CM
        md.segments = segments
        md.limit_method = 'ANGLE'
    smooth(o)
    return o


def cylinder(name, r, h, loc, material, r2=None, segments=32, bevel=0.0):
    """Vertical cylinder (cm), base at loc[2]; r2 = top radius (taper)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r * CM, radius2=(r2 if r2 is not None else r) * CM, depth=h * CM)
    bmesh.ops.translate(bm, vec=(loc[0] * CM, loc[1] * CM, (loc[2] + h / 2) * CM), verts=bm.verts)
    o = mesh_obj(name, bm, material)
    if bevel:
        md = o.modifiers.new('bevel', 'BEVEL')
        md.width = bevel * CM
        md.segments = 3
        md.limit_method = 'ANGLE'
    smooth(o)
    return o


def lathe(name, profile, material, segments=48):
    """Revolve a (radius, z) profile in cm around Z."""
    bm = bmesh.new()
    verts = [bm.verts.new((r * CM, 0, z * CM)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=segments, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    o = mesh_obj(name, bm, material)
    smooth(o)
    return o


def tube(name, points, r, material, segments=16):
    """Round tube along a polyline of (x, y, z) cm points (bevelled curve converted to mesh)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r * CM
    cu.bevel_resolution = max(2, segments // 4)
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, (x, y, z) in zip(sp.points, points):
        p.co = (x * CM, y * CM, z * CM, 1)
    o = bpy.data.objects.new(name, cu)
    SCN.collection.objects.link(o)
    o.data.materials.append(mat(material))
    return o


def smooth(o):
    if o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = True
        o.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True


def apply_modifiers(o):
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


def cut(target, cutter):
    """Boolean difference target − cutter (modifiers applied first); the cutter is deleted."""
    apply_modifiers(target)
    apply_modifiers(cutter)
    md = target.modifiers.new('cut', 'BOOLEAN')
    md.operation = 'DIFFERENCE'
    md.object = cutter
    md.solver = 'EXACT'
    apply_modifiers(target)
    bpy.data.objects.remove(cutter, do_unlink=True)
    smooth(target)
    return target


def tub(name, size, loc, material, wall=1.5, bevel=5.0):
    """Open-top box (no boolean): rounded inside, `wall` cm thick, top at loc[2] + size[2] / 2."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(size[0] * CM, size[1] * CM, size[2] * CM), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(loc[0] * CM, loc[1] * CM, loc[2] * CM), verts=bm.verts)
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=top, context='FACES_ONLY')
    bmesh.ops.reverse_faces(bm, faces=bm.faces)  # normals into the cavity: the inside is the visible side
    o = mesh_obj(name, bm, material)
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width = bevel * CM
    bv.segments = 6
    bv.limit_method = 'ANGLE'
    so = o.modifiers.new('solid', 'SOLIDIFY')
    so.thickness = wall * CM
    so.offset = -1.0  # grows against the (inward) normals, i.e. outwards: the inside keeps its shape
    smooth(o)
    return o


def ellipsoid(name, radii, loc, material='white'):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
    bmesh.ops.scale(bm, vec=(radii[0] * CM, radii[1] * CM, radii[2] * CM), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(loc[0] * CM, loc[1] * CM, loc[2] * CM), verts=bm.verts)
    return mesh_obj(name, bm, material)


def export(name):
    """Exports every object of the scene as one GLB (modifiers applied)."""
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.glb')
    if bpy.context.scene != SCN:
        raise RuntimeError('export: switch the window to the pantoufle_models scene first (or run headless)')
    for o in list(SCN.objects):
        if o.type == 'CURVE':  # tubes → meshes
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
                bpy.ops.object.convert(target='MESH')
    for o in SCN.objects:
        if o.type == 'MESH':
            keep_wn = any(m.type == 'WEIGHTED_NORMAL' for m in o.modifiers)
            apply_modifiers(o)
            cm_uvs(o)
            if keep_wn:
                o.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True
    for o in SCN.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_materials='EXPORT', export_texcoords=True, export_normals=True)
    return path


def cm_uvs(o):
    """Box-projected UVs in centimetres (world space), the viewer's convention: a project material
    repeats every `tile` cm on models exactly as on walls and floors."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uv = bm.loops.layers.uv.verify()
    mw = o.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for f in bm.faces:
        n = (nm @ f.normal)
        ax = max(range(3), key=lambda k: abs(n[k]))
        u_ax, v_ax = {0: (1, 2), 1: (0, 2), 2: (0, 1)}[ax]
        for loop in f.loops:
            co = mw @ loop.vert.co
            loop[uv].uv = (co[u_ax] * 100, co[v_ax] * 100)
    bm.to_mesh(o.data)
    bm.free()


# ------------------------------------------------------------------ models

def stool_oak():
    """Bar stool, seat height 65: round solid-oak seat Ø 35, four splayed legs, footrest ring."""
    seat_h, r_seat = 65, 17.5
    cylinder('seat', r_seat, 3.2, (0, 0, seat_h - 3.2), 'oak', segments=64, bevel=0.9)
    splay = math.radians(7)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        top = (math.cos(a) * 10.5, math.sin(a) * 10.5, seat_h - 3.2)
        dx = math.cos(a) * math.tan(splay) * (seat_h - 3.2)
        dy = math.sin(a) * math.tan(splay) * (seat_h - 3.2)
        tube(f'leg{k}', [(top[0] + dx, top[1] + dy, 0), top], 1.6, 'oak', segments=16)
    ring_r = 10.5 + math.tan(splay) * (seat_h - 3.2 - 24)
    pts = [(math.cos(t) * ring_r, math.sin(t) * ring_r, 24) for t in [i * 2 * math.pi / 48 for i in range(49)]]
    tube('footrest', pts, 1.0, 'oak')


def _globe_radius(R, H, z):
    t = math.asin(max(-1.0, min(1.0, (z - H / 2) / (H / 2))))
    return R * math.cos(t) ** 0.85


def paper_lantern(cord=51.6):
    """Akari-style paper pendant Ø 45 × 38: paper globe with bamboo rib rings every ~3 cm, black
    fittings, cord so that the total height fits under the ceiling (bar: 158 → 250 cm)."""
    R, H = 22.5, 38
    prof = [(max(5.0, _globe_radius(R, H, H * i / 40)), H * i / 40) for i in range(41)]
    lathe('globe', prof, 'paper', segments=64)
    z = 3.0
    while z < H - 3:
        r = _globe_radius(R, H, z) - 0.05
        pts = [(math.cos(a) * r, math.sin(a) * r, z) for a in [i * 2 * math.pi / 64 for i in range(65)]]
        tube(f'rib{int(z)}', pts, 0.12, 'paper', segments=6)
        z += 3.0
    cylinder('cap', 3.2, 2.4, (0, 0, H - 0.6), 'black')
    cylinder('cord', 0.3, cord, (0, 0, H + 1.8), 'black', segments=12)


def floor_lamp_paper():
    """Floor lamp: ribbed paper column Ø 30 × 105 on a slender oak tripod (total 150 cm)."""
    R, z0, h = 15, 42, 105
    lathe('shade', [(R * 0.92, z0), (R, z0 + 4), (R, z0 + h - 4), (R * 0.92, z0 + h)], 'paper', segments=64)
    z = z0 + 4
    while z < z0 + h - 3:
        pts = [(math.cos(a) * (R + 0.12), math.sin(a) * (R + 0.12), z) for a in [i * 2 * math.pi / 64 for i in range(65)]]
        tube(f'rib{int(z)}', pts, 0.2, 'paper', segments=8)
        z += 3.5
    for k in range(3):
        a = math.radians(90 + 120 * k)
        tube(f'leg{k}', [(math.cos(a) * 22, math.sin(a) * 22, 0), (math.cos(a) * 9, math.sin(a) * 9, z0 + 10)], 1.2, 'oak', segments=12)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        tube(f'brace{k}', [(math.cos(a) * 13, math.sin(a) * 13, z0 - 6), (0, 0, z0 - 6)], 0.6, 'oak', segments=8)


def coffee_table():
    """Coffee table 110 × 58 × 35 in solid oak: 4 cm top with soft edges, square legs, low slatted shelf."""
    L, W, H, T = 110, 58, 35, 4
    box('top', (L, W, T), (0, 0, H - T / 2), 'oak', bevel=1.2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f'leg{sx}{sy}', (5.5, 5.5, H - T), (sx * (L / 2 - 7), sy * (W / 2 - 7), (H - T) / 2), 'oak', bevel=0.5)
    for k in range(7):
        box(f'slat{k}', (L - 20, 4.6, 1.8), (0, -W / 2 + 10 + k * 6.3, 8), 'oak', bevel=0.3)
    for sx in (-1, 1):
        box(f'rail{sx}', (3, W - 14, 3), (sx * (L / 2 - 7), 0, 6.4), 'oak', bevel=0.3)


def sofa_foam():
    """Compressed-foam sofa (the kind delivered rolled up and unfolding in two): low, thick blocks with
    very rounded edges, no visible legs. 200 × 88 × 68 cm, khaki fabric."""
    W, D = 200, 88
    box('base', (W, D, 38), (0, 0, 19), 'sofa', bevel=9, segments=6)
    box('seat-l', (W / 2 - 23, D - 26, 13), (-(W / 4 - 5.75) + 0.5, -6, 43), 'sofa', bevel=6, segments=6)
    box('seat-r', (W / 2 - 23, D - 26, 13), ((W / 4 - 5.75) - 0.5, -6, 43), 'sofa', bevel=6, segments=6)
    box('back', (W - 44, 24, 36), (0, D / 2 - 14, 52), 'sofa', bevel=9, segments=6)
    for sx in (-1, 1):
        box(f'arm{sx}', (22, D, 56), (sx * (W / 2 - 11), 0, 28), 'sofa', bevel=10, segments=6)


def bed_140():
    """Bed 140 × 200: low oak platform, linen headboard in three padded channels, rounded mattress,
    duvet draped over the sides with soft folds, two pillows, throw at the foot."""
    import random
    rnd = random.Random(7)
    box('platform', (150, 210, 22), (0, 0, 11), 'oak', bevel=1.5)
    for k in range(3):
        box(f'headboard{k}', (49, 9, 92), (-50 + 50 * k, 105 - 4.5, 52), 'headboard', bevel=4, segments=5)
    box('mattress', (140, 200, 21), (0, -2, 32.5), 'mattress', bevel=4, segments=5)
    # Duvet: a grid laid on the mattress, folded down over the sides and the foot, with gentle waves.
    bm = bmesh.new()
    nx, ny, w, l = 40, 44, 168, 158
    grid = [[None] * (ny + 1) for _ in range(nx + 1)]
    top = 44.5
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = -w / 2 + w * i / nx
            y = -100 - 8 + l * j / ny  # from the foot (y = −108) to ~2/3 of the bed
            z = top + 0.8 * math.sin(i * 0.9) * math.sin(j * 0.7)
            over = abs(x) - 70
            if over > 0:  # fold down over the long sides
                x = math.copysign(70 + 2.0 * min(over, 4) + 0.4 * max(0, over - 4), x)
                z = top - over * 1.15 + 0.6 * math.sin(j * 1.3 + i)
            if y < -102:  # and over the foot
                d = -102 - y
                y = -102 - 2 + 0 * d
                z = min(z, top - d * 1.2)
            grid[i][j] = bm.verts.new(((x + rnd.uniform(-0.2, 0.2)) * CM, y * CM, z * CM))
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    duvet = mesh_obj('duvet', bm, 'duvet')
    duvet.modifiers.new('solid', 'SOLIDIFY').thickness = 3.5 * CM
    duvet.modifiers.new('subsurf', 'SUBSURF').levels = 1
    smooth(duvet)
    # turned-down top hem
    box('hem', (150, 22, 4), (0, 58, 47), 'duvet', bevel=1.8, segments=4)
    for sx in (-1, 1):
        p = box(f'pillow{sx}', (60, 38, 15), (sx * 33, 82, 50), 'cushion', bevel=7, segments=6)
        p.rotation_euler = (math.radians(-12), 0, math.radians(sx * 2))
    box('throw', (146, 34, 1.4), (0, -82, 48.2), 'throw', bevel=0.6, segments=3)


def round_table():
    """Round oak dining table Ø 100, h 75: 3 cm top, four slender legs joined by a cross."""
    cylinder('top', 50, 3, (0, 0, 72), 'oak', segments=96, bevel=0.8)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        tube(f'leg{k}', [(math.cos(a) * 32, math.sin(a) * 32, 0), (math.cos(a) * 30, math.sin(a) * 30, 72)], 2.2, 'oak', segments=16)
    lathe('apron', [(40, 64), (40.5, 64), (40.5, 71.8), (40, 71.8)], 'oak', segments=96)


def chair_black():
    """Black wooden dining chair: seat 44 × 42 at 45 cm, tapered legs, curved back rail."""
    box('seat', (44, 42, 3.5), (0, 0, 43.25), 'black', bevel=0.8)
    for sx in (-1, 1):
        for sy in (-1, 1):
            top = (sx * 18, sy * 16, 41.5)
            tube(f'leg{sx}{sy}', [(sx * 19.5, sy * 17.5, 0), top], 1.5, 'black', segments=12)
    for sx in (-1, 1):
        tube(f'post{sx}', [(sx * 18, 16, 45), (sx * 18.5, 19, 80)], 1.3, 'black', segments=12)
    pts = [(math.sin(t) * 19, 19 + (1 - math.cos(t)) * -3 + 3, 76) for t in [math.radians(-75 + 150 * i / 20) for i in range(21)]]
    tube('back', pts, 2.6, 'black', segments=12)


def wc_okyris():
    """Wall-hung WC (Ideal Standard Okyris-like): soft rectangular bowl 36 × 52, rim at 40 cm (relative
    z: the item is placed at the floor), slim seat, lid raised against the wall as on the photos."""
    import mathutils
    bm = bmesh.new()
    prof = []
    for i in range(13):  # bowl outer shell, tapering towards the floor
        t = i / 12
        prof.append(t)
    rows = []
    for t in prof:
        z = 26 + 14 * t  # 26 → 40 cm
        w = 26 + 10 * math.sin(t * math.pi / 2)  # width 26 → 36
        d = 46 + 6 * math.sin(t * math.pi / 2)  # depth 46 → 52
        ring = []
        for k in range(48):
            a = 2 * math.pi * k / 48
            # superellipse (squarish) in plan, back edge at the wall (y = 0), front at −d
            cx, cy = math.cos(a), math.sin(a)
            n = 4.0
            sx = math.copysign(abs(cx) ** (2 / n), cx) * w / 2
            sy = math.copysign(abs(cy) ** (2 / n), cy) * d / 2 - d / 2
            ring.append(bm.verts.new((sx * CM, sy * CM, z * CM)))
        rows.append(ring)
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(48):
            bm.faces.new((r0[k], r0[(k + 1) % 48], r1[(k + 1) % 48], r1[k]))
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[-1])
    bowl = mesh_obj('bowl', bm, 'ceramic')
    bowl.modifiers.new('sub', 'SUBSURF').levels = 2
    smooth(bowl)
    cut(bowl, ellipsoid('cavity', (12, 16.5, 13), (0, -26, 40.5), 'ceramic'))
    seat = box('seat', (36, 46, 2.2), (0, -24.5, 41.2), 'ceramic', bevel=1.0)
    cut(seat, box('seat-hole', (23, 29, 4), (0, -26, 41.2), 'ceramic', bevel=8, segments=6))
    lid = box('lid', (36, 44, 2.0), (0, -1.5, 63.5), 'ceramic', bevel=0.9)
    lid.rotation_euler = (math.radians(-88), 0, 0)
    smooth(lid)


def mixer_basin():
    """Basin mixer (Grohe Eurosmart-like): Ø 4.6 body, horizontal spout, flat lever on top."""
    cylinder('body', 2.3, 15, (0, 0, 0), 'chrome', segments=32, bevel=0.3)
    tube('spout', [(0, -1.5, 12.5), (0, -11, 12.5)], 1.1, 'chrome', segments=16)
    cylinder('aerator', 1.15, 0.8, (0, -11, 11.4), 'chrome', segments=24)
    box('lever', (2.2, 10, 0.9), (0, 3, 15.6), 'chrome', bevel=0.3)


def vanity_horizon80():
    """Vanity unit (Culina Horizon 80-like), wall hung: two drawers with a top grip groove in dark
    oak, ceramic top 80 × 46 with an integrated rectangular basin, mixer."""
    W, D, top = 80, 45, 85
    # hollow cabinet: carcass up to 73 cm, then side and back panels around the hidden basin
    box('cabinet', (W, D - 2, 43.5), (0, -D / 2 + 1, 51.25), 'dark-oak', bevel=0.4)
    for sx in (-1, 1):
        box(f'side{sx}', (1.6, D - 2, 10), (sx * (W / 2 - 0.8), -D / 2 + 1, 78), 'dark-oak')
    box('back', (W, 1.6, 10), (0, -0.8, 78), 'dark-oak')
    for k, (zc, h) in enumerate(((43.5, 24), (69.5, 22))):
        box(f'drawer{k}', (W - 1, 1.6, h), (0, -D + 1.2, zc), 'dark-oak', bevel=0.3)
        box(f'grip{k}', (W - 6, 1.0, 1.6), (0, -D + 0.2, zc + h / 2 - 1.6), 'black', bevel=0.2)
    # 2 cm ceramic top with an opening, over a hollow basin hidden in the cabinet (bowl 9 cm deep)
    slab = box('top', (W + 1, D + 1, 2), (0, -D / 2, top - 1), 'ceramic', bevel=0.6)
    cut(slab, box('opening', (52, 30, 4), (0, -D / 2 - 2, top - 1), 'ceramic', bevel=5, segments=8))
    tub('bowl', (52, 30, 10), (0, -D / 2 - 2, top - 2 - 5 + 0.5), 'ceramic', wall=1.5, bevel=5)
    cylinder('mixer-body', 2.3, 15, (0, -6, top), 'chrome', segments=32, bevel=0.3)
    tube('mixer-spout', [(0, -7.5, top + 12.5), (0, -17, top + 12.5)], 1.1, 'chrome', segments=16)
    box('mixer-lever', (2.2, 10, 0.9), (0, -3, top + 15.6), 'chrome', bevel=0.3)


def shower_column():
    """Thermostatic shower column (Grohe Bau Classique-like): 30 cm bar mixer at 110 cm, Ø 2.2
    riser, 40 cm arm, round Ø 21 head, hand shower on a holder with its hose. Wall at y = 0."""
    tube('bar', [(-15, -6, 110), (15, -6, 110)], 2.8, 'chrome', segments=24)
    for sx in (-1, 1):
        tube(f'knob{sx}', [(sx * 15, -6, 110), (sx * 19, -6, 110)], 3.0, 'chrome', segments=24)
        tube(f'feet{sx}', [(sx * 8, 0, 110), (sx * 8, -6, 110)], 1.0, 'chrome')
    tube('riser', [(0, -6, 113), (0, -6, 205)], 1.1, 'chrome')
    tube('arm', [(0, -6, 205), (0, -44, 205)], 1.0, 'chrome')
    head = cylinder('head', 10.5, 0.9, (0, -44, 203.2), 'chrome', segments=64, bevel=0.3)
    cylinder('head-face', 10.0, 0.1, (0, -44, 203.1), 'steel', segments=64)
    tube('handshower', [(9, -10, 128), (9, -9, 150)], 1.3, 'chrome')
    cylinder('hand-head', 3.8, 1.4, (9, -9, 150), 'chrome', segments=32).rotation_euler = (math.radians(70), 0, 0)
    hose = [(15, -6, 107), (17, -9, 95), (15, -12, 88), (11, -12, 92), (9, -10, 110), (9, -10, 128)]
    tube('hose', hose, 0.55, 'chrome', segments=10)
    box('holder', (3, 4, 6), (9, -6, 138), 'chrome', bevel=0.5)


def radiator_plan():
    """Steel panel radiator with a flat front (Finimetal T6 Plan-like), 60 × 60 × 10 (scaled to fit),
    side covers, top grille, thermostatic valve at the bottom right."""
    box('front', (60, 1.2, 60), (0, -9.4, 30), 'white', bevel=0.4)
    box('body', (59, 8, 59), (0, -4.6, 30), 'white', bevel=0.3)
    for sx in (-1, 1):
        box(f'side{sx}', (0.6, 9.6, 60), (sx * 30.1, -4.8, 30), 'white', bevel=0.2)
    for k in range(18):
        box(f'grille{k}', (0.6, 7.0, 0.1), (-27 + k * 3.2, -4.8, 59.56), 'black')
    cylinder('valve', 1.4, 5, (26, -5, -5), 'white', segments=24)
    cylinder('head', 2.6, 6, (26, -5, -11), 'white', segments=24, bevel=0.4)


def sofa_boucle():
    """Convertible 3-seat sofa in textured bouclé (Sweeek-like, delivered compressed): L 243 × D 112,
    H 66 without cushions / 83 with, seat 184 × 65 at 40 cm, square-ish armrests 26 × 66, two back
    cushions 78 × 49 and two small 45 × 45. Front towards −Y, back against +Y."""
    L, D, arm = 243, 112, 26
    box('base', (L - 2 * arm + 2, D - 4, 40), (0, 0, 20), 'sofa', bevel=5, segments=6)
    box('seat', (184, 66, 6), (0, -D / 2 + 33 + 1, 40 + 1), 'sofa', bevel=3, segments=5)
    box('back', (L - 2 * arm + 2, 44, 66), (0, D / 2 - 22, 33), 'sofa', bevel=6, segments=6)
    for sx in (-1, 1):
        box(f'arm{sx}', (arm, D, 66), (sx * (L / 2 - arm / 2), 0, 33), 'sofa', bevel=7, segments=6)
    for k, sx in enumerate((-1, 1)):
        c = box(f'cushion{k}', (78, 18, 49), (sx * 41, D / 2 - 44 - 7, 40 + 24.5), 'sofa', bevel=7, segments=6)
        c.rotation_euler = (math.radians(-10), 0, 0)
    for k, sx in enumerate((-1, 1)):
        c = box(f'small{k}', (45, 13, 45), (sx * 70, D / 2 - 44 - 22, 40 + 22), 'sofa', bevel=6, segments=6)
        c.rotation_euler = (math.radians(-14), 0, math.radians(sx * 8))


def wardrobe_sliding():
    """Built-in wardrobe 167 × 60, floor to ceiling (249.5): carcass, two oak sliding doors on two
    tracks with a recessed vertical grip, top and bottom rails. Front towards −Y."""
    W, D, H = 167, 60, 249.5
    box('carcass', (W, D - 4, H), (0, 2, H / 2), 'white')
    box('rail-top', (W, 5, 6), (0, -D / 2 + 2.5, H - 3), 'oak')
    box('rail-bottom', (W, 5, 3), (0, -D / 2 + 2.5, 1.5), 'oak')
    dw = W / 2 + 2  # 4 cm overlap
    for k, (x, y) in enumerate(((-W / 4 - 1, -D / 2 + 1.2), (W / 4 + 1, -D / 2 - 0.8))):
        box(f'door{k}', (dw, 1.9, H - 9), (x, y, 3 + (H - 9) / 2), 'oak', bevel=0.2)
        gx = x + (dw / 2 - 5) * (1 if k == 0 else -1)
        box(f'grip{k}', (1.6, 0.6, 120), (gx, y - 1.0, 110), 'black', bevel=0.2)


MODELS = {
    'stool_oak': stool_oak,
    'paper_lantern': paper_lantern,
    'coffee_table': coffee_table,
    'floor_lamp_paper': floor_lamp_paper,
    'sofa_foam': sofa_foam,
    'sofa_boucle': sofa_boucle,
    'bed_140': bed_140,
    'round_table': round_table,
    'chair_black': chair_black,
    'wc_okyris': wc_okyris,
    'vanity_horizon80': vanity_horizon80,
    'shower_column': shower_column,
    'radiator_plan': radiator_plan,
    'wardrobe_sliding': wardrobe_sliding,
}


def preview(name, folder):
    """Quick EEVEE render (3/4 view, soft light) to check a model by eye."""
    import mathutils
    scn = SCN
    objs = [o for o in scn.objects]
    mins = [min((o.matrix_world @ mathutils.Vector(c))[k] for o in objs for c in o.bound_box) for k in range(3)]
    maxs = [max((o.matrix_world @ mathutils.Vector(c))[k] for o in objs for c in o.bound_box) for k in range(3)]
    centre = mathutils.Vector([(a + b) / 2 for a, b in zip(mins, maxs)])
    size = max(b - a for a, b in zip(mins, maxs))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    cam.location = centre + mathutils.Vector((-1.1, -1.6, 0.9)) * size * 1.25
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (0.7, 0.2, -0.6)
    scn.collection.objects.link(sun)
    scn.world = scn.world or bpy.data.worlds.new('w')
    scn.world.use_nodes = True
    bg = next(n for n in scn.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.75, 0.75, 0.75, 1)
    bg.inputs['Strength'].default_value = 0.8
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x = scn.render.resolution_y = 420
    scn.view_settings.view_transform = 'Standard'
    scn.render.filepath = os.path.join(folder, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    for o in (cam, sun):
        bpy.data.objects.remove(o, do_unlink=True)


def build(name):
    scn = scene()
    clear(scn)
    MODELS[name]()
    path = export(name)
    if os.environ.get('PREVIEW_DIR'):
        preview(name, os.environ['PREVIEW_DIR'])
    return path


def build_all():
    return [build(n) for n in MODELS]


if __name__ == '__main__':
    import sys
    if '--' in sys.argv:  # blender -b --factory-startup -P scripts/models/build_models.py -- [names…]
        names = sys.argv[sys.argv.index('--') + 1:] or list(MODELS)
        for n in names:
            p = build(n)
            print(f'MODEL {n} {os.path.getsize(p) // 1024} kB')
