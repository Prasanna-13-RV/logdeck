module.exports = {
  appId: 'com.logdeck.desktop',
  productName: 'LogDeck',
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
  asarUnpack: ['node_modules/better-sqlite3/**/*'],
  // better-sqlite3 13 ships a Node-API prebuild; rebuilding it requires an unnecessary local C++ toolchain.
  npmRebuild: false,
  win: {
    target: [{ target: 'portable', arch: ['x64'] }],
    artifactName: 'LogDeck-${version}-windows-x64.exe',
    executableName: 'LogDeck',
    signAndEditExecutable: true
  },
  // In pinned builder 26.18, true omits UNPACK_DIR_NAME and uses a unique $PLUGINSDIR per launch.
  portable: { requestExecutionLevel: 'user', useZip: true, unpackDirName: true },
  publish: null
}
