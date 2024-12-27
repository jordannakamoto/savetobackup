import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';

import archiver from 'archiver';
import moment from 'moment';

let backupDirectory: string | undefined;
let backupWatcher: fs.FSWatcher | undefined;


export function activate(context: vscode.ExtensionContext) {

    // INIT
    // Initialize the backup directory to workspace root/backups if not configured
    const initializeBackupDirectory = () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;


        if (workspaceFolders) {
            const workspace = workspaceFolders[0]; // Get the first workspace folder
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const defaultBackupPath = path.join(workspaceRoot, 'backups');

            // Get the backup directory from the configuration
            backupDirectory = vscode.workspace
                .getConfiguration('savedToBackup')
                .get<string>('backupDirectory');

            if (!backupDirectory || !backupDirectory.startsWith(workspaceRoot)) {
                // If no backup directory is set or it's outside the workspace, use the default path
                backupDirectory = defaultBackupPath;

                // Save the default path to the workspace configuration
                vscode.workspace
                    .getConfiguration('savedToBackup')
                    .update('backupDirectory', backupDirectory, vscode.ConfigurationTarget.Workspace);
            }

            // Ensure the backup directory exists
            if (!fs.existsSync(backupDirectory)) {
                fs.mkdirSync(backupDirectory, { recursive: true });
                
            }
            watchBackupDirectory(context, workspace);

        } else {
            backupDirectory = undefined;

            vscode.window.showWarningMessage('No workspace is open. Backups require an open workspace.');
        }
    };
    
    // Run initialization when the extension activates
    initializeBackupDirectory();

    // Listen for workspace folder changes and reinitialize
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            initializeBackupDirectory();
        })
    );

    // * Configure Directory //
    const configureDirectory = vscode.commands.registerCommand('savedToBackup.configureDirectory', async () => {
        const dir = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true, // Allow folder selection
            canSelectMany: false,   // Only one folder at a time
            openLabel: 'Select Backup Directory' // Button label
        });
    
        if (dir && dir[0]) {
            backupDirectory = dir[0].fsPath; // Get the selected folder path
            await vscode.workspace.getConfiguration('savedToBackup').update('backupDirectory', backupDirectory, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage(`Backup directory set to ${backupDirectory}`);
    
            // Update .gitignore with the new backup directory
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const gitIgnorePath = path.join(workspaceRoot, '.gitignore');
                const relativeBackupPath = path.relative(workspaceRoot, backupDirectory).replace(/\\/g, '/') + '/';
    
                try {
                    // Ensure .gitignore exists or create it
                    if (!fs.existsSync(gitIgnorePath)) {
                        fs.writeFileSync(gitIgnorePath, `${relativeBackupPath}\n`, { encoding: 'utf8' });
                        vscode.window.showInformationMessage(`Created .gitignore and added ${relativeBackupPath}.`);
                    } else {
                        // Update .gitignore
                        const gitIgnoreContent = fs.readFileSync(gitIgnorePath, 'utf8');
                        const gitIgnoreLines = gitIgnoreContent.split('\n').map(line => line.trim());
    
                        if (!gitIgnoreLines.includes(relativeBackupPath)) {
                            fs.appendFileSync(gitIgnorePath, `${relativeBackupPath}\n`, { encoding: 'utf8' });
                            vscode.window.showInformationMessage(`Added ${relativeBackupPath} to .gitignore.`);
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to update .gitignore: ${errorMessage}`);
                }
            }
        } else {
            vscode.window.showWarningMessage('No directory selected for backup.');
        }
    });
    context.subscriptions.push(configureDirectory);
    

    // * Save File //
    const saveFile = vscode.commands.registerCommand('savedToBackup.saveFile', async (uri?: vscode.Uri) => {
        if (!backupDirectory) {
            vscode.window.showErrorMessage('Backup directory not configured, and no workspace root found.');
            return;
        }
    
        // Ensure the backup directory exists before proceeding
        if (!fs.existsSync(backupDirectory)) {
            try {
                fs.mkdirSync(backupDirectory, { recursive: true });
                vscode.window.showInformationMessage(`Backup directory recreated at ${backupDirectory}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to recreate backup directory: ${errorMessage}`);
                return;
            }
        }
    
        let document: vscode.TextDocument;
        let workspace: vscode.WorkspaceFolder | undefined; // Declare workspace here
    
        if (uri) {
            document = await vscode.workspace.openTextDocument(uri);
            workspace = vscode.workspace.getWorkspaceFolder(uri); // Get workspace from URI
        } else {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No file is open to save.');
                return;
            }
            document = editor.document;
            workspace = vscode.workspace.getWorkspaceFolder(document.uri); // Get workspace from document URI
        }
    
        if (!workspace) { // Check if workspace is defined
            vscode.window.showErrorMessage('File is not part of a workspace. Backups require an open workspace.');
            return;
        }
    
        const originalName = path.basename(document.fileName);
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext);
    
        const date = moment().format('MMMDD');
        const defaultAppendix = `${baseName}_${date}${ext}`;
    
        const appendix = await vscode.window.showInputBox({
            prompt: 'Enter a suffix for the backup file. Or leave blank for default',
        }) || date.toLowerCase();
    
        const backupFileName = `${baseName}_${appendix}${ext}`;
        const filePath = path.join(backupDirectory, backupFileName);
    
        updateRegistry(context, workspace, originalName, backupFileName, filePath); // Now workspace is defined
    
        const description = await vscode.window.showInputBox({
            prompt: 'Enter a description for the backup (optional)'
        });
    
        const content = document.getText();
        const langComment = getCommentSyntax(document.languageId);
        const comment = description ? `${langComment} ${description}\n\n` : '';
        const fileContent = `${comment}${content}`;
    
        try {
            fs.writeFileSync(filePath, fileContent, 'utf8');
            vscode.window.showInformationMessage(`File backed up as ${backupFileName} in ${backupDirectory}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to save backup: ${errorMessage}`);
        }
    });

    context.subscriptions.push(configureDirectory, saveFile);

    // * fromExplorer
    const backupFilesFromExplorer = vscode.commands.registerCommand(
        'savedToBackup.backupFilesFromExplorer',
        async (...args: any[]) => {
            console.log("Command triggered for backupFilesFromExplorer");
    
            if (!backupDirectory) {
                vscode.window.showErrorMessage('Backup directory not configured.');
                return;
            }
    
            // Ensure the backup directory exists
            try {
                if (!fs.existsSync(backupDirectory)) {
                    fs.mkdirSync(backupDirectory, { recursive: true });
                    vscode.window.showInformationMessage(`Backup directory recreated at ${backupDirectory}`);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to recreate backup directory: ${errorMessage}`);
                return;
            }
    
            // Handle single or multiple URIs
            const uris: vscode.Uri[] = args.flat();
            if (!uris || uris.length === 0) {
                vscode.window.showErrorMessage('No files or folders selected for backup.');
                return;
            }
    
            console.log("Detected URIs:", uris);
    
            for (const uri of uris) {
                console.log(`Processing URI: ${uri.fsPath}`);
    
                // Check if the item is part of the workspace
                const workspace = vscode.workspace.getWorkspaceFolder(uri);
                if (!workspace) {
                    vscode.window.showErrorMessage(`Item ${uri.fsPath} is not part of a workspace.`);
                    continue;
                }
    
                try {
                    const filePath = uri.fsPath;
                    const stats = fs.statSync(filePath);
    
                    if (stats.isFile()) {
                        console.log(`Backing up file: ${filePath}`);
                        await backupFile(uri, workspace);
                    } else if (stats.isDirectory()) {
                        console.log(`Processing directory: ${filePath}`);
                        const filesInDirectory = getAllFilesInDirectory(filePath);
                        console.log(`Directory contents: ${filesInDirectory}`);
                        for (const file of filesInDirectory) {
                            const fileUri = vscode.Uri.file(file);
                            await backupFile(fileUri, workspace);
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to process item ${uri.fsPath}: ${errorMessage}`);
                }
            }
    
            vscode.window.showInformationMessage(`Backups completed for ${uris.length - 1} item(s).`);
        }
    );
    
    async function backupFile(uri: vscode.Uri, workspace: vscode.WorkspaceFolder) {
        try {
            console.log(`Backing up file: ${uri.fsPath}`);
            const document = await vscode.workspace.openTextDocument(uri);
            const originalName = path.basename(document.fileName);
            const ext = path.extname(originalName);
            const baseName = path.basename(originalName, ext);
            const timestamp = moment().format('MMMDD_hmma').toLowerCase();
            const backupFileName = `${baseName}_${timestamp}${ext}`;
            const filePath = path.join(backupDirectory!, backupFileName);
    
            const content = document.getText();
            const fileContent = `${content}`;
    
            // Write the file
            fs.writeFileSync(filePath, fileContent, 'utf8');
    
            // Update the registry
            console.log(`Updating registry for file: ${originalName}`);
            updateRegistry(context, workspace, originalName, backupFileName, filePath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to backup file ${uri.fsPath}: ${errorMessage}`);
        }
    }
    
    function getAllFilesInDirectory(dir: string): string[] {
        let files: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
    
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files = files.concat(getAllFilesInDirectory(fullPath)); // Recursive call for subdirectories
            } else {
                files.push(fullPath);
            }
        }
    
        return files;
    }

    context.subscriptions.push(backupFilesFromExplorer);
    
    //* Restore File //
    const restoreFile = vscode.commands.registerCommand('savedToBackup.restoreFile', async () => {
        if (!backupDirectory) {
            vscode.window.showErrorMessage('Backup directory is not configured.');
            return;
        }
    
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found. Open a file to restore.');
            return;
        }
    
        const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri); // Get workspace
        if (!workspace) {
            vscode.window.showErrorMessage('File is not part of a workspace.');
            return;
        }
    
        const document = editor.document;
        const originalFileName = path.basename(document.fileName);
        const registry = getRegistry(context, workspace); 
    
    
        if (!registry || !registry[originalFileName] || registry[originalFileName].length === 0) {
            vscode.window.showErrorMessage(`No backups found for the file: ${originalFileName}`);
            return;
        }
    
        const backupItems: vscode.QuickPickItem[] = registry[originalFileName]
        .filter(backup => !backup.fileName.includes('_snippet_')) // Exclude snippet backups
        .map(backup => ({
            label: backup.fileName,
            description: `Date: ${moment(backup.date).format('MMMM Do, h:mm:ss a')}`,
            detail: backup.filePath // Store the full path here
        }));
    
        const selectedBackup = await vscode.window.showQuickPick(backupItems, {
            placeHolder: `Select a backup to restore for ${originalFileName}`
        });
    
        if (!selectedBackup) {
            vscode.window.showErrorMessage('Backup selection cancelled. No file restored.');
            return;
        }
    
        try {
            const backupFilePath = selectedBackup.detail; // Get the full path
            if (!backupFilePath) {
                vscode.window.showErrorMessage('Invalid backup file path.');
                return;
            }
            const originalFilePath = document.fileName;
    
            const trashDirectory = path.join(backupDirectory, 'undo_restore');
            if (!fs.existsSync(trashDirectory)) {
                fs.mkdirSync(trashDirectory, { recursive: true });
            }
    
            if (fs.existsSync(originalFilePath)) { // Check if original file exists
                const trashedFilePath = path.join(trashDirectory, path.basename(originalFilePath));
                try {
                    fs.renameSync(originalFilePath, trashedFilePath);
                } catch (trashError) {
                    vscode.window.showErrorMessage(`Failed to move original file to trash: ${trashError}`);
                    // Consider whether to continue the restore even if trashing fails
                }
            }
    
            fs.copyFileSync(backupFilePath, originalFilePath);
            vscode.window.showInformationMessage(`Restored ${originalFileName} from backup: ${path.basename(backupFilePath)}`); // Show base name
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to restore file: ${errorMessage}`);
        }
    });
    context.subscriptions.push(restoreFile);

    // * Restore Snippet //
    const restoreSnippet = vscode.commands.registerCommand('savedToBackup.restoreSnippet', async () => {
        if (!backupDirectory) {
            vscode.window.showErrorMessage('Backup directory is not configured.');
            return;
        }
    
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }
    
        const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri); // Get workspace
        if (!workspace) {
            vscode.window.showErrorMessage('File is not part of a workspace.');
            return;
        }
    
        const document = editor.document;
        const originalFileName = path.basename(document.fileName);
        const registry = getRegistry(context, workspace); 
    
    
        if (!registry || !registry[originalFileName] || registry[originalFileName].length === 0) {
            vscode.window.showErrorMessage(`No backups found for the file: ${originalFileName}`);
            return;
        }
    
        // Filter for snippets only
        const snippetBackups = registry[originalFileName].filter(backup => backup.fileName.includes("_snippet_"));
    
        if (snippetBackups.length === 0) {
            vscode.window.showInformationMessage('No snippets found for this file.');
            return;
        }
    
        const backupItems: vscode.QuickPickItem[] = snippetBackups.map(backup => ({
            label: backup.fileName,
            description: `Date: ${moment(backup.date).format('MMMM Doராஜ், h:mm:ss a')}`,
            detail: backup.filePath
        }));
    
        const selectedBackup = await vscode.window.showQuickPick(backupItems, {
            placeHolder: `Select a snippet to restore for ${originalFileName}`
        });
    
        if (!selectedBackup) {
            return; // User cancelled
        }
    
        try {
            const snippetPath = selectedBackup.detail;
        
            if (snippetPath === undefined) { // Check if snippetPath is undefined
                vscode.window.showErrorMessage('Invalid snippet path.');
                return; // Important: Exit the function if the path is invalid
            }
        
            const snippetContent = fs.readFileSync(snippetPath, 'utf8');
        
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, snippetContent);
            });
        
            vscode.window.showInformationMessage(`Snippet ${path.basename(snippetPath)} restored.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error restoring snippet: ${errorMessage}`);
        }
    });

    context.subscriptions.push(restoreSnippet);

    //* Project Backup //
    const projectBackup = vscode.commands.registerCommand('savedToBackup.projectBackup', async () => {
        if (!backupDirectory) {
            vscode.window.showErrorMessage('Backup directory is not configured.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace is open. Open a workspace to perform a project backup.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Prompt for a custom suffix
        const date = moment().format('YYYY-MM-DD_HH-mm-ss'); // e.g., 2024-12-25_12-30-00
        const suffix = await vscode.window.showInputBox({
            prompt: 'Enter a suffix for the project backup (or leave blank for default)',
        }) || date;

        // Construct backup file name and path
        const backupFileName = `project_backup_${suffix}.zip`;
        const projectBackupPath = path.join(backupDirectory, 'project'); // Subfolder for project backups

        // Ensure the subfolder exists
        if (!fs.existsSync(projectBackupPath)) {
            fs.mkdirSync(projectBackupPath, { recursive: true });
        }

        const backupFilePath = path.join(projectBackupPath, backupFileName); // Full path for the backup file

        try {
            // Create a write stream for the archive
            const output = fs.createWriteStream(backupFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } }); // Maximum compression

            // Handle errors during compression
            archive.on('error', (err) => {
                throw err;
            });

            // Finalize the archive when done
            output.on('close', () => {
                vscode.window.showInformationMessage(
                    `Project backed up successfully to ${backupFilePath} (${archive.pointer()} total bytes)`
                );
            });

            // Pipe the archive data to the file
            archive.pipe(output);

            // Add all files from the workspace root, ignoring files in the project backup subfolder
            const excludeProjectBackupPath = path.relative(workspaceRoot, projectBackupPath).replace(/\\/g, '/') + '/**';
            archive.glob('**/*', {
                cwd: workspaceRoot,
                ignore: [excludeProjectBackupPath], // Exclude files in the `project` backup subfolder
            });

            // Finalize the archive
            await archive.finalize();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create project backup: ${errorMessage}`);
        }
    });
    context.subscriptions.push(projectBackup);

    //* Snippet Backup //
    const backupSelection = vscode.commands.registerCommand('savedToBackup.backupSelection', async () => {
        if (!backupDirectory) {
            vscode.window.showErrorMessage('Backup directory is not configured.');
            return;
        }
    
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }
    
        const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri); // Get workspace
        if (!workspace) {
            vscode.window.showErrorMessage('File is not part of a workspace.');
            return;
        }
    
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showErrorMessage('No text selected.');
            return;
        }
    
        const originalName = path.basename(editor.document.fileName);
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext);
    
        const snippetName = await vscode.window.showInputBox({
            prompt: 'Enter a name for the snippet backup',
        });
    
        if (!snippetName) {
            vscode.window.showErrorMessage('Snippet name is required.');
            return;
        }
    
        const snippetsDirectory = path.join(backupDirectory, 'snippets');
        if (!fs.existsSync(snippetsDirectory)) {
            fs.mkdirSync(snippetsDirectory, { recursive: true });
        }
    
        const backupFileName = `${baseName}_snippet_${snippetName.replace(/[^a-zA-Z0-9_\-]/g, '_')}${ext}`;
        const filePath = path.join(snippetsDirectory, backupFileName);
    
        try {
            fs.writeFileSync(filePath, selectedText, 'utf8');
            updateRegistry(context, workspace, originalName, backupFileName, filePath); // Pass workspace to updateRegistry
            vscode.window.showInformationMessage(`Selection backed up as ${backupFileName} in ${snippetsDirectory}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to save backup: ${errorMessage}`);
        }
    });
    context.subscriptions.push(backupSelection);

    /* Toggle .gitignore */
    const toggleGitIgnore = vscode.commands.registerCommand('savedToBackup.toggleGitIgnore', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace is open.');
            return;
        }
    
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const gitIgnorePath = path.join(workspaceRoot, '.gitignore');
        const relativeBackupPath = 'backups/';
    
        try {
            if (!fs.existsSync(gitIgnorePath)) {
                // Create .gitignore if it doesn't exist and add the backups/ entry
                fs.writeFileSync(gitIgnorePath, `${relativeBackupPath}\n`, { encoding: 'utf8' });
                vscode.window.showInformationMessage(`Created .gitignore and added ${relativeBackupPath}.`);
                return;
            }
    
            // Read the .gitignore file
            const gitIgnoreContent = fs.readFileSync(gitIgnorePath, 'utf8');
            const gitIgnoreLines = gitIgnoreContent.split('\n').map(line => line.trim());
    
            if (gitIgnoreLines.includes(relativeBackupPath)) {
                // Remove the backups/ entry
                const updatedContent = gitIgnoreLines.filter(line => line !== relativeBackupPath).join('\n');
                fs.writeFileSync(gitIgnorePath, updatedContent, { encoding: 'utf8' });
                vscode.window.showInformationMessage(`Removed ${relativeBackupPath} from .gitignore.`);
            } else {
                // Add the backups/ entry
                fs.appendFileSync(gitIgnorePath, `${relativeBackupPath}\n`, { encoding: 'utf8' });
                vscode.window.showInformationMessage(`Added ${relativeBackupPath} to .gitignore.`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to toggle backups in .gitignore: ${errorMessage}`);
        }
    });
    context.subscriptions.push(toggleGitIgnore);

    //* Delete Old Backups //
    const deleteOldBackups = vscode.commands.registerCommand('savedToBackup.deleteOldBackups', async () => {
        if (!backupDirectory) {
            vscode.window.showErrorMessage('Backup directory is not configured.');
            return;
        }
    
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found. Open a file in the workspace you want to delete backups from.');
            return;
        }
    
        const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!workspace) {
            vscode.window.showErrorMessage('The active file is not part of a workspace.');
            return;
        }
    
        // Prompt for number of hours to keep backups
        const hoursToKeep = await vscode.window.showInputBox({
            prompt: 'Enter the number of hours of backups to keep (e.g., 24 for 1 day, 0 to delete all backups):',
            validateInput: (value) => {
                const num = Number(value);
                if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
                    return 'Please enter a non-negative integer.';
                }
                return null;
            }
        });
    
        if (hoursToKeep === undefined) {
            return; // User canceled
        }
    
        const hours = parseInt(hoursToKeep, 10);
    
        if (isNaN(hours) || hours < 0) {
            vscode.window.showErrorMessage('Invalid number of hours entered.');
            return;
        }
    
        const cutoffDate = moment().subtract(hours, 'hours');
    
        let registry = getRegistry(context, workspace);
        let filesToDelete: string[] = [];
    
        // Process the registry to find old backups
        for (const originalFile in registry) {
            if (registry.hasOwnProperty(originalFile)) {
                const updatedEntries = registry[originalFile].filter((backup) => {
                    const backupDate = moment(backup.date);
                    if (backupDate.isBefore(cutoffDate) || hours === 0) {
                        filesToDelete.push(backup.filePath);
                        return false; // Exclude old backups or delete all if hours === 0
                    }
                    return true; // Keep recent backups
                });
    
                registry[originalFile] = updatedEntries;
    
                // Remove empty entries
                if (updatedEntries.length === 0) {
                    delete registry[originalFile];
                }
            }
        }
    
        if (filesToDelete.length === 0) {
            vscode.window.showInformationMessage('No backups found to delete in this workspace.');
            return;
        }
    
        // Confirm deletion
        const confirmDelete = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `Are you sure you want to delete ${filesToDelete.length} backup(s) in this workspace?`
        });
    
        if (confirmDelete !== 'Yes') {
            vscode.window.showInformationMessage('Deletion cancelled.');
            return;
        }
    
        // Delete the files
        try {
            filesToDelete.forEach((filePath) => {
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`Deleted backup: ${filePath}`);
                    } catch (error) {
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to delete file ${filePath}: ${error.message}`);
                        } else {
                            vscode.window.showErrorMessage(`Failed to delete file ${filePath}: ${String(error)}`);
                        }
                    }
                } else {
                    console.warn(`File not found for deletion: ${filePath}`);
                }
            });
    
            // Update the registry in global state
            const workspaceKey = getWorkspaceKey(workspace);
            let allRegistries = context.globalState.get<{ [workspaceKey: string]: { [key: string]: BackupEntry[] } }>('backupRegistries') || {};
            allRegistries[workspaceKey] = registry;
            context.globalState.update('backupRegistries', allRegistries);
    
            vscode.window.showInformationMessage(`Deleted ${filesToDelete.length} old backup(s) in this workspace.`);
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to delete backups: ${error.message}`);
            } else {
                vscode.window.showErrorMessage(`Failed to delete backups: ${String(error)}`);
            }
        }
    });
    
    context.subscriptions.push(deleteOldBackups);

    // * Export Backups //
    const exportBackups = vscode.commands.registerCommand('savedToBackup.exportBackups', async () => {
        if (!backupDirectory) {
            vscode.window.showErrorMessage('Backup directory is not configured.');
            return;
        }
    
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace is open. Export requires an open workspace.');
            return;
        }
    
        const workspaceName = workspaceFolders[0].name;
        const timestamp = moment().format('YYYYMMDDHHmmss');
        const exportFileName = `${workspaceName}_backups_${timestamp}`;
    
        const exportUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(workspaceFolders[0].uri.fsPath), exportFileName)),
            filters: {
                'Zip Files': ['zip']
            }
        });
    
        if (!exportUri) {
            vscode.window.showInformationMessage('Export cancelled.');
            return;
        }
    
        const exportPath = exportUri.fsPath;
    
        try {
            if (exportPath.endsWith(".zip")) {
                const output = fs.createWriteStream(exportPath);
                const archive = archiver('zip', { zlib: { level: 9 } });
    
                archive.on('error', (err) => {
                    throw err;
                });
    
                output.on('close', () => {
                    vscode.window.showInformationMessage(
                        `Project backed up successfully to ${exportPath} (${archive.pointer()} total bytes)`
                    );
                });
    
                archive.pipe(output);
    
                // Use directory with the exportFileName as the root folder name
                archive.directory(backupDirectory, path.parse(exportPath).name);
    
                await archive.finalize();
            } else {
                await fse.copy(backupDirectory, exportPath, { overwrite: true });
                vscode.window.showInformationMessage(`Backups exported to ${exportPath}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error exporting backups: ${errorMessage}`);
        }
    });
    
    context.subscriptions.push(exportBackups);

    // * Debug: Clear Registry //
    const clearRegistry = vscode.commands.registerCommand('savedToBackup.clearRegistry', async () => {
        const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Are you sure you want to clear the backup registry? This action cannot be undone.'
        });
    
        if (confirm !== 'Yes') {
            vscode.window.showInformationMessage('Registry clearing cancelled.');
            return;
        }
    
        // Clear the global registry
        await context.globalState.update('backupRegistries', {});
        vscode.window.showInformationMessage('Backup registry has been cleared.');
        console.log('Backup registry cleared.');
    });
    
    context.subscriptions.push(clearRegistry);

}

interface BackupEntry {
    fileName: string;
    filePath: string; // Add filePath to the interface
    date: string;
}

function getWorkspaceKey(workspace: vscode.WorkspaceFolder): string {
    return workspace.uri.toString(); // Use URI as key
}

function getRegistry(context: vscode.ExtensionContext, workspace: vscode.WorkspaceFolder): { [key: string]: BackupEntry[] } {
    const workspaceKey = getWorkspaceKey(workspace);
    const allRegistries = context.globalState.get<{ [workspaceKey: string]: { [key: string]: BackupEntry[] } }>('backupRegistries') || {};
    return allRegistries[workspaceKey] || {};
}

function updateRegistry(context: vscode.ExtensionContext, workspace: vscode.WorkspaceFolder, originalFile: string, backupFile: string, backupFilePath: string) {
    const workspaceKey = getWorkspaceKey(workspace);
    let allRegistries = context.globalState.get<{ [workspaceKey: string]: { [key: string]: BackupEntry[] } }>('backupRegistries') || {};
    let registry = allRegistries[workspaceKey] || {};

    if (!registry[originalFile]) {
        registry[originalFile] = [];
    }

    const currentDate = new Date().toISOString();
    registry[originalFile].push({ fileName: backupFile, filePath: backupFilePath, date: currentDate });
    allRegistries[workspaceKey] = registry;
    context.globalState.update('backupRegistries', allRegistries);
}


function watchBackupDirectory(context: vscode.ExtensionContext, workspace: vscode.WorkspaceFolder) {
    if (!backupDirectory) return;

    // Clear any existing watcher
    if (backupWatcher) {
        backupWatcher.close();
    }

    try {
        backupWatcher = fs.watch(backupDirectory, { persistent: true }, (eventType, filename) => {
            if (!filename) {
                console.warn(`Filename not provided for event: ${eventType}`);
                return;
            }

            const backupFilePath = path.join(backupDirectory!, filename);

            if (eventType === 'rename' || eventType === 'change') {
                // Check if the file was deleted
                if (!fs.existsSync(backupFilePath)) {
                    console.log(`Detected deletion of: ${backupFilePath}`);
                    deleteBackupFile(context, workspace, backupFilePath);
                }
            }
        });

        console.log(`Watching for changes in: ${backupDirectory}`);
    } catch (error) {
        console.error(`Failed to set up watcher on ${backupDirectory}:`, error);
    }

    // Clean up the watcher when the extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            if (backupWatcher) {
                backupWatcher.close();
                console.log(`Stopped watching: ${backupDirectory}`);
                }
            }
        });
    }

function deleteBackupFile(context: vscode.ExtensionContext, workspace: vscode.WorkspaceFolder, backupFilePath: string) {
    const workspaceKey = getWorkspaceKey(workspace);
    let allRegistries = context.globalState.get<{ [workspaceKey: string]: { [key: string]: BackupEntry[] } }>('backupRegistries') || {};
    let registry = allRegistries[workspaceKey] || {};

    for (const originalFile in registry) {
        if (registry.hasOwnProperty(originalFile)) {
            const updatedEntries = registry[originalFile].filter(backup => backup.filePath !== backupFilePath);
            if (updatedEntries.length !== registry[originalFile].length) {
                console.log(`Updating registry: Removing ${backupFilePath} for ${originalFile}`);
                registry[originalFile] = updatedEntries;
            }

            // Remove the originalFile entry if no backups remain
            if (registry[originalFile].length === 0) {
                delete registry[originalFile];
                console.log(`Removed empty registry entry for ${originalFile}`);
            }
        }
    }

    allRegistries[workspaceKey] = registry;
    context.globalState.update('backupRegistries', allRegistries);
}

function getCommentSyntax(languageId: string): string {
    const commentSyntax: { [key: string]: string } = {
        // Common Languages
        'javascript': '//',
        'typescript': '//',
        'python': '#',
        'java': '//',
        'c': '//',
        'cpp': '//',
        'html': '<!--',
        'css': '/*',
        'json': '//',

        // Web Development
        'php': '//',
        'javascriptreact': '//', // React JSX
        'typescriptreact': '//', // React TSX

        // Shell and Scripts
        'bash': '#',
        'shellscript': '#',
        'powershell': '#',

        // Markup and Data Formats
        'xml': '<!--',
        'yaml': '#',
        'toml': '#',
        'ini': ';',
        'markdown': '<!--',

        // SQL
        'sql': '--',

        // Functional Languages
        'haskell': '--',
        'elixir': '#',
        'clojure': ';;',
        'lisp': ';;',

        // Miscellaneous Languages
        'ruby': '#',
        'perl': '#',
        'r': '#',
        'swift': '//',
        'kotlin': '//',
        'dart': '//',
        'go': '//',
        'rust': '//',
        'lua': '--',
        'scala': '//',

        // Assembly
        'asm': ';',
        'x86asm': ';',

        // Other Languages
        'fortran': '!',
        'pascal': '//',
        'matlab': '%',
        'objective-c': '//',
        'groovy': '//',
        'vb': "'",
        'fsharp': '//'
    };

    return commentSyntax[languageId] || '//'; // Default to '//' if language not found
}

export function deactivate() {}