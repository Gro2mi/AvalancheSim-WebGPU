var simData, releasePoints;
var device;

var simTimer = new Timer("Avalanche Simulation");

class Shader {
  constructor(name) {
    this.name = name;
    this.code = null;
    this.module = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.computePass = null;
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

  createPipeline() {
    if (!this.module) {
      throw new Error("Shader module is not created for " + this.name);
    }
    this.pipeline = device.createComputePipeline({
      label: this.name + " Compute Pipeline",
      layout: 'auto',
      compute: { module: this.module, entryPoint: 'computeMain', },
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

  createComputePass(commandEncoder, n = 1,
    workgroupSize = [
      Math.ceil(dem.width / 16),
      Math.ceil(dem.height / 16)
    ]) {
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
      this.computePass.dispatchWorkgroups(...workgroupSize);
    }
    this.computePass.end();
  }
}



class Shaders {
  constructor() {
    this.shaderImports = new Shader("Imports");
    this.linesImported = 0;

    this.normals = new Shader("Normals");
    this.releasePoints = new Shader("ReleasePoints");
    this.trajectory = new Shader("Trajectory");
  }

  async fetch() {
    // TODO: implement include functionality for WGSL
    this.shaderImports.code = await loadAndConcatShaders([
      "wgsl/random.wgsl",
    ]);
    await this.shaderImports.compile();
    this.linesImported = countLines(this.shaderImports.code);

    this.normals.code = await loadAndConcatShaders(['wgsl/normals_compute.wgsl']);
    this.releasePoints.code = await loadAndConcatShaders(['wgsl/release_points_compute.wgsl']);
    this.trajectory.code = await loadAndConcatShaders(['wgsl/trajectory_compute.wgsl']);
  }

  async compile() {
    // await this.decodeDem.compile();
    await this.normals.compile();
    await this.releasePoints.compile();
    await this.trajectory.compile();
  }

  createPipelines() {
    this.normals.createPipeline();
    this.releasePoints.createPipeline();
    this.trajectory.createPipeline();
  }

  static async fetchAndConcat(urls) {
    const codes = await Promise.all(
      urls.map(url => fetch(url).then(res => res.text()))
    );
    return codes.join('\n') + '\n';
  }

}

var shaders = new Shaders();


async function run(simSettings, dem, release_point) {
  // TODO: currently only works with 3 which is enough for test cases
  const TRACKED_TRAJECTORIES = 3;
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

  const demTexture = createDemTextureAndBuffer(device);

  // Create output texture for normals
  const normalsTexture = device.createTexture({
    size: [dem.width, dem.height],
    format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });

  const outDebugNormals = createStorageBuffer(device, 4 * 10);
  const readbackDebugNormals = createReadbackBuffer(device, 10 * 4);
  
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
    format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });

  shaders.releasePoints.createBindGroup([
    { binding: 0, resource: { buffer: releasePointsSettingsBuffer } },
    { binding: 1, resource: demTexture.createView() },
    { binding: 2, resource: normalsTexture.createView() },
    { binding: 3, resource: releasePointsTexture.createView() },
  ],
  );

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

  device.queue.writeBuffer(settingsBuffer, 0, simSettings.createBuffer());
  device.queue.writeBuffer(inputPointBuffer, 0, inputPointData);

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const outputTextureSize = 4 * dem.width * dem.height; // 4 bytes per u32
  // const outputTextureBuffer = device.createBuffer({
  //   size: outputTextureSize,
  //   usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  // });
  const outputTextureBuffer = createStorageBuffer(device, outputTextureSize);
  const outputVelocityTextureBuffer = createStorageBuffer(device, outputTextureSize);

  // Create all output buffers
  const simDataBufferSize = TRACKED_TRAJECTORIES * SimData.timeStepByteSize * simSettings.maxSteps;
  const simInfoBuffer = createStorageBuffer(device, SimInfo.byteSize);
  const outBuffer = createStorageBuffer(device, simDataBufferSize);
  const outDebug = createStorageBuffer(device, 4 * 100);
  const outAtomicBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  const readbackSimInfo = createReadbackBuffer(device, SimInfo.byteSize);
  const readbackSimData = createReadbackBuffer(device, simDataBufferSize);
  const readbackDebug = createReadbackBuffer(device, 100 * 4);
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
    { binding: 8, resource: { buffer: outDebug } },
    { binding: 9, resource: { buffer: outputTextureBuffer } },
    { binding: 10, resource: { buffer: outputVelocityTextureBuffer } },
    { binding: 11, resource: { buffer: outAtomicBuffer } },
  ],
  );

  // Encode commands
  const commandEncoder = device.createCommandEncoder();
  shaders.normals.createComputePass(commandEncoder);
  shaders.releasePoints.createComputePass(commandEncoder);
  shaders.trajectory.createComputePass(commandEncoder, n = simSettings.numberTrajectories);

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

  commandEncoder.copyBufferToBuffer(outDebug, 0, readbackDebug, 0, 100 * 4);
  commandEncoder.copyBufferToBuffer(outDebugNormals, 0, readbackDebugNormals, 0, 10 * 4);
  
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
  const bufferSimData = await readBuffer(readbackSimData, simDataBufferSize, Float32Array);
  const bufferOutputTexture = await readBuffer(readbackOutputTexture, outputTextureSize, Uint32Array);
  const bufferVelocityTexture = await readBuffer(readbackVelocityTexture, outputTextureSize, Uint32Array);
  const totalTimesteps = await readBuffer(readbackAtomicBuffer, 4, Uint32Array);
  console.log("Total timesteps: ", totalTimesteps[0]);

  const bufferDebug = await readBuffer(readbackDebug, 100 * 4, Float32Array);
  descriptions = ["normalx", "normaly", "u", "v", "elevation", "elevation_threshold", "", "xmin", "ymin", "xmax", "ymax"];
  var line = "";
  for (let i = 0; i < 100; i++) {
    const desc = descriptions[i] || "";
    if (bufferDebug[i] == 0 && desc == "") continue; // Skip empty descriptions
    line += `${i} ${desc}: ${bufferDebug[i].toFixed(2)}, `;
  }
  console.log("Debug info trajectory: ", line);

  const bufferDebugNormals = await readBuffer(readbackDebugNormals, 10 * 4, Float32Array);
  descriptions = ["nx", "ny", "nz", "dzdx", "dzdy"];
  line = "";
  for (let i = 0; i < 10; i++) {
    const desc = descriptions[i] || "";
    if (bufferDebugNormals[i] == 0 && desc == "") continue; // Skip empty descriptions
    line += `(${i}) ${desc}: ${bufferDebugNormals[i].toFixed(4)}, `;
  }
  console.log("Debug info normals: ", line);
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
  simData.parse(bufferSimData, simInfo.stepCount, TRACKED_TRAJECTORIES);

  console.log([...bufferSimData.slice(0, 16)]); // Log first 16 floats for debugging
  simTimer.printSummary();
  simData.parseVelocityTexture([...bufferVelocityTexture]);
  simData.parseCellCountTexture([...bufferOutputTexture]);
  simData.parseReleasePointTexture(releasePoints)
  simTimer.checkpoint("parse results");
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

function createDemTextureAndBuffer(device) {
  const bytesPerRow = Math.ceil(dem.width * 4 / 256) * 256; // 4 bytes per float32 pixel, must be aligned to 256 bytes

  const texture = device.createTexture({
    size: [dem.width, dem.height, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST,
  });

  const textureBuffer = device.createBuffer({
    size: bytesPerRow * dem.height,
    usage: GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });

  const mappedRange = textureBuffer.getMappedRange();
  const dst = new Float32Array(mappedRange);

  for (let row = 0; row < dem.height; row++) {
    const srcOffset = row * dem.width;
    const dstOffset = (bytesPerRow / 4) * row;
    dst.set(dem.data1d.subarray(srcOffset, srcOffset + dem.width), dstOffset);
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
    [dem.width, dem.height, 1]
  );
  device.queue.submit([copyEncoder.finish()]);

  return texture;
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
