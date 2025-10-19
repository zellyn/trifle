// Trifle Worker - Runs Python code in Web Worker to avoid blocking UI
// Communicates with main thread via JSON message protocol

let pyodide = null;
let isRunning = false;

// Message helpers
function send(type, data = {}) {
    self.postMessage({ type, ...data });
}

// Main message handler
self.onmessage = async (e) => {
    const { type, ...data } = e.data;

    try {
        switch (type) {
            case 'init':
                await handleInit(data);
                break;
            case 'load-files':
                await handleLoadFiles(data);
                break;
            case 'run':
                await handleRun(data);
                break;
            case 'stop':
                handleStop();
                break;
            case 'input-response':
                handleInputResponse(data);
                break;
            default:
                console.error('Unknown message type:', type);
        }
    } catch (error) {
        send('error', { message: error.message, stack: error.stack });
    }
};

// Initialize Pyodide
async function handleInit({ pyodideVersion }) {
    try {
        // Load Pyodide from CDN
        importScripts(`https://cdn.jsdelivr.net/pyodide/${pyodideVersion}/full/pyodide.js`);

        pyodide = await loadPyodide({
            indexURL: `https://cdn.jsdelivr.net/pyodide/${pyodideVersion}/full/`,
        });

        // Setup Python environment
        await setupPythonEnvironment();

        send('ready');
    } catch (error) {
        send('error', { message: `Failed to initialize Pyodide: ${error.message}` });
    }
}

// Input resolver for handling input requests
let inputResolver = null;

// Make input promise available to Python
self._getInputValue = () => {
    return new Promise((resolve) => {
        inputResolver = resolve;
    });
};

// Setup Python environment (stdout/stderr capture, input, canvas API)
async function setupPythonEnvironment() {
    // Make worker message sender available to Python via the js module
    // Python's 'from js import workerSend' will find it here
    self.workerSend = send;

    pyodide.runPython(`
import sys
from io import StringIO

# Console capture that batches output for performance
class WorkerConsole:
    def __init__(self, stream_type):
        self.stream_type = stream_type
        self.buffer = []
        self.batch_size = 1000  # Send after this many characters
        self.current_length = 0

    def write(self, text):
        if text:
            self.buffer.append(text)
            self.current_length += len(text)

            # Flush if buffer is getting large
            if self.current_length >= self.batch_size:
                self.flush()
        return len(text)

    def flush(self):
        if self.buffer:
            from js import workerSend
            combined = ''.join(self.buffer)
            workerSend(self.stream_type, {'text': combined})
            self.buffer = []
            self.current_length = 0

# Redirect stdout and stderr to worker
sys.stdout = WorkerConsole('stdout')
sys.stderr = WorkerConsole('stderr')

# Input handler using message passing
_input_resolver = None
_input_value = None

def _wait_for_input(prompt=''):
    global _input_resolver, _input_value
    from js import workerSend
    import asyncio

    # Send input request to main thread
    workerSend('input-request', {'prompt': str(prompt)})

    # This will be a synchronous call in the worker
    # The main thread will send back 'input-response'
    # We need to handle this differently...
    # Actually, we can't do synchronous waiting in a nice way
    # Let's use the existing async approach but with JSPI if available

    sys.stdout.flush()

# Try to use JSPI if available
try:
    from pyodide.ffi import run_sync, can_run_sync
    _has_jspi = True
except ImportError:
    _has_jspi = False

if _has_jspi:
    # JSPI-based input (works in Chrome/Firefox)
    async def _input_async(prompt=''):
        from js import workerSend, _getInputValue
        import asyncio

        sys.stdout.flush()
        workerSend('input-request', {'prompt': str(prompt)})

        # Wait for response via _getInputValue promise
        result = await _getInputValue()
        if result is None:
            raise KeyboardInterrupt('Execution stopped')
        return result

    def input(prompt=''):
        # Check at runtime if JSPI is actually supported by the browser
        if not can_run_sync():
            raise RuntimeError(
                'input() is not supported in this browser.\\n'
                'This browser does not support JSPI (JavaScript Promise Integration).\\n'
                'Please use Chrome 137+, Firefox 139+, or Edge.\\n'
                'Safari does not yet support this feature.'
            )
        return run_sync(_input_async(prompt))

    __builtins__.input = input
else:
    # Fallback: input not supported without JSPI
    def input(prompt=''):
        raise RuntimeError(
            'input() is not supported in this browser.\\n'
            'Please use Chrome 137+, Firefox 139+, or Edge.'
        )

    __builtins__.input = input

# Canvas API that sends drawing commands to main thread
class Canvas:
    def __init__(self):
        from js import workerSend
        self._send = workerSend
        self._width = 600
        self._height = 400

    def set_size(self, width, height):
        """Set canvas size."""
        self._width = width
        self._height = height
        self._send('canvas-set-size', {'width': width, 'height': height})

    def get_size(self):
        """Get canvas size as (width, height)."""
        return (self._width, self._height)

    def clear(self):
        """Clear the entire canvas."""
        self._send('canvas-clear', {})

    def set_fill_color(self, color):
        """Set fill color (CSS color string)."""
        self._send('canvas-set-fill-color', {'color': color})

    def set_stroke_color(self, color):
        """Set stroke color (CSS color string)."""
        self._send('canvas-set-stroke-color', {'color': color})

    def set_line_width(self, width):
        """Set line width."""
        self._send('canvas-set-line-width', {'width': width})

    def fill_rect(self, x, y, width, height):
        """Draw a filled rectangle."""
        self._send('canvas-fill-rect', {'x': x, 'y': y, 'width': width, 'height': height})

    def stroke_rect(self, x, y, width, height):
        """Draw a rectangle outline."""
        self._send('canvas-stroke-rect', {'x': x, 'y': y, 'width': width, 'height': height})

    def fill_circle(self, x, y, radius):
        """Draw a filled circle."""
        self._send('canvas-fill-circle', {'x': x, 'y': y, 'radius': radius})

    def stroke_circle(self, x, y, radius):
        """Draw a circle outline."""
        self._send('canvas-stroke-circle', {'x': x, 'y': y, 'radius': radius})

    def draw_line(self, x1, y1, x2, y2):
        """Draw a line from (x1, y1) to (x2, y2)."""
        self._send('canvas-draw-line', {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2})

    def draw_text(self, text, x, y):
        """Draw text at position (x, y)."""
        self._send('canvas-draw-text', {'text': text, 'x': x, 'y': y})

    def set_font(self, font):
        """Set font (CSS font string, e.g. '16px Arial')."""
        self._send('canvas-set-font', {'font': font})

# Create global canvas instance
canvas = Canvas()
`);
}

// Load files into Pyodide filesystem
async function handleLoadFiles({ files }) {
    for (const file of files) {
        // Create parent directories if needed
        const parts = file.path.split('/');
        let currentPath = '';

        for (let i = 0; i < parts.length - 1; i++) {
            currentPath += (i > 0 ? '/' : '') + parts[i];
            try {
                pyodide.FS.mkdir(currentPath);
            } catch (e) {
                // Directory already exists, ignore
            }
        }

        // Write file
        pyodide.FS.writeFile(file.path, file.content);
    }

    send('files-loaded');
}

// Run Python code
async function handleRun({ mainFile }) {
    if (isRunning) {
        send('error', { message: 'Code is already running' });
        return;
    }

    isRunning = true;

    try {
        // Execute main.py
        await pyodide.runPythonAsync(`
import traceback
import sys

try:
    with open('${mainFile}', 'r') as f:
        # Execute in global namespace so user code has access to canvas, input, etc.
        code = f.read()
        exec(code, globals())
except Exception as e:
    traceback.print_exc()
finally:
    # Flush any remaining output
    sys.stdout.flush()
    sys.stderr.flush()
`);

        // Get list of all files to sync back to database
        const filesData = pyodide.runPython(`
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

        // Send files back to main thread for syncing
        send('files-changed', { files: JSON.parse(filesData) });

        send('complete');
    } catch (error) {
        send('error', { message: error.message });
    } finally {
        isRunning = false;
    }
}

// Stop execution (not much we can do in worker)
function handleStop() {
    // Workers don't have a way to interrupt Python execution
    // The main thread will terminate() this worker
    isRunning = false;
}

// Handle input response from main thread
function handleInputResponse({ value }) {
    if (inputResolver) {
        inputResolver(value);
        inputResolver = null;
    }
}
