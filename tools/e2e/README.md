# Browser e2e + stress tests

Real Chromium (Playwright) against the real app. Network is mocked: unpkg (three/leaflet are served from local
`node_modules`), map tiles, and the Overpass API (a synthetic grid city), so no internet is needed.

Setup once (repo root): `npm i three@0.160.0 leaflet@1.9.4` and have `playwright` installed with Chromium.

```
node tools/e2e/traffic-e2e.js     # 15 checks: generate, build, traffic on/off, drive, regenerate (exit code 1 on failure)
node tools/e2e/download-e2e.js    # 11 checks: server failover, busy retry, remembered server, cache
node tools/e2e/stress.js 0.03     # ~3.3 km area = 1,764 buildings: timings, draw calls, triangles, memory, traffic cost
```

Notes
- Chromium here renders with a software GL (SwiftShader), so frame times are NOT real-GPU numbers. Use draw calls,
  triangles and memory (these are the same on a GPU) and judge FPS on real hardware.
- Screenshots go to `tools/e2e/out/` (git-ignored).
- `harness.js` exports `boot({span, out, port})` for writing new scenarios.

Offline downloader tests (no browser): `node tools/test/overpass-test.mjs`
