function latLonToWebMercator(lat, lon) {
    const RADIUS = 6378137.0; // Earth's radius in meters (WGS84)

    const x = RADIUS * lon * Math.PI / 180;
    const y = RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));

    return { x, y };
}

function latLonToTile(lat, lon, zoom) {
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, zoom);

    const xTile = Math.floor((lon + 180) / 360 * n);
    const yTile = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

    return { x: xTile, y: yTile };
}

dbPromise = null;

function getTileDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open("TileCacheDB", 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore("tiles", { keyPath: "url" });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

async function fetchAndCacheTile(url) {
    const db = await getTileDB();
    const tx = db.transaction("tiles", "readonly");
    const store = tx.objectStore("tiles");
    const found = await new Promise((resolve, reject) => {
        const request = store.get(url);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    if (found && found.blob) {
        // console.log(`Tile found in Tile DB: ${url}`);
        return found.blob;  // Return cached tile
    }

    // Download and store if not present

    console.log(`Download tile: ${url}`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${url}`);
    const blob = await resp.blob();
    await new Promise((resolve, reject) => {
        const tx2 = db.transaction("tiles", "readwrite");
        const store = tx2.objectStore("tiles");
        const request = store.put({ url, blob });

        request.onsuccess = () => {
            // console.log(`Put successful: ${url}`);
        };
        request.onerror = (e) => {
            console.error(`Put failed: ${url}`, e);
        };

        tx2.oncomplete = () => {
            console.log(`Transaction complete: ${url}`);
            resolve();
        };
        tx2.onerror = () => {
            console.error(`Transaction error: ${url}`);
            reject(tx2.error);
        };
    });
    console.log(`Cached tile: ${url}`);
    return blob;
}

function tmsToXyzY(y, z) {
    return (1 << z) - 1 - y;
}

function tileToWebMercatorBounds(x, y, zoom, tileSize = 256) {
    const tileCount = Math.pow(2, zoom);
    const worldExtent = 20037508.342789244 * 2; // Total extent in meters (Web Mercator)
    const resolution = worldExtent / (tileCount * tileSize); // meters per pixel

    const tileWidthMeters = resolution * tileSize;

    const minX = -20037508.342789244 + x * tileWidthMeters;
    const maxY = 20037508.342789244 - y * tileWidthMeters;

    return {
        topLeft:     { x: minX, y: maxY },
        bottomRight: { x: minX + tileWidthMeters, y: maxY - tileWidthMeters }
    };
}

function latLonToTmsTile(lat, lon, zoom) {
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, zoom);

    const xTile = Math.floor((lon + 180) / 360 * n);
    const yTileXYZ = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    const yTileTMS = n - 1 - yTileXYZ;  // Flip Y for TMS

    return { x: xTile, y: yTileTMS };
}

async function fetchAndCacheTiles(bbox, zoom) {
    const [minLat, minLon, maxLat, maxLon] = bbox;
    const topLeft = latLonToTile(maxLat, minLon, zoom);
    const bottomRight = latLonToTile(minLat, maxLon, zoom);
    // const bottomRight = { x: topLeft.x + 1, y: topLeft.y + 1 }; // Adjusted to fetch a 3x3 grid of tiles
    const nTilesX = bottomRight.x - topLeft.x + 1;
    const nTilesY = bottomRight.y - topLeft.y + 1;
    const nTiles = nTilesX * nTilesY;
    console.log(`Fetching tiles from zoom ${zoom} for bbox:`, bbox);
    console.log(`Number of tiles to fetch:`, nTiles);
    tiles = [];
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
        // TODO figure this out in a nice way
        for (let y = nTilesY; y > 0 ; --y) {
            const url = `https://alpinemaps.cg.tuwien.ac.at/tiles/alpine_png/${zoom}/${x}/${tmsToXyzY(bottomRight.y, zoom) + y - 1}.png`;
            // console.log(`Fetching tile: ${url}`);
            try {
                const tile = await fetchAndCacheTile(url);
                tiles.push(tile);
            } catch (e) {
                console.error('Failed to fetch', url, e);
            }
        }
    }
    const topLeftWebMerc = tileToWebMercatorBounds(topLeft.x, topLeft.y, zoom).topLeft;
    const bottomRightWebMerc = tileToWebMercatorBounds(bottomRight.x, bottomRight.y, zoom).bottomRight;
    const bounds = new RegionBounds(topLeftWebMerc.x, bottomRightWebMerc.y, bottomRightWebMerc.x, topLeftWebMerc.y)
    return { tiles, nTilesX, nTilesY, bounds };
}

function parseGPX(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "application/xml");
    const points = Array.from(xmlDoc.querySelectorAll("trkpt, rtept"));

    if (points.length === 0) throw new Error("No track or route points found");

    return points.map(pt => ({
        lat: parseFloat(pt.getAttribute("lat")),
        lon: parseFloat(pt.getAttribute("lon"))
    }));
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radius of Earth in meters

    const toRad = deg => deg * Math.PI / 180;

    const theta1 = toRad(lat1);
    const theta2 = toRad(lat2);
    const phi = toRad(lat2 - lat1);
    const lambda = toRad(lon2 - lon1);

    const a = Math.sin(phi / 2) ** 2 +
              Math.cos(theta1) * Math.cos(theta2) * Math.sin(lambda / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // distance in meters
}

async function getGPXBoundingBoxWithMargin(gpx, marginMeters = 500) {
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;

    for (const pt of gpx) {
        if (!isNaN(pt.lat) && !isNaN(pt.lon)) {
            minLat = Math.min(minLat, pt.lat);
            minLon = Math.min(minLon, pt.lon);
            maxLat = Math.max(maxLat, pt.lat);
            maxLon = Math.max(maxLon, pt.lon);
        }
    }

    // Expand bounding box by margin in meters
    const EARTH_RADIUS = 6371000; // meters

    const latMargin = (marginMeters / EARTH_RADIUS) * (180 / Math.PI);
    const avgLat = (minLat + maxLat) / 2;
    const lonMargin = (marginMeters / (EARTH_RADIUS * Math.cos(avgLat * Math.PI / 180))) * (180 / Math.PI);

    return {
        minLat: minLat - latMargin,
        minLon: minLon - lonMargin,
        maxLat: maxLat + latMargin,
        maxLon: maxLon + lonMargin
    };
}

async function fetchGPXAndCacheTiles(gpxText, zoom = 14) {
    const bbox = await getGPXBoundingBoxWithMargin(gpxText);
    const db = await openTileDB();
    const { tiles, nTilesX, nTilesY } = await fetchAndCacheTiles(db, [bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon], zoom);
    const stitchedCanvas = stitchTilesCropped(tiles, 64, nTilesX, nTilesY);
    document.body.appendChild(stitchedCanvas);
}

async function stitchTilesCropped(tiles, cropSize = 64, tilesX, tilesY) {
    const width = cropSize * tilesX;
    const height = cropSize * tilesY;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    for (let x = 0; x < tilesX; x++) {
        for (let y = 0; y < tilesY; y++) {
            const idx = x * tilesY + y;
            const tile = tiles[idx];
            if (tile) {
                const bitmap = await createImageBitmap(tile);
                ctx.drawImage(bitmap,
                    0, 0, cropSize, cropSize,
                    x * cropSize, y * cropSize,
                    cropSize, cropSize
                );
            }
        }
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const data1d = new Float32Array(width * height);
    const scalingFactor = 8191.875 / 65535.0;

    for (let y = 0; y < height; y++) {
    const flippedY = height - 1 - y;
    for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];

        const combined = (r << 8) | g;
        data1d[flippedY * width + x] = combined * scalingFactor;
    }
}

    return { data1d, width, height };
}

function pixelWidthMeters(zoom, longitude_deg) {
    const earthCircumference = 40075016.686; // meters
    const tileSize = 64; // pixels
    return earthCircumference / (tileSize * Math.pow(2, zoom)) * Math.cos(longitude_deg * Math.PI / 180); // Adjust for longitude
}

