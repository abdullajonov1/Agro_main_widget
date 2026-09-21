# Agro_widgetV5 — Agro Space Monitoring

Local folder name: `Agro_widgetV5`. Published portal name: `Agro_widgetV6`
(or `Agro-main-widget` if that is the folder/manifest name on the portal).

## Deploy / GitHub → Portal (chunks)

Experience Builder splits some modules into **sibling** files under
`widgets/chunks/`. A widget folder alone is not enough.

When copying a **built** widget to the portal (or GitHub Pages), ship both:

```
widgets/Agro-main-widget/   (or Agro_widgetV6/)
widgets/chunks/             ← must include Agro-*-prefetch-*.js etc.
```

Source-only clone of this repo is for ExB `your-extensions` + `npm start`
(local webpack serves chunks). Registering raw GitHub source as a custom
widget URL will 404 on chunks such as
`…/widgets/chunks/Agro-main-widget_src_gis_agri-vegetation-overlay-prefetch_….js`.

Use `scripts/publish-agro-v6.sh` for a Pages layout that includes `chunks/`.

Popup is loaded eagerly (not `React.lazy`) so overlay-prefetch is not an
extra async chunk dependency for map clicks.

## Access control (important)

Row-level access rules configured in the widget Settings (`accessConfig`) are
**enforced only in the browser** when building ArcGIS WHERE clauses.

**Server-side mirror is mandatory for real security:**

- FeatureServer layer definition query / hosted view matching the same group→row rules
- Portal item sharing that does not expose unrestricted FeatureServer URLs to unauthenticated callers

Until those exist, anyone who can call the FeatureServer REST endpoints directly can bypass the widget UI restriction. Client WHERE building is UX + defense-in-depth only.
