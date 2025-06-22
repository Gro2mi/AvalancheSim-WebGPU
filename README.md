# Avalanche Simulation with WebGPU

[Try it yourself!](https://gro2mi.github.io/wgslAvalancheSim/ "Avalanche Simulation") This only works in Chrome in Windows (June 2025).

This project is to improve the development process for avalanche simulations with webGPU based on [weBIGeo](https://github.com/weBIGeo/webigeo/tree/main). It offers the possibility to easily plot results in the browser.
Test examples are from [AvaFrame](https://docs.avaframe.org/en/latest/testing.html#tests-for-model-validation)

Requirements: Python (or Webserver), Browser with [WebGPU support](https://caniuse.com/webgpu) (currently only Chromium based browsers)

1. Go to this directory
2. Start server with `python -m http.server 8000`
3. Open Chrome on [http://localhost:8000/](http://localhost:8000/) or [http://localhost:8000/?debug=vscode](http://localhost:8000/?debug=vscode) for debugging mode
