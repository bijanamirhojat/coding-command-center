export interface Project {
  name: string;
  path: string;
  project_type: string;
  has_git: boolean;
  remote_url: string | null;
  branch: string | null;
  has_changes: boolean;
  scripts: Script[];
  description: string | null;
}

export interface Script {
  name: string;
  command: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
  is_dirty: boolean;
  remote_url: string | null;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface NewProjectOptions {
  name: string;
  project_type: string;
  library_path: string;
  init_git: boolean;
  create_github_repo: boolean;
  github_repo_name: string | null;
  github_token: string | null;
}

export interface AppSettings {
  libraries: string[];
  github_token: string;
}

export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'html' | 'generic';
