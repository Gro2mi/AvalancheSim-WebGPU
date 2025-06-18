
async function plotDem(dem) {
    try {
        dem2d = to2DFloatArray(dem.arr1d, dem.width, dem.height).map(typedArr => Array.from(typedArr))
        z = dem2d.map(row => row.map(val => (val < 1 ? null : val)));
        const surfaceDem = {
            x: x,
            y: y,
            z: [...z],
            type: 'surface',
            colorscale: 'Greys',
            cmin: 0,
            cmax: 4000,
            // reversescale: true,
            contours: {
                z: {
                    show: true,
                    start: 0,
                    end: 4000,
                    size: 200,                 // Contours at 0, 10, 20, ..., 100
                    color: 'white',
                    project: { z: false }
                },
            },
        };

        // Combine the DEM surface and trajectory
        const data = [surfaceDem];
        // const data = [dem2];

        const layout = layout_3d;

        Plotly.newPlot('demPlot', data, layout);
    } catch (error) {
        console.error('Error loading or plotting data:', error);
    }
}

let layout_3d = {
    title: '3D DEM Plot',

    template: 'plotly_dark',
    autosize: true,
    scene: {
        aspectmode: 'data',
        zaxis: {
            title: 'Elevation',
            titlefont: { color: '#bbb' },
            gridcolor: '#aaa',
            tickfont: { color: '#ccc' }
        },
        xaxis: {
            title: 'X',
            titlefont: { color: '#bbb' },
            gridcolor: '#aaa',
            tickfont: { color: '#ccc' }
        },
        yaxis: {
            title: 'Y',
            titlefont: { color: '#bbb' },
            gridcolor: '#aaa',
            tickfont: { color: '#ccc' }
        }
    },
    margin: { l: 0, r: 0, b: 0, t: 0 },
    paper_bgcolor: '#111',
};

const layout2d = {
    title: 'Simulation Output',
    template: 'plotly_dark',
    autosize: true,
    xaxis: {
        title: 'Position X',
        titlefont: { color: '#bbb' },
        gridcolor: '#aaa',
        tickfont: { color: '#ccc' },
        zeroline: false,
    },
    yaxis: {
        title: 'Parameter',
        titlefont: { color: '#bbb' },
        gridcolor: '#aaa',
        tickfont: { color: '#ccc' },
        zeroline: false,
    },
    legend: {
        font: {
            color: '#fff',  // Bright white text
        },
        bgcolor: 'rgba(0,0,0,0)',  // Transparent background (optional)
        bordercolor: '#444',       // Optional border
        borderwidth: 0
    },
    margin: { l: 40, r: 10, b: 40, t: 40 },
    paper_bgcolor: '#111',
    plot_bgcolor: '#111',
};


function plotPosition() {
    const lineTrace = {
        type: 'scatter3d',
        mode: 'lines+markers',
        x: position.x,
        y: position.y,
        z: elevation,
        line: {
            color: 'red',
            width: 4
        },
        marker: {
            size: 3,
            color: 'red'
        },
        name: 'Trajectory'
    };
    try {
        const index = demPlot.data.findIndex(trace => trace.name === 'Trajectory');
        if (index !== -1) {
            // If the trace exists, remove it
            Plotly.deleteTraces(demPlot, index);
        }
    } catch (TypeError) {
        // If the plotDiv.data is undefined, we can skip the deletion
        console.warn('demPlot.data is undefined, skipping trace deletion.');
    }
    Plotly.addTraces(demPlot, [lineTrace]);
}

function plotOutput() {
    let n = timestep.length;
    let x = time;
    const friction = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: accelerationFrictionMagnitude,
        name: 'Friction Acceleration',
        visible: 'legendonly',
    };
    const tangential = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: accelerationTangentialMagnitude,
        name: 'Tangential Acceleration',
        visible: 'legendonly',
    };
    const dt = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: timestep,
        name: 'Timestep',
        visible: 'legendonly',
    };
    const traceCfl = {
        type: 'scatter',
        mode: 'lines',
        // first element is zero due to velocity being zero at the start
        x: x.slice(1),
        y: cfl.slice(1),
        name: 'CFL',
        visible: 'legendonly',
    };
    const traceVelocityMagnitude = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: velocityMagnitude,
        name: 'Velocity Magnitude',
        visible: 'legendonly',
    };

    const tracePositionZ = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: position.z,
        name: 'Position Z',
        visible: 'legendonly',
    };

    const traceElevation = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        // last elevation point is outside the domain
        y: elevation.slice(0, n - 1),
        name: 'Elevation',
        visible: 'legendonly',
    };
    const tracePositionZError = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: substract(elevation, position.z).slice(0, n - 1),
        name: 'Position Z Error',
        visible: 'legendonly',
    };
    const traceDiffElevation = {
        type: 'scatter',
        mode: 'lines',
        x: x.slice(0, n - 2),
        y: diff(elevation).slice(0, n - 1),

        name: 'Diff Elevation',
        visible: 'legendonly',
    };
    const traceDiffZ = {
        type: 'scatter',
        mode: 'lines',
        x: x.slice(0, n - 2),
        y: diff(position.z).slice(0, n - 1),

        name: 'Diff Position Z',
        visible: 'legendonly',
    };
    const traceNormalX = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: normal.x,

        name: 'Normal X',
        visible: 'legendonly',
    };
    const traceNormalY = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: normal.y,

        name: 'Normal Y',
        visible: 'legendonly',
    };
    const traceNormalZ = {
        type: 'scatter',
        mode: 'lines',
        x: x,
        y: normal.z,

        name: 'Normal Z',
        visible: 'legendonly',
    };
    const traceStepDistance = {
        type: 'scatter',
        mode: 'lines',
        x: x.slice(0, n - 1),
        y: stepDistance,

        name: 'Step Distance',
        // visible: 'legendonly',
    };
    let layout = { ...layout2d };
    layout.font = { color: 'white' };
    layout.template = ['plotly_dark'];
    layout.updatemenus = [{
        buttons: [
            {
                method: 'restyle',
                args: ['x', [travelDistance]],
                label: 'Travel Distance [m]'
            },
            {
                method: 'restyle',
                args: ['x', [time]],
                label: 'Time [s]'
            },
            {
                method: 'restyle',
                args: ['x', [Array.from({ length: n }, (_, i) => i)]],
                label: 'Timestep [#]'
            }
        ],
        direction: 'up',
        showactive: true,
        x: 1,
        xanchor: 'right',
        y: 0,
        yanchor: 'top',
    }];

    const traces = [
        friction,
        tangential,
        dt,
        traceCfl,
        traceVelocityMagnitude,
        tracePositionZ,
        traceElevation,
        tracePositionZError,
        traceDiffElevation,
        traceDiffZ,
        traceNormalX,
        traceNormalY,
        traceNormalZ,
        traceStepDistance,
    ]

    Plotly.newPlot('outputPlot', traces, layout).then(() => {
        // Restore visibility AFTER plot is rendered
        restoreTraceVisibility(outputPlot, traces);

        // Attach listener to save visibility changes
        outputPlot.on('plotly_restyle', () => {
            const visibility = outputPlot.data.map(trace => trace.visible ?? true);
            localStorage.setItem('traceVisibility', JSON.stringify(visibility));
        });
    });
}
var outputPlot = document.getElementById('outputPlot');
var demPlot = document.getElementById('demPlot');

function restoreTraceVisibility(plotElement, traces) {
    const saved = localStorage.getItem('traceVisibility');
    if (!saved) return;

    const visibility = JSON.parse(saved);
    const update = { visible: visibility };
    Plotly.restyle(plotElement, update);
}