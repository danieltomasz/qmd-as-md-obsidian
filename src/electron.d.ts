// Minimal ambient declaration for the bits of Electron this plugin uses.
// Electron is provided by the Obsidian desktop runtime but @types/electron
// is not a dependency; declaring only what we touch keeps the build quiet
// without pulling in the full type package.
declare module 'electron' {
  export const shell: {
    openExternal(url: string): Promise<void>;
  };
}
