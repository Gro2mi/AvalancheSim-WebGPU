struct Settings {
  num_steps: u32,
  model_type: u32,
  friction_model: u32,
  density: f32,
  slab_thickness: f32,
  friction_coefficient: f32,
  drag_coefficient: f32,
  cfl: f32,
  boundary: Boundary,
};

struct Boundary {
    x_min: f32,
    y_min: f32,
    x_max: f32,
    y_max: f32,
}

struct Point3 {
  x: f32,
  y: f32,
  z: f32,
  elevation_threshold: f32,
};

struct StepCount {
  value: u32,
};

// this could be optimized with single values for vec3f.xyz as they are always 16 bytes wide
// right now: 3*16 + 2*4 = 56 bytes needs to be 16 byte aligned -> 64, could be 48 bytes
struct OutputData {
    velocity: vec3f,                // 12 bytes + 4 bytes padding
    timestep: f32,                  // 4 bytes
    acceleration_tangential: vec3f, // 12 bytes + 4 bytes padding
    acceleration_friction_magnitude: f32,     // 4 bytes
    position: vec3f,                // 12 bytes + 4 bytes padding  // 4 bytes
    elevation: f32,              // 4 bytes
    normal: vec3f,
    // + 8 bytes padding to 64 bytes
};

@group(0) @binding(0)
var<uniform> settings: Settings;
@group(0) @binding(1)
var<uniform> input_point: Point3;
@group(0) @binding(2)
var dem_texture: texture_2d<f32>;
@group(0) @binding(3)
var tex_sampler: sampler;
@group(0) @binding(7)
var normals_texture: texture_2d<f32>;

@group(0) @binding(4)
var<storage, read_write> steps_count: StepCount;
@group(0) @binding(5)
var<storage, read_write> out_buffer: array<OutputData>;
@group(0) @binding(6)
var<storage, read_write> out_debug: array<f32>;

const g: f32 = 9.81;
const density: f32 = 200.0;
const slab_thickness: f32 = 1.0;
const velocity_threshold: f32 = 0.01f;

const mass_per_area = density * slab_thickness;
const acceleration_gravity = vec3f(0.0, 0.0, -g);

fn get_starting_point_uv(id: vec3<u32>) -> vec2f {
    let input_texture_size = textureDimensions(dem_texture);
    let texel_size_uv = 1.0 / vec2f(input_texture_size);
    //let uv = vec2f(f32(id.x), f32(id.y)) * texel_size_uv + texel_size_uv / 2.0; // texel center
    let uv = vec2f(f32(id.x), f32(id.y)) * texel_size_uv;// + rand2() * texel_size_uv; // random within texel
    //TODO try regular grid (?)
    return uv;
}

@compute @workgroup_size(1)
fn main() {
    let domain_size = vec2f(settings.boundary.x_max - settings.boundary.x_min, settings.boundary.y_max - settings.boundary.y_min);
    let dxy = vec2f(domain_size) / vec2f(textureDimensions(dem_texture));
    let dxy_min = min(dxy.x, dxy.y);
    let bounds_min = vec2f(settings.boundary.x_min, settings.boundary.y_min);
    let bounds_max = vec2f(settings.boundary.x_max, settings.boundary.y_max);
    let cfl: f32 = settings.cfl;
    steps_count.value = settings.num_steps;
//   // Loop inside shader, one invocation only
    var uv = world_to_uv(vec2f(input_point.x, input_point.y), bounds_min, bounds_max, dxy);
    var normal = get_normal(uv);

    var position = vec3f(input_point.x, input_point.y, get_elevation(uv));
    var velocity = vec3<f32>(0f, 0f, 0f);
//     var last_velocity = vec3<f32>(0f, 0f, 0f);
    var acceleration_tangential = acceleration_gravity + g * normal.z * normal;
    var acceleration_friction_magnitude = 0f;
    var elevation = get_elevation(uv);
    // estimation of the first timestep to calculate actual timestep, safety factor of 1.1 needs to be
    // bigger than 1.0 because it's in the divisor later
    var dt: f32 = sqrt(cfl * dxy_min / length(acceleration_tangential)) * 1.1;
    update_output_data(0u, dt, position, velocity, acceleration_tangential, acceleration_friction_magnitude, elevation, normal);

    for (var i: u32 = 0u; i < settings.num_steps; i++) {
        // TODO more sophisticated projection methods
        position.z = elevation;
        normal = get_normal(uv); 
        let acceleration_normal = g * normal.z * normal;
        acceleration_tangential = acceleration_gravity + acceleration_normal;
        var factor = 1.0;
        let velocity_magnitude = length(velocity);
        dt = factor * cfl * dxy_min / length(velocity + acceleration_tangential * dt);
        dt = min(dt, 0.5);
        acceleration_friction_magnitude = acceleration_by_friction(acceleration_normal, mass_per_area, velocity);
        velocity = velocity + acceleration_tangential * dt;
        // friction stop condition
        if(length(velocity) < acceleration_friction_magnitude * dt){
            dt = length(velocity) / acceleration_friction_magnitude;
        }
        velocity = velocity - acceleration_friction_magnitude * normalize(velocity) * dt;
        let relative_trajectory = velocity * dt;
        position = position + relative_trajectory;
        uv = world_to_uv(vec2f(position.x, position.y), bounds_min, bounds_max, dxy);
        elevation = get_elevation(uv);
        update_output_data(i + 1u, dt, position, velocity, acceleration_tangential, acceleration_friction_magnitude, elevation, normal);
    
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 
            || elevation < input_point.elevation_threshold - .9
            || length(velocity) < 0.0001
        ) {
            steps_count.value = i + 2u;
            break;
        }
        }
    out_debug[0] = position.x;
    out_debug[1] = position.y;
    out_debug[2] = uv.x;
    out_debug[3] = uv.y;
    out_debug[5] = get_elevation(uv);
    out_debug[6] = input_point.elevation_threshold;
}

fn update_output_data(
    i: u32,
    dt: f32,
    position: vec3f,
    velocity: vec3f,
    acceleration_tangential: vec3f,
    acceleration_friction_magnitude: f32,
    elevation: f32,
    normal: vec3f
) {
    out_buffer[i].velocity = velocity;
    out_buffer[i].acceleration_tangential = acceleration_tangential;
    out_buffer[i].timestep = dt;
    out_buffer[i].acceleration_friction_magnitude = acceleration_friction_magnitude;
    out_buffer[i].position = position;
    out_buffer[i].elevation = elevation;
    out_buffer[i].normal = normal;
}

fn acceleration_by_friction(acceleration_normal: vec3f, mass_per_area: f32, velocity: vec3f) -> f32 {
    let velocity_magnitude = length(velocity);
    let model = settings.friction_model;
    if velocity_magnitude < velocity_threshold || model == 4u {
        return 0.0f;
    }
    // standard 0.155, samos: standard 0.155, small 0.22, medium 0.17
    let friction_coefficient = settings.friction_coefficient;
    let drag_coefficient = settings.drag_coefficient; // only used for voellmy, standard 4000.
    let normal_stress = length(acceleration_normal * mass_per_area);
    const min_shear_stress = 70f;
    var shear_stress = 0.0f;
    //actually: friction model: 0 coulomb, 1 voellmy, 2 voellmy minshear, 3 samosAt
    // Coulomb friction model
    if (model == 0u){
        shear_stress = friction_coefficient * normal_stress;
    }
    // Voellmy friction model
    else if (model == 1){
        shear_stress = friction_coefficient * normal_stress + density * g * velocity_magnitude * velocity_magnitude / drag_coefficient;
    }
    // Voellmy min shear friction model
    else if (model == 2){
        shear_stress = min_shear_stress + friction_coefficient * normal_stress + density * g * velocity_magnitude * velocity_magnitude / drag_coefficient;
    }
    // samosAT friction model
    else if (model == 3){
        let min_shear_stress = 0f;
        let rs0 = 0.222;
        let kappa = 0.43;
        let r = 0.05;
        let b = 4.13;
        let rs = density * velocity_magnitude * velocity_magnitude / (normal_stress + 0.001);
        var div = slab_thickness / r;
        if div < 1.0 {
            div = 1.0;
        }
        div = log(div) / kappa + b;
        shear_stress = min_shear_stress + normal_stress * friction_coefficient * (1.0 + rs0 / (rs0 + rs)) + density * velocity_magnitude * velocity_magnitude / (div * div);
    }
    let acceleration_magnitude = shear_stress / mass_per_area;
    return acceleration_magnitude;
}

const TEXTURE_GATHER_OFFSET = 1.0f / 512.0f;
// Samples height texture with bilinear filtering.
fn get_elevation(uv: vec2f) -> f32 {
    // TODO: fix interpolation at the edges of the texture
    return textureSampleLevel(dem_texture, tex_sampler, uv, 0).x;
}

fn get_normal(uv: vec2f) -> vec3f {
    var normal = textureSampleLevel(normals_texture, tex_sampler, uv, 0).xyz * 2 - 1; // convert from [0, 1] to [-0.5, 0.5]
    normal.y = -normal.y; // flip y-axis to match the coordinate system
    return normal;
}

fn world_to_uv(world_pos: vec2f, bounds_min: vec2f, bounds_max: vec2f, dxy: vec2f) -> vec2f {
    return (world_pos - bounds_min) / (bounds_max - bounds_min + dxy);
}

fn uv_to_world(uv: vec2f, bounds_min: vec2f, bounds_max: vec2f) -> vec2f {
    return mix(bounds_min, bounds_max, uv);
}
