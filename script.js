async function loadMap(layer) {

    const layername = getLayerName();
    //const newdiv =document.createElement('div');
    //console.log(layername);
    //newdiv.textContent = `Selected layer: ${layername}`;
    //document.body.appendChild(newdiv);

    let maplayer = `maps/map-${layername}`
    //try {
        const response = await fetch(maplayer);
        if (!response.ok) throw new Error(`Failed to load array: ${response.status}`);
        let array_text = await response.text();
        //console.log('Full array loaded:',array_text);

        let array = array_text.split('\n').map(line => line.trim()).filter(line => line.length > 0).map(line => line.split(/\s+/).map(Number));
        drawMap(array);
        


    //} catch (error) {
    //    console.error('Error loading array:', error);
        // Fallback: show an error in the inspector or alert
    //    inspector.textContent = 'Error loading data. Check console for details.';
    //}
}

function getLayerName(){
    let layer_n = Number(document.getElementById("layer").value.charAt(1));
    let prop = document.getElementById("property").value;
    if (prop === "lower"){
        layer_n = layer_n + 1;
    }
    if (["upper", "lower"].includes(prop)) {
        prop = "bd"
    }

    let layername = `${prop}${layer_n}`;
    return layername;
}

function drawMap(array) {
    //d3.select("body").append("p").text("Hello World!");
    const width = 1200;
    const height = 600; 

    let min_val = Math.min.apply(null,array.flat());
    let max_val = Math.max.apply(null,array.flat());

    //set title text
    let layer_selection = document.getElementById("layer");
    let layer_text = layer_selection.options[layer_selection.selectedIndex].text;
    let prop_selection = document.getElementById("property");
    let prop_text = prop_selection.options[prop_selection.selectedIndex].text.toLowerCase();
    let title_text = `${layer_text} - ${prop_text}`;

    const bboxGeoJSON = {
    type: "Polygon",
    coordinates: [[
        [0, 30], [60, 30], [60, 60], [0, 60], [0, 30]
    ]]
    };

    // projection = d3.geoMercator().fitExtent([[0, 0], [width, height]], bboxGeoJSON);
    const projection = d3.geoEqualEarth()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .clipExtent([[0, 0], [width, height]]);
    if (d3.select("#map-container")) {
        d3.select("#map-container").remove();
    }
    //projection.scale(500)
    const container0 = d3.select("body").append("div")
        .attr("id", "map-container")
        .style("position", "relative")
        .style("display", "inline-block");

    const title = container0.append("h3")
        .text(title_text)
        .style("text-align", "center")
        .style("margin", "30px 0 0 0");
    
    const container = container0.append("div")
        .attr("id", "map-canvas-container")
        .style("position", "relative")
        .style("display", "inline-block");

    const canvas = container.append("canvas")
        .attr("width", width)
        .attr("height", height);

    let context = canvas.node().getContext("2d");
 
    d3.json("https://unpkg.com/world-atlas@1.1.4/world/110m.json").then(topojsonData => {
    const land = topojson.feature(topojsonData, topojsonData.objects.land);
    const path = d3.geoPath()
        .projection(projection).context(context);

    console.log(array);
    context.beginPath();
    path({ type: "Sphere" });
    context.clip();
    console.log(array);
    const geoTransform = [-180, 1, 0, 90, 0, -1];
    const invGeoTransform = [-geoTransform[0]/geoTransform[1], 1/geoTransform[1],0,-geoTransform[3]/geoTransform[5],0,1/geoTransform[5]];


    //Creating the color scale https://github.com/santilland/plotty/blob/master/src/plotty.js
    const cs_def = {colors: ['#000083','#003CAA','#05FFFF','#FFFF00','#FA0000','#800000'],
    positions: [0, 0.125, 0.375, 0.625, 0.875, 1]};
    const scaleWidth = 256;
    let canvasColorScale = d3.select("body").append("canvas")
        .attr("width", scaleWidth)
        .attr("height", 1)
        .style("display","none");
    let contextColorScale = canvasColorScale.node().getContext("2d");
    let gradient = contextColorScale.createLinearGradient(0, 0, scaleWidth, 1);

    for (let i = 0; i < cs_def.colors.length; ++i) {
        gradient.addColorStop(cs_def.positions[i], cs_def.colors[i]);
    }
    contextColorScale.fillStyle = gradient;
    contextColorScale.fillRect(0, 0, scaleWidth, 1);

    let csImageData = contextColorScale.getImageData(0, 0, scaleWidth, 1).data;

    //Drawing the image
    let canvasRaster = d3.select("body").append("canvas")
        .attr("width", width)
        .attr("height", height)
        .style("display","none");

    let contextRaster = canvasRaster.node().getContext("2d");

    let id = contextRaster.createImageData(width,height);
    let data = id.data;
    let pos = 0;

    
    console.log("min_val", min_val, "max_val", max_val);

    let maxvalue = 0;
    for(let j = 0; j<height; j++){
        for(let i = 0; i<width; i++){
            let pos = (j * width + i) * 4;   // always correct, independent of skips

            let pointCoords = projection.invert([i,j]);
            if (!pointCoords) continue;

            let px = Math.round(invGeoTransform[0] + pointCoords[0]* invGeoTransform[1]);
            let py = Math.round(invGeoTransform[3] + pointCoords[1] * invGeoTransform[5]);
            
            if(Math.floor(px) >= 0 && Math.ceil(px) < 360 && Math.floor(py) >= 0 && Math.ceil(py) < 180){
                //console.log("px", px, "py", py);
                let value = array[py][px];
                let c = Math.round((scaleWidth-1) * ((value - min_val)/(max_val - min_val)));
                if (c>maxvalue){
                    maxvalue = c}
                let alpha = 200;
                if (c<0 || c > (scaleWidth-1)){
                    alpha = 0;
                }
                data[pos]   = csImageData[c*4];
                data[pos+1] = csImageData[c*4+1];
                data[pos+2] = csImageData[c*4+2];
                data[pos+3] = alpha;
                }
            }
    }
    console.log(maxvalue);
    contextRaster.putImageData( id, 0, 0);
    context.drawImage(canvasRaster.node(), 0, 0);

    
    context.strokeStyle = "#777";
    context.fillStyle = "transparent";
    path(land);
    const graticule = d3.geoGraticule().stepMinor([20, 20]).stepMajor([20, 20])();
    path(graticule);
    context.fill();
    context.stroke();


    const barHeight = height * 0.75;
    const barWidth = 30;
    const topMargin = 15;      // room for the top label
    const bottomMargin = 15;   // room for the bottom label (same issue can happen there)


    const svg = container.append("svg")
    .attr("width", barWidth + 60)
    .attr("height", barHeight + topMargin + bottomMargin)
    .style("position", "absolute")
    .style("right", "-20px")
    .style("top", "50%")
    .style("transform", "translateY(-50%)");

// shift everything down by topMargin so nothing sits at y=0
const barGroup = svg.append("g")
    .attr("transform", `translate(0, ${topMargin})`);

const grad = barGroup.append('defs')
    .append('linearGradient')
    .attr('id', 'grad')
    .attr('x1', '0%').attr('x2', '0%')
    .attr('y1', '100%').attr('y2', '0%');

grad.selectAll('stop')
    .data(cs_def.colors)
    .enter()
    .append('stop')
    .style('stop-color', d => d)
    .attr('offset', (d, i) => (cs_def.positions[i] * 100) + '%');

barGroup.append('rect')
    .attr('x', 10)
    .attr('y', 0)
    .attr('width', barWidth)
    .attr('height', barHeight)
    .style('fill', 'url(#grad)');

const colorScale = d3.scaleLinear()
    .domain([min_val, max_val])
    .range([barHeight, 0]); // still relative to barGroup's local coordinates

barGroup.append('g')
    .attr('transform', `translate(${10 + barWidth}, 0)`)
    .call(d3.axisRight(colorScale).ticks(6))
    .selectAll("text")
    .style("font-size", "11px");

    });
}

const ok_button = document.getElementById("ok");
console.log(ok_button);
ok_button.addEventListener("click", loadMap);


