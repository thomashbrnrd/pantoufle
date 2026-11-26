"""
Offline light bake for a Pantoufle project (Blender / Cycles).

1. npm run bake:export            -> bake/<project>/scene.glb + bake.json
2. blender -b -P scripts/bake.py -- --project arboreal-143 --mood overcast --samples 256
   (or run the functions below from the Blender MCP)
3. Copy the printed `lightmap` block into public/projects/<project>/project.json.

What is baked: the diffuse lighting only (no albedo) on the static building, from the sky HDR
(direct + indirect). The sun's direct light and the furniture stay real-time in the viewer.
Lightmap UVs come from the viewer (uv1, deterministic layout): nothing to unwrap here.
Output: public/projects/<project>/lightmaps/<mood>.jpg, sRGB-encoded light / SCALE.
"""
import json
import os
import sys
import time

import bpy
import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')) if '__file__' in globals() else '/Users/thomasbernard/dev/pantoufle'
SKIES = {'overcast': 'kloofendal_overcast_puresky_2k.hdr'}  # downloaded into bake/ (Poly Haven, CC0)


def setup(project: str, mood: str) -> dict:
    """Imports the exported scene into a dedicated `pantoufle_bake` scene and prepares the bake."""
    root = os.path.join(REPO, 'bake', project)
    cfg = json.load(open(os.path.join(root, 'bake.json')))
    scn = bpy.data.scenes.get('pantoufle_bake') or bpy.data.scenes.new('pantoufle_bake')
    if bpy.context.window:
        bpy.context.window.scene = scn
    for o in list(scn.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'scene.glb'))
    scn.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scn.cycles.device = 'GPU'
    except Exception as e:  # CPU fallback
        print('GPU unavailable:', e)
    w = bpy.data.worlds.get(f'pantoufle_{mood}') or bpy.data.worlds.new(f'pantoufle_{mood}')
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(REPO, 'bake', SKIES[mood]), check_existing=True)
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    scn.world = w
    size = cfg['size']
    name = f'LM_{mood}'
    img = bpy.data.images.get(name)
    if img and img.size[0] != size:
        bpy.data.images.remove(img)
        img = None
    if not img:
        img = bpy.data.images.new(name, size, size, float_buffer=True, alpha=False)
    lm = lightmapped(scn)
    for o in lm:
        o.data.uv_layers.active = o.data.uv_layers['UVMap.001']  # uv1 = lightmap UVs
        for slot in o.material_slots:
            m = slot.material
            if m is None:
                continue
            m.use_nodes = True
            n = m.node_tree.nodes.get('LM_TARGET') or m.node_tree.nodes.new('ShaderNodeTexImage')
            n.name = 'LM_TARGET'
            n.image = img
            m.node_tree.nodes.active = n
    bpy.ops.object.select_all(action='DESELECT')
    for o in lm:
        o.select_set(True)
    bpy.context.view_layer.objects.active = lm[0]
    return cfg


def lightmapped(scn):
    return [o for o in scn.objects if o.name.startswith('LM_') and o.type == 'MESH']


def bake(samples: int = 256, blocking: bool = True):
    scn = bpy.data.scenes['pantoufle_bake']
    scn.cycles.samples = samples
    scn.cycles.use_adaptive_sampling = False
    scn.render.bake.margin = 4
    mode = 'EXEC_DEFAULT' if blocking else 'INVOKE_DEFAULT'
    return bpy.ops.object.bake(mode, type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=4, use_clear=True)


def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur along the first two axes."""
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for axis in (0, 1):
        a = np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), axis, a)
    return a


def finalize(project: str, mood: str, scale: float = 1.5, sigma: float = 1.5, quality: int = 90) -> dict:
    """Denoises (Gaussian blur normalised by the coverage mask, so charts do not bleed into
    empty atlas space) and writes the 8-bit sRGB lightmap. Returns the project.json entry."""
    src = bpy.data.images[f'LM_{mood}']
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    rgb = px.reshape(h, w, 4)[:, :, :3]
    mask = (rgb.max(axis=2) > 1e-6).astype(np.float32)
    if sigma > 0:
        num = _blur(rgb * mask[:, :, None], sigma)
        den = _blur(mask, sigma)[:, :, None]
        rgb = np.where(mask[:, :, None] > 0, num / np.maximum(den, 1e-6), 0)
    lin = np.clip(rgb / scale, 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    name = f'LM_{mood}_out'
    if name in bpy.data.images:  # a saved image loses its buffer: always start from a fresh one
        bpy.data.images.remove(bpy.data.images[name])
    dst = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    dst.colorspace_settings.name = 'Non-Color'  # already sRGB-encoded above
    out = np.ones((h, w, 4), dtype=np.float32)
    out[:, :, :3] = srgb
    dst.pixels.foreach_set(out.ravel())
    folder = os.path.join(REPO, 'public', 'projects', project, 'lightmaps')
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f'{mood}.jpg')
    # Raw pixels, no view transform (save_render would apply the scene's AgX/Filmic look).
    dst.file_format = 'JPEG'
    try:
        dst.save(filepath=path, quality=quality)
    except TypeError:  # older Blender: no quality argument
        dst.filepath_raw = path
        dst.save()
    # Three.js: irradiance = texel × intensity; Cycles' diffuse light × π = irradiance.
    return {'src': f'lightmaps/{mood}.jpg', 'intensity': round(scale * np.pi, 3)}


if __name__ == '__main__' and '--' in sys.argv:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--project', default='arboreal-143')
    p.add_argument('--mood', default='overcast')
    p.add_argument('--samples', type=int, default=256)
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    cfg = setup(args.project, args.mood)
    t = time.time()
    bake(args.samples)
    print(f'bake {args.samples} spp: {time.time() - t:.0f} s')
    entry = finalize(args.project, args.mood)
    print(json.dumps({'lightmap': {'size': cfg['size'], 'density': cfg['density'], 'meshes': cfg['meshes'], 'moods': {args.mood: entry}}}))
