const { contextBridge, webUtils } = require("electron");

// Exposes just enough to let the renderer resolve the absolute filesystem
// path of a file the user drag-dropped from Finder. Needed because the
// browser File API alone never exposes real disk paths.
contextBridge.exposeInMainWorld("electronAPI", {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  isElectron: true,
});
