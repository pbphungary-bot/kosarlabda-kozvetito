# Background-removal model

`silueta.onnx` (44 MB) – the "silueta" salient-object segmentation model distributed with the open-source `rembg` project
(https://github.com/danielgatis/rembg, MIT licence; the network is a compressed U²-Net, https://github.com/xuebinqin/U-2-Net, Apache-2.0).
It runs in the browser with ONNX Runtime Web (`../vendor/ort/`, MIT, Microsoft). Used by `js/bgremove.js`; nothing is uploaded anywhere.
