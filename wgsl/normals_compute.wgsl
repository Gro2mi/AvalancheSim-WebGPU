@group(0) @binding(0) var<uniform> input: Uniforms;
@group(0) @binding(1) var dem_texture: texture_2d<f32>;

// output
@group(0) @binding(2) var normals_texture: texture_storage_2d<rgba16float, write>; // ASSERT: same dimensions as heights_texture

@group(0) @binding(3) var<storage, read_write> out_debug: array<f32>;
struct Uniforms {
    cell_size: f32,
}

@compute @workgroup_size(16, 16, 1)
fn computeMain(@builtin(global_invocation_id) cell: vec3<u32>) {

    // exit if thread id is outside image dimensions (i.e. thread is not supposed to be doing any work)
    let texture_size = textureDimensions(normals_texture);
    if (cell.x >= texture_size.x || cell.y >= texture_size.y) {
        return;
    }

    let coord = vec2<i32>(cell.xy);

    // Sample center and neighbors
    let left   = textureLoad(dem_texture, coord + vec2<i32>(-1, 0), 0).r;
    let right  = textureLoad(dem_texture, coord + vec2<i32>( 1, 0), 0).r;
    let down   = textureLoad(dem_texture, coord + vec2<i32>(0, -1), 0).r;
    let up     = textureLoad(dem_texture, coord + vec2<i32>(0,  1), 0).r;

    // TODO handle domain edges
    let dzdx = (right - left);
    let dzdy = (up - down);
    // Normal from gradient, assuming square cells and disregards the change in latitude correction 
    // within the texture which is in the magnitude of 1e-4 for a normal skitour
    let normal = normalize(vec3(-dzdx, -dzdy, 2*input.cell_size));

    // calculate normal for position texture_pos from height texture and store in normal texture
    textureStore(normals_texture, coord, vec4f(0.5 * normal + 0.5, 1));
    if(cell.x == 20 && cell.y == 20) {
    out_debug[0] = normal.x;
    out_debug[1] = normal.y;
    out_debug[2] = normal.z;
    out_debug[3] = dzdx;
    out_debug[4] = dzdy;
    out_debug[5] = input.cell_size;
    out_debug[6] = acos(normal.z) * (180.0 / 3.14159265358979323846); // convert rad to deg
    }
    out_debug[7] = textureLoad(dem_texture, vec2u(10, 10), 0).x; // just for debugging
    // out_debug[3] = textureLoad(heights_texture, vec2u(260, 190), 0).x;
    // out_debug[3] = textureLoad(heights_texture, vec2u(260, 190), 0).y;
    // out_debug[3] = textureLoad(heights_texture, vec2u(260, 190), 0).z;
}
