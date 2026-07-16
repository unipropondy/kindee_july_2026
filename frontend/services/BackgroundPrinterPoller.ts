import ThermalPrinter from "react-native-thermal-printer";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";

let isPolling = false;
let pollingInterval: any = null;

async function processJob(job: any, pollerUrl: string, token: string, storeId: string) {
  const targetIp = job.PrinterIp || job.PrinterIP;
  const targetPort = job.PrinterPort || 9100;
  const content = job.Content || "";
  const jobId = job.JobId;

  console.log(`[BackgroundPrinterPoller] Processing job ${jobId} to printer ${targetIp}:${targetPort}`);

  try {
    // Print the KOT/receipt silently via TCP socket using ThermalPrinter
    await ThermalPrinter.printTcp({
      ip: targetIp,
      port: Number(targetPort),
      payload: content,
      mmFeedPaper: 60,
    });

    console.log(`[BackgroundPrinterPoller] Successfully printed job ${jobId}. Reporting to backend...`);

    // Report success to backend
    const res = await fetch(`${pollerUrl}/api/print-jobs/${jobId}/complete`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-store-id": storeId,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      console.error(`[BackgroundPrinterPoller] Failed to mark job ${jobId} as complete: ${res.statusText}`);
    }
  } catch (err: any) {
    const errorMsg = err.message || "ThermalPrinter printTcp failed";
    console.error(`[BackgroundPrinterPoller] Printing job ${jobId} failed: ${errorMsg}`);

    // Report failure to backend
    try {
      const res = await fetch(`${pollerUrl}/api/print-jobs/${jobId}/failed`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "x-store-id": storeId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ errorMessage: errorMsg }),
      });
      if (!res.ok) {
        console.error(`[BackgroundPrinterPoller] Failed to mark job ${jobId} as failed on backend: ${res.statusText}`);
      }
    } catch (reportErr) {
      console.error("[BackgroundPrinterPoller] Error reporting print failure:", reportErr);
    }
  }
}

async function pollOnce() {
  if (isPolling) return;
  
  const settings = useGeneralSettingsStore.getState().settings;
  if (!settings.enablePrintPoller) {
    return;
  }

  isPolling = true;

  const pollerUrl = settings.printPollerUrl || "https://kindeejuly2026-production.up.railway.app";
  const token = settings.printPollerToken || "unipro-pos-bridge-token-2026";
  const storeId = settings.printPollerStoreId || "1";

  try {
    const res = await fetch(`${pollerUrl}/api/print-jobs/pending`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-store-id": storeId,
      },
    });

    if (!res.ok) {
      console.warn(`[BackgroundPrinterPoller] Failed to fetch pending jobs: ${res.statusText}`);
      isPolling = false;
      return;
    }

    const payload = await res.json();
    if (payload.success && Array.isArray(payload.data) && payload.data.length > 0) {
      console.log(`[BackgroundPrinterPoller] Found ${payload.data.length} pending print jobs.`);
      
      // Process jobs sequentially to avoid overlapping print streams
      for (const job of payload.data) {
        await processJob(job, pollerUrl, token, storeId);
      }
    }
  } catch (err) {
    console.error("[BackgroundPrinterPoller] Poll cycle error:", err);
  } finally {
    isPolling = false;
  }
}

export function startBackgroundPrinterPoller() {
  if (pollingInterval) {
    console.log("[BackgroundPrinterPoller] Poller already running.");
    return;
  }

  console.log("[BackgroundPrinterPoller] Starting print poller...");
  
  // Initial poll
  pollOnce();

  // Run poll every 5 seconds
  pollingInterval = setInterval(pollOnce, 5000);
}

export function stopBackgroundPrinterPoller() {
  if (pollingInterval) {
    console.log("[BackgroundPrinterPoller] Stopping print poller.");
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
