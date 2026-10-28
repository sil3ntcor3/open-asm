# Versioning

This fork uses independent semantic versioning and does not derive releases from upstream tags.

- `VERSION` is the authoritative application version in `MAJOR.MINOR.PATCH` form.
- Stable `main` images embed the exact value from `VERSION` and are published with the `latest` image channel.
- Development `dev` images use `MAJOR.MINOR.PATCH-dev.RUN+COMMIT` and are published with the `dev` image channel.
- Immutable image tags continue to use `sha-COMMIT`.
- GitHub release tags use `vMAJOR.MINOR.PATCH` in `sil3ntcor3/open-asm`.

Increment `VERSION` in the same change that intentionally begins a new release line. The root, API, and console package versions should remain aligned with it.
