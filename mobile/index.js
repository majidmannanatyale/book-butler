// App entry. Runs tiny polyfills BEFORE any route (and three.js) is loaded,
// then hands over to Expo Router.
if (typeof process !== 'undefined' && typeof process.emitWarning !== 'function') {
  // three.js calls process.emitWarning (a Node API) when loaded via require();
  // React Native has no such function, so make it a harmless no-op.
  process.emitWarning = () => {};
}
// require (not import): imports are hoisted and would run before the polyfill above.
require('expo-router/entry');
