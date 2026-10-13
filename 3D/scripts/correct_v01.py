"""Single correction following the six-view V0.1 review."""
import bpy,json
from pathlib import Path
ROOT=Path('/Volumes/Storage/Projects/TamaWatch/3D');scene=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
head=bpy.data.objects['Mantle and underside - unified blockout']
for v in head.data.vertices:
 w=head.matrix_world@v.co
 # Taper only the lower forward face; retain posterior mantle volume.
 lower=max(0,min(1,(3.65-w.z)/0.65))
 front=max(0,min(1,(0.35-w.y)/0.8))
 v.co.x*=1-0.22*lower*front
for name in ['Eye L','Eye R']:
 o=bpy.data.objects[name];o.scale*=0.9;o.location.y+=0.045;o.location.x*=0.98
for o in scene.objects:
 if o.type=='CURVE':
  for sp in o.data.splines:sp.use_smooth=True
scene['correction']='One pass only: tapered lower forward face, eyes scaled 0.9 and recessed, smooth tentacle shading.'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/tamagoai-master-v01.blend'))
for name in ['front','q34','side','back','top','underside']:
 scene.camera=bpy.data.objects[name.upper()];scene.render.filepath=str(ROOT/f'renders/validation/v01-{name}.png');bpy.ops.render.render(write_still=True)
scene.camera=bpy.data.objects['Q34'];scene.render.filepath=str(ROOT/'renders/validation/v01-q34.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/tamagoai-master-v01.blend'))
deps=bpy.context.evaluated_depsgraph_get();counts=[]
for o in scene.objects:
 if o.type in {'MESH','CURVE'}:
  ev=o.evaluated_get(deps);m=ev.to_mesh();m.calc_loop_triangles();counts.append({'name':o.name,'polygons':len(m.polygons),'triangles':len(m.loop_triangles)});ev.to_mesh_clear()
report={'objects':len(scene.objects),'geometry_objects':len(counts),'tentacles':sum(o.type=='CURVE' for o in scene.objects),'polygons':sum(o['polygons'] for o in counts),'triangles':sum(o['triangles'] for o in counts),'details':counts}
(ROOT/'renders/validation/v01-counts.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
