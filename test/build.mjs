// Bundles the REAL ../stopAlarm.ts with its native imports swapped for mocks.mjs.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
const map = {
  "expo-task-manager": "export const defineTask = (...a) => M.TaskManager.defineTask(...a);",
  "expo-notifications": "export const {setNotificationHandler, requestPermissionsAsync, scheduleNotificationAsync} = M.Notifications;",
  "expo-location": "export const {Accuracy, getBackgroundPermissionsAsync, requestBackgroundPermissionsAsync, startLocationUpdatesAsync, stopLocationUpdatesAsync, hasStartedLocationUpdatesAsync} = M.Location;",
  "react-native": "export const Platform = { get OS() { return M.ReactNative.Platform.OS; } };",
  "react-native-webview": "export default {};",
  "./asyncAlert": "export const {AsyncAlert, AsyncConsent} = M.AsyncAlertMod;",
  "@react-native-async-storage/async-storage": "export default M.AsyncStorage;",
};
export const bundle = () =>
  build({
    entryPoints: [here + "../stopAlarm.ts"], bundle: true, format: "esm", platform: "node",
    write: false, nodePaths: [here + "node_modules"], tsconfigRaw: {},
    plugins: [{
      name: "mocks",
      setup(b) {
        b.onResolve({ filter: /mocks\.mjs$/ }, (a) => ({ path: a.path, external: true }));
        b.onResolve({ filter: /.*/ }, (a) => (a.path in map ? { path: a.path, namespace: "mock" } : null));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
          contents: `import * as M from ${JSON.stringify(here + "mocks.mjs")};\n${map[a.path]}`,
          loader: "js",
        }));
      },
    }],
  }).then((r) => r.outputFiles[0].text);
