# **Backup To Folder**

Backup your files quickly in VS Code, so you can swap versions more easily.

Features:
- Backup the open file (with a label or default to a date)
- Restore from a list of backups of the open file
- Right-click a file or group of files in the Explorer to backup
- Backup/Restore snippets from the open file
- Zip a backup of the whole project workspace
- Clean old backups after a cutoff
  
More:
- Set a backup folder (default: `workspace_root/backups`)
- Backups are tied their workspace, but can be exported
- Include a description for a backup file which appears as a comment in the top line.
- Toggle backups folder from gitignore

---

## **Command**
1. **Set Backup Directory**: Set or update your backup folder.
2. **Backup To Folder**: Backup the current open file with title and description.
3. **Backup To Folder from Explorer**: Right-click a file in the Explorer and select "Backup File."
4. **Snippet Backup** : Saves a snippet of the current selection
5. **Restore Snippet** : Provides a list of snippets from the open file to restore
6. **Restore Backup** : Restore to open file from a list
7. **Backup Project To Folder**: Backup to {backup_folder}/projects
8.  **Export Backups**: Copy the backups folder to another location on disk
9.   **Clear Old Backups**: Set a date or file cutoff to clean up the backups folder
9.   **Toggle Backups From gitignore**: Add or remove backups folder from .gitignore

---

Random Notes:

Todo:
Show only the snippet not full file name when restoring snippet
Figure out better names for the commands so they dont interfere with eachother on the cmd prompt
Maybe put time since backup when we do the restoring


Working on auto backup feature...?

The following systems work but could use more work:
(a)Restore from Backup
  Keep a registry of past names if file names change
  Duplicate the overwritten version into a trash directory (todo: toggle this feature)
(a)Full Workspace or batch Backup - compression
(a)Toggle backup to .gitignore

Todo:
Some quick backup idea?
Extension Settings Panel
Auto-Backup on Save
Configure default backup name - extend date format to time maybe
Setup automatic backups?
Multi-File Backup from Explorer
Compare with Backup
Backup Directory Size Viewer
Backup File Rename
CLear 	•	Add a dry-run mode to show the user which files would be deleted before confirming the cleanup.
Version History Viewer
	•	Provide a timeline view of all backups for a file with metadata (e.g., dates, descriptions, sizes).
	•	Allow users to browse through and restore any version from the history.
---------------
| named    
---------------
| unnamed