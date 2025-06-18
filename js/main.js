var casename;

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

demDropdown.addEventListener('change', (event) => {
    const selectedFile = event.target.value;
    document.cookie = `demDropdown=${selectedFile}; path=/; max-age=31536000`; // expires in 1 year

    // fetchAndPlotDem(selectedFile);
    fetchInputs().then(() => {
        plotDem(dem);
    })
});

frictionModelDropdown.addEventListener('change', (event) => {
    changeFrictionModel();
});

function changeFrictionModel() {
    const selectedModel = frictionModelDropdown.selectedOptions[0].text;
    if (selectedModel == 'Coulomb') {
        frictionCoefficientSlider.value = 0.4663;
        frictionCoefficientValue.textContent = frictionCoefficientSlider.value;
        dragCoefficientSlider.disabled = true;
    } else {
        frictionCoefficientSlider.value = 0.155;
        frictionCoefficientValue.textContent = frictionCoefficientSlider.value;
        dragCoefficientSlider.disabled = false;
    }
}

document.getElementById('runSimulation').addEventListener('click', async () => {
    await runAndPlot();
});

async function runAndPlot() {
    console.log('Run simulation');
    await fetchInputs();
    await run(settings, dem, release_point);
    plotOutput();
    plotPosition();
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
    const cookies = document.cookie.split(';').map(c => c.trim());
    const cookieObj = Object.fromEntries(cookies.map(c => c.split('=')));

    if (cookieObj.demDropdown) {
        demDropdown.value = cookieObj.demDropdown;
    }
});

function getSettings() {
    settings.set(
        casename = demDropdown.value,
        maxSteps = parseInt(stepSlider.value),
        simModel = 0,
        frictionModel = frictionModelDropdown.selectedIndex,
        density = 200,
        slabThickness = 1,
        frictionCoefficient = frictionCoefficientSlider.value,
        dragCoefficient = 4000.0,
        cfl = parseFloat(cflSlider.value),
    )
}

async function loadReleasePoints(casename) {
    const response = await fetch('dem/' + casename + '.rp');  // Path to your JSON file
    const jsonData = await response.json();
    return jsonData;
}

async function fetchInputs() {
    getSettings();
    aabb = await fetchBounds(demDropdown.value);
    console.log("Returned AABB buffer:", aabb);
    dem = await loadPNGAsFloat32(settings.casename);
    release_points = await loadReleasePoints(settings.casename);
    release_point = release_points.centroids[0]
    x = linspace(settings.bounds.xmin, settings.bounds.xmax, dem.width);
    y = linspace(settings.bounds.ymin, settings.bounds.ymax, dem.height);
    return true;
}
var settings = new Settings();
var release_points;
var release_point;
// fetchAabb(demDropdown.value);
async function main() {
    if (!navigator.gpu) {
        console.error("WebGPU not supported");
        alert("WebGPU not supported. Please use a compatible browser like Chrome.");
        return;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter.features.has("float32-filterable")) {
        alert("Your device has to support float32-filterable textures to run this.");
    }
    changeFrictionModel();
    // await getSettings();
    await fetchInputs();
    plotDem(dem); // Initial plot
    // await computeNormalsFromDemTexture(settings, dem);
    console.log("Release point:", release_point);
    await run(settings, dem, release_point);
    plotOutput();
    plotPosition();
}

main();