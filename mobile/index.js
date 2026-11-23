// App entry. Runs tiny polyfills BEFORE any route (and three.js) is loaded,
// registers the Android home-screen widget, then hands over to Expo Router.
if (typeof process !== 'undefined' && typeof process.emitWarning !== 'function') {
  // three.js calls process.emitWarning (a Node API) when loaded via require();
  // React Native has no such function, so make it a harmless no-op.
  process.emitWarning = () => {};
}
const { Platform } = require('react-native');
if (Platform.OS === 'android') {
  try {
    const { registerWidgetTaskHandler } = require('react-native-android-widget');
    const { widgetTaskHandler } = require('./src/widget/handler');
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch (e) {
    // Expo Go has no widget module — the rest of the app works without it.
  }
}
// require (not import): imports are hoisted and would run before the polyfill above.
require('expo-router/entry');
