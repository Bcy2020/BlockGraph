# Benchmark Case Audit

> **v0.2.7** — Documenting case status, source-code rationale, and any condition-neutral golden changes.

## Audit Format

Each case entry documents:
- **Status**: active, ambiguous, or deprecated
- **Type**: precision-heavy, recall-heavy, or flow-heavy
- **Source rationale**: why the golden expects specific files/entities/blocks
- **Ambiguity notes**: any known issues or edge cases
- **Golden changes**: any condition-neutral edits (with justification)

---

## Case: fixture-login-flow

**Status**: active
**Type**: flow-heavy (entrypoint_path_location)
**Scoring Mode**: all_required

### Source Rationale
- `LoginForm.tsx`: Contains the login form component with `onSubmit` handler
- `authService.ts`: Contains the `loginUser` function called by the form
- `apiClient.ts`: The HTTP client that makes the actual API call
- Blocks: Auth (owns login), Shared API Client (makes HTTP request)

### Ambiguity Notes
- None significant — this is a straightforward entrypoint path

### Golden Changes
- None needed

---

## Case: fixture-comment-submit-bug

**Status**: active (potentially ambiguous)
**Type**: precision-heavy (bug_localization)
**Scoring Mode**: any_hit

### Source Rationale
- `CommentForm.tsx`: Where the user submits the comment
- `commentService.ts`: Contains `addComment` which should attach comment to discussion
- `discussionService.ts`: Contains `fetchDiscussions` which reloads comments
- `comment.ts`: Type definition that may have incorrect structure

### Ambiguity Notes
- **Issue**: The task says "comments do not appear attached to the expected discussion"
- **Interpretation 1**: Bug is in `addComment` not linking to correct discussion ID
- **Interpretation 2**: Bug is in `fetchDiscussions` not reloading after submit
- **Interpretation 3**: Bug is in type definition causing API mismatch
- **Current golden**: Assumes bug is in comment service or form, with discussion service as secondary

### Golden Changes
- v0.2.7: No changes — golden is reasonable for bug_localization
- Note: `DiscussionList.tsx` is acceptable alternative for `discussionService.ts` (both are in Discussions block)

---

## Case: fixture-error-handling-gaps

**Status**: active (previously ambiguous, now clarified)
**Type**: recall-heavy (bug_localization with any_hit)
**Scoring Mode**: any_hit

### Source Rationale
- All 5 feature components have `useEffect` or `onSubmit` handlers calling API functions
- These are async operations that should have try/catch
- The golden expects the files containing these handlers

### Ambiguity Notes
- **Previous issue (v0.2.6)**: no_graph agent used `fixtures/ts-react-complex/src/` prefix paths
- **Fix (v0.2.7)**: Path normalization now strips fixture prefixes
- **Current interpretation**: The task asks for "every file with unhandled async operations" — all 5 files are valid targets

### Golden Changes
- v0.2.7: No golden changes needed — path normalization fix in scoring resolves the issue
- The `any_hit` scoring mode is appropriate since finding any one unhandled async is valuable

---

## Case: fixture-auth-impact

**Status**: active
**Type**: recall-heavy (impact_analysis)
**Scoring Mode**: all_required

### Source Rationale
- `authService.ts`: The changed surface (auth token handling)
- `apiClient.ts`: Uses auth tokens for API calls
- All feature service files: Use apiClient which depends on auth
- Blocks: Auth (owns token), Shared API Client (uses token), all features (depend on auth)

### Ambiguity Notes
- **Question**: Should direct vs transitive dependents be ranked differently?
- **Current golden**: Ranks direct users of auth (apiClient) and all feature services
- **Note**: This is impact_analysis — completeness matters more than precision

### Golden Changes
- None needed — recall-heavy task is appropriate for impact analysis

---

## Case: fixture-discussion-cross-flow

**Status**: active
**Type**: flow-heavy (cross_module_flow_recovery)
**Scoring Mode**: all_required

### Source Rationale
- `DiscussionList.tsx`: Entry point — mounts and triggers fetch
- `discussionService.ts`: Fetches discussions from API
- `apiClient.ts`: Makes HTTP request
- `commentService.ts`: May be involved if cross-flow includes comments
- Blocks: Discussions (entry), Shared API Client (HTTP), Comments (cross-module)

### Ambiguity Notes
- **Issue**: "Cross-module flow" is ambiguous — does it mean discussion+comment flow, or just discussion?
- **Current golden**: Includes comment service as optional (weight 1)
- **Interpretation**: Cross-module means Discussions → Comments boundary crossing

### Golden Changes
- None needed — golden captures the cross-module nature

---

## Case: fixture-component-prop-trace

**Status**: active
**Type**: precision-heavy
**Scoring Mode**: all_required

### Source Rationale
- Traces how props flow from parent to child components
- Focuses on the prop drilling path, not all components

### Ambiguity Notes
- None significant

### Golden Changes
- None needed

---

## Case: fixture-shared-dep-impact

**Status**: active (potentially ambiguous)
**Type**: recall-heavy (impact_analysis)
**Scoring Mode**: all_required

### Source Rationale
- `apiClient.ts`: The shared dependency that changed
- All feature services: Direct consumers of apiClient
- All feature components: Indirect consumers through services

### Ambiguity Notes
- **Issue (v0.2.6)**: MCP agent over-included UI components (precision penalty)
- **Question**: Should the changed file itself (`apiClient.ts`) be ranked?
- **Current golden**: Does NOT include `apiClient.ts` in ranked files — it's the "changed surface", not an impact target
- **Note**: This is debatable — some impact analysis tasks include the changed file

### Golden Changes
- v0.2.7 consideration: Could add `apiClient.ts` to ranked files since it's the root of impact
- **Decision**: Keep current golden — the task asks for "impact" (what's affected), not "root cause"

---

## Case: fixture-team-feature-landing

**Status**: active
**Type**: precision-heavy (feature_landing_zone)
**Scoring Mode**: all_required

### Source Rationale
- Teams feature directory: Where new team functionality would be added
- Team types: Interface definitions that would be extended
- Team service: Business logic that would be modified

### Ambiguity Notes
- None significant

### Golden Changes
- None needed

---

## Case: fixture-orphaned-code

**Status**: active
**Type**: precision-heavy (bug_localization)
**Scoring Mode**: any_hit

### Source Rationale
- Code that's defined but never imported/used
- Finding any orphan is sufficient (any_hit mode)

### Ambiguity Notes
- None significant

### Golden Changes
- None needed

---

## Case: fixture-api-endpoint-map

**Status**: active
**Type**: precision-heavy
**Scoring Mode**: all_required

### Source Rationale
- Maps API endpoints to their handler functions and UI components
- Requires accurate file-entity-component tuples

### Ambiguity Notes
- None significant

### Golden Changes
- None needed

---

## Summary of Condition-Neutral Golden Changes

**v0.2.7**: No golden changes were made. All identified issues were resolved through:
1. Path normalization in scoring (fixture prefix stripping)
2. Improved ID resolution (scanner format → canonical)
3. Better prompt guidance (precision-scored first-inspection targets)

## Ambiguous Case Exclusion

The following cases can be optionally excluded from aggregate views for robustness analysis:
- `fixture-comment-submit-bug`: Multiple valid interpretations of "where the bug is"
- `fixture-shared-dep-impact`: Unclear whether changed file should be ranked

Exclusion is optional and does not affect raw case scores.
