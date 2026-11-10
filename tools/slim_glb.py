"""Rewrite a GLB without vertex attributes the game never reads (extra UV sets, tangents), packing what is left.
usage: python tools/slim_glb.py <in.glb> <out.glb> [ATTR,ATTR...]   (default: TEXCOORD_1,TEXCOORD_2,TEXCOORD_3,TANGENT)"""
import json
import struct
import sys

src, dst = sys.argv[1], sys.argv[2]
drop = set((sys.argv[3] if len(sys.argv) > 3 else 'TEXCOORD_1,TEXCOORD_2,TEXCOORD_3,TANGENT').split(','))
b = open(src, 'rb').read()
jl = struct.unpack_from('<I', b, 12)[0]
j = json.loads(b[20:20 + jl])
bin0 = 20 + jl + 8
binl = struct.unpack_from('<I', b, 20 + jl)[0]
blob = b[bin0:bin0 + binl]

for m in j.get('meshes', []):
    for p in m['primitives']:
        for a in list(p['attributes']):
            if a in drop:
                del p['attributes'][a]

used = set()
for m in j.get('meshes', []):
    for p in m['primitives']:
        used.update(p['attributes'].values())
        if 'indices' in p:
            used.add(p['indices'])
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s:
        used.add(s['inverseBindMatrices'])
for an in j.get('animations', []):
    for sm in an['samplers']:
        used.update([sm['input'], sm['output']])

SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
out, views = bytearray(), []


def put(data, target=None):
    while len(out) % 4:
        out.append(0)
    v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
    if target:
        v['target'] = target
    out.extend(data)
    views.append(v)
    return len(views) - 1


old_views = j['bufferViews']
remap = {}
accs = []
for i, a in enumerate(j['accessors']):
    if i not in used:
        continue
    v = old_views[a['bufferView']]
    es = SIZE[a['componentType']] * COMP[a['type']]
    stride = v.get('byteStride', es)
    base = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    data = bytearray()
    for k in range(a['count']):
        o = base + k * stride
        data.extend(blob[o:o + es])
    na = dict(a)
    na['bufferView'] = put(bytes(data), v.get('target'))
    na['byteOffset'] = 0
    remap[i] = len(accs)
    accs.append(na)
for img in j.get('images', []):
    if 'bufferView' in img:
        v = old_views[img['bufferView']]
        o = v.get('byteOffset', 0)
        img['bufferView'] = put(blob[o:o + v['byteLength']])

for m in j.get('meshes', []):
    for p in m['primitives']:
        p['attributes'] = {k: remap[v] for k, v in p['attributes'].items()}
        if 'indices' in p:
            p['indices'] = remap[p['indices']]
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s:
        s['inverseBindMatrices'] = remap[s['inverseBindMatrices']]
for an in j.get('animations', []):
    for sm in an['samplers']:
        sm['input'], sm['output'] = remap[sm['input']], remap[sm['output']]
j['accessors'] = accs
j['bufferViews'] = views
while len(out) % 4:
    out.append(0)
j['buffers'] = [{'byteLength': len(out)}]
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4:
    js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + out
open(dst, 'wb').write(glb)
print(f'{src}: {len(b) / 1e6:.1f} MB -> {dst}: {len(glb) / 1e6:.1f} MB')
