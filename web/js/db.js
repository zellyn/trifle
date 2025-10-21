// IndexedDB abstraction for Trifle
// Content-addressable storage with SHA-256 hashing
// See PLAN.md for full architecture

/**
 * Database schema version
 * Increment when schema changes
 */
const DB_VERSION = 1;
const DB_NAME = 'trifle';

/**
 * Database instance (initialized on first use)
 */
let db = null;

/**
 * Initialize IndexedDB with schema
 * Creates object stores: users, trifles, content, versions
 *
 * @returns {Promise<IDBDatabase>}
 */
async function initDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Users store: {id, email, current_hash, last_modified, logical_clock}
            if (!db.objectStoreNames.contains('users')) {
                const userStore = db.createObjectStore('users', { keyPath: 'id' });
                userStore.createIndex('email', 'email', { unique: false }); // null for anonymous
            }

            // Trifles store: {id, owner_id, current_hash, last_modified, logical_clock}
            if (!db.objectStoreNames.contains('trifles')) {
                const trifleStore = db.createObjectStore('trifles', { keyPath: 'id' });
                trifleStore.createIndex('owner_id', 'owner_id', { unique: false });
            }

            // Content store: {hash, data, type}
            // hash = SHA-256 of content
            // data = actual blob (JSON object or string)
            // type = 'user' | 'trifle' | 'file'
            if (!db.objectStoreNames.contains('content')) {
                db.createObjectStore('content', { keyPath: 'hash' });
            }

            // Versions store: {id, trifle_id, hash, timestamp, label}
            // label = 'session' | 'checkpoint'
            if (!db.objectStoreNames.contains('versions')) {
                const versionStore = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
                versionStore.createIndex('trifle_id', 'trifle_id', { unique: false });
            }
        };
    });
}

/**
 * Generate random ID with prefix
 *
 * @param {string} prefix - ID prefix (e.g., 'user', 'trifle')
 * @param {number} length - Number of hex characters (default 12)
 * @returns {string} - Prefixed random ID (e.g., 'user_a3f9c2b8e1d4')
 */
function generateId(prefix, length = 12) {
    const array = new Uint8Array(length / 2);
    crypto.getRandomValues(array);
    const hex = Array.from(array)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return `${prefix}_${hex}`;
}

/**
 * Canonical JSON stringifier - sorts object keys recursively for deterministic hashing
 *
 * @param {any} obj - Object to stringify
 * @returns {string} - Canonical JSON string
 */
function canonicalJSON(obj) {
    if (obj === null) return 'null';
    if (obj === undefined) return undefined;
    if (typeof obj !== 'object') return JSON.stringify(obj);

    // Handle arrays
    if (Array.isArray(obj)) {
        const items = obj.map(item => canonicalJSON(item));
        return '[' + items.join(',') + ']';
    }

    // Handle objects - sort keys
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(key => {
        const value = canonicalJSON(obj[key]);
        if (value === undefined) return undefined;
        return JSON.stringify(key) + ':' + value;
    }).filter(pair => pair !== undefined);

    return '{' + pairs.join(',') + '}';
}

/**
 * Compute SHA-256 hash of content
 *
 * @param {string|object} content - Content to hash (objects are canonicalized)
 * @returns {Promise<string>} - Hex-encoded SHA-256 hash
 */
async function computeHash(content) {
    // Convert to canonical string if object
    const text = typeof content === 'string' ? content : canonicalJSON(content);

    // Encode as UTF-8
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // Compute SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
}

/**
 * Store content blob by hash
 * Returns the hash (content-addressable storage)
 *
 * @param {any} data - Content to store
 * @param {string} type - Content type ('user' | 'trifle' | 'file')
 * @returns {Promise<string>} - Hash of stored content
 */
async function storeContent(data, type) {
    const db = await initDB();
    const hash = await computeHash(data);

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['content'], 'readwrite');
        const store = tx.objectStore('content');

        // Store: {hash, data, type}
        store.put({ hash, data, type });

        tx.oncomplete = () => resolve(hash);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Retrieve content blob by hash
 *
 * @param {string} hash - SHA-256 hash
 * @returns {Promise<any|null>} - Content data or null if not found
 */
async function getContent(hash) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['content'], 'readonly');
        const store = tx.objectStore('content');
        const request = store.get(hash);

        request.onsuccess = () => {
            const record = request.result;
            resolve(record ? record.data : null);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Create anonymous user with random ID and display name
 *
 * @param {string} displayName - User's display name
 * @returns {Promise<object>} - Created user object
 */
async function createUser(displayName) {
    const db = await initDB();
    const id = generateId('user');

    // User data blob
    const userData = {
        display_name: displayName,
        avatar: null,  // Can be designed later
        settings: {
            auto_sync: false,
            theme: 'dark',
            auto_save_interval: 60
        }
    };

    // Store user data blob
    const hash = await storeContent(userData, 'user');

    // Create user pointer
    const user = {
        id,
        email: null,  // Anonymous until they sign in
        current_hash: hash,
        last_modified: Date.now(),
        logical_clock: 1
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['users'], 'readwrite');
        const store = tx.objectStore('users');
        store.add(user);

        tx.oncomplete = () => resolve(user);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get user by ID
 *
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} - User object or null
 */
async function getUser(userId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['users'], 'readonly');
        const store = tx.objectStore('users');
        const request = store.get(userId);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get current user (assumes single user for now)
 * Returns first user in database, or null if none
 *
 * @returns {Promise<object|null>} - User object or null
 */
async function getCurrentUser() {
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['users'], 'readonly');
        const store = tx.objectStore('users');
        const request = store.openCursor();

        request.onsuccess = () => {
            const cursor = request.result;
            resolve(cursor ? cursor.value : null);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Update user data (creates new hash, updates pointer)
 *
 * @param {string} userId - User ID
 * @param {object} userData - New user data blob
 * @returns {Promise<object>} - Updated user object
 */
async function updateUser(userId, userData) {
    const db = await initDB();

    // Get current user
    const user = await getUser(userId);
    if (!user) throw new Error('User not found');

    // Store new user data blob
    const hash = await storeContent(userData, 'user');

    // Update user pointer
    user.current_hash = hash;
    user.last_modified = Date.now();
    user.logical_clock++;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['users'], 'readwrite');
        const store = tx.objectStore('users');
        store.put(user);

        tx.oncomplete = () => resolve(user);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get user data blob (by hash)
 *
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} - User data or null
 */
async function getUserData(userId) {
    const user = await getUser(userId);
    if (!user) return null;
    return await getContent(user.current_hash);
}

/**
 * Create new trifle
 *
 * @param {string} ownerId - User ID who owns this trifle
 * @param {string} name - Trifle name
 * @param {string} description - Trifle description
 * @returns {Promise<object>} - Created trifle object
 */
async function createTrifle(ownerId, name, description = '') {
    const db = await initDB();
    const id = generateId('trifle');

    // Create main.py file
    const mainPyContent = '# Welcome to Trifle!\nprint("Hello, world!")\n';
    const mainPyHash = await storeContent(mainPyContent, 'file');

    // Trifle data blob
    const trifleData = {
        name,
        description,
        files: [
            { path: 'main.py', hash: mainPyHash }
        ]
    };

    // Store trifle data blob
    const hash = await storeContent(trifleData, 'trifle');

    // Create trifle pointer
    const trifle = {
        id,
        owner_id: ownerId,
        current_hash: hash,
        last_modified: Date.now(),
        logical_clock: 1
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['trifles'], 'readwrite');
        const store = tx.objectStore('trifles');
        store.add(trifle);

        tx.oncomplete = () => resolve(trifle);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get trifle by ID
 *
 * @param {string} trifleId - Trifle ID
 * @returns {Promise<object|null>} - Trifle object or null
 */
async function getTrifle(trifleId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['trifles'], 'readonly');
        const store = tx.objectStore('trifles');
        const request = store.get(trifleId);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get trifle data blob (by hash)
 *
 * @param {string} trifleId - Trifle ID
 * @returns {Promise<object|null>} - Trifle data or null
 */
async function getTrifleData(trifleId) {
    const trifle = await getTrifle(trifleId);
    if (!trifle) return null;
    return await getContent(trifle.current_hash);
}

/**
 * Get all trifles for a user
 *
 * @param {string} ownerId - User ID
 * @returns {Promise<Array>} - Array of trifle objects
 */
async function getTriflesByOwner(ownerId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['trifles'], 'readonly');
        const store = tx.objectStore('trifles');
        const index = store.index('owner_id');
        const request = index.getAll(ownerId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Update trifle data (creates new hash, updates pointer)
 *
 * @param {string} trifleId - Trifle ID
 * @param {object} trifleData - New trifle data blob
 * @returns {Promise<object>} - Updated trifle object
 */
async function updateTrifle(trifleId, trifleData) {
    const db = await initDB();

    // Get current trifle
    const trifle = await getTrifle(trifleId);
    if (!trifle) throw new Error('Trifle not found');

    // Store new trifle data blob
    const hash = await storeContent(trifleData, 'trifle');

    // Update trifle pointer
    trifle.current_hash = hash;
    trifle.last_modified = Date.now();
    trifle.logical_clock++;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['trifles'], 'readwrite');
        const store = tx.objectStore('trifles');
        store.put(trifle);

        tx.oncomplete = () => resolve(trifle);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Delete trifle
 *
 * @param {string} trifleId - Trifle ID
 * @returns {Promise<void>}
 */
async function deleteTrifle(trifleId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['trifles', 'versions'], 'readwrite');

        // Delete trifle
        tx.objectStore('trifles').delete(trifleId);

        // Delete all versions for this trifle
        const versionStore = tx.objectStore('versions');
        const index = versionStore.index('trifle_id');
        const request = index.openCursor(IDBKeyRange.only(trifleId));

        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Create version snapshot
 *
 * @param {string} trifleId - Trifle ID
 * @param {string} hash - Content hash to snapshot
 * @param {string} label - 'session' or 'checkpoint'
 * @returns {Promise<object>} - Created version record
 */
async function createVersion(trifleId, hash, label = 'session') {
    const db = await initDB();

    const version = {
        trifle_id: trifleId,
        hash,
        timestamp: Date.now(),
        label
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['versions'], 'readwrite');
        const store = tx.objectStore('versions');
        const request = store.add(version);

        request.onsuccess = () => {
            version.id = request.result;
            resolve(version);
        };
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get all versions for a trifle
 *
 * @param {string} trifleId - Trifle ID
 * @returns {Promise<Array>} - Array of version records (newest first)
 */
async function getVersions(trifleId) {
    const db = await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['versions'], 'readonly');
        const store = tx.objectStore('versions');
        const index = store.index('trifle_id');
        const request = index.getAll(IDBKeyRange.only(trifleId));

        request.onsuccess = () => {
            // Sort newest first
            const versions = request.result.sort((a, b) => b.timestamp - a.timestamp);
            resolve(versions);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Clean up old versions (keep only last N session versions)
 *
 * @param {string} trifleId - Trifle ID
 * @param {number} keepCount - Number of versions to keep (default 10)
 * @returns {Promise<number>} - Number of versions deleted
 */
async function cleanupVersions(trifleId, keepCount = 10) {
    const db = await initDB();
    const versions = await getVersions(trifleId);

    // Filter to session versions only
    const sessionVersions = versions.filter(v => v.label === 'session');

    // Keep only the newest N
    const toDelete = sessionVersions.slice(keepCount);

    if (toDelete.length === 0) return 0;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['versions'], 'readwrite');
        const store = tx.objectStore('versions');

        toDelete.forEach(v => store.delete(v.id));

        tx.oncomplete = () => resolve(toDelete.length);
        tx.onerror = () => reject(tx.error);
    });
}

// Export API as ES6 module
export const TrifleDB = {
    // Initialization
    initDB,

    // Content storage
    storeContent,
    getContent,
    computeHash,

    // Users
    createUser,
    getUser,
    getCurrentUser,
    updateUser,
    getUserData,

    // Trifles
    createTrifle,
    getTrifle,
    getTrifleData,
    getTriflesByOwner,
    updateTrifle,
    deleteTrifle,

    // Versions
    createVersion,
    getVersions,
    cleanupVersions,

    // Utilities
    generateId
};
