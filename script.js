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

function updateMapExtentControls() {
    const clipControl = document.getElementById("map-extent-clip");
    const layerNumber = Number(document.getElementById("layer").value.slice(1));
    const property = document.getElementById("property").value;
    const uniformProperty = isUniformWaterOrIceProperty(layerNumber, property);

    clipControl.disabled = uniformProperty;
    document.getElementById("map-extent-n").disabled = uniformProperty || !clipControl.checked;
}

function getMapExtentOptions() {
    const clip = document.getElementById("map-extent-clip").checked;
    const n = Number(document.getElementById("map-extent-n").value);

    if (clip && (!Number.isFinite(n) || n <= 0)) {
        throw new RangeError("Standard deviations (n) must be a number greater than zero.");
    }
    return {clip, n};
}

function isUniformWaterOrIceProperty(layerNumber, property) {
    return layerNumber <= 2 && ["ro", "vp", "vs"].includes(property);
}

function renderUniformMapValue(grid, layerNumber, property) {
    const metadata = PROPERTY_METADATA[property];
    let value;
    for (const row of grid) {
        value = row.find(Number.isFinite);
        if (value !== undefined) {
            break;
        }
    }
    if (value === undefined) {
        throw new Error("The selected property grid contains no numeric value.");
    }

    const layerName = LAYER_NAMES[layerNumber - 1];
    const output = d3.select("#map-output");
    output.selectAll("*").remove();
    output
        .append("div")
        .attr("class", "map-value-card")
        .attr("role", "figure")
        .attr("aria-label", `${layerName} ${metadata.label.toLowerCase()}`)
        .text(
            `${layerName} ${metadata.label.toLowerCase()} is ` +
            `${value.toFixed(2)} ${metadata.unit}.`
        );
}

async function loadMap() {
    const button = document.getElementById("ok");
    const status = document.getElementById("map-status");
    button.disabled = true;
    setStatus(status, "Loading map grid…");

    try {
        const layerNumber = Number(document.getElementById("layer").value.slice(1));
        const property = document.getElementById("property").value;
        const showUniformValue = isUniformWaterOrIceProperty(layerNumber, property);
        const ignoreZero = layerNumber > 2 && ["ro", "vp", "vs"].includes(property);
        const extentOptions = showUniformValue
            ? null
            : {...getMapExtentOptions(), ignoreZero};
        const grid = await loadGrid(getLayerName());

        if (showUniformValue) {
            renderUniformMapValue(grid, layerNumber, property);
            setStatus(status, "This property is spatially constant, so no map is displayed.");
            return;
        }

        await drawMap(grid, extentOptions);
        const extentDescription = extentOptions.clip
            ? `Color range clipped at mean ± ${extentOptions.n}σ.`
            : "Color range uses the full minimum–maximum extent.";
        const zeroDescription = extentOptions.ignoreZero
            ? " Zero values are shown in white and excluded from the colorbar."
            : "";
        setStatus(
            status,
            `Map ready. ${extentDescription}${zeroDescription} Scroll to zoom and drag to pan.`
        );
    } catch (error) {
        if (!(error instanceof RangeError)) {
            console.error(error);
        }
        setStatus(status, error.message || "The map could not be displayed.", true);
    } finally {
        button.disabled = false;
    }
}

function gridExtent(grid, { clip = true, n = 3, ignoreZero = false } = {}) {
    // collect values
    const values = [];
    for (const row of grid) {
        for (const value of row) {
            if (Number.isFinite(value) && (!ignoreZero || value !== 0)) {
                values.push(value);
            }
        }
    }
    if (values.length === 0) {
        throw new Error("The selected grid contains no nonzero values to display.");
    }
    // compute basic min/max
    let minimum = math.min(values);
    let maximum = math.max(values);

    if (clip) {
        // compute mean and standard deviation
        const mean = math.mean(values);
        const sdev = math.std(values);
        const clipMin = mean - n * sdev;
        const clipMax = mean + n * sdev;
        minimum = Math.max(minimum, clipMin);
        maximum = Math.min(maximum, clipMax);
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

function formatMapCoordinate(value, positiveSuffix, negativeSuffix) {
    if (value === 0) {
        return "0°";
    }
    return `${Math.abs(value)}°${value > 0 ? positiveSuffix : negativeSuffix}`;
}

function drawMapGraticuleLabels(
    context,
    projection,
    width,
    height,
    rightGutter,
    bottomGutter,
    zoomScale
) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width + rightGutter, height + bottomGutter);
    context.save();
    context.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.lineWidth = 3;
    context.strokeStyle = "rgba(255, 255, 255, 0.92)";
    context.fillStyle = "rgba(43, 51, 59, 0.96)";
    const labelInterval = zoomScale >= 2 ? 20 : 40;

    // Find the bottom-most visible point of each meridian in the current AOI.
    const bottomLabels = [];
    for (let longitude = -160; longitude <= 160; longitude += labelInterval) {
        let edge = null;
        for (let latitude = -90; latitude <= 90; latitude += 2) {
            const point = projection([longitude, latitude]);
            if (
                point &&
                point[0] >= 0 && point[0] <= width &&
                point[1] >= 0 && point[1] <= height &&
                (!edge || point[1] > edge[1])
            ) {
                edge = point;
            }
        }
        if (edge) {
            bottomLabels.push({
                x: edge[0],
                y: edge[1],
                text: formatMapCoordinate(longitude, "E", "W")
            });
        }
    }

    context.textAlign = "center";
    context.textBaseline = "top";
    let occupiedUntil = -Infinity;
    for (const label of bottomLabels.sort((first, second) => first.x - second.x)) {
        const halfWidth = context.measureText(label.text).width / 2;
        if (
            label.x - halfWidth < 2 ||
            label.x + halfWidth > width - 2 ||
            label.x - halfWidth < occupiedUntil + 4
        ) {
            continue;
        }
        const labelY = Math.min(height + 10, label.y + 10);
        context.strokeText(label.text, label.x, labelY);
        context.fillText(label.text, label.x, labelY);
        occupiedUntil = label.x + halfWidth;
    }

    // Find the right-most visible point of each parallel in the current AOI.
    const rightLabels = [];
    for (let latitude = -80; latitude <= 80; latitude += labelInterval) {
        const westernEdge = projection([-179.999, latitude]);
        const easternEdge = projection([179.999, latitude]);
        if (westernEdge && easternEdge) {
            const mapLeft = Math.min(westernEdge[0], easternEdge[0]);
            const mapRight = Math.max(westernEdge[0], easternEdge[0]);
            const y = easternEdge[1];
            if (mapRight < 0 || mapLeft > width || y < 0 || y > height) {
                continue;
            }
            rightLabels.push({
                x: Math.min(width, mapRight),
                y,
                text: formatMapCoordinate(latitude, "N", "S")
            });
        }
    }

    context.textAlign = "left";
    context.textBaseline = "middle";
    occupiedUntil = -Infinity;
    for (const label of rightLabels.sort((first, second) => first.y - second.y)) {
        if (
            label.y < 8 ||
            label.y > height - 8 ||
            label.y < occupiedUntil + 14
        ) {
            continue;
        }
        const labelX = label.x > width - 3 ? width + 10 : label.x + 10;
        context.strokeText(label.text, labelX, label.y);
        context.fillText(label.text, labelX, label.y);
        occupiedUntil = label.y;
    }
    context.restore();
}

function enableMapZoom(
    canvas,
    context,
    labelContext,
    land,
    projection,
    width,
    height,
    rightGutter,
    bottomGutter
) {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    sourceCanvas.getContext("2d").drawImage(canvas.node(), 0, 0);

    const initialScale = projection.scale();
    const initialTranslate = projection.translate();
    const path = d3.geoPath().projection(projection).context(context);
    const graticule = d3.geoGraticule().stepMinor([20, 20]).stepMajor([20, 20])();

    function redraw(transform) {
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);

        // The raster can be transformed cheaply, while geographic vectors are
        // projected again below so they stay sharp at every zoom level.
        context.setTransform(transform.k, 0, 0, transform.k, transform.x, transform.y);
        context.imageSmoothingEnabled = true;
        context.drawImage(sourceCanvas, 0, 0);

        context.setTransform(1, 0, 0, 1, 0, 0);
        projection
            .scale(initialScale * transform.k)
            .translate([
                initialTranslate[0] * transform.k + transform.x,
                initialTranslate[1] * transform.k + transform.y
            ]);

        context.beginPath();
        context.strokeStyle = "#707780";
        context.lineWidth = 0.7;
        path(land);
        path(graticule);
        context.stroke();
        context.restore();
        drawMapGraticuleLabels(
            labelContext,
            projection,
            width,
            height,
            rightGutter,
            bottomGutter,
            transform.k
        );
    }

    const zoom = d3
        .zoom()
        .scaleExtent([1, 8])
        .extent([[0, 0], [width, height]])
        .translateExtent([[0, 0], [width, height]])
        .on("start", function () {
            canvas.style("cursor", "grabbing");
        })
        .on("zoom", function () {
            redraw(d3.event.transform);
        })
        .on("end", function () {
            canvas.style("cursor", "grab");
        });

    canvas
        .attr("tabindex", 0)
        .attr("role", "img")
        .attr("aria-label", "Interactive global layer map. Scroll to zoom and drag to pan.")
        .style("cursor", "grab")
        .style("touch-action", "none")
        .call(zoom);

    redraw(d3.zoomIdentity);
}

async function drawMap(grid, extentOptions) {
    const output = d3.select("#map-output");
    output.selectAll("*").remove();
    const colorbarWidth = 98;
    const mapColorbarGap = 40;
    const mapLabelRightGutter = 50;
    const mapLabelBottomGutter = 28;
    const maximumMapWidth = 1200;
    const reservedWidth = colorbarWidth + mapColorbarGap + mapLabelRightGutter;
    const availableWidth = output.node().clientWidth || maximumMapWidth + reservedWidth;
    const width = Math.max(
        1,
        Math.min(maximumMapWidth, Math.floor(availableWidth - reservedWidth))
    );
    const height = Math.max(1, Math.round(width / 2));
    const [minimum, maximum] = gridExtent(grid, extentOptions);

    const layerSelection = document.getElementById("layer");
    const propertySelection = document.getElementById("property");
    const titleText =
        `${layerSelection.options[layerSelection.selectedIndex].text} – ` +
        propertySelection.options[propertySelection.selectedIndex].text.toLowerCase();

    let zoom_level = 1;
    const projection = d3
        .geoEqualEarth()
        .scale(zoom_level * width / (2 * Math.PI))
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
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", `${mapColorbarGap}px`)
        .style("width", "max-content");

    const mapStage = container
        .append("div")
        .style("position", "relative")
        .style("flex", "0 0 auto")
        .style("width", `${width + mapLabelRightGutter}px`)
        .style("height", `${height + mapLabelBottomGutter}px`)
        .style("overflow", "hidden")
        .style("background", "#ffffff")
        .style("border-radius", "8px")
        .style("box-shadow", "inset 0 0 0 1px #e1e4e9");

    const canvas = mapStage
        .append("canvas")
        .attr("width", width)
        .attr("height", height)
        .style("position", "absolute")
        .style("left", "0")
        .style("top", "0");

    const labelCanvas = mapStage
        .append("canvas")
        .attr("width", width + mapLabelRightGutter)
        .attr("height", height + mapLabelBottomGutter)
        .style("position", "absolute")
        .style("left", "0")
        .style("top", "0")
        .style("pointer-events", "none");

    const context = canvas.node().getContext("2d");
    const labelContext = labelCanvas.node().getContext("2d");
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
    const colors = ["#000080", "#0000ff", "#0000ff", "#00dbff", "#00e6f7", "#15ffe2", "#efff08", "#f7f600", "#ffec00", "#ff1300", "#e80000", "#800000"];
    const positions = [0, 0.11, 0.125, 0.34, 0.35, 0.375, 0.64, 0.65, 0.66, 0.89, 0.91, 1];
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
            const target = (pixelY * width + pixelX) * 4;
            if (extentOptions.ignoreZero && value === 0) {
                imageData[target] = 255;
                imageData[target + 1] = 255;
                imageData[target + 2] = 255;
                imageData[target + 3] = 255;
                continue;
            }
            const normalized = valueRange === 0 ? 0.5 : (value - minimum) / valueRange;
            const colorIndex = Math.max(
                0,
                Math.min(scaleWidth - 1, Math.round(normalized * (scaleWidth - 1)))
            );
            imageData[target] = colorData[colorIndex * 4];
            imageData[target + 1] = colorData[colorIndex * 4 + 1];
            imageData[target + 2] = colorData[colorIndex * 4 + 2];
            imageData[target + 3] = 200;
        }
    }

    rasterContext.putImageData(image, 0, 0);
    context.drawImage(rasterCanvas, 0, 0);
    context.restore();

    enableMapZoom(
        canvas,
        context,
        labelContext,
        land,
        projection,
        width,
        height,
        mapLabelRightGutter,
        mapLabelBottomGutter
    );

    const barHeight = height * 0.75;
    const barWidth = 28;
    const topMargin = 15;
    const svg = container
        .append("svg")
        .attr("width", colorbarWidth)
        .attr("height", barHeight + topMargin * 2)
        .style("flex", "0 0 auto");

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
            autosize: true,
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

        const plotElement = document.getElementById("cross-section-plot");
        await Plotly.react(plotElement, traces, layout, {
            responsive: true,
            displaylogo: false,
            scrollZoom: true,
            modeBarButtonsToRemove: ["lasso2d", "select2d"]
        });
        await Plotly.Plots.resize(plotElement);

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
document.getElementById("map-extent-clip").addEventListener("change", updateMapExtentControls);
document.getElementById("layer").addEventListener("change", updateMapExtentControls);
document.getElementById("property").addEventListener("change", updateMapExtentControls);
document.getElementById("cross-direction").addEventListener("change", updateCoordinateControl);
document.getElementById("plot-cross-section").addEventListener("click", plotCrossSection);
document.getElementById("cross-coordinate").addEventListener("keydown", event => {
    if (event.key === "Enter") {
        plotCrossSection();
    }
});
updateMapExtentControls();
updateCoordinateControl();
