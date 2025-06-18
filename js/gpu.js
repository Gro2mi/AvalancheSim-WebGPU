var velocityMagnitude, accelerationTangentialMagnitude;
var maxSteps, simModel, frictionModel, density, slabThickness, frictionCoefficient, dragCoefficient, cfl;
var stepDistance, travelDistance, velocity, accelerationTangential, position, timestep, time, accelerationFrictionMagnitude, cfl, domain_size, elevation, normal;

async function run(settings, dem, release_point) {
  var start_total = performance.now();
  
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice({
    requiredFeatures: ["float32-filterable"],
  });

  // wgsl doesn't support imports
  const shaderNormals = await loadAndConcatShaders([
  "wgsl/util/tile_util.wgsl",
  "wgsl/util/normals_util.wgsl",
  "wgsl/util/tile_hashmap.wgsl",
  "wgsl/util/filtering.wgsl",
  'wgsl/normals_compute.wgsl'
])

  const normalsModule = await checkWGSL(device, shaderNormals);
  // Step 1: Prepare uniform buffer (RegionBounds)
  const boundsData = new Float32Array([
    settings.bounds.xmin, settings.bounds.ymin,
    settings.bounds.xmax, settings.bounds.ymax,
  ]);
  const boundsBuffer = createInputBuffer(device, 4 * 4);
  device.queue.writeBuffer(boundsBuffer, 0, boundsData);

  const demTexture = createTextureAndBuffer(device, dem);

  // Create output texture for normals
  const normalsTexture = device.createTexture({
    size: [dem.width, dem.height],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING 
    | GPUTextureUsage.TEXTURE_BINDING
    | GPUTextureUsage.COPY_SRC 
    | GPUTextureUsage.COPY_DST,
  });

  const normalsPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: normalsModule, entryPoint: 'computeMain' },
  });
  // Step 3: Create bind group
  const normalsBindGroup = device.createBindGroup({
    layout: normalsPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: boundsBuffer } },
      { binding: 1, resource: demTexture.createView() },
      { binding: 2, resource: normalsTexture.createView() },
    ],
  });

  const shaderCode = await fetch('wgsl/trajectory_compute.wgsl').then(r => r.text());
  
  var inputPointData = new Float32Array([release_point[0], release_point[1], 0, minPositiveValue(dem.arr1d)]);

  const settingsBuffer = createInputBuffer(device, settings.numberOfSettings * 4)
  const inputPointBuffer = createInputBuffer(device, 16);

  device.queue.writeBuffer(settingsBuffer, 0, settings.createBuffer());
  device.queue.writeBuffer(inputPointBuffer, 0, inputPointData);

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  // Create all output buffers
  const bufferStructSize = 64;
  const outputBufferSize = bufferStructSize * maxSteps;
  const stepCounterBuffer = createStorageBuffer(device, 4); // 1 u32 for steps count
  const outBuffer = createStorageBuffer(device, outputBufferSize);
  const outDebug = createStorageBuffer(device, 4 * 100);

  const readbackStepCount = createReadbackBuffer(device, 4); // 1 u32 for steps count
  const readbackBuffer = createReadbackBuffer(device, outputBufferSize);
  const readbackDebug = createReadbackBuffer(device, 100 * 4);


  // Create shader module and pipeline
  const module = await checkWGSL(device, shaderCode);
  const trajectoriesPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });


  // Create bind group
  const bindGroup = device.createBindGroup({
    layout: trajectoriesPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: settingsBuffer } },
      { binding: 1, resource: { buffer: inputPointBuffer } },
      { binding: 2, resource: demTexture.createView() },
      { binding: 7, resource: normalsTexture.createView() },
      { binding: 3, resource: sampler },
      { binding: 4, resource: { buffer: stepCounterBuffer } },
      { binding: 5, resource: { buffer: outBuffer } },
      { binding: 6, resource: { buffer: outDebug } },
    ],
  });


  // Encode commands
  const commandEncoder = device.createCommandEncoder();
  {
    const normalsPass = commandEncoder.beginComputePass();
    normalsPass.setPipeline(normalsPipeline);
    normalsPass.setBindGroup(0, normalsBindGroup);
    normalsPass.dispatchWorkgroups(
      Math.ceil(dem.width / 16),
      Math.ceil(dem.height / 16)
    );
    normalsPass.end();
  }
  {
    const trajectoriesPass = commandEncoder.beginComputePass();
    trajectoriesPass.setPipeline(trajectoriesPipeline);
    trajectoriesPass.setBindGroup(0, bindGroup);
    trajectoriesPass.dispatchWorkgroups(1);
    trajectoriesPass.end();
  }

  // Wait for copy to finish
  await device.queue.onSubmittedWorkDone();
  // Copy outputs to readback buffers
  commandEncoder.copyBufferToBuffer(stepCounterBuffer, 0, readbackStepCount, 0, 4);
  commandEncoder.copyBufferToBuffer(outBuffer, 0, readbackBuffer, 0, maxSteps * bufferStructSize);
  commandEncoder.copyBufferToBuffer(outDebug, 0, readbackDebug, 0, 100 * 4);

  // Submit commands
  var start = performance.now();
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  console.log(`Shader execution took ${(performance.now() - start, 2).toFixed(2)} ms`);

  // Map and read data helper
  async function readBuffer(buffer, size, ctor) {
    await buffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = buffer.getMappedRange();
    const result = new ctor(arrayBuffer.slice(0, size));
    buffer.unmap();
    return result;
  }
  start = performance.now();
  const stepCount = (await readBuffer(readbackStepCount, 4, Uint32Array))[0];
  console.log("Steps count: ", stepCount);

  // Read results
  const bufferData = await readBuffer(readbackBuffer, stepCount * bufferStructSize, Float32Array);
  console.log(`Reading buffers took ${(performance.now() - start, 2).toFixed(2)} ms`);

  start = performance.now();
  parseOutputBuffer(bufferData, stepCount);
  console.log([...bufferData.slice(0, 16)]); // Log first 16 floats for debugging
  console.log(`Parsing outBuffer took ${(performance.now() - start, 2).toFixed(2)} ms`);


  const bufferDebug = await readBuffer(readbackDebug, 100 * 4, Float32Array);
  console.log([...bufferDebug])

  console.log(`Total computation took ${(performance.now() - start_total, 2).toFixed(2)} ms`);
}

// Create readback buffers (for CPU reading)
function createReadbackBuffer(device, size) {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}

function createStorageBuffer(device, bufferSize) {
  return device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
}

function createInputBuffer(device, bufferSize) {
  return device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

async function loadAndConcatShaders(urls) {
  const codes = await Promise.all(
    urls.map(url => fetch(url).then(res => res.text()))
  );
  return codes.join('\n');
}

function createTextureAndBuffer(device, arr) {
    const bytesPerRow = Math.ceil(arr.width * 4 / 256) * 256; // 4 bytes per float32 pixel, must be aligned to 256 bytes

    const texture = device.createTexture({
      size: [arr.width, arr.height, 1],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const textureBuffer = device.createBuffer({
      size: bytesPerRow * arr.height,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    const mappedRange = textureBuffer.getMappedRange();
    const src = arr.arr1d;
    const dst = new Float32Array(mappedRange);

    for (let row = 0; row < arr.height; row++) {
      const srcOffset = row * arr.width;
      const dstOffset = (bytesPerRow / 4) * row;
      dst.set(src.subarray(srcOffset, srcOffset + arr.width), dstOffset);
    }
    textureBuffer.unmap();
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToTexture(
      {
        buffer: textureBuffer,
        bytesPerRow: bytesPerRow,
      },
      {
        texture: texture,
      },
      [arr.width, arr.height, 1]
    );
    device.queue.submit([copyEncoder.finish()]);

    return texture;
  }

function parseOutputBuffer(bufferData, stepCount) {
  velocity = { x: [], y: [], z: [] };
  accelerationTangential = { x: [], y: [], z: [] };
  position = { x: [], y: [], z: [] };
  timestep = [];
  cfl = [];
  accelerationFrictionMagnitude = [];
  accelerationTangentialMagnitudeangentialMagnitude = [];
  velocityMagnitude = [];
  elevation = [];
  time = [];
  distance = [];
  stepDistance = [];
  travelDistance = [];
  normal = { x: [], y: [], z: [] };
  for (let i = 0; i < stepCount; i++) {
    const base = i * 16; // 64 bytes / 4 bytes per float = 16 floats per struct

    velocity.x.push(bufferData[base + 0]);
    velocity.y.push(bufferData[base + 1]);
    velocity.z.push(bufferData[base + 2]);

    accelerationTangential.x.push(bufferData[base + 4]);
    accelerationTangential.y.push(bufferData[base + 5]);
    accelerationTangential.z.push(bufferData[base + 6]);

    position.x.push(bufferData[base + 8]);
    position.y.push(bufferData[base + 9]);
    position.z.push(bufferData[base + 10]);

    // apparently you can pack f32 into padding of vec3f, this should not work
    timestep.push(bufferData[base + 3]);
    accelerationFrictionMagnitude.push(bufferData[base + 7]);
    elevation.push(bufferData[base + 11]);

    
    normal.x.push(bufferData[base + 12]);
    normal.y.push(bufferData[base + 13]);
    normal.z.push(bufferData[base + 14]);

  }
  accelerationTangentialMagnitude = magnitude(accelerationTangential);
  velocityMagnitude = magnitude(velocity);
  time = cumulativeSum(timestep);
  stepDistance = magnitude(diff(position));
  travelDistance = cumulativeSum(stepDistance);
  for (let i = 0; i < stepCount; i++) {
    cfl.push(velocityMagnitude[i] * timestep[i] / 5);
  }
}

function convertVec4ArrayToSoA(paddedArray) {
  const count = paddedArray.length / 4;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    x[i] = paddedArray[i * 4 + 0];
    y[i] = paddedArray[i * 4 + 1];
    z[i] = paddedArray[i * 4 + 2];
  }

  return { x, y, z };
}

async function checkWGSL(device, wgslCode) {
  const shaderModule = device.createShaderModule({ code: wgslCode });

  const info = await shaderModule.getCompilationInfo();
  if (info.messages.length > 0) {
    console.group("WGSL Compilation Messages:");
    for (const msg of info.messages) {
      const type = msg.type.toUpperCase();
      console.log(`${type} [${msg.lineNum}:${msg.linePos}] ${msg.message}`);
    }
    console.groupEnd();

    const hadError = info.messages.some(m => m.type === "error");
    if (hadError) {
      throw new Error("WGSL compilation failed. See log for details.");
    }
  } else {
    console.log("WGSL compiled successfully.");
  }

  return shaderModule;
}







