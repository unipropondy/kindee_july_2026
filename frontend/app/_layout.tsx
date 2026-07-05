import "../shims/displayMock";
import "react-native-get-random-values";
import "react-native-reanimated";

import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { useEffect } from "react";
import { useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { ToastProvider } from "../components/Toast";
import { CustomerDisplayManager } from "../components/CustomerDisplayManager";
import { usePOSReadyGate } from "../hooks/usePOSReadyGate";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAuthStore } from "@/stores/authStore";
import { useRouter, useSegments, Slot } from "expo-router";
import * as SystemUI from "expo-system-ui";
import { Theme } from "@/constants/theme";
import { LogBox } from "react-native";

LogBox.ignoreLogs([
  "setLayoutAnimationEnabledExperimental is currently a no-op",
]);

// Set root background immediately to match theme
SystemUI.setBackgroundColorAsync(Theme.bgMain);

// Keep the splash screen visible while fonts load
SplashScreen.preventAutoHideAsync();

import { useGlobalSocketSync } from "@/hooks/useGlobalSocketSync";
import { API_URL } from "@/constants/Config";

// 🌐 GLOBAL FETCH RETRY & IDEMPOTENCY ENGINE
const originalFetch = global.fetch;

const getUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

interface NetworkPolicy {
  timeout: number;
  maxRetries: number;
  initialDelay: number;
  budget: number;
}

const CRITICAL_POLICY: NetworkPolicy = {
  timeout: 15000,
  maxRetries: 3,
  initialDelay: 300,
  budget: 35000,
};

const NORMAL_POLICY: NetworkPolicy = {
  timeout: 15000,
  maxRetries: 2,
  initialDelay: 300,
  budget: 35000,
};

const HEALTH_POLICY: NetworkPolicy = {
  timeout: 3000,
  maxRetries: 0,
  initialDelay: 300,
  budget: 5000,
};

const TERMINAL_POLICY: NetworkPolicy = {
  timeout: 165000, // 165 seconds to match/exceed YeahPay backend timeout (160s)
  maxRetries: 0,   // Do not retry payments to avoid idempotency conflicts
  initialDelay: 300,
  budget: 170000,
};

const classifyRequest = (url: string): NetworkPolicy => {
  if (!url) return NORMAL_POLICY;
  if (url.includes("/health")) return HEALTH_POLICY;
  if (url.includes("/yeahpay") || url.includes("yeahpay")) return TERMINAL_POLICY;

  const criticalKeywords = [
    "checkout",
    "save-cart",
    "send",
    "hold",
    "complete",
    "/save",
    "print",
    "update-item-status",
    "log-visit",
    "settings"
  ];

  const isCritical = criticalKeywords.some((keyword) => url.includes(keyword));
  return isCritical ? CRITICAL_POLICY : NORMAL_POLICY;
};

const getJitteredDelay = (baseDelay: number): number => {
  const min = baseDelay * 0.8;
  const max = baseDelay * 1.2;
  return min + Math.random() * (max - min);
};

global.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as any).url);

  if (url && url.includes(API_URL)) {
    const policy = classifyRequest(url);
    const options: RequestInit = init ? { ...init } : {};
    const headers: Record<string, string> = {};

    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }

    const token = useAuthStore.getState().token;
    if (token && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const requestId = headers['x-request-id'] || headers['X-Request-ID'] || getUUID();
    headers['x-request-id'] = requestId;
    options.headers = headers;

    let delay = policy.initialDelay;
    let lastError: any = null;
    const startTime = Date.now();

    if (__DEV__) {
      console.log(`🌐 [Fetch Start] ${options.method || 'GET'} -> ${url} | id: ${requestId}`);
    }

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      const elapsed = Date.now() - startTime;
      if (attempt > 0 && elapsed + delay > policy.budget) {
        if (__DEV__) {
          console.warn(`🛑 [Fetch Budget Exceeded] Elapsed: ${elapsed}ms, next delay: ${delay}ms, Budget: ${policy.budget}ms. Aborting retries for ${url}`);
        }
        break;
      }

      const controller = new AbortController();
      options.signal = controller.signal;

      const timeoutId = setTimeout(() => {
        controller.abort();
      }, policy.timeout);

      try {
        const response = await originalFetch(input, options);
        clearTimeout(timeoutId);

        if (response.status === 502 || response.status === 503 || response.status === 504) {
          lastError = new Error(`Server returned transient status ${response.status}`);
          if (__DEV__) {
            console.warn(`⚠️ [Fetch Transient Status] ${response.status} on ${url} (Attempt ${attempt}/${policy.maxRetries})`);
          }
        } else {
          if (__DEV__ && attempt > 0) {
            console.log(`✅ [Fetch Success After Retry] ${url} succeeded on attempt ${attempt}`);
          }
          return response;
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        const isTimeout = err.name === 'AbortError';
        const isNetwork = err instanceof TypeError || err.message?.includes('Network request failed');

        if (!isTimeout && !isNetwork) {
          if (__DEV__) {
            console.error(`🛑 [Fetch Non-Retryable Error] ${err.message || err} on ${url}`);
          }
          throw err;
        }

        if (__DEV__) {
          console.warn(`⚠️ [Fetch Transient Error] Attempt ${attempt}/${policy.maxRetries} failed: ${err.message || err} (Timeout: ${isTimeout}, Network: ${isNetwork})`);
        }
      }

      if (attempt < policy.maxRetries) {
        const jitteredDelay = getJitteredDelay(delay);
        if (__DEV__) {
          console.log(`💤 [Fetch Retry Delay] Waiting ${Math.round(jitteredDelay)}ms before attempt ${attempt + 1}`);
        }
        await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
        delay *= 2.0;
      }
    }

    if (__DEV__) {
      console.error(`🛑 [Fetch Failed Exhausted] ${options.method || 'GET'} -> ${url} | Failed after ${policy.maxRetries} retries. Error: ${lastError?.message || lastError}`);
    }
    throw lastError;
  }

  return originalFetch(input, init);
};

export default function RootLayout() {
  const [authHydrated, setAuthHydrated] = React.useState(useAuthStore.persist.hasHydrated());

  React.useEffect(() => {
    if (authHydrated) return;

    // Subscribe to completion of hydration in Zustand
    const unsubFinish = useAuthStore.persist.onFinishHydration(() => {
      setAuthHydrated(true);
    });

    return unsubFinish;
  }, [authHydrated]);

  useGlobalSocketSync();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const user = useAuthStore((s) => s.user);

  // 🌐 SILENT API WAKE-UP & CONNECTION PRE-WARM
  useEffect(() => {
    const warmupAPI = async () => {
      if (__DEV__) {
        console.log(`🌐 [App Startup] Warming up connection to ${API_URL}...`);
      }
      try {
        const start = Date.now();
        // Trigger DNS lookup, TCP/SSL handshake, and backend container spin-up
        const res = await fetch(`${API_URL}/health`);
        const duration = Date.now() - start;
        if (__DEV__) {
          console.log(`🌐 [App Startup] API warmed up successfully in ${duration}ms. Status: ${res.status}`);
        }

        // 🚀 PARALLEL PREFETCH: Load static payment config immediately after connection
        // is confirmed. This ensures the Payment screen reads from cache instead of
        // making sequential network requests on every open.
        const token = useAuthStore.getState().token;
        if (token) {
          import("@/stores/paymentSettingsStore").then((m) => {
            Promise.all([
              m.usePaymentSettingsStore.getState().fetchSettings(),
              m.usePaymentSettingsStore.getState().fetchPaymentMethods(),
            ]).catch(() => {/* Non-fatal — payment screen still works on miss */});
          });
        }
      } catch (err: any) {
        if (__DEV__) {
          console.warn(`🌐 [App Startup] API warmup ping failed (expected if backend container is booting up):`, err.message || err);
        }
      }
    };
    warmupAPI();
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });



  // 🖥️ CUSTOMER DISPLAY: Gate resolves once fonts + settings + socket are ready
  const isPOSReady = usePOSReadyGate(fontsLoaded || !!fontError);

  // ✅ AUTH GUARD: Redirect based on auth state and role
  useEffect(() => {
    if (!fontsLoaded || !authHydrated) return;

    const rootSegment = segments[0];
    if (rootSegment && rootSegment.startsWith("customer-display")) return;

    const isInsideApp = !!rootSegment && rootSegment !== "login";
    
    if (!user && isInsideApp) {
      // 1. Not logged in -> Go to Login
      router.replace("/login");
    } else if (user) {
      if (user.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
        if (rootSegment !== "sales-report") {
          router.replace("/sales-report");
        }
      } else if (!rootSegment || rootSegment === "login") {
        // 2. Already logged in -> Go to Role-Specific Dashboard
        const role = user.role;
        const userName = (user.userName || "").trim().toUpperCase();

        if (userName === "KDS") {
          router.replace("/kds" as any);
        } else if (role === "WAITER") {
          router.replace("/(tabs)/category"); // Waiter starts at Ordering
        } else {
          router.replace("/(tabs)/category"); // Others start at POS
        }
      }
    }
  }, [user, segments, fontsLoaded, authHydrated]);

  useEffect(() => {
    if ((fontsLoaded || fontError) && authHydrated) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, authHydrated]);

  if ((!fontsLoaded && !fontError) || !authHydrated) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <ToastProvider>
          {/* 🖥️ Customer Display: auto-projects onto Sunmi D3 secondary screen */}
          <CustomerDisplayManager isPOSReady={isPOSReady} />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="login" options={{ gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="menu" />
            <Stack.Screen name="sales-report" />
            <Stack.Screen name="ai-chat" />
            <Stack.Screen name="day-end" />
            <Stack.Screen name="company-settings" />
            <Stack.Screen name="waiters" />
            <Stack.Screen name="members" />
            <Stack.Screen name="receivables" />
            <Stack.Screen name="waiter-history" />
            <Stack.Screen name="locked-tables" />
            <Stack.Screen name="kitchen-status" />
            <Stack.Screen name="heldOrders" />
            <Stack.Screen name="summary" />
            <Stack.Screen name="payment" />
            <Stack.Screen name="payment_success" />
            <Stack.Screen name="cart" />
            <Stack.Screen name="cash-drawer" />
            <Stack.Screen name="cash-drawer-report" />
            <Stack.Screen name="StaffAttendance" />
            <Stack.Screen name="loyalty" />
            <Stack.Screen name="loyaltyConfig" />
            <Stack.Screen name="terminal-settings" />
            <Stack.Screen name="customer-display" />
          </Stack>
          <StatusBar style="light" />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}