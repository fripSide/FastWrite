import { useState, useEffect } from 'react';
import ImportModal from './components/ImportModal';
import Sidebar from './components/Sidebar';
import MainEditor from './components/MainEditor';
import type { Project, SelectedProject, FileNode, SelectedFile } from './types';

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

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

  const handleProjectSelect = (project: SelectedProject | null): void => {
    setSelectedProject(project);
    setSelectedFile(null);
  };

  const handleFileSelect = async (file: FileNode): Promise<void> => {
    if (!selectedProject) return;
    
    try {
      const projectId = selectedProject.project.id;
      const relativePath = file.path.replace(selectedProject.project.localPath + '/', '');
      const response = await fetch(`/api/files/${projectId}/${encodeURIComponent(relativePath)}`);
      
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

  return (
    <div className="flex h-screen w-full bg-slate-100">
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={handleImportComplete}
      />

      <div className="flex h-full w-full">
        <Sidebar
          projects={projects}
          selectedProject={selectedProject}
          onProjectSelect={handleProjectSelect}
          onImportClick={() => setIsImportModalOpen(true)}
          onFileSelect={handleFileSelect}
        />

        <MainEditor selectedFile={selectedFile} selectedProject={selectedProject} />
      </div>
    </div>
  );
}

export default App;
