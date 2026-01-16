import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import ImportModal from './components/ImportModal';
import Sidebar from './components/Sidebar';
import MainEditor, { MainEditorRef } from './components/MainEditor'; // Import Ref type
import PDFViewer, { PDFViewerRef } from './components/PDFViewer'; // Import Ref type
import type { Project, SelectedProject, FileNode, SelectedFile, ProjectConfig } from './types';
import { api } from './api';
import { ArrowLeft, ArrowRight, AlertCircle, Check, Loader2 } from 'lucide-react'; // Import Icons

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const [pdfScrollTarget, setPdfScrollTarget] = useState<{ page: number; x: number; y: number } | null>(null);

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'loading' } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast && toast.type !== 'loading') {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);



  // Resizable panel widths
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [pdfWidth, setPdfWidth] = useState(400);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingPdf, setIsResizingPdf] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs for sync coordination
  const mainEditorRef = useRef<MainEditorRef>(null);
  const pdfViewerRef = useRef<PDFViewerRef>(null);

  const loadProjects = async (): Promise<void> => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json() as Project[];
        setProjects(data);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  // Fetch project config when project changes
  useEffect(() => {
    if (selectedProject?.project.id) {
      api.getProjectConfig(selectedProject.project.id).then(config => {
        if (config) setProjectConfig(config);
      });
    } else {
      setProjectConfig(null);
    }
  }, [selectedProject?.project.id]);

  // Handle resize mouse events
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const windowWidth = containerRef.current.clientWidth;
      const minEditorWidth = 400; // Minimum width for the central editor

      if (isResizingSidebar) {
        const rawWidth = e.clientX;
        // Auto-collapse if dragged below 80px
        if (rawWidth < 80) {
          setSidebarWidth(0);
        } else {
          // Constrain width: can't exceed 400px, and must leave space for editor + pdf
          const maxSidebarWidth = windowWidth - (selectedProject ? pdfWidth : 0) - minEditorWidth;
          const constrainedWidth = Math.min(Math.min(400, maxSidebarWidth), rawWidth);
          setSidebarWidth(Math.max(0, constrainedWidth));
        }
      }

      if (isResizingPdf) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const rawWidth = containerRect.right - e.clientX;
        // Auto-collapse if dragged below 150px
        if (rawWidth < 150) {
          setPdfWidth(0);
        } else {
          // Constrain width: can't exceed 800px, and must leave space for editor + sidebar
          const maxPdfWidth = windowWidth - sidebarWidth - minEditorWidth;
          const constrainedWidth = Math.min(Math.min(800, maxPdfWidth), rawWidth);
          setPdfWidth(Math.max(0, constrainedWidth));
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingPdf(false);
    };

    if (isResizingSidebar || isResizingPdf) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar, isResizingPdf]);

  // Sync Handlers
  const handleSyncToPDF = async () => {
    console.log('[App] Triggering Forward Sync (Source -> PDF)');
    if (mainEditorRef.current && selectedProject && selectedFile) {
      const line = mainEditorRef.current.getCurrentLine();
      console.log('[App] Current line in editor:', line);

      setToast({ message: 'Syncing to PDF...', type: 'loading' });

      try {
        const response = await fetch('/api/latex/forward-synctex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: selectedProject.project.id,
            file: selectedFile.path,
            line: line
          })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('[App] Forward sync result:', result);
          if (result.page) {
            setPdfScrollTarget({ page: result.page, x: result.x, y: result.y });
            setToast({ message: 'Sync complete', type: 'success' });
          } else {
            setToast({ message: 'No sync point found for this line', type: 'error' });
          }
        } else if (response.status === 404) {
          console.error('[App] Forward sync API not found (404)');
          setToast({ message: "Sync API not found. Please restart 'bun run dev'", type: 'error' });
        } else {
          console.error('[App] Forward sync failed:', response.status, response.statusText);
          setToast({ message: 'Sync failed: Server error', type: 'error' });
        }
      } catch (error) {
        console.error('Manual forward sync failed:', error);
        setToast({ message: 'Sync failed: Network error', type: 'error' });
      }
    } else {
      console.warn('[App] Missing refs or selection for Forward Sync');
      setToast({ message: 'Cannot sync: Editor not ready', type: 'error' });
    }
  };

  const handleTriggerReverseSync = async () => {
    console.log('[App] Triggering Reverse Sync (PDF -> Source)');
    if (pdfViewerRef.current) {
      setToast({ message: 'Syncing to Editor...', type: 'loading' });
      const result = await pdfViewerRef.current.syncFromSelection();

      if (result.success) {
        setToast({ message: 'Sync complete', type: 'success' });
      } else {
        setToast({ message: result.message || 'Sync failed', type: 'error' });
      }
    } else {
      console.warn('[App] PDF Viewer ref is null');
    }
  };

  const handleProjectSelect = (project: SelectedProject | null): void => {
    setSelectedProject(project);
    setSelectedFile(null);
  };

  const handleFileSelect = async (file: FileNode): Promise<void> => {
    if (!selectedProject) return;

    try {
      const projectId = selectedProject.project.id;
      const response = await fetch(`/api/files/${encodeURIComponent(file.path)}?projectId=${encodeURIComponent(projectId)}`);

      if (response.ok) {
        const data = await response.json();
        setSelectedFile({
          id: file.id,
          name: file.name,
          path: file.path,
          content: data.content
        });
      }
    } catch (error) {
      console.error('Failed to load file:', error);
    }
  };

  const handleImportComplete = (_project: Project): void => {
    setIsImportModalOpen(false);
    loadProjects();
  };

  // Handle PDF-to-source sync
  const handleSyncToSource = useCallback((filePath: string, line: number) => {
    setScrollToLine(line);
    setTimeout(() => setScrollToLine(null), 100);
  }, []);

  // Get main tex path from config (or fall back to selected file)
  const mainTexPath = useMemo(() => {
    if (projectConfig?.mainFile && projectConfig.sectionsDir) {
      return `${projectConfig.sectionsDir}/${projectConfig.mainFile}`;
    }
    return selectedFile?.path || null;
  }, [projectConfig, selectedFile?.path]);

  // Double-click to collapse/expand
  const handleSidebarDividerDoubleClick = () => {
    setSidebarWidth(prev => prev < 100 ? 200 : 50);
  };

  const handlePdfDividerDoubleClick = () => {
    setPdfWidth(prev => prev < 100 ? 400 : 50);
  };

  return (
    <div ref={containerRef} className="flex h-screen w-full bg-slate-100">
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={handleImportComplete}
        existingProjects={projects}
      />

      <div className="flex h-full w-full">
        {/* Left: Sidebar */}
        <div
          className="shrink-0 overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <Sidebar
            projects={projects}
            selectedProject={selectedProject}
            onProjectSelect={handleProjectSelect}
            onImportClick={() => setIsImportModalOpen(true)}
            onFileSelect={handleFileSelect}
            onProjectDelete={loadProjects}
          />
        </div>

        {/* Sidebar resize handle */}
        <div
          className={`shrink-0 cursor-col-resize flex flex-col items-center justify-center relative group/sidebar transition-colors z-10 ${sidebarWidth === 0 ? 'w-4 bg-slate-100 hover:bg-slate-200' : 'w-1'} ${isResizingSidebar ? 'bg-blue-500' : sidebarWidth > 0 ? 'bg-slate-200 hover:bg-slate-300' : ''}`}
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest('button')) {
              setIsResizingSidebar(true);
            }
          }}
        >
          {/* Drag indicator dots */}
          <div className="flex flex-col gap-0.5 mb-1">
            <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
            <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
            <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
          </div>



          {/* Collapse button - larger when collapsed */}
          <button
            onClick={() => setSidebarWidth(prev => prev > 0 ? 0 : 200)}
            className={`flex items-center justify-center rounded-sm bg-slate-300 text-slate-500 hover:bg-green-500 hover:text-white transition-all ${sidebarWidth === 0 ? 'w-5 h-10 text-xs' : 'w-3 h-8 text-[8px]'}`}
            title={sidebarWidth > 0 ? 'Collapse' : 'Expand'}
          >
            {sidebarWidth > 0 ? '◀' : '▶'}
          </button>
          {/* Drag indicator dots */}
          <div className="flex flex-col gap-0.5 mt-1">
            <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
            <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
            <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
          </div>
        </div>

        {/* Center: Editor */}
        <div className="flex-1 min-w-[400px] overflow-hidden flex flex-col relative bg-white z-0">
          <MainEditor
            ref={mainEditorRef}
            selectedFile={selectedFile}
            selectedProject={selectedProject}
            scrollToLine={scrollToLine}
            onSyncToPDF={(page, x, y) => setPdfScrollTarget({ page, x, y })} // Pass sync handler
          />
        </div>

        {/* PDF resize handle */}
        {selectedProject && (
          <div
            className={`shrink-0 w-1 cursor-col-resize flex flex-col items-center justify-center relative group/pdf transition-colors ${isResizingPdf ? 'bg-blue-500' : 'bg-slate-200 hover:bg-slate-300'}`}
            onMouseDown={(e) => {
              if (!(e.target as HTMLElement).closest('button')) {
                setIsResizingPdf(true);
              }
            }}
          >
            {/* Drag indicator dots */}
            <div className="flex flex-col gap-0.5 mb-1">
              <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
              <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
              <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
            </div>

            {/* Sync Buttons Pill - Flex flow (mb-2 to separate from collapse button) */}
            <div className="flex flex-col gap-1.5 bg-white shadow-md rounded-full py-2 px-0.5 z-20 border border-slate-200 mb-4">
              <button
                onMouseDown={(e) => e.stopPropagation()} // Prevent drag start
                onClick={(e) => { e.stopPropagation(); handleSyncToPDF(); }}
                className="p-1 hover:bg-slate-100 rounded-full text-slate-500 hover:text-blue-600 transition-colors"
                title="Sync to PDF (Forward Search)"
              >
                <ArrowRight size={14} />
              </button>
              <div className="h-px w-3 bg-slate-200 mx-auto" />
              <button
                onMouseDown={(e) => e.stopPropagation()} // Prevent drag start
                onClick={(e) => { e.stopPropagation(); handleTriggerReverseSync(); }}
                className="p-1 hover:bg-slate-100 rounded-full text-slate-500 hover:text-blue-600 transition-colors"
                title="Sync to Editor (Reverse Search)"
              >
                <ArrowLeft size={14} />
              </button>
            </div>

            {/* Collapse button - tall and slim */}
            <button
              onClick={() => setPdfWidth(prev => prev > 0 ? 0 : 400)}
              className="w-3 h-8 flex items-center justify-center rounded-sm bg-slate-300 text-slate-500 hover:bg-green-500 hover:text-white transition-all text-[8px]"
              title={pdfWidth > 0 ? 'Collapse' : 'Expand'}
            >
              {pdfWidth > 0 ? '▶' : '◀'}
            </button>
            {/* Drag indicator dots */}
            <div className="flex flex-col gap-0.5 mt-1">
              <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
              <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
              <div className="w-0.5 h-0.5 rounded-full bg-slate-400" />
            </div>
          </div>
        )}

        {/* Right: PDF Viewer */}
        {selectedProject && (
          <div
            className="shrink-0 overflow-hidden bg-slate-800"
            style={{ width: pdfWidth }}
          >
            <PDFViewer
              ref={pdfViewerRef}
              projectId={selectedProject.project.id}
              mainTexPath={mainTexPath}
              onSyncToSource={handleSyncToSource}
              scrollTo={pdfScrollTarget}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
