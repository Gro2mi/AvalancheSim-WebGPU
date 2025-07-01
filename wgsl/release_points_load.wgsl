
@group(0) @binding(0) var input_release_points: texture_2d<u32>;

@group(0) @binding(1) var release_points_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read_write> out_debug: array<f32>;

@compute @workgroup_size(16, 16, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
    let texture_size = textureDimensions(input_release_points);
    if (id.x >= texture_size.x || id.y >= texture_size.y) {
        return;
    }
    let release_thickness = textureLoad(input_release_points, id.xy, 0);
    textureStore(release_points_texture, id.xy, vec4f(release_thickness));
    if(id.x == 103 && id.y == 269) {
        out_debug[0] = f32(release_thickness.r);
        out_debug[1] = f32(release_thickness.g);
        out_debug[2] = f32(release_thickness.b);
        out_debug[3] = f32(release_thickness.a);
        out_debug[4] = f32(id.x);
    }
}