# Free hosting for the October tournament

The user approved moving the existing app to Cloudflare Free, then clarified that scores are entered after matches. Preserve tournament modes, scheduling, administration, printouts, QR codes, and uploaded team icons. Preserve the existing working changes captured in this branch.

Use one Worker with Express and one D1 database. Retain a local Node entrypoint. Compile the existing EJS views at build time because Workers disallow runtime code generation. Move database calls behind asynchronous adapters; batch multi-statement updates so failures cannot leave a partially replaced schedule or result.

Keep uploaded icons in D1 in bounded base64 text chunks, preserving the existing 5 MiB upload limit without adding R2 or a paid service. Serve icons with versioned URLs and caching; validate raster image formats. Do not include local databases, .env files, or private uploads in static deployment assets.

Public scores refresh every 120 seconds, with a manual Refresh scores link. Pause automatic refresh while a phone tab is hidden. Explain that results are entered after matches; use In progress instead of Live. Never reload an admin score form automatically.

Use only Workers Free, D1 Free, and a workers.dev address. Do not upgrade plans, add payment methods, purchase a domain, or change Railway resources. At 60 phones plus one monitor over eight hours, a 120-second interval generates 14,640 automatic page requests, plus initial loads and navigation. Verify query counts and worker build size; free limits still apply.

Require ADMIN_PIN as a random secret of at least 16 characters for the hosted app. Retain the local fallback for local development only. Validate the complete six-team event and existing multi-group flows with the actual local Workers/D1 runtime, plus existing local tests. Verify restart persistence, upload replacement, authentication, fresh results, and responsive pages. Publish only when Cloudflare account access and its Free plan are verified.

Live measurement adjustment: accept original photos up to 5 MiB in the browser, but resize team icons to at most 256 pixels and 16 KiB before sending. This avoids the large-image CPU cost observed on Workers Free. Use an Image-element decoder fallback and lock competing form controls while an upload is in progress. Both paths were verified in a real browser.
