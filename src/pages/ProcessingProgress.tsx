import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Upload, Loader2, Check, X, Download, Info, List, Trash2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { getAllTasks, deleteTask, subscribeToTasks, ProcessingTask } from '@/services/supabaseTasksManager';
import { OBJViewer } from '@/components/viewers/OBJViewer';

type Step = 'upload' | 'processing' | 'completed' | 'failed';
type View = 'workflow' | 'tasklist';

export const ProcessingProgress = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentView, setCurrentView] = useState<View>('workflow');
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [uploadType, setUploadType] = useState<'images' | 'video' | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [scanType, setScanType] = useState<string>('photo');
  const [fileFormat, setFileFormat] = useState<string>('glb');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [taskId, setTaskId] = useState<string>('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string>('');
  const [allTasks, setAllTasks] = useState<ProcessingTask[]>([]);
  const [checkingTaskId, setCheckingTaskId] = useState<string | null>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [localModelUrl, setLocalModelUrl] = useState<string>('');
  const [localModelFileType, setLocalModelFileType] = useState<'obj' | null>(null);

  // Memoized function to load tasks
  const loadTasks = useCallback(async () => {
    const tasks = await getAllTasks();
    setAllTasks(tasks);
  }, []);

  // Memoized function to refresh all active tasks
  const refreshAllTasks = useCallback(async () => {
    await loadTasks();
  }, [loadTasks]);

  // Load tasks on mount
  useEffect(() => {
    loadTasks();

    // Subscribe to real-time updates
    const unsubscribe = subscribeToTasks(async (payload) => {
      console.log('Real-time update:', payload);
      try {
        await loadTasks();
      } catch (error) {
        console.error('Failed to reload tasks after real-time update:', error);
        toast({
          variant: 'destructive',
          title: 'Sync Error',
          description: 'Failed to refresh task list. Please refresh manually.',
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadTasks, toast]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (localModelUrl) {
        URL.revokeObjectURL(localModelUrl);
      }
    };
  }, [localModelUrl]);

  // Auto-refresh all active tasks
  useEffect(() => {
    if (currentView === 'tasklist') {
      const interval = setInterval(() => {
        refreshAllTasks();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [currentView, refreshAllTasks]);

  const handleRefreshAllTasks = async () => {
    setIsRefreshingAll(true);
    try {
      await refreshAllTasks();
      toast({
        title: 'Tasks Refreshed',
        description: 'All active tasks have been updated',
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Refresh Failed',
        description: 'Failed to refresh tasks',
      });
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleFileSelect = (type: 'images' | 'video' | 'obj') => {
    if (type === 'obj') {
      setUploadType(null); // Local viewing only
      if (fileInputRef.current) {
        fileInputRef.current.accept = '.obj,.mtl,.jpg,.jpeg,.png,.bmp,.tga';
        fileInputRef.current.multiple = true;
        fileInputRef.current.click();
      }
      return;
    }
    
    setUploadType(type);
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'images' ? 'image/*' : 'video/*';
      fileInputRef.current.multiple = type === 'images';
      fileInputRef.current.click();
    }
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    // Check if these are local model files for viewing
    const isModelView = !uploadType && files.some(f => f.name.toLowerCase().endsWith('.obj'));

    if (uploadType === 'images' && !isModelView) {
      if (files.length < 20 || files.length > 300) {
        toast({
          variant: 'destructive',
          title: 'Invalid Image Count',
          description: 'Please select between 20 and 300 images',
        });
        return;
      }
    }

    setSelectedFiles(files);
    toast({
      title: 'Files Selected',
      description: `${files.length} file(s) ready`,
    });
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    // Check if it's a local OBJ viewing request
    const objFile = selectedFiles.find(f => f.name.toLowerCase().endsWith('.obj'));
    if (objFile && !uploadType) {
        const mtlFile = selectedFiles.find(f => f.name.toLowerCase().endsWith('.mtl'));
        const textureFiles = selectedFiles.filter(f => {
          const ext = f.name.toLowerCase();
          return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') ||
                 ext.endsWith('.bmp') || ext.endsWith('.tga');
        });

        if (objFile && mtlFile) {
          const objBlob = URL.createObjectURL(objFile);
          const mtlBlob = URL.createObjectURL(mtlFile);
          const textureBlobs = new Map<string, string>();
          textureFiles.forEach(file => {
            textureBlobs.set(file.name, URL.createObjectURL(file));
          });

          (window as any).modelFiles = {
            obj: objBlob,
            mtl: mtlBlob,
            textures: textureBlobs,
            objFileName: objFile.name,
            mtlFileName: mtlFile.name
          };

          setLocalModelUrl(objBlob);
          setLocalModelFileType('obj');
          setCurrentStep('completed');
          setUploadProgress(100);
          toast({
            title: 'Model Loaded',
            description: 'Your 3D model is ready to view',
          });
          return;
        }
    }

    setIsUploading(true);
    try {
      toast({
        variant: 'destructive',
        title: 'Feature Disabled',
        description: 'Cloud processing has been disabled.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    if (localModelUrl) {
      URL.revokeObjectURL(localModelUrl);
      setLocalModelUrl('');
    }
    setCurrentStep('upload');
    setUploadType(null);
    setSelectedFiles([]);
    setTaskId('');
    setProcessingProgress(0);
    setStatusMessage('');
    setError('');
    setLocalModelFileType(null);
    setFileFormat('glb');
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      <div className="flex items-center">
        <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
          currentStep === 'upload' ? 'border-blue-500 bg-blue-50 text-blue-600' :
          ['processing', 'completed', 'failed'].includes(currentStep) ? 'border-green-500 bg-green-50 text-green-600' :
          'border-gray-300 bg-white text-gray-400'
        }`}>
          {['processing', 'completed', 'failed'].includes(currentStep) ? <Check className="w-5 h-5" /> : '1'}
        </div>
        <span className="ml-2 text-sm font-medium hidden sm:inline">Upload</span>
      </div>
      <div className={`w-12 h-0.5 ${
        ['processing', 'completed', 'failed'].includes(currentStep) ? 'bg-green-500' : 'bg-gray-300'
      }`}></div>
      <div className="flex items-center">
        <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
          currentStep === 'processing' ? 'border-blue-500 bg-blue-50 text-blue-600' :
          ['completed', 'failed'].includes(currentStep) ? 'border-green-500 bg-green-50 text-green-600' :
          'border-gray-300 bg-white text-gray-400'
        }`}>
          {['completed', 'failed'].includes(currentStep) ? <Check className="w-5 h-5" /> :
           currentStep === 'processing' ? <Loader2 className="w-5 h-5 animate-spin" /> : '2'}
        </div>
        <span className="ml-2 text-sm font-medium hidden sm:inline">Processing</span>
      </div>
      <div className={`w-12 h-0.5 ${
        currentStep === 'completed' ? 'bg-green-500' : 'bg-gray-300'
      }`}></div>
      <div className="flex items-center">
        <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
          currentStep === 'completed' ? 'border-green-500 bg-green-50 text-green-600' :
          currentStep === 'failed' ? 'border-red-500 bg-red-50 text-red-600' :
          'border-gray-300 bg-white text-gray-400'
        }`}>
          {currentStep === 'completed' ? <Check className="w-5 h-5" /> :
           currentStep === 'failed' ? <X className="w-5 h-5" /> : '3'}
        </div>
        <span className="ml-2 text-sm font-medium hidden sm:inline">
          {currentStep === 'failed' ? 'Failed' : 'Complete'}
        </span>
      </div>
    </div>
  );

  const renderUploadStep = () => (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">Step 1: Upload Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!uploadType && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">View 3D Model</h3>
            <p className="text-sm text-gray-500 mb-4">Cloud processing has been disabled. You can still view local models.</p>
            <button
              onClick={() => handleFileSelect('obj')}
              className="w-full p-6 border-2 border-dashed border-slate-300 rounded-lg hover:border-slate-500 hover:bg-slate-50 transition-all"
            >
              <Upload className="w-12 h-12 mx-auto mb-4 text-slate-500" />
              <h3 className="font-semibold text-lg mb-2">Upload OBJ Model for Viewing</h3>
              <p className="text-sm text-gray-600">.obj + .mtl and textures</p>
              <p className="text-xs text-slate-600 mt-2">View pre-processed 3D mesh models</p>
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple={uploadType === 'images' || !uploadType}
          onChange={handleFilesChange}
        />

        {selectedFiles.length > 0 && (
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="font-medium text-blue-900 mb-2">
              {uploadType === 'images' ? `${selectedFiles.length} images selected` :
               uploadType === 'video' ? 'Video selected' :
               `${selectedFiles.length} file(s) selected`}
            </p>
            {!uploadType && !selectedFiles.some(f => f.name.toLowerCase().endsWith('.obj')) && (
              <p className="text-sm text-blue-700">⚠️ Please select a .obj file</p>
            )}
            {!uploadType && selectedFiles.some(f => f.name.toLowerCase().endsWith('.obj')) && (
              <p className="text-sm text-green-700">✓ Ready to view model</p>
            )}
          </div>
        )}

        {selectedFiles.length > 0 && uploadType && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Output Format</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() => setFileFormat('glb')}
                className={`p-3 border rounded-lg text-left ${
                  fileFormat === 'glb' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                }`}
              >
                <p className="font-medium">.GLB</p>
              </button>
              <button
                onClick={() => setFileFormat('obj')}
                className={`p-3 border rounded-lg text-left ${
                  fileFormat === 'obj' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                }`}
              >
                <p className="font-medium">.OBJ</p>
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          {selectedFiles.length > 0 && (
            <>
              <Button onClick={handleReset} variant="outline" disabled={isUploading}>Cancel</Button>
              <Button
                onClick={handleUpload}
                disabled={
                  isUploading ||
                  (uploadType === 'images' && (selectedFiles.length < 20 || selectedFiles.length > 300)) ||
                  (!uploadType && !selectedFiles.some(f => f.name.toLowerCase().endsWith('.obj')))
                }
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    {!uploadType ? 'Load Model' : 'Start Processing'}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderProcessingStep = () => (
    <Card>
      <CardHeader><CardTitle className="text-center">Step 2: Processing</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-blue-50 flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
          </div>
          <h3 className="text-xl font-semibold mb-2">{statusMessage}</h3>
          <div className="max-w-md mx-auto">
            <div className="bg-gray-200 rounded-full h-3 overflow-hidden mb-2">
              <div
                className="bg-blue-600 h-full transition-all duration-500"
                style={{ width: `${processingProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600">{Math.round(processingProgress)}% Complete</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderCompletedStep = () => {
    const isLocalModel = !uploadType && localModelUrl;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-center">
            {isLocalModel ? 'View Your Model' : 'Step 3: Complete'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
              <Check className="w-12 h-12 text-green-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Model Loaded!</h3>
            <Button onClick={handleReset} variant="outline">View Another</Button>
          </div>

          {isLocalModel && localModelFileType === 'obj' && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h4 className="font-medium text-gray-900 mb-3">3D Model Preview</h4>
                <OBJViewer
                  url={localModelUrl}
                  className="h-[600px] w-full rounded-md overflow-hidden border border-gray-200"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderFailedStep = () => (
    <Card>
      <CardHeader><CardTitle className="text-center text-red-600">Failed</CardTitle></CardHeader>
      <CardContent className="space-y-6 text-center">
        <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
          <X className="w-12 h-12 text-red-600" />
        </div>
        <p className="text-gray-600 mb-6">{error || 'Unknown error'}</p>
        <Button onClick={handleReset} className="bg-blue-600">Try Again</Button>
      </CardContent>
    </Card>
  );

  const renderTaskList = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Processing Tasks</CardTitle>
          <Button variant="outline" size="sm" onClick={handleRefreshAllTasks} disabled={isRefreshingAll} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${isRefreshingAll ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {allTasks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No tasks found.</div>
        ) : (
          <div className="space-y-3">
            {allTasks.map((task) => (
              <div key={task.id} className="p-4 border border-gray-200 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold">Task {task.taskId.slice(0, 8)}</h3>
                    <p className="text-sm text-gray-500">{task.status}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteTask(task.id).then(loadTasks)}>
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Button>
          <h1 className="text-lg font-bold">3D Processing</h1>
          <Button variant="ghost" size="sm" onClick={() => setCurrentView(currentView === 'workflow' ? 'tasklist' : 'workflow')}>
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {currentView === 'workflow' ? (
          <>
            {renderStepIndicator()}
            {currentStep === 'upload' && renderUploadStep()}
            {currentStep === 'processing' && renderProcessingStep()}
            {currentStep === 'completed' && renderCompletedStep()}
            {currentStep === 'failed' && renderFailedStep()}
          </>
        ) : (
          renderTaskList()
        )}
      </div>
    </div>
  );
};

export default ProcessingProgress;
