const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Watchman can get stuck on local macOS setups and block Metro startup forever.
// The Node filesystem watcher is slower but reliable for this example app.
config.resolver.useWatchman = false;

module.exports = config;
