const GRID_ROWS = 180;
const GRID_COLUMNS = 360;
const BOUNDARY_COUNT = 9;
const MATERIAL_LAYER_COUNT = 9;
const MANTLE_EXTENSION_KM = 5;

const LAYER_NAMES = [
    "Water",
    "Ice",
    "Upper sediments",
    "Middle sediments",
    "Lower sediments",
    "Upper crystalline crust",
    "Middle crystalline crust",
    "Lower crystalline crust",
    "Upper mantle"
];

const BOUNDARY_NAMES = [
    "Surface / topography",
    "Water bottom",
    "Ice bottom",
    "Upper-sediment bottom",
    "Middle-sediment bottom",
    "Lower-sediment bottom",
    "Upper-crust bottom",
    "Middle-crust bottom",
    "Moho"
];

const PROPERTY_METADATA = {
    ro: {
        label: "Density",
        unit: "g/cm³",
        colorbarTitle: "Density<br>(g/cm³)"
    },
    vp: {
        label: "P-wave velocity",
        unit: "km/s",
        colorbarTitle: "P-wave velocity<br>(km/s)"
    },
    vs: {
        label: "S-wave velocity",
        unit: "km/s",
        colorbarTitle: "S-wave velocity<br>(km/s)"
    }
};

const SECTION_COLORSCALE = [
    [0.00, "#fffdf2"],
    [0.22, "#ffe66b"],
    [0.48, "#ff9f1c"],
    [0.72, "#d62828"],
    [1.00, "#240000"]
];

const gridCache = new Map();
let landDataPromise;

function setStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
}

function parseGrid(text, fileName) {
    const rows = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(/\s+/).map(Number));

    if (rows.length !== GRID_ROWS || rows.some(row => row.length !== GRID_COLUMNS)) {
        throw new Error(
            `${fileName} has an unexpected grid size (expected ${GRID_ROWS} × ${GRID_COLUMNS}).`
        );
    }
    if (rows.some(row => row.some(value => !Number.isFinite(value)))) {
        throw new Error(`${fileName} contains a non-numeric value.`);
    }
    return rows;
}

function loadGrid(gridName) {
    if (!gridCache.has(gridName)) {
        const request = fetch(`maps/map-${gridName}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Could not load map-${gridName} (HTTP ${response.status}).`);
                }
                return response.text();
            })
            .then(text => parseGrid(text, `map-${gridName}`))
            .catch(error => {
                gridCache.delete(gridName);
                throw error;
            });
        gridCache.set(gridName, request);
    }
    return gridCache.get(gridName);
}

function getLayerName() {
    let layerNumber = Number(document.getElementById("layer").value.slice(1));
    let property = document.getElementById("property").value;

    if (property === "lower") {
        layerNumber += 1;
    }
    if (property === "upper" || property === "lower") {
        property = "bd";
    }
    return `${property}${layerNumber}`;
}

async function loadMap() {
    const button = document.getElementById("ok");
    const status = document.getElementById("map-status");
    button.disabled = true;
    setStatus(status, "Loading map grid…");

    try {
        const grid = await loadGrid(getLayerName());
        await drawMap(grid);
        setStatus(status, "Map ready.");
    } catch (error) {
        console.error(error);
        setStatus(status, error.message || "The map could not be displayed.", true);
    } finally {
        button.disabled = false;
    }
}

function gridExtent(grid) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const row of grid) {
        for (const value of row) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
        }
    }
    return [minimum, maximum];
}

function getLandData() {
    if (!landDataPromise) {
        landDataPromise = d3
            .json("https://unpkg.com/world-atlas@1.1.4/world/110m.json")
            .then(world => topojson.feature(world, world.objects.land))
            .catch(error => {
                landDataPromise = null;
                throw error;
            });
    }
    return landDataPromise;
}

async function drawMap(grid) {
    const width = 1200;
    const height = 600;
    const [minimum, maximum] = gridExtent(grid);
    const output = d3.select("#map-output");
    output.selectAll("*").remove();

    const layerSelection = document.getElementById("layer");
    const propertySelection = document.getElementById("property");
    const titleText =
        `${layerSelection.options[layerSelection.selectedIndex].text} – ` +
        propertySelection.options[propertySelection.selectedIndex].text.toLowerCase();

    const projection = d3
        .geoEqualEarth()
        .scale(2 * width / (2 * Math.PI))
        .translate([width / 2, height / 2])
        .clipExtent([[0, 0], [width, height]]);

    const outerContainer = output
        .append("div")
        .attr("id", "map-container")
        .style("position", "relative");

    outerContainer
        .append("h3")
        .text(titleText)
        .style("text-align", "center")
        .style("margin", "20px 0 8px");

    const container = outerContainer
        .append("div")
        .style("position", "relative")
        .style("display", "inline-block");

    const canvas = container
        .append("canvas")
        .attr("width", width)
        .attr("height", height);

    const context = canvas.node().getContext("2d");
    const path = d3.geoPath().projection(projection).context(context);
    const land = await getLandData();

    context.save();
    context.beginPath();
    path({type: "Sphere"});
    context.clip();

    const scaleWidth = 256;
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = scaleWidth;
    colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext("2d");
    const gradient = colorContext.createLinearGradient(0, 0, scaleWidth, 0);
    const colors = ["#000083", "#003caa", "#05ffff", "#ffff00", "#fa0000", "#800000"];
    const positions = [0, 0.125, 0.375, 0.625, 0.875, 1];
    colors.forEach((color, index) => gradient.addColorStop(positions[index], color));
    colorContext.fillStyle = gradient;
    colorContext.fillRect(0, 0, scaleWidth, 1);
    const colorData = colorContext.getImageData(0, 0, scaleWidth, 1).data;

    const rasterCanvas = document.createElement("canvas");
    rasterCanvas.width = width;
    rasterCanvas.height = height;
    const rasterContext = rasterCanvas.getContext("2d");
    const image = rasterContext.createImageData(width, height);
    const imageData = image.data;
    const valueRange = maximum - minimum;

    for (let pixelY = 0; pixelY < height; pixelY += 1) {
        for (let pixelX = 0; pixelX < width; pixelX += 1) {
            const coordinates = projection.invert([pixelX, pixelY]);
            if (!coordinates) {
                continue;
            }

            const column = Math.floor(coordinates[0] + 180);
            const row = Math.floor(90 - coordinates[1]);
            if (column < 0 || column >= GRID_COLUMNS || row < 0 || row >= GRID_ROWS) {
                continue;
            }

            const value = grid[row][column];
            const normalized = valueRange === 0 ? 0.5 : (value - minimum) / valueRange;
            const colorIndex = Math.max(
                0,
                Math.min(scaleWidth - 1, Math.round(normalized * (scaleWidth - 1)))
            );
            const target = (pixelY * width + pixelX) * 4;
            imageData[target] = colorData[colorIndex * 4];
            imageData[target + 1] = colorData[colorIndex * 4 + 1];
            imageData[target + 2] = colorData[colorIndex * 4 + 2];
            imageData[target + 3] = 200;
        }
    }

    rasterContext.putImageData(image, 0, 0);
    context.drawImage(rasterCanvas, 0, 0);
    context.restore();

    context.beginPath();
    context.strokeStyle = "#707780";
    context.lineWidth = 0.7;
    path(land);
    path(d3.geoGraticule().stepMinor([20, 20]).stepMajor([20, 20])());
    context.stroke();

    const barHeight = height * 0.75;
    const barWidth = 28;
    const topMargin = 15;
    const svg = container
        .append("svg")
        .attr("width", barWidth + 70)
        .attr("height", barHeight + topMargin * 2)
        .style("position", "absolute")
        .style("right", "-28px")
        .style("top", "50%")
        .style("transform", "translateY(-50%)");

    const barGroup = svg.append("g").attr("transform", `translate(0, ${topMargin})`);
    const svgGradient = barGroup
        .append("defs")
        .append("linearGradient")
        .attr("id", "map-color-gradient")
        .attr("x1", "0%")
        .attr("x2", "0%")
        .attr("y1", "100%")
        .attr("y2", "0%");

    colors.forEach((color, index) => {
        svgGradient
            .append("stop")
            .attr("stop-color", color)
            .attr("offset", `${positions[index] * 100}%`);
    });

    barGroup
        .append("rect")
        .attr("x", 10)
        .attr("y", 0)
        .attr("width", barWidth)
        .attr("height", barHeight)
        .style("fill", "url(#map-color-gradient)");

    const colorScale = d3.scaleLinear().domain([minimum, maximum]).range([barHeight, 0]);
    barGroup
        .append("g")
        .attr("transform", `translate(${10 + barWidth}, 0)`)
        .call(d3.axisRight(colorScale).ticks(6))
        .selectAll("text")
        .style("font-size", "11px");
}

function updateCoordinateControl() {
    const direction = document.getElementById("cross-direction").value;
    const input = document.getElementById("cross-coordinate");
    const label = document.getElementById("coordinate-label");
    const isParallel = direction === "parallel";

    label.textContent = isParallel ? "Latitude (°)" : "Longitude (°)";
    input.min = isParallel ? "-89.5" : "-179.5";
    input.max = isParallel ? "89.5" : "179.5";

    const value = Number(input.value);
    if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max)) {
        input.value = "0";
    }
}

function validateCoordinate(direction, rawValue) {
    const coordinate = Number(rawValue);
    const limit = direction === "parallel" ? 89.5 : 179.5;
    if (!Number.isFinite(coordinate) || coordinate < -limit || coordinate > limit) {
        const coordinateName = direction === "parallel" ? "Latitude" : "Longitude";
        throw new RangeError(`${coordinateName} must be between −${limit}° and ${limit}°.`);
    }
    return coordinate;
}

function interpolatePair(first, second, fraction, correctMissingValues) {
    if (correctMissingValues && (first === 0 || second === 0)) {
        return Math.max(first, second);
    }
    return first + (second - first) * fraction;
}

function extractSection(grid, direction, coordinate, correctMissingValues = false) {
    if (direction === "parallel") {
        const rowPosition = 89.5 - coordinate;
        const lowerIndex = Math.floor(rowPosition);
        const upperIndex = Math.ceil(rowPosition);
        const fraction = rowPosition - lowerIndex;

        return grid[lowerIndex].map((value, column) =>
            interpolatePair(
                value,
                grid[upperIndex][column],
                fraction,
                correctMissingValues
            )
        );
    }

    const columnPosition = coordinate + 179.5;
    const lowerIndex = Math.floor(columnPosition);
    const upperIndex = Math.ceil(columnPosition);
    const fraction = columnPosition - lowerIndex;
    const values = [];

    // Emit south-to-north so the latitude axis is naturally increasing.
    for (let row = GRID_ROWS - 1; row >= 0; row -= 1) {
        values.push(
            interpolatePair(
                grid[row][lowerIndex],
                grid[row][upperIndex],
                fraction,
                correctMissingValues
            )
        );
    }
    return values;
}

function sectionXAxis(direction) {
    const count = direction === "parallel" ? GRID_COLUMNS : GRID_ROWS;
    const firstValue = direction === "parallel" ? -179.5 : -89.5;
    return Array.from({length: count}, (_, index) => firstValue + index);
}

async function loadCrossSectionGrids(property) {
    const boundaryRequests = Array.from(
        {length: BOUNDARY_COUNT},
        (_, index) => loadGrid(`bd${index + 1}`)
    );
    const propertyRequests = Array.from(
        {length: MATERIAL_LAYER_COUNT},
        (_, index) => loadGrid(`${property}${index + 1}`)
    );

    const [boundaries, properties] = await Promise.all([
        Promise.all(boundaryRequests),
        Promise.all(propertyRequests)
    ]);
    return {boundaries, properties};
}

function makeLayerFillTrace(x, upper, lower, name, color, propertyValue, metadata) {
    return {
        type: "scatter",
        mode: "lines",
        x: x.concat([...x].reverse()),
        y: upper.concat([...lower].reverse()),
        fill: "toself",
        fillcolor: color,
        line: {color, width: 0.5},
        name: `${name} (${propertyValue.toFixed(2)} ${metadata.unit})`,
        hoverinfo: "skip"
    };
}

function buildSectionHeatmap(x, boundaries, properties, metadata, excludeSediments) {
    const surfaceMaximum = Math.max(...boundaries[0]);
    const mantleBottom = Math.min(...boundaries[BOUNDARY_COUNT - 1]) - MANTLE_EXTENSION_KM;
    const rowCount = 321;
    const depthAxis = Array.from(
        {length: rowCount},
        (_, index) => surfaceMaximum - index * (surfaceMaximum - mantleBottom) / (rowCount - 1)
    );

    // This matches cross_section.py: sediments remain plotted, but layers 3–5
    // are omitted when calculating the color normalization range.
    const colorScaleStartLayer = excludeSediments ? 5 : 2;
    const rockValues = properties
        .slice(colorScaleStartLayer)
        .flat()
        .filter(value => Number.isFinite(value) && value > 0);
    if (rockValues.length === 0) {
        throw new Error(`No valid ${metadata.label.toLowerCase()} values were found in the rock layers.`);
    }
    const minimum = Math.min(...rockValues);
    const maximum = Math.max(...rockValues);
    const z = [];
    const layerText = [];

    for (const depth of depthAxis) {
        const valueRow = [];
        const textRow = [];

        for (let column = 0; column < x.length; column += 1) {
            let layerIndex = -1;
            for (let candidate = 0; candidate < MATERIAL_LAYER_COUNT; candidate += 1) {
                const upper = boundaries[candidate][column];
                const lower = candidate === MATERIAL_LAYER_COUNT - 1
                    ? mantleBottom
                    : boundaries[candidate + 1][column];
                if (upper > lower && depth <= upper && depth >= lower) {
                    layerIndex = candidate;
                    break;
                }
            }

            if (layerIndex >= 2 && properties[layerIndex][column] > 0) {
                valueRow.push(properties[layerIndex][column]);
                textRow.push(LAYER_NAMES[layerIndex]);
            } else {
                valueRow.push(null);
                textRow.push("");
            }
        }
        z.push(valueRow);
        layerText.push(textRow);
    }

    return {
        trace: {
            type: "heatmap",
            x,
            y: depthAxis,
            z,
            text: layerText,
            zmin: minimum,
            zmax: maximum,
            colorscale: SECTION_COLORSCALE,
            colorbar: {
                title: {text: metadata.colorbarTitle, side: "right"},
                thickness: 18,
                len: 0.82
            },
            hoverongaps: false,
            hovertemplate:
                "<b>%{text}</b><br>" +
                "%{x:.1f}°<br>" +
                "Depth: %{y:.2f} km<br>" +
                `${metadata.label}: %{z:.2f} ${metadata.unit}<extra></extra>`
        },
        minimum,
        maximum,
        mantleBottom,
        surfaceMaximum
    };
}

function formatSectionCoordinate(direction, coordinate) {
    if (coordinate === 0) {
        return "0°";
    }
    const suffix = direction === "parallel"
        ? (coordinate > 0 ? "N" : "S")
        : (coordinate > 0 ? "E" : "W");
    const magnitude = Number(Math.abs(coordinate).toFixed(4));
    return `${magnitude}° ${suffix}`;
}

async function plotCrossSection() {
    const direction = document.getElementById("cross-direction").value;
    const property = document.getElementById("cross-property").value;
    const excludeSediments = document.getElementById("exclude-sediments").checked;
    const metadata = PROPERTY_METADATA[property];
    const button = document.getElementById("plot-cross-section");
    const status = document.getElementById("cross-section-status");

    button.disabled = true;
    setStatus(status, "Loading all 9 boundaries and all 9 material-property grids…");

    try {
        if (typeof Plotly === "undefined") {
            throw new Error("Plotly.js did not load. Check the network connection and reload the page.");
        }
        const coordinate = validateCoordinate(
            direction,
            document.getElementById("cross-coordinate").value
        );
        const grids = await loadCrossSectionGrids(property);
        setStatus(status, "Interpolating layers and preparing the cross-section…");

        const x = sectionXAxis(direction);
        const boundaries = grids.boundaries.map(grid =>
            extractSection(grid, direction, coordinate)
        );
        const properties = grids.properties.map(grid =>
            extractSection(grid, direction, coordinate, true)
        );
        const heatmap = buildSectionHeatmap(
            x,
            boundaries,
            properties,
            metadata,
            excludeSediments
        );
        const traces = [heatmap.trace];

        traces.push(
            makeLayerFillTrace(
                x,
                boundaries[0],
                boundaries[1],
                LAYER_NAMES[0],
                "rgba(54, 164, 214, 0.88)",
                properties[0].find(Number.isFinite) ?? 0,
                metadata
            )
        );
        traces.push(
            makeLayerFillTrace(
                x,
                boundaries[1],
                boundaries[2],
                LAYER_NAMES[1],
                "rgba(205, 239, 248, 0.95)",
                properties[1].find(Number.isFinite) ?? 0,
                metadata
            )
        );

        boundaries.forEach((boundary, index) => {
            traces.push({
                type: "scatter",
                mode: "lines",
                x,
                y: boundary,
                name: BOUNDARY_NAMES[index],
                showlegend: false,
                line: {
                    color: index === BOUNDARY_COUNT - 1 ? "#171b20" : "rgba(24, 29, 34, 0.78)",
                    width: index === BOUNDARY_COUNT - 1 ? 1.6 : 0.8
                },
                hovertemplate:
                    `<b>${BOUNDARY_NAMES[index]}</b><br>` +
                    "%{x:.1f}°<br>Depth: %{y:.2f} km<extra></extra>"
            });
        });

        const directionLabel = direction === "parallel" ? "parallel" : "meridian";
        const axisTitle = direction === "parallel" ? "Longitude (°)" : "Latitude (°)";
        const coordinateLabel = formatSectionCoordinate(direction, coordinate);
        const layout = {
            title: {
                text: `CRUST 1.0 cross-section along ${coordinateLabel} ${directionLabel}`,
                x: 0.5,
                xanchor: "center",
                font: {size: 19}
            },
            height: 620,
            margin: {l: 72, r: 94, t: 72, b: 68},
            paper_bgcolor: "#ffffff",
            plot_bgcolor: "#f8fafb",
            hovermode: "closest",
            legend: {
                orientation: "h",
                x: 0,
                y: 1.03,
                xanchor: "left",
                yanchor: "bottom",
                font: {size: 11}
            },
            xaxis: {
                title: {text: axisTitle},
                range: [x[0], x[x.length - 1]],
                showgrid: true,
                gridcolor: "#dfe4e8",
                zerolinecolor: "#aab2b9",
                ticksuffix: "°"
            },
            yaxis: {
                title: {text: "Elevation / depth (km)"},
                range: [heatmap.mantleBottom, heatmap.surfaceMaximum],
                showgrid: true,
                gridcolor: "#dfe4e8",
                zeroline: true,
                zerolinecolor: "#707b85"
            },
            uirevision: `${direction}-${property}-${coordinate}-${excludeSediments}`
        };

        await Plotly.react("cross-section-plot", traces, layout, {
            responsive: true,
            displaylogo: false,
            scrollZoom: true,
            modeBarButtonsToRemove: ["lasso2d", "select2d"]
        });

        setStatus(
            status,
            `Cross-section ready. Loaded 9 boundary grids and 9 ${metadata.label.toLowerCase()} grids; ` +
            `${excludeSediments ? "crystalline crust and mantle" : "rock"} color range ` +
            `${heatmap.minimum.toFixed(2)}–${heatmap.maximum.toFixed(2)} ${metadata.unit}.`
        );
    } catch (error) {
        if (!(error instanceof RangeError)) {
            console.error(error);
        }
        setStatus(status, error.message || "The cross-section could not be plotted.", true);
    } finally {
        button.disabled = false;
    }
}

document.getElementById("ok").addEventListener("click", loadMap);
document.getElementById("cross-direction").addEventListener("change", updateCoordinateControl);
document.getElementById("plot-cross-section").addEventListener("click", plotCrossSection);
document.getElementById("cross-coordinate").addEventListener("keydown", event => {
    if (event.key === "Enter") {
        plotCrossSection();
    }
});
updateCoordinateControl();
