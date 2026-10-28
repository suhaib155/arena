Quota ASSUMED 500 MiB (real quota UNKNOWN). warn 60% / backpressure 75% / stop 85%. Ordinary players (0% hostile), 300 unique units a day, 14-day detail + 120-day compact proofs, 90-day season.

Peak WAL day = 2 x average (70.7 MiB per 1,000 players a day delete-insert; diff saves 14.9).

### Autovacuum state: kept-up (1 s naptime)

Cells: DB MiB + peak-day WAL MiB = total (percent of assumed 500 MiB, level); last: quota needed to stay under the 85% stop line.

| Players | Seasons | delete-insert (live) | diff | quota needed: delete-insert / diff |
|---|---|---|---|---|
| 200 | 1 | 66 + 28 = 94 (19%, ok) | 64 + 22 = 86 (17%, ok) | 111 / 102 |
| 200 | 4 | 85 + 28 = 113 (23%, ok) | 83 + 22 = 105 (21%, ok) | 133 / 124 |
| 500 | 1 | 146 + 71 = 216 (43%, ok) | 141 + 56 = 197 (39%, ok) | 255 / 232 |
| 500 | 4 | 193 + 71 = 264 (53%, ok) | 189 + 56 = 244 (49%, ok) | 311 / 287 |
| 1,000 | 1 | 279 + 141 = 420 (84%, backpressure) | 269 + 112 = 381 (76%, backpressure) | 494 / 448 |
| 1,000 | 4 | 374 + 141 = 515 (103%, fail_closed) | 364 + 112 = 476 (95%, fail_closed) | 606 / 560 |
| 5,000 | 1 | 1,342 + 707 = 2,050 (410%, fail_closed) | 1,295 + 558 = 1,853 (371%, fail_closed) | 2,411 / 2,180 |
| 5,000 | 4 | 1,818 + 707 = 2,525 (505%, fail_closed) | 1,771 + 558 = 2,328 (466%, fail_closed) | 2,971 / 2,739 |

### Autovacuum state: stock 60 s naptime, compressed-bench bound

Cells: DB MiB + peak-day WAL MiB = total (percent of assumed 500 MiB, level); last: quota needed to stay under the 85% stop line.

| Players | Seasons | delete-insert (live) | diff | quota needed: delete-insert / diff |
|---|---|---|---|---|
| 200 | 1 | 87 + 28 = 115 (23%, ok) | 66 + 22 = 89 (18%, ok) | 136 / 104 |
| 200 | 4 | 106 + 28 = 134 (27%, ok) | 85 + 22 = 108 (22%, ok) | 158 / 127 |
| 500 | 1 | 199 + 71 = 269 (54%, ok) | 147 + 56 = 202 (40%, ok) | 317 / 238 |
| 500 | 4 | 246 + 71 = 317 (63%, warn) | 194 + 56 = 250 (50%, ok) | 373 / 294 |
| 1,000 | 1 | 385 + 141 = 526 (105%, fail_closed) | 280 + 112 = 392 (78%, backpressure) | 619 / 461 |
| 1,000 | 4 | 480 + 141 = 621 (124%, fail_closed) | 376 + 112 = 487 (97%, fail_closed) | 731 / 573 |
| 5,000 | 1 | 1,871 + 707 = 2,579 (516%, fail_closed) | 1,351 + 558 = 1,909 (382%, fail_closed) | 3,034 / 2,246 |
| 5,000 | 4 | 2,347 + 707 = 3,054 (611%, fail_closed) | 1,827 + 558 = 2,384 (477%, fail_closed) | 3,593 / 2,805 |

### Autovacuum state: autovacuum off (bound)

Cells: DB MiB + peak-day WAL MiB = total (percent of assumed 500 MiB, level); last: quota needed to stay under the 85% stop line.

| Players | Seasons | delete-insert (live) | diff | quota needed: delete-insert / diff |
|---|---|---|---|---|
| 200 | 1 | 331 + 28 = 359 (72%, warn) | 85 + 22 = 107 (21%, ok) | 422 / 126 |
| 200 | 4 | 1,152 + 28 = 1,180 (236%, fail_closed) | 168 + 22 = 191 (38%, ok) | 1,388 / 224 |
| 500 | 1 | 807 + 71 = 878 (176%, fail_closed) | 192 + 56 = 248 (50%, ok) | 1,033 / 292 |
| 500 | 4 | 2,861 + 71 = 2,931 (586%, fail_closed) | 401 + 56 = 457 (91%, fail_closed) | 3,448 / 538 |
| 1,000 | 1 | 1,602 + 141 = 1,743 (349%, fail_closed) | 372 + 112 = 484 (97%, fail_closed) | 2,051 / 569 |
| 1,000 | 4 | 5,708 + 141 = 5,850 (1,170%, fail_closed) | 790 + 112 = 902 (180%, fail_closed) | 6,882 / 1,061 |
| 5,000 | 1 | 7,957 + 707 = 8,664 (1,733%, fail_closed) | 1,809 + 558 = 2,367 (473%, fail_closed) | 10,193 / 2,785 |
| 5,000 | 4 | 28,490 + 707 = 29,197 (5,839%, fail_closed) | 3,899 + 558 = 4,456 (891%, fail_closed) | 34,349 / 5,243 |

