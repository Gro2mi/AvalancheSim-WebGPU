
struct Boundary {
    x_min: f32,
    y_min: f32,
    x_max: f32,
    y_max: f32,
}

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


struct Point2 {
  x: f32,
  y: f32,
};

struct SimInfo {
  step_count: u32,
  dxy_min: f32,
};

struct TimestepData {
    velocity: vec3f,                        // 12 bytes     12
    dt: f32,                          //  4 bytes     16
    acceleration_tangential: vec3f,         // 12 bytes     28
    acceleration_friction_magnitude: f32,   //  4 bytes     32
    position: vec3f,                        // 12 bytes     44
    elevation: f32,                         //  4 bytes     48
    normal: vec3f,                          // 12 bytes     60
    acceleration_normal: vec3f,             // 12 bytes     76
    // padding                                  4 bytes     80
    uv: vec2f,                              //  8 bytes     88
                                    // padding  8 bytes     96
};

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<uniform> input_point: Point2;
@group(0) @binding(2) var dem_texture: texture_2d<f32>;
@group(0) @binding(3) var tex_sampler: sampler;
@group(0) @binding(7) var normals_texture: texture_2d<f32>;

@group(0) @binding(4) var<storage, read_write> sim_info: SimInfo;
@group(0) @binding(5) var<storage, read_write> out_buffer: array<TimestepData>;
@group(0) @binding(6) var<storage, read_write> out_debug: array<f32>;

const g: f32 = 9.81;
const density: f32 = 200.0;
const slab_thickness: f32 = 1.0;
const velocity_threshold: f32 = 1e-6f;

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
    let dxy = domain_size / vec2f(textureDimensions(dem_texture));
    let elevation_threshold = min_elevation();
    let dxy_min = min(dxy.x, dxy.y);
    sim_info.dxy_min = dxy_min;
    var last: TimestepData;
    sim_info.step_count = settings.num_steps;
    last.uv = world_to_uv(vec2f(input_point.x, input_point.y));

    // webigeo copy part,
    // uncomment steps_count.value
    last.elevation = get_elevation(last.uv);
    last.normal = get_normal(last.uv);
    last.position = vec3f(input_point.x, input_point.y, last.elevation);
    last.velocity = vec3f(0f, 0f, 0f);
//     var last_velocity = vec3<f32>(0f, 0f, 0f);
    last.acceleration_tangential = acceleration_gravity + g * last.normal.z * last.normal;
    last.acceleration_friction_magnitude = 0f;
    // estimation of the first timestep to calculate actual timestep, safety factor of 1.1 needs to be
    // bigger than 1.0 because it's in the divisor later
    last.dt = sqrt(settings.cfl * dxy_min / length(last.acceleration_tangential)) * 1.1;
    update_output_data(0u, last);

    for (var i: u32 = 0u; i < settings.num_steps; i++) {
        let current: TimestepData = compute_timestep(last, dxy_min);
        update_output_data(i + 1u, current);
        // TODO more sophisticated projection methods
        last = current;
        last.position.z = last.elevation;

        // stop criterion friction
        if (length(current.velocity) < 0.0001) {
            sim_info.step_count = i + 2u;
            break;
        }
        // out of bounds or non rectangular terrain
        if(current.uv.x < 0.0 || current.uv.x > 1.0 || current.uv.y < 0.0 || current.uv.y > 1.0 
            || last.elevation < elevation_threshold){
            sim_info.step_count = i;
            break;
        }
        
    }
    out_debug[0] = last.position.x;
    out_debug[1] = last.position.y;
    out_debug[2] = last.uv.x;
    out_debug[3] = last.uv.y;
    out_debug[4] = get_elevation(last.uv);
    out_debug[5] = elevation_threshold;
    out_debug[7] = settings.boundary.x_min;
    out_debug[8] = settings.boundary.y_min;
    out_debug[9] = settings.boundary.x_max;
    out_debug[10] = settings.boundary.y_max;

}

fn compute_timestep(last: TimestepData, dxy_min: f32) -> TimestepData {
        var current: TimestepData;
        current.normal = get_normal(last.uv); 
        current.acceleration_normal = g * current.normal.z * current.normal;
        current.acceleration_tangential = acceleration_gravity + current.acceleration_normal;
        // avoid division by zero with velocity_threshold
        current.dt = settings.cfl * dxy_min / (length(last.velocity + current.acceleration_tangential * last.dt) + velocity_threshold);
        
        current.dt = min(current.dt, 0.8);
        current.acceleration_friction_magnitude = acceleration_by_friction(current.acceleration_normal, mass_per_area, last.velocity);
        current.velocity = last.velocity + current.acceleration_tangential * current.dt;
        // friction stop condition
        if(length(current.velocity) < current.acceleration_friction_magnitude * current.dt){
            current.dt = length(current.velocity) / current.acceleration_friction_magnitude;
        }
        current.velocity = current.velocity - current.acceleration_friction_magnitude * normalize(current.velocity) * current.dt;
        let relative_trajectory = current.velocity * current.dt;
        current.position = last.position + relative_trajectory;
        current.uv = world_to_uv(vec2f(current.position.x, current.position.y));
        current.elevation = get_elevation(current.uv);
        return current;
}

fn update_output_data(i: u32, timestep_data: TimestepData) {
    out_buffer[i] = timestep_data;
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
        let min_shear_stress_samosat = 0f;
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
        shear_stress = min_shear_stress_samosat + normal_stress * friction_coefficient * (1.0 + rs0 / (rs0 + rs)) + density * velocity_magnitude * velocity_magnitude / (div * div);
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
    var normal = textureSampleLevel(normals_texture, tex_sampler, uv, 0).xyz * 2 - 1; // convert from [0, 1] to [-1, 1]
    normal.y = -normal.y; // flip y-axis to match the coordinate system
    return normal;
}

fn world_to_uv(world_pos: vec2f) -> vec2f {
    let bounds_min = vec2f(settings.boundary.x_min, settings.boundary.y_min);
    let bounds_max = vec2f(settings.boundary.x_max, settings.boundary.y_max);
    return (world_pos - bounds_min) / (bounds_max - bounds_min + vec2f(sim_info.dxy_min, sim_info.dxy_min));
}

fn uv_to_world(uv: vec2f) -> vec2f {
    let bounds_min = vec2f(settings.boundary.x_min, settings.boundary.y_min);
    let bounds_max = vec2f(settings.boundary.x_max, settings.boundary.y_max);
    return mix(bounds_min, bounds_max, uv);
}

const MIN_VALID_ELEVATION: f32 = 0.9; // Elevations <= this are considered invalid (e.g., nodata or background)

fn min_elevation() -> f32 {
    // find the minimum elevation in the height texture
    let tex_size = textureDimensions(dem_texture);
    var min_val: f32 = 1e10;

    for (var y: u32 = 0; y < tex_size.y; y++) {
        for (var x: u32 = 0; x < tex_size.x; x++) {
            let value = textureLoad(dem_texture, vec2u(x, y), 0).x;
            // Only consider values above the minimum valid elevation threshold
            if (value < min_val && value > MIN_VALID_ELEVATION) {
                min_val = value;
            }
        }
    }
    return min_val - 0.1;
}
