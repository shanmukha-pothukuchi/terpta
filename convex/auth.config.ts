// WorkOS AuthKit JWT providers, per https://docs.convex.dev/auth/authkit
// Requires the WORKOS_CLIENT_ID environment variable on the Convex deployment
// (npx convex env set WORKOS_CLIENT_ID client_01...).
// Local declaration so this file typechecks under the frontend tsconfig too
// (Convex evaluates auth.config.ts server-side where process.env exists).
declare const process: { env: Record<string, string | undefined> };

const clientId = process.env.WORKOS_CLIENT_ID;

const authConfig = {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
  ],
};

export default authConfig;
