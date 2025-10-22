// Trifle Editor - Main JavaScript
// Handles file tree, Ace editor, Pyodide integration, and auto-save

import { TrifleDB } from './db.js';

// Constants
const SYNC_CHECK_INTERVAL_MS = 10000;  // Check for offline sync every 10 seconds
const SAVE_DEBOUNCE_MS = 1000;         // Debounce auto-save by 1 second
const RETRY_SYNC_DELAY_MS = 500;       // Delay before retrying sync operations
const POPOUT_CHECK_INTERVAL_MS = 500;  // Check if popout window closed

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
    popoutWindowChecker: null, // Interval for checking if popout is closed
    canvasUsed: false,         // Track if canvas has been used for output
    consoleUsed: false,        // Track if console has been used for output
};

// Extract trifle ID from query string (?id=trifle_xyz)
function getTrifleId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}

// Canvas management
function updateOutputLayout() {
    const outputContent = document.getElementById('outputContent');
    const canvasPane = document.getElementById('canvasPane');
    const popoutBtn = document.getElementById('popoutCanvasBtn');

    // Remove all layout classes
    outputContent.classList.remove('console-only', 'canvas-only', 'split');

    if (state.canvasUsed && state.consoleUsed) {
        // Both used: show split view
        outputContent.classList.add('split');
        canvasPane.style.display = 'flex';
        popoutBtn.style.display = 'inline-block';
    } else if (state.canvasUsed) {
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
    state.canvasUsed = true;
    updateOutputLayout();
}

function markConsoleUsed() {
    if (!state.consoleUsed) {
        state.consoleUsed = true;
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
    state.canvasUsed = false;
    state.consoleUsed = false;
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

                    // Prevent division by zero
                    if (canvas.height === 0 || containerHeight === 0 || containerWidth === 0) {
                        return; // Skip update if dimensions are invalid
                    }

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

    // Clear any existing window checker to prevent memory leak
    if (state.popoutWindowChecker) {
        clearInterval(state.popoutWindowChecker);
    }

    // Listen for window close
    state.popoutWindowChecker = setInterval(() => {
        if (popoutWindow.closed) {
            state.popoutCanvas = null;
            state.popoutWindow = null;
            clearInterval(state.popoutWindowChecker);
            state.popoutWindowChecker = null;
        }
    }, POPOUT_CHECK_INTERVAL_MS);
}

// Initialize everything
async function init() {
    // Check for WebAssembly support
    if (typeof WebAssembly === 'undefined') {
        const message = 'WebAssembly is not available in this browser.\n\n' +
            'Trifle requires WebAssembly to run Python code. This may be disabled due to:\n' +
            '- Browser security policies (common in enterprise environments)\n' +
            '- Browser compatibility (use a modern browser)\n' +
            '- JIT compilation being disabled\n\n' +
            'Please try:\n' +
            '1. Using a different browser (Chrome, Firefox, Safari, or Edge)\n' +
            '2. Checking your browser security settings\n' +
            '3. Contacting your IT department if in a managed environment';
        alert(message);
        window.location.href = '/';
        return;
    }

    state.trifleId = getTrifleId();

    if (!state.trifleId) {
        alert('Invalid trifle ID');
        window.location.href = '/';
        return;
    }

    // Load and display current user
    const currentUser = await TrifleDB.getCurrentUser();
    if (currentUser) {
        const userData = await TrifleDB.getUserData(currentUser.id);
        const displayNameEl = document.getElementById('userDisplayName');
        if (displayNameEl && userData) {
            displayNameEl.textContent = userData.display_name;
        }
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

// Load trifle and files from IndexedDB
async function loadTrifle() {
    try {
        // Get trifle pointer
        const trifle = await TrifleDB.getTrifle(state.trifleId);
        if (!trifle) {
            throw new Error('Trifle not found');
        }

        // Get trifle data blob
        const trifleData = await TrifleDB.getTrifleData(state.trifleId);
        if (!trifleData) {
            throw new Error('Trifle data not found');
        }

        // Load file contents for each file
        const files = [];
        for (const file of trifleData.files) {
            const content = await TrifleDB.getContent(file.hash);
            files.push({
                path: file.path,
                hash: file.hash,
                content: content || ''
            });
        }

        state.trifle = { ...trifle, ...trifleData };
        state.files = files;

        // Update UI
        document.getElementById('trifleTitle').textContent = trifleData.name;
        document.getElementById('pageTitle').textContent = `${trifleData.name} - Trifling`;

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
                <div style="font-size: 18px; margin-bottom: 12px;">⚠️ Cannot load trifle</div>
                <div style="font-size: 14px; color: #95a5a6;">
                    Trifle not found or database error.<br>
                    Check the console for details.
                </div>
                <button onclick="location.href='/'" style="
                    margin-top: 20px;
                    padding: 10px 20px;
                    background: #3498db;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">← Back to Home</button>
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
        // Store file content
        const hash = await TrifleDB.storeContent(content, 'file');

        // Get current trifle data
        const trifleData = await TrifleDB.getTrifleData(state.trifleId);

        // Add file to trifle
        trifleData.files.push({ path, hash });

        // Update trifle
        await TrifleDB.updateTrifle(state.trifleId, trifleData);

        // Add to local state
        const newFile = { path, hash, content };
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
        // Get current trifle data
        const trifleData = await TrifleDB.getTrifleData(state.trifleId);

        // Remove file from trifle
        trifleData.files = trifleData.files.filter(f => f.path !== file.path);

        // Update trifle
        await TrifleDB.updateTrifle(state.trifleId, trifleData);

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

// Save current file to IndexedDB
async function saveCurrentFile() {
    if (!state.currentFile || !state.isDirty) {
        return;
    }

    const content = state.editor.getValue();
    state.currentFile.content = content;

    updateSavingIndicator('saving');

    try {
        // Store new file content
        const newHash = await TrifleDB.storeContent(content, 'file');

        // Get current trifle data
        const trifleData = await TrifleDB.getTrifleData(state.trifleId);

        // Update file hash in trifle
        const fileIndex = trifleData.files.findIndex(f => f.path === state.currentFile.path);
        if (fileIndex >= 0) {
            trifleData.files[fileIndex].hash = newHash;
        }

        // Update trifle
        await TrifleDB.updateTrifle(state.trifleId, trifleData);

        // Update local state
        state.currentFile.hash = newHash;
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
        updateSavingIndicator('error');
        alert('Failed to save file');
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
    }, SAVE_DEBOUNCE_MS);
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
async function handleWorkerMessage(e) {
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
            await syncFilesFromWorker(data.files);
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
    // result will be null if input was cancelled (user clicked Stop)

    // Send response back to worker (if it still exists)
    // Note: Worker may have been terminated while waiting for input
    if (state.worker) {
        state.worker.postMessage({
            type: 'input-response',
            value: result  // null signals cancellation, raises KeyboardInterrupt in Python
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
        try {
            await saveCurrentFile();
        } catch (error) {
            // saveCurrentFile normally doesn't throw, but handle just in case
            console.error('Error saving file before run:', error);
            // Continue anyway - user wants to run the code
        }
    }

    // Update button to Stop
    const runBtn = document.getElementById('runBtn');
    state.isRunning = true;
    runBtn.textContent = 'Stop';
    runBtn.classList.add('stop');

    // Reset output states
    state.canvasUsed = false;
    state.consoleUsed = false;

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

// Sync files from worker back to IndexedDB
async function syncFilesFromWorker(workerFiles) {
    try {
        // Build a map of current trifle files
        const currentFiles = new Map(state.files.map(f => [f.path, f.content]));

        // Get current trifle data
        const trifleData = await TrifleDB.getTrifleData(state.trifleId);
        let hasChanges = false;

        // Process each file from worker
        for (const pyFile of workerFiles) {
            const currentContent = currentFiles.get(pyFile.path);

            // Only sync if file is new or content changed
            if (currentContent === undefined || currentContent !== pyFile.content) {
                // Store file content
                const hash = await TrifleDB.storeContent(pyFile.content, 'file');

                // Update or add file in trifle data
                const fileIndex = trifleData.files.findIndex(f => f.path === pyFile.path);
                if (fileIndex >= 0) {
                    // Update existing file
                    trifleData.files[fileIndex].hash = hash;
                } else {
                    // Add new file
                    trifleData.files.push({ path: pyFile.path, hash });
                }

                // Update local state
                const localIndex = state.files.findIndex(f => f.path === pyFile.path);
                if (localIndex >= 0) {
                    state.files[localIndex].content = pyFile.content;
                    state.files[localIndex].hash = hash;
                } else {
                    state.files.push({
                        path: pyFile.path,
                        content: pyFile.content,
                        hash
                    });
                }

                hasChanges = true;
            }
        }

        // Save trifle if there were changes
        if (hasChanges) {
            await TrifleDB.updateTrifle(state.trifleId, trifleData);
            // Re-render file tree to show new/updated files
            renderFileTree();
        }
    } catch (error) {
        console.error('Error syncing files from Pyodide:', error);
        state.terminal.write('⚠️  Failed to save Python-created files', 'error');
    }
}

// Start periodic check for syncing unsynced files (Phase 2 - not needed for local-only)
function startSyncCheck() {
    // Stub: Phase 1 doesn't need server sync
}

// Stop periodic sync check (Phase 2 - not needed for local-only)
function stopSyncCheck() {
    // Stub: Phase 1 doesn't need server sync  
}

// Retry syncing files that previously failed (Phase 2 - not needed for local-only)
async function retrySyncUnsyncedFiles() {
    // Stub: Phase 1 doesn't need server sync
}

// Stop Python code execution
function stopExecution() {
    if (!state.isRunning) return;

    // Terminate the worker (forcefully stop Python execution)
    // Note: This may interrupt file syncing if Python is in the middle of
    // writing files, but that's acceptable since the user explicitly stopped execution.
    // Any files already written to the worker's filesystem will be lost.
    if (state.worker) {
        state.worker.terminate();
        state.worker = null;
        state.workerReady = false;
    }

    // Cancel any pending input
    state.terminal.cancelInput();

    // Clear any pending sync operations
    // (syncInProgress flag will be reset when worker restarts)

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

        // If title changed, save to IndexedDB
        if (newTitle && newTitle !== currentTitle) {
            try {
                // Get current trifle data
                const trifleData = await TrifleDB.getTrifleData(state.trifleId);

                // Update name
                trifleData.name = newTitle;

                // Save to IndexedDB
                await TrifleDB.updateTrifle(state.trifleId, trifleData);

                // Update state and page title
                state.trifle.name = newTitle;
                document.getElementById('pageTitle').textContent = `${newTitle} - Trifling`;
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

    });
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
