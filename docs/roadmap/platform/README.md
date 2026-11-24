# Platform

Date: 2026-11-24
Status: brief

## Intent

Platform work that no product phase owns but every phase depends on: the database toolchain, CI and deploys. These slices keep the build, the migrations and the hosted engine working as the app grows.

## How this folder works

Same as the phases: each slice is a short brief covering the goal, what exists, what's in and out of scope, and the open questions. When a slice's turn comes, it gets its own brainstorm and spec in `docs/superpowers/specs/`, then a plan and PRs.

## Slices

| #   | Slice                                      | Status |
| --- | ------------------------------------------ | ------ |
| 01  | [Migration squash](01-migration-squash.md) | Brief  |
