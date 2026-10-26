# ADR 0030 — Battle map grid calibration

- Status: Accepted
- Date: 2026-10-25

## Context

Battle map backgrounds often contain a printed square grid whose scale and alignment are not known in advance. Manual cell-size entry does not determine grid offset and is difficult to measure from a fitted image. Map scene coordinates also determine piece positions, and existing painted cell fills are tied to the current grid.

## Decision

The GM may calibrate a battle map by clicking two intersections on the same row or column and entering the number of cells between them. The client converts those clicks into source-image pixels, sets map dimensions to the image's natural width and height, and stores the measured square-cell size plus a normalized two-axis grid origin in the shared MapGrid contract. The host validates the origin. Calibration preserves existing piece positions proportionally and asks before clearing painted cell fills.

## Consequences

Existing grids remain compatible because origin is optional and defaults to (0, 0). Map pieces remain in the same relative locations after the map coordinate space changes. Calibrated dimensions and grid coordinates correspond to image pixels, so the displayed background and grid share one coordinate system. The first pass supports square grids; hex calibration remains manual.
