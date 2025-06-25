# Avalanche Simulation with WebGPU

[Try it yourself!](https://gro2mi.github.io/wgslAvalancheSim/ "Avalanche Simulation") This only works in Chrome (based Browsers as of June 2025). You might have to enable WebGPU flags at `chrome://flags`

This project is to improve the development process for avalanche simulations with webGPU based on [weBIGeo](https://github.com/weBIGeo/webigeo/tree/main). It offers the possibility to easily plot results in the browser.

Test examples are from [AvaFrame
](https://docs.avaframe.org/en/latest/testing.html#tests-for-model-validation)

Tiles are provided by the [AlpineMaps project](https://github.com/AlpineMapsOrg)

Requirements: Python (or Webserver), Browser with [WebGPU support](https://caniuse.com/webgpu) (currently only Chromium based browsers. You might have to enable WebGPU flags at `chrome://flags`)

1. Go to this directory
2. Start server with `python .\dev_server.py` for disabled cache and a secure connection with self signed certs which are needed to use WebGPU (except for localhost where `python -m http.server 8000` works as well)
3. Open Chrome on [https://localhost/index.html](https://localhost/index.html) or [https://localhost/index.html?debug=vscode](https://localhost/index.html?debug=vscode) for debugging mode or replace localhost with IP if accessing from another device.
