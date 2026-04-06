# Product Compare Memory

This document records the durable decisions behind the 2026-04-07 product compare fixes so we do not have to rediscover the same behavior later.

## 1. Real business assumption

Supplier price comparison cannot rely on `UPC` alone.

Common real-world situation:

- the same product exists in both sources
- `UPC` may differ
- product name is usually still inferable
- packaging expression may differ (`1瓶` vs `15瓶/箱`)

So "UPC mismatch" should be treated as "needs deeper matching", not "likely unmatched".

## 2. Current matching order

In backend `productMaster` mode the intended order is:

1. `UPC` exact match
2. learned match reuse
3. guarded rule match
4. AI fallback

In custom dual-sheet mode:

1. `UPC` exact match
2. AI fallback

The learned/rule layers are intentionally product-master focused, because product-master data is the durable canonical side and benefits most from match accumulation.

## 3. Why the old behavior failed

The previous implementation had two important problems:

- non-UPC rows could be skipped before AI because local candidate gating was too strict
- product master expands one logical product into multiple store candidates, and those duplicates could trigger the rule score-gap guard, causing a false fallback to AI

This is why a row like `农夫山泉尖叫蓝色多肽型运动饮料550ml` could still fail even though product master already had a very close canonical product.

## 4. Rule matching boundaries

Rule match should be conservative, not aggressive.

It is designed for high-confidence cases such as:

- same brand
- same series/core descriptor
- same capacity/measure token
- different spacing, punctuation, or carton wording

It should refuse to hard-match when:

- multiple truly different candidates are too close
- capacity/unit signals conflict
- flavor/descriptor conflict is material

## 5. Learned match reuse

When AI confirms a non-UPC match, the backend now persists a reusable mapping so the next run can skip AI.

Current runtime concept:

- target side builds a normalized text key from name/spec/unit/supplier fields
- matched reference side is stored by reference UPC and fallback reference key
- later runs reuse that mapping before rule/AI

This history is runtime state, not repo state.

Current runtime files on backend:

- product compare AI config: `runtime/product-compare/ai-config.json`
- learned matches: `runtime/product-compare/learned-matches.json`

## 6. AI operational notes

- AI must be considered a fallback, not the default path for every recurring naming pattern.
- Runtime API key/config should be written through backend config storage or backend API, not committed to git.
- Timeouts matter on full-sheet runs; debugging should start with a single-row workbook when possible.

## 7. Verified example

The row below is now expected to match in `productMaster` mode:

- target: `农夫山泉尖叫蓝色多肽型运动饮料550ml`
- target spec: `550ml*15瓶/箱`
- product master candidate: `农夫山泉 尖叫 多肽型运动饮料 550ml／瓶`
- candidate UPC: `6921168504015`

One verified online task after the fix:

- task id: `953549d1-7aae-49ef-b931-cc8619b8da6a`
- result: `规则匹配命中（名称/规格特征高度一致，score=49）`

## 8. Files to inspect next time

Primary backend file:

- `C:\Users\31314\Documents\GitHub\scripts-backend\src\lib\product-compare.ts`

Related backend route:

- `C:\Users\31314\Documents\GitHub\scripts-backend\src\routes\product-center.ts`

Test coverage:

- `C:\Users\31314\Documents\GitHub\scripts-backend\test\auth.test.ts`

Frontend/Electron counterpart:

- `C:\Users\31314\Documents\GitHub\scripts\apps\web-antd\electron\features\product-compare\index.ts`
