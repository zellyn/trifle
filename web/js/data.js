/**
 * Data Import/Export Page
 * Backup and restore profile and trifles with selective export and smart conflict resolution
 */

import { TrifleDB } from './db.js';
import { showError, showSuccess } from './notifications.js';

// Current user
let currentUser = null;

// Export state
let exportItems = [];

// Import state
let importData = null;
let importRecommendations = [];

/**
 * Initialize the data management page
 */
async function init() {
    try {
        // Get current user
        currentUser = await TrifleDB.getCurrentUser();
        if (!currentUser) {
            showError('No user found. Please go to the home page first.');
            return;
        }

        // Load export list
        await loadExportList();

        // Set up event listeners
        setupEventListeners();

    } catch (error) {
        console.error('Failed to initialize data page:', error);
        showError('Failed to load data management page.');
    }
}

/**
 * Load export checklist
 */
async function loadExportList() {
    const container = document.getElementById('exportList');
    const exportBtn = document.getElementById('exportBtn');
    const bulkActions = document.getElementById('exportBulkActions');

    if (!container) return;

    exportItems = [];
    container.innerHTML = '';

    // Get user data
    const userData = await TrifleDB.getUserData(currentUser.id);
    const hasAvatar = userData.avatar && userData.avatar.shapes && userData.avatar.shapes.length > 0;

    // Add profile item
    const profileMeta = hasAvatar
        ? `${userData.display_name}, custom avatar`
        : `${userData.display_name}, no avatar`;

    exportItems.push({
        type: 'profile',
        id: currentUser.id,
        name: 'Profile',
        meta: profileMeta,
        data: userData,
        pointer: currentUser
    });

    // Get all trifles
    const trifles = await TrifleDB.getTriflesByOwner(currentUser.id);

    for (const trifle of trifles) {
        const trifleData = await TrifleDB.getTrifleData(trifle.id);
        const fileCount = trifleData.files?.length || 0;
        const timeAgo = formatTimeAgo(trifle.last_modified);

        exportItems.push({
            type: 'trifle',
            id: trifle.id,
            name: trifleData.name,
            meta: `${fileCount} ${fileCount === 1 ? 'file' : 'files'}, modified ${timeAgo}`,
            data: trifleData,
            pointer: trifle
        });
    }

    // Render export items
    exportItems.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'export-item';
        itemDiv.innerHTML = `
            <input type="checkbox" id="export-${index}" checked data-index="${index}">
            <div class="item-info">
                <div class="item-name">${item.name}</div>
                <div class="item-meta">${item.meta}</div>
            </div>
        `;
        container.appendChild(itemDiv);
    });

    // Show bulk actions and enable export button
    bulkActions.style.display = 'flex';
    exportBtn.disabled = false;

    // Update export button state on checkbox change
    container.addEventListener('change', updateExportButtonState);
    updateExportButtonState();
}

/**
 * Update export button enabled state based on selections
 */
function updateExportButtonState() {
    const checkboxes = document.querySelectorAll('#exportList input[type="checkbox"]');
    const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.disabled = !anyChecked;
    }
}

/**
 * Export selected items
 */
async function exportSelected() {
    try {
        const checkboxes = document.querySelectorAll('#exportList input[type="checkbox"]');
        const selectedItems = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => exportItems[parseInt(cb.dataset.index)]);

        if (selectedItems.length === 0) {
            showError('Please select at least one item to export.');
            return;
        }

        // Build export JSON
        const exportData = {
            version: 1,
            exported_at: Date.now()
        };

        // Include profile if selected
        const profileItem = selectedItems.find(item => item.type === 'profile');
        if (profileItem) {
            exportData.profile = {
                id: profileItem.id,
                data: profileItem.data,
                last_modified: profileItem.pointer.last_modified,
                logical_clock: profileItem.pointer.logical_clock
            };
        }

        // Include selected trifles
        const trifleItems = selectedItems.filter(item => item.type === 'trifle');
        if (trifleItems.length > 0) {
            exportData.trifles = [];

            for (const item of trifleItems) {
                // Gather file contents
                const fileContents = {};
                for (const file of item.data.files) {
                    const content = await TrifleDB.getContent(file.hash);
                    fileContents[file.hash] = content;
                }

                exportData.trifles.push({
                    id: item.id,
                    data: item.data,
                    last_modified: item.pointer.last_modified,
                    logical_clock: item.pointer.logical_clock,
                    file_contents: fileContents
                });
            }
        }

        // Generate filename
        const timestamp = new Date().toISOString().split('T')[0];
        let filename;
        if (selectedItems.length === 1 && selectedItems[0].type === 'trifle') {
            const safeName = selectedItems[0].name.replace(/[^a-zA-Z0-9]/g, '-');
            filename = `trifle-${safeName}.json`;
        } else {
            filename = `trifling-backup-${timestamp}.json`;
        }

        // Download JSON
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        showSuccess(`Exported ${selectedItems.length} ${selectedItems.length === 1 ? 'item' : 'items'}!`, 3000);

    } catch (error) {
        console.error('Export failed:', error);
        showError('Failed to export data. Please try again.');
    }
}

/**
 * Handle import file selection
 */
async function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Validate format
        if (!data.version || data.version !== 1) {
            showError('Invalid backup file format.');
            return;
        }

        // Store import data
        importData = data;

        // Analyze and show review UI
        await analyzeImport();

    } catch (error) {
        console.error('Import file error:', error);
        showError('Failed to read backup file. Please check the file format.');
    }
}

/**
 * Analyze import data and show review UI
 */
async function analyzeImport() {
    const reviewSection = document.getElementById('reviewSection');
    const importList = document.getElementById('importList');

    if (!reviewSection || !importList) return;

    importList.innerHTML = '';
    importRecommendations = [];

    // Analyze profile
    if (importData.profile) {
        const localUserData = await TrifleDB.getUserData(currentUser.id);
        const imported = importData.profile;
        const local = {
            data: localUserData,
            last_modified: currentUser.last_modified
        };

        const recommendation = analyzeProfileConflict(imported, local);
        importRecommendations.push(recommendation);

        const itemDiv = createImportItem(recommendation, importRecommendations.length - 1);
        importList.appendChild(itemDiv);
    }

    // Analyze trifles
    if (importData.trifles) {
        for (const imported of importData.trifles) {
            // Check if trifle exists locally (by ID)
            const local = await TrifleDB.getTrifle(imported.id);

            let recommendation;
            if (local) {
                // Conflict - trifle exists
                const localData = await TrifleDB.getTrifleData(imported.id);
                recommendation = analyzeTrifleConflict(imported, { ...local, data: localData });
            } else {
                // New trifle
                recommendation = {
                    type: 'trifle',
                    id: imported.id,
                    name: imported.data.name,
                    imported,
                    local: null,
                    conflict: false,
                    action: 'import',
                    checked: true
                };
            }

            importRecommendations.push(recommendation);
            const itemDiv = createImportItem(recommendation, importRecommendations.length - 1);
            importList.appendChild(itemDiv);
        }
    }

    // Show review section
    reviewSection.classList.remove('hidden');
}

/**
 * Analyze profile conflict and generate recommendation
 */
function analyzeProfileConflict(imported, local) {
    const importedHasAvatar = imported.data.avatar && imported.data.avatar.shapes && imported.data.avatar.shapes.length > 0;
    const localHasAvatar = local.data.avatar && local.data.avatar.shapes && local.data.avatar.shapes.length > 0;

    let action = 'skip';

    // Recommend import if imported has avatar and local doesn't
    if (importedHasAvatar && !localHasAvatar) {
        action = 'import';
    }
    // Or if imported is newer
    else if (imported.last_modified > local.last_modified) {
        action = 'import';
    }

    return {
        type: 'profile',
        imported,
        local,
        conflict: true,
        action,
        checked: action === 'import'
    };
}

/**
 * Analyze trifle conflict and generate recommendation
 */
function analyzeTrifleConflict(imported, local) {
    // Recommend overwrite if imported is newer
    const action = imported.last_modified > local.last_modified ? 'overwrite' : 'skip';

    return {
        type: 'trifle',
        id: imported.id,
        name: imported.data.name,
        imported,
        local,
        conflict: true,
        action,
        checked: action === 'overwrite'
    };
}

/**
 * Create import item UI element
 */
function createImportItem(recommendation, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'import-item';

    if (recommendation.type === 'profile') {
        itemDiv.innerHTML = createProfileImportUI(recommendation, index);
    } else {
        itemDiv.innerHTML = createTrifleImportUI(recommendation, index);
    }

    return itemDiv;
}

/**
 * Create profile import UI
 */
function createProfileImportUI(rec, index) {
    const importedHasAvatar = rec.imported.data.avatar && rec.imported.data.avatar.shapes && rec.imported.data.avatar.shapes.length > 0;
    const localHasAvatar = rec.local.data.avatar && rec.local.data.avatar.shapes && rec.local.data.avatar.shapes.length > 0;

    const importedDesc = `${rec.imported.data.display_name}${importedHasAvatar ? ', custom avatar' : ', no avatar'} (modified ${formatTimeAgo(rec.imported.last_modified)})`;
    const localDesc = `${rec.local.data.display_name}${localHasAvatar ? ', custom avatar' : ', no avatar'} (modified ${formatTimeAgo(rec.local.last_modified)})`;

    return `
        <div class="item-info">
            <div class="item-name">Profile</div>
            <div class="import-actions">
                <div class="radio-group">
                    <label>
                        <input type="radio" name="profile-action-${index}" value="import" ${rec.action === 'import' ? 'checked' : ''} data-index="${index}">
                        Import
                    </label>
                    <label>
                        <input type="radio" name="profile-action-${index}" value="skip" ${rec.action === 'skip' ? 'checked' : ''} data-index="${index}">
                        Skip
                    </label>
                </div>
                <div class="comparison">
                    <div class="comparison-row">
                        <span class="comparison-label">Imported:</span>
                        <span class="comparison-value">${importedDesc}</span>
                    </div>
                    <div class="comparison-row">
                        <span class="comparison-label">Local:</span>
                        <span class="comparison-value">${localDesc}</span>
                    </div>
                </div>
                <div class="recommended">→ Recommended: ${rec.action === 'import' ? 'Import' : 'Skip'} ✓</div>
            </div>
        </div>
    `;
}

/**
 * Create trifle import UI
 */
function createTrifleImportUI(rec, index) {
    if (!rec.conflict) {
        // New trifle
        const fileCount = rec.imported.data.files?.length || 0;
        return `
            <div class="item-info">
                <div class="item-name">Trifle: "${rec.name}"</div>
                <div class="import-actions">
                    <div class="radio-group">
                        <label>
                            <input type="radio" name="trifle-action-${index}" value="import" checked data-index="${index}">
                            Import
                        </label>
                        <label>
                            <input type="radio" name="trifle-action-${index}" value="skip" data-index="${index}">
                            Skip
                        </label>
                    </div>
                    <div class="comparison">
                        <div class="comparison-row">
                            <span class="comparison-label">Imported:</span>
                            <span class="comparison-value">${fileCount} ${fileCount === 1 ? 'file' : 'files'} (new)</span>
                        </div>
                    </div>
                    <div class="recommended">→ Recommended: Import ✓</div>
                </div>
            </div>
        `;
    } else {
        // Conflicting trifle
        const importedFileCount = rec.imported.data.files?.length || 0;
        const localFileCount = rec.local.data.files?.length || 0;

        return `
            <div class="item-info">
                <div class="item-name">Trifle: "${rec.name}"</div>
                <div class="import-actions">
                    <div class="radio-group">
                        <label>
                            <input type="radio" name="trifle-action-${index}" value="overwrite" ${rec.action === 'overwrite' ? 'checked' : ''} data-index="${index}">
                            Overwrite
                        </label>
                        <label>
                            <input type="radio" name="trifle-action-${index}" value="rename" ${rec.action === 'rename' ? 'checked' : ''} data-index="${index}">
                            Rename
                        </label>
                        <label>
                            <input type="radio" name="trifle-action-${index}" value="skip" ${rec.action === 'skip' ? 'checked' : ''} data-index="${index}">
                            Skip
                        </label>
                    </div>
                    <div class="comparison">
                        <div class="comparison-row">
                            <span class="comparison-label">Imported:</span>
                            <span class="comparison-value">${importedFileCount} ${importedFileCount === 1 ? 'file' : 'files'} (modified ${formatTimeAgo(rec.imported.last_modified)})</span>
                        </div>
                        <div class="comparison-row">
                            <span class="comparison-label">Local:</span>
                            <span class="comparison-value">${localFileCount} ${localFileCount === 1 ? 'file' : 'files'} (modified ${formatTimeAgo(rec.local.last_modified)})</span>
                        </div>
                    </div>
                    <div class="recommended">→ Recommended: ${rec.action.charAt(0).toUpperCase() + rec.action.slice(1)} ${rec.action !== 'skip' ? '✓' : ''}</div>
                </div>
            </div>
        `;
    }
}

/**
 * Apply import with selected items and actions
 */
async function applyImport() {
    try {
        const radioGroups = document.querySelectorAll('input[type="radio"]:checked');

        // Update recommendations with current radio selections
        radioGroups.forEach(radio => {
            const index = parseInt(radio.dataset.index);
            if (importRecommendations[index]) {
                importRecommendations[index].action = radio.value;
            }
        });

        // Filter items where action is not "skip"
        const selectedItems = importRecommendations.filter(rec => rec.action !== 'skip');

        if (selectedItems.length === 0) {
            showError('No items to import. All items are set to skip.');
            return;
        }

        let importedCount = 0;

        // Import profile
        const profileItem = selectedItems.find(item => item.type === 'profile');
        if (profileItem && profileItem.action === 'import') {
            await TrifleDB.updateUser(currentUser.id, profileItem.imported.data);
            importedCount++;
        }

        // Import trifles
        const trifleItems = selectedItems.filter(item => item.type === 'trifle' && item.action !== 'skip');

        for (const item of trifleItems) {
            // Store file contents first
            for (const [hash, content] of Object.entries(item.imported.file_contents)) {
                await TrifleDB.storeContent(content, 'file');
            }

            if (item.action === 'import' || item.action === 'overwrite') {
                // Import or overwrite
                if (item.local) {
                    // Update existing
                    await TrifleDB.updateTrifle(item.id, item.imported.data);
                } else {
                    // Create new - need to recreate the trifle pointer
                    const hash = await TrifleDB.storeContent(item.imported.data, 'trifle');
                    const db = await TrifleDB.initDB();

                    const trifle = {
                        id: item.id,
                        owner_id: currentUser.id,
                        current_hash: hash,
                        last_modified: item.imported.last_modified,
                        logical_clock: item.imported.logical_clock
                    };

                    await new Promise((resolve, reject) => {
                        const tx = db.transaction(['trifles'], 'readwrite');
                        const store = tx.objectStore('trifles');
                        store.add(trifle);
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                    });
                }
                importedCount++;
            } else if (item.action === 'rename') {
                // Create with new ID and renamed
                const newId = TrifleDB.generateId('trifle');
                const renamedData = {
                    ...item.imported.data,
                    name: `${item.imported.data.name} (imported)`
                };

                const hash = await TrifleDB.storeContent(renamedData, 'trifle');
                const db = await TrifleDB.initDB();

                const trifle = {
                    id: newId,
                    owner_id: currentUser.id,
                    current_hash: hash,
                    last_modified: Date.now(),
                    logical_clock: 1
                };

                await new Promise((resolve, reject) => {
                    const tx = db.transaction(['trifles'], 'readwrite');
                    const store = tx.objectStore('trifles');
                    store.add(trifle);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
                importedCount++;
            }
        }

        showSuccess(`Successfully imported ${importedCount} ${importedCount === 1 ? 'item' : 'items'}!`, 3000);

        // Redirect to home after short delay
        setTimeout(() => {
            window.location.href = '/';
        }, 1500);

    } catch (error) {
        console.error('Import failed:', error);
        showError('Failed to import data. Please try again.');
    }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Export buttons
    const selectAllExport = document.getElementById('selectAllExport');
    const selectNoneExport = document.getElementById('selectNoneExport');
    const exportBtn = document.getElementById('exportBtn');

    if (selectAllExport) {
        selectAllExport.addEventListener('click', () => {
            document.querySelectorAll('#exportList input[type="checkbox"]').forEach(cb => cb.checked = true);
            updateExportButtonState();
        });
    }

    if (selectNoneExport) {
        selectNoneExport.addEventListener('click', () => {
            document.querySelectorAll('#exportList input[type="checkbox"]').forEach(cb => cb.checked = false);
            updateExportButtonState();
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', exportSelected);
    }

    // Import file input and button
    const importFile = document.getElementById('importFile');
    const chooseFileBtn = document.getElementById('chooseFileBtn');

    if (chooseFileBtn && importFile) {
        chooseFileBtn.addEventListener('click', () => {
            importFile.click();
        });
    }

    if (importFile) {
        importFile.addEventListener('change', handleImportFile);
    }

    // Import buttons (set up after review section is shown)
    const importAll = document.getElementById('importAll');
    const skipAll = document.getElementById('skipAll');
    const useRecommendations = document.getElementById('useRecommendations');
    const importBtn = document.getElementById('importBtn');
    const cancelImportBtn = document.getElementById('cancelImportBtn');

    if (importAll) {
        importAll.addEventListener('click', () => {
            // Set all radios to import/overwrite (first non-skip option)
            importRecommendations.forEach((rec, index) => {
                const radios = document.querySelectorAll(`input[name="${rec.type}-action-${index}"]`);
                radios.forEach(radio => {
                    if (radio.value !== 'skip') {
                        radio.checked = true;
                        return;
                    }
                });
            });
        });
    }

    if (skipAll) {
        skipAll.addEventListener('click', () => {
            // Set all radios to skip
            importRecommendations.forEach((rec, index) => {
                const radios = document.querySelectorAll(`input[name="${rec.type}-action-${index}"]`);
                radios.forEach(radio => {
                    if (radio.value === 'skip') {
                        radio.checked = true;
                    }
                });
            });
        });
    }

    if (useRecommendations) {
        useRecommendations.addEventListener('click', () => {
            // Reset all to recommended state (stored in each recommendation)
            importRecommendations.forEach((rec, index) => {
                const radios = document.querySelectorAll(`input[name="${rec.type}-action-${index}"]`);

                // Recalculate recommendation
                let recommendedAction = rec.action;
                if (rec.type === 'profile' && rec.conflict) {
                    recommendedAction = analyzeProfileConflict(rec.imported, rec.local).action;
                } else if (rec.type === 'trifle' && rec.conflict) {
                    recommendedAction = analyzeTrifleConflict(rec.imported, rec.local).action;
                } else if (rec.type === 'trifle' && !rec.conflict) {
                    recommendedAction = 'import';
                }

                radios.forEach(radio => {
                    radio.checked = radio.value === recommendedAction;
                });
            });
        });
    }

    if (cancelImportBtn) {
        cancelImportBtn.addEventListener('click', () => {
            // Hide review section and reset
            const reviewSection = document.getElementById('reviewSection');
            if (reviewSection) {
                reviewSection.classList.add('hidden');
            }
            importData = null;
            importRecommendations = [];

            // Reset file input
            const importFile = document.getElementById('importFile');
            if (importFile) {
                importFile.value = '';
            }
        });
    }

    if (importBtn) {
        importBtn.addEventListener('click', applyImport);
    }

    // Radio button changes update recommendations
    document.addEventListener('change', (e) => {
        if (e.target.type === 'radio' && e.target.dataset.index !== undefined) {
            const index = parseInt(e.target.dataset.index);
            if (importRecommendations[index]) {
                importRecommendations[index].action = e.target.value;
            }
        }
    });
}

/**
 * Format timestamp as relative time
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

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
