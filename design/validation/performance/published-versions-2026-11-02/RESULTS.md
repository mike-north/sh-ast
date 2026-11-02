# sh-ast producer benchmark

Node v24.14.0; darwin/arm64; Apple M5 Max.

Times are milliseconds: median [min, max] of process medians. Positive durations below 0.01 ms display as <0.01. Within-process samples are correlated. Ratios use published 0.3.1 only where work contracts match. Parse ratios compare equal source/comment requests, not equivalent output representations.

| Fixture / dialect         | Phase                | Artifact        | Processes / observations |                      ms |      vs 0.3.1 |
| ------------------------- | -------------------- | --------------- | -----------------------: | ----------------------: | ------------: |
| representative-1 / bash   | import               | 0.3.1           |                    4 / 4 |       3.19 [2.84, 3.52] |         1.00x |
| representative-1 / bash   | import               | 0.4.0           |                    4 / 4 |       3.99 [3.56, 4.29] |         1.25x |
| representative-1 / bash   | import               | 0.5.0           |                    4 / 4 |       5.24 [5.14, 5.85] |         1.65x |
| representative-1 / bash   | import               | local-candidate |                    4 / 4 |       4.80 [4.42, 5.02] |         1.51x |
| representative-1 / bash   | first-parse          | 0.3.1           |                    4 / 4 |    29.89 [29.60, 30.87] |         1.00x |
| representative-1 / bash   | first-parse          | 0.4.0           |                    4 / 4 |    29.13 [28.29, 29.97] |         0.97x |
| representative-1 / bash   | first-parse          | 0.5.0           |                    4 / 4 |    29.43 [28.09, 30.80] |         0.98x |
| representative-1 / bash   | first-parse          | local-candidate |                    4 / 4 |    30.28 [28.38, 31.69] |         1.01x |
| representative-1 / bash   | parse                | 0.3.1           |                   4 / 20 |       0.88 [0.69, 0.95] |         1.00x |
| representative-1 / bash   | parse                | 0.4.0           |                   4 / 20 |       1.28 [1.16, 1.32] |         1.45x |
| representative-1 / bash   | parse                | 0.5.0           |                   4 / 20 |       1.14 [1.06, 1.20] |         1.30x |
| representative-1 / bash   | parse                | local-candidate |                   4 / 20 |       1.10 [0.96, 1.25] |         1.25x |
| representative-1 / bash   | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | parse-with-positions | 0.4.0           |                   4 / 20 |       1.96 [1.79, 2.02] |   unsupported |
| representative-1 / bash   | parse-with-positions | 0.5.0           |                   4 / 20 |       2.02 [1.93, 2.09] |   unsupported |
| representative-1 / bash   | parse-with-positions | local-candidate |                   4 / 20 |       2.07 [1.88, 2.30] |   unsupported |
| representative-1 / bash   | walk                 | 0.3.1           |                   4 / 20 |       0.02 [0.02, 0.03] |         1.00x |
| representative-1 / bash   | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | walk                 | 0.5.0           |                   4 / 20 |       0.02 [0.02, 0.02] | noncomparable |
| representative-1 / bash   | walk                 | local-candidate |                   4 / 20 |       0.02 [0.02, 0.02] | noncomparable |
| representative-1 / bash   | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | bounds-root          | 0.4.0           |                   4 / 20 |       1.72 [1.49, 1.95] |   unsupported |
| representative-1 / bash   | bounds-root          | 0.5.0           |                   4 / 20 |       1.74 [1.59, 1.95] |   unsupported |
| representative-1 / bash   | bounds-root          | local-candidate |                   4 / 20 |       1.71 [1.49, 1.79] |   unsupported |
| representative-1 / bash   | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | bounds-all           | 0.4.0           |                   4 / 20 |    21.63 [20.02, 22.54] |   unsupported |
| representative-1 / bash   | bounds-all           | 0.5.0           |                   4 / 20 |    20.49 [19.73, 22.65] |   unsupported |
| representative-1 / bash   | bounds-all           | local-candidate |                   4 / 20 |    22.08 [20.42, 22.79] |   unsupported |
| representative-1 / bash   | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | snapshot-lookup      | 0.4.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| representative-1 / bash   | snapshot-lookup      | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| representative-1 / bash   | snapshot-lookup      | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| representative-1 / bash   | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | print                | 0.5.0           |                   4 / 20 |       1.20 [1.12, 1.35] |   unsupported |
| representative-1 / bash   | print                | local-candidate |                   4 / 20 |       1.17 [1.10, 1.37] |   unsupported |
| representative-1 / bash   | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-1 / bash   | edited-print         | 0.5.0           |                   4 / 20 |       1.17 [1.12, 1.25] |   unsupported |
| representative-1 / bash   | edited-print         | local-candidate |                   4 / 20 |       1.16 [1.09, 1.29] |   unsupported |
| representative-1 / posix  | import               | 0.3.1           |                    4 / 4 |       3.70 [3.59, 4.05] |         1.00x |
| representative-1 / posix  | import               | 0.4.0           |                    4 / 4 |       4.30 [4.16, 4.92] |         1.16x |
| representative-1 / posix  | import               | 0.5.0           |                    4 / 4 |       5.20 [4.87, 5.27] |         1.41x |
| representative-1 / posix  | import               | local-candidate |                    4 / 4 |       5.09 [4.83, 5.73] |         1.38x |
| representative-1 / posix  | first-parse          | 0.3.1           |                    4 / 4 |    30.23 [26.85, 31.26] |         1.00x |
| representative-1 / posix  | first-parse          | 0.4.0           |                    4 / 4 |    29.21 [28.12, 31.49] |         0.97x |
| representative-1 / posix  | first-parse          | 0.5.0           |                    4 / 4 |    28.85 [27.37, 30.35] |         0.95x |
| representative-1 / posix  | first-parse          | local-candidate |                    4 / 4 |    29.44 [28.62, 31.15] |         0.97x |
| representative-1 / posix  | parse                | 0.3.1           |                   4 / 20 |       0.73 [0.70, 0.84] |         1.00x |
| representative-1 / posix  | parse                | 0.4.0           |                   4 / 20 |       1.25 [1.10, 1.43] |         1.71x |
| representative-1 / posix  | parse                | 0.5.0           |                   4 / 20 |       1.17 [1.08, 1.23] |         1.61x |
| representative-1 / posix  | parse                | local-candidate |                   4 / 20 |       1.17 [0.98, 1.27] |         1.61x |
| representative-1 / posix  | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | parse-with-positions | 0.4.0           |                   4 / 20 |       1.95 [1.84, 2.21] |   unsupported |
| representative-1 / posix  | parse-with-positions | 0.5.0           |                   4 / 20 |       2.10 [1.89, 2.24] |   unsupported |
| representative-1 / posix  | parse-with-positions | local-candidate |                   4 / 20 |       2.01 [1.94, 2.13] |   unsupported |
| representative-1 / posix  | walk                 | 0.3.1           |                   4 / 20 |       0.02 [0.02, 0.03] |         1.00x |
| representative-1 / posix  | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | walk                 | 0.5.0           |                   4 / 20 |       0.02 [0.01, 0.02] | noncomparable |
| representative-1 / posix  | walk                 | local-candidate |                   4 / 20 |       0.02 [0.02, 0.02] | noncomparable |
| representative-1 / posix  | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | bounds-root          | 0.4.0           |                   4 / 20 |       1.53 [1.42, 1.67] |   unsupported |
| representative-1 / posix  | bounds-root          | 0.5.0           |                   4 / 20 |       1.71 [1.65, 1.94] |   unsupported |
| representative-1 / posix  | bounds-root          | local-candidate |                   4 / 20 |       1.65 [1.38, 1.99] |   unsupported |
| representative-1 / posix  | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | bounds-all           | 0.4.0           |                   4 / 20 |    20.53 [19.00, 22.55] |   unsupported |
| representative-1 / posix  | bounds-all           | 0.5.0           |                   4 / 20 |    20.63 [19.14, 21.34] |   unsupported |
| representative-1 / posix  | bounds-all           | local-candidate |                   4 / 20 |    20.21 [19.90, 20.61] |   unsupported |
| representative-1 / posix  | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | snapshot-lookup      | 0.4.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| representative-1 / posix  | snapshot-lookup      | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| representative-1 / posix  | snapshot-lookup      | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| representative-1 / posix  | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | print                | 0.5.0           |                   4 / 20 |       1.06 [0.97, 1.19] |   unsupported |
| representative-1 / posix  | print                | local-candidate |                   4 / 20 |       1.11 [1.06, 1.12] |   unsupported |
| representative-1 / posix  | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-1 / posix  | edited-print         | 0.5.0           |                   4 / 20 |       0.99 [0.89, 1.15] |   unsupported |
| representative-1 / posix  | edited-print         | local-candidate |                   4 / 20 |       1.06 [0.91, 1.18] |   unsupported |
| representative-50 / bash  | import               | 0.3.1           |                    4 / 4 |       2.40 [2.28, 3.43] |         1.00x |
| representative-50 / bash  | import               | 0.4.0           |                    4 / 4 |       3.33 [2.93, 3.47] |         1.39x |
| representative-50 / bash  | import               | 0.5.0           |                    4 / 4 |       3.72 [3.53, 4.13] |         1.55x |
| representative-50 / bash  | import               | local-candidate |                    4 / 4 |       3.68 [3.43, 4.04] |         1.53x |
| representative-50 / bash  | first-parse          | 0.3.1           |                    4 / 4 |    55.02 [50.50, 57.54] |         1.00x |
| representative-50 / bash  | first-parse          | 0.4.0           |                    4 / 4 |    73.27 [72.58, 76.01] |         1.33x |
| representative-50 / bash  | first-parse          | 0.5.0           |                    4 / 4 |    75.56 [74.54, 78.77] |         1.37x |
| representative-50 / bash  | first-parse          | local-candidate |                    4 / 4 |    75.67 [73.27, 78.42] |         1.38x |
| representative-50 / bash  | parse                | 0.3.1           |                   4 / 20 |    18.97 [17.95, 20.81] |         1.00x |
| representative-50 / bash  | parse                | 0.4.0           |                   4 / 20 |    32.30 [25.51, 34.36] |         1.70x |
| representative-50 / bash  | parse                | 0.5.0           |                   4 / 20 |    35.06 [33.75, 37.00] |         1.85x |
| representative-50 / bash  | parse                | local-candidate |                   4 / 20 |    32.34 [28.02, 34.78] |         1.71x |
| representative-50 / bash  | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | parse-with-positions | 0.4.0           |                   4 / 20 |    75.46 [66.52, 83.31] |   unsupported |
| representative-50 / bash  | parse-with-positions | 0.5.0           |                   4 / 20 |    73.25 [70.48, 76.55] |   unsupported |
| representative-50 / bash  | parse-with-positions | local-candidate |                   4 / 20 |    74.05 [72.08, 78.33] |   unsupported |
| representative-50 / bash  | walk                 | 0.3.1           |                   4 / 20 |       0.41 [0.36, 0.52] |         1.00x |
| representative-50 / bash  | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | walk                 | 0.5.0           |                   4 / 20 |       0.16 [0.13, 0.21] | noncomparable |
| representative-50 / bash  | walk                 | local-candidate |                   4 / 20 |       0.20 [0.16, 0.27] | noncomparable |
| representative-50 / bash  | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | bounds-root          | 0.4.0           |                   4 / 20 |    78.30 [70.29, 79.62] |   unsupported |
| representative-50 / bash  | bounds-root          | 0.5.0           |                   4 / 20 |    78.68 [77.94, 80.27] |   unsupported |
| representative-50 / bash  | bounds-root          | local-candidate |                   4 / 20 |    74.72 [70.43, 88.36] |   unsupported |
| representative-50 / bash  | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | bounds-all           | 0.4.0           |                   4 / 20 | 904.63 [763.70, 994.71] |   unsupported |
| representative-50 / bash  | bounds-all           | 0.5.0           |                   4 / 20 | 899.11 [783.57, 971.75] |   unsupported |
| representative-50 / bash  | bounds-all           | local-candidate |                   4 / 20 | 843.64 [790.54, 943.06] |   unsupported |
| representative-50 / bash  | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | snapshot-lookup      | 0.4.0           |                   4 / 20 |       0.07 [0.07, 0.11] |   unsupported |
| representative-50 / bash  | snapshot-lookup      | 0.5.0           |                   4 / 20 |       0.07 [0.07, 0.07] |   unsupported |
| representative-50 / bash  | snapshot-lookup      | local-candidate |                   4 / 20 |       0.07 [0.07, 0.07] |   unsupported |
| representative-50 / bash  | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | print                | 0.5.0           |                   4 / 20 |    35.03 [32.32, 39.16] |   unsupported |
| representative-50 / bash  | print                | local-candidate |                   4 / 20 |    31.13 [30.64, 42.02] |   unsupported |
| representative-50 / bash  | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-50 / bash  | edited-print         | 0.5.0           |                   4 / 20 |    29.18 [27.46, 32.77] |   unsupported |
| representative-50 / bash  | edited-print         | local-candidate |                   4 / 20 |    29.99 [29.37, 30.87] |   unsupported |
| representative-50 / posix | import               | 0.3.1           |                    4 / 4 |       2.19 [2.15, 2.25] |         1.00x |
| representative-50 / posix | import               | 0.4.0           |                    4 / 4 |       2.69 [2.62, 2.77] |         1.23x |
| representative-50 / posix | import               | 0.5.0           |                    4 / 4 |       3.31 [3.29, 3.45] |         1.51x |
| representative-50 / posix | import               | local-candidate |                    4 / 4 |       3.34 [3.21, 3.41] |         1.52x |
| representative-50 / posix | first-parse          | 0.3.1           |                    4 / 4 |    50.06 [49.23, 50.90] |         1.00x |
| representative-50 / posix | first-parse          | 0.4.0           |                    4 / 4 |    67.69 [66.87, 70.38] |         1.35x |
| representative-50 / posix | first-parse          | 0.5.0           |                    4 / 4 |    67.18 [66.50, 68.75] |         1.34x |
| representative-50 / posix | first-parse          | local-candidate |                    4 / 4 |    67.76 [66.64, 69.93] |         1.35x |
| representative-50 / posix | parse                | 0.3.1           |                   4 / 20 |    17.33 [17.24, 17.55] |         1.00x |
| representative-50 / posix | parse                | 0.4.0           |                   4 / 20 |    25.46 [24.84, 28.99] |         1.47x |
| representative-50 / posix | parse                | 0.5.0           |                   4 / 20 |    24.74 [24.14, 27.10] |         1.43x |
| representative-50 / posix | parse                | local-candidate |                   4 / 20 |    27.99 [24.66, 31.50] |         1.62x |
| representative-50 / posix | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | parse-with-positions | 0.4.0           |                   4 / 20 |    69.24 [66.60, 70.92] |   unsupported |
| representative-50 / posix | parse-with-positions | 0.5.0           |                   4 / 20 |    68.43 [64.12, 72.42] |   unsupported |
| representative-50 / posix | parse-with-positions | local-candidate |                   4 / 20 |    66.28 [64.09, 67.80] |   unsupported |
| representative-50 / posix | walk                 | 0.3.1           |                   4 / 20 |       0.35 [0.35, 0.36] |         1.00x |
| representative-50 / posix | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | walk                 | 0.5.0           |                   4 / 20 |       0.14 [0.13, 0.17] | noncomparable |
| representative-50 / posix | walk                 | local-candidate |                   4 / 20 |       0.14 [0.13, 0.15] | noncomparable |
| representative-50 / posix | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | bounds-root          | 0.4.0           |                   4 / 20 |    72.11 [63.37, 73.29] |   unsupported |
| representative-50 / posix | bounds-root          | 0.5.0           |                   4 / 20 |    71.81 [68.07, 79.70] |   unsupported |
| representative-50 / posix | bounds-root          | local-candidate |                   4 / 20 |    71.06 [68.23, 74.36] |   unsupported |
| representative-50 / posix | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | bounds-all           | 0.4.0           |                   4 / 20 | 778.56 [736.33, 797.90] |   unsupported |
| representative-50 / posix | bounds-all           | 0.5.0           |                   4 / 20 | 758.05 [741.88, 772.27] |   unsupported |
| representative-50 / posix | bounds-all           | local-candidate |                   4 / 20 | 787.91 [761.98, 802.67] |   unsupported |
| representative-50 / posix | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | snapshot-lookup      | 0.4.0           |                   4 / 20 |       0.07 [0.06, 0.07] |   unsupported |
| representative-50 / posix | snapshot-lookup      | 0.5.0           |                   4 / 20 |       0.07 [0.06, 0.07] |   unsupported |
| representative-50 / posix | snapshot-lookup      | local-candidate |                   4 / 20 |       0.07 [0.07, 0.07] |   unsupported |
| representative-50 / posix | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | print                | 0.5.0           |                   4 / 20 |    31.48 [29.12, 32.27] |   unsupported |
| representative-50 / posix | print                | local-candidate |                   4 / 20 |    33.05 [32.26, 34.43] |   unsupported |
| representative-50 / posix | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| representative-50 / posix | edited-print         | 0.5.0           |                   4 / 20 |    31.06 [29.18, 32.61] |   unsupported |
| representative-50 / posix | edited-print         | local-candidate |                   4 / 20 |    28.64 [28.15, 31.29] |   unsupported |
| nested-8 / bash           | import               | 0.3.1           |                    4 / 4 |       2.66 [2.64, 2.74] |         1.00x |
| nested-8 / bash           | import               | 0.4.0           |                    4 / 4 |       3.07 [2.88, 3.23] |         1.15x |
| nested-8 / bash           | import               | 0.5.0           |                    4 / 4 |       3.77 [3.68, 3.88] |         1.42x |
| nested-8 / bash           | import               | local-candidate |                    4 / 4 |       3.88 [3.62, 4.09] |         1.46x |
| nested-8 / bash           | first-parse          | 0.3.1           |                    4 / 4 |    24.04 [23.56, 25.00] |         1.00x |
| nested-8 / bash           | first-parse          | 0.4.0           |                    4 / 4 |    24.62 [24.48, 24.77] |         1.02x |
| nested-8 / bash           | first-parse          | 0.5.0           |                    4 / 4 |    25.11 [24.85, 25.49] |         1.04x |
| nested-8 / bash           | first-parse          | local-candidate |                    4 / 4 |    25.19 [24.29, 25.47] |         1.05x |
| nested-8 / bash           | parse                | 0.3.1           |                   4 / 20 |       1.06 [0.98, 1.39] |         1.00x |
| nested-8 / bash           | parse                | 0.4.0           |                   4 / 20 |       1.30 [1.15, 1.61] |         1.23x |
| nested-8 / bash           | parse                | 0.5.0           |                   4 / 20 |       1.17 [1.12, 1.29] |         1.10x |
| nested-8 / bash           | parse                | local-candidate |                   4 / 20 |       1.12 [1.04, 1.44] |         1.06x |
| nested-8 / bash           | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | parse-with-positions | 0.4.0           |                   4 / 20 |       3.03 [2.74, 3.27] |   unsupported |
| nested-8 / bash           | parse-with-positions | 0.5.0           |                   4 / 20 |       2.90 [2.71, 3.63] |   unsupported |
| nested-8 / bash           | parse-with-positions | local-candidate |                   4 / 20 |       3.12 [2.78, 3.26] |   unsupported |
| nested-8 / bash           | walk                 | 0.3.1           |                   4 / 20 |       0.03 [0.03, 0.05] |         1.00x |
| nested-8 / bash           | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | walk                 | 0.5.0           |                   4 / 20 |       0.02 [0.01, 0.02] | noncomparable |
| nested-8 / bash           | walk                 | local-candidate |                   4 / 20 |       0.02 [0.01, 0.02] | noncomparable |
| nested-8 / bash           | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | bounds-root          | 0.4.0           |                   4 / 20 |       2.33 [2.07, 2.68] |   unsupported |
| nested-8 / bash           | bounds-root          | 0.5.0           |                   4 / 20 |       2.27 [2.22, 2.49] |   unsupported |
| nested-8 / bash           | bounds-root          | local-candidate |                   4 / 20 |       2.71 [2.33, 3.42] |   unsupported |
| nested-8 / bash           | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | bounds-all           | 0.4.0           |                   4 / 20 |    36.29 [35.63, 36.88] |   unsupported |
| nested-8 / bash           | bounds-all           | 0.5.0           |                   4 / 20 |    36.41 [35.98, 37.69] |   unsupported |
| nested-8 / bash           | bounds-all           | local-candidate |                   4 / 20 |    36.43 [36.26, 36.73] |   unsupported |
| nested-8 / bash           | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | snapshot-lookup      | 0.4.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| nested-8 / bash           | snapshot-lookup      | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| nested-8 / bash           | snapshot-lookup      | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| nested-8 / bash           | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | print                | 0.5.0           |                   4 / 20 |       1.20 [1.14, 1.33] |   unsupported |
| nested-8 / bash           | print                | local-candidate |                   4 / 20 |       1.23 [1.13, 1.29] |   unsupported |
| nested-8 / bash           | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-8 / bash           | edited-print         | 0.5.0           |                   4 / 20 |       1.32 [1.29, 1.46] |   unsupported |
| nested-8 / bash           | edited-print         | local-candidate |                   4 / 20 |       1.33 [1.16, 1.44] |   unsupported |
| nested-8 / posix          | import               | 0.3.1           |                    4 / 4 |       2.68 [2.48, 2.73] |         1.00x |
| nested-8 / posix          | import               | 0.4.0           |                    4 / 4 |       3.07 [3.04, 3.15] |         1.15x |
| nested-8 / posix          | import               | 0.5.0           |                    4 / 4 |       3.81 [3.53, 4.07] |         1.42x |
| nested-8 / posix          | import               | local-candidate |                    4 / 4 |       3.77 [3.55, 4.32] |         1.41x |
| nested-8 / posix          | first-parse          | 0.3.1           |                    4 / 4 |    24.35 [23.73, 24.63] |         1.00x |
| nested-8 / posix          | first-parse          | 0.4.0           |                    4 / 4 |    24.52 [24.30, 24.78] |         1.01x |
| nested-8 / posix          | first-parse          | 0.5.0           |                    4 / 4 |    24.71 [24.59, 25.16] |         1.01x |
| nested-8 / posix          | first-parse          | local-candidate |                    4 / 4 |    24.90 [24.80, 25.67] |         1.02x |
| nested-8 / posix          | parse                | 0.3.1           |                   4 / 20 |       1.10 [0.94, 1.33] |         1.00x |
| nested-8 / posix          | parse                | 0.4.0           |                   4 / 20 |       1.14 [1.04, 1.62] |         1.04x |
| nested-8 / posix          | parse                | 0.5.0           |                   4 / 20 |       1.11 [1.05, 1.18] |         1.01x |
| nested-8 / posix          | parse                | local-candidate |                   4 / 20 |       1.16 [1.14, 1.17] |         1.06x |
| nested-8 / posix          | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | parse-with-positions | 0.4.0           |                   4 / 20 |       2.72 [2.62, 2.78] |   unsupported |
| nested-8 / posix          | parse-with-positions | 0.5.0           |                   4 / 20 |       2.72 [2.59, 2.75] |   unsupported |
| nested-8 / posix          | parse-with-positions | local-candidate |                   4 / 20 |       2.59 [2.58, 2.75] |   unsupported |
| nested-8 / posix          | walk                 | 0.3.1           |                   4 / 20 |       0.04 [0.03, 0.05] |         1.00x |
| nested-8 / posix          | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | walk                 | 0.5.0           |                   4 / 20 |       0.02 [0.02, 0.02] | noncomparable |
| nested-8 / posix          | walk                 | local-candidate |                   4 / 20 |       0.02 [0.02, 0.02] | noncomparable |
| nested-8 / posix          | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | bounds-root          | 0.4.0           |                   4 / 20 |       2.09 [2.02, 2.27] |   unsupported |
| nested-8 / posix          | bounds-root          | 0.5.0           |                   4 / 20 |       1.96 [1.93, 2.12] |   unsupported |
| nested-8 / posix          | bounds-root          | local-candidate |                   4 / 20 |       1.97 [1.92, 2.13] |   unsupported |
| nested-8 / posix          | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | bounds-all           | 0.4.0           |                   4 / 20 |    39.82 [37.77, 41.50] |   unsupported |
| nested-8 / posix          | bounds-all           | 0.5.0           |                   4 / 20 |    38.00 [36.61, 44.21] |   unsupported |
| nested-8 / posix          | bounds-all           | local-candidate |                   4 / 20 |    41.42 [38.02, 42.47] |   unsupported |
| nested-8 / posix          | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | snapshot-lookup      | 0.4.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| nested-8 / posix          | snapshot-lookup      | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| nested-8 / posix          | snapshot-lookup      | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| nested-8 / posix          | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | print                | 0.5.0           |                   4 / 20 |       1.32 [1.27, 1.50] |   unsupported |
| nested-8 / posix          | print                | local-candidate |                   4 / 20 |       1.27 [1.21, 1.70] |   unsupported |
| nested-8 / posix          | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-8 / posix          | edited-print         | 0.5.0           |                   4 / 20 |       1.27 [1.21, 1.37] |   unsupported |
| nested-8 / posix          | edited-print         | local-candidate |                   4 / 20 |       1.31 [1.21, 1.46] |   unsupported |
| nested-64 / bash          | import               | 0.3.1           |                    4 / 4 |       2.65 [2.55, 2.94] |         1.00x |
| nested-64 / bash          | import               | 0.4.0           |                    4 / 4 |       3.14 [2.90, 3.35] |         1.18x |
| nested-64 / bash          | import               | 0.5.0           |                    4 / 4 |       3.68 [3.60, 4.11] |         1.39x |
| nested-64 / bash          | import               | local-candidate |                    4 / 4 |       3.76 [3.56, 3.86] |         1.42x |
| nested-64 / bash          | first-parse          | 0.3.1           |                    4 / 4 |    32.56 [31.35, 35.29] |         1.00x |
| nested-64 / bash          | first-parse          | 0.4.0           |                    4 / 4 |    33.90 [33.15, 34.72] |         1.04x |
| nested-64 / bash          | first-parse          | 0.5.0           |                    4 / 4 |    33.58 [32.80, 35.56] |         1.03x |
| nested-64 / bash          | first-parse          | local-candidate |                    4 / 4 |    34.11 [32.65, 39.24] |         1.05x |
| nested-64 / bash          | parse                | 0.3.1           |                   4 / 20 |       3.95 [3.79, 4.39] |         1.00x |
| nested-64 / bash          | parse                | 0.4.0           |                   4 / 20 |       5.66 [5.33, 7.17] |         1.43x |
| nested-64 / bash          | parse                | 0.5.0           |                   4 / 20 |       6.43 [5.68, 6.98] |         1.63x |
| nested-64 / bash          | parse                | local-candidate |                   4 / 20 |       5.82 [5.13, 6.12] |         1.47x |
| nested-64 / bash          | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | parse-with-positions | 0.4.0           |                   4 / 20 |    30.93 [28.22, 33.95] |   unsupported |
| nested-64 / bash          | parse-with-positions | 0.5.0           |                   4 / 20 |    30.85 [29.05, 34.33] |   unsupported |
| nested-64 / bash          | parse-with-positions | local-candidate |                   4 / 20 |    29.89 [29.07, 30.42] |   unsupported |
| nested-64 / bash          | walk                 | 0.3.1           |                   4 / 20 |       0.06 [0.06, 0.07] |         1.00x |
| nested-64 / bash          | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | walk                 | 0.5.0           |                   4 / 20 |       0.03 [0.02, 0.04] | noncomparable |
| nested-64 / bash          | walk                 | local-candidate |                   4 / 20 |       0.04 [0.03, 0.06] | noncomparable |
| nested-64 / bash          | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | bounds-root          | 0.4.0           |                   4 / 20 |    11.39 [10.94, 12.06] |   unsupported |
| nested-64 / bash          | bounds-root          | 0.5.0           |                   4 / 20 |    11.23 [10.65, 11.99] |   unsupported |
| nested-64 / bash          | bounds-root          | local-candidate |                   4 / 20 |    11.31 [10.54, 12.17] |   unsupported |
| nested-64 / bash          | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | bounds-all           | 0.4.0           |                   4 / 20 | 751.83 [728.38, 769.11] |   unsupported |
| nested-64 / bash          | bounds-all           | 0.5.0           |                   4 / 20 | 759.40 [733.53, 796.49] |   unsupported |
| nested-64 / bash          | bounds-all           | local-candidate |                   4 / 20 | 762.34 [755.60, 773.05] |   unsupported |
| nested-64 / bash          | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | snapshot-lookup      | 0.4.0           |                   4 / 20 |     <0.01 [<0.01, 0.01] |   unsupported |
| nested-64 / bash          | snapshot-lookup      | 0.5.0           |                   4 / 20 |     <0.01 [<0.01, 0.01] |   unsupported |
| nested-64 / bash          | snapshot-lookup      | local-candidate |                   4 / 20 |      0.01 [<0.01, 0.02] |   unsupported |
| nested-64 / bash          | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | print                | 0.5.0           |                   4 / 20 |       6.77 [6.68, 6.93] |   unsupported |
| nested-64 / bash          | print                | local-candidate |                   4 / 20 |       6.72 [6.60, 6.86] |   unsupported |
| nested-64 / bash          | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-64 / bash          | edited-print         | 0.5.0           |                   4 / 20 |       6.68 [6.45, 6.81] |   unsupported |
| nested-64 / bash          | edited-print         | local-candidate |                   4 / 20 |       6.71 [6.27, 7.09] |   unsupported |
| nested-64 / posix         | import               | 0.3.1           |                    4 / 4 |       2.70 [2.55, 3.36] |         1.00x |
| nested-64 / posix         | import               | 0.4.0           |                    4 / 4 |       3.38 [3.09, 3.91] |         1.25x |
| nested-64 / posix         | import               | 0.5.0           |                    4 / 4 |       3.89 [3.70, 4.17] |         1.44x |
| nested-64 / posix         | import               | local-candidate |                    4 / 4 |       3.86 [3.64, 4.13] |         1.43x |
| nested-64 / posix         | first-parse          | 0.3.1           |                    4 / 4 |    34.28 [30.89, 34.65] |         1.00x |
| nested-64 / posix         | first-parse          | 0.4.0           |                    4 / 4 |    34.59 [32.76, 36.38] |         1.01x |
| nested-64 / posix         | first-parse          | 0.5.0           |                    4 / 4 |    36.07 [32.87, 38.14] |         1.05x |
| nested-64 / posix         | first-parse          | local-candidate |                    4 / 4 |    35.01 [34.12, 35.75] |         1.02x |
| nested-64 / posix         | parse                | 0.3.1           |                   4 / 20 |       3.52 [3.42, 3.66] |         1.00x |
| nested-64 / posix         | parse                | 0.4.0           |                   4 / 20 |       4.98 [4.63, 6.03] |         1.42x |
| nested-64 / posix         | parse                | 0.5.0           |                   4 / 20 |       5.39 [4.86, 5.85] |         1.53x |
| nested-64 / posix         | parse                | local-candidate |                   4 / 20 |       5.82 [4.85, 5.90] |         1.66x |
| nested-64 / posix         | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | parse-with-positions | 0.4.0           |                   4 / 20 |    30.30 [27.68, 31.50] |   unsupported |
| nested-64 / posix         | parse-with-positions | 0.5.0           |                   4 / 20 |    30.20 [28.94, 30.93] |   unsupported |
| nested-64 / posix         | parse-with-positions | local-candidate |                   4 / 20 |    30.66 [28.43, 33.14] |   unsupported |
| nested-64 / posix         | walk                 | 0.3.1           |                   4 / 20 |       0.07 [0.07, 0.08] |         1.00x |
| nested-64 / posix         | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | walk                 | 0.5.0           |                   4 / 20 |       0.03 [0.02, 0.04] | noncomparable |
| nested-64 / posix         | walk                 | local-candidate |                   4 / 20 |       0.03 [0.03, 0.04] | noncomparable |
| nested-64 / posix         | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | bounds-root          | 0.4.0           |                   4 / 20 |    11.90 [11.19, 12.21] |   unsupported |
| nested-64 / posix         | bounds-root          | 0.5.0           |                   4 / 20 |    11.92 [11.31, 12.24] |   unsupported |
| nested-64 / posix         | bounds-root          | local-candidate |                   4 / 20 |    12.60 [11.46, 13.69] |   unsupported |
| nested-64 / posix         | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | bounds-all           | 0.4.0           |                   4 / 20 | 737.01 [722.76, 771.16] |   unsupported |
| nested-64 / posix         | bounds-all           | 0.5.0           |                   4 / 20 | 751.48 [723.52, 883.97] |   unsupported |
| nested-64 / posix         | bounds-all           | local-candidate |                   4 / 20 | 739.18 [720.80, 761.10] |   unsupported |
| nested-64 / posix         | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | snapshot-lookup      | 0.4.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| nested-64 / posix         | snapshot-lookup      | 0.5.0           |                   4 / 20 |      0.01 [<0.01, 0.01] |   unsupported |
| nested-64 / posix         | snapshot-lookup      | local-candidate |                   4 / 20 |      0.01 [<0.01, 0.01] |   unsupported |
| nested-64 / posix         | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | print                | 0.5.0           |                   4 / 20 |       6.10 [5.94, 6.24] |   unsupported |
| nested-64 / posix         | print                | local-candidate |                   4 / 20 |       6.02 [5.84, 6.22] |   unsupported |
| nested-64 / posix         | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| nested-64 / posix         | edited-print         | 0.5.0           |                   4 / 20 |       5.99 [5.76, 6.25] |   unsupported |
| nested-64 / posix         | edited-print         | local-candidate |                   4 / 20 |       5.96 [5.82, 6.13] |   unsupported |
| heredoc / bash            | import               | 0.3.1           |                    4 / 4 |       2.59 [2.47, 2.66] |         1.00x |
| heredoc / bash            | import               | 0.4.0           |                    4 / 4 |       3.07 [3.00, 3.13] |         1.19x |
| heredoc / bash            | import               | 0.5.0           |                    4 / 4 |       3.78 [3.69, 3.82] |         1.46x |
| heredoc / bash            | import               | local-candidate |                    4 / 4 |       3.75 [3.62, 3.78] |         1.45x |
| heredoc / bash            | first-parse          | 0.3.1           |                    4 / 4 |    22.43 [21.99, 23.00] |         1.00x |
| heredoc / bash            | first-parse          | 0.4.0           |                    4 / 4 |    22.97 [22.61, 23.69] |         1.02x |
| heredoc / bash            | first-parse          | 0.5.0           |                    4 / 4 |    22.89 [22.23, 23.58] |         1.02x |
| heredoc / bash            | first-parse          | local-candidate |                    4 / 4 |    22.95 [22.94, 29.87] |         1.02x |
| heredoc / bash            | parse                | 0.3.1           |                   4 / 20 |       0.37 [0.34, 0.38] |         1.00x |
| heredoc / bash            | parse                | 0.4.0           |                   4 / 20 |       0.51 [0.41, 0.62] |         1.39x |
| heredoc / bash            | parse                | 0.5.0           |                   4 / 20 |       0.57 [0.47, 0.63] |         1.56x |
| heredoc / bash            | parse                | local-candidate |                   4 / 20 |       0.54 [0.43, 0.64] |         1.47x |
| heredoc / bash            | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | parse-with-positions | 0.4.0           |                   4 / 20 |       0.82 [0.76, 1.03] |   unsupported |
| heredoc / bash            | parse-with-positions | 0.5.0           |                   4 / 20 |       0.81 [0.77, 0.94] |   unsupported |
| heredoc / bash            | parse-with-positions | local-candidate |                   4 / 20 |       0.77 [0.73, 0.85] |   unsupported |
| heredoc / bash            | walk                 | 0.3.1           |                   4 / 20 |      0.01 [<0.01, 0.02] |         1.00x |
| heredoc / bash            | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | walk                 | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] | noncomparable |
| heredoc / bash            | walk                 | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] | noncomparable |
| heredoc / bash            | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | bounds-root          | 0.4.0           |                   4 / 20 |       0.89 [0.64, 0.89] |   unsupported |
| heredoc / bash            | bounds-root          | 0.5.0           |                   4 / 20 |       1.11 [0.91, 1.28] |   unsupported |
| heredoc / bash            | bounds-root          | local-candidate |                   4 / 20 |       0.94 [0.78, 1.05] |   unsupported |
| heredoc / bash            | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | bounds-all           | 0.4.0           |                   4 / 20 |       3.99 [3.60, 4.59] |   unsupported |
| heredoc / bash            | bounds-all           | 0.5.0           |                   4 / 20 |       4.18 [3.81, 4.88] |   unsupported |
| heredoc / bash            | bounds-all           | local-candidate |                   4 / 20 |       4.07 [3.63, 4.42] |   unsupported |
| heredoc / bash            | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | snapshot-lookup      | 0.4.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| heredoc / bash            | snapshot-lookup      | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| heredoc / bash            | snapshot-lookup      | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| heredoc / bash            | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | print                | 0.5.0           |                   4 / 20 |       0.48 [0.40, 0.53] |   unsupported |
| heredoc / bash            | print                | local-candidate |                   4 / 20 |       0.47 [0.45, 0.64] |   unsupported |
| heredoc / bash            | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| heredoc / bash            | edited-print         | 0.5.0           |                   4 / 20 |       0.59 [0.49, 0.65] |   unsupported |
| heredoc / bash            | edited-print         | local-candidate |                   4 / 20 |       0.54 [0.45, 0.59] |   unsupported |
| heredoc / posix           | import               | 0.3.1           |                    4 / 4 |       3.17 [2.65, 3.79] |         1.00x |
| heredoc / posix           | import               | 0.4.0           |                    4 / 4 |       3.49 [3.40, 3.63] |         1.10x |
| heredoc / posix           | import               | 0.5.0           |                    4 / 4 |       4.29 [4.15, 5.19] |         1.35x |
| heredoc / posix           | import               | local-candidate |                    4 / 4 |       4.24 [4.09, 4.67] |         1.34x |
| heredoc / posix           | first-parse          | 0.3.1           |                    4 / 4 |    25.77 [24.96, 30.64] |         1.00x |
| heredoc / posix           | first-parse          | 0.4.0           |                    4 / 4 |    26.95 [25.77, 27.35] |         1.05x |
| heredoc / posix           | first-parse          | 0.5.0           |                    4 / 4 |    27.07 [26.16, 27.33] |         1.05x |
| heredoc / posix           | first-parse          | local-candidate |                    4 / 4 |    28.06 [27.00, 31.68] |         1.09x |
| heredoc / posix           | parse                | 0.3.1           |                   4 / 20 |       0.41 [0.33, 0.42] |         1.00x |
| heredoc / posix           | parse                | 0.4.0           |                   4 / 20 |       0.53 [0.44, 0.64] |         1.31x |
| heredoc / posix           | parse                | 0.5.0           |                   4 / 20 |       0.56 [0.52, 0.66] |         1.38x |
| heredoc / posix           | parse                | local-candidate |                   4 / 20 |       0.57 [0.55, 0.60] |         1.40x |
| heredoc / posix           | parse-with-positions | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | parse-with-positions | 0.4.0           |                   4 / 20 |       0.93 [0.78, 1.01] |   unsupported |
| heredoc / posix           | parse-with-positions | 0.5.0           |                   4 / 20 |       0.90 [0.84, 0.95] |   unsupported |
| heredoc / posix           | parse-with-positions | local-candidate |                   4 / 20 |       0.92 [0.82, 0.93] |   unsupported |
| heredoc / posix           | walk                 | 0.3.1           |                   4 / 20 |     <0.01 [<0.01, 0.01] |         1.00x |
| heredoc / posix           | walk                 | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | walk                 | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] | noncomparable |
| heredoc / posix           | walk                 | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] | noncomparable |
| heredoc / posix           | bounds-root          | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | bounds-root          | 0.4.0           |                   4 / 20 |       0.83 [0.68, 0.92] |   unsupported |
| heredoc / posix           | bounds-root          | 0.5.0           |                   4 / 20 |       1.03 [0.97, 1.17] |   unsupported |
| heredoc / posix           | bounds-root          | local-candidate |                   4 / 20 |       0.98 [0.88, 1.17] |   unsupported |
| heredoc / posix           | bounds-all           | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | bounds-all           | 0.4.0           |                   4 / 20 |       3.83 [3.68, 4.01] |   unsupported |
| heredoc / posix           | bounds-all           | 0.5.0           |                   4 / 20 |       3.94 [3.79, 4.06] |   unsupported |
| heredoc / posix           | bounds-all           | local-candidate |                   4 / 20 |       3.87 [3.74, 3.95] |   unsupported |
| heredoc / posix           | snapshot-lookup      | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | snapshot-lookup      | 0.4.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| heredoc / posix           | snapshot-lookup      | 0.5.0           |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| heredoc / posix           | snapshot-lookup      | local-candidate |                   4 / 20 |    <0.01 [<0.01, <0.01] |   unsupported |
| heredoc / posix           | print                | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | print                | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | print                | 0.5.0           |                   4 / 20 |       0.55 [0.44, 0.60] |   unsupported |
| heredoc / posix           | print                | local-candidate |                   4 / 20 |       0.46 [0.44, 0.53] |   unsupported |
| heredoc / posix           | edited-print         | 0.3.1           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | edited-print         | 0.4.0           |                    4 / — |             unsupported |   unsupported |
| heredoc / posix           | edited-print         | 0.5.0           |                   4 / 20 |       0.55 [0.43, 0.57] |   unsupported |
| heredoc / posix           | edited-print         | local-candidate |                   4 / 20 |       0.62 [0.55, 0.66] |   unsupported |

## Adjacent release comparisons

| Fixture / dialect         | Phase                | Comparison              |       Ratio |
| ------------------------- | -------------------- | ----------------------- | ----------: |
| representative-1 / bash   | import               | 0.4.0 / 0.3.1           |       1.25x |
| representative-1 / bash   | first-parse          | 0.4.0 / 0.3.1           |       0.97x |
| representative-1 / bash   | parse                | 0.4.0 / 0.3.1           |       1.45x |
| representative-1 / bash   | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / bash   | walk                 | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / bash   | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / bash   | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / bash   | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / bash   | print                | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / bash   | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / posix  | import               | 0.4.0 / 0.3.1           |       1.16x |
| representative-1 / posix  | first-parse          | 0.4.0 / 0.3.1           |       0.97x |
| representative-1 / posix  | parse                | 0.4.0 / 0.3.1           |       1.71x |
| representative-1 / posix  | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / posix  | walk                 | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / posix  | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / posix  | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / posix  | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / posix  | print                | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / posix  | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / bash  | import               | 0.4.0 / 0.3.1           |       1.39x |
| representative-50 / bash  | first-parse          | 0.4.0 / 0.3.1           |       1.33x |
| representative-50 / bash  | parse                | 0.4.0 / 0.3.1           |       1.70x |
| representative-50 / bash  | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / bash  | walk                 | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / bash  | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / bash  | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / bash  | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / bash  | print                | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / bash  | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / posix | import               | 0.4.0 / 0.3.1           |       1.23x |
| representative-50 / posix | first-parse          | 0.4.0 / 0.3.1           |       1.35x |
| representative-50 / posix | parse                | 0.4.0 / 0.3.1           |       1.47x |
| representative-50 / posix | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / posix | walk                 | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / posix | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / posix | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / posix | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / posix | print                | 0.4.0 / 0.3.1           | unsupported |
| representative-50 / posix | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / bash           | import               | 0.4.0 / 0.3.1           |       1.15x |
| nested-8 / bash           | first-parse          | 0.4.0 / 0.3.1           |       1.02x |
| nested-8 / bash           | parse                | 0.4.0 / 0.3.1           |       1.23x |
| nested-8 / bash           | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / bash           | walk                 | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / bash           | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / bash           | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / bash           | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / bash           | print                | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / bash           | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / posix          | import               | 0.4.0 / 0.3.1           |       1.15x |
| nested-8 / posix          | first-parse          | 0.4.0 / 0.3.1           |       1.01x |
| nested-8 / posix          | parse                | 0.4.0 / 0.3.1           |       1.04x |
| nested-8 / posix          | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / posix          | walk                 | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / posix          | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / posix          | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / posix          | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / posix          | print                | 0.4.0 / 0.3.1           | unsupported |
| nested-8 / posix          | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / bash          | import               | 0.4.0 / 0.3.1           |       1.18x |
| nested-64 / bash          | first-parse          | 0.4.0 / 0.3.1           |       1.04x |
| nested-64 / bash          | parse                | 0.4.0 / 0.3.1           |       1.43x |
| nested-64 / bash          | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / bash          | walk                 | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / bash          | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / bash          | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / bash          | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / bash          | print                | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / bash          | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / posix         | import               | 0.4.0 / 0.3.1           |       1.25x |
| nested-64 / posix         | first-parse          | 0.4.0 / 0.3.1           |       1.01x |
| nested-64 / posix         | parse                | 0.4.0 / 0.3.1           |       1.42x |
| nested-64 / posix         | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / posix         | walk                 | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / posix         | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / posix         | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / posix         | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / posix         | print                | 0.4.0 / 0.3.1           | unsupported |
| nested-64 / posix         | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| heredoc / bash            | import               | 0.4.0 / 0.3.1           |       1.19x |
| heredoc / bash            | first-parse          | 0.4.0 / 0.3.1           |       1.02x |
| heredoc / bash            | parse                | 0.4.0 / 0.3.1           |       1.39x |
| heredoc / bash            | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| heredoc / bash            | walk                 | 0.4.0 / 0.3.1           | unsupported |
| heredoc / bash            | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| heredoc / bash            | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| heredoc / bash            | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| heredoc / bash            | print                | 0.4.0 / 0.3.1           | unsupported |
| heredoc / bash            | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| heredoc / posix           | import               | 0.4.0 / 0.3.1           |       1.10x |
| heredoc / posix           | first-parse          | 0.4.0 / 0.3.1           |       1.05x |
| heredoc / posix           | parse                | 0.4.0 / 0.3.1           |       1.31x |
| heredoc / posix           | parse-with-positions | 0.4.0 / 0.3.1           | unsupported |
| heredoc / posix           | walk                 | 0.4.0 / 0.3.1           | unsupported |
| heredoc / posix           | bounds-root          | 0.4.0 / 0.3.1           | unsupported |
| heredoc / posix           | bounds-all           | 0.4.0 / 0.3.1           | unsupported |
| heredoc / posix           | snapshot-lookup      | 0.4.0 / 0.3.1           | unsupported |
| heredoc / posix           | print                | 0.4.0 / 0.3.1           | unsupported |
| heredoc / posix           | edited-print         | 0.4.0 / 0.3.1           | unsupported |
| representative-1 / bash   | import               | 0.5.0 / 0.4.0           |       1.31x |
| representative-1 / bash   | first-parse          | 0.5.0 / 0.4.0           |       1.01x |
| representative-1 / bash   | parse                | 0.5.0 / 0.4.0           |       0.89x |
| representative-1 / bash   | parse-with-positions | 0.5.0 / 0.4.0           |       1.03x |
| representative-1 / bash   | walk                 | 0.5.0 / 0.4.0           | unsupported |
| representative-1 / bash   | bounds-root          | 0.5.0 / 0.4.0           |       1.01x |
| representative-1 / bash   | bounds-all           | 0.5.0 / 0.4.0           |       0.95x |
| representative-1 / bash   | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.95x |
| representative-1 / bash   | print                | 0.5.0 / 0.4.0           | unsupported |
| representative-1 / bash   | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| representative-1 / posix  | import               | 0.5.0 / 0.4.0           |       1.21x |
| representative-1 / posix  | first-parse          | 0.5.0 / 0.4.0           |       0.99x |
| representative-1 / posix  | parse                | 0.5.0 / 0.4.0           |       0.94x |
| representative-1 / posix  | parse-with-positions | 0.5.0 / 0.4.0           |       1.08x |
| representative-1 / posix  | walk                 | 0.5.0 / 0.4.0           | unsupported |
| representative-1 / posix  | bounds-root          | 0.5.0 / 0.4.0           |       1.12x |
| representative-1 / posix  | bounds-all           | 0.5.0 / 0.4.0           |       1.01x |
| representative-1 / posix  | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.99x |
| representative-1 / posix  | print                | 0.5.0 / 0.4.0           | unsupported |
| representative-1 / posix  | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / bash  | import               | 0.5.0 / 0.4.0           |       1.11x |
| representative-50 / bash  | first-parse          | 0.5.0 / 0.4.0           |       1.03x |
| representative-50 / bash  | parse                | 0.5.0 / 0.4.0           |       1.09x |
| representative-50 / bash  | parse-with-positions | 0.5.0 / 0.4.0           |       0.97x |
| representative-50 / bash  | walk                 | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / bash  | bounds-root          | 0.5.0 / 0.4.0           |       1.00x |
| representative-50 / bash  | bounds-all           | 0.5.0 / 0.4.0           |       0.99x |
| representative-50 / bash  | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.94x |
| representative-50 / bash  | print                | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / bash  | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / posix | import               | 0.5.0 / 0.4.0           |       1.23x |
| representative-50 / posix | first-parse          | 0.5.0 / 0.4.0           |       0.99x |
| representative-50 / posix | parse                | 0.5.0 / 0.4.0           |       0.97x |
| representative-50 / posix | parse-with-positions | 0.5.0 / 0.4.0           |       0.99x |
| representative-50 / posix | walk                 | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / posix | bounds-root          | 0.5.0 / 0.4.0           |       1.00x |
| representative-50 / posix | bounds-all           | 0.5.0 / 0.4.0           |       0.97x |
| representative-50 / posix | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.99x |
| representative-50 / posix | print                | 0.5.0 / 0.4.0           | unsupported |
| representative-50 / posix | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| nested-8 / bash           | import               | 0.5.0 / 0.4.0           |       1.23x |
| nested-8 / bash           | first-parse          | 0.5.0 / 0.4.0           |       1.02x |
| nested-8 / bash           | parse                | 0.5.0 / 0.4.0           |       0.90x |
| nested-8 / bash           | parse-with-positions | 0.5.0 / 0.4.0           |       0.96x |
| nested-8 / bash           | walk                 | 0.5.0 / 0.4.0           | unsupported |
| nested-8 / bash           | bounds-root          | 0.5.0 / 0.4.0           |       0.98x |
| nested-8 / bash           | bounds-all           | 0.5.0 / 0.4.0           |       1.00x |
| nested-8 / bash           | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.91x |
| nested-8 / bash           | print                | 0.5.0 / 0.4.0           | unsupported |
| nested-8 / bash           | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| nested-8 / posix          | import               | 0.5.0 / 0.4.0           |       1.24x |
| nested-8 / posix          | first-parse          | 0.5.0 / 0.4.0           |       1.01x |
| nested-8 / posix          | parse                | 0.5.0 / 0.4.0           |       0.98x |
| nested-8 / posix          | parse-with-positions | 0.5.0 / 0.4.0           |       1.00x |
| nested-8 / posix          | walk                 | 0.5.0 / 0.4.0           | unsupported |
| nested-8 / posix          | bounds-root          | 0.5.0 / 0.4.0           |       0.93x |
| nested-8 / posix          | bounds-all           | 0.5.0 / 0.4.0           |       0.95x |
| nested-8 / posix          | snapshot-lookup      | 0.5.0 / 0.4.0           |       1.00x |
| nested-8 / posix          | print                | 0.5.0 / 0.4.0           | unsupported |
| nested-8 / posix          | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / bash          | import               | 0.5.0 / 0.4.0           |       1.17x |
| nested-64 / bash          | first-parse          | 0.5.0 / 0.4.0           |       0.99x |
| nested-64 / bash          | parse                | 0.5.0 / 0.4.0           |       1.14x |
| nested-64 / bash          | parse-with-positions | 0.5.0 / 0.4.0           |       1.00x |
| nested-64 / bash          | walk                 | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / bash          | bounds-root          | 0.5.0 / 0.4.0           |       0.99x |
| nested-64 / bash          | bounds-all           | 0.5.0 / 0.4.0           |       1.01x |
| nested-64 / bash          | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.98x |
| nested-64 / bash          | print                | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / bash          | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / posix         | import               | 0.5.0 / 0.4.0           |       1.15x |
| nested-64 / posix         | first-parse          | 0.5.0 / 0.4.0           |       1.04x |
| nested-64 / posix         | parse                | 0.5.0 / 0.4.0           |       1.08x |
| nested-64 / posix         | parse-with-positions | 0.5.0 / 0.4.0           |       1.00x |
| nested-64 / posix         | walk                 | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / posix         | bounds-root          | 0.5.0 / 0.4.0           |       1.00x |
| nested-64 / posix         | bounds-all           | 0.5.0 / 0.4.0           |       1.02x |
| nested-64 / posix         | snapshot-lookup      | 0.5.0 / 0.4.0           |       1.01x |
| nested-64 / posix         | print                | 0.5.0 / 0.4.0           | unsupported |
| nested-64 / posix         | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| heredoc / bash            | import               | 0.5.0 / 0.4.0           |       1.23x |
| heredoc / bash            | first-parse          | 0.5.0 / 0.4.0           |       1.00x |
| heredoc / bash            | parse                | 0.5.0 / 0.4.0           |       1.12x |
| heredoc / bash            | parse-with-positions | 0.5.0 / 0.4.0           |       0.98x |
| heredoc / bash            | walk                 | 0.5.0 / 0.4.0           | unsupported |
| heredoc / bash            | bounds-root          | 0.5.0 / 0.4.0           |       1.25x |
| heredoc / bash            | bounds-all           | 0.5.0 / 0.4.0           |       1.05x |
| heredoc / bash            | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.99x |
| heredoc / bash            | print                | 0.5.0 / 0.4.0           | unsupported |
| heredoc / bash            | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| heredoc / posix           | import               | 0.5.0 / 0.4.0           |       1.23x |
| heredoc / posix           | first-parse          | 0.5.0 / 0.4.0           |       1.00x |
| heredoc / posix           | parse                | 0.5.0 / 0.4.0           |       1.05x |
| heredoc / posix           | parse-with-positions | 0.5.0 / 0.4.0           |       0.96x |
| heredoc / posix           | walk                 | 0.5.0 / 0.4.0           | unsupported |
| heredoc / posix           | bounds-root          | 0.5.0 / 0.4.0           |       1.24x |
| heredoc / posix           | bounds-all           | 0.5.0 / 0.4.0           |       1.03x |
| heredoc / posix           | snapshot-lookup      | 0.5.0 / 0.4.0           |       0.99x |
| heredoc / posix           | print                | 0.5.0 / 0.4.0           | unsupported |
| heredoc / posix           | edited-print         | 0.5.0 / 0.4.0           | unsupported |
| representative-1 / bash   | import               | local-candidate / 0.5.0 |       0.92x |
| representative-1 / bash   | first-parse          | local-candidate / 0.5.0 |       1.03x |
| representative-1 / bash   | parse                | local-candidate / 0.5.0 |       0.96x |
| representative-1 / bash   | parse-with-positions | local-candidate / 0.5.0 |       1.02x |
| representative-1 / bash   | walk                 | local-candidate / 0.5.0 |       1.07x |
| representative-1 / bash   | bounds-root          | local-candidate / 0.5.0 |       0.98x |
| representative-1 / bash   | bounds-all           | local-candidate / 0.5.0 |       1.08x |
| representative-1 / bash   | snapshot-lookup      | local-candidate / 0.5.0 |       0.99x |
| representative-1 / bash   | print                | local-candidate / 0.5.0 |       0.98x |
| representative-1 / bash   | edited-print         | local-candidate / 0.5.0 |       0.99x |
| representative-1 / posix  | import               | local-candidate / 0.5.0 |       0.98x |
| representative-1 / posix  | first-parse          | local-candidate / 0.5.0 |       1.02x |
| representative-1 / posix  | parse                | local-candidate / 0.5.0 |       1.00x |
| representative-1 / posix  | parse-with-positions | local-candidate / 0.5.0 |       0.96x |
| representative-1 / posix  | walk                 | local-candidate / 0.5.0 |       1.13x |
| representative-1 / posix  | bounds-root          | local-candidate / 0.5.0 |       0.96x |
| representative-1 / posix  | bounds-all           | local-candidate / 0.5.0 |       0.98x |
| representative-1 / posix  | snapshot-lookup      | local-candidate / 0.5.0 |       0.99x |
| representative-1 / posix  | print                | local-candidate / 0.5.0 |       1.05x |
| representative-1 / posix  | edited-print         | local-candidate / 0.5.0 |       1.07x |
| representative-50 / bash  | import               | local-candidate / 0.5.0 |       0.99x |
| representative-50 / bash  | first-parse          | local-candidate / 0.5.0 |       1.00x |
| representative-50 / bash  | parse                | local-candidate / 0.5.0 |       0.92x |
| representative-50 / bash  | parse-with-positions | local-candidate / 0.5.0 |       1.01x |
| representative-50 / bash  | walk                 | local-candidate / 0.5.0 |       1.23x |
| representative-50 / bash  | bounds-root          | local-candidate / 0.5.0 |       0.95x |
| representative-50 / bash  | bounds-all           | local-candidate / 0.5.0 |       0.94x |
| representative-50 / bash  | snapshot-lookup      | local-candidate / 0.5.0 |       1.03x |
| representative-50 / bash  | print                | local-candidate / 0.5.0 |       0.89x |
| representative-50 / bash  | edited-print         | local-candidate / 0.5.0 |       1.03x |
| representative-50 / posix | import               | local-candidate / 0.5.0 |       1.01x |
| representative-50 / posix | first-parse          | local-candidate / 0.5.0 |       1.01x |
| representative-50 / posix | parse                | local-candidate / 0.5.0 |       1.13x |
| representative-50 / posix | parse-with-positions | local-candidate / 0.5.0 |       0.97x |
| representative-50 / posix | walk                 | local-candidate / 0.5.0 |       1.02x |
| representative-50 / posix | bounds-root          | local-candidate / 0.5.0 |       0.99x |
| representative-50 / posix | bounds-all           | local-candidate / 0.5.0 |       1.04x |
| representative-50 / posix | snapshot-lookup      | local-candidate / 0.5.0 |       1.05x |
| representative-50 / posix | print                | local-candidate / 0.5.0 |       1.05x |
| representative-50 / posix | edited-print         | local-candidate / 0.5.0 |       0.92x |
| nested-8 / bash           | import               | local-candidate / 0.5.0 |       1.03x |
| nested-8 / bash           | first-parse          | local-candidate / 0.5.0 |       1.00x |
| nested-8 / bash           | parse                | local-candidate / 0.5.0 |       0.97x |
| nested-8 / bash           | parse-with-positions | local-candidate / 0.5.0 |       1.07x |
| nested-8 / bash           | walk                 | local-candidate / 0.5.0 |       1.03x |
| nested-8 / bash           | bounds-root          | local-candidate / 0.5.0 |       1.19x |
| nested-8 / bash           | bounds-all           | local-candidate / 0.5.0 |       1.00x |
| nested-8 / bash           | snapshot-lookup      | local-candidate / 0.5.0 |       0.95x |
| nested-8 / bash           | print                | local-candidate / 0.5.0 |       1.03x |
| nested-8 / bash           | edited-print         | local-candidate / 0.5.0 |       1.01x |
| nested-8 / posix          | import               | local-candidate / 0.5.0 |       0.99x |
| nested-8 / posix          | first-parse          | local-candidate / 0.5.0 |       1.01x |
| nested-8 / posix          | parse                | local-candidate / 0.5.0 |       1.04x |
| nested-8 / posix          | parse-with-positions | local-candidate / 0.5.0 |       0.95x |
| nested-8 / posix          | walk                 | local-candidate / 0.5.0 |       0.96x |
| nested-8 / posix          | bounds-root          | local-candidate / 0.5.0 |       1.00x |
| nested-8 / posix          | bounds-all           | local-candidate / 0.5.0 |       1.09x |
| nested-8 / posix          | snapshot-lookup      | local-candidate / 0.5.0 |       0.96x |
| nested-8 / posix          | print                | local-candidate / 0.5.0 |       0.96x |
| nested-8 / posix          | edited-print         | local-candidate / 0.5.0 |       1.03x |
| nested-64 / bash          | import               | local-candidate / 0.5.0 |       1.02x |
| nested-64 / bash          | first-parse          | local-candidate / 0.5.0 |       1.02x |
| nested-64 / bash          | parse                | local-candidate / 0.5.0 |       0.91x |
| nested-64 / bash          | parse-with-positions | local-candidate / 0.5.0 |       0.97x |
| nested-64 / bash          | walk                 | local-candidate / 0.5.0 |       1.14x |
| nested-64 / bash          | bounds-root          | local-candidate / 0.5.0 |       1.01x |
| nested-64 / bash          | bounds-all           | local-candidate / 0.5.0 |       1.00x |
| nested-64 / bash          | snapshot-lookup      | local-candidate / 0.5.0 |       1.14x |
| nested-64 / bash          | print                | local-candidate / 0.5.0 |       0.99x |
| nested-64 / bash          | edited-print         | local-candidate / 0.5.0 |       1.00x |
| nested-64 / posix         | import               | local-candidate / 0.5.0 |       0.99x |
| nested-64 / posix         | first-parse          | local-candidate / 0.5.0 |       0.97x |
| nested-64 / posix         | parse                | local-candidate / 0.5.0 |       1.08x |
| nested-64 / posix         | parse-with-positions | local-candidate / 0.5.0 |       1.02x |
| nested-64 / posix         | walk                 | local-candidate / 0.5.0 |       1.11x |
| nested-64 / posix         | bounds-root          | local-candidate / 0.5.0 |       1.06x |
| nested-64 / posix         | bounds-all           | local-candidate / 0.5.0 |       0.98x |
| nested-64 / posix         | snapshot-lookup      | local-candidate / 0.5.0 |       1.00x |
| nested-64 / posix         | print                | local-candidate / 0.5.0 |       0.99x |
| nested-64 / posix         | edited-print         | local-candidate / 0.5.0 |       1.00x |
| heredoc / bash            | import               | local-candidate / 0.5.0 |       0.99x |
| heredoc / bash            | first-parse          | local-candidate / 0.5.0 |       1.00x |
| heredoc / bash            | parse                | local-candidate / 0.5.0 |       0.94x |
| heredoc / bash            | parse-with-positions | local-candidate / 0.5.0 |       0.95x |
| heredoc / bash            | walk                 | local-candidate / 0.5.0 |       1.03x |
| heredoc / bash            | bounds-root          | local-candidate / 0.5.0 |       0.85x |
| heredoc / bash            | bounds-all           | local-candidate / 0.5.0 |       0.97x |
| heredoc / bash            | snapshot-lookup      | local-candidate / 0.5.0 |       1.14x |
| heredoc / bash            | print                | local-candidate / 0.5.0 |       0.97x |
| heredoc / bash            | edited-print         | local-candidate / 0.5.0 |       0.93x |
| heredoc / posix           | import               | local-candidate / 0.5.0 |       0.99x |
| heredoc / posix           | first-parse          | local-candidate / 0.5.0 |       1.04x |
| heredoc / posix           | parse                | local-candidate / 0.5.0 |       1.01x |
| heredoc / posix           | parse-with-positions | local-candidate / 0.5.0 |       1.02x |
| heredoc / posix           | walk                 | local-candidate / 0.5.0 |       0.92x |
| heredoc / posix           | bounds-root          | local-candidate / 0.5.0 |       0.95x |
| heredoc / posix           | bounds-all           | local-candidate / 0.5.0 |       0.98x |
| heredoc / posix           | snapshot-lookup      | local-candidate / 0.5.0 |       1.08x |
| heredoc / posix           | print                | local-candidate / 0.5.0 |       0.83x |
| heredoc / posix           | edited-print         | local-candidate / 0.5.0 |       1.11x |
