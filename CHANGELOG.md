# Changelog

## [2.1.0](https://github.com/Ravenen/mr-utils/compare/v2.0.0...v2.1.0) (2026-10-31)


### Features

* collapse viewed hunks, hunks-left counter, Shift+] / Shift+[ navigation ([bc4543f](https://github.com/Ravenen/mr-utils/commit/bc4543f3a41318fc8315cacf11d7d9ef5f472bef))
* hunk marks kept per block across pushes, file progress, sync with Viewed ([08dd2c2](https://github.com/Ravenen/mr-utils/commit/08dd2c2d4207d57e48a9734d79cb59c906d19dc7))
* Viewed checkbox and collapsing for each block of changed lines in a hunk ([b895dfb](https://github.com/Ravenen/mr-utils/commit/b895dfb6ceba5c8587f2932ba9361bde0e42c3b0))
* Viewed checkbox on every hunk of the Changes tab (prototype) ([ddff2c5](https://github.com/Ravenen/mr-utils/commit/ddff2c5cc2d51fdf7e39b674c45b4d74ae876578))

## [2.0.0](https://github.com/Ravenen/mr-utils/compare/7fa8b09...v2.0.0) (2026-10-31)


### Features

* Kanban laid over the native MR list instead of cloned cards ([9cdd0ff](https://github.com/Ravenen/mr-utils/commit/9cdd0ff5a652faa12f84ea0137a2581116fa718f))
* versioned settings with migration, Vue options page and popup ([00edbbe](https://github.com/Ravenen/mr-utils/commit/00edbbe55c7d8397512ac3f58c11744391c0a78a))


### Bug Fixes

* a settings change remounts only the features that read it, without new requests ([4b00ff1](https://github.com/Ravenen/mr-utils/commit/4b00ff11a6212e878efa44041db6a6199c68a0dc))
* approval checklist spacing, and placement without an approve button ([0930dfc](https://github.com/Ravenen/mr-utils/commit/0930dfce2864c9cc7d0db098011519267e6472bd))
* board column headers visible on the light theme ([d07b71e](https://github.com/Ravenen/mr-utils/commit/d07b71e7f3341d086213c2624c7e8637cc2565ec))
* board columns line up with their headers to the pixel ([4f837f4](https://github.com/Ravenen/mr-utils/commit/4f837f41492b5e6ca7a4f2f4fd63501cf414061a))
* board header as wide as its column; Approved and N/M badges joined again ([7eb8bff](https://github.com/Ravenen/mr-utils/commit/7eb8bff249225d4aadc288ba756519b7fedd0aa7))


### Refactoring

* GitLab selectors in dom.ts, native UI components, no inline styles ([d474e3c](https://github.com/Ravenen/mr-utils/commit/d474e3c72b5077a8aefe137de087a14219c043e9))
* move extension files into the WXT layout ([317e00b](https://github.com/Ravenen/mr-utils/commit/317e00b072f8b12318e2eeab92a37f38f1f8b1ad))
* router and feature lifecycle instead of the legacy script ([ca216fe](https://github.com/Ravenen/mr-utils/commit/ca216fecfc5b88e3906f9a23286f02deef87ef47))
* typed API layer without DOM access, tested request counts ([b210905](https://github.com/Ravenen/mr-utils/commit/b21090581165fbb6381fa80dca55b218e4ee5fa3))


### Styles

* a little more space between the checklist heading and the first check ([6fb4c14](https://github.com/Ravenen/mr-utils/commit/6fb4c1490b1ba6b054be234553ab306436f1a910))
* approved MR highlight uses GitLab's success color ([8ce982e](https://github.com/Ravenen/mr-utils/commit/8ce982e9bf781475e576a2d2355604f873d867ab))
* checklist heading gets gl-mb-3 ([d50b52d](https://github.com/Ravenen/mr-utils/commit/d50b52d8420dbe9cef19e9287387219876a9bcd9))
* space between a board card's title and its badges row ([a057671](https://github.com/Ravenen/mr-utils/commit/a0576717b2bf103db653c8fa70eff86fa17c9dc1))


### Build

* migrate to WXT + TypeScript with reproducible AMO sources ([3fc23d2](https://github.com/Ravenen/mr-utils/commit/3fc23d248ecac3274e1c5a04ff0f410a85b92dcf))


### CI

* automated releases to the Chrome Web Store and AMO ([f49e310](https://github.com/Ravenen/mr-utils/commit/f49e31012508a79ddbf1f15bdccb55f880ff9523))
