# sh-ast producer benchmark

Node v24.14.0; darwin/arm64; Apple M5 Max.

Times are milliseconds: median [min, max] of process medians. Positive durations below 0.01 ms display as <0.01. Within-process samples are correlated. Ratios use published 0.3.1 only where work contracts match. Parse ratios compare equal source/comment requests, not equivalent output representations.

| Fixture / dialect        | Phase                | Artifact        | Processes / observations |                     ms |    vs 0.3.1 |
| ------------------------ | -------------------- | --------------- | -----------------------: | ---------------------: | ----------: |
| consumer-m2 / bash       | parse                | 0.5.0           |                   5 / 50 |   64.35 [55.17, 67.77] | unsupported |
| consumer-m2 / bash       | parse                | local-candidate |                   5 / 50 |   51.60 [45.88, 53.32] | unsupported |
| consumer-m2 / bash       | parse-with-positions | 0.5.0           |                   5 / 50 | 103.56 [99.82, 107.90] | unsupported |
| consumer-m2 / bash       | parse-with-positions | local-candidate |                   5 / 50 |  94.49 [92.73, 100.64] | unsupported |
| representative-50 / bash | parse                | 0.5.0           |                   5 / 50 |   27.52 [26.08, 30.63] | unsupported |
| representative-50 / bash | parse                | local-candidate |                   5 / 50 |   27.56 [26.63, 29.41] | unsupported |
| representative-50 / bash | parse-with-positions | 0.5.0           |                   5 / 50 |   68.20 [67.32, 72.29] | unsupported |
| representative-50 / bash | parse-with-positions | local-candidate |                   5 / 50 |   65.31 [64.39, 67.00] | unsupported |
| nested-64 / bash         | parse                | 0.5.0           |                   5 / 50 |      4.41 [4.29, 4.60] | unsupported |
| nested-64 / bash         | parse                | local-candidate |                   5 / 50 |      4.13 [3.91, 4.32] | unsupported |
| nested-64 / bash         | parse-with-positions | 0.5.0           |                   5 / 50 |   28.08 [27.40, 30.28] | unsupported |
| nested-64 / bash         | parse-with-positions | local-candidate |                   5 / 50 |   26.69 [26.43, 27.48] | unsupported |
| heredoc / bash           | parse                | 0.5.0           |                   5 / 50 |      0.41 [0.38, 0.45] | unsupported |
| heredoc / bash           | parse                | local-candidate |                   5 / 50 |      0.38 [0.36, 0.43] | unsupported |
| heredoc / bash           | parse-with-positions | 0.5.0           |                   5 / 50 |      0.76 [0.65, 0.80] | unsupported |
| heredoc / bash           | parse-with-positions | local-candidate |                   5 / 50 |      0.76 [0.62, 0.91] | unsupported |

## Adjacent release comparisons

| Fixture / dialect        | Phase                | Comparison              |       Ratio |
| ------------------------ | -------------------- | ----------------------- | ----------: |
| consumer-m2 / bash       | parse                | 0.5.0 / 0.4.0           | unsupported |
| consumer-m2 / bash       | parse-with-positions | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / bash | parse                | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / bash | parse-with-positions | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / bash         | parse                | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / bash         | parse-with-positions | 0.5.0 / 0.4.0           | unsupported |
| heredoc / bash           | parse                | 0.5.0 / 0.4.0           | unsupported |
| heredoc / bash           | parse-with-positions | 0.5.0 / 0.4.0           | unsupported |
| consumer-m2 / bash       | parse                | local-candidate / 0.5.0 |       0.80x |
| consumer-m2 / bash       | parse-with-positions | local-candidate / 0.5.0 |       0.91x |
| representative-50 / bash | parse                | local-candidate / 0.5.0 |       1.00x |
| representative-50 / bash | parse-with-positions | local-candidate / 0.5.0 |       0.96x |
| nested-64 / bash         | parse                | local-candidate / 0.5.0 |       0.93x |
| nested-64 / bash         | parse-with-positions | local-candidate / 0.5.0 |       0.95x |
| heredoc / bash           | parse                | local-candidate / 0.5.0 |       0.94x |
| heredoc / bash           | parse-with-positions | local-candidate / 0.5.0 |       1.00x |
