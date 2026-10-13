import bpy
from pathlib import Path

root = Path.cwd()

# Start completely clean.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Test object.
bpy.ops.mesh.primitive_uv_sphere_add(
    segments=32,
    ring_count=16,
    location=(0, 0, 0)
)

sphere = bpy.context.active_object
sphere.name = "TamagoAI_Automation_Test"

# Camera.
bpy.ops.object.camera_add(location=(0, -6, 0))
camera = bpy.context.active_object
camera.name = "Validation_Camera"
camera.rotation_euler = (1.5708, 0, 0)
bpy.context.scene.camera = camera

# Point camera at origin.
direction = -camera.location
camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

# Light.
bpy.ops.object.light_add(
    type='AREA',
    location=(0, -3, 4)
)
light = bpy.context.active_object
light.data.energy = 800
light.data.shape = 'DISK'
light.data.size = 5

# World.
bpy.context.scene.world.color = (0, 0, 0)

# Render configuration.
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100

render_path = root / "3D/renders/validation/blender-smoke-test.png"
blend_path = root / "3D/blender/tamagoai-smoke-test.blend"

scene.render.filepath = str(render_path)

bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
bpy.ops.render.render(write_still=True)

print()
print("TAMAGOAI_SMOKE_TEST_PASS")
print(f"BLEND={blend_path}")
print(f"RENDER={render_path}")
