module.exports = {
  appId: 'com.logdeck.desktop',
  productName: 'LogDeck',
  compression: 'maximum',
  electronLanguages: ['en-US'],
  directories: { output: 'release/build' },
  files: [
    'out/**/*', 'package.json',
    '!node_modules/@codemirror/**/*',
    '!node_modules/@tanstack/**/*',
    '!node_modules/@lezer/**/*',
    '!node_modules/@marijn/**/*',
    '!node_modules/{react,react-dom,zustand,lucide-react,scheduler,style-mod,w3c-keyname,crelt}/**/*',
    '!node_modules/better-sqlite3/prebuilds/{darwin-*,linux*,win32-arm64.node}'
  ],
  asar: true,
  extraResources: [{ from: 'images/app-icon.ico', to: 'app-icon.ico' }],
  asarUnpack: ['node_modules/better-sqlite3/**/*'],
  // better-sqlite3 13 ships a Node-API prebuild; rebuilding it requires an unnecessary local C++ toolchain.
  npmRebuild: false,
  win: {
    icon: 'images/app-icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'LogDeck-${version}-windows-x64.exe',
    executableName: 'LogDeck',
    signAndEditExecutable: true
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
    include: 'scripts/installer-hooks.nsh',
    differentialPackage: false,
    packElevateHelper: false
  },
  publish: null
}
