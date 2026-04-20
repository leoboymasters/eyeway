import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface OBJViewerProps {
  url: string;
  className?: string;
  onError?: (error: string) => void;
}

export const OBJViewer: React.FC<OBJViewerProps> = ({
  url,
  className = "h-96 w-full rounded-md overflow-hidden border border-gray-200",
  onError
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Three.js OBJ Viewer with Controls
    const viewerHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OBJ Viewer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    }

    #canvas-container {
      width: 100%;
      height: 100%;
      position: relative;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
    }

    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      text-align: center;
      z-index: 10;
    }

    .spinner {
      border: 3px solid rgba(255,255,255,0.3);
      border-top: 3px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 15px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .controls-panel {
      position: absolute;
      left: 10px;
      top: 10px;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(10px);
      color: white;
      padding: 16px;
      border-radius: 12px;
      font-size: 12px;
      z-index: 10;
      max-width: 200px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }

    .control-group {
      margin-bottom: 12px;
    }

    .control-group:last-child {
      margin-bottom: 0;
    }

    .control-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-weight: 500;
      opacity: 0.9;
    }

    .control-label span:last-child {
      color: #60a5fa;
    }

    input[type="range"] {
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      outline: none;
      border-radius: 2px;
      -webkit-appearance: none;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      background: #60a5fa;
      cursor: pointer;
      border-radius: 50%;
    }

    input[type="range"]::-moz-range-thumb {
      width: 14px;
      height: 14px;
      background: #60a5fa;
      cursor: pointer;
      border-radius: 50%;
      border: none;
    }

    .button-group {
      display: flex;
      gap: 6px;
    }

    button {
      flex: 1;
      padding: 6px 10px;
      background: rgba(96, 165, 250, 0.2);
      border: 1px solid rgba(96, 165, 250, 0.4);
      color: white;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.2s;
    }

    button:hover {
      background: rgba(96, 165, 250, 0.3);
      border-color: rgba(96, 165, 250, 0.6);
    }

    button.active {
      background: rgba(96, 165, 250, 0.5);
      border-color: #60a5fa;
    }

    .badge {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(34, 197, 94, 0.9);
      color: white;
      padding: 6px 14px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      z-index: 10;
    }

    .info-panel {
      position: absolute;
      bottom: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 10px;
      line-height: 1.6;
      z-index: 10;
    }
  </style>
</head>
<body>
  <div id="canvas-container">
    <canvas id="canvas"></canvas>
  </div>

  <div id="loading">
    <div class="spinner"></div>
    <div id="status">Initializing...</div>
  </div>

  <div class="controls-panel" id="controls" style="display: none;">
    <div class="control-group">
      <div class="control-label">
        <span>X Rotation</span>
        <span id="xRotValue">0°</span>
      </div>
      <input type="range" id="xRotation" min="0" max="360" value="0">
    </div>

    <div class="control-group">
      <div class="control-label">
        <span>Y Rotation</span>
        <span id="yRotValue">0°</span>
      </div>
      <input type="range" id="yRotation" min="0" max="360" value="0">
    </div>

    <div class="control-group">
      <div class="control-label">
        <span>Z Rotation</span>
        <span id="zRotValue">0°</span>
      </div>
      <input type="range" id="zRotation" min="0" max="360" value="0">
    </div>

    <div class="control-group">
      <div class="control-label">
        <span>Shading</span>
      </div>
      <div class="button-group">
        <button id="btnFlat">Flat</button>
        <button id="btnSmooth" class="active">Smooth</button>
      </div>
    </div>

    <div class="control-group">
      <div class="control-label">
        <span>View</span>
      </div>
      <div class="button-group">
        <button id="btnWireframe">Wire</button>
        <button id="btnSolid" class="active">Solid</button>
      </div>
    </div>

    <div class="control-group">
      <button id="btnReset" style="width: 100%;">Reset</button>
    </div>
  </div>

  <div class="badge">OBJ Viewer</div>

  <div class="info-panel" id="info" style="display: none;">
    <strong>Mouse Controls</strong><br>
    Left drag: Rotate<br>
    Right drag: Pan<br>
    Scroll: Zoom
  </div>

  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  </script>

  <script type="module">
    import * as THREE from 'three';
    import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
    import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const canvas = document.getElementById('canvas');
    const status = document.getElementById('status');
    const loading = document.getElementById('loading');
    const controlsPanel = document.getElementById('controls');
    const infoPanel = document.getElementById('info');

    // Setup scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-5, -5, -5);
    scene.add(directionalLight2);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1;
    controls.maxDistance = 50;

    let model = null;
    let modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // UI Controls
    const xRotSlider = document.getElementById('xRotation');
    const yRotSlider = document.getElementById('yRotation');
    const zRotSlider = document.getElementById('zRotation');
    const xRotValue = document.getElementById('xRotValue');
    const yRotValue = document.getElementById('yRotValue');
    const zRotValue = document.getElementById('zRotValue');
    const btnFlat = document.getElementById('btnFlat');
    const btnSmooth = document.getElementById('btnSmooth');
    const btnWireframe = document.getElementById('btnWireframe');
    const btnSolid = document.getElementById('btnSolid');
    const btnReset = document.getElementById('btnReset');

    let isWireframe = false;
    let isSmooth = true;

    function updateRotation() {
      if (model) {
        const xRot = parseFloat(xRotSlider.value);
        const yRot = parseFloat(yRotSlider.value);
        const zRot = parseFloat(zRotSlider.value);

        model.rotation.x = THREE.MathUtils.degToRad(xRot);
        model.rotation.y = THREE.MathUtils.degToRad(yRot);
        model.rotation.z = THREE.MathUtils.degToRad(zRot);

        xRotValue.textContent = xRot.toFixed(0) + '°';
        yRotValue.textContent = yRot.toFixed(0) + '°';
        zRotValue.textContent = zRot.toFixed(0) + '°';
      }
    }

    function toggleShading(smooth) {
      isSmooth = smooth;
      if (model) {
        model.traverse((child) => {
          if (child.isMesh) {
            if (smooth) {
              child.geometry.computeVertexNormals();
            } else {
              child.geometry.deleteAttribute('normal');
              child.geometry.computeFaceNormals();
            }
            child.material.flatShading = !smooth;
            child.material.needsUpdate = true;
          }
        });
      }

      btnFlat.classList.toggle('active', !smooth);
      btnSmooth.classList.toggle('active', smooth);
    }

    function toggleWireframe(wireframe) {
      isWireframe = wireframe;
      if (model) {
        model.traverse((child) => {
          if (child.isMesh) {
            child.material.wireframe = wireframe;
          }
        });
      }

      btnWireframe.classList.toggle('active', wireframe);
      btnSolid.classList.toggle('active', !wireframe);
    }

    function resetView() {
      xRotSlider.value = '0';
      yRotSlider.value = '0';
      zRotSlider.value = '0';
      updateRotation();

      controls.reset();
      camera.position.z = 5;
    }

    xRotSlider.addEventListener('input', updateRotation);
    yRotSlider.addEventListener('input', updateRotation);
    zRotSlider.addEventListener('input', updateRotation);
    btnFlat.addEventListener('click', () => toggleShading(false));
    btnSmooth.addEventListener('click', () => toggleShading(true));
    btnWireframe.addEventListener('click', () => toggleWireframe(true));
    btnSolid.addEventListener('click', () => toggleWireframe(false));
    btnReset.addEventListener('click', resetView);

    function updateStatus(text) {
      status.textContent = text;
    }

    function hideLoading() {
      loading.style.display = 'none';
      controlsPanel.style.display = 'block';
      infoPanel.style.display = 'block';
      window.parent.postMessage({ type: 'loaded' }, '*');
    }

    function showError(text) {
      loading.querySelector('.spinner').style.display = 'none';
      status.textContent = 'Error: ' + text;
      status.style.color = '#ff6b6b';
      window.parent.postMessage({ type: 'error', error: text }, '*');
    }

    // Load OBJ with MTL and textures
    async function loadModel() {
      try {
        // Check if we have modelFiles from parent window with all blob URLs
        const modelFiles = window.parent.modelFiles || window.modelFiles;

        let objUrl = '${url}';
        let mtlUrl = objUrl.replace(/\\.obj$/i, '.mtl');
        let basePath = objUrl.substring(0, objUrl.lastIndexOf('/') + 1);

        // If modelFiles exists, use the blob URLs
        if (modelFiles) {
          console.log('Using modelFiles from window:', modelFiles);
          objUrl = modelFiles.obj;
          mtlUrl = modelFiles.mtl;
          // Override texture loading to use blob URLs
          window.textureBlobs = modelFiles.textures;
        }

        console.log('OBJ URL:', objUrl);
        console.log('MTL URL:', mtlUrl);
        console.log('Base path:', basePath);

        // Function to process the loaded model
        function processModel(obj) {
          console.log('OBJ loaded, processing...');
          model = obj;

          // Calculate bounding box and center
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          // Center the model
          model.position.sub(center);

          // Scale to fit
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 2 / maxDim;
          model.scale.multiplyScalar(scale);

          // Process materials and geometry
          model.traverse((child) => {
            if (child.isMesh) {
              // If no material exists, create default
              if (!child.material) {
                child.material = new THREE.MeshStandardMaterial({
                  color: 0x8b7355,
                  roughness: 0.7,
                  metalness: 0.2
                });
              }

              // Enable shadows
              child.castShadow = true;
              child.receiveShadow = true;

              // Compute normals if needed
              if (!child.geometry.attributes.normal) {
                child.geometry.computeVertexNormals();
              }

              // Log material info for debugging
              if (child.material.map) {
                console.log('Texture found:', child.material.map);
              }
            }
          });

          modelGroup.add(model);
          console.log('Model loaded:', { center, size, scale });
          hideLoading();
        }

        // Try to load MTL file first
        updateStatus('Checking for materials...');

        fetch(mtlUrl, { method: 'HEAD' })
          .then(response => {
            if (response.ok) {
              // MTL file exists, load with materials
              console.log('MTL file found, loading materials...');
              updateStatus('Loading materials and textures...');

              const mtlLoader = new MTLLoader();

              // If we have texture blobs, override the resource loading
              if (window.textureBlobs) {
                console.log('Overriding MTLLoader texture loading with blob URLs');

                // Create a custom manager that intercepts texture loading
                const manager = new THREE.LoadingManager();
                const textureLoader = new THREE.TextureLoader(manager);

                // Override the load method
                manager.setURLModifier((url) => {
                  // Extract just the filename from the URL
                  const filename = url.split('/').pop().split('\\\\').pop();
                  console.log('Loading texture:', filename);

                  // Check if we have a blob URL for this texture
                  if (window.textureBlobs && window.textureBlobs.has(filename)) {
                    const blobUrl = window.textureBlobs.get(filename);
                    console.log('Using blob URL for texture:', filename, '→', blobUrl);
                    return blobUrl;
                  }

                  console.log('No blob URL found for:', filename);
                  return url;
                });

                // Set the custom manager on the MTL loader
                mtlLoader.manager = manager;
              }

              mtlLoader.setPath(basePath);

              mtlLoader.load(
                mtlUrl,
                (materials) => {
                  console.log('MTL loaded successfully');
                  console.log('Materials:', Object.keys(materials.materials));

                  materials.preload();

                  updateStatus('Loading model with textures...');
                  const objLoader = new OBJLoader();
                  objLoader.setMaterials(materials);

                  objLoader.load(
                    objUrl,
                    processModel,
                    (xhr) => {
                      if (xhr.lengthComputable) {
                        const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
                        updateStatus(\`Loading: \${percent}%\`);
                      }
                    },
                    (error) => {
                      console.error('Error loading OBJ:', error);
                      showError('Failed to load OBJ file');
                    }
                  );
                },
                undefined,
                (error) => {
                  console.warn('MTL failed, loading OBJ without materials');
                  loadOBJOnly();
                }
              );
            } else {
              // No MTL file, load OBJ only
              console.log('No MTL file, loading OBJ only');
              loadOBJOnly();
            }
          })
          .catch(() => {
            console.log('Could not check MTL, loading OBJ only');
            loadOBJOnly();
          });

        // Load OBJ without MTL
        function loadOBJOnly() {
          updateStatus('Loading model...');
          const objLoader = new OBJLoader();

          objLoader.load(
            objUrl,
            processModel,
            (xhr) => {
              if (xhr.lengthComputable) {
                const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
                updateStatus(\`Loading: \${percent}%\`);
              }
            },
            (error) => {
              console.error('Error loading OBJ:', error);
              showError('Failed to load OBJ file');
            }
          );
        }

      } catch (err) {
        console.error('Error:', err);
        showError(err.message);
      }
    }

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }

    // Handle window resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Start
    loadModel();
    animate();
  </script>
</body>
</html>
    `;

    if (iframeRef.current) {
      const blob = new Blob([viewerHTML], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      iframeRef.current.src = blobUrl;

      const cleanup = () => URL.revokeObjectURL(blobUrl);
      iframeRef.current.addEventListener('load', cleanup, { once: true });

      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'loaded') {
          setLoading(false);
          setError(null);
        } else if (event.data.type === 'error') {
          const errorMsg = event.data.error || 'Failed to load model';
          setLoading(false);
          setError(errorMsg);
          if (onError) {
            setTimeout(() => onError(errorMsg), 1000);
          }
        }
      };

      window.addEventListener('message', handleMessage);

      return () => {
        window.removeEventListener('message', handleMessage);
        cleanup();
      };
    }
  }, [url, onError]);

  return (
    <div className={`relative ${className}`}>
      <iframe
        ref={iframeRef}
        className="w-full h-full border-0"
        title="OBJ Viewer"
        sandbox="allow-scripts allow-same-origin"
      />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 pointer-events-none">
          <div className="text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-3 text-white animate-spin" />
            <p className="text-sm text-white">Loading model...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 pointer-events-none">
          <div className="text-center p-4">
            <p className="text-sm text-white font-medium mb-2">Failed to load</p>
            <p className="text-xs text-red-200">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default OBJViewer;
