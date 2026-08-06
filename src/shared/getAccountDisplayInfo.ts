import { getAppStore } from "jimu-core";

export type AccountDisplayInfo = {
  displayName: string;
  initial: string;
};

function readExbAuthName(raw: string | null): string {
  if (!raw) return "";
  try {
    const authData = JSON.parse(raw) as { email?: string };
    return (authData?.email ?? "").trim();
  } catch {
    return "";
  }
}

function toDisplayInfo(displayName: string): AccountDisplayInfo {
  const name = displayName.trim();
  if (!name) return { displayName: "", initial: "U" };
  return { displayName: name, initial: name.charAt(0).toUpperCase() || "U" };
}

/** Account label from exb_auth or Experience Builder user state (eco-monitoring). */
export function getAccountDisplayInfo(): AccountDisplayInfo {
  const fromLocal = readExbAuthName(localStorage.getItem("exb_auth"));
  if (fromLocal) return toDisplayInfo(fromLocal);

  const fromSession = readExbAuthName(sessionStorage.getItem("exb_auth"));
  if (fromSession) return toDisplayInfo(fromSession);

  try {
    const state = getAppStore().getState() as {
      user?: {
        firstName?: string;
        lastName?: string;
        fullName?: string;
        username?: string;
        email?: string;
      };
    };
    const u = state?.user;
    if (u?.firstName || u?.lastName) {
      return toDisplayInfo([u.firstName, u.lastName].filter(Boolean).join(" "));
    }
    if (u?.fullName?.trim()) return toDisplayInfo(u.fullName);
    if (u?.username?.trim()) return toDisplayInfo(u.username);
    if (u?.email?.trim()) return toDisplayInfo(u.email);
  } catch {
    /* ignore */
  }

  return { displayName: "", initial: "U" };
}
