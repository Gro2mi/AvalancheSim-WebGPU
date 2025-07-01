@group(0) @binding(0) var<uniform> settings: ReleasePointSettings;
@group(0) @binding(1) var dem_texture: texture_2d<f32>;
@group(0) @binding(2) var normals_texture: texture_2d<f32>;
// @group(0) @binding(2) var landcover_texture: texture_2d<u32>;

@group(0) @binding(3) var release_points_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<storage, read_write> out_debug: array<f32>;

const PI: f32 = 3.14159265358979323846;
const RAD_TO_DEG: f32 = 180.0 / PI;

const confers_trees = vec4u(34, 139, 34, 255);
const broadleaf_deciduous_trees = vec4u(128, 255, 0, 255);
const broadleaf_evergreen_trees = vec4u(0, 255, 8, 255);

struct ReleasePointSettings {
    min_slope_angle: f32, // in rad
    max_slope_angle: f32, // in rad
    min_elevation: f32, // in meters
    slab_thickness: f32, // in meters
    // sampling_interval: vec2u,
}

fn get_roughness(id: vec2u) -> f32 {
    // according to doi:10.5194/nhess-16-2211-2016
    if (id.x == 0 || id.y == 0 || id.x >= textureDimensions(normals_texture).x - 1 || id.y >= textureDimensions(normals_texture).y - 1) {
        return 1.0; // no roughness at borders
    }
    var idx = 0u;
    var r: array<vec3f, 9>;
    var r_sum = vec3f(0.0, 0.0, 0.0);
    
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            let normal = textureLoad(normals_texture, vec2<i32>(id) + vec2(x, y), 0).xyz * 2 - 1;
            let alpha = acos(normal.z);             // slope in rad
            let beta = atan2(normal.x, normal.y);   // aspect in rad
            r[idx].x = sin(alpha) * cos(beta);      // x component of roughness vector
            r[idx].y = sin(alpha) * sin(beta);      // y component of roughness vector
            r[idx].z = cos(alpha);                  // z component of roughness vector
            idx = idx + 1u;
        }
    }
    for (var i = 0u; i < 9u; i = i + 1u) {
        r_sum = r_sum + r[i];
    }
    let r_magnitude = length(r_sum);
    let roughness = 1 - r_magnitude / 9.0;
    return roughness; // returns 0 for flat terrain, 1 for very rough terrain
}

// fn is_forest(id: vec2u) -> bool {
//     // check if the pixel is within the bounds of the landcover texture
//     if (id.x >= textureDimensions(landcover_texture).x || id.y >= textureDimensions(landcover_texture).y) {
//         return false;
//     }
//     // load the landcover value at the given id
//     let landcover_value = textureLoad(landcover_texture, id, 0).r; // assuming landcover is stored in the red channel
//     // check if the value corresponds to forest (e.g., 1.0 for forest)
//     return landcover_value > 0.5; // adjust threshold as needed
// }

@compute @workgroup_size(16, 16, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
    let roughness_threshold = 0.01;  // TODO is this high enough?
    // exit if thread id is outside image dimensions (i.e. thread is not supposed to be doing any work)
    let texture_size = textureDimensions(release_points_texture);
    if (id.x >= texture_size.x || id.y >= texture_size.y) {
        return;
    }
    let tex_pos = id.xy;
    let normal_compute = textureLoad(normals_texture, tex_pos, 0);
    let normal = normal_compute.xyz;
    let profile_curvature = normal_compute.w;
    let elevation = textureLoad(dem_texture, tex_pos, 0).x;
    let slope_angle = acos(normal.z) * RAD_TO_DEG;
    let aspect = atan2(normal.x, normal.y);
    let roughness = get_roughness(tex_pos);

    if (slope_angle < settings.min_slope_angle || slope_angle > settings.max_slope_angle 
        || elevation < settings.min_elevation
        || roughness > roughness_threshold
    ) {
        // slope angle in rad, roughness scaled with 50, aspect from [-1, 1] to [0, 1]
        textureStore(release_points_texture, tex_pos, vec4f(slope_angle, roughness, aspect, 0));
    } else {
        textureStore(release_points_texture, tex_pos, vec4f(slope_angle, roughness, aspect, settings.slab_thickness));
    }
    // needs to stay here, otherwise texture is not used
    out_debug[0] = f32(slope_angle);
}
