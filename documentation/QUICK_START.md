# 🚀 Quick Start: Fixing High-Impact Bugs

**Date**: 2025-11-01  
**Objective**: Fix 5 critical optimizer bugs safely, one at a time

---

## 📚 Documentation Overview

You now have three key documents:

1. **HIGH_IMPACT_CODE_REVIEW.md** - Full analysis of all bugs found
   - What's broken and why
   - Estimated impact of each fix
   - Bug reproduction steps

2. **IMPLEMENTATION_PLAN.md** ⭐ **START HERE**
   - Step-by-step instructions for each fix
   - Test procedures
   - Rollback plans
   - Monitoring guidelines

3. **QUICK_START.md** (this file) - Overview and next steps

---

## 🎯 The Plan: 5 Fixes in Priority Order

### ✅ Phase 1: Issue #2 - Deadband + Step Rounding (COMPLETED 2025-01-22)
**What**: Optimizer gets stuck when rounded delta falls below deadband  
**Fix**: Check deadband BEFORE rounding, not after  
**Status**: ✅ Fixed in commit `9ca9864`  
**Time**: ~2 hours (as estimated)  
**Validation**: ⏳ 24h monitoring required before Phase 2

### Phase 2: Issue #7 - Tank Deadband (1-2 hours)
**What**: Tank oscillates too much (0.5°C deadband with 1.0°C step)  
**Fix**: Increase deadband to match step (1.0°C)  
**Risk**: Low - only affects tank  
**Why Second**: Simple constant change, independent

### Phase 3: Issue #1 - Savings Accounting (4-6 hours)
**What**: Zero/negative savings on "no change" hours  
**Fix**: Always calculate savings vs baseline, not just when setpoint changes  
**Risk**: Medium - changes accounting logic  
**Why Third**: Highest user visibility, builds on Phases 1-2

### Phase 4: Issue #3 - Confidence Persistence (3-4 hours)
**What**: Thermal model confidence resets to 0 after calibration  
**Fix**: Force model update after calibration to persist confidence  
**Risk**: Low - adds persistence only  
**Why Fourth**: Enables learning system for Phase 5

### Phase 5: Issue #6 - Thermal Inertia Blending (2-3 hours)
**What**: Hard cutoff at 30% confidence ignores learned data  
**Fix**: Graduated blending of learned vs default values  
**Risk**: Low - just changes multiplier calculation  
**Why Fifth**: Depends on Phase 4 working

---

## 🚦 Before You Start

### Prerequisites
- [ ] Read through IMPLEMENTATION_PLAN.md (understand the approach)
- [ ] Ensure you can build: `npm run build`
- [ ] Ensure unit tests pass: `npm run test:unit`
- [ ] Have test device/instance ready: `homey app install`
- [ ] Can monitor logs: `homey app log`

### Setup Feature Branch
```bash
cd /Users/kjetilvetlejord/Documents/mel/com.melcloud.optimize
git checkout -b fix-optimizer-high-impact
git push -u origin fix-optimizer-high-impact
```

---

## 🔄 Process for Each Fix

Follow this pattern for Phases 1-5:

### 1. Read Phase Instructions
Open `IMPLEMENTATION_PLAN.md` → Find your phase → Read all steps

### 2. Create Tests First
- Unit tests that FAIL (proving bug exists)
- Run tests, verify failure
- Document failure output

### 3. Implement Fix
- Follow code snippets in plan
- Add comments explaining change
- Keep changes minimal

### 4. Verify Tests Pass
```bash
npm run test:unit -- <your-test-file>
# Should now PASS
```

### 5. Build and Deploy
```bash
npm run build
npm run lint
homey app install
```

### 6. Monitor Production (24h minimum)
```bash
homey app log | tee logs/phase-X-$(date +%Y%m%d).log
# Watch for success criteria from plan
```

### 7. Validate Results
- Check metrics specified in plan
- Compare before/after behavior
- Ensure no new errors

### 8. Commit and Document
```bash
git add <changed-files>
git commit -m "fix: <issue-description> (Issue #X)

<multi-line description from plan>"

git push
```

### 9. Update Tracking
Edit `HIGH_IMPACT_CODE_REVIEW.md`:
- Update status table
- Add commit hash
- Document observed impact

### 10. Proceed to Next Phase
- Only after 24h validation passes
- All success criteria met
- No regressions observed

---

## 📊 Monitoring Checklist

### After Each Phase Deployment

**Immediate (0-2 hours)**:
- [ ] App started successfully
- [ ] No errors in logs
- [ ] Hourly optimization runs
- [ ] Can see expected log messages

**Short-term (2-24 hours)**:
- [ ] Success criteria met (from plan)
- [ ] Metrics collected
- [ ] No user complaints
- [ ] No unexpected behavior

**Before Next Phase**:
- [ ] Full 24h monitoring complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Confidence to proceed

---

## 🆘 If Something Goes Wrong

### Signs of Problems
- Errors in logs
- App crashes
- Setpoints not being set
- User comfort complaints
- Unexpected behavior

### Immediate Actions
1. **Check logs**: `homey app log | grep -i error`
2. **Review change**: What did this phase modify?
3. **Assess impact**: Is it critical or cosmetic?

### Rollback Decision Tree

**Critical Issues** (safety, comfort, crashes):
→ Immediate rollback (see IMPLEMENTATION_PLAN.md § Rollback Procedures)

**Non-Critical Issues** (logging, minor calculation):
→ Note in tracking, consider fix-forward in next iteration

**Uncertain**:
→ Rollback to be safe, analyze logs, re-attempt with adjustment

### Rollback Command
```bash
# Revert last commit
git revert HEAD
npm run build
homey app install

# Verify rollback worked
homey app log
```

---

## 📈 Success Metrics (End Goal)

After all 5 phases complete:

### Quantitative
- [ ] +5-12% more `temperature_adjusted` actions (Phase 1)
- [ ] -30-50% fewer tank adjustments (Phase 2)
- [ ] +8-15% reported savings (Phase 3)
- [ ] Thermal confidence > 0 after calibration (Phase 4)
- [ ] Thermal inertia uses blended values (Phase 5)

### Qualitative
- [ ] No new bugs introduced
- [ ] User reports improved savings visibility
- [ ] Learning system operational
- [ ] No comfort complaints

### Estimated Total Impact
**+12-28% additional savings in typical operation**

---

## 🎬 Ready to Start?

### Your First Command
```bash
# Open the implementation plan
open IMPLEMENTATION_PLAN.md
# Scroll to "Phase 1: Issue #2"
# Follow step-by-step instructions
```

### Phase 1 Overview (Quick Reference)
1. Create test file: `test/unit/setpoint-constraints.test.ts`
2. Write tests that FAIL (prove bug)
3. Fix: `src/util/setpoint-constraints.ts` line 120
4. Tests should now PASS
5. Build, deploy, monitor 24h
6. Commit when validated

### Need Help?
- **Stuck on a step?** Re-read that section in IMPLEMENTATION_PLAN.md
- **Test failing unexpectedly?** Check test setup and mocks
- **Unsure about change?** Ask before proceeding
- **Seeing errors?** Check rollback procedures

---

## 📝 Progress Tracking

Track your progress here:

- [x] **Setup**: Feature branch created (`fix-optimizer-high-impact`)
- [x] **Phase 1**: Issue #2 - Deadband stalemate ✅ COMPLETED
  - [x] Tests created (6 tests added, all failing initially)
  - [x] Fix implemented (setpoint-constraints.ts lines 111-132)
  - [x] Tests passing (10/10 tests pass)
  - [ ] Deployed to test device (NEXT STEP)
  - [ ] Monitored 24h minimum
  - [x] Committed (commit 9ca9864)
- [ ] **Phase 2**: Issue #7 - Tank deadband
  - [ ] (same checklist as Phase 1)
- [ ] **Phase 3**: Issue #1 - Savings accounting
  - [ ] (same checklist)
- [ ] **Phase 4**: Issue #3 - Confidence reset
  - [ ] (same checklist)
- [ ] **Phase 5**: Issue #6 - Thermal inertia
  - [ ] (same checklist)
- [ ] **Final**: All phases validated, documented, merged

---

## 🎉 When You're Done

### Final Steps
1. Run full test suite: `npm run test:unit && npm run test`
2. Create final summary in HIGH_IMPACT_CODE_REVIEW.md
3. Merge PR: `fix-optimizer-high-impact` → `main`
4. Tag release: `git tag v1.x.x-bug-fixes`
5. Announce to users

### Celebrate! 🎊
You've fixed 5 major bugs safely and methodically. The optimizer is now:
- More responsive (deadband fix)
- Less noisy (tank fix)
- Transparent (savings fix)
- Learning properly (confidence + inertia fixes)

---

**Good luck! Start with Phase 1 when you're ready.** 🚀
