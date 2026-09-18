# Agro_widgetV5 — Agro Space Monitoring

Local folder name: `Agro_widgetV5`. Published portal name: `Agro_widgetV6`.

## Access control (important)

Row-level access rules configured in the widget Settings (`accessConfig`) are
**enforced only in the browser** when building ArcGIS WHERE clauses.

**Server-side mirror is mandatory for real security:**

- FeatureServer layer definition query / hosted view matching the same group→row rules
- Portal item sharing that does not expose unrestricted FeatureServer URLs to unauthenticated callers

Until those exist, anyone who can call the FeatureServer REST endpoints directly can bypass the widget UI restriction. Client WHERE building is UX + defense-in-depth only.
