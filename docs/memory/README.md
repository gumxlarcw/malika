# Memory mirror

This directory mirrors MALIKA-specific files from Claude Code's auto-memory at `~/.claude/projects/-var-www-html/memory/` so that anyone with repo access can read the same project context Claude has.

## Source of truth

The local auto-memory at `~/.claude/projects/-var-www-html/memory/` is what Claude actually loads. This directory is a **manually-mirrored copy** for human/team visibility. Auto-memory updates do NOT auto-sync here — re-mirror after significant memory changes.

## Re-mirror command

```bash
cp -r /root/.claude/projects/-var-www-html/memory/*.md /var/www/html/project-data-strategis/docs/memory/
# (Edit out anything project-cross-cutting like opac/sipentas if needed)
```

## Index file

[`MEMORY.md`](./MEMORY.md) is the canonical index of all memory entries. Links inside it are relative to its siblings, so they resolve correctly within this `docs/memory/` directory too.

## File categories

- `MEMORY.md` — top-level index (auto-loaded by Claude every session)
- `db_audit_findings_2026-05-08.md` — DB audit punch list and resolution
- `embedding_gemini_decision.md` — embedding provider decision history (Gemini → e5-base)
- `malika_github_repo.md` — repo consolidation history
- `malika_llm_proxy.md` — LLM proxy config + key pool notes
- `chat_malika_design.md`, `data_malika_design.md`, `kategori_malika_design.md` — Claude Design handoff implementations
- `bps_value_codes.md`, `peta_tematik_*.md` — BPS data conventions
- `feedback_*.md` — explicit Daisy preferences (no Co-Authored-By, verify subagent reports, etc.)
- `*_trap.md`, `tailwind4_html2canvas_oklch.md`, `leaflet_export_canvas_renderer.md` — gotchas to avoid
- `next16_notfound_status.md`, `insights_template_mode_error.md` — framework/library quirks
- `chat_pipeline_orphan_code.md` — historical refactor notes
- `scalability-checklist.md` — capacity-planning notes

## Excluded from this mirror

The auto-memory directory also contains files for SIPENTAS and OPAC projects (separate codebases). Those are NOT mirrored here — only MALIKA-specific entries.
