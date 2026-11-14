import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import throttle from "lodash.throttle";
import WebView from "react-native-webview";
import {
  Accuracy,
  requestBackgroundPermissionsAsync,
  getBackgroundPermissionsAsync,
  startLocationUpdatesAsync,
  stopLocationUpdatesAsync,
  hasStartedLocationUpdatesAsync,
} from "expo-location";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AsyncAlert, AsyncConsent } from "./asyncAlert";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const LOCATION_NOTIFICATION_TASK_NAME = "background-notification-location";
const TARGET_KEY = "stopAlarmTarget";

const targetLocation = {
  latitude: 0,
  longitude: 0,
  stopId: "",
  title: "Arrived",
  body: "Here",
};

// Location updates outlive the app process, so a fresh JS context (app reopened,
// or the task relaunched headless) restores the target the updates were armed for.
const restored = (async () => {
  const saved = await AsyncStorage.getItem(TARGET_KEY);
  if (!saved) return;
  if (await hasStartedLocationUpdatesAsync(LOCATION_NOTIFICATION_TASK_NAME)) {
    Object.assign(targetLocation, JSON.parse(saved));
  } else {
    AsyncStorage.removeItem(TARGET_KEY);
  }
})().catch(() => {});

const setStopAlarm = async () => {
  const { status: notificationStatus } = await Notifications.requestPermissionsAsync();
  if ( notificationStatus !== "granted" ) {
    await AsyncAlert("Fail to setup alarm without notification permission.");
    return false;
  }
  
  const { status: bgStatus } = await getBackgroundPermissionsAsync();

  if (bgStatus !== "granted") {
    // Prominent disclosure + consent BEFORE requesting background location,
    // as required by Google Play's User Data policy.
    if ( Platform.OS === 'android' ) {
      const consented = await AsyncConsent(
        "背景位置存取 / Background location",
        "「巴士到站預報」會收集你的位置資料，以便在你接近所選巴士站時提示到站，"
          + "即使應用程式已關閉或沒有在使用中。此位置資料只用於到站提醒，不會用於其他用途。\n\n"
          + "hkbus.app collects location data to alert you when you are approaching your "
          + "selected bus stop, even when the app is closed or not in use. This location "
          + "data is used only for the arrival reminder and nothing else.",
        "允許 / Allow",
        "不允許 / Don't allow",
      );
      if ( !consented ) {
        return false;
      }
    }
    const { status } = await requestBackgroundPermissionsAsync();
    if ( status !== "granted" ) {
      return false;
    }
  }

  await startLocationUpdatesAsync(LOCATION_NOTIFICATION_TASK_NAME, {
    accuracy: Accuracy.Balanced,
    timeInterval: 5000,
    deferredUpdatesTimeout: 5000,
  });
  return true;
};

const clearTarget = () => {
  targetLocation.latitude = 0;
  targetLocation.longitude = 0;
  targetLocation.stopId = "";
  AsyncStorage.removeItem(TARGET_KEY);
};

export const toggleAlarm = async ({ stopId, title, body, lat, lng }: any) => {
  await restored;
  if (targetLocation.stopId === stopId) {
    clearTarget();
    try { 
      stopLocationUpdatesAsync(LOCATION_NOTIFICATION_TASK_NAME);
    } catch (e) {

    }
    return true
  } else {
    targetLocation.stopId = stopId;
    targetLocation.title = title;
    targetLocation.body = body;
    targetLocation.latitude = lat;
    targetLocation.longitude = lng;
    const ok = await setStopAlarm().catch(() => false);
    if (targetLocation.stopId !== stopId) {
      return ok; // superseded by a newer toggle while waiting
    }
    if (ok) {
      // The task may later run in a fresh JS context (app killed), so persist the target.
      await AsyncStorage.setItem(TARGET_KEY, JSON.stringify(targetLocation));
    } else {
      clearTarget();
    }
    return ok;
  }
};

export const postAlarmToWebView = (
  webViewRef: React.RefObject<WebView | null>
) => {
  return restored.then(() =>
    webViewRef?.current?.postMessage(
      JSON.stringify({
        type: "stop-alarm-stop-id",
        value: targetLocation.stopId,
      })
    )
  );
};

TaskManager.defineTask(
  LOCATION_NOTIFICATION_TASK_NAME,
  throttle(async ({ data: { locations }, error }: { data: any; error: any }) => {
    if (error) {
      return;
    }
    await restored;
    if (!targetLocation.stopId) {
      // Nothing armed: don't keep tracking location forever.
      stopLocationUpdatesAsync(LOCATION_NOTIFICATION_TASK_NAME).catch(() => {});
      return;
    }
    if (locations && Array.isArray(locations) && locations.length) {
      // Batched updates arrive oldest first; any fix inside the radius counts.
      if (locations.some((l: any) => getDistance(targetLocation, l.coords) < 500)) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: targetLocation.title,
            body: targetLocation.body,
            data: { data: "goes" },
          },
          trigger: null,
        });
        clearTarget();
        try {
          stopLocationUpdatesAsync(LOCATION_NOTIFICATION_TASK_NAME);
        } catch (e) {

        }
      }
      return;
    }
  }, 500)
);

const getDistance = (a: any, b: any) => {
  const R = 6371e3; // metres
  const φ1 = (a.latitude * Math.PI) / 180; // φ, λ in radians
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;

  const aa =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c; // in metres
};
