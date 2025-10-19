// Trifle Editor - Main JavaScript
// Handles file tree, Ace editor, Pyodide integration, and auto-save

// Global state
const state = {
    trifleId: null,
    trifle: null,
    files: [],
    currentFile: null,
    editor: null,
    pyodide: null,
    terminal: null,
    saveTimeout: null,
    isDirty: false,
    isRunning: false,
    abortController: null,
};

// Extract trifle ID from URL
function getTrifleId() {
    const path = window.location.pathname;
    const match = path.match(/\/editor\/([^/]+)/);
    return match ? match[1] : null;
}

// Initialize everything
async function init() {
    state.trifleId = getTrifleId();

    if (!state.trifleId) {
        alert('Invalid trifle ID');
        window.location.href = '/';
        return;
    }

    // Initialize Terminal
    const terminalElement = document.getElementById('terminal');
    state.terminal = new Terminal(terminalElement);

    // Set up Ctrl-C handler
    state.terminal.setInterruptHandler(() => {
        if (state.isRunning) {
            stopExecution();
        }
    });

    // Initialize Ace Editor
    initEditor();

    // Load trifle data
    await loadTrifle();

    // Initialize Pyodide in background
    initPyodide();

    // Set up event listeners
    setupEventListeners();
}

// Initialize Ace Editor
function initEditor() {
    state.editor = ace.edit('editor');
    state.editor.setTheme('ace/theme/monokai');
    state.editor.session.setMode('ace/mode/python');
    state.editor.setOptions({
        fontSize: '14px',
        showPrintMargin: false,
        enableBasicAutocompletion: false,
        enableLiveAutocompletion: false,
    });

    // Listen for changes
    state.editor.session.on('change', () => {
        state.isDirty = true;
        debouncedSave();
    });

    // Add keyboard shortcut: Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to run
    state.editor.commands.addCommand({
        name: 'runCode',
        bindKey: {win: 'Ctrl-Enter', mac: 'Command-Enter'},
        exec: function(editor) {
            runCode();
        }
    });
}

// Load trifle and files from API
async function loadTrifle() {
    try {
        const response = await fetch(`/api/trifles/${state.trifleId}`);
        if (!response.ok) {
            throw new Error('Failed to load trifle');
        }

        const data = await response.json();
        state.trifle = data;
        state.files = data.files || [];

        // Update UI
        document.getElementById('trifleTitle').textContent = data.title;
        document.getElementById('pageTitle').textContent = `${data.title} - Trifle`;

        // Render file tree
        renderFileTree();

        // Open first file or create main.py
        if (state.files.length > 0) {
            // Try to open main.py, or first file
            const mainFile = state.files.find(f => f.path === 'main.py');
            openFile(mainFile || state.files[0]);
        } else {
            // Create default main.py
            await createFile('main.py', 'print("Hello, Trifle!")');
            await loadTrifle(); // Reload to get the new file
        }
    } catch (error) {
        console.error('Error loading trifle:', error);
        alert('Failed to load trifle');
        window.location.href = '/';
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

// Render file tree
function renderFileTree() {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';

    // Sort files alphabetically
    const sortedFiles = [...state.files].sort((a, b) => a.path.localeCompare(b.path));

    sortedFiles.forEach(file => {
        const li = document.createElement('li');
        li.className = 'file-item';
        if (state.currentFile && state.currentFile.path === file.path) {
            li.classList.add('active');
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = file.path;
        nameSpan.title = file.path;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-file-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteFile(file);
        };

        li.appendChild(nameSpan);
        li.appendChild(deleteBtn);
        li.onclick = () => openFile(file);

        fileList.appendChild(li);
    });
}

// Open a file in the editor
function openFile(file) {
    // Save current file first if dirty
    if (state.isDirty && state.currentFile) {
        saveCurrentFile();
    }

    state.currentFile = file;
    state.editor.setValue(file.content || '', -1); // -1 moves cursor to start
    state.isDirty = false;
    renderFileTree(); // Update active state
}

// Create a new file
async function createFile(path, content = '') {
    try {
        const response = await fetch(`/api/trifles/${state.trifleId}/files`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path, content }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create file');
        }

        const newFile = await response.json();
        state.files.push(newFile);
        renderFileTree();
        openFile(newFile);
    } catch (error) {
        console.error('Error creating file:', error);
        alert(`Failed to create file: ${error.message}`);
    }
}

// Delete a file
async function deleteFile(file) {
    if (!confirm(`Delete ${file.path}?`)) {
        return;
    }

    try {
        const response = await fetch(
            `/api/trifles/${state.trifleId}/files?path=${encodeURIComponent(file.path)}`,
            { method: 'DELETE' }
        );

        if (!response.ok) {
            throw new Error('Failed to delete file');
        }

        // Remove from state
        state.files = state.files.filter(f => f.path !== file.path);

        // If we deleted the current file, open another one
        if (state.currentFile && state.currentFile.path === file.path) {
            state.currentFile = null;
            if (state.files.length > 0) {
                openFile(state.files[0]);
            } else {
                state.editor.setValue('', -1);
            }
        }

        renderFileTree();
    } catch (error) {
        console.error('Error deleting file:', error);
        alert('Failed to delete file');
    }
}

// Save current file
async function saveCurrentFile() {
    if (!state.currentFile || !state.isDirty) {
        return;
    }

    const content = state.editor.getValue();
    state.currentFile.content = content;

    updateSavingIndicator('saving');

    try {
        // Use batch update endpoint
        const response = await fetch(`/api/trifles/${state.trifleId}/files`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                files: [{
                    path: state.currentFile.path,
                    content: content,
                }],
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to save file');
        }

        state.isDirty = false;
        updateSavingIndicator('saved');

        // Clear "saved" indicator after 2 seconds
        setTimeout(() => {
            if (!state.isDirty) {
                updateSavingIndicator('');
            }
        }, 2000);
    } catch (error) {
        console.error('Error saving file:', error);
        // Show offline indicator instead of popup
        updateSavingIndicator('offline');
        // Keep showing offline for longer
        setTimeout(() => {
            if (state.isDirty) {
                updateSavingIndicator('');
            }
        }, 5000);
    }
}

// Debounced save (auto-save after 1 second of inactivity)
function debouncedSave() {
    if (state.saveTimeout) {
        clearTimeout(state.saveTimeout);
    }

    // Don't show "Saving..." until we actually start saving
    // Just clear any previous "Saved" indicator
    updateSavingIndicator('');

    state.saveTimeout = setTimeout(() => {
        saveCurrentFile();
    }, 1000);
}

// Update saving indicator
function updateSavingIndicator(status) {
    const indicator = document.getElementById('savingIndicator');
    indicator.className = 'saving-indicator';

    if (status === 'saving') {
        indicator.textContent = 'Saving...';
        indicator.classList.add('saving');
    } else if (status === 'saved') {
        indicator.textContent = 'Saved';
        indicator.classList.add('saved');
    } else if (status === 'offline') {
        indicator.textContent = 'Offline';
        indicator.style.color = '#e74c3c';  // Red color for offline
    } else {
        indicator.textContent = '';
        indicator.style.color = '';  // Reset color
    }
}

// Initialize Pyodide
async function initPyodide() {
    const loadingMessage = document.getElementById('loadingMessage');
    loadingMessage.textContent = 'Loading Python runtime...';

    try {
        // Load Pyodide from CDN
        state.pyodide = await loadPyodide({
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
        });

        console.log('Pyodide loaded successfully');
        document.getElementById('runBtn').disabled = false;
        loadingMessage.textContent = 'Python ready!';

        // Hide loading overlay after a brief delay
        setTimeout(() => {
            document.getElementById('loadingOverlay').style.display = 'none';
        }, 500);
    } catch (error) {
        console.error('Failed to load Pyodide:', error);
        loadingMessage.textContent = 'Failed to load Python runtime';
        alert('Failed to load Python runtime. Please refresh the page.');
    }
}

// Terminal input function (called from Python)
window.terminalInput = async function(prompt) {
    // Flush any pending output first
    if (state.pyodide) {
        const output = state.pyodide.runPython('_console.get_output()');
        const [stdout, stderr] = output.toJs();
        if (stdout) state.terminal.write(stdout, 'output');
        if (stderr) state.terminal.write(stderr, 'error');
        // Clear the buffers (truncate and seek to start)
        state.pyodide.runPython('_console.stdout.truncate(0); _console.stdout.seek(0); _console.stderr.truncate(0); _console.stderr.seek(0)');
    }

    // Request input from terminal
    const result = await state.terminal.requestInput(prompt);

    // Check if execution was aborted
    if (result === null) {
        throw new Error('Execution stopped by user');
    }

    return result;
};

// Run Python code
async function runCode() {
    if (!state.pyodide) {
        alert('Python runtime not loaded yet');
        return;
    }

    if (state.isRunning) {
        // Stop button was clicked
        stopExecution();
        return;
    }

    // Make sure current file is saved
    if (state.isDirty) {
        await saveCurrentFile();
    }

    // Update button to Stop
    const runBtn = document.getElementById('runBtn');
    state.isRunning = true;
    runBtn.textContent = 'Stop';
    runBtn.classList.add('stop');

    state.terminal.clear();
    state.terminal.write('>>> Running main.py...', 'info');

    try {
        // Write all files to Pyodide's virtual filesystem
        for (const file of state.files) {
            const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
            if (dir) {
                // Create directory if needed
                try {
                    state.pyodide.FS.mkdirTree(dir);
                } catch (e) {
                    // Directory might already exist
                }
            }
            state.pyodide.FS.writeFile(file.path, file.content);
        }

        // Redirect stdout and stderr, and patch input()
        state.pyodide.runPython(`
import sys
from io import StringIO
from js import terminalInput
import asyncio

class ConsoleCapture:
    def __init__(self):
        self.stdout = StringIO()
        self.stderr = StringIO()

    def get_output(self):
        return self.stdout.getvalue(), self.stderr.getvalue()

_console = ConsoleCapture()
sys.stdout = _console.stdout
sys.stderr = _console.stderr

# Patch input() to use terminal
async def _terminal_input(prompt=''):
    sys.stdout.flush()  # Flush any pending output first
    result = await terminalInput(str(prompt))
    if result is None:
        raise KeyboardInterrupt('Execution stopped')
    return result

# Override built-in input
__builtins__.input = _terminal_input
`);

        // Run main.py
        await state.pyodide.runPythonAsync(`
import ast
import asyncio
import traceback
import inspect

# Read and parse main.py
with open('main.py', 'r') as f:
    source = f.read()

# Transform input() calls to await input()
class InputTransformer(ast.NodeTransformer):
    def visit_Call(self, node):
        self.generic_visit(node)
        # Check if this is a call to input()
        if (isinstance(node.func, ast.Name) and node.func.id == 'input'):
            # Wrap in Await
            return ast.Await(value=node)
        return node

# Parse, transform, and compile
tree = ast.parse(source, 'main.py', 'exec')
tree = InputTransformer().visit(tree)
ast.fix_missing_locations(tree)

# Compile with top-level await support
code = compile(tree, 'main.py', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

# Execute with proper exception handling
try:
    # Execute the code - it might or might not be a coroutine
    result = eval(code)
    # If it's a coroutine, await it
    if inspect.iscoroutine(result):
        await result
except Exception as e:
    # Print the exception to stderr just like python would
    traceback.print_exc()
`);

        // Get any remaining output (including errors)
        const output = state.pyodide.runPython('_console.get_output()');
        const [stdout, stderr] = output.toJs();

        if (stdout) {
            state.terminal.write(stdout, 'output');
        }

        if (stderr) {
            state.terminal.write(stderr, 'error');
        }

        state.terminal.write('>>> Execution completed', 'info');

        // Sync any new/modified files from Pyodide filesystem to database
        await syncFilesFromPyodide();
    } catch (error) {
        console.error('Error running code:', error);
        state.terminal.write(`Error: ${error.message}`, 'error');
    } finally {
        // Reset button state
        state.isRunning = false;
        runBtn.textContent = 'Run';
        runBtn.classList.remove('stop');
    }
}

// Sync files from Pyodide virtual filesystem to database
async function syncFilesFromPyodide() {
    try {
        // Get list of all files in Pyodide filesystem
        const filesData = state.pyodide.runPython(`
import os
import json

def list_files(directory='.', prefix=''):
    """Recursively list all files"""
    files = []
    try:
        for item in os.listdir(directory):
            path = os.path.join(directory, item)
            relative_path = os.path.join(prefix, item) if prefix else item

            # Skip special directories and Python cache
            if item.startswith('.') or item == '__pycache__':
                continue

            if os.path.isfile(path):
                try:
                    with open(path, 'r') as f:
                        content = f.read()
                    files.append({'path': relative_path, 'content': content})
                except:
                    # Skip binary files or files we can't read
                    pass
            elif os.path.isdir(path):
                files.extend(list_files(path, relative_path))
    except:
        pass
    return files

json.dumps(list_files())
`);

        const pyodideFiles = JSON.parse(filesData);

        // Build a map of current trifle files
        const currentFiles = new Map(state.files.map(f => [f.path, f.content]));

        // Track files to create or update
        const filesToSync = [];

        for (const pyFile of pyodideFiles) {
            const currentContent = currentFiles.get(pyFile.path);

            // Only sync if file is new or content changed
            if (currentContent === undefined || currentContent !== pyFile.content) {
                filesToSync.push(pyFile);
            }
        }

        // Sync files to database
        if (filesToSync.length > 0) {
            // Separate new files from updates
            const newFiles = [];
            const updatedFiles = [];

            for (const file of filesToSync) {
                if (currentFiles.has(file.path)) {
                    updatedFiles.push(file);
                } else {
                    newFiles.push(file);
                }
            }

            // Create new files
            for (const file of newFiles) {
                try {
                    const response = await fetch(`/api/trifles/${state.trifleId}/files`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ path: file.path, content: file.content }),
                    });

                    if (!response.ok) {
                        console.error(`Failed to create file: ${file.path}`);
                    }
                } catch (error) {
                    console.error(`Error creating file ${file.path}:`, error);
                }
            }

            // Batch update existing files
            if (updatedFiles.length > 0) {
                try {
                    const response = await fetch(`/api/trifles/${state.trifleId}/files`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            files: updatedFiles,
                        }),
                    });

                    if (!response.ok) {
                        console.error('Failed to batch update files');
                    }
                } catch (error) {
                    console.error('Error updating files:', error);
                }
            }

            // Reload trifle to get updated file list
            await loadTrifle();
        }
    } catch (error) {
        console.error('Error syncing files from Pyodide:', error);
        // Don't show error to user - this is a background operation
    }
}

// Stop Python code execution
function stopExecution() {
    const runBtn = document.getElementById('runBtn');

    // Cancel any pending input
    state.terminal.cancelInput();

    // Reset button state
    state.isRunning = false;
    runBtn.textContent = 'Run';
    runBtn.classList.remove('stop');

    state.terminal.write('>>> Execution stopped by user', 'info');
}

// Edit trifle title
function editTrifleTitle() {
    const titleElement = document.getElementById('trifleTitle');
    const currentTitle = titleElement.textContent;

    // Create input field
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'trifle-title-input';
    input.value = currentTitle;

    // Replace title with input
    titleElement.replaceWith(input);
    input.focus();
    input.select();

    // Save on Enter or blur
    const saveTitle = async () => {
        const newTitle = input.value.trim();

        // Restore h1 element
        const h1 = document.createElement('h1');
        h1.className = 'trifle-title';
        h1.id = 'trifleTitle';
        h1.textContent = newTitle || currentTitle; // Fall back to current if empty
        input.replaceWith(h1);

        // Re-attach click listener
        h1.addEventListener('click', editTrifleTitle);

        // If title changed, save to API
        if (newTitle && newTitle !== currentTitle) {
            try {
                const response = await fetch(`/api/trifles/${state.trifleId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title: newTitle,
                        description: state.trifle.description || '',
                    }),
                });

                if (!response.ok) {
                    throw new Error('Failed to update title');
                }

                // Update state and page title
                state.trifle.title = newTitle;
                document.getElementById('pageTitle').textContent = `${newTitle} - Trifle`;
            } catch (error) {
                console.error('Error updating title:', error);
                alert('Failed to update title');
                // Restore old title on error
                h1.textContent = currentTitle;
            }
        }
    };

    input.addEventListener('blur', saveTitle);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveTitle();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            // Cancel editing - restore original title
            const h1 = document.createElement('h1');
            h1.className = 'trifle-title';
            h1.id = 'trifleTitle';
            h1.textContent = currentTitle;
            input.replaceWith(h1);
            h1.addEventListener('click', editTrifleTitle);
        }
    });
}

// Resize terminal
function setupResizeHandle() {
    const resizeHandle = document.getElementById('resizeHandle');
    const consoleContainer = document.getElementById('consoleContainer');
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = consoleContainer.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Calculate new height (drag up = bigger, drag down = smaller)
        const deltaY = startY - e.clientY;
        const newHeight = startHeight + deltaY;

        // Enforce min/max constraints
        const minHeight = 100;
        const maxHeight = window.innerHeight - 200;
        const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

        consoleContainer.style.height = `${clampedHeight}px`;

        // Trigger Ace editor resize
        if (state.editor) {
            state.editor.resize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Event listeners
function setupEventListeners() {
    // Run button
    document.getElementById('runBtn').addEventListener('click', runCode);

    // Clear console button
    document.getElementById('clearConsoleBtn').addEventListener('click', () => {
        state.terminal.clear();
    });

    // Editable title
    document.getElementById('trifleTitle').addEventListener('click', editTrifleTitle);

    // Resizable terminal
    setupResizeHandle();

    // New file button
    const addFileBtn = document.getElementById('addFileBtn');
    const newFileModal = document.getElementById('newFileModal');
    const newFileForm = document.getElementById('newFileForm');
    const fileNameInput = document.getElementById('fileName');
    const cancelFileBtn = document.getElementById('cancelFileBtn');

    addFileBtn.addEventListener('click', () => {
        newFileModal.classList.add('active');
        fileNameInput.focus();
    });

    cancelFileBtn.addEventListener('click', () => {
        newFileModal.classList.remove('active');
        newFileForm.reset();
    });

    newFileModal.addEventListener('click', (e) => {
        if (e.target === newFileModal) {
            newFileModal.classList.remove('active');
            newFileForm.reset();
        }
    });

    newFileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const path = fileNameInput.value.trim();

        if (!path) {
            return;
        }

        // Validate path
        if (path.includes('..') || path.startsWith('/')) {
            alert('Invalid file path');
            return;
        }

        // Check if file already exists
        if (state.files.find(f => f.path === path)) {
            alert('File already exists');
            return;
        }

        await createFile(path);
        newFileModal.classList.remove('active');
        newFileForm.reset();
    });

    // Save before leaving
    window.addEventListener('beforeunload', (e) => {
        if (state.isDirty) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }
    });
}

// Load Pyodide from CDN
async function loadPyodide(config) {
    // Load Pyodide loader script
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
        script.onload = async () => {
            try {
                const pyodide = await window.loadPyodide(config);
                resolve(pyodide);
            } catch (error) {
                reject(error);
            }
        };
        script.onerror = () => reject(new Error('Failed to load Pyodide script'));
        document.head.appendChild(script);
    });
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
