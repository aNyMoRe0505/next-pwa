import Head from "next/head";
import { useEffect } from "react";

export default function Index() {
  // This hook only run once in browser after the component is rendered for the first time.
  // It has same effect as the old componentDidMount lifecycle callback.
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      window.workbox !== undefined
    ) {
      const wb = window.workbox;
      // add event listeners to handle PWA lifecycle events
      wb.addEventListener("installed", (event) => {
        console.log(`Event ${event.type} is triggered.`);
        console.log(event);
      });

      wb.addEventListener("waiting", () => {
        // `event.wasWaitingBeforeRegister` will be false if this is the first time the updated service worker is waiting.
        // When `event.wasWaitingBeforeRegister` is true, a previously updated service worker is still waiting.
        // You may want to customize the UI prompt accordingly.
        // https://developer.chrome.com/docs/workbox/handling-service-worker-updates/#the-code-to-put-in-your-page
        if (
          confirm(
            "A newer version of this web app is available, reload to update?"
          )
        ) {
          wb.addEventListener("controlling", () => {
            window.location.reload();
          });

          // Send a message to the waiting service worker, instructing it to activate.
          wb.messageSkipWaiting();
        } else {
          console.log(
            "User rejected to update SW, keeping the old version. New version will be automatically loaded when the app is opened next time."
          );
        }
      });

      wb.addEventListener("controlling", (event) => {
        console.log(`Event ${event.type} is triggered.`);
        console.log(event);
      });

      wb.addEventListener("activated", (event) => {
        console.log(`Event ${event.type} is triggered.`);
        console.log(event);
      });

      // never forget to call register as automatic registration is turned off in next.config.js
      wb.register();
    }
  }, []);

  return (
    <>
      <Head>
        <title>next-pwa example</title>
      </Head>
      <h1>Next.js + PWA = AWESOME!!</h1>
    </>
  );
}
