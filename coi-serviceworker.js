/* coi-serviceworker v0.1.7 - https://github.com/gzuidhof/coi-serviceworker */
(function () {
    if (typeof document === "undefined") {
        // Service worker scope
        self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
        self.addEventListener("fetch", function (event) {
            if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") return;
            event.respondWith(
                fetch(event.request).then(function (response) {
                    if (response.status === 0) return response;
                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
                    newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
            );
        });
    } else {
        // Main thread scope
        if (window.crossOriginIsolated) return;

        if (!window.isSecureContext) {
            console.warn("coi-serviceworker: not a secure context, cannot enable cross-origin isolation");
            return;
        }

        const registration = navigator.serviceWorker.register(document.currentScript.src).then(
            function () {
                if (navigator.serviceWorker.controller) {
                    return;
                }
                return new Promise(function (resolve) {
                    navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
                }).then(function () {
                    window.location.reload();
                });
            },
            function (err) {
                console.error("coi-serviceworker: failed to register service worker:", err);
            }
        );
    }
})();
