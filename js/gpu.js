var simData, releasePoints;
var device;
var simTimer = new Timer("Avalanche Simulation");

async function run(settings, dem, release_point) {
  simTimer = new Timer("Avalanche Simulation")

  // wgsl doesn't support imports
  const shaderNormals = await loadAndConcatShaders([
    "wgsl/util/tile_util.wgsl",
    "wgsl/util/normals_util.wgsl",
    "wgsl/util/tile_hashmap.wgsl",
    "wgsl/util/filtering.wgsl",
    'wgsl/normals_compute.wgsl'
  ])

  
  const shaderReleasePoints = await loadAndConcatShaders([
    "wgsl/util/tile_util.wgsl",
    "wgsl/util/normals_util.wgsl",
    "wgsl/util/tile_hashmap.wgsl",
    "wgsl/util/filtering.wgsl",
    'wgsl/release_points_compute.wgsl',
    'wgsl/util/color_mapping.wgsl'
  ])
  
  const shaderCode = await fetch('wgsl/trajectory_compute.wgsl').then(r => r.text());
  simTimer.checkpoint("shader fetching");

  const normalsModule = await checkWGSL(device, shaderNormals);
  const releasePointsModule = await checkWGSL(device, shaderReleasePoints);
  const trajectoryModule = await checkWGSL(device, shaderCode);
  simTimer.checkpoint("shader compilation");
  
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

  // Release points compute shader


  const releasePointsSettings = {
    minSlopeAngle: 35 / 180 * Math.PI,
    maxSlopeAngle: 45 / 180 * Math.PI,
    minElevation: 1500,
    slabThickness: 1,
  };
  const releasePointsSettingsData = new Float32Array([
    releasePointsSettings.minSlopeAngle,
    releasePointsSettings.maxSlopeAngle,
    releasePointsSettings.minElevation,
    releasePointsSettings.slabThickness,
  ]);
  const releasePointsSettingsBuffer = createInputBuffer(device, releasePointsSettingsData.byteLength);
  device.queue.writeBuffer(releasePointsSettingsBuffer, 0, releasePointsSettingsData);

  const releasePointsTexture = device.createTexture({
    size: [dem.width, dem.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });

  const releasePointsPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: releasePointsModule, entryPoint: 'computeMain' },
  });
  // Step 3: Create bind group
  const releasePointsBindGroup = device.createBindGroup({
    layout: releasePointsPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: releasePointsSettingsBuffer } },
      { binding: 1, resource: demTexture.createView() },
      { binding: 2, resource: normalsTexture.createView() },
      { binding: 3, resource: releasePointsTexture.createView() },
    ],
  });

  const unpaddedBytesPerRow = dem.width * 4;
  const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readReleasePointsBuffer = device.createBuffer({
    size: paddedBytesPerRow * dem.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });


  // Trajectory compute shader


  const inputPointData = new Float32Array([release_point[0], release_point[1]]);

  const settingsBuffer = createInputBuffer(device, SimSettings.byteSize);
  const inputPointBuffer = createInputBuffer(device, inputPointData.byteLength);
  console.log("bounds: ", settings.bounds);

  device.queue.writeBuffer(settingsBuffer, 0, settings.createBuffer());
  device.queue.writeBuffer(inputPointBuffer, 0, inputPointData);

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  // Create all output buffers
  const simDataBufferSize = SimData.timeStepByteSize * settings.maxSteps;
  const simInfoBuffer = createStorageBuffer(device, SimInfo.byteSize);
  const outBuffer = createStorageBuffer(device, simDataBufferSize);
  const outDebug = createStorageBuffer(device, 4 * 100);

  const readbackSimInfo = createReadbackBuffer(device, SimInfo.byteSize);
  const readbackSimData = createReadbackBuffer(device, simDataBufferSize);
  const readbackDebug = createReadbackBuffer(device, 100 * 4);


  // Create shader module and pipeline
  const trajectoriesPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: trajectoryModule, entryPoint: 'main' },
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
      { binding: 4, resource: { buffer: simInfoBuffer } },
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
    const releasePointsPass = commandEncoder.beginComputePass();
    releasePointsPass.setPipeline(releasePointsPipeline);
    releasePointsPass.setBindGroup(0, releasePointsBindGroup);
    releasePointsPass.dispatchWorkgroups(
      Math.ceil(dem.width / 16),
      Math.ceil(dem.height / 16)
    );
    releasePointsPass.end();
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
  commandEncoder.copyBufferToBuffer(simInfoBuffer, 0, readbackSimInfo, 0, SimInfo.byteSize);
  commandEncoder.copyBufferToBuffer(outBuffer, 0, readbackSimData, 0, maxSteps * SimData.timeStepByteSize);
  commandEncoder.copyBufferToBuffer(outDebug, 0, readbackDebug, 0, 100 * 4);

  commandEncoder.copyTextureToBuffer(
    {
      texture: releasePointsTexture,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 },
    },
    {
      buffer: readReleasePointsBuffer,
      bytesPerRow: paddedBytesPerRow,
    },
    {
      width: dem.width,
      height: dem.height,
      depthOrArrayLayers: 1,
    }
  );
  simTimer.checkpoint("preparation");
  // Submit commands
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  simTimer.checkpoint("shader execution");

  // Map and read data helper
  async function readBuffer(buffer, size, ctor) {
    await buffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = buffer.getMappedRange();
    const result = new ctor(arrayBuffer.slice(0, size));
    buffer.unmap();
    return result;
  }
  await readbackSimInfo.mapAsync(GPUMapMode.READ);
  const arrayBuffer = readbackSimInfo.getMappedRange();
  const simInfo = new SimInfo(arrayBuffer);
  readbackSimInfo.unmap();
  console.log("Step count: ", simInfo.stepCount);
  console.log("dxy min: ", simInfo.dxyMin);
  // Read results
  const bufferSimData = await readBuffer(readbackSimData, simInfo.stepCount * SimData.timeStepByteSize, Float32Array);

  const bufferDebug = await readBuffer(readbackDebug, 100 * 4, Float32Array);
  descriptions = ["x", "y", "u", "v", "elevation", "elevation_threshold", "", "xmin", "ymin", "xmax", "ymax"];
  let line = "";
  for (let i = 0; i < 100; i++) {
    const desc = descriptions[i] || "";
    if (bufferDebug[i] == 0 && desc == "" ) continue; // Skip empty descriptions
    line += `${i} ${desc}: ${bufferDebug[i].toFixed(2)}, `;
  }
  console.log("Debug info: ", line);
  simTimer.checkpoint("readback buffer");

  await readReleasePointsBuffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(readReleasePointsBuffer.getMappedRange());

  // Extract unpadded rows
  releasePoints = new Uint8Array(dem.width * dem.height * 4);
  for (let y = 0; y < dem.height; y++) {
    const srcOffset = y * paddedBytesPerRow;
    const dstOffset = y * unpaddedBytesPerRow;
    releasePoints.set(mapped.subarray(srcOffset, srcOffset + unpaddedBytesPerRow), dstOffset);
  }
  readReleasePointsBuffer.unmap();
  
  simTimer.checkpoint("readback textures");
  simData = new SimData(simInfo.dxyMin);
  simData.parse(bufferSimData, simInfo.stepCount);

  console.log([...bufferSimData.slice(0, 16)]); // Log first 16 floats for debugging
  simTimer.checkpoint("parse output buffer");
  simTimer.printSummary();
  exportReleasePointsToPNG(releasePoints, dem.width, dem.height, "releaseCanvas");

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

function exportReleasePointsToPNG(releasePoints, width, height, canvasId = "releaseCanvas") {
  // Create or select a canvas
  let canvas = document.getElementById(canvasId);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = canvasId;
    document.body.appendChild(canvas);
  }
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  function flipImageDataVertically(src, width, height) {
  const rowSize = width * 4; // 4 bytes per pixel (RGBA)
  const flipped = new Uint8ClampedArray(src.length);

  for (let y = 0; y < height; y++) {
    const srcOffset = y * rowSize;
    const dstOffset = (height - 1 - y) * rowSize;
    flipped.set(src.subarray(srcOffset, srcOffset + rowSize), dstOffset);
  }
  return flipped;
}

// Usage:
const flippedPixels = flipImageDataVertically(releasePoints, width, height);
const imageData = ctx.createImageData(width, height);
imageData.data.set(flippedPixels);
ctx.putImageData(imageData, 0, 0);


  // Convert canvas to PNG and trigger download
  const pngURL = canvas.toDataURL('image/png');

  const link = document.createElement('a');
  link.download = 'release_points.png';
  link.href = pngURL;
  // link.click();
}
