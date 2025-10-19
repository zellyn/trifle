// Trifle Editor - Main JavaScript
// Handles file tree, Ace editor, Pyodide integration, and auto-save

// Global state
const state = {
    trifleId: null,
    trifle: null,
    files: [],
    currentFile: null,
    editor: null,
    worker: null,
    workerReady: false,
    terminal: null,
    saveTimeout: null,
    isDirty: false,
    isRunning: false,
    canvas: null,
    canvasCtx: null,
    popoutCanvas: null,
    popoutWindow: null,
    unsyncedFiles: new Set(),  // Track files that haven't been saved to server
    syncCheckInterval: null,   // Interval for checking if we can sync
    isOffline: false,          // Track offline status
};

// Extract trifle ID from URL
function getTrifleId() {
    const path = window.location.pathname;
    const match = path.match(/\/editor\/([^/]+)/);
    return match ? match[1] : null;
}

// Canvas management
let canvasUsed = false;
let consoleUsed = false;

function updateOutputLayout() {
    const outputContent = document.getElementById('outputContent');
    const canvasPane = document.getElementById('canvasPane');
    const popoutBtn = document.getElementById('popoutCanvasBtn');

    // Remove all layout classes
    outputContent.classList.remove('console-only', 'canvas-only', 'split');

    if (canvasUsed && consoleUsed) {
        // Both used: show split view
        outputContent.classList.add('split');
        canvasPane.style.display = 'flex';
        popoutBtn.style.display = 'inline-block';
    } else if (canvasUsed) {
        // Only canvas: show canvas only
        outputContent.classList.add('canvas-only');
        canvasPane.style.display = 'flex';
        popoutBtn.style.display = 'inline-block';
    } else {
        // Only console (or neither): show console only
        outputContent.classList.add('console-only');
        canvasPane.style.display = 'none';
        popoutBtn.style.display = 'none';
    }
}

function markCanvasUsed() {
    canvasUsed = true;
    updateOutputLayout();
}

function markConsoleUsed() {
    if (!consoleUsed) {
        consoleUsed = true;
        updateOutputLayout();
    }
}

function clearOutput() {
    // Clear terminal
    state.terminal.clear();

    // Clear canvas
    const canvas = document.getElementById('outputCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Reset usage flags
    canvasUsed = false;
    consoleUsed = false;
    updateOutputLayout();
}

function popoutCanvas() {
    const canvas = document.getElementById('outputCanvas');

    // Size window to match canvas dimensions (plus padding for chrome/borders)
    const windowWidth = canvas.width + 60;
    const windowHeight = canvas.height + 100;
    const popoutWindow = window.open('', 'Canvas', `width=${windowWidth},height=${windowHeight}`);

    if (!popoutWindow) {
        alert('Please allow pop-ups for this site to use the canvas pop-out feature');
        return;
    }

    popoutWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Canvas - ${state.trifle.title}</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    background: #2c3e50;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100vw;
                    height: 100vh;
                    padding: 20px;
                }
                #canvasContainer {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                }
                canvas {
                    background: white;
                    border: 2px solid #34495e;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    /* Scale canvas to fit container while maintaining aspect ratio */
                    max-width: 100%;
                    max-height: 100%;
                    object-fit: contain;
                    image-rendering: auto;
                }
            </style>
        </head>
        <body>
            <div id="canvasContainer">
                <canvas id="popoutCanvas" width="${canvas.width}" height="${canvas.height}"></canvas>
            </div>
            <script>
                // Update canvas display size when window resizes (global for parent access)
                window.updateCanvasSize = function() {
                    const canvas = document.getElementById('popoutCanvas');
                    const container = document.getElementById('canvasContainer');

                    // Get container dimensions
                    const containerWidth = container.clientWidth;
                    const containerHeight = container.clientHeight;

                    // Get canvas aspect ratio
                    const canvasAspect = canvas.width / canvas.height;
                    const containerAspect = containerWidth / containerHeight;

                    // Calculate display size maintaining aspect ratio
                    let displayWidth, displayHeight;
                    if (containerAspect > canvasAspect) {
                        // Container is wider - fit to height
                        displayHeight = containerHeight;
                        displayWidth = displayHeight * canvasAspect;
                    } else {
                        // Container is taller - fit to width
                        displayWidth = containerWidth;
                        displayHeight = displayWidth / canvasAspect;
                    }

                    // Set CSS size for scaling
                    canvas.style.width = displayWidth + 'px';
                    canvas.style.height = displayHeight + 'px';
                };

                // Update on resize
                window.addEventListener('resize', updateCanvasSize);

                // Initial size
                setTimeout(updateCanvasSize, 100);
            </script>
        </body>
        </html>
    `);

    popoutWindow.document.close();

    // Copy current canvas content
    const popoutCanvas = popoutWindow.document.getElementById('popoutCanvas');
    const popoutCtx = popoutCanvas.getContext('2d');
    popoutCtx.drawImage(canvas, 0, 0);

    // Store reference for updating
    state.popoutCanvas = popoutCanvas;
    state.popoutWindow = popoutWindow;

    // Listen for window close
    const checkClosed = setInterval(() => {
        if (popoutWindow.closed) {
            state.popoutCanvas = null;
            state.popoutWindow = null;
            clearInterval(checkClosed);
        }
    }, 500);
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
    state.terminal = new Terminal(terminalElement, markConsoleUsed);

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

    // Initialize Worker in background
    initWorker();

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

        // Show better error message
        const loadingMessage = document.getElementById('loadingMessage');
        loadingMessage.innerHTML = `
            <div style="color: #e74c3c; text-align: center;">
                <div style="font-size: 18px; margin-bottom: 12px;">⚠️ Cannot connect to server</div>
                <div style="font-size: 14px; color: #95a5a6;">
                    Make sure the Trifle server is running.<br>
                    Check the console for details.
                </div>
                <button onclick="location.reload()" style="
                    margin-top: 20px;
                    padding: 10px 20px;
                    background: #3498db;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Retry</button>
            </div>
        `;
        // Keep loading overlay visible with error message
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

        // Show indicator if file is unsynced
        if (state.unsyncedFiles.has(file.path)) {
            nameSpan.textContent += ' ⚠';
            nameSpan.title = file.path + ' (not saved to server - offline)';
            nameSpan.style.color = '#f39c12';
        } else {
            nameSpan.title = file.path;
        }

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
    // Stop any running code
    if (state.isRunning) {
        stopExecution();
    }

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

        // We're back online!
        if (state.isOffline) {
            state.isOffline = false;
        }

        // Remove from unsynced files if it was there
        if (state.unsyncedFiles.has(state.currentFile.path)) {
            state.unsyncedFiles.delete(state.currentFile.path);
            // Update file tree to remove warning icon
            renderFileTree();
        }

        updateSavingIndicator('saved');

        // Clear "saved" indicator after 2 seconds
        setTimeout(() => {
            if (!state.isDirty && !state.isOffline) {
                updateSavingIndicator('');
            }
        }, 2000);

        // Server is online - try to sync any unsynced files
        if (state.unsyncedFiles.size > 0) {
            setTimeout(() => retrySyncUnsyncedFiles(), 500);
        }
    } catch (error) {
        // Offline is an expected state, don't spam console with errors
        // Show offline indicator instead of popup
        if (!state.isOffline) {
            state.isOffline = true;
            updateSavingIndicator('offline');
        }

        // Mark file as unsynced
        state.unsyncedFiles.add(state.currentFile.path);

        // Update file tree to show warning icon
        renderFileTree();

        // Start periodic sync check
        startSyncCheck();

        // Offline indicator stays until we're back online
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

// Helper to execute canvas operation on both main and popout canvases
function execOnBothCanvases(operation) {
    // Main canvas
    operation(state.canvasCtx);

    // Popout canvas (if exists and window is still open)
    if (state.popoutCanvas && state.popoutWindow && !state.popoutWindow.closed) {
        const popoutCtx = state.popoutCanvas.getContext('2d');
        operation(popoutCtx);
    }
}

// Handle messages from worker
function handleWorkerMessage(e) {
    const { type, ...data } = e.data;

    switch (type) {
        case 'ready':
            state.workerReady = true;
            document.getElementById('runBtn').disabled = false;
            document.getElementById('loadingMessage').textContent = 'Python ready!';
            setTimeout(() => {
                document.getElementById('loadingOverlay').style.display = 'none';
            }, 500);
            break;

        case 'stdout':
            state.terminal.write(data.text, 'output');
            markConsoleUsed();
            break;

        case 'stderr':
            state.terminal.write(data.text, 'error');
            markConsoleUsed();
            break;

        case 'input-request':
            handleInputRequest(data.prompt);
            break;

        case 'canvas-set-size':
            state.canvas.width = data.width;
            state.canvas.height = data.height;
            if (state.popoutCanvas && state.popoutWindow && !state.popoutWindow.closed) {
                state.popoutCanvas.width = data.width;
                state.popoutCanvas.height = data.height;
                // Trigger resize calculation in pop-out window
                if (state.popoutWindow.updateCanvasSize) {
                    state.popoutWindow.updateCanvasSize();
                }
            }
            markCanvasUsed();
            break;

        case 'canvas-clear':
            execOnBothCanvases(ctx => ctx.clearRect(0, 0, state.canvas.width, state.canvas.height));
            markCanvasUsed();
            break;

        case 'canvas-set-fill-color':
            execOnBothCanvases(ctx => ctx.fillStyle = data.color);
            break;

        case 'canvas-set-stroke-color':
            execOnBothCanvases(ctx => ctx.strokeStyle = data.color);
            break;

        case 'canvas-set-line-width':
            execOnBothCanvases(ctx => ctx.lineWidth = data.width);
            break;

        case 'canvas-fill-rect':
            execOnBothCanvases(ctx => ctx.fillRect(data.x, data.y, data.width, data.height));
            markCanvasUsed();
            break;

        case 'canvas-stroke-rect':
            execOnBothCanvases(ctx => ctx.strokeRect(data.x, data.y, data.width, data.height));
            markCanvasUsed();
            break;

        case 'canvas-fill-circle':
            execOnBothCanvases(ctx => {
                ctx.beginPath();
                ctx.arc(data.x, data.y, data.radius, 0, 2 * Math.PI);
                ctx.fill();
            });
            markCanvasUsed();
            break;

        case 'canvas-stroke-circle':
            execOnBothCanvases(ctx => {
                ctx.beginPath();
                ctx.arc(data.x, data.y, data.radius, 0, 2 * Math.PI);
                ctx.stroke();
            });
            markCanvasUsed();
            break;

        case 'canvas-draw-line':
            execOnBothCanvases(ctx => {
                ctx.beginPath();
                ctx.moveTo(data.x1, data.y1);
                ctx.lineTo(data.x2, data.y2);
                ctx.stroke();
            });
            markCanvasUsed();
            break;

        case 'canvas-draw-text':
            execOnBothCanvases(ctx => ctx.fillText(data.text, data.x, data.y));
            markCanvasUsed();
            break;

        case 'canvas-set-font':
            execOnBothCanvases(ctx => ctx.font = data.font);
            break;

        case 'files-loaded':
            // Worker has loaded files into its filesystem
            break;

        case 'files-changed':
            // Sync files from worker back to database
            syncFilesFromWorker(data.files);
            break;

        case 'complete':
            state.terminal.write('>>> Execution completed', 'info');
            finishExecution();
            break;

        case 'error':
            state.terminal.write(`Error: ${data.message}`, 'error');
            markConsoleUsed();
            finishExecution();
            break;

        default:
            console.warn('Unknown worker message type:', type);
    }
}

// Handle input request from worker
async function handleInputRequest(prompt) {
    const result = await state.terminal.requestInput(prompt);

    // Send response back to worker
    if (state.worker) {
        state.worker.postMessage({
            type: 'input-response',
            value: result
        });
    }
}

// Finish execution (reset UI state)
function finishExecution() {
    const runBtn = document.getElementById('runBtn');
    state.isRunning = false;
    runBtn.textContent = 'Run';
    runBtn.classList.remove('stop');
}

// Initialize Worker
async function initWorker() {
    const loadingMessage = document.getElementById('loadingMessage');
    loadingMessage.textContent = 'Loading Python runtime...';

    try {
        // Ensure any existing worker is cleaned up
        if (state.worker) {
            state.worker.terminate();
            state.worker = null;
            state.workerReady = false;
        }

        // Create new worker
        state.worker = new Worker('/js/worker.js');

        // Setup canvas reference
        state.canvas = document.getElementById('outputCanvas');
        state.canvasCtx = state.canvas.getContext('2d');
        state.canvas.width = 600;
        state.canvas.height = 400;

        // Setup worker message handler
        state.worker.onmessage = handleWorkerMessage;

        state.worker.onerror = (error) => {
            console.error('Worker error:', error);
            loadingMessage.textContent = 'Python runtime error';
        };

        // Send init message to worker
        state.worker.postMessage({
            type: 'init',
            pyodideVersion: 'v0.28.3'
        });

        // Wait for 'ready' message (handled in handleWorkerMessage)
        // The loading overlay will be hidden when we receive 'ready'

    } catch (error) {
        console.error('Failed to create worker:', error);
        loadingMessage.textContent = 'Failed to load Python runtime';
        alert('Failed to load Python runtime. Please refresh the page.');
    }
}

// Run Python code (using worker)
async function runCode() {
    if (!state.workerReady) {
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

    // Reset output states
    canvasUsed = false;
    consoleUsed = false;

    state.terminal.clear();
    state.terminal.write('>>> Running main.py...', 'info');

    // Clear canvas
    state.canvasCtx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    updateOutputLayout();

    // Send files to worker
    state.worker.postMessage({
        type: 'load-files',
        files: state.files.map(f => ({ path: f.path, content: f.content }))
    });

    // Send run command
    state.worker.postMessage({
        type: 'run',
        mainFile: 'main.py'
    });
}

// Sync files from worker back to database
async function syncFilesFromWorker(workerFiles) {
    try {
        // Build a map of current trifle files
        const currentFiles = new Map(state.files.map(f => [f.path, f.content]));

        // Track files to create or update
        const filesToSync = [];

        for (const pyFile of workerFiles) {
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

            let anySucceeded = false;
            const syncedPaths = [];

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
                        // Server error - this is unexpected, log it
                        console.warn(`Failed to create file ${file.path}: ${response.status}`);
                        state.unsyncedFiles.add(file.path);
                    } else {
                        anySucceeded = true;
                        syncedPaths.push(file.path);
                        state.unsyncedFiles.delete(file.path);
                    }
                } catch (error) {
                    // Network failure (offline) - expected, don't log
                    state.unsyncedFiles.add(file.path);
                    if (!state.isOffline) {
                        state.isOffline = true;
                        updateSavingIndicator('offline');
                    }
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
                        // Server error - this is unexpected, log it
                        console.warn(`Failed to batch update files: ${response.status}`);
                        updatedFiles.forEach(f => state.unsyncedFiles.add(f.path));
                    } else {
                        anySucceeded = true;
                        updatedFiles.forEach(f => {
                            syncedPaths.push(f.path);
                            state.unsyncedFiles.delete(f.path);
                        });
                    }
                } catch (error) {
                    // Network failure (offline) - expected, don't log
                    updatedFiles.forEach(f => state.unsyncedFiles.add(f.path));
                    if (!state.isOffline) {
                        state.isOffline = true;
                        updateSavingIndicator('offline');
                    }
                }
            }

            // Update local state and UI with new/changed files (even if server sync failed)
            for (const file of filesToSync) {
                const existingIndex = state.files.findIndex(f => f.path === file.path);
                if (existingIndex >= 0) {
                    // Update existing file
                    state.files[existingIndex].content = file.content;
                } else {
                    // Add new file
                    state.files.push({
                        id: null,  // Will get real ID when server is back
                        path: file.path,
                        content: file.content
                    });
                }
            }

            // Re-render file tree to show new files
            renderFileTree();

            // Try to reload from server if we successfully synced
            if (anySucceeded) {
                // We're back online!
                if (state.isOffline) {
                    state.isOffline = false;
                    if (state.unsyncedFiles.size === 0) {
                        updateSavingIndicator('');  // Clear offline indicator
                    }
                }

                try {
                    await loadTrifle();
                } catch (error) {
                    // loadTrifle failed (probably offline), but that's okay - we have local state updated
                    // Don't log - this is expected when offline
                }
            } else if (filesToSync.length > 0) {
                // We updated local state but couldn't persist to server
                const unsyncedCount = state.unsyncedFiles.size;
                console.warn(`${unsyncedCount} file(s) not saved to server - will retry when online`);
                state.terminal.write(`⚠️  ${unsyncedCount} file(s) saved locally but not to server (offline)`, 'info');

                // Start periodic sync check if not already running
                startSyncCheck();
            }

            // If we successfully synced at least one file, try to sync any other unsynced files
            if (anySucceeded && state.unsyncedFiles.size > 0) {
                console.log('Server is back online - retrying unsynced files...');
                setTimeout(() => retrySyncUnsyncedFiles(), 1000);
            }
        }
    } catch (error) {
        console.error('Error syncing files from Pyodide:', error);
        // Don't show error to user - this is a background operation
    }
}

// Start periodic check for syncing unsynced files
function startSyncCheck() {
    // Don't start multiple intervals
    if (state.syncCheckInterval) return;

    console.log('Starting periodic sync check (every 10 seconds)...');
    state.syncCheckInterval = setInterval(async () => {
        if (state.unsyncedFiles.size > 0) {
            console.log('Checking if server is back online...');
            await retrySyncUnsyncedFiles();
        } else {
            // All synced, stop checking
            stopSyncCheck();
        }
    }, 10000);  // Check every 10 seconds
}

// Stop periodic sync check
function stopSyncCheck() {
    if (state.syncCheckInterval) {
        console.log('Stopping periodic sync check (all files synced)');
        clearInterval(state.syncCheckInterval);
        state.syncCheckInterval = null;
    }
}

// Retry syncing files that previously failed
async function retrySyncUnsyncedFiles() {
    if (state.unsyncedFiles.size === 0) {
        stopSyncCheck();
        return;
    }

    const unsyncedPaths = Array.from(state.unsyncedFiles);
    console.log(`Retrying sync for ${unsyncedPaths.length} unsynced file(s)...`);

    const filesToRetry = state.files.filter(f => unsyncedPaths.includes(f.path));

    if (filesToRetry.length === 0) return;

    let anySucceeded = false;

    // Try to create/update each unsynced file
    for (const file of filesToRetry) {
        try {
            let response;

            if (file.id) {
                // File has an ID, try updating it
                response = await fetch(`/api/trifles/${state.trifleId}/files`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        files: [{ path: file.path, content: file.content }]
                    }),
                });
            } else {
                // No ID, create as new file
                response = await fetch(`/api/trifles/${state.trifleId}/files`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: file.path, content: file.content }),
                });
            }

            if (response.ok) {
                state.unsyncedFiles.delete(file.path);
                anySucceeded = true;
                console.log(`✓ Successfully synced: ${file.path}`);
            } else {
                // Server responded but failed - log as warning
                console.warn(`Failed to sync ${file.path}: ${response.status}`);
            }
        } catch (error) {
            // Network failure (still offline) - don't log, just stop retrying
            break;
        }
    }

    if (anySucceeded) {
        // We're back online!
        if (state.isOffline) {
            state.isOffline = false;
            if (state.unsyncedFiles.size === 0) {
                updateSavingIndicator('');  // Clear offline indicator
            }
        }

        // Remember current file before reload
        const currentFilePath = state.currentFile ? state.currentFile.path : null;

        // Reload to get updated file list with IDs
        try {
            await loadTrifle();

            // Restore the current file if it exists
            if (currentFilePath) {
                const fileToReopen = state.files.find(f => f.path === currentFilePath);
                if (fileToReopen && fileToReopen !== state.currentFile) {
                    openFile(fileToReopen);
                }
            }
        } catch (error) {
            console.error('Could not reload after retry:', error);
        }

        // Update file tree to remove warnings
        renderFileTree();

        if (state.unsyncedFiles.size === 0) {
            state.terminal.write('✓ All files synced to server', 'info');
            stopSyncCheck();
        }
    }
}

// Stop Python code execution
function stopExecution() {
    if (!state.isRunning) return;

    // Terminate the worker (forcefully stop Python execution)
    if (state.worker) {
        state.worker.terminate();
        state.worker = null;
        state.workerReady = false;
    }

    // Cancel any pending input
    state.terminal.cancelInput();

    // Reset UI
    finishExecution();

    state.terminal.write('\n>>> Execution stopped by user', 'info');

    // Restart worker for next run
    initWorker();
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
    const outputContainer = document.getElementById('outputContainer');
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = outputContainer.offsetHeight;
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

        outputContainer.style.height = `${clampedHeight}px`;

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

// Resize file tree
function setupVerticalResizeHandle() {
    const verticalResizeHandle = document.getElementById('verticalResizeHandle');
    const fileTree = document.getElementById('fileTree');
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    verticalResizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = fileTree.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Calculate new width (drag right = bigger, drag left = smaller)
        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;

        // Enforce min/max constraints (from CSS)
        const minWidth = 150;
        const maxWidth = 500;
        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        fileTree.style.width = `${clampedWidth}px`;

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

    // Clear output button
    document.getElementById('clearOutputBtn').addEventListener('click', clearOutput);

    // Pop-out canvas button
    document.getElementById('popoutCanvasBtn').addEventListener('click', popoutCanvas);

    // Editable title
    document.getElementById('trifleTitle').addEventListener('click', editTrifleTitle);

    // Resizable terminal
    setupResizeHandle();
    setupVerticalResizeHandle();

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

    // Cleanup before leaving
    window.addEventListener('beforeunload', (e) => {
        // Terminate worker to free resources
        if (state.worker) {
            state.worker.terminate();
        }

        // Stop sync check interval
        stopSyncCheck();

        // Warn about unsaved changes or unsynced files
        if (state.isDirty) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }

        if (state.unsyncedFiles.size > 0) {
            e.preventDefault();
            e.returnValue = `${state.unsyncedFiles.size} file(s) not saved to server. Are you sure you want to leave?`;
            return e.returnValue;
        }
    });
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
