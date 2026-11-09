"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/app/actions/push";

type State = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function toKey(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type SubJson = { endpoint: string; keys: { p256dh: string; auth: string } };
const subData = (sub: PushSubscription) => ({ ...(sub.toJSON() as SubJson), device: deviceName() });

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

function detect(): State {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "checking";
}

/** Turn phone/laptop notifications on or off for this browser. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const initial = detect();
    if (initial !== "checking" || !publicKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only APIs after mount
      setState(initial === "checking" ? "off" : initial);
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then(async (sub) => {
        if (sub && Notification.permission === "granted") {
          await savePushSubscription(subData(sub)); // keep the server in sync
          setState("on");
        } else setState("off");
      })
      .catch(() => setState("unsupported"));
  }, [publicKey]);

  const enable = () =>
    start(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey!) }));
        const res = await savePushSubscription(subData(sub));
        if (!res.ok) {
          setMessage(res.error);
          return;
        }
        setState("on");
        const test = await sendTestPush();
        setMessage(test.ok ? "Done — a test notification is on its way." : test.error);
      } catch {
        setMessage("Could not turn on notifications in this browser.");
      }
    });

  const disable = () =>
    start(async () => {
      setMessage(null);
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    });

  const test = () =>
    start(async () => {
      const res = await sendTestPush();
      setMessage(res.ok ? "Test sent." : res.error);
    });

  return (
    <section className="panel flex max-w-3xl flex-col gap-3 p-4" aria-labelledby="push-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="push-title" className="font-bold">
            Notifications on this device
          </h2>
          <p className="text-[13px] text-muted">
            Get approvals, deadlines and updates on your phone or laptop, even when the app is closed. Turn it on once on every device you use.
          </p>
        </div>
        {publicKey && state === "off" && (
          <button type="button" className="btn btn-primary" onClick={enable} disabled={pending}>
            {pending ? "Turning on…" : "Turn on notifications"}
          </button>
        )}
        {state === "on" && (
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={test} disabled={pending}>
              Send test
            </button>
            <button type="button" className="btn" onClick={disable} disabled={pending}>
              Turn off
            </button>
          </div>
        )}
      </div>

      {state === "on" && <p className="text-[13px] font-semibold text-ok">On for this device.</p>}
      {!publicKey && state !== "ios-install" && (
        <p className="text-[13px] text-warn">Push isn&apos;t configured on the server yet (VAPID keys missing).</p>
      )}
      {state === "denied" && (
        <p className="text-[13px] text-warn">
          Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload this page.
        </p>
      )}
      {state === "unsupported" && <p className="text-[13px] text-muted">This browser doesn&apos;t support push notifications.</p>}
      {state === "ios-install" && (
        <ol className="list-decimal space-y-1 pl-5 text-[13px]">
          <li>
            On iPhone, open this page in <b>Safari</b> and tap <b>Share</b> → <b>Add to Home Screen</b>.
          </li>
          <li>Open BOEMI Tools from the new icon on your home screen and sign in.</li>
          <li>
            Come back to <b>Notifications</b> and tap <b>Turn on notifications</b> (needs iOS 16.4 or newer).
          </li>
        </ol>
      )}
      {message && (
        <p role="status" className="text-[13px] text-muted">
          {message}
        </p>
      )}
    </section>
  );
}
