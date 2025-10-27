// Trifling Sync - KV-based sync using new simplified API
import { TrifleDB } from './db.js';

const SYNC_STATUS_KEY = 'trifling_sync_status';

// SyncManager handles bidirectional sync using KV API
export const SyncManager = {
    _syncInProgress: false,

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

    // Parse email into domain and localpart
    parseEmail(email) {
        const lastAt = email.lastIndexOf('@');
        if (lastAt === -1) {
            throw new Error(`Invalid email format: ${email}`);
        }
        return {
            localpart: email.substring(0, lastAt),
            domain: email.substring(lastAt + 1)
        };
    },

    // Get user key prefix (new format)
    getUserPrefix(email) {
        const { domain, localpart } = this.parseEmail(email);
        return `domain/${domain}/user/${localpart}`;
    },

    // Get old user key prefix (for migration)
    getOldUserPrefix(email) {
        return `user/${email}`;
    },

    // Migrate from old key format to new format
    async migrateToNewFormat(email) {
        const oldPrefix = this.getOldUserPrefix(email);
        const newPrefix = this.getUserPrefix(email);

        console.log(`[Sync] Checking for migration from ${oldPrefix} to ${newPrefix}`);

        // Check if old format exists
        const oldProfileKey = `${oldPrefix}/profile`;
        const oldProfile = await this.kvGet(oldProfileKey);

        if (!oldProfile) {
            console.log('[Sync] No old format data found, skipping migration');
            return;
        }

        console.log('[Sync] Found old format data, starting migration');

        try {
            // Migrate profile
            const newProfileKey = `${newPrefix}/profile`;
            await this.kvPut(newProfileKey, oldProfile);
            console.log('[Sync] Migrated profile');

            // List all old trifle data
            const oldLatestPrefix = `${oldPrefix}/trifle/latest/`;
            const oldLatestKeys = await this.kvList(oldLatestPrefix, 2);

            // Migrate each trifle's latest pointer and version data
            for (const oldLatestKey of oldLatestKeys) {
                // Parse: user/{email}/trifle/latest/{trifle_id}/{version_id}
                const parts = oldLatestKey.split('/');
                if (parts.length >= 6) {
                    const trifleID = parts[4];
                    const versionID = parts[5];

                    // Migrate latest pointer
                    const newLatestKey = `${newPrefix}/trifle/latest/${trifleID}/${versionID}`;
                    await this.kvPutRaw(newLatestKey, '');
                    console.log(`[Sync] Migrated latest pointer for trifle ${trifleID}`);

                    // Migrate version data
                    const oldVersionKey = `${oldPrefix}/trifle/version/${versionID}`;
                    const versionData = await this.kvGet(oldVersionKey);
                    if (versionData) {
                        const newVersionKey = `${newPrefix}/trifle/version/${versionID}`;
                        await this.kvPut(newVersionKey, versionData);
                        console.log(`[Sync] Migrated version data for ${versionID}`);
                    }
                }
            }

            // Verify migration by checking all new keys exist
            const newProfile = await this.kvGet(newProfileKey);
            if (!newProfile) {
                throw new Error('Migration verification failed: profile not found at new location');
            }

            // Verify each trifle was migrated
            for (const oldLatestKey of oldLatestKeys) {
                const parts = oldLatestKey.split('/');
                if (parts.length >= 6) {
                    const versionID = parts[5];
                    const newVersionKey = `${newPrefix}/trifle/version/${versionID}`;
                    const verified = await this.kvGet(newVersionKey);
                    if (!verified) {
                        throw new Error(`Migration verification failed: trifle ${versionID} not found at new location`);
                    }
                }
            }

            // Delete old keys
            console.log('[Sync] Verifying migration successful, deleting old keys');
            await this.kvDelete(oldProfileKey);

            for (const oldLatestKey of oldLatestKeys) {
                const parts = oldLatestKey.split('/');
                if (parts.length >= 6) {
                    const versionID = parts[5];
                    const oldVersionKey = `${oldPrefix}/trifle/version/${versionID}`;
                    await this.kvDelete(oldLatestKey);
                    await this.kvDelete(oldVersionKey);
                }
            }

            console.log('[Sync] Migration completed successfully');

        } catch (error) {
            console.error('[Sync] Migration failed:', error);
            throw new Error(`Migration failed: ${error.message}`);
        }
    },

    // Full sync: bidirectional sync between client and server
    async sync() {
        // Prevent concurrent syncs
        if (this._syncInProgress) {
            console.log('[Sync] Sync already in progress, skipping');
            return {
                success: false,
                error: 'Sync already in progress'
            };
        }

        const loggedIn = await this.isLoggedIn();
        if (!loggedIn) {
            return {
                success: false,
                error: 'Not logged in'
            };
        }

        this._syncInProgress = true;
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

            // Step 0: Check for and perform migration if needed
            await this.migrateToNewFormat(email);

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
        } finally {
            this._syncInProgress = false;
        }
    },

    // Sync user profile
    async syncUserProfile(email, localUser, localUserData) {
        const userPrefix = this.getUserPrefix(email);
        const profileKey = `${userPrefix}/profile`;

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
        const userPrefix = this.getUserPrefix(email);
        const latestPrefix = `${userPrefix}/trifle/latest/`;
        const serverLatest = await this.kvList(latestPrefix, 2);

        // Parse server latest: ["domain/{domain}/user/{localpart}/trifle/latest/{trifle_id}/{version_id}", ...]
        const serverTriflesMap = new Map();
        for (const key of serverLatest) {
            const parts = key.split('/');
            if (parts.length >= 8) {
                const trifleID = parts[6];
                const versionID = parts[7];
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

        const userPrefix = this.getUserPrefix(email);

        // Get trifle data
        const trifleData = await TrifleDB.getTrifleData(trifle.id);

        // Create version ID from trifle hash
        const versionID = `version_${trifle.current_hash.substring(0, 16)}`;

        // Upload version data
        const versionKey = `${userPrefix}/trifle/version/${versionID}`;
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
        const latestKey = `${userPrefix}/trifle/latest/${trifle.id}/${versionID}`;
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
        const userPrefix = this.getUserPrefix(email);
        const versionKey = `${userPrefix}/trifle/version/${versionID}`;
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
    },

    async kvDelete(key) {
        try {
            const response = await fetch(`/kv/${key}`, {
                method: 'DELETE'
            });
            if (!response.ok && response.status !== 404) {
                throw new Error(`KV DELETE failed: ${response.status}`);
            }
        } catch (error) {
            console.error('[Sync] KV DELETE error:', key, error);
            throw error;
        }
    }
};
