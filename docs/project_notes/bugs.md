# Bug Log

## 2026-01-15 - SyncTeX File Missing (404 Error)
- **Issue**: Sync API returned 404 "SyncTeX file not found" even when server was running.
- **Root Cause**: Backend returns 404 if the `.synctex.gz` file is missing, which happens if compilation hasn't run or failed. Frontend displayed generic "API not found" message.
- **Solution**: Updated `App.tsx` to read the error body and display the specific "SyncTeX file not found" message. Ensured auto-compile runs on save.
- **Prevention**: Ensure LaTeX compiles successfully before attempting sync.

## 2026-01-18 - Sentence View Sync Drift
- **Issue**: Syncing from editor to PDF in Sentence Mode jumped to the wrong location after editing (adding lines).
- **Root Cause**: `MainEditor` relied on static `lineStart` metadata from the last load. Inserting text caused subsequent items' actual lines to shift, but metadata remained stale.
- **Solution**: Implemented `recalculateLines` helper in `handleContentUpdate` to update line numbers incrementally in memory.
- **Prevention**: Do not rely on static metadata for positions that shift during editing; calculate dynamically or update incrementally.

## 2026-01-18 - Focus Loss on Auto-Save
- **Issue**: Typing in Sentence Mode was interrupted (focus lost) when auto-save triggered.
- **Root Cause**: `handleSaveChanges` triggered a full `parseContent` and `setItems`, replacing all item objects. React unmounted/remounted inputs or lost strict identity match for `selectedItem`.
- **Solution**: Disabled `parseContent` in `handleSaveChanges`. Now trusts `handleContentUpdate` to maintain state accuracy.
- **Prevention**: Avoid full state replacement during active typing. Use incremental updates.
