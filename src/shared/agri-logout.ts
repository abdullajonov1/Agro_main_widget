import {
  getAppStore,
  loadArcGISJSAPIModules,
  SessionManager,
} from "jimu-core";

/** Same logout flow as eco-monitoring HomeHeader / Fire Portal logout.tsx */
const SGM_PORTAL_ORIGIN = "https://sgm.uzspace.uz";

function trimPortalRestSuffix(url: string): string {
  return String(url || "")
    .replace(/\/sharing\/rest\/?$/i, "")
    .replace(/\/$/, "");
}

function getPortalBaseUrlLogout(): string {
  try {
    const mainSession = SessionManager.getInstance().getMainSession() as {
      portal?: { toString?: () => string };
    };
    const portal = mainSession?.portal?.toString?.() || "";
    if (portal) return trimPortalRestSuffix(portal);
  } catch {
    /* ignore */
  }

  try {
    const state = getAppStore().getState() as {
      portalUrl?: string;
      appConfig?: { portalUrl?: string };
    };
    const portalUrl = state?.portalUrl || state?.appConfig?.portalUrl || "";
    if (portalUrl) return trimPortalRestSuffix(String(portalUrl));
  } catch {
    /* ignore */
  }

  const fromConfig =
    (window as unknown as { jimuConfig?: { portalUrl?: string } }).jimuConfig
      ?.portalUrl || "";
  if (fromConfig) return trimPortalRestSuffix(String(fromConfig));

  return `${SGM_PORTAL_ORIGIN}/portal`;
}

function getOAuthClientIdLogout(): string {
  try {
    const state = getAppStore().getState() as { clientId?: string };
    if (state?.clientId && String(state.clientId).trim()) {
      return String(state.clientId).trim();
    }
  } catch {
    /* ignore */
  }
  return "experienceBuilder";
}

function stripCookiesSgm(): void {
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  const domains = ["sgm.uzspace.uz", ".sgm.uzspace.uz", ".uzspace.uz"];

  try {
    document.cookie.split(";").forEach((cookie) => {
      const [name] = cookie.trim().split("=");
      if (!name) return;

      document.cookie = `${name}=;expires=${expires};path=/`;
      domains.forEach((domain) => {
        document.cookie = `${name}=;expires=${expires};path=/;domain=${domain}`;
      });
    });
  } catch {
    /* ignore */
  }
}

function buildSgmPortalExperienceReauthorizeUrl(opts?: {
  forceLogin?: boolean;
}): string {
  let fromRaw = "";
  try {
    fromRaw = window.top?.location?.href?.split("#")[0] || "";
  } catch {
    fromRaw = "";
  }
  if (!fromRaw) {
    fromRaw = window.location.href.split("#")[0];
  }

  const clientId = getOAuthClientIdLogout();
  const innerUrl = new URL(
    `${SGM_PORTAL_ORIGIN}/portal/apps/experiencebuilder/jimu-core/oauth-callback.html`,
  );
  innerUrl.searchParams.set("clientId", clientId);
  innerUrl.searchParams.set(
    "portal",
    `${SGM_PORTAL_ORIGIN}/portal/sharing/rest/`,
  );
  innerUrl.searchParams.set("popup", "false");
  innerUrl.searchParams.set("isInPortal", "true");
  innerUrl.searchParams.set("isDevEdition", "false");
  innerUrl.searchParams.set("isOutOfExb", "false");
  innerUrl.searchParams.set("mountPath", "/portal/apps/experiencebuilder/");
  innerUrl.searchParams.set("fromUrl", fromRaw);

  const authorizeUrl = new URL(
    `${SGM_PORTAL_ORIGIN}/portal/sharing/rest/oauth2/authorize`,
  );
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "token");
  authorizeUrl.searchParams.set("expiration", "20160");
  authorizeUrl.searchParams.set("redirect_uri", innerUrl.toString());
  authorizeUrl.searchParams.set("state", "experienceBuilder");
  authorizeUrl.searchParams.set("locale", "");
  authorizeUrl.searchParams.set("showSignupOption", "true");
  authorizeUrl.searchParams.set("signupType", "esri");
  authorizeUrl.searchParams.set(
    "force_login",
    opts?.forceLogin ? "true" : "false",
  );

  return authorizeUrl.href;
}

function buildPortalOAuthSignOutUrl(redirectAfterSignOut: string): string {
  const base = getPortalBaseUrlLogout();
  const clientId = getOAuthClientIdLogout();
  return `${base}/sharing/rest/oauth2/signout?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectAfterSignOut)}`;
}

function replaceTopOrSelf(url: string): void {
  try {
    const topWin = window.top;
    if (topWin && topWin !== window) {
      topWin.location.replace(url);
      return;
    }
  } catch {
    /* cross-origin top */
  }
  window.location.replace(url);
}

export async function logoutFromAccount(): Promise<void> {
  try {
    const [IdentityManager] = await loadArcGISJSAPIModules([
      "esri/identity/IdentityManager",
    ]);
    IdentityManager.destroyCredentials();
  } catch {
    /* ignore */
  }

  try {
    localStorage.removeItem("exb_auth");
    localStorage.removeItem("authToken");
    localStorage.removeItem("token");
    localStorage.removeItem("esriJSAPIOAuthData");
    localStorage.removeItem("arcgis_auth_origin");
  } catch {
    /* ignore */
  }

  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }

  try {
    SessionManager.getInstance().signOut();
  } catch {
    /* ignore */
  }

  try {
    const extra: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (/^(esri\.|arcgis|credential\.)/i.test(k)) {
        extra.push(k);
      }
    }
    extra.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }

  stripCookiesSgm();

  const afterSignOut = buildSgmPortalExperienceReauthorizeUrl({
    forceLogin: true,
  });
  replaceTopOrSelf(buildPortalOAuthSignOutUrl(afterSignOut));
}
