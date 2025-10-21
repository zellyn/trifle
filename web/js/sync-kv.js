// Trifling Sync - KV-based sync using new simplified API
import { TrifleDB } from './db.js';

const SYNC_STATUS_KEY = 'trifling_sync_status';

// SyncManager handles bidirectional sync using KV API
export const SyncManager = {
    // Check if user is logged in (has session cookie)
    async isLoggedIn() {
        try {
            const email = await this.getUserEmail();
            return email !== null;
        } catch {
            return false;
        }
    },

    // Get current user's email from session
    async getUserEmail() {
        try {
            const response = await fetch('/api/whoami');
            if (!response.ok) {
                return null;
            }
            const data = await response.json();
            return data.email;
        } catch {
            return null;
        }
    },

    // Get sync status from localStorage
    getSyncStatus() {
        const stored = localStorage.getItem(SYNC_STATUS_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
        return {
            lastSync: null,
            synced: false,
            email: null
        };
    },

    // Update sync status
    setSyncStatus(status) {
        localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
    },

    // Full sync: bidirectional sync between client and server
    async sync() {
        const loggedIn = await this.isLoggedIn();
        if (!loggedIn) {
            return {
                success: false,
                error: 'Not logged in'
            };
        }

        try {
            // Get local user
            const localUser = await TrifleDB.getCurrentUser();
            if (!localUser) {
                return { success: false, error: 'No local user' };
            }

            const localUserData = await TrifleDB.getUserData(localUser.id);
            const email = await this.getUserEmail();

            if (!email) {
                return { success: false, error: 'No email found' };
            }

            console.log('[Sync] Starting sync for', email);

            // Step 1: Sync user profile
            await this.syncUserProfile(email, localUser, localUserData);

            // Step 2: Sync all trifles
            const localTrifles = await TrifleDB.getTriflesByOwner(localUser.id);
            await this.syncTrifles(email, localTrifles);

            // Update sync status
            this.setSyncStatus({
                lastSync: Date.now(),
                synced: true,
                email: email
            });

            console.log('[Sync] Sync completed successfully');
            return { success: true };

        } catch (error) {
            console.error('[Sync] Sync failed:', error);
            return { success: false, error: error.message };
        }
    },

    // Sync user profile
    async syncUserProfile(email, localUser, localUserData) {
        const profileKey = `user/${email}/profile`;

        try {
            // Include metadata in profile for comparison
            const localProfileWithMeta = {
                ...localUserData,
                logical_clock: localUser.logical_clock,
                last_modified: localUser.last_modified
            };

            // Try to get server profile
            const serverProfile = await this.kvGet(profileKey);

            if (serverProfile) {
                // Server has profile - compare clocks
                const serverClock = serverProfile.logical_clock || 0;

                if (localUser.logical_clock > serverClock) {
                    // Local is newer (user re-rolled name or changed settings) - upload
                    await this.kvPut(profileKey, localProfileWithMeta);
                    console.log('[Sync] Uploaded user profile (local changes)');
                } else {
                    // Server version is authoritative - download
                    await TrifleDB.updateUser(localUser.id, serverProfile);
                    console.log('[Sync] Downloaded user profile from server');
                }
            } else {
                // Profile doesn't exist on server - upload
                await this.kvPut(profileKey, localProfileWithMeta);
                console.log('[Sync] Uploaded new user profile');
            }
        } catch (error) {
            console.error('[Sync] Failed to sync user profile:', error);
            throw error;
        }
    },

    // Sync all trifles
    async syncTrifles(email, localTrifles) {
        // List server's latest trifle pointers
        const latestPrefix = `user/${email}/trifle/latest/`;
        const serverLatest = await this.kvList(latestPrefix, 2);

        // Parse server latest: ["user/{email}/trifle/latest/{trifle_id}/{version_id}", ...]
        const serverTriflesMap = new Map();
        for (const key of serverLatest) {
            const parts = key.split('/');
            if (parts.length >= 6) {
                const trifleID = parts[4];
                const versionID = parts[5];
                serverTriflesMap.set(trifleID, versionID);
            }
        }

        // Compare local vs server
        const localTriflesMap = new Map(localTrifles.map(t => [t.id, t]));

        // Upload local trifles
        for (const localTrifle of localTrifles) {
            const serverVersionID = serverTriflesMap.get(localTrifle.id);

            if (!serverVersionID) {
                // New local trifle - upload
                await this.uploadTrifle(email, localTrifle);
            } else {
                // Trifle exists on server - check if we need to update
                const serverVersion = await this.getTrifleVersion(email, serverVersionID);

                if (serverVersion && localTrifle.logical_clock > serverVersion.logical_clock) {
                    // Local is newer - upload
                    await this.uploadTrifle(email, localTrifle);
                } else if (serverVersion && localTrifle.logical_clock < serverVersion.logical_clock) {
                    // Server is newer - download
                    await this.downloadTrifle(localTrifle.id, serverVersion);
                }
            }
        }

        // Download server trifles not in local
        for (const [trifleID, versionID] of serverTriflesMap) {
            if (!localTriflesMap.has(trifleID)) {
                const serverVersion = await this.getTrifleVersion(email, versionID);
                if (serverVersion) {
                    await this.downloadTrifle(trifleID, serverVersion);
                }
            }
        }
    },

    // Upload a trifle to server
    async uploadTrifle(email, trifle) {
        console.log('[Sync] Uploading trifle:', trifle.id);

        // Get trifle data
        const trifleData = await TrifleDB.getTrifleData(trifle.id);

        // Create version ID from trifle hash
        const versionID = `version_${trifle.current_hash.substring(0, 16)}`;

        // Upload version data
        const versionKey = `user/${email}/trifle/version/${versionID}`;
        const versionData = {
            trifle_id: trifle.id,
            name: trifleData.name,
            description: trifleData.description,
            logical_clock: trifle.logical_clock,
            last_modified: trifle.last_modified,
            files: trifleData.files || []
        };

        await this.kvPut(versionKey, versionData);

        // Upload file contents
        if (trifleData.files) {
            for (const file of trifleData.files) {
                const fileContent = await TrifleDB.getContent(file.hash);
                if (fileContent !== null) {
                    const fileKey = `file/${file.hash.substring(0, 2)}/${file.hash.substring(2, 4)}/${file.hash}`;
                    // Files are stored as raw strings
                    await this.kvPutRaw(fileKey, fileContent);
                }
            }
        }

        // Update latest pointer
        const latestKey = `user/${email}/trifle/latest/${trifle.id}/${versionID}`;
        await this.kvPutRaw(latestKey, ''); // Empty value

        console.log('[Sync] Uploaded trifle successfully');
    },

    // Download a trifle from server
    async downloadTrifle(trifleID, versionData) {
        console.log('[Sync] Downloading trifle:', trifleID);

        // Download file contents
        if (versionData.files) {
            for (const file of versionData.files) {
                const fileKey = `file/${file.hash.substring(0, 2)}/${file.hash.substring(2, 4)}/${file.hash}`;
                const content = await this.kvGetRaw(fileKey);
                if (content !== null) {
                    await TrifleDB.storeContent(content, 'file');
                }
            }
        }

        // Create/update trifle in IndexedDB
        const trifleData = {
            name: versionData.name,
            description: versionData.description,
            files: versionData.files || []
        };

        const existingTrifle = await TrifleDB.getTrifle(trifleID);

        if (existingTrifle) {
            // Update existing
            await TrifleDB.updateTrifle(trifleID, trifleData);
        } else {
            // Create new trifle using TrifleDB.createTrifle
            const localUser = await TrifleDB.getCurrentUser();

            // Store the trifle data first
            await TrifleDB.storeContent(trifleData, 'trifle');
            const hash = await TrifleDB.computeHash(trifleData);

            // Manually insert the trifle pointer (since we need specific ID and metadata)
            const db = await TrifleDB.initDB();
            const tx = db.transaction(['trifles'], 'readwrite');
            const store = tx.objectStore('trifles');

            const newTrifle = {
                id: trifleID,
                owner_id: localUser.id,
                current_hash: hash,
                last_modified: versionData.last_modified,
                logical_clock: versionData.logical_clock
            };

            store.put(newTrifle);
            await tx.complete;
        }

        console.log('[Sync] Downloaded trifle successfully');
    },

    // Get trifle version data
    async getTrifleVersion(email, versionID) {
        const versionKey = `user/${email}/trifle/version/${versionID}`;
        return await this.kvGet(versionKey);
    },

    // KV API helpers
    async kvGet(key) {
        try {
            const response = await fetch(`/kv/${key}`);
            if (response.status === 404) {
                return null;
            }
            if (!response.ok) {
                throw new Error(`KV GET failed: ${response.status}`);
            }
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        } catch (error) {
            console.error('[Sync] KV GET error:', key, error);
            throw error;
        }
    },

    async kvGetRaw(key) {
        try {
            const response = await fetch(`/kv/${key}`);
            if (response.status === 404) {
                return null;
            }
            if (!response.ok) {
                throw new Error(`KV GET failed: ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            console.error('[Sync] KV GET RAW error:', key, error);
            throw error;
        }
    },

    async kvPut(key, value) {
        try {
            const response = await fetch(`/kv/${key}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(value)
            });
            if (!response.ok) {
                throw new Error(`KV PUT failed: ${response.status}`);
            }
        } catch (error) {
            console.error('[Sync] KV PUT error:', key, error);
            throw error;
        }
    },

    async kvPutRaw(key, value) {
        try {
            const response = await fetch(`/kv/${key}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'text/plain' },
                body: value
            });
            if (!response.ok) {
                throw new Error(`KV PUT failed: ${response.status}`);
            }
        } catch (error) {
            console.error('[Sync] KV PUT RAW error:', key, error);
            throw error;
        }
    },

    async kvList(prefix, depth = 1) {
        try {
            const response = await fetch(`/kvlist/${prefix}?depth=${depth}`);
            if (!response.ok) {
                throw new Error(`KV LIST failed: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('[Sync] KV LIST error:', prefix, error);
            throw error;
        }
    }
};
