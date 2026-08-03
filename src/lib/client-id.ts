// A stable, per-browser id used to attribute anonymous actions (e.g. a solo
// player's video rating) without requiring a sign-in. Persisted in
// localStorage; falls back to a volatile id if storage is unavailable.
export function getClientId(): string {
  try {
    let id = localStorage.getItem("cd_client");
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("cd_client", id);
    }
    return id;
  } catch {
    return "anon";
  }
}
