import { Project, GitStatus, CommandOutput, NewProjectOptions, AppSettings } from './types';

const API_BASE = '/api';

const STORAGE_KEY = 'coding-command-center-settings';

export async function scanLibrary(libraryPath: string): Promise<Project[]> {
  const response = await fetch(`${API_BASE}/scan-library?libraryPath=${encodeURIComponent(libraryPath)}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getGitStatus(projectPath: string): Promise<GitStatus> {
  const response = await fetch(`${API_BASE}/git-status?projectPath=${encodeURIComponent(projectPath)}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function gitPull(projectPath: string): Promise<string> {
  const response = await fetch(`${API_BASE}/git-pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function gitPush(projectPath: string, message: string): Promise<string> {
  const response = await fetch(`${API_BASE}/git-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, message })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function createProject(options: NewProjectOptions): Promise<Project> {
  const response = await fetch(`${API_BASE}/create-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function runCommand(
  projectPath: string,
  command: string,
  args: string[] = []
): Promise<CommandOutput> {
  const response = await fetch(`${API_BASE}/run-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args, cwd: projectPath })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function spawnCommand(
  projectPath: string,
  command: string,
  args: string[] = []
): Promise<{ pid: number }> {
  const response = await fetch(`${API_BASE}/spawn-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args, cwd: projectPath })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function killProcess(pid: number): Promise<void> {
  const response = await fetch(`${API_BASE}/kill-process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid })
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function getProcessUrl(pid: number): Promise<string | null> {
  const response = await fetch(`${API_BASE}/process-url/${pid}`);
  if (!response.ok) return null;
  const data = await response.json();
  return data.url;
}

export async function openInVscode(projectPath: string): Promise<void> {
  const response = await fetch(`${API_BASE}/open-vscode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function openInExplorer(projectPath: string): Promise<void> {
  const response = await fetch(`${API_BASE}/open-explorer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath })
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function checkGitInstalled(): Promise<boolean> {
  return true;
}

export async function checkVscodeInstalled(): Promise<boolean> {
  return true;
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { libraries: [], github_token: '' };
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
