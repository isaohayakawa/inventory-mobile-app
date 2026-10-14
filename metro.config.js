const http = require('http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Drizzle migrations are .sql files bundled into the app.
config.resolver.sourceExts.push('sql');

// expo-sqlite on web loads a .wasm build of SQLite.
config.resolver.assetExts.push('wasm');

// expo-sqlite on web uses SharedArrayBuffer, which browsers only expose on
// cross-origin isolated pages (COEP + COOP headers on the HTML document).
// Expo CLI serves the HTML from its own middleware ahead of Metro's, so
// `server.enhanceMiddleware` never sees that request; set the headers on every
// response from the dev server instead.
const writeHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (...args) {
  if (!this.headersSent) {
    this.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    this.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }
  return writeHead.apply(this, args);
};

module.exports = config;
