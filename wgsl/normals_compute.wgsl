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
    let resolution = input.cell_size;

    // Sample center and neighbors
    let center   = textureLoad(dem_texture, coord + vec2<i32>(0, 0), 0).r;
    let left   = textureLoad(dem_texture, coord + vec2<i32>(-1, 0), 0).r;
    let right  = textureLoad(dem_texture, coord + vec2<i32>( 1, 0), 0).r;
    let down   = textureLoad(dem_texture, coord + vec2<i32>(0, -1), 0).r;
    let up     = textureLoad(dem_texture, coord + vec2<i32>(0,  1), 0).r;

    let up_right     = textureLoad(dem_texture, coord + vec2<i32>(1,  1), 0).r;
    let down_right     = textureLoad(dem_texture, coord + vec2<i32>(-1,  1), 0).r;
    let up_left     = textureLoad(dem_texture, coord + vec2<i32>(1,  -1), 0).r;
    let down_left     = textureLoad(dem_texture, coord + vec2<i32>(-1,  -1), 0).r;

    // TODO handle domain edges
    let dx = (right - left) / (2.0 * resolution);
    let dy = (up - down) / (2.0 * resolution);
    // Normal from gradient, assuming square cells and disregards the change in latitude correction 
    // within the texture which is in the magnitude of 1e-4 for a normal skitour
    let normal = normalize(vec3(-dx, -dy, 1.0));

    let dxx = (left - 2*center + right) / (resolution*resolution);
    let dyy = (up - 2*center + down) / (resolution*resolution);
    let dxy = (up_right - down_right - up_left + down_left) / (4 * resolution*resolution);

    let denom = pow(dx*dx + dy*dy + 1e-12, 1.5);
    let p = dx;
    let q = dy;
    let grad_sq = p*p + q*q;
    let profile_curvature = (dxx*dx*dx + 2.0*dxy*dx*dy + dyy*dy*dy) / denom;
    // let profile_curvature = select(-(p*p * dxx + 2.0 * p * q * dxy + q*q * dyy) / grad_sq, 0.0, grad_sq < 1e-12); 
    // let plan_curvature    = (dxx*dy*dy - 2.0*dxy*dx*dy + dyy*dx*dx) / denom;
    // let mean_curvature = ((1.0 + dy*dy)*dxx - 2.0*dx*dy*dxy + (1.0 + dx*dx)*dyy) / (2.0 * pow(1.0 + dx*dx + dy*dy, 1.5));

    // calculate normal for position texture_pos from height texture and store in normal texture
    textureStore(normals_texture, coord, vec4f(normal, profile_curvature));
    if(cell.x == 3 && cell.y == 20) {
    out_debug[0] = normal.x;
    out_debug[1] = normal.y;
    out_debug[2] = normal.z;
    out_debug[3] = input.cell_size;
    out_debug[4] = dx;
    out_debug[5] = dy;
    out_debug[6] = dxx;
    out_debug[7] = dyy;
    out_debug[8] = dxy;
    out_debug[9] = profile_curvature;
    out_debug[10] = left;
    out_debug[11] = right;
    out_debug[12] = up;
    out_debug[13] = down;
    out_debug[14] = center;
    
    }
}
