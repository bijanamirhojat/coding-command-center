import express from 'express';
import cors from 'cors';
import { exec, spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

function detectProjectType(dirPath) {
  if (fs.existsSync(path.join(dirPath, 'package.json'))) return 'node';
  if (fs.existsSync(path.join(dirPath, 'requirements.txt')) ||
      fs.existsSync(path.join(dirPath, 'pyproject.toml'))) return 'python';
  if (fs.existsSync(path.join(dirPath, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(dirPath, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(dirPath, 'index.html'))) return 'html';
  return 'generic';
}

function getScripts(dirPath) {
  const pkgPath = path.join(dirPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts) {
        return Object.entries(pkg.scripts).map(([name, command]) => ({ name, command }));
      }
    } catch (e) {}
  }
  return [];
}

function getGitInfo(dirPath) {
  const gitDir = path.join(dirPath, '.git');
  if (!fs.existsSync(gitDir)) return { hasGit: false, branch: null, remoteUrl: null };
  
  let branch = null;
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref: refs/heads/')) {
      branch = head.replace('ref: refs/heads/', '');
    } else {
      branch = head;
    }
  } catch (e) {}
  
  let remoteUrl = null;
  try {
    const config = fs.readFileSync(path.join(gitDir, 'config'), 'utf-8');
    const lines = config.split('\n');
    let inOrigin = false;
    for (const line of lines) {
      if (line.trim() === '[remote "origin"]') inOrigin = true;
      else if (inOrigin && line.trim().startsWith('url = ')) {
        remoteUrl = line.trim().replace('url = ', '');
        break;
      }
    }
  } catch (e) {}
  
  return { hasGit: true, branch, remoteUrl };
}

app.get('/api/scan-library', (req, res) => {
  const { libraryPath } = req.query;
  if (!libraryPath || !fs.existsSync(libraryPath)) {
    return res.status(400).json({ error: 'Invalid library path' });
  }
  
  const projects = [];
  const entries = fs.readdirSync(libraryPath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(libraryPath, entry.name);
    const name = entry.name;
    
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'target') continue;
    
    const projectType = detectProjectType(dirPath);
    const gitInfo = getGitInfo(dirPath);
    const scripts = getScripts(dirPath);
    
    let description = null;
    if (projectType === 'node') {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dirPath, 'package.json'), 'utf-8'));
        description = pkg.description;
      } catch (e) {}
    } else {
      const readmePath = path.join(dirPath, 'README.md');
      if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, 'utf-8');
        description = content.split('\n')[0]?.replace(/^#\s*/, '');
      }
    }
    
    projects.push({
      name,
      path: dirPath,
      project_type: projectType,
      has_git: gitInfo.hasGit,
      remote_url: gitInfo.remoteUrl,
      branch: gitInfo.branch,
      has_changes: false,
      scripts,
      description
    });
  }
  
  projects.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  res.json(projects);
});

app.get('/api/git-status', (req, res) => {
  const { projectPath } = req.query;
  if (!projectPath) {
    return res.status(400).json({ error: 'Missing projectPath' });
  }
  
  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return res.json({
      branch: '',
      ahead: 0,
      behind: 0,
      modified: [],
      staged: [],
      untracked: [],
      is_dirty: false,
      remote_url: null
    });
  }
  
  let branch = null;
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref: refs/heads/')) {
      branch = head.replace('ref: refs/heads/', '');
    } else {
      branch = head;
    }
  } catch (e) {}
  
  let remoteUrl = null;
  try {
    const config = fs.readFileSync(path.join(gitDir, 'config'), 'utf-8');
    const lines = config.split('\n');
    let inOrigin = false;
    for (const line of lines) {
      if (line.trim() === '[remote "origin"]') inOrigin = true;
      else if (inOrigin && line.trim().startsWith('url = ')) {
        remoteUrl = line.trim().replace('url = ', '');
        break;
      }
    }
  } catch (e) {}
  
  let modified = [];
  let staged = [];
  let untracked = [];
  let ahead = 0;
  let behind = 0;
  
  try {
    // Get status
    try {
      const statusOutput = execSync('git status --porcelain', { 
        cwd: projectPath, 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      
      const lines = statusOutput.trim().split('\n').filter(l => l);
      for (const line of lines) {
        const indexStatus = line.substring(0, 2);
        const filePath = line.substring(3).trim();
        
        if (indexStatus[0] === '?' || indexStatus[0] === 'A') {
          untracked.push(filePath);
        } else if (indexStatus[0] !== ' ') {
          staged.push(filePath);
        }
        
        if (indexStatus[1] === 'M' || indexStatus[1] === 'D') {
          modified.push(filePath);
        } else if (indexStatus[0] !== ' ' && indexStatus[0] !== '?') {
          modified.push(filePath);
        }
      }
    } catch (e) {
      console.error('Git status error:', e);
    }
    
    // Get ahead/behind if remote exists
    if (remoteUrl) {
      try {
        execSync('git fetch origin', { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        
        try {
          const aheadOutput = execSync(`git rev-list --count HEAD..origin/${branch}`, { 
            cwd: projectPath, 
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          behind = parseInt(aheadOutput.trim()) || 0;
        } catch (e) {}
        
        try {
          const behindOutput = execSync(`git rev-list --count origin/${branch}..HEAD`, { 
            cwd: projectPath, 
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore']
          });
          ahead = parseInt(behindOutput.trim()) || 0;
        } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}
  
  const isDirty = modified.length > 0 || staged.length > 0 || untracked.length > 0;
  
  res.json({
    branch: branch || 'main',
    ahead,
    behind,
    modified,
    staged,
    untracked,
    is_dirty: isDirty,
    remote_url: remoteUrl
  });
});

app.post('/api/run-command', (req, res) => {
  const { command, args, cwd } = req.body;
  
  const child = spawn(command, args, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let stdout = '';
  let stderr = '';
  
  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  
  child.on('close', (code) => {
    res.json({ stdout, stderr, exit_code: code });
  });
  
  child.on('error', (err) => {
    res.status(500).json({ stdout: '', stderr: err.message, exit_code: -1 });
  });
});

const runningProcesses = {};

app.post('/api/spawn-command', (req, res) => {
  const { command, args, cwd } = req.body;
  
  const child = spawn(command, args, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let output = '';
  let url = null;
  
  const checkForUrl = (data) => {
    const text = data.toString();
    output += text;
    if (!url) {
      const urlMatch = text.match(/(https?:\/\/[^\s]+|localhost:[0-9]+|127\.0\.0\.1:[0-9]+)/);
      if (urlMatch) {
        url = urlMatch[1].startsWith('http') ? urlMatch[1] : 'http://' + urlMatch[1];
        runningProcesses[child.pid] = { url, command: command + ' ' + args.join(' ') };
      }
    }
  };
  
  child.stdout.on('data', checkForUrl);
  child.stderr.on('data', checkForUrl);
  
  child.on('close', () => {
    delete runningProcesses[child.pid];
  });
  
  res.json({ pid: child.pid });
});

app.get('/api/process-url/:pid', (req, res) => {
  const { pid } = req.params;
  const info = runningProcesses[pid];
  if (info && info.url) {
    res.json({ url: info.url });
  } else {
    res.json({ url: null });
  }
});

app.post('/api/kill-process', (req, res) => {
  const { pid } = req.body;
  
  try {
    process.kill(pid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/open-vscode', (req, res) => {
  const { projectPath } = req.body;
  exec(`code "${projectPath}"`, (error) => {
    if (error) {
      res.status(500).json({ error: error.message });
    } else {
      res.json({ success: true });
    }
  });
});

app.post('/api/open-explorer', (req, res) => {
  const { projectPath } = req.body;
  exec(`explorer "${projectPath}"`, (error) => {
    if (error) {
      res.status(500).json({ error: error.message });
    } else {
      res.json({ success: true });
    }
  });
});

app.post('/api/create-project', (req, res) => {
  const { name, projectType, libraryPath, initGit } = req.body;
  const projectPath = path.join(libraryPath, name);
  
  try {
    fs.mkdirSync(projectPath, { recursive: true });
    
    if (projectType === 'node') {
      const pkg = {
        name: name.toLowerCase().replace(/\s+/g, '-'),
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        devDependencies: { vite: '^5.0.0' }
      };
      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2));
      fs.writeFileSync(path.join(projectPath, 'index.html'), 
        `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="/src/main.js"></script>\n</body>\n</html>`);
      fs.mkdirSync(path.join(projectPath, 'src'));
      fs.writeFileSync(path.join(projectPath, 'src/main.js'), `console.log('Hello from ${name}!');\n`);
      fs.writeFileSync(path.join(projectPath, 'vite.config.js'), "import { defineConfig } from 'vite';\nexport default defineConfig({});\n");
    } else if (projectType === 'python') {
      fs.writeFileSync(path.join(projectPath, 'requirements.txt'), '# Add your dependencies here\n');
      fs.writeFileSync(path.join(projectPath, 'main.py'), 
        `def main():\n    print('Hello from ${name}!')\n\nif __name__ == '__main__':\n    main()\n`);
      fs.writeFileSync(path.join(projectPath, 'README.md'), `# ${name}\n\nA Python project.\n`);
    } else if (projectType === 'html') {
      fs.writeFileSync(path.join(projectPath, 'index.html'),
        `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: system-ui, sans-serif; padding: 2rem; }\n  </style>\n</head>\n<body>\n  <h1>Hello from ${name}!</h1>\n</body>\n</html>`);
      fs.writeFileSync(path.join(projectPath, 'style.css'), '/* Add your styles here */\n');
      fs.writeFileSync(path.join(projectPath, 'script.js'), `console.log('Hello from ${name}!');\n`);
    } else {
      fs.writeFileSync(path.join(projectPath, 'README.md'), `# ${name}\n\nA new project.\n`);
    }
    
    if (initGit) {
      const gitDir = path.join(projectPath, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'config'), '[core]\n\trepositoryformatversion = 0\n');
    }
    
    const projectTypeResult = detectProjectType(projectPath);
    const scripts = getScripts(projectPath);
    
    res.json({
      name,
      path: projectPath,
      project_type: projectTypeResult,
      has_git: initGit,
      remote_url: null,
      branch: initGit ? 'main' : null,
      has_changes: false,
      scripts,
      description: `A new ${projectTypeResult} project`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
