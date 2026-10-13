"""Original editable proportion blockout; no rig, animation, or reference modification."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path('/Volumes/Storage/Projects/TamaWatch/3D')
BLEND=ROOT/'blender/tamagoai-master-v01.blend'
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=32; scene.cycles.use_denoising=True
scene.render.resolution_x=768; scene.render.resolution_y=768; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(0,0,0,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=0
scene.view_settings.view_transform='AgX'
def material(name,color,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 return m
white=material('Neutral white blockout',(0.8,0.8,0.8),0.4)
dark=material('Dark dimensional eyes',(0.012,0.014,0.016),0.24)
def ellipsoid(name,loc,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=32,location=loc)
 o=bpy.context.object;o.name=name;o.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
# Broad posterior mantle, forward face and narrow underside form one soft volume.
parts=[ellipsoid('Mantle',(0,0.3,3.65),(1.18,1.03,1.00),white),
 ellipsoid('Face',(0,-0.4,3.5),(0.92,0.65,0.9),white),
 ellipsoid('Attachment body',(0,-0.12,2.78),(0.68,0.64,0.8),white)]
for s in [-1,1]:
 parts.append(ellipsoid('Eye surround',(s*0.84,-0.61,3.65),(0.42,0.4,0.47),white))
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
head=bpy.context.object;head.name='Mantle and underside - unified blockout'
rem=head.modifiers.new('Soft union','REMESH');rem.mode='VOXEL';rem.voxel_size=0.065
bpy.ops.object.modifier_apply(modifier=rem.name)
sm=head.modifiers.new('Soften union','SMOOTH');sm.factor=1.2;sm.iterations=5;bpy.ops.object.modifier_apply(modifier=sm.name)
for p in head.data.polygons:p.use_smooth=True
for s in [-1,1]:
 eye=ellipsoid('Eye L' if s<0 else 'Eye R',(s*0.98,-0.865,3.65),(0.29,0.19,0.33),dark)
 eye.rotation_euler.z=s*math.radians(32)
# Eight individually editable, tapering Bezier tubes. Roots overlap the underside.
for i in range(8):
 angle=math.radians(-112.5+i*45)
 d=Vector((math.cos(angle),math.sin(angle),0));t=Vector((-d.y,d.x,0))
 front=d.y<-.3
 reach=1.4 if front else 1.65
 low=0.25 if front else 0.48
 # Radial/height profile produces hanging S-curves with gently upturned tips.
 profile=[(.40,2.77,.34),(.67,2.26,.30),(.89,1.64,.235),
          (reach,0.82,.17),(reach+.12,low+.08,.115),
          (reach-.10,low,.077),(reach-.28,low+.19,.043),
          (reach-.19,low+.32,.012)]
 curve=bpy.data.curves.new(f'Tentacle {i+1:02} editable path','CURVE');curve.dimensions='3D';curve.resolution_u=12
 curve.bevel_depth=1;curve.bevel_resolution=4;curve.use_fill_caps=True
 sp=curve.splines.new('BEZIER');sp.bezier_points.add(len(profile)-1)
 for j,(r,z,radius) in enumerate(profile):
  drift=0.08*math.sin(j*0.8+i)*j/7
  pos=d*r+t*drift;pos.y-=0.12
  p=sp.bezier_points[j];p.co=(pos.x,pos.y,z);p.radius=radius;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 ob=bpy.data.objects.new(f'Tentacle {i+1:02}',curve);scene.collection.objects.link(ob);curve.materials.append(white)
scene['stage']='V0.1 proportion blockout. Eight editable tentacles. No rig or animation.'
# Save useful geometry immediately, before camera setup and rendering.
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
print('EARLY_GEOMETRY_SAVE_COMPLETE',flush=True)
def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc in [('Front left',(-4,-6,7)),('Front right',(4,-5,5)),('Back left',(-4,5,6)),('Back right',(4,5,3)),('Lower',(0,-2,-4))]:
 data=bpy.data.lights.new(name,'AREA');data.energy=350 if name!='Lower' else 150;data.shape='DISK';data.size=5
 o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=loc;aim(o,(0,0,2.3))
target=(0,0,2.3)
positions={'front':(0,-10,2.3),'q34':(7,-10,5.0),'side':(10,0,2.3),'back':(0,10,2.3),'top':(0,0,13),'underside':(0,0,-9)}
for name,loc in positions.items():
 data=bpy.data.cameras.new(name.upper());o=bpy.data.objects.new(name.upper(),data);scene.collection.objects.link(o)
 o.location=loc;aim(o,target);data.type='ORTHO';data.ortho_scale=5.8;data.lens=50
scene.camera=bpy.data.objects['Q34']
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
for name in positions:
 scene.camera=bpy.data.objects[name.upper()];scene.render.filepath=str(ROOT/f'renders/validation/v01-{name}.png')
 bpy.ops.render.render(write_still=True)
scene.camera=bpy.data.objects['Q34'];scene.render.filepath=str(ROOT/'renders/validation/v01-q34.png')
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
# Evaluated mesh counts include tessellated tentacle curves, exclude cameras/lights.
deps=bpy.context.evaluated_depsgraph_get();counts=[]
for o in scene.objects:
 if o.type in {'MESH','CURVE'}:
  ev=o.evaluated_get(deps);mesh=ev.to_mesh();mesh.calc_loop_triangles()
  counts.append({'name':o.name,'polygons':len(mesh.polygons),'triangles':len(mesh.loop_triangles)})
  ev.to_mesh_clear()
report={'objects':len(scene.objects),'geometry_objects':len(counts),'tentacles':sum(o.type=='CURVE' for o in scene.objects),'polygons':sum(o['polygons'] for o in counts),'triangles':sum(o['triangles'] for o in counts),'details':counts}
(ROOT/'renders/validation/v01-counts.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report),flush=True)
