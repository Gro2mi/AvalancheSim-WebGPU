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
    predefinedReleasePoints = true;
    const selectedFile = event.target.value;
    localStorage.setItem('demDropdown', selectedFile);
    await dem.loadPNGAsFloat32(selectedFile);
    plotDem(dem);
    await fetchInputs();
    if (!isMobileDevice) {
        runAndPlot();
    }
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
function setSettingsDisabled(flag) {
    const controls = document.querySelectorAll('#simSettingsDiv input, #simSettingsDiv select, #simSettingsDiv textarea, #simSettingsDiv button');
    controls.forEach(el => el.disabled = flag);
    runButton.disabled = flag;
    prepareButton.disabled = flag;
    changeFrictionModel();
    if (flag) {
        runButton.textContent = "Running...";
    } else {
        runButton.textContent = "Run Simulation";
    }
}

// Disable all

// Enable all
const simSettingsDiv = document.getElementById('simSettingsDiv')
const runButton = document.getElementById('runSimulation')
const prepareButton = document.getElementById('prepareSimulation')
runButton.addEventListener('click', async () => {
    await runAndPlot();
});
prepareButton.addEventListener('click', async () => {
    await run(simSettings, dem, release_point, predefinedReleasePoints);
    plotVariable.value = 'slopeAspect';
    plotVariable.dispatchEvent(new Event('change'));
});

async function runAndPlot() {
    console.log('Run simulation');
    setSettingsDisabled(true);
    try {
        await run(simSettings, dem, release_point, predefinedReleasePoints);
        plotOutput();
        plotPosition();
        plotHistogram();
        simTimer.checkpoint('plotting');
        plotTimer();
        plotVariable.value = 'cellCount';
        plotVariable.dispatchEvent(new Event('change'));
    } catch (error) {
        console.error('Error during simulation:', error);
    }
    setSettingsDisabled(false);
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
    } else if (!adapter.features.has("float32-filterable") || (debug && !adapter.features.has("timestamp-query"))) {
        alert("Your device has to support float32-filterable textures and timestamp-query to run this simulation.");
        runButton.disabled = true;
        runButton.textContent = "WebGPU features not supported";
    } else {
        console.log("Adapter limits:", adapter.limits);
        console.log("Adapter features:", [...adapter.features]);
        const maxInvocations = adapter.limits.maxComputeInvocationsPerWorkgroup;
        const workgroupSizeXY = Math.floor(Math.sqrt(maxInvocations));
        console.log("Release point:", release_point);
        device = await adapter.requestDevice({
            requiredFeatures: ["float32-filterable", 'timestamp-query'],
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

    await dem.loadPNGAsFloat32(simSettings.casename);
    // const gpxString = await fetch('gpx/NockspitzeNDirectTop.gpx').then(response => response.text());
    // gpx = parseGPX(gpxString);
    // await dem.loadTiles(gpx, zoom = zoomLevelSlider.value)
    console.log("dem width:", dem.bounds.width, "height:", dem.bounds.height);
    plotDem(dem); // Initial plot
    // plotGpx(gpx); // Initial plot
    // await computeNormalsFromDemTexture(settings, dem);
    if (!isMobileDevice) {
        runAndPlot();
    }
}


var gpx;
var tiles = [];
document.getElementById("gpxfile").addEventListener("change", async (e) => {
    predefinedReleasePoints = false;
    const file = e.target.files[0];
    if (!file) return;

    gpxString = await file.text();
    tiles = [];
    gpx = parseGPX(gpxString);
    await dem.loadTiles(gpx, zoom = zoomLevelSlider.value)

    plotDem(dem);
    plotGpx(gpx);
    if (!isMobileDevice) {
        runAndPlot();
    }
});

debug = false;
let predefinedReleasePoints = true;
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("debug") === "vscode") {
    debug = true;
    console.log("Running in VS Code debug session");
}
isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

main();