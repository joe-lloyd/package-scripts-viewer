import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// This class represents a script item in the tree view
class ScriptItem extends vscode.TreeItem {
  public readonly scriptCommand: string;
  public readonly filePath: string;
  public readonly scriptId: string;
  public favourite: boolean;
  constructor(
    public readonly label: string,
    scriptCommand: string,
    filePath: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    favourite: boolean = false
  ) {
    super(label, collapsibleState);
    this.scriptCommand = scriptCommand;
    this.filePath = filePath;
    this.favourite = favourite;
    this.scriptId = `${filePath}::${label}`;
    this.tooltip = `${this.label}: ${this.scriptCommand}`;
    this.description = this.scriptCommand;
    this.contextValue = favourite ? 'script favourite' : 'script';
    this.iconPath = favourite ? new vscode.ThemeIcon('star-full') : undefined;
    this.command = {
      command: 'packageScriptsExplorer.runScript',
      title: 'Run Script',
      arguments: [this]
    };
  }
}

class SectionHeadingItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'sectionHeading';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

// Heading item for each package.json file
class FileHeadingItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly filePath: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'fileHeading';
    this.iconPath = vscode.ThemeIcon.Folder;
  }
}

// This class provides the data for the tree view
class PackageScriptsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  private globalState: vscode.Memento;
  constructor(private workspaceRoot: string | undefined, globalState: vscode.Memento) {
    this.globalState = globalState;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No package.json in empty workspace');
      return [];
    }
    if (!element) {
      // Root: Favourites, Recents, then package.json headings
      const result: vscode.TreeItem[] = [];
      const favourites = await this.getFavouriteScriptItems();
      if (favourites.length > 0) {
        result.push(new SectionHeadingItem('Favourites'));
        result.push(...favourites);
      }
      const recents = await this.getRecentScriptItems();
      if (recents.length > 0) {
        result.push(new SectionHeadingItem('Recents'));
        result.push(...recents);
      }
      result.push(...await this.getFileHeadingItems());
      return result;
    } else if (element instanceof FileHeadingItem) {
      return this.getScriptItemsForFile(element.filePath);
    } else if (element instanceof SectionHeadingItem) {
      // Section headings (Favourites/Recents) have script items as siblings, not children
      return [];
    } else {
      return [];
    }
  }

  // --- Favourites/Recents helpers ---

  private getFavourites(): string[] {
    return this.globalState.get<string[]>('favouriteScripts') || [];
  }
  private setFavourites(favs: string[]) {
    this.globalState.update('favouriteScripts', favs);
  }
  private getRecents(): string[] {
    return this.globalState.get<string[]>('recentScripts') || [];
  }
  private setRecents(recents: string[]) {
    this.globalState.update('recentScripts', recents);
  }

  private async getFavouriteScriptItems(): Promise<ScriptItem[]> {
    const allScripts = await this.getAllScriptItems();
    const favIds = this.getFavourites();
    return allScripts.filter(s => favIds.includes(s.scriptId)).map(s => { s.favourite = true; s.iconPath = new vscode.ThemeIcon('star-full'); return s; });
  }

  private async getRecentScriptItems(): Promise<ScriptItem[]> {
    const allScripts = await this.getAllScriptItems();
    const recIds = this.getRecents();
    // Avoid showing recents that are also favourites
    const favIds = this.getFavourites();
    return recIds
      .filter(id => !favIds.includes(id))
      .map(id => {
        const s = allScripts.find(s => s.scriptId === id);
        if (s) return s;
      })
      .filter(Boolean) as ScriptItem[];
  }

  private async getAllScriptItems(): Promise<ScriptItem[]> {
    const items: ScriptItem[] = [];
    const packageJsonPaths = await this.findPackageJsonFiles(this.workspaceRoot!);
    for (const packageJsonPath of packageJsonPaths) {
      try {
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        if (!packageJson.scripts) continue;
        for (const [scriptName, scriptCommand] of Object.entries(packageJson.scripts)) {
          const scriptId = `${packageJsonPath}::${scriptName}`;
          const isFav = this.getFavourites().includes(scriptId);
          items.push(new ScriptItem(
            scriptName,
            scriptCommand as string,
            packageJsonPath,
            vscode.TreeItemCollapsibleState.None,
            isFav
          ));
        }
      } catch {}
    }
    return items;
  }
  /**
   * Find all package.json files and return headings
   */
  private async getFileHeadingItems(): Promise<FileHeadingItem[]> {
    const headings: FileHeadingItem[] = [];
    if (!this.workspaceRoot) return headings;
    const packageJsonPaths = await this.findPackageJsonFiles(this.workspaceRoot);
    for (const packageJsonPath of packageJsonPaths) {
      const relativePath = path.relative(this.workspaceRoot, packageJsonPath);
      headings.push(new FileHeadingItem(relativePath, packageJsonPath));
    }
    return headings;
  }

  /**
   * Return script items for a given package.json file
   */
  private async getScriptItemsForFile(packageJsonPath: string): Promise<ScriptItem[]> {
    const scriptItems: ScriptItem[] = [];
    const favIds = this.getFavourites();
    try {
      const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);
      if (!packageJson.scripts) return scriptItems;
      for (const [scriptName, scriptCommand] of Object.entries(packageJson.scripts)) {
        const scriptId = `${packageJsonPath}::${scriptName}`;
        const isFav = favIds.includes(scriptId);
        scriptItems.push(new ScriptItem(
          scriptName,
          scriptCommand as string,
          packageJsonPath,
          vscode.TreeItemCollapsibleState.None,
          isFav
        ));
      }
    } catch (error) {
      console.error(`Error processing ${packageJsonPath}:`, error);
    }
    return scriptItems;
  }

  /**
   * Find all package.json files in the workspace and extract their scripts
   */
  private async getPackageScripts(): Promise<ScriptItem[]> {
    // Array to store all script items
    const scriptItems: ScriptItem[] = [];
    
    if (!this.workspaceRoot) {
      return scriptItems;
    }

    // Find all package.json files in the workspace
    const packageJsonPaths = await this.findPackageJsonFiles(this.workspaceRoot);
    
    // Process each package.json file
    for (const packageJsonPath of packageJsonPaths) {
      try {
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        
        // Skip if no scripts section
        if (!packageJson.scripts) {
          continue;
        }
        
        // Get the relative path for display
        const relativePath = path.relative(this.workspaceRoot, packageJsonPath);
        const folderName = path.dirname(relativePath);
        const displayPath = folderName === '.' ? 'Root' : folderName;
        
        // Add each script from this package.json
        for (const [scriptName, scriptCommand] of Object.entries(packageJson.scripts)) {
          const label = `${displayPath}: ${scriptName}`;
          scriptItems.push(new ScriptItem(
            label,
            scriptCommand as string,
            packageJsonPath,
            vscode.TreeItemCollapsibleState.None
          ));
        }
      } catch (error) {
        console.error(`Error processing ${packageJsonPath}:`, error);
      }
    }
    
    return scriptItems;
  }
  
  /**
   * Find all package.json files in the workspace
   */
  private async findPackageJsonFiles(workspaceRoot: string): Promise<string[]> {
    const packageJsonPaths: string[] = [];
    // Helper function to recursively search directories
    const searchDirectory = (dirPath: string) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          // Skip node_modules and .git directories
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            searchDirectory(fullPath);
          } else if (entry.isFile() && entry.name === 'package.json') {
            packageJsonPaths.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`Error searching directory ${dirPath}:`, error);
      }
    };
    searchDirectory(workspaceRoot);
    return packageJsonPaths;
  }
}


export function activate(context: vscode.ExtensionContext) {
  // Get the workspace folder
  const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;

  const globalState = context.globalState;
  // Create the tree data provider
  const packageScriptsProvider = new PackageScriptsProvider(workspaceRoot, globalState);

  // Register the tree view
  const treeView = vscode.window.createTreeView('packageScriptsExplorer', {
    treeDataProvider: packageScriptsProvider
  });

  // Favourites
  context.subscriptions.push(
    vscode.commands.registerCommand('packageScriptsExplorer.addFavourite', (item: ScriptItem) => {
      const favs = packageScriptsProvider['getFavourites']();
      if (!favs.includes(item.scriptId)) {
        favs.push(item.scriptId);
        packageScriptsProvider['setFavourites'](favs);
        packageScriptsProvider.refresh();
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('packageScriptsExplorer.removeFavourite', (item: ScriptItem) => {
      let favs = packageScriptsProvider['getFavourites']();
      favs = favs.filter(id => id !== item.scriptId);
      packageScriptsProvider['setFavourites'](favs);
      packageScriptsProvider.refresh();
    })
  );

  // Recents are updated when a script is run

  // Register the refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('packageScriptsExplorer.refreshEntry', () => {
      packageScriptsProvider.refresh();
    })
  );
  
  // Register the run script command
  context.subscriptions.push(
    vscode.commands.registerCommand('packageScriptsExplorer.runScript', (scriptItem: ScriptItem) => {
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }
      // Extract the script name from the label (format is "path: scriptName")
      const scriptNameMatch = scriptItem.label.match(/.*:\s(.+)$/);
      const scriptName = scriptNameMatch ? scriptNameMatch[1] : scriptItem.label;
      // Create a terminal and run the script
      const terminal = vscode.window.createTerminal(`Run: ${scriptName}`);
      terminal.show();
      terminal.sendText(`npm run ${scriptName}`);
      // --- Add to recents ---
      let recents = packageScriptsProvider['getRecents']();
      recents = recents.filter(id => id !== scriptItem.scriptId); // Remove if already present
      recents.unshift(scriptItem.scriptId); // Add to front
      if (recents.length > 5) recents = recents.slice(0, 5);
      packageScriptsProvider['setRecents'](recents);
      packageScriptsProvider.refresh();
    })
  );

  
  // Register a file system watcher to refresh when package.json files change
  const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
  context.subscriptions.push(
    watcher.onDidChange(() => packageScriptsProvider.refresh()),
    watcher.onDidCreate(() => packageScriptsProvider.refresh()),
    watcher.onDidDelete(() => packageScriptsProvider.refresh())
  );
  
  // Add the watcher to subscriptions
  context.subscriptions.push(watcher);
}

export function deactivate() {}
