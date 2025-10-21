# Phase 1 & 2 Testing Guide

## Server Running
✅ Simple HTTP server: `cd web && python3 -m http.server 8080`
   → http://localhost:8080/

## Test 1: Basic Smoke Test (Does it load at all?)

### Open http://localhost:8080/

**Expected:**
- [x] Page loads without errors
- [x] Console has no red errors (open DevTools with F12)
- [x] You see a profile section with a random name (e.g., "dapper-panda")
- [x] You see "No trifles yet" empty state
- [x] "Create Your First Trifle" button is visible

**If this fails:** Something is broken in the basic IndexedDB setup

---

## Test 2: Create First Trifle

### Click "Create Your First Trifle"

**Expected:**
- [x] Navigates to `/editor.html?id=trifle_...`
- [x] Editor loads with "Untitled Trifle" as title
- [x] File tree shows `main.py`
- [x] Editor shows default code: `# Welcome to Trifle!\nprint("Hello, world!")\n`
- [x] No errors in console

**If this fails:** Problem with createTrifle() or editor loading from IndexedDB

---

## Test 3: Run "Hello, world!"

### Click the "Run" button

**Expected:**
- [x] Loading overlay shows "Loading Pyodide..."
- [x] After 5-10 seconds, output appears
- [x] Output shows: `Hello, world!`
- [x] No errors in console

**If this fails:** Pyodide issue or worker problem

---

## Test 4: Edit and Save

### Change the code to `print("Test!")` and wait 1 second

**Expected:**
- [x] "Saving..." indicator appears briefly
- [x] "Saved ✓" indicator appears
- [x] No errors in console

**If this fails:** saveCurrentFile() IndexedDB issue

---

## Test 5: Go Back to Home

### Click "← Back" in top-left

**Expected:**
- [x] Returns to index.html
- [x] Now shows 1 trifle card
- [x] Trifle shows "Untitled Trifle"
- [x] Shows "1 file"
- [x] Shows "just now" or "X minutes ago"

**If this fails:** getTriflesByOwner() or UI rendering issue

---

## Test 6: Re-roll Name

### Click "Re-roll name" button

**Expected:**
- [x] Name changes to a new random name (e.g., "jolly-tiger")
- [x] No errors in console

**If this fails:** updateUser() IndexedDB issue

---

## Test 7: Rename Trifle

### Click on "Untitled Trifle" in the trifle card to open it
### Click on the title "Untitled Trifle" in the editor header

**Expected:**
- [x] Title becomes an input field
- [x] Can type new name
- [x] Press Enter or click away
- [x] Title updates
- [x] Page title updates to "NewName - Trifle"

**If this fails:** editTrifleTitle() IndexedDB issue

---

## Test 8: Refresh Page (Persistence Check)

### Refresh the browser (F5 or Cmd+R)

**Expected:**
- [x] Page reloads
- [x] Same user name shows
- [x] Same trifle(s) show
- [x] Opening trifle shows your edited code

**If this fails:** IndexedDB persistence problem

---

## Test 9: Create File from Python

### In editor, change code to:
```python
with open('test.txt', 'w') as f:
    f.write('Hello from Python!')

with open('test.txt', 'r') as f:
    print(f.read())
```

### Click Run

**Expected:**
- [x] Output shows: `Hello from Python!`
- [x] File tree shows `test.txt` after execution
- [x] Can click on `test.txt` to view contents

**If this fails:** syncFilesFromWorker() IndexedDB issue

---

## Console Check

Throughout testing, check browser console (F12 → Console tab):
- [x] No red errors
- [x] Only expected logs (if any)

## IndexedDB Check

F12 → Application tab → IndexedDB → trifle:
- [x] Database exists
- [x] Has tables: users, trifles, content, versions
- [x] Can inspect data

---

## If Everything Passes ✅

Phase 1 (local-first) is working! All IndexedDB operations are functional.

## Common Issues

**"Cannot read property 'getTrifle' of undefined"**
→ TrifleDB not imported correctly or db.js not loading

**"Failed to execute 'transaction' on 'IDBDatabase'"**
→ IndexedDB schema issue or browser doesn't support IndexedDB

**Editor loads but trifle data blank**
→ getTrifleData() returning null, check content hash exists

**Files don't persist after refresh**
→ updateTrifle() not being called or transaction failing
