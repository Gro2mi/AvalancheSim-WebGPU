var dem = new Dem();

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

const zoomLevelSlider = document.getElementById('zoomLevelSlider');
const zoomLevelValue = document.getElementById('zoomLevelValue');
zoomLevelValue.textContent = zoomLevelSlider.value + ' Resolution: ' + pixelWidthMeters(zoomLevelSlider.value, 47.2).toFixed(2) + ' m';
zoomLevelSlider.addEventListener('change', () => {
    zoomLevelValue.textContent = zoomLevelSlider.value + ' Resolution: ' + pixelWidthMeters(zoomLevelSlider.value, 47.2).toFixed(2) + ' m';
    dem.loadTiles(gpx, zoom = zoomLevelSlider.value).then(() => {
        plotDem(dem);
        plotGpx(gpx)
    });

});

demDropdown.addEventListener('change', async (event) => {
    const selectedFile = event.target.value;
    localStorage.setItem('demDropdown', selectedFile);
    await dem.loadPNGAsFloat32(selectedFile);
    plotDem(dem);
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
    plotHistogram();
}

plotVariable = document.getElementById('plotVariable');
plotVariable.addEventListener('change', async (event) => {
    const selectedVariable = event.target.value;
    updatePlots(selectedVariable)
});

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
    release_points = await loadReleasePoints(simSettings.casename);
    release_point = release_points.centroids[0]
    return true;
}
var simSettings = new SimSettings();
var release_points;
var release_point;
// fetchAabb(demDropdown.value);
async function main() {
    const adapter = await navigator.gpu?.requestAdapter({
        powerPreference: 'high-performance',
        featureLevel: 'compatibility',
    });

    if (!adapter) {
        alert("WebGPU is not supported or failed to initialize. Please use a compatible browser like Chrome.");
        runButton.disabled = true;
        runButton.textContent = "WebGPU not supported";
    } else if (!adapter.features.has("float32-filterable")) {
        alert("Your device has to support float32-filterable textures to run this.");
        runButton.disabled = true;
        runButton.textContent = "WebGPU not supported";
    } else {
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
            console.error('WebGPU device lost:', err);
            alert('WebGPU device lost.', err);
        });
    }

    changeFrictionModel();
    // await getSettings();
    await fetchInputs();
    
    // await dem.loadPNGAsFloat32(simSettings.casename);
    const gpxString = await fetch('gpx/NockspitzeNDirectTop.gpx').then(response => response.text());
    gpx = parseGPX(gpxString);
    await dem.loadTiles(gpx, zoom = zoomLevelSlider.value)
    console.log("dem width:", dem.bounds.width, "height:", dem.bounds.height);
    plotDem(dem); // Initial plot
    plotGpx(gpx); // Initial plot
    
    // await computeNormalsFromDemTexture(settings, dem);
    if (!isMobileDevice) {
        run(simSettings, dem, release_point).then(() => {
            plotOutput();
            plotPosition();
            plotTimer();
            plotHistogram();
        });
    }    
}


var gpx;
var tiles = [];
document.getElementById("gpxfile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    gpxString = await file.text();
    tiles = [];
    gpx = parseGPX(gpxString);
    await dem.loadTiles(gpx, zoom = zoomLevelSlider.value)
    plotDem(dem);
    plotGpx(gpx);

});

debug = false;
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("debug") === "vscode") {
    debug = true;
    console.log("Running in VS Code debug session");
}
isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

main();