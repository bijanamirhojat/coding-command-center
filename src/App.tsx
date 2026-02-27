import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Project, GitStatus, AppSettings } from './types';
import {
  scanLibrary,
  getGitStatus,
  openInVscode,
  openInExplorer,
  createProject,
  loadSettings,
  saveSettings,
  runCommand,
  spawnCommand,
  killProcess,
  getProcessUrl,
} from './api';

interface OutputLine {
  id: number;
  timestamp: Date;
  content: string;
  type: 'stdout' | 'stderr' | 'info' | 'success' | 'error';
}

const projectTypeConfig: Record<string, { icon: string; color: string; bg: string }> = {
  node: { icon: 'N', color: '#68a063', bg: 'rgba(104, 160, 99, 0.15)' },
  python: { icon: 'Py', color: '#3776ab', bg: 'rgba(55, 118, 171, 0.15)' },
  go: { icon: 'Go', color: '#00add8', bg: 'rgba(0, 173, 216, 0.15)' },
  rust: { icon: 'Rs', color: '#dea584', bg: 'rgba(222, 165, 132, 0.15)' },
  html: { icon: 'HT', color: '#e34f26', bg: 'rgba(227, 79, 38, 0.15)' },
  generic: { icon: 'F', color: '#a1a1aa', bg: 'rgba(161, 161, 170, 0.15)' },
};

type ViewMode = 'dashboard' | 'project';

function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [libraries, setLibraries] = useState<string[]>(loadSettings().libraries);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, GitStatus>>({});
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runningProcesses, setRunningProcesses] = useState<Record<string, { pid: number; script: string; url?: string }>>({});
  const [showNewProject, setShowNewProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [vscodeInstalled] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [linkRepoModal, setLinkRepoModal] = useState<{ show: boolean; type: 'new' | 'existing' }>({ show: false, type: 'new' });
  const [repoName, setRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [userRepos, setUserRepos] = useState<{ name: string; full_name: string }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [terminalExpanded, setTerminalExpanded] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setLibraries(loaded.libraries);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        document.getElementById('search-input')?.focus();
      }
      if (e.key === 'Escape') {
        setSearchQuery('');
        setTypeFilter([]);
        setViewMode('dashboard');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const addOutput = useCallback((content: string, type: OutputLine['type'] = 'info') => {
    setOutput((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), timestamp: new Date(), content, type },
    ]);
  }, []);

  const renderContentWithLinks = (content: string) => {
    const urlRegex = /(https?:\/\/[^\s]+|localhost:[0-9]+|127\.0\.0\.1:[0-9]+)/;
    const parts = content.split(urlRegex);
    return parts.map((part, i) => {
      if (urlRegex.test(part)) {
        const url = part.startsWith('http') ? part : `http://${part}`;
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="output-link">
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const scanAllLibraries = useCallback(async () => {
    addOutput('Scanning libraries...', 'info');
    const allProjects: Project[] = [];
    const statusMap: Record<string, GitStatus> = {};
    
    for (const lib of libraries) {
      try {
        const proj = await scanLibrary(lib);
        allProjects.push(...proj);
        
        for (const p of proj) {
          if (p.has_git) {
            try {
              const status = await getGitStatus(p.path);
              statusMap[p.path] = status;
            } catch (e) {}
          }
        }
        
        addOutput(`Found ${proj.length} projects in ${lib}`, 'success');
      } catch (e) {
        addOutput(`Error scanning ${lib}: ${e}`, 'error');
      }
    }
    
    setProjects(allProjects);
    setGitStatusMap(statusMap);
    
    if (allProjects.length > 0 && !selectedProject) {
      setSelectedProject(allProjects[0]);
    }
  }, [libraries, selectedProject, addOutput]);

  useEffect(() => {
    if (libraries.length > 0) {
      scanAllLibraries();
    }
  }, [libraries, refreshKey]);

  useEffect(() => {
    if (selectedProject) {
      if (selectedProject.has_git) {
        getGitStatus(selectedProject.path)
          .then(setGitStatus)
          .catch((e) => addOutput(`Git error: ${e}`, 'error'));
      } else {
        setGitStatus(null);
      }
    }
  }, [selectedProject, refreshKey]);

  const filteredProjects = useMemo(() => {
    let result = projects;
    
    if (typeFilter.length > 0) {
      result = result.filter(p => typeFilter.includes(p.project_type));
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.name.toLowerCase().includes(q) ||
        p.project_type.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [projects, searchQuery, typeFilter]);

  const stats = useMemo(() => {
    const total = projects.length;
    const withGit = projects.filter(p => p.has_git).length;
    const dirty = Object.values(gitStatusMap).filter(s => s.is_dirty).length;
    const types = projects.reduce((acc, p) => {
      acc[p.project_type] = (acc[p.project_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return { total, withGit, dirty, types };
  }, [projects, gitStatusMap]);

  const handleRunScript = async (scriptName: string) => {
    if (!selectedProject) return;
    addOutput(`$ npm run ${scriptName}`, 'info');

    try {
      const { pid } = await spawnCommand(selectedProject.path, 'npm', ['run', scriptName]);
      const key = `${selectedProject.path}:${scriptName}`;
      setRunningProcesses(prev => ({
        ...prev,
        [key]: { pid, script: scriptName }
      }));
      addOutput(`Started script "${scriptName}" with PID ${pid}`, 'success');
      
      const checkUrl = async (attempt: number) => {
        if (attempt > 5) return;
        try {
          const url = await getProcessUrl(pid);
          if (url) {
            setRunningProcesses(prev => ({
              ...prev,
              [key]: { ...prev[key], url }
            }));
            addOutput(`🌐 ${url}`, 'success');
          } else {
            setTimeout(() => checkUrl(attempt + 1), 1500);
          }
        } catch (e) {
          setTimeout(() => checkUrl(attempt + 1), 1500);
        }
      };
      setTimeout(() => checkUrl(1), 2000);
    } catch (e) {
      addOutput(`Error: ${e}`, 'error');
    }
  };

  const handleKillProcess = async (scriptName: string) => {
    if (!selectedProject) return;
    const key = `${selectedProject.path}:${scriptName}`;
    const process = runningProcesses[key];
    if (!process) return;

    try {
      await killProcess(process.pid);
      addOutput(`Stopped script "${scriptName}" (PID ${process.pid})`, 'info');
      setRunningProcesses(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      addOutput(`Error stopping process: ${e}`, 'error');
    }
  };

  const handleOpenVscode = async () => {
    if (!selectedProject) return;
    try {
      await openInVscode(selectedProject.path);
      addOutput('Opened in VSCode', 'success');
    } catch (e) {
      addOutput(`Error: ${e}`, 'error');
    }
  };

  const handleOpenExplorer = async () => {
    if (!selectedProject) return;
    try {
      await openInExplorer(selectedProject.path);
      addOutput('Opened in Explorer', 'success');
    } catch (e) {
      addOutput(`Error: ${e}`, 'error');
    }
  };

  const handlePull = async () => {
    if (!selectedProject) return;
    setIsRunning(true);
    addOutput('$ git pull', 'info');

    try {
      const result = await runCommand(selectedProject.path, 'git', ['pull']);
      if (result.stdout) addOutput(result.stdout, 'stdout');
      if (result.stderr) addOutput(result.stderr, 'stderr');
      addOutput('Pull completed', 'success');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      addOutput(`Error: ${e}`, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const handlePush = async () => {
    if (!selectedProject) return;
    if (!commitMessage) {
      setShowCommitModal(true);
      return;
    }
    await executePush(commitMessage);
  };

  const executePush = async (message: string) => {
    if (!selectedProject) return;
    setIsRunning(true);
    setShowCommitModal(false);
    addOutput('$ git add .', 'info');
    addOutput(`$ git commit -m "${message}"`, 'info');
    addOutput('$ git push', 'info');

    try {
      const addResult = await runCommand(selectedProject.path, 'git', ['add', '.']);
      if (addResult.stdout) addOutput(addResult.stdout, 'stdout');
      if (addResult.stderr) addOutput(addResult.stderr, 'stderr');

      const commitResult = await runCommand(selectedProject.path, 'git', ['commit', '-m', message]);
      if (commitResult.stdout) addOutput(commitResult.stdout, 'stdout');
      if (commitResult.stderr) addOutput(commitResult.stderr, 'stderr');

      const pushResult = await runCommand(selectedProject.path, 'git', ['push']);
      if (pushResult.stdout) addOutput(pushResult.stdout, 'stdout');
      if (pushResult.stderr) addOutput(pushResult.stderr, 'stderr');

      addOutput('Push completed', 'success');
      setCommitMessage('');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      addOutput(`Error: ${e}`, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCreateProject = async (options: any) => {
    if (!libraries[0]) return;
    
    try {
      const newProject = await createProject({
        ...options,
        library_path: libraries[0],
        github_token: settings.github_token || null,
      });
      addOutput(`Created project: ${newProject.name}`, 'success');
      setShowNewProject(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      addOutput(`Error creating project: ${e}`, 'error');
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    saveSettings(newSettings);
    setSettings(newSettings);
    setLibraries(newSettings.libraries);
    setShowSettings(false);
  };

  const handleLinkRepo = async (type: 'new' | 'existing') => {
    if (!selectedProject || !settings.github_token) {
      addOutput('GitHub token not configured', 'error');
      return;
    }
    setIsPrivate(false);
    setLinkRepoModal({ show: true, type });
    
    if (type === 'existing') {
      try {
        const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
          headers: {
            'Authorization': `Bearer ${settings.github_token}`,
            'Accept': 'application/vnd.github.v3+json',
          }
        });
        if (response.ok) {
          const repos = await response.json();
          setUserRepos(repos.map((r: any) => ({ name: r.name, full_name: r.full_name })));
        }
      } catch (e) {
        addOutput('Failed to fetch repos', 'error');
      }
    }
  };

  const executeLinkRepo = async () => {
    if (!selectedProject || !settings.github_token || !repoName) return;
    
    setIsLinking(true);
    
    try {
      if (linkRepoModal.type === 'new') {
        // First check if git exists locally, if not initialize it
        const gitCheck = await runCommand(selectedProject.path, 'git', ['rev-parse', '--git-dir']);
        
        if (gitCheck.exit_code !== 0) {
          addOutput('Initializing local git repository...', 'info');
          await runCommand(selectedProject.path, 'git', ['init']);
        }
        
        addOutput(`Creating new GitHub repo: ${repoName}...`, 'info');
        const response = await fetch('https://api.github.com/user/repos', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.github_token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: repoName,
            description: selectedProject.description || selectedProject.name,
            private: isPrivate,
            auto_init: true
          })
        });
        
        if (!response.ok) {
          const err = await response.json();
          if (response.status === 403) {
            throw new Error('403 Forbidden: Make sure your token has "Repository creation" permission. Use a Classic PAT with "repo" scope instead.');
          }
          throw new Error(err.message || `Failed to create repo (${response.status})`);
        }
        
        const data = await response.json();
        const remoteUrl = data.clone_url;
        
        // Add token to URL for push authentication
        const authUrl = remoteUrl.replace('https://', `https://${settings.github_token}@`);
        
        await runCommand(selectedProject.path, 'git', ['remote', 'add', 'origin', authUrl]);
        await runCommand(selectedProject.path, 'git', ['branch', '-M', 'main']);
        
        // Check if there are any files to commit
        const statusCheck = await runCommand(selectedProject.path, 'git', ['status', '--porcelain']);
        if (statusCheck.stdout.trim()) {
          await runCommand(selectedProject.path, 'git', ['add', '.']);
          await runCommand(selectedProject.path, 'git', ['commit', '-m', 'Initial commit']);
        }
        
        // Always push (even if no commits, this sets up the remote)
        addOutput('Pushing to remote...', 'info');
        const pushResult = await runCommand(selectedProject.path, 'git', ['push', '-u', 'origin', 'main']);
        if (pushResult.exit_code !== 0) {
          addOutput(`Push note: ${pushResult.stderr || 'completed'}`, 'info');
        }
        
        addOutput(`Created and linked repo: ${remoteUrl}`, 'success');
      } else {
        addOutput(`Linking to existing repo: ${repoName}...`, 'info');
        
        // First check if git exists locally, if not initialize it
        const gitCheck = await runCommand(selectedProject.path, 'git', ['rev-parse', '--git-dir']);
        if (gitCheck.exit_code !== 0) {
          addOutput('Initializing local git repository...', 'info');
          await runCommand(selectedProject.path, 'git', ['init']);
        }
        
        const remoteUrl = `https://github.com/${repoName}.git`;
        
        // Add token to URL for push authentication
        const authUrl = remoteUrl.replace('https://', `https://${settings.github_token}@`);
        
        await runCommand(selectedProject.path, 'git', ['remote', 'add', 'origin', authUrl]);
        
        // Check if there are any files to commit and push
        const statusCheck = await runCommand(selectedProject.path, 'git', ['status', '--porcelain']);
        if (statusCheck.stdout.trim()) {
          await runCommand(selectedProject.path, 'git', ['add', '.']);
          await runCommand(selectedProject.path, 'git', ['commit', '-m', 'Initial commit']);
          await runCommand(selectedProject.path, 'git', ['push', '-u', 'origin', 'main']);
        }
        
        addOutput(`Linked to repo: ${remoteUrl}`, 'success');
      }
      
      setLinkRepoModal({ show: false, type: 'new' });
      setRepoName('');
      setIsLinking(false);
      setRefreshKey(k => k + 1);
    } catch (e: any) {
      addOutput(`Error: ${e.message}`, 'error');
      setIsLinking(false);
    }
  };

  const handleTypeToggle = (type: string) => {
    setTypeFilter(prev => {
      if (prev.includes(type)) {
        return prev.filter(t => t !== type);
      } else {
        return [...prev, type];
      }
    });
  };

  const clearOutput = () => setOutput([]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1 className="title">Command Center</h1>
          <select
            className="library-select"
            value={libraries[0] || ''}
            onChange={(e) => {
              if (e.target.value) {
                setLibraries([e.target.value]);
              }
            }}
          >
            <option value="">Select library...</option>
            {libraries.map((lib) => (
              <option key={lib} value={lib}>
                {lib}
              </option>
            ))}
          </select>
        </div>
        <div className="header-right">
          <div className="header-search">
            <input
              id="search-input"
              type="text"
              className="search-input"
              placeholder="Search... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
          <button className="btn btn-new-project" onClick={() => setShowNewProject(true)}>
            + New Project
          </button>
          <button className="btn btn-icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh">
            ↻
          </button>
        </div>
      </header>

      <main className="main">
        <aside className="sidebar">
          <div className="sidebar-header">
            <button className="sidebar-dashboard-btn" onClick={() => setViewMode('dashboard')}>
              Dashboard
            </button>
            <div className="project-count-badge">
              <span className="count-number">{filteredProjects.length}</span>
              <span className="count-label">projects</span>
            </div>
          </div>
          <div className="project-list">
            {filteredProjects.map((project) => {
              const config = projectTypeConfig[project.project_type] || projectTypeConfig.generic;
              return (
                <div
                  key={project.path}
                  className={`project-item ${selectedProject?.path === project.path ? 'selected' : ''}`}
                  onClick={() => { setSelectedProject(project); setViewMode('project'); }}
                >
                  <div className="project-icon" style={{ background: config.bg, color: config.color }}>
                    {config.icon}
                  </div>
                  <div className="project-info">
                    <span className="project-name">{project.name}</span>
                    <span className="project-type">{project.project_type}</span>
                  </div>
                  {project.has_git && gitStatusMap[project.path] && (
                    <span
                      className={`git-indicator ${gitStatusMap[project.path].is_dirty ? 'dirty' : 'clean'}`}
                    />
                  )}
                </div>
              );
            })}
            {filteredProjects.length === 0 && (
              <div className="empty-state">
                {searchQuery ? 'No projects match your search' : libraries.length === 0 ? 'Add a library in Settings' : 'No projects found'}
              </div>
            )}
          </div>
          <div className="sidebar-footer">
            <button className="btn btn-settings" onClick={() => setShowSettings(true)}>
              ⚙ Settings
            </button>
          </div>
        </aside>

        <section className="content">
          {viewMode === 'dashboard' ? (
            <DashboardView 
              stats={stats} 
              projects={projects} 
              onSelectProject={(p) => { setSelectedProject(p); setViewMode('project'); }} 
              gitStatusMap={gitStatusMap}
              typeFilter={typeFilter}
              onTypeToggle={handleTypeToggle}
            />
          ) : selectedProject ? (
            <ProjectDetail
              project={selectedProject}
              gitStatus={gitStatus}
              onRunScript={handleRunScript}
              onOpenVscode={handleOpenVscode}
              onOpenExplorer={handleOpenExplorer}
              onPull={handlePull}
              onPush={handlePush}
              isRunning={isRunning}
              vscodeInstalled={vscodeInstalled}
              onLinkRepo={handleLinkRepo}
              runningProcesses={runningProcesses}
              onKillProcess={handleKillProcess}
            />
          ) : (
            <div className="no-selection">
              <span className="no-selection-icon">📂</span>
              <p>Select a project to view details</p>
            </div>
          )}
        </section>
      </main>

      <footer className={`output-panel ${terminalExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="output-header" onClick={() => setTerminalExpanded(!terminalExpanded)}>
          <h3><span className="output-dot"></span> Terminal</h3>
          <div className="output-actions">
            <button className="btn btn-small" onClick={(e) => { e.stopPropagation(); clearOutput(); }}>
              Clear
            </button>
            <span className="toggle-icon">{terminalExpanded ? '▼' : '▲'}</span>
          </div>
        </div>
        {terminalExpanded && (
          <div className="output-content" ref={outputRef}>
            {output.map((line) => (
              <div key={line.id} className={`output-line ${line.type}`}>
                <span className="timestamp">{line.timestamp.toLocaleTimeString()}</span>
                <pre>{renderContentWithLinks(line.content)}</pre>
              </div>
            ))}
          </div>
        )}
      </footer>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
          hasGithubToken={!!settings.github_token}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
        />
      )}

      {showCommitModal && (
        <div className="modal-backdrop" onClick={() => setShowCommitModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Commit Message</h3>
            <input
              type="text"
              className="input"
              placeholder="Enter commit message..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executePush(commitMessage)}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCommitModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => executePush(commitMessage)}>
                Commit & Push
              </button>
            </div>
          </div>
        </div>
      )}

      {linkRepoModal.show && (
        <div className="modal-backdrop" onClick={() => !isLinking && setLinkRepoModal({ show: false, type: 'new' })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{linkRepoModal.type === 'new' ? 'Create New Repository' : 'Link Existing Repository'}</h3>
            
            <div className="form-group">
              <label>Repository</label>
              {linkRepoModal.type === 'existing' ? (
                <select
                  className="input"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  disabled={isLinking}
                >
                  <option value="">Select a repository...</option>
                  {userRepos.map((repo) => (
                    <option key={repo.full_name} value={repo.full_name}>
                      {repo.full_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="input"
                  placeholder="my-new-repo"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  disabled={isLinking}
                  autoFocus
                />
              )}
              <p className="help-text">
                {linkRepoModal.type === 'new' ? 'A new GitHub repository will be created' : 'Select a repository from your GitHub account'}
              </p>
            </div>

            {linkRepoModal.type === 'new' && (
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    disabled={isLinking}
                  />
                  Private repository
                </label>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setLinkRepoModal({ show: false, type: 'new' })} disabled={isLinking}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={executeLinkRepo} disabled={!repoName || isLinking}>
                {isLinking ? (
                  <span className="loading-spinner">Loading...</span>
                ) : linkRepoModal.type === 'new' ? (
                  'Create & Push'
                ) : (
                  'Link Repository'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardView({ stats, projects, onSelectProject, gitStatusMap, typeFilter, onTypeToggle }: { 
  stats: { total: number; withGit: number; dirty: number; types: Record<string, number> };
  projects: Project[];
  onSelectProject: (p: Project) => void;
  gitStatusMap: Record<string, GitStatus>;
  typeFilter: string[];
  onTypeToggle: (type: string) => void;
}) {
  const dirtyProjects = projects.filter(p => gitStatusMap[p.path]?.is_dirty);
  
  return (
    <div className="dashboard">
      <h2 className="dashboard-title">Dashboard</h2>
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.withGit}</div>
          <div className="stat-label">Git Repos</div>
        </div>
        <div className="stat-card highlight">
          <div className="stat-value">{stats.dirty}</div>
          <div className="stat-label">With Changes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{Object.keys(stats.types).length}</div>
          <div className="stat-label">Tech Stack</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3>Projects by Type {typeFilter.length > 0 && <span className="filter-active">({typeFilter.length} selected)</span>}</h3>
        <div className="type-grid">
          {Object.entries(stats.types).map(([type, count]) => {
            const config = projectTypeConfig[type] || projectTypeConfig.generic;
            const isSelected = typeFilter.length === 0 || typeFilter.includes(type);
            return (
              <div 
                key={type} 
                className={`type-card ${isSelected ? '' : 'dimmed'}`}
                style={{ borderColor: config.color }}
                onClick={() => onTypeToggle(type)}
              >
                <div className="type-icon" style={{ background: config.bg, color: config.color }}>{config.icon}</div>
                <div className="type-info">
                  <div className="type-name">{type}</div>
                  <div className="type-count">{count} project{count > 1 ? 's' : ''}</div>
                </div>
                {isSelected && typeFilter.length > 0 && <span className="type-check">✓</span>}
              </div>
            );
          })}
        </div>
        {typeFilter.length > 0 && (
          <button className="clear-filters-btn" onClick={() => typeFilter.forEach(t => onTypeToggle(t))}>
            Clear filters
          </button>
        )}
      </div>

      {dirtyProjects.length > 0 && (
        <div className="dashboard-section">
          <h3>Projects with Changes</h3>
          <div className="dirty-list">
            {dirtyProjects.map(p => (
              <div key={p.path} className="dirty-item" onClick={() => onSelectProject(p)}>
                <span className="git-indicator dirty" />
                <span className="dirty-name">{p.name}</span>
                <span className="dirty-count">{gitStatusMap[p.path]?.modified.length + gitStatusMap[p.path]?.untracked.length} files</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-section">
        <h3>Recent Projects</h3>
        <div className="recent-grid">
          {projects.slice(0, 6).map(p => {
            const config = projectTypeConfig[p.project_type] || projectTypeConfig.generic;
            return (
              <div key={p.path} className="recent-card" onClick={() => onSelectProject(p)}>
                <div className="recent-icon" style={{ background: config.bg, color: config.color }}>{config.icon}</div>
                <div className="recent-info">
                  <div className="recent-name">{p.name}</div>
                  <div className="recent-type">{p.project_type}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  gitStatus,
  onRunScript,
  onOpenVscode,
  onOpenExplorer,
  onPull,
  onPush,
  isRunning,
  vscodeInstalled,
  onLinkRepo,
  runningProcesses,
  onKillProcess,
}: {
  project: Project;
  gitStatus: GitStatus | null;
  onRunScript: (name: string) => void;
  onOpenVscode: () => void;
  onOpenExplorer: () => void;
  onPull: () => void;
  onPush: () => void;
  isRunning: boolean;
  vscodeInstalled: boolean;
  onLinkRepo: (type: 'new' | 'existing') => void;
  runningProcesses: Record<string, { pid: number; script: string; url?: string }>;
  onKillProcess: (scriptName: string) => void;
}) {
  const config = projectTypeConfig[project.project_type] || projectTypeConfig.generic;
  
  return (
    <div className="project-detail">
      <div className="detail-header">
        <div className="detail-icon" style={{ background: config.bg, color: config.color }}>
          {config.icon}
        </div>
        <div>
          <h2>{project.name}</h2>
          <span className={`badge ${project.project_type}`}>{project.project_type}</span>
        </div>
      </div>

      {project.description && <p className="detail-description">{project.description}</p>}

      <div className="detail-path">
        <code>{project.path}</code>
      </div>

      <div className="action-row">
        <button className="btn btn-primary" onClick={onOpenVscode} disabled={!vscodeInstalled}>
          Open in VSCode
        </button>
        <button className="btn btn-secondary" onClick={onOpenExplorer}>
          Open in Explorer
        </button>
      </div>

      <div className="git-panel">
        <div className="git-panel-header">
          <span className="git-panel-title">Git</span>
          {gitStatus?.branch && (
            <span className="git-branch">
              ⎇ {gitStatus.branch}
              {gitStatus.ahead > 0 && <span className="ahead">↑{gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span className="behind">↓{gitStatus.behind}</span>}
            </span>
          )}
        </div>
        
        {!project.has_git ? (
          <div className="no-remote">
            <p>No git repository initialized</p>
            <div className="link-options">
              <button className="btn btn-primary" onClick={() => onLinkRepo('new')}>
                + Initialize Git & Create Repo
              </button>
            </div>
          </div>
        ) : !gitStatus?.remote_url ? (
            <div className="no-remote">
              <p>No remote repository linked</p>
              <div className="link-options">
                <button className="btn btn-secondary" onClick={() => onLinkRepo('new')}>
                  + Create new repo
                </button>
                <button className="btn btn-secondary" onClick={() => onLinkRepo('existing')}>
                  Link existing repo
                </button>
              </div>
            </div>
          ) : (
            <>
              {(gitStatus.modified.length > 0 || gitStatus.untracked.length > 0 || gitStatus.staged.length > 0) && (
                <div className="git-changes">
                  {gitStatus.staged.length > 0 && (
                    <div className="change-group">
                      <span className="change-label staged">Staged ({gitStatus.staged.length})</span>
                      {gitStatus.staged.slice(0, 5).map((f, i) => <span key={i} className="change-file">{f}</span>)}
                      {gitStatus.staged.length > 5 && <span className="change-more">+{gitStatus.staged.length - 5} more</span>}
                    </div>
                  )}
                  {gitStatus.modified.length > 0 && (
                    <div className="change-group">
                      <span className="change-label modified">Modified ({gitStatus.modified.length})</span>
                      {gitStatus.modified.slice(0, 5).map((f, i) => <span key={i} className="change-file">{f}</span>)}
                      {gitStatus.modified.length > 5 && <span className="change-more">+{gitStatus.modified.length - 5} more</span>}
                    </div>
                  )}
                  {gitStatus.untracked.length > 0 && (
                    <div className="change-group">
                      <span className="change-label untracked">Untracked ({gitStatus.untracked.length})</span>
                      {gitStatus.untracked.slice(0, 5).map((f, i) => <span key={i} className="change-file">{f}</span>)}
                      {gitStatus.untracked.length > 5 && <span className="change-more">+{gitStatus.untracked.length - 5} more</span>}
                    </div>
                  )}
                </div>
              )}
              
              <div className="git-actions">
                <button
                  className="btn btn-secondary"
                  onClick={onPull}
                  disabled={isRunning || !gitStatus.remote_url || gitStatus.behind === 0}
                >
                  Pull {gitStatus.behind > 0 && `(${gitStatus.behind})`}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={onPush}
                  disabled={isRunning || (!gitStatus.is_dirty && gitStatus.ahead === 0)}
                >
                  Push {gitStatus.ahead > 0 && `(${gitStatus.ahead})`}
                </button>
              </div>
            </>
          )}
        </div>

      {project.scripts.length > 0 && (
        <div className="scripts-panel">
          <h3>Scripts</h3>
          <div className="scripts-grid">
            {project.scripts.map((script) => {
              const key = `${project.path}:${script.name}`;
              const isRunning = !!runningProcesses[key];
              const process = runningProcesses[key];
              return (
                <div key={script.name} className="script-item">
                  <button
                    className={`btn btn-script ${isRunning ? 'running' : ''}`}
                    onClick={() => isRunning ? onKillProcess(script.name) : onRunScript(script.name)}
                  >
                    {isRunning ? '■ Stop' : script.name}
                  </button>
                  {isRunning && (
                    <>
                      <span className="running-badge">PID {process?.pid}</span>
                      {process?.url && (
                        <a 
                          href={process.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="url-button"
                          onClick={(e) => e.stopPropagation()}
                          title={process.url}
                        >
                          <span className="url-icon">🔗</span>
                          <span className="url-text">{process.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                        </a>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NewProjectModal({ onClose, onCreate, hasGithubToken }: any) {
  const [name, setName] = useState('');
  const [projectType, setProjectType] = useState('node');
  const [initGit, setInitGit] = useState(true);
  const [createGithub, setCreateGithub] = useState(hasGithubToken);
  const [repoName, setRepoName] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      project_type: projectType,
      init_git: initGit,
      create_github_repo: createGithub && hasGithubToken,
      github_repo_name: repoName || name.toLowerCase().replace(/\s+/g, '-'),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Project</h2>
        
        <div className="form-group">
          <label>Project Name</label>
          <input type="text" className="input" placeholder="my-awesome-project" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Project Type</label>
          <select className="input" value={projectType} onChange={(e) => setProjectType(e.target.value)}>
            <option value="node">Node.js (Vite)</option>
            <option value="python">Python</option>
            <option value="html">HTML/CSS/JS</option>
          </select>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" checked={initGit} onChange={(e) => setInitGit(e.target.checked)} />
            Initialize Git repository
          </label>
        </div>

        {hasGithubToken && (
          <div className="form-group">
            <label className="checkbox-label">
              <input type="checkbox" checked={createGithub} onChange={(e) => setCreateGithub(e.target.checked)} />
              Create GitHub repository
            </label>
          </div>
        )}

        {createGithub && hasGithubToken && (
          <div className="form-group">
            <label>Repository Name (optional)</label>
            <input type="text" className="input" placeholder={name.toLowerCase().replace(/\s+/g, '-')} value={repoName} onChange={(e) => setRepoName(e.target.value)} />
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!name.trim()}>Create Project</button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ settings, onClose, onSave }: any) {
  const [libraries, setLibraries] = useState(settings.libraries.join('\n'));
  const [token, setToken] = useState(settings.github_token);

  const handleSave = () => {
    onSave({
      libraries: libraries.split('\n').filter((l: string) => l.trim()),
      github_token: token,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="form-group">
          <label>Library Paths (one per line)</label>
          <textarea className="input textarea" rows={5} value={libraries} onChange={(e) => setLibraries(e.target.value)} placeholder="Z:/Dev/Opencode" />
        </div>

        <div className="form-group">
          <label>GitHub Personal Access Token</label>
          <input type="password" className="input" placeholder="ghp_xxxxxxxxxxxx" value={token} onChange={(e) => setToken(e.target.value)} />
          <p className="help-text">Required for creating GitHub repositories. Generate at github.com/settings/tokens</p>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}

export default App;
