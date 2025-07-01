# download the data from https://land.copernicus.eu/en/products/clc-backbone and 
# run this script in your download directory

$pythonPath = "C:\OSGeo4W\apps\Python312\python.exe"
$gdal2tilesScript = "C:\OSGeo4W\apps\Python312\Scripts\gdal2tiles-script.py"

# Loop through directories
Get-ChildItem -Directory | Where-Object { $_.Name -ne "tiles" } | ForEach-Object {
    $dir = $_.FullName
    $name = $_.Name
    $input = Join-Path $dir "$name.tif"
    $reprojected = Join-Path $dir "reprojected_3857.tif"
    $vrt = Join-Path $dir "temp.vrt"
    $tilesOut = "tiles/landcover"

    # gdalwarp
    gdalwarp -t_srs EPSG:3857 -r near -tr 10 10 -tap -co COMPRESS=LZW -co TILED=YES $input $reprojected

    # gdal_translate (expand to RGBA if needed)
    gdal_translate -of vrt -expand rgba $reprojected $vrt

    # gdal2tiles
    & $pythonPath $gdal2tilesScript --processes=4 --resampling=near --zoom=14 $vrt $tilesOut
}
