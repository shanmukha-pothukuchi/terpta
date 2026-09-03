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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthKitProvider
      clientId={import.meta.env.VITE_WORKOS_CLIENT_ID}
      redirectUri={redirectUri}
    >
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        <RouterProvider router={router} />
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  </StrictMode>,
);
