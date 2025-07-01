var simData, releasePoints;
var device;

var simTimer = new Timer("Avalanche Simulation");

class ShaderNode {
  constructor(name, runNode) {
    this.name = name;
    this.code = null;
    this.module = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.computePass = null;
    this.runNode = runNode;
  }

  async compile(lineOffset = 0) {
    if (!this.code) {
      throw new Error("Shader code is not set for " + this.name);
    }
    this.module = device.createShaderModule({ code: this.code });
    const info = await this.module.getCompilationInfo();
    if (info.messages.length > 0) {
      console.group(this.name + " Shader Compilation Messages:");
      for (const msg of info.messages) {
        const type = msg.type.toUpperCase();
        console.log(`${type} [${msg.lineNum - lineOffset}:${msg.linePos}] ${msg.message}`);
      }
      console.groupEnd();

      const hadError = info.messages.some(m => m.type === "error");
      if (hadError) {
        throw new Error(this.name + " Shader Compilation failed. See log for details.");
      }
    } else {
      console.log(this.name + " Shader compiled successfully.");
    }
    return this.module;
  }

  createPipeline(compute = { module: this.module, entryPoint: 'computeMain', }, layout = 'auto') {
    if (!this.module) {
      throw new Error("Shader module is not created for " + this.name);
    }
    this.pipeline = device.createComputePipeline({
      label: this.name + " Compute Pipeline",
      layout: 'auto',
      compute: compute,
    });
    return this.pipeline;
  }

  createBindGroup(entries) {
    if (!this.pipeline) {
      throw new Error("Pipeline is not created for " + this.name);
    }
    this.bindGroup = device.createBindGroup({
      label: this.name + " BindGroup",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: entries,
    });
    return this.bindGroup;
  }

  createComputePass(commandEncoder, n = 1, workgroupCountX = Math.ceil(dem.width / 16), workgroupCountY = Math.ceil(dem.height / 16)) {
    if (!this.pipeline) {
      throw new Error("Pipeline is not created for " + this.name);
    }
    if (!this.bindGroup) {
      throw new Error("BindGroup is not created for " + this.name);
    }
    this.computePass = commandEncoder.beginComputePass({ label: this.name + " Compute Pass" });
    this.computePass.setPipeline(this.pipeline);
    for (let i = 0; i < n; i++) {
      this.computePass.setBindGroup(0, this.bindGroup);
      this.computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY, 1);
    }
    this.computePass.end();
  }
}


class Shaders {
  constructor() {
    this.shaderImports = new ShaderNode("Imports");
    this.linesImported = 0;

    this.normals = new ShaderNode("Normals", true);
    this.computeReleasePoints = new ShaderNode("ComputeReleasePoints", false);
    this.loadReleasePoints = new ShaderNode("LoadReleasePoints", false);
    this.trajectory = new ShaderNode("Trajectory", false);
    // this.timestamps = new gpuTimestamps(6);
  }

  async fetch() {
    // TODO: implement include functionality for WGSL
    this.shaderImports.code = await loadAndConcatShaders([
      "wgsl/random.wgsl",
    ]);
    await this.shaderImports.compile();
    this.linesImported = countLines(this.shaderImports.code);

    this.normals.code = await loadAndConcatShaders(['wgsl/normals_compute.wgsl']);
    this.computeReleasePoints.code = await loadAndConcatShaders(['wgsl/release_points_compute.wgsl']);
    this.loadReleasePoints.code = await loadAndConcatShaders(['wgsl/release_points_load.wgsl']);
    this.trajectory.code = await loadAndConcatShaders(['wgsl/trajectory_compute.wgsl']);
  }

  async compile() {
    // await this.decodeDem.compile();
    await this.normals.compile();
    await this.computeReleasePoints.compile();
    await this.loadReleasePoints.compile();
    await this.trajectory.compile();
  }

  createPipelines() {
    this.normals.createPipeline();
    this.computeReleasePoints.createPipeline();
    this.loadReleasePoints.createPipeline();
    this.trajectory.createPipeline();
  }

  static async fetchAndConcat(urls) {
    const codes = await Promise.all(
      urls.map(url => fetch(url).then(res => res.text()))
    );
    return codes.join('\n') + '\n';
  }

  topologicalSort(nodes) {
    const sorted = [];
    const visited = new Set();

    function visit(nodeName) {
      if (visited.has(nodeName)) return;
      visited.add(nodeName);

      const node = nodes[nodeName];
      for (const depGroup of node.dependencies) {
        if (depGroup.some(dep => visited.has(dep))) {
          continue; // Skip if any dependency in the group is ready
        }
        depGroup.forEach(visit); // Visit all dependencies in the group
      }
      sorted.push(nodeName);
    }

    Object.keys(nodes).forEach(visit);
    return sorted.reverse();
  }

}



async function run(simSettings, dem, release_point, predefinedReleasePoints) {

  var shaders = new Shaders();
  const numberGpuTimestamps = 5;
  // TODO: currently only works with 3 which is enough for test cases
  const trackedTrajectories = 3;
  const debugBufferSize = 100 * 4;
  simTimer = new Timer("Avalanche Simulation")
  // only load shaders if not already loaded or in debug mode
  if (debug || shaders.normals.code == null) {
    await shaders.fetch();
    simTimer.checkpoint("shader fetching");
    await shaders.compile();
    simTimer.checkpoint("shader compilation");
    shaders.createPipelines();
  }
  const boundsBuffer = createInputBuffer(device, 4);
  device.queue.writeBuffer(boundsBuffer, 0, new Float32Array([dem.world_resolution]));

  const demTexture = createDemTextureAndBuffer(device, dem.data1d);

  // Create output texture for normals
  const normalsTexture = device.createTexture({
    size: [dem.width, dem.height],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });

  const outDebugNormals = createStorageBuffer(device, debugBufferSize);
  const readbackDebugNormals = createReadbackBuffer(device, debugBufferSize);

  shaders.normals.createBindGroup([
    { binding: 0, resource: { buffer: boundsBuffer } },
    { binding: 1, resource: demTexture.createView() },
    { binding: 2, resource: normalsTexture.createView() },
    { binding: 3, resource: { buffer: outDebugNormals } },
  ],
  );


  // Release points compute shader
  const releasePointsSettings = {
    minSlopeAngle: 35,
    maxSlopeAngle: 45,
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
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });

  const outDebugRelease = createStorageBuffer(device, debugBufferSize);
  const readbackDebugRelease = createReadbackBuffer(device, debugBufferSize);

  shaders.computeReleasePoints.createBindGroup([
    { binding: 0, resource: { buffer: releasePointsSettingsBuffer } },
    { binding: 1, resource: demTexture.createView() },
    { binding: 2, resource: normalsTexture.createView() },
    { binding: 3, resource: releasePointsTexture.createView() },
    { binding: 4, resource: { buffer: outDebugRelease } },
  ],
  );

  const pixelData = await loadPNG("avaframe/" + simSettings.casename + "releaseTexture.png");

  function align(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }
  const width = dem.width;
  const height = dem.height;
  const bytesPerRowUnpadded = width * 4;
  const bytesPerRow = align(bytesPerRowUnpadded, 256);

  const paddedData = new Uint8Array(bytesPerRow * height);
  const rgbaData = flipFlatArrayInY(pixelData.rgba, pixelData.width, pixelData.height);
  for (let row = 0; row < height; row++) {
    const srcOffset = row * bytesPerRowUnpadded;
    const dstOffset = row * bytesPerRow;

    // Copy one row from original data to padded buffer
    paddedData.set(rgbaData.subarray(srcOffset, srcOffset + bytesPerRowUnpadded), dstOffset);
    // The remaining bytes in the row are already zero by default
  }
  const texture = device.createTexture({
    size: [width, height, 1],
    format: 'rgba8uint',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  device.queue.writeTexture(
    { texture },
    paddedData,
    {
      offset: 0,
      bytesPerRow: bytesPerRow,
      rowsPerImage: height,
    },
    {
      width: width,
      height: height,
      depthOrArrayLayers: 1,
    }
  );

  shaders.loadReleasePoints.createBindGroup([
    { binding: 0, resource: texture.createView() },
    { binding: 1, resource: releasePointsTexture.createView() },
    { binding: 2, resource: { buffer: outDebugRelease } },
  ],
  );

  const unpaddedBytesPerRow = dem.width * 8;
  const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readReleasePointsBuffer = device.createBuffer({
    size: paddedBytesPerRow * dem.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });


  // Trajectory compute shader


  const inputPointData = new Float32Array([release_point[0], release_point[1]]);

  const settingsBuffer = createInputBuffer(device, SimSettings.byteSize);
  const inputPointBuffer = createInputBuffer(device, inputPointData.byteLength);

  device.queue.writeBuffer(settingsBuffer, 0, simSettings.createBuffer());
  device.queue.writeBuffer(inputPointBuffer, 0, inputPointData);

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const outputTextureSize = 4 * dem.width * dem.height;
  const outputTextureBuffer = createStorageBuffer(device, outputTextureSize);
  const outputVelocityTextureBuffer = createStorageBuffer(device, outputTextureSize);

  // Create all output buffers
  const simDataBufferSize = trackedTrajectories * SimData.timeStepByteSize * simSettings.maxSteps;
  const simInfoBuffer = createStorageBuffer(device, SimInfo.byteSize);
  const outBuffer = createStorageBuffer(device, simDataBufferSize);
  const outDebugTrajectories = createStorageBuffer(device, debugBufferSize);
  const outAtomicBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  const readbackSimInfo = createReadbackBuffer(device, SimInfo.byteSize);
  const readbackSimData = createReadbackBuffer(device, simDataBufferSize);
  const readbackDebugTrajectories = createReadbackBuffer(device, debugBufferSize);
  const readbackOutputTexture = createReadbackBuffer(device, outputTextureSize);
  const readbackVelocityTexture = createReadbackBuffer(device, outputTextureSize);
  const readbackAtomicBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Create bind group
  shaders.trajectory.createBindGroup([
    { binding: 0, resource: { buffer: settingsBuffer } },
    { binding: 1, resource: { buffer: inputPointBuffer } },
    { binding: 2, resource: demTexture.createView() },
    { binding: 3, resource: normalsTexture.createView() },
    { binding: 4, resource: releasePointsTexture.createView() },
    { binding: 5, resource: sampler },

    { binding: 6, resource: { buffer: simInfoBuffer } },
    { binding: 7, resource: { buffer: outBuffer } },
    { binding: 8, resource: { buffer: outDebugTrajectories } },
    { binding: 9, resource: { buffer: outputTextureBuffer } },
    { binding: 10, resource: { buffer: outputVelocityTextureBuffer } },
    { binding: 11, resource: { buffer: outAtomicBuffer } },
  ],
  );

  let bufferTimestamps;
  let timestampQuerySet;
  if (debug) {
    bufferTimestamps = device.createBuffer({
      size: numberGpuTimestamps * 8, // 2 timestamps * 8 bytes each
      usage: GPUBufferUsage.QUERY_RESOLVE
        | GPUBufferUsage.STORAGE
        | GPUBufferUsage.COPY_SRC
        | GPUBufferUsage.COPY_DST,
    });
    timestampQuerySet = device.createQuerySet({ type: 'timestamp', count: numberGpuTimestamps });
  }

  // Encode commands
  const commandEncoder = device.createCommandEncoder();
  if (debug) { commandEncoder.writeTimestamp(timestampQuerySet, 0) };
  shaders.normals.createComputePass(commandEncoder);
  if (debug) { commandEncoder.writeTimestamp(timestampQuerySet, 1) };
  if (predefinedReleasePoints) {
    shaders.loadReleasePoints.createComputePass(commandEncoder);
  } else {
    shaders.computeReleasePoints.createComputePass(commandEncoder);
  }
  if (debug) { commandEncoder.writeTimestamp(timestampQuerySet, 2) };
  shaders.trajectory.createComputePass(commandEncoder, n = simSettings.numberTrajectories);
  if (debug) { commandEncoder.writeTimestamp(timestampQuerySet, 3) };

  // Wait for copy to finish
  await device.queue.onSubmittedWorkDone();
  // Copy outputs to readback buffers
  commandEncoder.copyBufferToBuffer(simInfoBuffer, 0, readbackSimInfo, 0, SimInfo.byteSize);
  commandEncoder.copyBufferToBuffer(outBuffer, 0, readbackSimData, 0, simDataBufferSize);
  commandEncoder.copyBufferToBuffer(outputTextureBuffer, 0, readbackOutputTexture, 0, outputTextureSize);
  commandEncoder.copyBufferToBuffer(outputVelocityTextureBuffer, 0, readbackVelocityTexture, 0, outputTextureSize);
  commandEncoder.copyBufferToBuffer(outAtomicBuffer, 0, readbackAtomicBuffer, 0, 4);

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

  commandEncoder.copyBufferToBuffer(outDebugTrajectories, 0, readbackDebugTrajectories, 0, debugBufferSize);
  commandEncoder.copyBufferToBuffer(outDebugNormals, 0, readbackDebugNormals, 0, debugBufferSize);
  commandEncoder.copyBufferToBuffer(outDebugRelease, 0, readbackDebugRelease, 0, debugBufferSize);
  if (debug) {
    commandEncoder.writeTimestamp(timestampQuerySet, 4)
    commandEncoder.resolveQuerySet(timestampQuerySet, 0, numberGpuTimestamps, bufferTimestamps, 0);
  }

  simTimer.checkpoint("preparation");
  // Submit commands
  device.queue.submit([commandEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  simTimer.checkpoint("shader execution");

  const simInfo = await readBuffer(readbackSimInfo, SimInfo);
  console.log("Step count tracked Trajectory: ", simInfo.stepCount);
  console.log("dxy min: ", simInfo.dxyMin);
  // Read results
  const totalTimesteps = await readBuffer(readbackAtomicBuffer, Uint32Array);
  console.log("Max timesteps: ", totalTimesteps[0]);
  const bufferSimData = await readBuffer(readbackSimData, Float32Array, trackedTrajectories * SimData.timeStepByteSize * simInfo.stepCount);
  const bufferOutputTexture = await readBuffer(readbackOutputTexture, Uint32Array);
  const bufferVelocityTexture = await readBuffer(readbackVelocityTexture, Uint32Array);

  const bufferDebugNormals = await readBuffer(readbackDebugNormals, Float32Array);
  const bufferDebugRelease = await readBuffer(readbackDebugRelease, Float32Array);
  const bufferDebugTrajectories = await readBuffer(readbackDebugTrajectories, Float32Array);
  simTimer.checkpoint("readback buffer");

  if (debug) {
    const gpuTimestampsNs = new BigInt64Array(await copyAndReadBuffer(bufferTimestamps));
    // loses precision for numbers > 2^53 -1
    const gpuTimestamps = {
      normals: Number(gpuTimestampsNs[1] - gpuTimestampsNs[0]) / 1e6,
      releasePoints: Number(gpuTimestampsNs[2] - gpuTimestampsNs[1]) / 1e6,
      trajectories: Number(gpuTimestampsNs[3] - gpuTimestampsNs[2]) / 1e6,
      copy: Number(gpuTimestampsNs[4] - gpuTimestampsNs[3]) / 1e6,
    }
    console.log("GPU timestamps: ", gpuTimestamps);

    console.log("Debug info normals: ", debugBufferLine(bufferDebugNormals,
      ["nx", "ny", "nz", "resolution", "dzdx", "dzdy", "dxx", "dyy", "dxy", "curvature"]
    ));
    console.log("Debug info release: ", debugBufferLine(bufferDebugRelease,
      ["r"]
    ));
    console.log("Debug info trajectories: ", debugBufferLine(bufferDebugTrajectories,
      ["normalx", "normaly", "u", "v", "elevation", "elevation_threshold", "", "xmin", "ymin", "xmax", "ymax"]
    ));
  }

  await readReleasePointsBuffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint16Array(readReleasePointsBuffer.getMappedRange());
  const { r, g, b, a } = processRGBA16FloatBuffer(mapped, dem.width, dem.height);
  readReleasePointsBuffer.unmap();

  simTimer.checkpoint("readback textures");
  simData = new SimData(simInfo.dxyMin);
  simData.parse(bufferSimData, simInfo.stepCount, trackedTrajectories);

  console.log([...bufferSimData.slice(0, SimData.timeStepByteSize / 4)]); 
  simTimer.printSummary();
  simData.parseVelocityTexture([...bufferVelocityTexture]);
  simData.parseCellCountTexture([...bufferOutputTexture]);
  simData.parseReleasePointTexture(r, g, b, a)
  simTimer.checkpoint("parse results");
}

async function readBuffer(buffer, ctor, size = 0) {
  await buffer.mapAsync(GPUMapMode.READ);
  const arrayBuffer = buffer.getMappedRange();
  const result = new ctor(arrayBuffer.slice(0, size == 0 ? buffer.size : size));
  buffer.unmap();
  return result;
}

async function copyAndReadBuffer(buffer) {
  const size = buffer.size;
  const gpuReadBuffer = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const copyEncoder = device.createCommandEncoder();
  copyEncoder.copyBufferToBuffer(buffer, 0, gpuReadBuffer, 0, size);
  const copyCommands = copyEncoder.finish();
  device.queue.submit([copyCommands]);
  await gpuReadBuffer.mapAsync(GPUMapMode.READ);
  return gpuReadBuffer.getMappedRange();
}

function debugBufferLine(bufferDebug, descriptions = [], debugBufferSize = 100) {
  var line = "";
  for (let i = 0; i < debugBufferSize; i++) {
    const desc = descriptions[i] || "";
    if (bufferDebug[i] == 0 && desc == "") continue; // Skip empty descriptions
    line += `(${i}) ${desc}: ${bufferDebug[i].toFixed(2)}, `;
  }
  return line;
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

function createDemTextureAndBuffer(device, data, format = 'r32float', ctor = Float32Array) {
  switch (format) {
    case 'rgba8uint':
    case 'rgba8unorm':
      var bytesPerPixel = 4;
      break;
    case 'rgba16float':
      var bytesPerPixel = 8;
      break;
    case 'r32float':
      var bytesPerPixel = 4;
      break;
    default:
      throw new Error("Unsupported texture format: " + format + ". Add the format in createDemTextureAndBuffer function.");
  }
  const bytesPerRow = Math.ceil(dem.width * bytesPerPixel / 256) * 256; // 4 bytes per float32 pixel, must be aligned to 256 bytes

  const texture = device.createTexture({
    size: [dem.width, dem.height, 1],
    format: format,
    usage: GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST,
  });

  const textureBuffer = device.createBuffer({
    size: bytesPerRow * dem.height,
    usage: GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });

  padInputTextureData(textureBuffer, data, bytesPerPixel, ctor);
  const copyEncoder = device.createCommandEncoder();
  copyEncoder.copyBufferToTexture(
    {
      buffer: textureBuffer,
      bytesPerRow: bytesPerRow,
    },
    {
      texture: texture,
    },
    [dem.width, dem.height, 1]
  );
  device.queue.submit([copyEncoder.finish()]);

  return texture;
}

function padInputTextureData(buffer, data, bytesPerPixel, ctor) {
  const bytesPerRow = Math.ceil(dem.width * bytesPerPixel / 256) * 256;
  const mappedRange = buffer.getMappedRange();
  const dst = new ctor(mappedRange);

  for (let row = 0; row < dem.height; row++) {
    const srcOffset = row * dem.width;
    const dstOffset = (bytesPerRow / bytesPerPixel) * row;
    dst.set(data.subarray(srcOffset, srcOffset + dem.width), dstOffset);
  }
  buffer.unmap();
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
}

function processRGBA16FloatBuffer(mapped, width, height) {
  const bytesPerPixel = 8; // 4 channels × 2 bytes (float16)
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256; const r = Array.from({ length: height }, () => new Float32Array(width));
  const g = Array.from({ length: height }, () => new Float32Array(width));
  const b = Array.from({ length: height }, () => new Float32Array(width));
  const a = Array.from({ length: height }, () => new Float32Array(width));

  const paddedUint16sPerRow = paddedBytesPerRow / 2; // 2 bytes per Uint16
  const rowPixelUint16s = width * 4;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * paddedUint16sPerRow;

    for (let x = 0; x < width; x++) {
      const index = rowOffset + x * 4;

      r[y][x] = decodeFloat16(mapped[index + 0]);
      g[y][x] = decodeFloat16(mapped[index + 1]);
      b[y][x] = decodeFloat16(mapped[index + 2]);
      a[y][x] = decodeFloat16(mapped[index + 3]);
    }
  }

  return { r, g, b, a };
}
