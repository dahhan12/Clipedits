/**
 * Next.js server startup hook. Validates the deployment tier once at boot so a
 * misconfigured environment (e.g. production without secrets, or local/CI
 * carrying production publishing approvals) fails fast instead of running unsafe.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateDeploymentEnv } = await import("@/lib/config/deployEnv");
    validateDeploymentEnv();
  }
}
