
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
    await run(settings, dem, release_point);
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
    await settings.set(
        casename = demDropdown.value,
        maxSteps = parseInt(stepSlider.value),
        simModel = 0,
        frictionModel = frictionModelDropdown.selectedIndex,
        density = 200,
        slabThickness = 1,
        frictionCoefficient = frictionCoefficientSlider.value,
        dragCoefficient = dragCoefficientSlider.value,
        cfl = parseFloat(cflSlider.value),
    )
}

async function loadReleasePoints(casename) {
    const response = await fetch('dem/' + casename + '.rp');  // Path to your JSON file
    const jsonData = await response.json();
    return jsonData;
}

async function fetchInputs() {
    await getSettings();
    dem = await loadPNGAsFloat32(settings.casename);
    release_points = await loadReleasePoints(settings.casename);
    release_point = release_points.centroids[0]
    x = linspace(settings.bounds.xmin, settings.bounds.xmax, dem.width);
    y = linspace(settings.bounds.ymin, settings.bounds.ymax, dem.height);
    return true;
}
var settings = new SimSettings();
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
    console.log("Release point:", release_point);
    device = await adapter.requestDevice({
        requiredFeatures: ["float32-filterable"],
    });
    await run(settings, dem, release_point);
    plotOutput();
    plotPosition();
    plotTimer();
}

main();