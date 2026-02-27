# Coding Command Center - Specification

## 1. Project Overview

**Project Name:** Coding Command Center
**Type:** Desktop Application (Tauri)
**Core Feature:** A unified dashboard to manage, execute, and monitor development projects from multiple programming languages
**Target Users:** Developers with multiple projects in various languages who want a centralized management tool

## 2. UI/UX Specification

### 2.1 Layout Structure

**Window Model:**
- Single main window with responsive layout
- Modal dialogs for: New Project, Settings, Git operations
- Window controls: minimize, maximize, close (standard native)

**Main Layout Areas:**
```
┌─────────────────────────────────────────────────────────────┐
│  Header: App Title + Library Selector + Settings Button    │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│   Sidebar    │              Main Content                   │
│  (Project    │    (Project Details, Actions, Output)       │
│    List)     │                                              │
│              │                                              │
│              ├──────────────────────────────────────────────┤
│              │              Output Panel                   │
│              │         (Terminal/Command Output)           │
└──────────────┴──────────────────────────────────────────────┘
```

- **Header (60px):** App logo, library path selector, settings gear
- **Sidebar (280px):** Scrollable list of detected projects
- **Main Content:** Project info, action buttons, git controls
- **Output Panel (200px, collapsible):** Terminal-like output for commands

### 2.2 Visual Design

**Color Palette:**
- Background Primary: `#0f0f0f` (near black)
- Background Secondary: `#1a1a1a` (dark gray)
- Background Tertiary: `#252525` (card backgrounds)
- Accent Primary: `#3b82f6` (blue)
- Accent Success: `#22c55e` (green)
- Accent Warning: `#f59e0b` (amber)
- Accent Danger: `#ef4444` (red)
- Text Primary: `#f5f5f5` (white-ish)
- Text Secondary: `#a3a3a3` (gray)
- Border: `#333333`

**Typography:**
- Font Family: System UI (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
- Headings: 24px (h1), 20px (h2), 16px (h3)
- Body: 14px
- Small/Labels: 12px
- Monospace (output): `'Fira Code', 'Consolas', monospace`

**Spacing:**
- Base unit: 4px
- Padding small: 8px
- Padding medium: 16px
- Padding large: 24px
- Gap between elements: 12px
- Border radius: 8px (cards), 4px (buttons)

**Visual Effects:**
- Subtle box shadows on cards: `0 2px 8px rgba(0,0,0,0.3)`
- Hover states: slight background lightening (+10% brightness)
- Active states: accent color highlight
- Smooth transitions: 150ms ease

### 2.3 Components

**Sidebar Project Item:**
- Project icon (based on type)
- Project name
- Project type badge (Node, Python, Go, etc.)
- Git status indicator (dot: green=synced, yellow=changes, red=error)
- States: default, hover, selected

**Action Buttons:**
- Primary: Blue background, white text
- Secondary: Transparent, border, white text
- Danger: Red background for destructive actions
- Icon buttons: 32x32px with tooltip

**Output Panel:**
- Dark terminal appearance
- ANSI color support
- Auto-scroll to bottom
- Clear button
- Copy button
- Timestamp per command

**Project Detail Card:**
- Project path
- Description (from package.json / README)
- Git remote URL
- Last modified date
- Action buttons grid

**Modal Dialogs:**
- Semi-transparent backdrop
- Centered card
- Close button (X)
- Action buttons at bottom

## 3. Functional Specification

### 3.1 Core Features

**Library Management:**
- Add library folder path (e.g., "Z:/Dev/Opencode")
- Persist library paths in local storage
- Remove library from list
- Scan libraries for projects on startup and refresh

**Project Detection:**
- Scan each library folder for subdirectories
- Detect project type by file signatures:
  - Node.js: `package.json`
  - Python: `requirements.txt`, `pyproject.toml`, `setup.py`
  - Go: `go.mod`
  - Rust: `Cargo.toml`
  - HTML/CSS/JS: `index.html` (at root)
  - Generic: any folder with `.git` directory
- Store detected projects with metadata

**Project Actions:**
- **Open in VSCode:** Launch `code` command with project path
- **Open in Explorer:** Open file explorer at project path
- **Run Command:** Execute project-specific commands based on type:
  - Node.js: Read from `package.json` scripts
  - Python: Detect virtual environment or use global python
  - Show all available scripts as buttons

**Git Operations:**
- Display current branch
- Show git status (modified, staged, untracked files)
- Pull from remote
- Push to remote
- Commit changes (with message input)
- Create and push to new GitHub repository

**Command Execution:**
- Execute shell commands in project directory
- Stream stdout/stderr to output panel in real-time
- Show exit code on completion
- Allow canceling running commands
- Command history

**New Project Creation:**
- Modal form with:
  - Project name
  - Project type (Node.js Vite, Python, HTML/CSS/JS)
  - GitHub repo name (optional)
  - Initialize git (checkbox, default: true)
  - Create GitHub repo and push (checkbox, default: true if token configured)
- Create folder in currently selected library
- Initialize with appropriate template/files
- Run `git init` and optionally create GitHub repo via API

**Settings:**
- GitHub Personal Access Token (stored securely)
- Default library paths
- Editor preference (VSCode, other)
- Theme (dark only for now)

### 3.2 User Interactions and Flows

**Startup Flow:**
1. App launches
2. Load saved library paths from storage
3. Scan libraries for projects
4. Display project list in sidebar
5. Select first project by default

**Select Project Flow:**
1. User clicks project in sidebar
2. Main content updates with project details
3. Git status refreshes
4. Available commands load

**Run Command Flow:**
1. User clicks command button (e.g., "dev")
2. Output panel expands
3. Command executes in background
4. Output streams to panel
5. Exit code displayed on completion

**Create New Project Flow:**
1. User clicks "New Project" button
2. Modal opens with form
3. User fills in details
4. Click "Create"
5. Project folder created
6. Files initialized
7. Git initialized
8. GitHub repo created (if selected)
9. Project list refreshes
10. New project selected

### 3.3 Data Flow & Processing

**Frontend (React + TypeScript):**
- State management: React hooks + Context
- UI Components: Custom components
- API calls: Tauri invoke commands

**Backend (Rust + Tauri):**
- File system operations (scan directories, read files)
- Git operations (status, pull, push, commit, create repo)
- Shell command execution (spawn processes)
- GitHub API calls (create repos)
- Secure token storage (system keychain or encrypted file)

**Key Modules:**

```
src-tauri/
├── src/
│   ├── main.rs           # Entry point, Tauri setup
│   ├── commands/
│   │   ├── mod.rs        # Command exports
│   │   ├── fs.rs         # File system commands
│   │   ├── git.rs        # Git operations
│   │   ├── github.rs     # GitHub API
│   │   └── shell.rs      # Command execution
│   └── lib.rs            # Library root

src/
├── App.tsx               # Main app component
├── components/
│   ├── Layout/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   └── OutputPanel.tsx
│   ├── Project/
│   │   ├── ProjectList.tsx
│   │   ├── ProjectItem.tsx
│   │   └── ProjectDetail.tsx
│   ├── Actions/
│   │   ├── CommandButton.tsx
│   │   └── GitControls.tsx
│   ├── Modals/
│   │   ├── NewProject.tsx
│   │   └── Settings.tsx
│   └── UI/
│       ├── Button.tsx
│       ├── Modal.tsx
│       └── Badge.tsx
├── hooks/
│   ├── useProjects.ts
│   ├── useCommands.ts
│   └── useGit.ts
├── services/
│   └── api.ts            # Tauri invoke wrappers
├── types/
│   └── index.ts          # TypeScript interfaces
└── utils/
    └── detectProject.ts  # Project type detection
```

### 3.4 Edge Cases

- **Empty library:** Show message "No projects found"
- **Invalid library path:** Show error, allow removal
- **Git not installed:** Show warning, disable git features
- **Command fails:** Display error in output panel with red text
- **GitHub token invalid:** Show error in settings, don't save
- **Network error:** Show offline indicator, cache last state
- **Long running commands:** Show spinner, allow cancel
- **Special characters in project names:** Escape properly
- **Nested project directories:** Only detect top-level in library
- **No git remote:** Disable push/pull, show "No remote configured"

## 4. Acceptance Criteria

### 4.1 Success Conditions

1. **Library Scanning:**
   - [ ] Can add a library path
   - [ ] Projects are detected within 3 seconds
   - [ ] Project types are correctly identified

2. **Project Display:**
   - [ ] All detected projects show in sidebar
   - [ ] Clicking a project shows its details
   - [ ] Project type badge displays correctly

3. **VSCode Integration:**
   - [ ] "Open in VSCode" button launches VSCode with project

4. **Command Execution:**
   - [ ] All package.json scripts appear as buttons
   - [ ] Clicking runs the command
   - [ ] Output displays in real-time
   - [ ] Exit code is shown

5. **Git Operations:**
   - [ ] Git status shows current branch and changes
   - [ ] Pull fetches and merges from remote
   - [ ] Push sends commits to remote

6. **New Project:**
   - [ ] Can create Node.js project
   - [ ] Can create Python project
   - [ ] Can create HTML/CSS/JS project
   - [ ] Git is initialized
   - [ ] GitHub repo is created (with token)

7. **Settings:**
   - [ ] Can save GitHub token
   - [ ] Token is used for GitHub API calls
   - [ ] Token is stored securely

### 4.2 Visual Checkpoints

1. Dark theme with blue accents is consistent
2. Sidebar scrolls independently
3. Output panel has terminal appearance
4. Buttons have proper hover/active states
5. Modals are centered with backdrop
6. Loading states are visible
7. Error states are clearly indicated (red)
8. Success states are indicated (green)
