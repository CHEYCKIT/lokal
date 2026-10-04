const { contextBridge } = require('electron')

// This preload belongs only to the isolated Google/Music login window. Execute
// synchronously in the page's world, before its scripts, without exposing APIs.
contextBridge.executeInMainWorld({
  func: () => {
    if (location.protocol !== 'https:' || !/(?:^|\.)(?:google|youtube)\.com$/i.test(location.hostname)) return
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      configurable: true,
      enumerable: true,
      get: () => false,
    })
  },
})
