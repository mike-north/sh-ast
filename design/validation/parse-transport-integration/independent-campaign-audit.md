# Independent PR57 public-campaign audit

Delivery lead audited the fixed public timing campaign after it completed. No measurements were rerun and no benchmark source or result was changed.

- Exactly 32 raw records, 32 distinct worker PIDs and 960 measured samples. Every record reports five warmups and 30 measured calls with successful status.
- Every raw record matches the frozen 32-job order, round, operation and alternating artifact arm exactly.
- Recomputed every process median from raw samples, the four medians of eight process medians, and all eight paired absolute gains; all match the report.
- Parse: accepted main 22.06606225 ms, candidate 7.776615 ms. All eight candidate process medians are below 10 ms (range 7.2710415–8.3115835 ms).
- Parse with positions: accepted main 27.2184375 ms, candidate 11.76849975 ms. Aggregate absolute gain 15.44993775 ms exceeds parse gain 14.28944725 ms. Individual paired rounds 2 and 6 (one-based) miss that gain comparison. No every-round guarantee follows.
- At audit time, every frozen harness/input/inventory digest and the verification-file digest matched. This was before the separately planned comment-only diagnostic wording correction.
- Both npm tarball SHA-256 and SHA-512 integrity values match. All 103 extracted package assets in each arm match their manifest digests.
- Recreated git archives and checked all 24 recorded TypeScript source-file digests per arm against exact commits: accepted main 87da64fb2f293c2a247bb365399f0150c43ba2ea and candidate 1431a4f36a82bc4be255baa25ce77d801e9c0d39. Archive hashes and source digests match.
- The package WASM hashes match those exact git commits: main a4c14b9bc1c17013e42429b495284a6c2569feb2ae27b8aface72727c1adc5f8; candidate 327e2875f354e2aa51a347c47f042d1aef1a42c698402b16edcfd4a52077197a.
- Four verify-only worker records agree on 5,801 stored/node records, 100 functions, 5,701 traversal entries and exits, and one transport call with 11,270 source bytes. Those verification observations are separate from timing workers.

The packages retain version 0.7.0 in package metadata; the arms are the exact repository commits above, not the historical published 0.7.0 package. The fixed fixture is named consumer-m2, but this campaign ran Node 22.22.1 on Darwin arm64 / Apple M5 Max. These public parser phases do not establish downstream ESLint end-to-end latency, another machine's latency, arbitrary graph safety, or exclusive Go parse/encode timings. Separate stage diagnostics are not part of this public acceptance calculation.

## Separate diagnostic audit

After the separate stage campaign finished, independently recomputed its 32 distinct-process records and 960 instrumented total observations, every process median and every reported stage median. All match the retained stage report. Accepted-main parse/encode entries contain only unsupported status, with no fabricated samples. Every candidate observation satisfies recorded WASM duration minus the measured parser stage equals the recorded encode residual. This verifies residual accounting, not exclusive encoder attribution. The parser stage includes factory/configuration/reader work. Independently aggregated stage medians need not sum to an aggregate total. These observations were not used to recompute public acceptance or replace any public sample.
