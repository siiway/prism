// Stub for build-time aliasing of optional Node-only deps that capjs-core
// lazily imports (esbuild, javascript-obfuscator). Only reached at Cap
// instrumentation obfuscationLevel >= 4, which this project never sets — the
// embedded Cap challenge pins level <= 3. Aliasing here keeps the heavy,
// Node-native packages out of the Worker bundle.
export default {};
