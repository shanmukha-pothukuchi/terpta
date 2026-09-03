import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AuthKitProvider } from "@workos-inc/authkit-react";
import { ConvexReactClient, ConvexProviderWithAuth } from "convex/react";
import { useAuthFromAuthKit } from "./lib/useAuthFromAuthKit";
import { router } from "./router";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing VITE_CONVEX_URL environment variable");
}
const convex = new ConvexReactClient(convexUrl);

const redirectUri =
  import.meta.env.VITE_WORKOS_REDIRECT_URI ??
  window.location.origin + import.meta.env.BASE_URL + "callback";

/**
 * Keep the WorkOS refresh token in localStorage rather than in a cookie.
 *
 * AuthKit's cookie mode (the default off localhost) stores the session on the
 * AuthKit domain, which only works when the app is same-site with it — an
 * app.example.com / auth.example.com custom-domain pair. TerpTA is served from
 * github.io against the default *.authkit.app domain, so that cookie is
 * cross-site: unreadable at page load and unusable for silent refresh. The
 * result is a session that dies on the first reload or token refresh and
 * bounces the user back to /login.
 *
 * Trade-off: a refresh token in localStorage is reachable by XSS. Switch this
 * off only once AuthKit is served from a custom domain under the app's own
 * registrable domain.
 */
const STORE_SESSION_IN_LOCAL_STORAGE = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthKitProvider
      clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
      redirectUri={redirectUri}
      devMode={STORE_SESSION_IN_LOCAL_STORAGE}
    >
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        <RouterProvider router={router} />
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  </StrictMode>,
);
