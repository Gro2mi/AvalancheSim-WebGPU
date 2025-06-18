var dem;
class RegionBounds {
    constructor(xmin, ymin, xmax, ymax) {
        if (Array.isArray(xmin)) {
            if (xmin.length !== 4) {
                throw new Error("RegionBounds expects an array of 4 numbers: [xmin, ymin, xmax, ymax]");
            }
            [this.xmin, this.ymin, this.xmax, this.ymax] = xmin;
        }
        else {
            this.xmin = xmin
            this.ymin = ymin;
            this.xmax = xmax;
            this.ymax = ymax;
        }
        this.width = this.xmax - this.xmin;
        this.height = this.ymax - this.ymin;
    }
}

class Settings {
    constructor() {
    }

    async set(casename, maxSteps, simModel, frictionModel, density, slabThickness, frictionCoefficient, dragCoefficient, cfl, boundary) {
        this.casename = casename;
        this.maxSteps = maxSteps;
        this.simModel = simModel;
        this.frictionModel = frictionModel;
        this.density = density;
        this.slabThickness = slabThickness;
        this.frictionCoefficient = frictionCoefficient;
        this.dragCoefficient = dragCoefficient;
        this.cfl = cfl;
        this.bounds = await fetchBounds(this.casename);

        this.numberOfSettings = 12;
    }

    createBuffer() {
        let settingsData = new Uint32Array([
            this.maxSteps,
            this.simModel,
            this.frictionModel,
        ]);
        let settingsFloat = new Float32Array([
            this.density,
            this.slabThickness,
            this.frictionCoefficient,
            this.dragCoefficient,
            this.cfl,
            this.bounds.xmin,
            this.bounds.ymin,
            this.bounds.xmax,
            this.bounds.ymax,
        ]);
        const settingsBufferData = new ArrayBuffer(4 * this.numberOfSettings);
        const settingsBufferU32 = new Uint32Array(settingsBufferData);
        const settingsBufferF32 = new Float32Array(settingsBufferData);
        settingsBufferU32[0] = settingsData[0];
        settingsBufferU32[1] = settingsData[1];
        settingsBufferU32[2] = settingsData[2];
        settingsBufferF32[3] = settingsFloat[0];
        settingsBufferF32[4] = settingsFloat[1];
        settingsBufferF32[5] = settingsFloat[2];
        settingsBufferF32[6] = settingsFloat[3];
        settingsBufferF32[7] = settingsFloat[4];
        settingsBufferF32[8] = settingsFloat[5];
        settingsBufferF32[9] = settingsFloat[6];
        settingsBufferF32[10] = settingsFloat[7];
        settingsBufferF32[11] = settingsFloat[8];
        return settingsBufferData;
    }
}

function max(arr) {
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > max) {
            max = arr[i];
        }
    }
    return max;
}

function min(arr) {
    let min = Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] < min) {
            min = arr[i];
        }
    }
    return min;
}

function mean(arr) {
    if (arr.length === 0) {
        throw new Error("Cannot calculate mean of an empty array");
    }
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
    }
    return sum / arr.length;
}

function minPositiveValue(floatArray) {
  let min = Infinity;

  for (let i = 0; i < floatArray.length; i++) {
    const val = floatArray[i];
    if (val > 0 && val < min) {
      min = val;
    }
  }
  if (min === Infinity) {
    error("No positive values found in the array."); 
  }
  return min; // return null if no positive values
}

async function loadDemBinary(url, width, height) {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    const data = new Float32Array(buffer); // Assumes little-endian (true on most systems)
    if (data.length !== width * height) {
        throw new Error(`Size mismatch: expected ${width * height} floats, got ${data.length}`);
    }

    // Optional: convert to 2D array
    const heightmap2D = [];
    for (let y = 0; y < height; y++) {
        heightmap2D.push(data.slice(y * width, (y + 1) * width));
    }

    return heightmap2D;
}

async function loadDemJson(casename) {
    const response = await fetch('dem/' + casename + '.json');  // Path to your JSON file
    const jsonData = await response.json();
    return jsonData;
}

async function loadPNGAsFloat32(casename) {
    const response = await fetch('dem/' + casename + '.png');
    const buffer = await response.arrayBuffer();

    // Decode PNG to raw RGBA bytes
    const img = UPNG.decode(buffer);
    const width = img.width;
    const height = img.height;
    const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]); // RGBA Uint8 bytes

    const arr1d = new Float32Array(width * height);
    const temp = new ArrayBuffer(4);
    const view = new DataView(temp);

    for (let i = 0; i < width * height; i++) {
        const offset = i * 4;
        view.setUint8(0, rgba[offset]);
        view.setUint8(1, rgba[offset + 1]);
        view.setUint8(2, rgba[offset + 2]);
        view.setUint8(3, rgba[offset + 3]);
        arr1d[i] = view.getFloat32(0, true); // little endian
    }
    console.log("Loaded PNG ", casename, ":", width, "x", height);
    return { arr1d, width, height };
}
function to2DFloatArray(arr1D, width, height) {
    if (arr1D.length !== width * height) {
        throw new Error("1D array length does not match width * height");
    }
    const arr2D = [];
    for (let row = 0; row < height; row++) {
        const start = row * width;
        const end = start + width;
        arr2D.push(arr1D.slice(start, end));
    }
    return arr2D;
}

function linspace(start, end, num) {
    if (num === 1) return [start];
    const step = (end - start) / (num - 1);
    return Array.from({ length: num }, (_, i) => start + i * step);
}

async function fetchBounds(casename) {
    const res = await fetch('dem/' + casename + '.aabb');
    const text = await res.text();

    // Split by line, filter non-empty, parse as float
    const numbers = text
        .split(/\r?\n/)
        .filter(line => line.trim() !== "")
        .map(line => parseFloat(line));

    return new RegionBounds([...numbers]);
}

function substract(arr1, arr2) {
    if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
        throw new Error("Both inputs must be arrays");
    }
    if (arr1.length !== arr2.length) {
        throw new Error("Arrays must be of the same length");
    }
    return arr1.map((value, index) => value - arr2[index]);
}

function s(arr1, arr2) {
    substract(arr1, arr2);
}

function cumulativeSum(arr) {
    if (arr instanceof Float32Array) {
        arr = [...arr]; 
    }
    if (!Array.isArray(arr)) {
        throw new Error("Input must be an array");
    }
    const result = new Float32Array(arr.length);
    result[0] = arr[0];
    for (let i = 1; i < arr.length; i++) {
        result[i] = result[i - 1] + arr[i];
    }
    return result;
}

function add(arr1, arr2) {
    if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
        throw new Error("Both inputs must be arrays");
    }
    if (arr1.length !== arr2.length) {
        throw new Error("Arrays must be of the same length");
    }
    return arr1.map((value, index) => value + arr2[index]);
}

function multiply(arr, scalar) {
    if (!Array.isArray(arr)) {
        throw new Error("Input must be an array");
    }
    return arr.map(value => value * scalar);
}

function divide(arr, scalar) {
    if (!Array.isArray(arr)) {
        throw new Error("Input must be an array");
    }
    if (scalar === 0) {
        throw new Error("Division by zero is not allowed");
    }
    return arr.map(value => value / scalar);
}

function magnitude(vec3arr) {
    const count = vec3arr.x.length;
    const magnitude = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const x = vec3arr.x[i];
        const y = vec3arr.y[i];
        const z = vec3arr.z[i];
        magnitude[i] = Math.sqrt(x * x + y * y + z * z);
    }
    return magnitude;
}

function diff(obj) {
    if (Array.isArray(obj)) {
        const diffArr = [];
        for (let i = 1; i < obj.length; i++) {
            diffArr.push(obj[i] - obj[i - 1]);
        }
        return diffArr;
    }else if(obj.hasOwnProperty('x') && obj.hasOwnProperty('y') && obj.hasOwnProperty('z')){
        const diffObj = { x: [], y: [], z: [] };
        const count = obj.x.length;
        for (let i = 1; i < count; i++) {
            diffObj.x.push(obj.x[i] - obj.x[i - 1]);
            diffObj.y.push(obj.y[i] - obj.y[i - 1]);
            diffObj.z.push(obj.z[i] - obj.z[i - 1]);
        }
        return diffObj;
    }
    else {
        throw new Error("Input must be an array or an object with x, y, z properties");
    }

}