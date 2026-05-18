import React, { useState } from 'react';
import { OBJViewer } from '@/components/viewers/OBJViewer';
import { Upload } from 'lucide-react';

const OBJViewerTest = () => {
  const [objUrl, setObjUrl] = useState<string>('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.obj')) {
      setUploadedFile(file);
      const url = URL.createObjectURL(file);
      setObjUrl(url);
    } else {
      alert('Please upload a valid .obj file');
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem('url') as HTMLInputElement;
    if (input.value) {
      setObjUrl(input.value);
      setUploadedFile(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">OBJ Viewer Test</h1>
          <p className="text-gray-400">Upload or provide URL to an OBJ file to view it in 3D</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* File Upload */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload OBJ File
            </h3>
            <input
              type="file"
              accept=".obj"
              onChange={handleFileUpload}
              className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600 file:cursor-pointer cursor-pointer"
            />
            {uploadedFile && (
              <p className="mt-3 text-xs text-green-400">
                ✓ Loaded: {uploadedFile.name}
              </p>
            )}
          </div>

          {/* URL Input */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 lg:col-span-2">
            <h3 className="text-white font-semibold mb-4">Or Load from URL</h3>
            <form onSubmit={handleUrlSubmit} className="flex gap-2">
              <input
                type="text"
                name="url"
                placeholder="https://example.com/model.obj"
                className="flex-1 bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Load
              </button>
            </form>
          </div>
        </div>

        {/* Viewer */}
        {objUrl ? (
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-white font-semibold">3D Viewer</h3>
              <button
                onClick={() => {
                  setObjUrl('');
                  setUploadedFile(null);
                }}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>
            <OBJViewer
              url={objUrl}
              className="h-[600px] w-full rounded-lg overflow-hidden"
              onError={(error) => {
                console.error('Viewer error:', error);
                alert('Error loading model: ' + error);
              }}
            />
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-12 border border-white/20 border-dashed">
            <div className="text-center text-gray-400">
              <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Upload an OBJ file or provide a URL to get started</p>
              <p className="text-sm mt-2">Supports standard Wavefront OBJ format</p>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="mt-8 bg-white/5 backdrop-blur-md rounded-xl p-6 border border-white/20">
          <h3 className="text-white font-semibold mb-3">Features</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm text-gray-300">
            <div>
              <strong className="text-blue-400">• X/Y/Z Rotation</strong>
              <p className="text-xs text-gray-400 mt-1">Control object rotation with sliders</p>
            </div>
            <div>
              <strong className="text-blue-400">• Shading Modes</strong>
              <p className="text-xs text-gray-400 mt-1">Toggle between flat and smooth shading</p>
            </div>
            <div>
              <strong className="text-blue-400">• Wireframe View</strong>
              <p className="text-xs text-gray-400 mt-1">View model structure in wireframe</p>
            </div>
            <div>
              <strong className="text-blue-400">• OrbitControls</strong>
              <p className="text-xs text-gray-400 mt-1">Intuitive mouse controls for camera</p>
            </div>
            <div>
              <strong className="text-blue-400">• Auto-Center</strong>
              <p className="text-xs text-gray-400 mt-1">Automatically centers and scales model</p>
            </div>
            <div>
              <strong className="text-blue-400">• Reset View</strong>
              <p className="text-xs text-gray-400 mt-1">Quickly reset to default view</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OBJViewerTest;
