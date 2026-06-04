# 0020. Defer Voice, Graphite, and Cloud SSH Integrations

Date: 2026-06-04

## Status

Accepted

## Context

Screenshot inventory surfaced Conductor settings or affordances related to voice mode, Graphite stack support, and cloud/remote workspace SSH key settings. These features may be part of broader Conductor parity, but they are not required for the core local Pi workspace, agent, terminal, review, and PR workflow.

## Decision

Piductor will defer voice mode, Graphite stack support, and cloud/remote workspace SSH settings until after the core product is complete.

These features may appear later behind explicit integration or experimental flags, but they are not v1 implementation requirements.

Deferred items:

- Voice input/mode.
- Graphite stack support.
- Cloud or remote workspace SSH key settings.
- Hosted/cloud workspace behavior.

## Consequences

- Milestone 0-5 can stay focused on local Conductor-style parity.
- Settings inventory should mark these as deferred rather than unresolved blockers.
- Future implementation must revisit UX screenshots and integration requirements before adding them.
