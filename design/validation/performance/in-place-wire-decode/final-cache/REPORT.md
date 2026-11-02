# sh-ast producer benchmark

Node v24.14.0; darwin/arm64; Apple M5 Max.

Times are milliseconds: median [min, max] of process medians. Positive durations below 0.01 ms display as <0.01. Within-process samples are correlated. Ratios use published 0.3.1 only where work contracts match. Parse ratios compare equal source/comment requests, not equivalent output representations.

| Fixture / dialect  | Phase                | Artifact        | Processes / observations |                      ms |    vs 0.3.1 |
| ------------------ | -------------------- | --------------- | -----------------------: | ----------------------: | ----------: |
| consumer-m2 / bash | parse                | 0.5.0           |                   5 / 50 |    67.74 [59.46, 70.59] | unsupported |
| consumer-m2 / bash | parse                | local-candidate |                   5 / 50 |    61.99 [46.92, 65.35] | unsupported |
| consumer-m2 / bash | parse-with-positions | 0.5.0           |                   5 / 50 | 127.21 [107.53, 131.67] | unsupported |
| consumer-m2 / bash | parse-with-positions | local-candidate |                   5 / 50 | 106.01 [102.37, 114.10] | unsupported |

## Adjacent release comparisons

| Fixture / dialect  | Phase                | Comparison              |       Ratio |
| ------------------ | -------------------- | ----------------------- | ----------: |
| consumer-m2 / bash | parse                | 0.5.0 / 0.4.0           | unsupported |
| consumer-m2 / bash | parse-with-positions | 0.5.0 / 0.4.0           | unsupported |
| consumer-m2 / bash | parse                | local-candidate / 0.5.0 |       0.92x |
| consumer-m2 / bash | parse-with-positions | local-candidate / 0.5.0 |       0.83x |
