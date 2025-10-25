/**
 * Profile Page - Avatar Editor
 * Drag-and-drop SVG editor for creating felt-style avatars
 */

import { generateName } from './namegen.js';
import { TrifleDB } from './db.js';
import { SyncManager } from './sync-kv.js';
import { showError, showSuccess } from './notifications.js';
import {
    SHAPE_PALETTE,
    COLORS,
    BG_COLORS,
    createShape,
    getNextShapeId,
    generateAvatarFromShapes,
    renderShape
} from './avatar-editor.js';

// Current user (cached after init)
let currentUser = null;

// Avatar editor state
let shapes = [];
let selectedShapeId = null;
let selectedColor = COLORS[0];
let bgColor = '#E8F4F8';
let undoShapes = null; // For undo after clear

// Dragging state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragShapeStartX = 0;
let dragShapeStartY = 0;

// Handle dragging state
let isResizing = false;
let isRotating = false;
let resizeStartSize = {}; // Stores initial size properties
let rotateStartAngle = 0;

// Option-drag duplication state
let isDuplicating = false;
let duplicatedShapeId = null;
let originalShapeState = null;

/**
 * Initialize the profile page
 */
async function init() {
    try {
        // Check for OAuth error in URL (from failed login)
        const urlParams = new URLSearchParams(window.location.search);
        const errorMsg = urlParams.get('error');
        const justLoggedIn = urlParams.get('logged_in');

        if (errorMsg) {
            showError(errorMsg);
            // Clean up URL without reloading
            window.history.replaceState({}, '', '/profile.html');
        }

        // Initialize user
        await initUser();

        // Update sync status
        await updateSyncStatus();

        // Initialize avatar editor
        await initAvatarEditor();

        // Set up event listeners
        setupEventListeners();

        // Auto-sync if just logged in
        if (justLoggedIn === 'true') {
            // Clean up URL first
            window.history.replaceState({}, '', '/profile.html');

            // Trigger sync automatically
            console.log('[Profile] Auto-syncing after login');
            await handleLoginSync();
        }

    } catch (error) {
        console.error('Failed to initialize profile page:', error);
        showError('Failed to load profile. Please refresh the page.');
    }
}

/**
 * Initialize user (create anonymous user if none exists)
 */
async function initUser() {
    currentUser = await TrifleDB.getCurrentUser();

    if (!currentUser) {
        // First-time user - create anonymous user with random name
        const displayName = generateName();
        currentUser = await TrifleDB.createUser(displayName);
        console.log('Created new user:', displayName);
    }

    // Display user info
    const userData = await TrifleDB.getUserData(currentUser.id);
    updateUserDisplay(userData.display_name);
}

/**
 * Update user display
 */
function updateUserDisplay(displayName) {
    const nameElement = document.getElementById('userName');
    if (nameElement) {
        nameElement.textContent = displayName;
    }
}

/**
 * Update sync status display
 */
async function updateSyncStatus() {
    const iconEl = document.getElementById('syncStatusIcon');
    const labelEl = document.getElementById('syncStatusLabel');
    const detailEl = document.getElementById('syncStatusDetail');
    const loginSyncBtn = document.getElementById('loginSyncBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (!iconEl || !labelEl || !detailEl || !loginSyncBtn || !logoutBtn) return;

    // Check if logged in
    const loggedIn = await SyncManager.isLoggedIn();
    const syncStatus = SyncManager.getSyncStatus();

    if (loggedIn) {
        // Logged in - show sync status
        if (syncStatus.synced && syncStatus.lastSync) {
            const lastSyncTime = formatTimeAgo(syncStatus.lastSync);
            iconEl.textContent = '✓';
            labelEl.textContent = 'Synced';
            detailEl.textContent = `Last synced ${lastSyncTime}. Your data is backed up.`;
        } else {
            iconEl.textContent = '⚠️';
            labelEl.textContent = 'Logged in';
            detailEl.textContent = 'Click "Sync Now" to back up your data.';
        }

        // Show logout button, update login button to "Sync Now"
        loginSyncBtn.textContent = 'Sync Now';
        logoutBtn.style.display = 'block';
    } else {
        // Not logged in
        iconEl.textContent = '⚪';
        labelEl.textContent = 'Not synced';
        detailEl.textContent = 'Your data is stored locally in your browser.';

        // Show login button, hide logout
        loginSyncBtn.textContent = 'Login & Sync';
        logoutBtn.style.display = 'none';
    }
}

/**
 * Handle re-rolling the user's display name
 */
async function handleRerollName() {
    try {
        const newName = generateName();
        const userData = await TrifleDB.getUserData(currentUser.id);
        userData.display_name = newName;
        await TrifleDB.updateUser(currentUser.id, userData);

        // Update UI
        updateUserDisplay(newName);

        showSuccess('Name changed to ' + newName, 2000);
        console.log('Name re-rolled to:', newName);
    } catch (error) {
        console.error('Failed to re-roll name:', error);
        showError('Failed to change name. Please try again.');
    }
}

/**
 * Handle login and sync
 */
async function handleLoginSync() {
    const loggedIn = await SyncManager.isLoggedIn();

    if (!loggedIn) {
        // Not logged in - redirect to OAuth
        window.location.href = '/auth/login';
        return;
    }

    // Already logged in - trigger sync
    const btn = document.getElementById('loginSyncBtn');
    if (btn) {
        btn.textContent = 'Syncing...';
        btn.disabled = true;
    }

    try {
        const result = await SyncManager.sync();

        if (result.success) {
            // Sync successful - reload user data and status
            currentUser = await TrifleDB.getCurrentUser();
            const userData = await TrifleDB.getUserData(currentUser.id);
            updateUserDisplay(userData.display_name);

            // Reload avatar editor with synced data
            await initAvatarEditor();

            await updateSyncStatus();
            showSuccess('Sync completed successfully!', 3000);
            console.log('[Sync] Sync completed successfully');
        } else {
            console.error('[Sync] Sync failed:', result.error);
            showError('Sync failed: ' + result.error);
        }
    } catch (error) {
        console.error('[Sync] Sync error:', error);
        showError('Sync failed. Please try again.');
    } finally {
        if (btn) {
            btn.disabled = false;
            await updateSyncStatus(); // Restore button text
        }
    }
}

/**
 * Handle logout
 */
async function handleLogout() {
    try {
        // Redirect to logout endpoint
        window.location.href = '/auth/logout';
    } catch (error) {
        console.error('Logout failed:', error);
        showError('Logout failed. Please try again.');
    }
}

/**
 * Initialize avatar editor
 */
async function initAvatarEditor() {
    try {
        // Load user's saved avatar or start fresh
        const userData = await TrifleDB.getUserData(currentUser.id);

        // New format: shapes array. Old format: config object (ignore it)
        if (userData.avatar && userData.avatar.shapes) {
            shapes = userData.avatar.shapes;
            bgColor = userData.avatar.bgColor || '#E8F4F8';
        } else {
            shapes = [];
            bgColor = '#E8F4F8';
        }

        // Initialize palette
        initShapePalette();
        initColorPalette();
        initBgColorPalette();

        // Set up canvas event listeners (only once!)
        setupCanvasListeners();

        // Render canvas
        updateCanvas();
    } catch (error) {
        console.error('Failed to initialize avatar editor:', error);
    }
}

/**
 * Initialize shape palette
 */
function initShapePalette() {
    const palette = document.getElementById('shapePalette');
    if (!palette) return;

    palette.innerHTML = '';

    Object.entries(SHAPE_PALETTE).forEach(([type, info]) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.draggable = true;
        item.dataset.shapeType = type;

        // Create SVG preview of the shape - use its default color
        const preview = createShapePreview(type, info.color);
        item.innerHTML = preview;

        // Drag start
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('shapeType', type);

            // Create a drag image that matches the actual dropped size
            const dragPreview = createDragPreview(type, info.color);
            document.body.appendChild(dragPreview);
            // Center the drag image at cursor (300px / 2 = 150)
            e.dataTransfer.setDragImage(dragPreview, 150, 150);

            // Remove the preview after a short delay
            setTimeout(() => dragPreview.remove(), 0);
        });

        palette.appendChild(item);
    });
}

/**
 * Create a drag preview using actual shape rendering
 * Matches exactly what will be dropped on canvas (same size as canvas display)
 */
function createDragPreview(type, color) {
    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.top = '-1000px';

    // Create the actual shape centered at 100,100 (canvas center)
    // Use temporary ID 0 for preview
    const shapes = [createShape(type, 100, 100, color, 0)];

    // Render using actual shape rendering code
    const shapesSVG = shapes.map(s => renderShape(s, false)).join('\n');

    // Display at same size as canvas (300px) so drag matches drop
    div.innerHTML = `<svg width="300" height="300" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        ${shapesSVG}
    </svg>`;

    return div;
}

/**
 * Create a small SVG preview using actual shape rendering
 * Uses EXACT same shape creation as drag/drop - only viewBox differs for scaling
 */
function createShapePreview(type, color) {
    // Create shapes EXACTLY as in createDragPreview and drop handler
    // Use temporary ID 0 for preview
    const shapes = [createShape(type, 100, 100, color, 0)];
    let viewBox;

    // Calculate viewBox based on actual shape dimensions from createShape()
    // Only the viewBox changes - shapes are identical to drag/drop
    switch (type) {
        case 'circle':
        case 'eye':
            viewBox = "80 80 40 40"; // r=20, so diameter 40
            break;
        case 'ellipse':
            viewBox = "75 80 50 40"; // rx=25, ry=20
            break;
        case 'rectangle':
            viewBox = "80 75 40 50"; // width=40, height=50
            break;
        case 'bodyRounded':
        case 'bodyNarrow':
        case 'bodyWide':
            // Body shapes: width=60, height=80, centered at (100,100)
            // bodyWide extends ±9px at bottom, so full bounds: 61-139 x, 60-140 y
            viewBox = "61 60 78 80"; // width 78 to show bodyWide's full taper
            break;
        case 'straight':
            viewBox = "85 98 30 4"; // width=30, height=4
            break;
        case 'smile':
            viewBox = "85 100 30 15"; // width=30, height=15
            break;
        default:
            viewBox = "0 0 200 200";
    }

    // Render using actual shape rendering code - identical to drag/drop
    const shapesSVG = shapes.map(s => renderShape(s, false)).join('\n');

    return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        ${shapesSVG}
    </svg>`;
}

/**
 * Darken a hex color
 */
function darken(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.max(0, Math.floor((num >> 16) * (1 - percent)));
    const g = Math.max(0, Math.floor(((num >> 8) & 0x00FF) * (1 - percent)));
    const b = Math.max(0, Math.floor((num & 0x0000FF) * (1 - percent)));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Initialize color palette
 */
function initColorPalette() {
    const palette = document.getElementById('colorPalette');
    if (!palette) return;

    palette.innerHTML = '';

    COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.onclick = () => {
            selectedColor = color;
            // If a shape is selected, change its color immediately
            if (selectedShapeId !== null) {
                const shape = shapes.find(s => s.id === selectedShapeId);
                if (shape) {
                    shape.color = selectedColor;
                    updateCanvas();
                }
            }
            updateColorSelection();
        };

        if (color === selectedColor) {
            swatch.classList.add('selected');
        }

        palette.appendChild(swatch);
    });
}

/**
 * Update color selection UI
 */
function updateColorSelection() {
    const swatches = document.querySelectorAll('#colorPalette .color-swatch');
    swatches.forEach(swatch => {
        if (swatch.style.backgroundColor === selectedColor) {
            swatch.classList.add('selected');
        } else {
            swatch.classList.remove('selected');
        }
    });
}

/**
 * Initialize background color palette
 */
function initBgColorPalette() {
    const palette = document.getElementById('bgColorPalette');
    if (!palette) return;

    palette.innerHTML = '';

    BG_COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.onclick = () => {
            bgColor = color;
            updateBgColorSelection();
            updateCanvas();
        };

        if (color === bgColor) {
            swatch.classList.add('selected');
        }

        palette.appendChild(swatch);
    });
}

/**
 * Update background color selection UI
 */
function updateBgColorSelection() {
    const swatches = document.querySelectorAll('#bgColorPalette .color-swatch');
    swatches.forEach(swatch => {
        if (swatch.style.backgroundColor === bgColor) {
            swatch.classList.add('selected');
        } else {
            swatch.classList.remove('selected');
        }
    });
}

/**
 * Update canvas with current shapes
 */
function updateCanvas() {
    const container = document.getElementById('canvasContainer');
    if (!container) {
        console.error('Canvas container not found');
        return;
    }

    const svg = generateAvatarFromShapes(shapes, selectedShapeId, bgColor);
    container.innerHTML = svg;
}

/**
 * Set up canvas event listeners for drag-and-drop and selection
 */
function setupCanvasListeners() {
    const container = document.getElementById('canvasContainer');
    if (!container) return;

    // Allow drop on container
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    // Handle drop from palette
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const shapeType = e.dataTransfer.getData('shapeType');
        if (!shapeType) {
            return;
        }

        // Find the SVG element to get accurate positioning
        const svg = container.querySelector('svg');
        let x, y;

        if (svg) {
            // Get drop position relative to the actual SVG element
            const svgRect = svg.getBoundingClientRect();

            // Calculate position as percentage of SVG, then map to viewBox (0-200)
            const relX = (e.clientX - svgRect.left) / svgRect.width;
            const relY = (e.clientY - svgRect.top) / svgRect.height;

            x = relX * 200;
            y = relY * 200;
        } else {
            // Fallback to center if no SVG
            x = 100;
            y = 100;
        }

        // Validate coordinates and ensure they're within the canvas bounds
        if (!isFinite(x) || !isFinite(y)) {
            console.error('Invalid drop coordinates:', x, y);
            return;
        }

        // Ignore drops outside the visible canvas area (0-200)
        if (x < 0 || x > 200 || y < 0 || y > 200) {
            return;
        }

        // Check if we've reached the maximum number of shapes
        const MAX_SHAPES = 200;
        if (shapes.length >= MAX_SHAPES) {
            showError(`Maximum of ${MAX_SHAPES} shapes reached`);
            return;
        }

        // Get the default color for this shape type
        const shapeColor = SHAPE_PALETTE[shapeType]?.color || '#FFD5A5';

        // Add the shape to the canvas with next available ID
        const newId = getNextShapeId(shapes);
        const newShape = createShape(shapeType, x, y, shapeColor, newId);
        shapes.push(newShape);

        // Select the newly added shape
        selectedShapeId = newShape.id;
        updateShapeControls();

        // Disable undo when user adds a shape
        disableUndo();

        updateCanvas();
    });

    // Handle mousedown to start dragging or selection
    container.addEventListener('mousedown', (e) => {
        const svg = container.querySelector('svg');
        if (!svg) return;

        // Get click position in SVG coordinates
        const svgRect = svg.getBoundingClientRect();
        const relX = (e.clientX - svgRect.left) / svgRect.width;
        const relY = (e.clientY - svgRect.top) / svgRect.height;
        const x = relX * 200;
        const y = relY * 200;

        // Check if clicking on a resize or rotate handle
        const target = e.target;
        if (target.classList.contains('resize-handle')) {
            e.stopPropagation();
            const shapeId = parseInt(target.dataset.shapeId);
            const shape = shapes.find(s => s.id === shapeId);
            if (shape) {
                isResizing = true;
                selectedShapeId = shapeId; // Ensure the shape is selected
                dragStartX = x;
                dragStartY = y;
                // Store initial size properties
                resizeStartSize = { ...shape };
                container.style.cursor = 'nwse-resize';
            }
            return;
        }

        if (target.classList.contains('rotate-handle')) {
            e.stopPropagation();
            const shapeId = parseInt(target.dataset.shapeId);
            const shape = shapes.find(s => s.id === shapeId);
            if (shape) {
                isRotating = true;
                selectedShapeId = shapeId; // Ensure the shape is selected
                dragStartX = x;
                dragStartY = y;
                // Calculate initial angle from shape center to handle
                rotateStartAngle = Math.atan2(y - shape.y, x - shape.x) * (180 / Math.PI) - (shape.rotation || 0);
                container.style.cursor = 'crosshair';
            }
            return;
        }

        // Find the topmost shape at this position (iterate backwards for z-order)
        let clickedShapeId = null;
        for (let i = shapes.length - 1; i >= 0; i--) {
            if (isPointInShape(x, y, shapes[i])) {
                clickedShapeId = shapes[i].id;
                break;
            }
        }

        // Update selection
        if (clickedShapeId !== null) {
            selectedShapeId = clickedShapeId;
            updateShapeControls();

            // Start dragging
            const shape = shapes.find(s => s.id === selectedShapeId);
            if (shape) {
                isDragging = true;
                dragStartX = x;
                dragStartY = y;
                dragShapeStartX = shape.x;
                dragShapeStartY = shape.y;
                // Save original shape state for option-drag duplication
                originalShapeState = { ...shape };
                container.style.cursor = 'move';
            }
        } else {
            // Clicked background - deselect
            selectedShapeId = null;
            updateShapeControls();
        }

        updateCanvas();
    });

    // Handle mousemove to drag/resize/rotate
    container.addEventListener('mousemove', (e) => {
        const svg = container.querySelector('svg');
        if (!svg) return;

        // Get current mouse position in SVG coordinates
        const svgRect = svg.getBoundingClientRect();
        const relX = (e.clientX - svgRect.left) / svgRect.width;
        const relY = (e.clientY - svgRect.top) / svgRect.height;
        const x = relX * 200;
        const y = relY * 200;

        if (isResizing && selectedShapeId !== null) {
            // Resize selected shape - make handle follow mouse directly
            const shape = shapes.find(s => s.id === selectedShapeId);
            if (shape) {
                // Transform current mouse position into shape's local coordinate space
                const dx = x - shape.x;
                const dy = y - shape.y;

                const rotation = (shape.rotation || 0) * Math.PI / 180;
                const cos = Math.cos(-rotation);
                const sin = Math.sin(-rotation);
                const localX = dx * cos - dy * sin;
                const localY = dx * sin + dy * cos;

                // The resize handle is at the bottom-right corner in local space
                // So localX and localY represent where we want the corner to be
                // Calculate new dimensions directly from handle position

                // Switch on the ORIGINAL type to use correct resizeStartSize properties
                switch (resizeStartSize.type) {
                    case 'circle':
                    case 'eye':
                        // For circles, radius is the distance from center to mouse
                        const newRadius = Math.sqrt(localX * localX + localY * localY);

                        // If aspect ratio is very different, convert to ellipse
                        if (Math.abs(Math.abs(localX) - Math.abs(localY)) > 5) {
                            shape.type = 'ellipse';
                            shape.rx = Math.max(5, Math.abs(localX));
                            shape.ry = Math.max(5, Math.abs(localY));
                            delete shape.r;
                        } else {
                            // Keep as circle
                            shape.type = resizeStartSize.type;
                            shape.r = Math.max(5, newRadius);
                        }
                        break;
                    case 'ellipse':
                        // Ellipse radii are the distances in each axis
                        shape.rx = Math.max(5, Math.abs(localX));
                        shape.ry = Math.max(5, Math.abs(localY));
                        break;
                    case 'rectangle':
                    case 'bodyRounded':
                    case 'bodyNarrow':
                    case 'bodyWide':
                        // Width and height are 2x the local coordinates (center to edge)
                        shape.width = Math.max(10, Math.abs(localX) * 2);
                        shape.height = Math.max(10, Math.abs(localY) * 2);
                        break;
                    case 'straight':
                    case 'smile':
                        // Facial features can be very thin
                        shape.width = Math.max(5, Math.abs(localX) * 2);
                        shape.height = Math.max(1, Math.abs(localY) * 2);
                        break;
                }
                updateCanvas();
            }
        } else if (isRotating && selectedShapeId !== null) {
            // Rotate selected shape
            const shape = shapes.find(s => s.id === selectedShapeId);
            if (shape) {
                // Calculate current angle from shape center to mouse
                const currentAngle = Math.atan2(y - shape.y, x - shape.x) * (180 / Math.PI);
                shape.rotation = currentAngle - rotateStartAngle;
                updateCanvas();
            }
        } else if (isDragging && selectedShapeId !== null) {
            // Handle option-drag duplication
            const optionPressed = e.altKey || e.metaKey;

            if (optionPressed && !isDuplicating) {
                // Just pressed option - create duplicate and switch to dragging it
                isDuplicating = true;

                // Restore original shape to its starting position
                const originalShape = shapes.find(s => s.id === selectedShapeId);
                if (originalShape && originalShapeState) {
                    originalShape.x = originalShapeState.x;
                    originalShape.y = originalShapeState.y;
                }

                // Create duplicate of the original shape with next available ID
                const newId = getNextShapeId(shapes);
                const duplicate = { ...originalShapeState, id: newId };
                shapes.push(duplicate);
                duplicatedShapeId = duplicate.id;
                selectedShapeId = duplicate.id;

                // Update start position for the duplicate
                dragShapeStartX = originalShapeState.x;
                dragShapeStartY = originalShapeState.y;
            } else if (!optionPressed && isDuplicating) {
                // Just released option - remove duplicate and switch back to moving original
                isDuplicating = false;

                // Remove the duplicate
                const dupIndex = shapes.findIndex(s => s.id === duplicatedShapeId);
                if (dupIndex !== -1) {
                    shapes.splice(dupIndex, 1);
                }

                // Switch back to moving the original
                selectedShapeId = originalShapeState.id;
                duplicatedShapeId = null;
            }

            // Move the currently selected shape (either original or duplicate)
            const dx = x - dragStartX;
            const dy = y - dragStartY;

            const shape = shapes.find(s => s.id === selectedShapeId);
            if (shape) {
                shape.x = dragShapeStartX + dx;
                shape.y = dragShapeStartY + dy;
                updateCanvas();
            }
        }
    });

    // Handle mouseup to stop dragging/resizing/rotating
    container.addEventListener('mouseup', () => {
        if (isDragging || isResizing || isRotating) {
            // If we were duplicating, the duplicate is now permanent
            if (isDuplicating) {
                // Keep the duplicate, select it
                updateShapeControls();
            }

            // Check if the selected shape is now completely out of bounds
            if (selectedShapeId !== null) {
                const shape = shapes.find(s => s.id === selectedShapeId);
                if (shape && isShapeOutOfBounds(shape)) {
                    // Delete the shape
                    const index = shapes.findIndex(s => s.id === selectedShapeId);
                    if (index !== -1) {
                        shapes.splice(index, 1);
                        selectedShapeId = null;
                        updateShapeControls();
                        updateCanvas();
                    }
                }
            }

            isDragging = false;
            isResizing = false;
            isRotating = false;
            isDuplicating = false;
            duplicatedShapeId = null;
            originalShapeState = null;
            container.style.cursor = 'default';
            disableUndo(); // Any shape manipulation is a change
        }
    });

    // Handle mouseleave to stop all operations if mouse leaves container
    container.addEventListener('mouseleave', () => {
        if (isDragging || isResizing || isRotating) {
            // If we were duplicating, cancel it and restore original
            if (isDuplicating) {
                const dupIndex = shapes.findIndex(s => s.id === duplicatedShapeId);
                if (dupIndex !== -1) {
                    shapes.splice(dupIndex, 1);
                }
                selectedShapeId = originalShapeState.id;
                updateCanvas();
            }

            isDragging = false;
            isResizing = false;
            isRotating = false;
            isDuplicating = false;
            duplicatedShapeId = null;
            originalShapeState = null;
            container.style.cursor = 'default';
        }
    });
}

/**
 * Check if a shape is completely outside the visible canvas (0-200)
 * Returns true if the shape should be deleted
 */
function isShapeOutOfBounds(shape) {
    let minX, maxX, minY, maxY;

    switch (shape.type) {
        case 'circle':
        case 'eye':
            minX = shape.x - shape.r;
            maxX = shape.x + shape.r;
            minY = shape.y - shape.r;
            maxY = shape.y + shape.r;
            break;
        case 'ellipse':
            minX = shape.x - shape.rx;
            maxX = shape.x + shape.rx;
            minY = shape.y - shape.ry;
            maxY = shape.y + shape.ry;
            break;
        case 'rectangle':
        case 'bodyRounded':
        case 'bodyNarrow':
        case 'bodyWide':
        case 'straight':
        case 'smile':
            minX = shape.x - shape.width / 2;
            maxX = shape.x + shape.width / 2;
            minY = shape.y - shape.height / 2;
            maxY = shape.y + shape.height / 2;
            break;
        default:
            return false;
    }

    // Check if completely outside the 0-200 bounds
    return maxX < 0 || minX > 200 || maxY < 0 || minY > 200;
}

/**
 * Check if a point is inside a shape
 */
function isPointInShape(x, y, shape) {
    const dx = x - shape.x;
    const dy = y - shape.y;

    switch (shape.type) {
        case 'circle':
        case 'eye':
            return dx * dx + dy * dy <= shape.r * shape.r;

        case 'ellipse':
            return (dx * dx) / (shape.rx * shape.rx) + (dy * dy) / (shape.ry * shape.ry) <= 1;

        case 'rectangle':
            return Math.abs(dx) <= shape.width / 2 && Math.abs(dy) <= shape.height / 2;

        case 'bodyRounded':
        case 'bodyNarrow':
        case 'bodyWide':
        case 'straight':
        case 'smile':
            // Simple bounding box check for body shapes and facial features
            return Math.abs(dx) <= shape.width / 2 && Math.abs(dy) <= shape.height / 2;

        default:
            return false;
    }
}

/**
 * Update shape controls panel
 */
function updateShapeControls() {
    const controls = document.getElementById('shapeControls');
    if (!controls) return;

    if (selectedShapeId === null) {
        controls.innerHTML = '<p style="color: #999; font-size: 12px;">Click a shape to edit</p>';
        selectedColor = COLORS[0]; // Reset to default
        updateColorSelection();
        return;
    }

    // Find the selected shape
    const shape = shapes.find(s => s.id === selectedShapeId);
    if (!shape) {
        selectedShapeId = null;
        controls.innerHTML = '<p style="color: #999; font-size: 12px;">Click a shape to edit</p>';
        selectedColor = COLORS[0];
        updateColorSelection();
        return;
    }

    // Set selected color to the shape's color and update UI
    selectedColor = shape.color;
    updateColorSelection();

    controls.innerHTML = `
        <button class="control-btn" onclick="window.sendShapeToFront()">Send to Front</button>
        <button class="control-btn" onclick="window.sendShapeToBack()">Send to Back</button>
        <button class="control-btn" onclick="window.deleteSelectedShape()" style="color: #e74c3c;">Delete</button>
    `;
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Re-roll name button
    const rerollBtn = document.getElementById('rerollBtn');
    if (rerollBtn) {
        rerollBtn.addEventListener('click', handleRerollName);
    }

    // Login & Sync button
    const loginSyncBtn = document.getElementById('loginSyncBtn');
    if (loginSyncBtn) {
        loginSyncBtn.addEventListener('click', handleLoginSync);
    }

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Save avatar button
    const saveAvatarBtn = document.getElementById('saveAvatarBtn');
    if (saveAvatarBtn) {
        saveAvatarBtn.addEventListener('click', handleSaveAvatar);
    }

    // Clear/Undo canvas button
    const clearCanvasBtn = document.getElementById('clearCanvasBtn');
    if (clearCanvasBtn) {
        clearCanvasBtn.addEventListener('click', handleClearOrUndo);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Delete or Backspace to delete selected shape
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId !== null) {
            // Don't trigger if user is typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            e.preventDefault();
            window.deleteSelectedShape();
        }
    });
}

/**
 * Handle saving the avatar
 */
async function handleSaveAvatar() {
    try {
        const userData = await TrifleDB.getUserData(currentUser.id);
        userData.avatar = {
            shapes,
            bgColor
        };
        await TrifleDB.updateUser(currentUser.id, userData);

        showSuccess('Avatar saved!', 2000);
        console.log('Avatar saved:', shapes.length, 'shapes');
    } catch (error) {
        console.error('Failed to save avatar:', error);
        showError('Failed to save avatar. Please try again.');
    }
}

/**
 * Handle clear or undo based on current state
 */
function handleClearOrUndo() {
    const btn = document.getElementById('clearCanvasBtn');
    if (!btn) return;

    if (undoShapes !== null) {
        // Undo mode - restore shapes
        shapes = undoShapes;
        undoShapes = null;
        selectedShapeId = null;
        btn.textContent = 'Clear All';
        btn.className = 'btn btn-secondary';
        updateCanvas();
    } else {
        // Clear mode - save current shapes and clear
        if (shapes.length === 0) return;

        undoShapes = [...shapes]; // Deep copy
        shapes = [];
        selectedShapeId = null;
        btn.textContent = 'Undo Clear';
        btn.className = 'btn btn-primary';
        updateCanvas();
    }
}

/**
 * Disable undo when user makes any change
 */
function disableUndo() {
    if (undoShapes !== null) {
        undoShapes = null;
        const btn = document.getElementById('clearCanvasBtn');
        if (btn) {
            btn.textContent = 'Clear All';
            btn.className = 'btn btn-secondary';
        }
    }
}

/**
 * Format timestamp as relative time (e.g., "5 minutes ago")
 */
function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    } else if (hours > 0) {
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else if (minutes > 0) {
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else {
        return 'just now';
    }
}

/**
 * Send selected shape to front
 */
window.sendShapeToFront = function() {
    if (selectedShapeId === null) return;

    const index = shapes.findIndex(s => s.id === selectedShapeId);
    if (index !== -1 && index < shapes.length - 1) {
        const shape = shapes.splice(index, 1)[0];
        shapes.push(shape);
        updateCanvas();
    }
};

/**
 * Send selected shape to back
 */
window.sendShapeToBack = function() {
    if (selectedShapeId === null) return;

    const index = shapes.findIndex(s => s.id === selectedShapeId);
    if (index !== -1 && index > 0) {
        const shape = shapes.splice(index, 1)[0];
        shapes.unshift(shape);
        updateCanvas();
    }
};

/**
 * Delete selected shape
 */
window.deleteSelectedShape = function() {
    if (selectedShapeId === null) return;

    const index = shapes.findIndex(s => s.id === selectedShapeId);
    if (index !== -1) {
        shapes.splice(index, 1);
        selectedShapeId = null;
        updateShapeControls();
        disableUndo();
        updateCanvas();
    }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
