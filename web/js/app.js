/**
 * Trifle App - Main Integration
 * Wires together the UI (index.html), IndexedDB (db.js), and name generator (namegen.js)
 */

import { generateName } from './namegen.js';
import { TrifleDB } from './db.js';
import { SyncManager } from './sync-kv.js';
import { showError } from './notifications.js';

// Current user (cached after init)
let currentUser = null;

/**
 * Initialize the app on page load
 */
async function init() {
    try {
        // Check for OAuth error in URL (from failed login)
        const urlParams = new URLSearchParams(window.location.search);
        const errorMsg = urlParams.get('error');
        if (errorMsg) {
            showError(errorMsg);
            // Clean up URL without reloading
            window.history.replaceState({}, '', '/');
        }

        // Initialize user (create if doesn't exist)
        await initUser();

        // Update sync status
        await updateSyncStatus();

        // Load and display trifles
        await loadTrifles();

        // Set up event listeners
        setupEventListeners();

    } catch (error) {
        console.error('Failed to initialize app:', error);
        showError('Failed to load app. Please refresh the page.');
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
 * Update user display in the UI
 */
function updateUserDisplay(displayName) {
    const nameElement = document.getElementById('profileName');
    if (nameElement) {
        nameElement.textContent = displayName;
    }
}

/**
 * Update sync status in the UI
 */
async function updateSyncStatus() {
    const statusElement = document.getElementById('profileStatus');
    const loginSyncBtn = document.getElementById('loginSyncBtn');

    if (!statusElement || !loginSyncBtn) return;

    // Check if logged in
    const loggedIn = await SyncManager.isLoggedIn();
    const syncStatus = SyncManager.getSyncStatus();

    if (loggedIn) {
        // Logged in - show sync status
        if (syncStatus.synced && syncStatus.lastSync) {
            const lastSyncTime = formatTimeAgo(syncStatus.lastSync);
            statusElement.textContent = `Synced ${lastSyncTime}${syncStatus.email ? ' • ' + syncStatus.email : ''}`;
        } else {
            statusElement.textContent = 'Logged in • Not synced yet';
        }
        loginSyncBtn.textContent = 'Sync Now';
        loginSyncBtn.className = 'btn btn-primary';
    } else {
        // Not logged in
        statusElement.textContent = 'Local only • Not synced';
        loginSyncBtn.textContent = 'Login & Sync';
        loginSyncBtn.className = 'btn btn-primary';
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
            // Sync successful - reload user data, trifles, and status
            currentUser = await TrifleDB.getCurrentUser();
            const userData = await TrifleDB.getUserData(currentUser.id);
            updateUserDisplay(userData.display_name);

            await loadTrifles();
            await updateSyncStatus();
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
 * Load and display all trifles for current user
 */
async function loadTrifles() {
    const trifles = await TrifleDB.getTriflesByOwner(currentUser.id);
    const container = document.getElementById('triflesContainer');

    if (!container) return;

    // Clear loading message
    container.innerHTML = '';

    if (trifles.length === 0) {
        // Show empty state
        container.innerHTML = `
            <div class="empty-state">
                <h2>No Trifles yet</h2>
                <p>Create your first Python project to get started</p>
            </div>
        `;
        return;
    }

    // Create grid
    const grid = document.createElement('div');
    grid.className = 'trifles-grid';

    // Create and display trifle cards
    for (const trifle of trifles) {
        const data = await TrifleDB.getTrifleData(trifle.id);
        const card = createTrifleCard(trifle, data);
        grid.appendChild(card);
    }

    container.appendChild(grid);
}

/**
 * Create a trifle card element
 */
function createTrifleCard(trifle, data) {
    const card = document.createElement('div');
    card.className = 'trifle-card';
    card.onclick = () => window.location.href = `/editor.html?id=${trifle.id}`;

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-trifle-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteTrifle(trifle, data);
    };

    // Content wrapper
    const content = document.createElement('div');
    content.className = 'trifle-card-content';

    // Title
    const title = document.createElement('div');
    title.className = 'trifle-title';
    title.textContent = data.name;

    // Description
    const description = document.createElement('div');
    description.className = 'trifle-description';

    const descriptionText = document.createElement('span');
    descriptionText.className = 'trifle-description-text';
    descriptionText.textContent = data.description || 'No description';

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-description-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit description';
    editBtn.onclick = (e) => {
        e.stopPropagation();
        editDescription(trifle, data, descriptionText, description, card);
    };

    description.appendChild(descriptionText);
    description.appendChild(editBtn);

    // Meta
    const meta = document.createElement('div');
    meta.className = 'trifle-meta';
    const fileCount = data.files?.length || 0;
    const timeAgo = formatTimeAgo(trifle.last_modified);
    meta.innerHTML = `
        <span>${fileCount} ${fileCount === 1 ? 'file' : 'files'}</span>
        <span>${timeAgo}</span>
    `;

    content.appendChild(title);
    content.appendChild(description);
    content.appendChild(meta);

    card.appendChild(deleteBtn);
    card.appendChild(content);

    return card;
}

/**
 * Delete trifle
 */
async function deleteTrifle(trifle, data) {
    if (!confirm(`Delete "${data.name}"? This cannot be undone.`)) {
        return;
    }

    try {
        await TrifleDB.deleteTrifle(trifle.id);
        // Reload the trifles list
        await loadTrifles();
    } catch (error) {
        console.error('Error deleting trifle:', error);
        showError('Failed to delete trifle. Please try again.');
    }
}

/**
 * Edit description
 */
async function editDescription(trifle, data, descriptionTextElement, descriptionContainer, card) {
    const currentDescription = data.description || '';

    // Add editing class to disable card hover/click
    card.classList.add('editing');

    // Disable card onclick
    const originalOnClick = card.onclick;
    card.onclick = null;

    // Create textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'description-input';
    textarea.value = currentDescription;

    // Replace description with textarea
    descriptionContainer.innerHTML = '';
    descriptionContainer.appendChild(textarea);

    // Handle clicks outside the textarea
    const handleClickOutside = (e) => {
        if (!textarea.contains(e.target)) {
            saveDescription();
        }
    };

    // Add click outside listener after a short delay to avoid immediate triggering
    setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    textarea.focus();
    textarea.select();

    const saveDescription = async () => {
        const newDescription = textarea.value.trim();

        // Remove editing class and restore onclick
        card.classList.remove('editing');
        card.onclick = originalOnClick;

        // Remove click outside listener
        document.removeEventListener('mousedown', handleClickOutside);

        // Restore original structure
        const descriptionText = document.createElement('span');
        descriptionText.className = 'trifle-description-text';
        descriptionText.textContent = newDescription || 'No description';

        const editBtn = document.createElement('button');
        editBtn.className = 'edit-description-btn';
        editBtn.textContent = '✎';
        editBtn.title = 'Edit description';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            editDescription(trifle, data, descriptionText, descriptionContainer, card);
        };

        descriptionContainer.innerHTML = '';
        descriptionContainer.appendChild(descriptionText);
        descriptionContainer.appendChild(editBtn);

        // If description changed, save to IndexedDB
        if (newDescription !== currentDescription) {
            try {
                // Get current trifle data
                const trifleData = await TrifleDB.getTrifleData(trifle.id);

                // Update description
                trifleData.description = newDescription;

                // Save to IndexedDB
                await TrifleDB.updateTrifle(trifle.id, trifleData);

                // Update local reference
                data.description = newDescription;
            } catch (error) {
                console.error('Error updating description:', error);
                showError('Failed to update description. Please try again.');
                // Restore old description on error
                descriptionText.textContent = currentDescription || 'No description';
            }
        }
    };

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            saveDescription();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            // Cancel - restore original

            // Remove editing class and restore onclick
            card.classList.remove('editing');
            card.onclick = originalOnClick;

            // Remove click outside listener
            document.removeEventListener('mousedown', handleClickOutside);

            const descriptionText = document.createElement('span');
            descriptionText.className = 'trifle-description-text';
            descriptionText.textContent = currentDescription || 'No description';

            const editBtn = document.createElement('button');
            editBtn.className = 'edit-description-btn';
            editBtn.textContent = '✎';
            editBtn.title = 'Edit description';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                editDescription(trifle, data, descriptionText, descriptionContainer, card);
            };

            descriptionContainer.innerHTML = '';
            descriptionContainer.appendChild(descriptionText);
            descriptionContainer.appendChild(editBtn);
        }
    });
}

/**
 * Handle creating a new trifle from modal
 */
async function handleNewTrifle(title, description) {
    try {
        const newTrifle = await TrifleDB.createTrifle(
            currentUser.id,
            title,
            description
        );

        // Navigate to editor
        window.location.href = `/editor.html?id=${newTrifle.id}`;
    } catch (error) {
        console.error('Failed to create trifle:', error);
        showError('Failed to create new trifle. Please try again.');
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

        console.log('Name re-rolled to:', newName);
    } catch (error) {
        console.error('Failed to re-roll name:', error);
        showError('Failed to change name. Please try again.');
    }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Re-roll name button
    const rerollBtn = document.getElementById('rerollNameBtn');
    if (rerollBtn) {
        rerollBtn.addEventListener('click', handleRerollName);
    }

    // Login & Sync button
    const loginSyncBtn = document.getElementById('loginSyncBtn');
    if (loginSyncBtn) {
        loginSyncBtn.addEventListener('click', handleLoginSync);
    }

    // Modal handling
    const modal = document.getElementById('newTrifleModal');
    const newTrifleBtn = document.getElementById('newTrifleBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const form = document.getElementById('newTrifleForm');
    const titleInput = document.getElementById('trifleTitle');

    const closeModal = () => {
        modal.classList.remove('active');
        if (form) form.reset();
    };

    if (newTrifleBtn && modal) {
        newTrifleBtn.addEventListener('click', () => {
            modal.classList.add('active');
            // Auto-focus title input
            if (titleInput) {
                setTimeout(() => titleInput.focus(), 100);
            }
        });
    }

    if (cancelBtn && modal && form) {
        cancelBtn.addEventListener('click', closeModal);
    }

    if (modal) {
        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // Esc to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeModal();
            }
        });
    }

    // Cmd/Ctrl+Enter to submit form
    if (form) {
        form.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                form.requestSubmit();
            }
        });
    }

    // Create new trifle
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = document.getElementById('trifleTitle').value;
            const description = document.getElementById('trifleDescription').value;

            await handleNewTrifle(title, description);
        });
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

// Note: showError is now imported from notifications.js
// It displays a dismissible notification banner instead of using alert()

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
