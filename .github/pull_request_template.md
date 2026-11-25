## What and why


## Architecture ([rules](https://github.com/gcojocaru/sedan-drive/blob/main/ARCHITECTURE.md#rules-for-every-pr))

- [ ] Refactor (no behaviour change) or feature, not both
- [ ] No copied code; shared logic is in a module both places import
- [ ] Imports follow the dependency table; new logic is not inline in a page or in `startGame()`
- [ ] New or changed pure logic has a test, and `npm test` passes (once the test harness exists)
- [ ] Query change → `CACHE_V` bumped, Worker redeploy noted · storage shape change → key version bumped
- [ ] ARCHITECTURE.md / CLAUDE.md updated if the layout, a contract or a storage key changed

## Checked in the browser

- [ ] Real map · [ ] Test track · [ ] Viewer
