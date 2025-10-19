// Terminal.js - Lightweight terminal for Python output and input()
// Handles stdout/stderr display, ANSI colors, and terminal-style input

class Terminal {
    constructor(containerElement) {
        this.container = containerElement;
        this.outputBuffer = [];
        this.inputResolver = null;
        this.isWaitingForInput = false;

        // Persistent ANSI state across lines
        this.currentStyles = [];

        this.render();
    }

    render() {
        this.container.innerHTML = `
            <div class="terminal-output" id="terminalLines"></div>
            <div class="terminal-input-line" id="terminalInputLine" style="display: none;">
                <span class="terminal-prompt" id="terminalPrompt"></span>
                <input type="text" class="terminal-input" id="terminalInput" autocomplete="off" spellcheck="false">
            </div>
        `;

        this.linesContainer = this.container.querySelector('#terminalLines');
        this.inputLine = this.container.querySelector('#terminalInputLine');
        this.promptSpan = this.container.querySelector('#terminalPrompt');
        this.inputField = this.container.querySelector('#terminalInput');

        // Handle Enter key for input
        this.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.submitInput();
            }
        });

        // Auto-focus on container click (but not if user is selecting text)
        this.container.addEventListener('click', () => {
            if (this.isWaitingForInput) {
                // Only focus if there's no text selection
                const selection = window.getSelection();
                if (!selection || selection.toString().length === 0) {
                    this.inputField.focus();
                }
            }
        });

        // Handle Ctrl-C to interrupt execution (on input field)
        this.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'c' && e.ctrlKey) {
                e.preventDefault();
                // Trigger stop execution if a callback is set
                if (this.onInterrupt) {
                    this.onInterrupt();
                }
            }
        });

        // Also handle Ctrl-C on the container (when not typing in input)
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'c' && e.ctrlKey) {
                e.preventDefault();
                // Trigger stop execution if a callback is set
                if (this.onInterrupt) {
                    this.onInterrupt();
                }
            }
        });

        // Make container focusable so it can receive keyboard events
        this.container.setAttribute('tabindex', '-1');
    }

    // Set callback for Ctrl-C interrupt
    setInterruptHandler(callback) {
        this.onInterrupt = callback;
    }

    // Write output to terminal
    write(text, type = 'output') {
        if (!text) return;

        if (type === 'output') {
            // Process as continuous stream with ANSI codes
            this.writeWithAnsi(text);
        } else {
            // For errors and info, process line by line without ANSI
            const lines = text.split('\n');
            lines.forEach((line, index) => {
                // Don't add empty line at the end if text ended with \n
                if (index === lines.length - 1 && line === '') return;

                const lineDiv = document.createElement('div');
                lineDiv.className = 'terminal-line';

                if (type === 'error') {
                    lineDiv.classList.add('terminal-error');
                } else if (type === 'info') {
                    lineDiv.classList.add('terminal-info');
                }

                lineDiv.textContent = line;
                this.linesContainer.appendChild(lineDiv);
            });
        }

        this.scrollToBottom();
    }

    // Write text with ANSI code processing as a continuous stream
    writeWithAnsi(text) {
        let currentLine = '';

        // If we have active styles, start with them
        if (this.currentStyles.length > 0) {
            currentLine = `<span style="${this.currentStyles.join('; ')}">`;
        }

        let inSpan = this.currentStyles.length > 0;

        const styleMap = {
            // Text attributes
            '1': 'font-weight: bold',
            '2': 'opacity: 0.5',              // dim
            '3': 'font-style: italic',
            '4': 'text-decoration: underline',
            '9': 'text-decoration: line-through',  // strikethrough

            // Foreground colors
            '30': 'color: #000000',
            '31': 'color: #cd3131',
            '32': 'color: #0dbc79',
            '33': 'color: #e5e510',
            '34': 'color: #2472c8',
            '35': 'color: #bc3fbc',
            '36': 'color: #11a8cd',
            '37': 'color: #e5e5e5',

            // Background colors
            '40': 'background-color: #000000',
            '41': 'background-color: #cd3131',
            '42': 'background-color: #0dbc79',
            '43': 'background-color: #e5e510',
            '44': 'background-color: #2472c8',
            '45': 'background-color: #bc3fbc',
            '46': 'background-color: #11a8cd',
            '47': 'background-color: #e5e5e5',
            '49': 'background-color: transparent',
        };

        const STATE_NORMAL = 0;
        const STATE_ESCAPE = 1;
        const STATE_CSI = 2;

        let state = STATE_NORMAL;
        let escapeBuffer = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const charCode = text.charCodeAt(i);

            if (state === STATE_NORMAL) {
                if (charCode === 0x1B) {
                    // ESC character
                    state = STATE_ESCAPE;
                    escapeBuffer = '';
                } else if (char === '\n') {
                    // Newline - close any open span, emit line, start new line
                    if (inSpan) {
                        currentLine += '</span>';
                    }

                    const lineDiv = document.createElement('div');
                    lineDiv.className = 'terminal-line';
                    lineDiv.innerHTML = currentLine || '';
                    this.linesContainer.appendChild(lineDiv);

                    // Start new line with current styles
                    currentLine = '';
                    if (this.currentStyles.length > 0) {
                        currentLine = `<span style="${this.currentStyles.join('; ')}">`;
                        inSpan = true;
                    } else {
                        inSpan = false;
                    }
                } else {
                    // Regular character
                    currentLine += this.escapeHtml(char);
                }
            } else if (state === STATE_ESCAPE) {
                if (char === '[') {
                    state = STATE_CSI;
                    escapeBuffer = '';
                } else {
                    // Invalid, treat as normal text
                    currentLine += this.escapeHtml('\x1B' + char);
                    state = STATE_NORMAL;
                }
            } else if (state === STATE_CSI) {
                if (char >= '0' && char <= '9' || char === ';') {
                    escapeBuffer += char;
                } else if (char === 'm') {
                    // SGR - close current span if open, apply new styles
                    if (inSpan) {
                        currentLine += '</span>';
                        inSpan = false;
                    }

                    // Process codes
                    const codes = escapeBuffer ? escapeBuffer.split(';') : ['0'];
                    codes.forEach(code => {
                        if (code === '' || code === '0') {
                            this.currentStyles = [];
                        } else if (styleMap[code]) {
                            // Remove conflicting styles
                            if (code.startsWith('4') && code !== '4') {
                                // Background color
                                this.currentStyles = this.currentStyles.filter(s => !s.startsWith('background-color'));
                            } else if (code.startsWith('3') && code !== '3') {
                                // Foreground color
                                this.currentStyles = this.currentStyles.filter(s => !s.startsWith('color'));
                            } else if (code === '1' || code === '2') {
                                // Bold/dim - remove font-weight and opacity
                                this.currentStyles = this.currentStyles.filter(s => !s.startsWith('font-weight') && !s.startsWith('opacity'));
                            } else if (code === '3') {
                                // Italic
                                this.currentStyles = this.currentStyles.filter(s => !s.startsWith('font-style'));
                            } else if (code === '4' || code === '9') {
                                // Underline/strikethrough
                                this.currentStyles = this.currentStyles.filter(s => !s.startsWith('text-decoration'));
                            }
                            this.currentStyles.push(styleMap[code]);
                        }
                    });

                    // Open new span if we have styles
                    if (this.currentStyles.length > 0) {
                        currentLine += `<span style="${this.currentStyles.join('; ')}">`;
                        inSpan = true;
                    }

                    state = STATE_NORMAL;
                } else {
                    // Unknown sequence, ignore
                    state = STATE_NORMAL;
                }
            }
        }

        // Flush remaining content
        if (currentLine.length > 0 || inSpan) {
            if (inSpan) {
                currentLine += '</span>';
            }
            const lineDiv = document.createElement('div');
            lineDiv.className = 'terminal-line';
            lineDiv.innerHTML = currentLine;
            this.linesContainer.appendChild(lineDiv);
        }
    }

    // Request input from user (returns a Promise)
    async requestInput(prompt = '') {
        return new Promise((resolve) => {
            this.isWaitingForInput = true;
            this.inputResolver = resolve;

            // Show the prompt
            this.promptSpan.textContent = prompt;
            this.inputLine.style.display = 'flex';
            this.inputField.value = '';
            this.inputField.focus();

            this.scrollToBottom();
        });
    }

    // Submit the input
    submitInput() {
        if (!this.isWaitingForInput || !this.inputResolver) return;

        const value = this.inputField.value;

        // Echo the input to the terminal (with prompt)
        const echoLine = document.createElement('div');
        echoLine.className = 'terminal-line';
        echoLine.innerHTML = `${this.escapeHtml(this.promptSpan.textContent)}<span class="terminal-input-echo">${this.escapeHtml(value)}</span>`;
        this.linesContainer.appendChild(echoLine);

        // Hide input line
        this.inputLine.style.display = 'none';
        this.isWaitingForInput = false;

        // Resolve the promise
        const resolver = this.inputResolver;
        this.inputResolver = null;
        resolver(value);

        this.scrollToBottom();
    }

    // Clear the terminal output (but keep input active if waiting)
    clear() {
        // Just clear the output, don't cancel pending input
        this.linesContainer.innerHTML = '';

        // Reset ANSI color state
        this.currentStyles = [];

        // Input line stays visible if we're waiting for input
        // (it's managed separately via requestInput/submitInput)
    }

    // Cancel any pending input (for Stop button)
    cancelInput() {
        if (this.isWaitingForInput && this.inputResolver) {
            this.inputLine.style.display = 'none';
            this.isWaitingForInput = false;
            this.inputResolver(null);  // Resolve with null to signal cancellation
            this.inputResolver = null;
        }
    }

    // Auto-scroll to bottom
    scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }


    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use in editor.js
window.Terminal = Terminal;
