# Correct Startup Procedure – Implementation Tickets

## Ticket Overview

This directory contains 7 implementation tickets for the corrected startup procedure. Each ticket is a vertical slice (complete, demoable, end-to-end) with clearly defined blocking relationships.

**Total work**: ~21 hours of development + testing

## Ticket Summary & Dependencies

### **01. Network Availability Detection** (No blocker)
- Implement `checkNetworkAvailable()` function
- Standalone utility for detecting online/offline status
- **Duration**: ~2 hours
- **Deliverable**: User can be offline and app handles it gracefully

### **02. Update Check & Install Refactoring** (Blocked by #01)
- Refactor `startUpdates()` into two functions: `performUpdateCheck()` and `performUpdateInstall()`
- Extracted functions are independent and testable
- **Duration**: ~3 hours
- **Deliverable**: Update logic can be used by orchestrator without parallel execution

### **03. Data Folder Loading with Non-Fatal Errors** (No blocker)
- Refactor folder loading to return errors instead of throwing
- Returns `{folder}` or `{error}` instead of crashing
- **Duration**: ~2 hours
- **Deliverable**: App doesn't crash when folder is missing on startup

### **04. Startup Sequence Orchestrator** (Blocked by #01, #02, #03)
- Implement `startupSequence()` function
- Strictly sequential: network → update → folder → window load
- Coordinates all steps and error handling
- **Duration**: ~4 hours
- **Deliverable**: Full startup pipeline with correct order and error handling

### **05. Splash Error Display & User Acknowledgment** (Blocked by #04)
- Enhance splash screen to show errors with OK button
- Add IPC handlers for error display and user acknowledgment
- **Duration**: ~3 hours
- **Deliverable**: Users see clear error messages on splash and can acknowledge them

### **06. Renderer Read-Only Mode Detection** (Blocked by #05)
- Detect missing folder in renderer
- Disable data operations, keep settings available
- **Duration**: ~4 hours
- **Deliverable**: App shows in limited mode when folder missing, user can recover

### **07. Integration Tests & Acceptance Verification** (Blocked by #06)
- Write comprehensive integration tests
- Verify all 15 acceptance criteria
- Test all scenarios and combinations
- **Duration**: ~3 hours
- **Deliverable**: All acceptance criteria passing, all scenarios tested

## Dependency Graph

```
01-network-detection (can start immediately)
├─ 02-update-refactoring
│  └─ 04-orchestrator
│     └─ 05-splash-errors
│        └─ 06-readonly-mode
│           └─ 07-integration-tests

03-folder-loading (can start immediately)
└─ 04-orchestrator (waits for 02 and 03)
   └─ 05-splash-errors
      └─ 06-readonly-mode
         └─ 07-integration-tests
```

## Parallelism Opportunities

- **01** and **03** can be worked on in parallel (independent)
- **02** waits for **01** only
- **04** cannot start until **01**, **02**, and **03** are complete
- **05**, **06**, **07** are strictly sequential (each depends on previous)

**Suggested team assignment**:
- Developer A: Tickets #01 and #03 (can run in parallel)
- Developer B: Ticket #02 (starts after #01)
- Developer C: Tickets #04, #05, #06, #07 (sequential, same developer for context)

## Implementation Order for Single Developer

1. **#01** - Network detection (2h)
2. **#03** - Folder loading (2h) *can start while #01 is in review*
3. **#02** - Update refactoring (3h) *depends on #01*
4. **#04** - Orchestrator (4h) *depends on #01, #02, #03*
5. **#05** - Splash errors (3h) *depends on #04*
6. **#06** - Read-only mode (4h) *depends on #05*
7. **#07** - Integration tests (3h) *depends on #06*

**Total path time**: ~21 hours

## File Locations

Each ticket file is named `NN-<slug>.md` where NN is the ticket number:

- `01-network-detection.md` - Network check function
- `02-update-refactoring.md` - Separate update check and install
- `03-folder-loading.md` - Non-fatal folder error handling
- `04-orchestrator.md` - Main startup orchestrator
- `05-splash-errors.md` - Splash error display
- `06-readonly-mode.md` - Renderer read-only mode
- `07-integration-tests.md` - Integration tests

## Acceptance Criteria Mapping

Each ticket includes acceptance criteria that map to the main spec. All 15 acceptance criteria from the specification are covered:

- Strictly sequential on all platforms ✓ (covered by #04, #07)
- Update check runs only if online ✓ (covered by #01, #04, #07)
- Update install automatic + silently fail over ✓ (covered by #02, #04, #07)
- Folder missing doesn't close app ✓ (covered by #03, #04, #05, #07)
- Splash shows minimal text ✓ (covered by #05)
- Splash error messages human-readable ✓ (covered by #05)
- User must click OK on errors ✓ (covered by #05)
- Splash closes only after all steps + renderer ready ✓ (covered by #04, #05, #07)
- Main window doesn't render until ready ✓ (covered by #04, #07)
- Settings/folder picker accessible in read-only ✓ (covered by #06)
- Data views disabled in read-only ✓ (covered by #06)
- Testable with mocked sub-steps ✓ (covered by #01, #02, #03, #07)
- Network, update, install, folder tested independently ✓ (covered by #07)
- Fatal errors close app, non-fatal proceed ✓ (covered by #05, #07)
- Platforms identical (no special Linux) ✓ (covered by #04, #07)
- Post-update restart runs full sequence ✓ (covered by #07)

## Status

All tickets are **ready-for-agent**. They can be claimed and worked on individually.

Dependencies are clear. No circular dependencies. Work can proceed in parallel where possible, or sequentially by one developer.
