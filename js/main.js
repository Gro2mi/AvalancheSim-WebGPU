
const demDropdown = document.getElementById('demDropdown');
const frictionModelDropdown = document.getElementById('frictionModelDropdown');

const stepSlider = document.getElementById('stepSlider');
const stepSliderValue = document.getElementById('stepSliderValue');
stepSlider.addEventListener('input', () => {
    stepSliderValue.textContent = stepSlider.value;
});

const cflSlider = document.getElementById('cflSlider');
const cflSliderValue = document.getElementById('cflSliderValue');
cflSlider.addEventListener('input', () => {
    cflSliderValue.textContent = cflSlider.value;
});

const frictionCoefficientSlider = document.getElementById('frictionCoefficientSlider');
const frictionCoefficientValue = document.getElementById('frictionCoefficientValue');
frictionCoefficientSlider.addEventListener('input', () => {
    frictionCoefficientValue.textContent = frictionCoefficientSlider.value;
});
const dragCoefficientSlider = document.getElementById('dragCoefficientSlider');
const dragCoefficientValue = document.getElementById('dragCoefficientValue');
dragCoefficientSlider.addEventListener('input', () => {
    dragCoefficientValue.textContent = dragCoefficientSlider.value;
});
const numberTrajectoriesSlider = document.getElementById('numberTrajectoriesSlider');
const numberTrajectoriesValue = document.getElementById('numberTrajectoriesValue');
numberTrajectoriesSlider.addEventListener('input', () => {
    numberTrajectoriesValue.textContent = numberTrajectoriesSlider.value;
});

demDropdown.addEventListener('change', async (event) => {
    const selectedFile = event.target.value;
    localStorage.setItem('demDropdown', selectedFile);
    fetchInputs().then(() => {
        plotDem(dem);
    })
    await runAndPlot();
});

frictionModelDropdown.addEventListener('change', (event) => {
    changeFrictionModel();
});

function changeFrictionModel() {
    const selectedModel = frictionModelDropdown.selectedOptions[0].text;
    if (selectedModel == 'Coulomb') {
        frictionCoefficientSlider.value = 0.4663;
        frictionCoefficientValue.textContent = frictionCoefficientSlider.value;
    } else {
        frictionCoefficientSlider.value = 0.155;
        frictionCoefficientValue.textContent = frictionCoefficientSlider.value;
    }
    if (selectedModel == 'Coulomb' || selectedModel == 'samosAT') {
        dragCoefficientSlider.disabled = true;
    } else {
        dragCoefficientSlider.disabled = false;
    }
}
const runButton = document.getElementById('runSimulation')
runButton.addEventListener('click', async () => {
    await runAndPlot();
});

async function runAndPlot() {
    console.log('Run simulation');
    await fetchInputs();
    await run(simSettings, dem, release_point);
    plotOutput();
    plotPosition();
    plotTimer();
}

document.addEventListener('keydown', async function (event) {
    console.log('Key pressed:', event.key);

    if (event.key === 'Enter') {
        console.log('Enter was pressed!');
    }

    if (event.key === 'r') {
        await runAndPlot();
    }
});

window.addEventListener('DOMContentLoaded', () => {
    const savedFile = localStorage.getItem('demDropdown');
    if (savedFile) {
        demDropdown.value = savedFile;
    }
});

async function getSettings() {
    await simSettings.set(
        casename = demDropdown.value,
        maxSteps = parseInt(stepSlider.value),
        simModel = 0,
        frictionModel = frictionModelDropdown.selectedIndex,
        density = 200,
        slabThickness = 1,
        frictionCoefficient = frictionCoefficientSlider.value,
        dragCoefficient = dragCoefficientSlider.value,
        cfl = parseFloat(cflSlider.value),
        numberTrajectories = parseInt(numberTrajectoriesSlider.value),
    )
}

async function loadReleasePoints(casename) {
    const response = await fetch('dem/' + casename + '.rp');  // Path to your JSON file
    const jsonData = await response.json();
    return jsonData;
}

async function fetchInputs() {
    await getSettings();
    dem = await loadPNGAsFloat32(simSettings.casename);
    release_points = await loadReleasePoints(simSettings.casename);
    release_point = release_points.centroids[0]
    x = linspace(simSettings.bounds.xmin, simSettings.bounds.xmax, dem.width);
    y = linspace(simSettings.bounds.ymin, simSettings.bounds.ymax, dem.height);
    return true;
}
var simSettings = new SimSettings();
var release_points;
var release_point;
// fetchAabb(demDropdown.value);
async function main() {
    if (!navigator.gpu) {
        console.error("WebGPU not supported");
        alert("WebGPU not supported. Please use a compatible browser like Chrome.");
        runButton.disabled = true;
        runButton.textContent = "WebGPU not supported";
    }
    try {
        adapter = await navigator.gpu.requestAdapter();
        if (!adapter.features.has("float32-filterable")) {
            alert("Your device has to support float32-filterable textures to run this.");
            runButton.disabled = true;
            runButton.textContent = "WebGPU not supported";
        }
    } catch (error) {
        console.error("WebGPU not supported.", error);
        alert("WebGPU not supported. Please use a compatible browser like Chrome.");
        runButton.disabled = true;
        runButton.textContent = "WebGPU not supported";
    }
    changeFrictionModel();
    // await getSettings();
    await fetchInputs();
    plotDem(dem); // Initial plot
    // await computeNormalsFromDemTexture(settings, dem);
    
    console.log("Adapter limits:", adapter.limits);
    const maxInvocations = adapter.limits.maxComputeInvocationsPerWorkgroup;
    const workgroupSizeXY = Math.floor(Math.sqrt(maxInvocations));
    console.log("Release point:", release_point);
    device = await adapter.requestDevice({
        requiredFeatures: ["float32-filterable"],
        requiredLimits: {
            maxComputeWorkgroupSizeX: workgroupSizeXY,
            maxComputeWorkgroupSizeY: workgroupSizeXY,
            maxComputeWorkgroupSizeZ: 1,
            maxComputeInvocationsPerWorkgroup: maxInvocations
        }
    });
    device.lost.then(err => {
        onsole.error('WebGPU device lost:', err);
        alert('WebGPU device lost.', err);
    });
    await run(simSettings, dem, release_point);
    plotOutput();
    plotPosition();
    plotTimer();
}
var tiles = [];
document.getElementById("gpxfile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    tiles =  [];
    try {
        const bbox = await getGPXBoundingBoxWithMargin(text, 0); // 500m margin
        document.getElementById("output").textContent = JSON.stringify(bbox, null, 2);
        console.log("Bounding Box:", bbox);
        await fetchAndCacheTiles([bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon], 18);
    } catch (err) {
        document.getElementById("output").textContent = "Error: " + err.message;
        console.error("Error calculating bounding box:", err);
    }

});

async function test(){
    const text = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<gpx version="1.1" creator="outdooractive - http://www.outdooractive.com" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd" xmlns:oa="http://www.outdooractive.com/GPX/Extensions/1">
  <metadata>
    <name>avaReleaseArea</name>
    <author>
      <name>M L - Community</name>
    </author>
    <link href="https://www.outdooractive.com/r/316416088"/>
    <time>2025-05-23T13:30:51.290Z</time>
    <extensions>
      <oa:oaCategory>trailRunning</oa:oaCategory>
    </extensions>
  </metadata>
  <trk>
    <name>avaReleaseArea</name>
    <type>trailRunning</type>
    <trkseg>
      <trkpt lat="47.179767" lon="11.279978">
        <ele>2240.45918</ele>
        <name>Apres Ski und Schirmbar 2340 Hoadlhaus, Axams</name>
      </trkpt>
      <trkpt lat="47.176399" lon="11.278369">
        <ele>2012.8489</ele>
      </trkpt>
      <trkpt lat="47.176508" lon="11.283357">
        <ele>2238.43237</ele>
        <name>Hochtennboden, Axams</name>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;
        const bbox = await getGPXBoundingBoxWithMargin(text, 0); // 500m margin
        console.log("Bounding Box:", bbox);
        const {tiles, nTilesX, nTilesY} = await fetchAndCacheTiles([bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon], 18);
        const stitchedCanvas = stitchTilesCropped(tiles, 64, nTilesX, nTilesY);
        document.body.appendChild(stitchedCanvas);
}
// test().then(() => {
main();
// });
debug = false;
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("debug") === "vscode") {
    debug = true;
    console.log("Running in VS Code debug session");
}
// fetch('https://alpinemaps.cg.tuwien.ac.at/tiles/alpine_png/18/139323/170149.png') // Replace with actual CORS-enabled image URL
//       .then(response => {
//         if (!response.ok) throw new Error('Network response was not ok');
//         return response.blob();
//       })
//       .then(blob => {
//         const imageUrl = URL.createObjectURL(blob);
//         document.getElementById('fetched-image').src = imageUrl;
//       })
//       .catch(error => {
//         console.error('There was a problem fetching the image:', error);
//       });